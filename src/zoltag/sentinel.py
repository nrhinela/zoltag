"""Sentinel tick for queue maintenance and burst worker dispatch."""

from __future__ import annotations

import logging
import time
from datetime import timezone
from typing import Any

from sqlalchemy import func

from zoltag.database import SessionLocal
from zoltag.job_profiles import RUN_PROFILE_LIGHT, RUN_PROFILE_ML
from zoltag.metadata import Job
from zoltag.settings import settings
from zoltag.worker import _fire_due_schedule_triggers, _now_utc, _reclaim_stale_leases, _reconcile_workflows_once

logger = logging.getLogger(__name__)
_RUN_PROFILES = (RUN_PROFILE_LIGHT, RUN_PROFILE_ML)


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


def _resolve_worker_job_name(profile: str) -> str:
    if profile == RUN_PROFILE_ML:
        return str(settings.sentinel_worker_ml_job_name or settings.sentinel_worker_job_name or "").strip()
    return str(settings.sentinel_worker_light_job_name or settings.sentinel_worker_job_name or "").strip()


def _resolve_profile_limits(profile: str) -> tuple[int, int]:
    if profile == RUN_PROFILE_ML:
        max_parallel = int(settings.sentinel_worker_ml_max_parallel or settings.sentinel_worker_max_parallel or 2)
        max_dispatch = int(
            settings.sentinel_worker_ml_max_dispatch_per_tick
            or settings.sentinel_worker_max_dispatch_per_tick
            or 1
        )
    else:
        max_parallel = int(settings.sentinel_worker_light_max_parallel or settings.sentinel_worker_max_parallel or 8)
        max_dispatch = int(
            settings.sentinel_worker_light_max_dispatch_per_tick
            or settings.sentinel_worker_max_dispatch_per_tick
            or 4
        )
    return max(1, max_parallel), max(1, max_dispatch)


def _collect_queue_snapshot() -> dict[str, Any]:
    db = SessionLocal()
    try:
        now = _now_utc()
        by_profile: dict[str, dict[str, Any]] = {}
        for profile in _RUN_PROFILES:
            queued_ready = int(
                db.query(func.count(Job.id))
                .filter(
                    Job.status == "queued",
                    Job.run_profile == profile,
                    Job.scheduled_for <= now,
                )
                .scalar()
                or 0
            )
            running = int(
                db.query(func.count(Job.id))
                .filter(
                    Job.status == "running",
                    Job.run_profile == profile,
                )
                .scalar()
                or 0
            )
            oldest_ready = (
                db.query(func.min(Job.queued_at))
                .filter(
                    Job.status == "queued",
                    Job.run_profile == profile,
                    Job.scheduled_for <= now,
                )
                .scalar()
            )
            oldest_age_seconds: float | None = None
            if oldest_ready is not None:
                if getattr(oldest_ready, "tzinfo", None) is None:
                    oldest_ready = oldest_ready.replace(tzinfo=timezone.utc)
                oldest_age_seconds = max(0.0, (now - oldest_ready).total_seconds())
            by_profile[profile] = {
                "queued_ready": queued_ready,
                "running": running,
                "oldest_ready_age_seconds": oldest_age_seconds,
            }

        return {
            "queued_ready": sum(int(by_profile[p]["queued_ready"]) for p in _RUN_PROFILES),
            "running": sum(int(by_profile[p]["running"]) for p in _RUN_PROFILES),
            "profiles": by_profile,
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
    dispatch_profiles: dict[str, dict[str, Any]] = {}
    enabled = bool(settings.sentinel_dispatch_enabled)
    for profile in _RUN_PROFILES:
        queue_snapshot = queue.get("profiles", {}).get(profile, {})
        queued_ready = int(queue_snapshot.get("queued_ready") or 0)
        running = int(queue_snapshot.get("running") or 0)
        max_parallel, max_dispatch = _resolve_profile_limits(profile)
        desired_parallel = min(queued_ready, max_parallel)
        requested_dispatch = max(0, desired_parallel - running)
        dispatch_count = min(requested_dispatch, max_dispatch)
        worker_job_name = _resolve_worker_job_name(profile)

        dispatch_entry: dict[str, Any] = {
            "enabled": enabled,
            "requested_dispatch": requested_dispatch,
            "dispatch_count": dispatch_count,
            "max_parallel": max_parallel,
            "max_dispatch_per_tick": max_dispatch,
            "worker_job_name": worker_job_name or None,
            "status": "idle",
        }
        if dispatch_count <= 0:
            dispatch_entry["status"] = "no_dispatch_needed"
        elif not enabled:
            dispatch_entry["status"] = "dispatch_disabled"
        elif not worker_job_name:
            dispatch_entry["status"] = "misconfigured"
            maintenance_errors.append(f"dispatch[{profile}]: worker job name is required when dispatch is enabled")
        else:
            try:
                dispatch_result = _run_cloud_run_job(
                    job_name=worker_job_name,
                    task_count=dispatch_count,
                    dry_run=bool(dry_run),
                )
                dispatch_entry.update(dispatch_result)
            except Exception as exc:  # noqa: BLE001
                dispatch_entry["status"] = "error"
                dispatch_entry["error"] = str(exc)
                maintenance_errors.append(f"dispatch[{profile}]: {exc}")
                logger.exception("Sentinel dispatch failed for profile=%s", profile)
        dispatch_profiles[profile] = dispatch_entry

    statuses = {str(entry.get("status") or "") for entry in dispatch_profiles.values()}
    if "error" in statuses:
        aggregate_status = "error"
    elif "misconfigured" in statuses:
        aggregate_status = "misconfigured"
    elif "launched" in statuses:
        aggregate_status = "launched"
    elif statuses == {"dispatch_disabled"}:
        aggregate_status = "dispatch_disabled"
    else:
        aggregate_status = "no_dispatch_needed"
    dispatch: dict[str, Any] = {
        "enabled": enabled,
        "status": aggregate_status,
        "profiles": dispatch_profiles,
    }

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
        "Sentinel tick completed: ok=%s queued_ready=%s running=%s dispatch=%s dispatch_light=%s dispatch_ml=%s duration_ms=%s",
        result["ok"],
        queue.get("queued_ready"),
        queue.get("running"),
        dispatch.get("status"),
        dispatch_profiles.get(RUN_PROFILE_LIGHT, {}).get("status"),
        dispatch_profiles.get(RUN_PROFILE_ML, {}).get("status"),
        duration_ms,
    )
    return result
