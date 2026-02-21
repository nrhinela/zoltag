"""Background queue worker for executing jobs."""

from __future__ import annotations

import logging
import os
import socket
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import Event, Lock, Thread
from typing import Any, Callable, Optional

from zoltag.cli.introspection import build_queue_command_argv
from zoltag.database import SessionLocal
from zoltag.metadata import Job, JobAttempt, JobDefinition, JobWorker
from zoltag.auth.models import UserProfile
from zoltag.workflow_queue import (
    handle_workflow_job_state_change,
    mark_workflow_step_running,
    reconcile_running_workflows,
)

# Ensure SQLAlchemy registers auth tables (notably user_profiles), which are
# referenced by foreign keys on jobs.* created_by columns.
_USER_PROFILE_TABLE = UserProfile.__table__


logger = logging.getLogger(__name__)

_MAX_LOG_TAIL_CHARS = 20000
_DEFAULT_POLL_SECONDS = 5.0
_DEFAULT_LEASE_SECONDS = 300
_DEFAULT_IDLE_HEARTBEAT_SECONDS = 30.0
_DEFAULT_LOG_FLUSH_SECONDS = 2.0
_DEFAULT_CANCEL_CHECK_SECONDS = 1.0
_DEFAULT_WORKFLOW_RECONCILE_SECONDS = 10.0

_worker_thread: Optional[Thread] = None
_worker_stop_event: Optional[Event] = None


@dataclass
class ClaimedJob:
    id: str
    tenant_id: str
    definition_key: str
    payload: dict[str, Any]
    timeout_seconds: int
    max_attempts: int
    attempt_no: int


@dataclass
class ExecutionResult:
    success: bool
    attempt_status: str
    exit_code: Optional[int]
    stdout_tail: Optional[str]
    stderr_tail: Optional[str]
    error_text: Optional[str]
    retryable: bool


class NonRetryableJobError(RuntimeError):
    """Raised when a job cannot be executed due to invalid/unsupported config."""


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _tail_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, bytes):
        text = value.decode("utf-8", errors="replace")
    else:
        text = str(value)
    if not text:
        return None
    return text[-_MAX_LOG_TAIL_CHARS:]


def _append_tail(existing: Optional[str], chunk: Any) -> Optional[str]:
    if chunk is None:
        return existing
    if isinstance(chunk, bytes):
        text = chunk.decode("utf-8", errors="replace")
    else:
        text = str(chunk)
    if not text:
        return existing
    merged = f"{existing or ''}{text}"
    return merged[-_MAX_LOG_TAIL_CHARS:]


def _is_non_retryable_command_failure(stdout_tail: Optional[str], stderr_tail: Optional[str]) -> bool:
    text = f"{stdout_tail or ''}\n{stderr_tail or ''}".lower()
    markers = (
        "configured dropbox folder not found",
        "configured dropbox path is not a folder",
        "no dropbox refresh token configured",
        "dropbox app key not configured",
        "managed app credentials are not configured",
        "tenant not found in database",
        "provider integration is inactive",
    )
    return any(marker in text for marker in markers)


def _to_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    text = str(value or "").strip().lower()
    return text in {"1", "true", "yes", "y", "on"}


def _build_command_argv(job: ClaimedJob) -> list[str]:
    payload = job.payload or {}
    if not isinstance(payload, dict):
        raise NonRetryableJobError("Job payload must be a JSON object")
    try:
        return build_queue_command_argv(
            command_name=str(job.definition_key or "").strip(),
            tenant_id=str(job.tenant_id),
            payload=payload,
            python_executable=sys.executable,
        )
    except ValueError as exc:
        raise NonRetryableJobError(str(exc)) from exc


def _upsert_worker_heartbeat(
    db,
    *,
    worker_id: str,
    hostname: str,
    version: str,
    queues: list[str],
    running_count: int,
    metadata_json: dict[str, Any],
) -> None:
    row = db.query(JobWorker).filter(JobWorker.worker_id == worker_id).first()
    now = _now_utc()
    if row is None:
        row = JobWorker(
            worker_id=worker_id,
            hostname=hostname,
            version=version,
            queues=queues,
            running_count=running_count,
            metadata_json=metadata_json,
            last_seen_at=now,
        )
        db.add(row)
        return

    row.hostname = hostname
    row.version = version
    row.queues = queues
    row.running_count = running_count
    row.metadata_json = metadata_json
    row.last_seen_at = now


def _claim_next_job(
    *,
    worker_id: str,
    hostname: str,
    version: str,
    lease_seconds: int,
    queues: list[str],
) -> Optional[ClaimedJob]:
    db = SessionLocal()
    try:
        now = _now_utc()
        query = (
            db.query(Job)
            .filter(
                Job.status == "queued",
                Job.scheduled_for <= now,
            )
            .order_by(
                Job.priority.asc(),
                Job.queued_at.asc(),
                Job.id.asc(),
            )
        )
        if db.bind and db.bind.dialect.name == "postgresql":
            query = query.with_for_update(skip_locked=True)
        else:
            query = query.with_for_update()

        job = query.first()
        if job is None:
            _upsert_worker_heartbeat(
                db,
                worker_id=worker_id,
                hostname=hostname,
                version=version,
                queues=queues,
                running_count=0,
                metadata_json={},
            )
            db.commit()
            return None

        attempt_no = int(job.attempt_count or 0) + 1
        lease_expires_at = now + timedelta(seconds=lease_seconds)
        job.status = "running"
        if not job.started_at:
            job.started_at = now
        job.lease_expires_at = lease_expires_at
        job.claimed_by_worker = worker_id
        job.attempt_count = attempt_no
        mark_workflow_step_running(db, job=job, started_at=job.started_at or now)
        db.add(
            JobAttempt(
                job_id=job.id,
                attempt_no=attempt_no,
                worker_id=worker_id,
                pid=os.getpid(),
                started_at=now,
                status="running",
            )
        )

        _upsert_worker_heartbeat(
            db,
            worker_id=worker_id,
            hostname=hostname,
            version=version,
            queues=queues,
            running_count=1,
            metadata_json={"last_job_id": str(job.id)},
        )
        db.commit()

        definition = (
            db.query(JobDefinition)
            .filter(JobDefinition.id == job.definition_id)
            .first()
        )
        if definition is None:
            raise NonRetryableJobError(
                f"Missing job definition for definition_id={job.definition_id}"
            )

        return ClaimedJob(
            id=str(job.id),
            tenant_id=str(job.tenant_id),
            definition_key=str(definition.key or ""),
            payload=job.payload or {},
            timeout_seconds=int(definition.timeout_seconds or 3600),
            max_attempts=int(job.max_attempts or 1),
            attempt_no=attempt_no,
        )
    finally:
        db.close()


def _execute_claimed_job(
    job: ClaimedJob,
    on_progress_logs: Optional[Callable[[Optional[str], Optional[str]], None]] = None,
    should_cancel: Optional[Callable[[], bool]] = None,
) -> ExecutionResult:
    process: Optional[subprocess.Popen[str]] = None
    try:
        argv = _build_command_argv(job)
        logger.info(
            "Executing job %s (%s) with command: %s",
            job.id,
            job.definition_key,
            " ".join(argv),
        )
        process = subprocess.Popen(
            argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

        log_state: dict[str, Optional[str]] = {"stdout": None, "stderr": None}
        state_lock = Lock()

        def _consume_stream(stream, key: str) -> None:
            try:
                if stream is None:
                    return
                while True:
                    chunk = stream.readline()
                    if chunk == "":
                        break
                    with state_lock:
                        log_state[key] = _append_tail(log_state.get(key), chunk)
            finally:
                if stream is not None:
                    try:
                        stream.close()
                    except Exception:
                        pass

        stdout_thread = Thread(target=_consume_stream, args=(process.stdout, "stdout"), daemon=True)
        stderr_thread = Thread(target=_consume_stream, args=(process.stderr, "stderr"), daemon=True)
        stdout_thread.start()
        stderr_thread.start()

        timeout_seconds = max(1, int(job.timeout_seconds or 3600))
        flush_seconds = max(
            0.5,
            float(os.getenv("JOB_ATTEMPT_LOG_FLUSH_SECONDS") or _DEFAULT_LOG_FLUSH_SECONDS),
        )
        started_at = time.monotonic()
        last_flush_at = 0.0
        last_cancel_check_at = 0.0
        did_timeout = False
        did_cancel = False
        last_sent_tails: tuple[Optional[str], Optional[str]] = (None, None)

        def _snapshot_tails() -> tuple[Optional[str], Optional[str]]:
            with state_lock:
                return log_state.get("stdout"), log_state.get("stderr")

        while True:
            now = time.monotonic()
            if now - started_at > timeout_seconds:
                did_timeout = True
                process.kill()
                break

            cancel_check_seconds = max(
                0.2,
                float(os.getenv("JOB_ATTEMPT_CANCEL_CHECK_SECONDS") or _DEFAULT_CANCEL_CHECK_SECONDS),
            )
            if callable(should_cancel) and (now - last_cancel_check_at) >= cancel_check_seconds:
                if should_cancel():
                    did_cancel = True
                    process.kill()
                    break
                last_cancel_check_at = now

            if now - last_flush_at >= flush_seconds:
                tails = _snapshot_tails()
                if callable(on_progress_logs) and tails != last_sent_tails:
                    on_progress_logs(*tails)
                    last_sent_tails = tails
                last_flush_at = now

            if process.poll() is not None:
                break
            time.sleep(0.2)

        try:
            process.wait(timeout=5.0)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait(timeout=5.0)

        stdout_thread.join(timeout=2.0)
        stderr_thread.join(timeout=2.0)

        stdout_tail, stderr_tail = _snapshot_tails()
        if callable(on_progress_logs) and (stdout_tail, stderr_tail) != last_sent_tails:
            on_progress_logs(stdout_tail, stderr_tail)

        if did_cancel:
            return ExecutionResult(
                success=False,
                attempt_status="canceled",
                exit_code=130,
                stdout_tail=stdout_tail,
                stderr_tail=stderr_tail,
                error_text="Job canceled",
                retryable=False,
            )

        if did_timeout:
            return ExecutionResult(
                success=False,
                attempt_status="timeout",
                exit_code=124,
                stdout_tail=stdout_tail,
                stderr_tail=stderr_tail,
                error_text=f"Command timed out after {timeout_seconds}s",
                retryable=True,
            )

        return_code = int(process.returncode or 0)
        if return_code == 0:
            return ExecutionResult(
                success=True,
                attempt_status="succeeded",
                exit_code=0,
                stdout_tail=stdout_tail,
                stderr_tail=stderr_tail,
                error_text=None,
                retryable=False,
            )

        error_text = f"Command exited with code {return_code}"
        retryable = not _is_non_retryable_command_failure(stdout_tail, stderr_tail)
        return ExecutionResult(
            success=False,
            attempt_status="failed",
            exit_code=return_code,
            stdout_tail=stdout_tail,
            stderr_tail=stderr_tail,
            error_text=error_text,
            retryable=retryable,
        )
    except NonRetryableJobError as exc:
        return ExecutionResult(
            success=False,
            attempt_status="failed",
            exit_code=2,
            stdout_tail=None,
            stderr_tail=None,
            error_text=str(exc),
            retryable=False,
        )
    except Exception as exc:  # pragma: no cover - defensive catch
        return ExecutionResult(
            success=False,
            attempt_status="failed",
            exit_code=1,
            stdout_tail=None,
            stderr_tail=None,
            error_text=f"Unhandled worker exception: {exc}",
            retryable=True,
        )
    finally:
        if process and process.poll() is None:
            try:
                process.kill()
            except Exception:
                pass


def _update_running_attempt_logs(
    *,
    claimed_job: ClaimedJob,
    worker_id: str,
    stdout_tail: Optional[str],
    stderr_tail: Optional[str],
) -> None:
    if not stdout_tail and not stderr_tail:
        return

    db = SessionLocal()
    try:
        job_uuid = uuid.UUID(claimed_job.id)
        job = db.query(Job).filter(Job.id == job_uuid).first()
        if job is None:
            db.rollback()
            return
        if str(job.claimed_by_worker or "").strip() != worker_id or str(job.status or "") != "running":
            db.rollback()
            return

        attempt = (
            db.query(JobAttempt)
            .filter(
                JobAttempt.job_id == job_uuid,
                JobAttempt.attempt_no == claimed_job.attempt_no,
            )
            .first()
        )
        if attempt is None:
            db.rollback()
            return

        attempt.stdout_tail = stdout_tail
        attempt.stderr_tail = stderr_tail
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to persist running logs for job %s", claimed_job.id)
    finally:
        db.close()


def _is_job_cancel_requested(*, claimed_job_id: str) -> bool:
    db = SessionLocal()
    try:
        job_uuid = uuid.UUID(claimed_job_id)
        row = db.query(Job.status).filter(Job.id == job_uuid).first()
        if row is None:
            return True
        status = str(getattr(row, "status", row[0]) or "").strip().lower()
        return status == "canceled"
    except Exception:
        logger.exception("Failed checking cancel status for job %s", claimed_job_id)
        return False
    finally:
        db.close()


def _finalize_job(
    *,
    claimed_job: ClaimedJob,
    result: ExecutionResult,
    worker_id: str,
    hostname: str,
    version: str,
    queues: list[str],
) -> None:
    db = SessionLocal()
    try:
        job_uuid = uuid.UUID(claimed_job.id)
        query = db.query(Job).filter(Job.id == job_uuid)
        if db.bind and db.bind.dialect.name == "postgresql":
            query = query.with_for_update(skip_locked=False)
        else:
            query = query.with_for_update()
        job = query.first()
        if job is None:
            db.rollback()
            logger.warning("Claimed job %s disappeared before finalization", claimed_job.id)
            return

        if str(job.claimed_by_worker or "").strip() != worker_id:
            if str(job.status or "").strip().lower() != "canceled":
                db.rollback()
                logger.warning(
                    "Job %s is no longer claimed by %s (claimed_by=%s)",
                    claimed_job.id,
                    worker_id,
                    job.claimed_by_worker,
                )
                return

        now = _now_utc()
        attempt = (
            db.query(JobAttempt)
            .filter(
                JobAttempt.job_id == job_uuid,
                JobAttempt.attempt_no == claimed_job.attempt_no,
            )
            .first()
        )

        if str(job.status or "").strip().lower() == "canceled" or result.attempt_status == "canceled":
            job.status = "canceled"
            job.finished_at = now
            job.lease_expires_at = None
            job.claimed_by_worker = None
            job.last_error = result.error_text or job.last_error
            logger.info("Job %s canceled", claimed_job.id)
            if attempt:
                attempt.status = "canceled"
                attempt.finished_at = now
                attempt.exit_code = result.exit_code
                attempt.stdout_tail = result.stdout_tail
                attempt.stderr_tail = result.stderr_tail
                attempt.error_text = result.error_text or attempt.error_text
        elif result.success:
            job.status = "succeeded"
            job.finished_at = now
            job.lease_expires_at = None
            job.claimed_by_worker = None
            job.last_error = None
            logger.info("Job %s succeeded", claimed_job.id)
            if attempt:
                attempt.status = "succeeded"
                attempt.finished_at = now
                attempt.exit_code = 0
                attempt.stdout_tail = result.stdout_tail
                attempt.stderr_tail = result.stderr_tail
                attempt.error_text = None
        else:
            attempts_used = int(job.attempt_count or 0)
            max_attempts = int(job.max_attempts or claimed_job.max_attempts or 1)
            should_requeue = bool(result.retryable and attempts_used < max_attempts)
            if should_requeue:
                delay_seconds = min(300 * (2 ** max(attempts_used - 1, 0)), 3600)
                job.status = "queued"
                job.scheduled_for = now + timedelta(seconds=delay_seconds)
                job.started_at = None
                job.finished_at = None
                job.lease_expires_at = None
                job.claimed_by_worker = None
                job.last_error = result.error_text
                logger.warning(
                    "Job %s failed (attempt %s/%s), requeued in %ss: %s",
                    claimed_job.id,
                    attempts_used,
                    max_attempts,
                    delay_seconds,
                    result.error_text,
                )
            else:
                job.status = "dead_letter"
                job.finished_at = now
                job.lease_expires_at = None
                job.claimed_by_worker = None
                job.last_error = result.error_text
                logger.error(
                    "Job %s moved to dead_letter after attempt %s/%s: %s",
                    claimed_job.id,
                    attempts_used,
                    max_attempts,
                    result.error_text,
                )

            if attempt:
                attempt.status = result.attempt_status
                attempt.finished_at = now
                attempt.exit_code = result.exit_code
                attempt.stdout_tail = result.stdout_tail
                attempt.stderr_tail = result.stderr_tail
                attempt.error_text = result.error_text

        handle_workflow_job_state_change(db, job=job)
        _upsert_worker_heartbeat(
            db,
            worker_id=worker_id,
            hostname=hostname,
            version=version,
            queues=queues,
            running_count=0,
            metadata_json={"last_job_id": claimed_job.id},
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to finalize job %s", claimed_job.id)
    finally:
        db.close()


def _build_worker_id() -> str:
    return f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"


def _reconcile_workflows_once(*, limit_runs: int = 25) -> None:
    db = SessionLocal()
    try:
        reconciled = reconcile_running_workflows(db, limit_runs=limit_runs)
        if reconciled:
            logger.info("Workflow reconciliation tick processed %s run(s)", reconciled)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Workflow reconciliation tick failed")
    finally:
        db.close()


def run_loop(
    *,
    stop_event: Optional[Event] = None,
    once: bool = False,
    poll_seconds: float = _DEFAULT_POLL_SECONDS,
    lease_seconds: int = _DEFAULT_LEASE_SECONDS,
) -> None:
    stop = stop_event or Event()
    worker_id = str(os.getenv("JOB_WORKER_ID") or _build_worker_id())
    hostname = socket.gethostname()
    version = str(os.getenv("K_REVISION") or os.getenv("GIT_SHA") or "").strip()
    queues = [value.strip() for value in str(os.getenv("JOB_WORKER_QUEUES") or "").split(",") if value.strip()]
    idle_heartbeat_interval = float(os.getenv("JOB_WORKER_IDLE_HEARTBEAT_SECONDS") or _DEFAULT_IDLE_HEARTBEAT_SECONDS)
    workflow_reconcile_interval = float(
        os.getenv("JOB_WORKFLOW_RECONCILE_SECONDS") or _DEFAULT_WORKFLOW_RECONCILE_SECONDS
    )
    workflow_reconcile_limit = int(os.getenv("JOB_WORKFLOW_RECONCILE_LIMIT") or 25)
    last_idle_heartbeat_at = 0.0
    last_workflow_reconcile_at = 0.0

    logger.info("Job worker started: worker_id=%s lease_seconds=%s", worker_id, lease_seconds)

    while not stop.is_set():
        now_monotonic = time.monotonic()
        if now_monotonic - last_workflow_reconcile_at >= workflow_reconcile_interval:
            last_workflow_reconcile_at = now_monotonic
            _reconcile_workflows_once(limit_runs=workflow_reconcile_limit)

        try:
            claimed_job = _claim_next_job(
                worker_id=worker_id,
                hostname=hostname,
                version=version,
                lease_seconds=lease_seconds,
                queues=queues,
            )
        except Exception:
            logger.exception("Worker claim loop failed")
            if once:
                break
            stop.wait(max(1.0, poll_seconds))
            continue

        if claimed_job is None:
            now_ts = time.monotonic()
            if now_ts - last_idle_heartbeat_at >= idle_heartbeat_interval:
                last_idle_heartbeat_at = now_ts
                logger.debug("Worker idle: no queued jobs")
            if once:
                break
            stop.wait(max(0.1, poll_seconds))
            continue

        logger.info(
            "Claimed job %s tenant=%s definition=%s attempt=%s",
            claimed_job.id,
            claimed_job.tenant_id,
            claimed_job.definition_key,
            claimed_job.attempt_no,
        )
        result = _execute_claimed_job(
            claimed_job,
            on_progress_logs=lambda stdout_tail, stderr_tail: _update_running_attempt_logs(
                claimed_job=claimed_job,
                worker_id=worker_id,
                stdout_tail=stdout_tail,
                stderr_tail=stderr_tail,
            ),
            should_cancel=lambda: _is_job_cancel_requested(claimed_job_id=claimed_job.id),
        )
        _finalize_job(
            claimed_job=claimed_job,
            result=result,
            worker_id=worker_id,
            hostname=hostname,
            version=version,
            queues=queues,
        )
        if once:
            break

    logger.info("Job worker stopping: worker_id=%s", worker_id)


def start_background_worker_thread() -> None:
    global _worker_thread, _worker_stop_event
    if _worker_thread and _worker_thread.is_alive():
        return
    _worker_stop_event = Event()
    _worker_thread = Thread(
        target=run_loop,
        kwargs={
            "stop_event": _worker_stop_event,
            "once": False,
            "poll_seconds": float(os.getenv("JOB_WORKER_POLL_SECONDS") or _DEFAULT_POLL_SECONDS),
            "lease_seconds": int(os.getenv("JOB_WORKER_LEASE_SECONDS") or _DEFAULT_LEASE_SECONDS),
        },
        name="zoltag-job-worker",
        daemon=True,
    )
    _worker_thread.start()
    logger.info("Started background job worker thread")


def stop_background_worker_thread(timeout_seconds: float = 10.0) -> None:
    global _worker_thread, _worker_stop_event
    if _worker_stop_event:
        _worker_stop_event.set()
    if _worker_thread and _worker_thread.is_alive():
        _worker_thread.join(timeout=timeout_seconds)
    _worker_thread = None
    _worker_stop_event = None
    logger.info("Stopped background job worker thread")


def main() -> None:
    logging.basicConfig(
        level=getattr(logging, str(os.getenv("JOB_WORKER_LOG_LEVEL") or "INFO").upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    run_loop(
        once=_to_bool(os.getenv("JOB_WORKER_ONCE")),
        poll_seconds=float(os.getenv("JOB_WORKER_POLL_SECONDS") or _DEFAULT_POLL_SECONDS),
        lease_seconds=int(os.getenv("JOB_WORKER_LEASE_SECONDS") or _DEFAULT_LEASE_SECONDS),
    )


if __name__ == "__main__":
    main()
