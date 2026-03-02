"""Sentinel tick for queue maintenance and burst worker dispatch."""

from __future__ import annotations

import logging
import time
from datetime import timezone
from typing import Any

from sqlalchemy import func

from zoltag.database import SessionLocal
from zoltag.metadata import Job
from zoltag.settings import settings
from zoltag.worker import _fire_due_schedule_triggers, _now_utc, _reclaim_stale_leases, _reconcile_workflows_once

logger = logging.getLogger(__name__)


def _resolve_worker_project() -> str:
    return str(settings.sentinel_worker_project_id or settings.gcp_project_id or "").strip()


def _resolve_worker_region() -> str:
    return str(settings.sentinel_worker_region or settings.gcp_region or "").strip()


def _run_cloud_run_job(*, job_name: str, task_count: int, dry_run: bool = False) -> dict[str, Any]:
    project_id = _resolve_worker_project()
    region = _resolve_worker_region()
    if not job_name or not project_id or not region:
        raise ValueError("Sentinel dispatch is missing worker job/project/region configuration")

    request_body = {
        "overrides": {
            "taskCount": int(task_count),
        }
    }
    endpoint = f"https://run.googleapis.com/v2/projects/{project_id}/locations/{region}/jobs/{job_name}:run"

    if dry_run:
        return {
            "status": "dry_run",
            "endpoint": endpoint,
            "request": request_body,
        }

    try:
        import google.auth
        from google.auth.transport.requests import AuthorizedSession
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"google-auth client not available for sentinel dispatch: {exc}") from exc

    creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    authed = AuthorizedSession(creds)
    timeout_seconds = max(5, int(settings.sentinel_dispatch_request_timeout_seconds or 20))

    response = authed.post(endpoint, json=request_body, timeout=timeout_seconds)
    if response.status_code < 200 or response.status_code >= 300:
        body_preview = (response.text or "").strip()
        if len(body_preview) > 500:
            body_preview = f"{body_preview[:500]}..."
        raise RuntimeError(
            f"Cloud Run Job dispatch failed ({response.status_code}): {body_preview or 'no response body'}"
        )

    payload = response.json() if response.content else {}
    return {
        "status": "launched",
        "operation_name": str(payload.get("name") or "").strip() or None,
        "endpoint": endpoint,
        "request": request_body,
    }


def _collect_queue_snapshot() -> dict[str, Any]:
    db = SessionLocal()
    try:
        now = _now_utc()
        queued_ready = int(
            db.query(func.count(Job.id))
            .filter(
                Job.status == "queued",
                Job.scheduled_for <= now,
            )
            .scalar()
            or 0
        )
        running = int(
            db.query(func.count(Job.id))
            .filter(Job.status == "running")
            .scalar()
            or 0
        )
        oldest_ready = (
            db.query(func.min(Job.queued_at))
            .filter(
                Job.status == "queued",
                Job.scheduled_for <= now,
            )
            .scalar()
        )
        oldest_age_seconds: float | None = None
        if oldest_ready is not None:
            if getattr(oldest_ready, "tzinfo", None) is None:
                oldest_ready = oldest_ready.replace(tzinfo=timezone.utc)
            oldest_age_seconds = max(0.0, (now - oldest_ready).total_seconds())

        return {
            "queued_ready": queued_ready,
            "running": running,
            "oldest_ready_age_seconds": oldest_age_seconds,
        }
    finally:
        db.close()


def run_sentinel_tick(*, dry_run: bool = False) -> dict[str, Any]:
    """Execute one sentinel tick.

    Responsibilities:
    - reclaim stale leases
    - reconcile workflow runs
    - fire due schedule triggers
    - dispatch one-shot worker job tasks when queue has pending work
    """
    started = time.monotonic()
    maintenance_errors: list[str] = []
    maintenance: dict[str, str] = {}

    if bool(settings.sentinel_enable_lease_reclaim):
        try:
            _reclaim_stale_leases()
            maintenance["lease_reclaim"] = "ok"
        except Exception as exc:  # noqa: BLE001
            maintenance["lease_reclaim"] = "error"
            maintenance_errors.append(f"lease_reclaim: {exc}")
            logger.exception("Sentinel lease reclaim failed")

    if bool(settings.sentinel_enable_workflow_reconcile):
        try:
            _reconcile_workflows_once(limit_runs=max(1, int(settings.sentinel_workflow_reconcile_limit or 25)))
            maintenance["workflow_reconcile"] = "ok"
        except Exception as exc:  # noqa: BLE001
            maintenance["workflow_reconcile"] = "error"
            maintenance_errors.append(f"workflow_reconcile: {exc}")
            logger.exception("Sentinel workflow reconcile failed")

    if bool(settings.sentinel_enable_schedule_tick):
        try:
            _fire_due_schedule_triggers()
            maintenance["schedule_tick"] = "ok"
        except Exception as exc:  # noqa: BLE001
            maintenance["schedule_tick"] = "error"
            maintenance_errors.append(f"schedule_tick: {exc}")
            logger.exception("Sentinel schedule tick failed")

    queue = _collect_queue_snapshot()
    max_parallel = max(1, int(settings.sentinel_worker_max_parallel or 8))
    max_dispatch = max(1, int(settings.sentinel_worker_max_dispatch_per_tick or 4))
    desired_parallel = min(int(queue["queued_ready"]), max_parallel)
    requested_dispatch = max(0, desired_parallel - int(queue["running"]))
    dispatch_count = min(requested_dispatch, max_dispatch)

    dispatch: dict[str, Any] = {
        "enabled": bool(settings.sentinel_dispatch_enabled),
        "requested_dispatch": requested_dispatch,
        "dispatch_count": dispatch_count,
        "max_parallel": max_parallel,
        "max_dispatch_per_tick": max_dispatch,
        "worker_job_name": str(settings.sentinel_worker_job_name or "").strip() or None,
        "status": "idle",
    }

    if dispatch_count <= 0:
        dispatch["status"] = "no_dispatch_needed"
    elif not bool(settings.sentinel_dispatch_enabled):
        dispatch["status"] = "dispatch_disabled"
    else:
        worker_job_name = str(settings.sentinel_worker_job_name or "").strip()
        if not worker_job_name:
            dispatch["status"] = "misconfigured"
            maintenance_errors.append("dispatch: SENTINEL_WORKER_JOB_NAME is required when dispatch is enabled")
        else:
            try:
                dispatch_result = _run_cloud_run_job(
                    job_name=worker_job_name,
                    task_count=dispatch_count,
                    dry_run=bool(dry_run),
                )
                dispatch.update(dispatch_result)
            except Exception as exc:  # noqa: BLE001
                dispatch["status"] = "error"
                dispatch["error"] = str(exc)
                maintenance_errors.append(f"dispatch: {exc}")
                logger.exception("Sentinel dispatch failed")

    duration_ms = int((time.monotonic() - started) * 1000)
    result = {
        "ok": len(maintenance_errors) == 0,
        "dry_run": bool(dry_run),
        "maintenance": maintenance,
        "queue": queue,
        "dispatch": dispatch,
        "errors": maintenance_errors,
        "duration_ms": duration_ms,
        "timestamp": _now_utc().isoformat(),
    }

    logger.info(
        "Sentinel tick completed: ok=%s queued_ready=%s running=%s dispatch=%s duration_ms=%s",
        result["ok"],
        queue.get("queued_ready"),
        queue.get("running"),
        dispatch.get("status"),
        duration_ms,
    )
    return result
