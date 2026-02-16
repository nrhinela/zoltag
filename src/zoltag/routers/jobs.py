"""Tenant-scoped job queue endpoints."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from zoltag.auth.dependencies import require_super_admin, require_tenant_role_from_header
from zoltag.auth.models import UserProfile
from zoltag.cli.introspection import (
    build_payload_schema_for_command,
    get_cli_command_metadata,
    normalize_queue_payload,
)
from zoltag.database import get_db
from zoltag.dependencies import get_tenant
from zoltag.metadata import (
    Job,
    JobAttempt,
    JobDefinition,
    JobTrigger,
    JobWorker,
    WorkflowDefinition,
    WorkflowRun,
    WorkflowStepRun,
)
from zoltag.tenant import Tenant
from zoltag.tenant_scope import tenant_column_filter
from zoltag.workflow_queue import (
    cancel_workflow_run,
    handle_workflow_job_state_change,
    mark_workflow_step_running,
    parse_workflow_source_ref,
    reconcile_running_workflows,
    start_workflow_run,
    validate_workflow_steps,
)

router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"])

_VALID_JOB_STATUSES = {"queued", "running", "succeeded", "failed", "canceled", "dead_letter"}
_VALID_JOB_SOURCES = {"manual", "event", "schedule", "system"}
_VALID_ATTEMPT_STATUSES = {"running", "succeeded", "failed", "timeout", "canceled"}
_VALID_RETRY_FROM_STATUSES = {"failed", "dead_letter", "canceled"}
_VALID_TRIGGER_TYPES = {"event", "schedule"}
_VALID_WORKFLOW_STATUSES = {"running", "succeeded", "failed", "canceled"}
_VALID_WORKFLOW_FAILURE_POLICIES = {"fail_fast", "continue"}


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _parse_uuid_or_400(raw_value: str) -> UUID:
    try:
        return UUID(str(raw_value))
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(status_code=400, detail="Invalid UUID format")


def _require_queue_command_key(key: str) -> dict:
    command_key = str(key or "").strip()
    command_meta = get_cli_command_metadata(command_key)
    if not command_meta:
        raise HTTPException(status_code=400, detail=f"key must match an existing CLI command: {command_key}")
    if not command_meta.get("queue_eligible"):
        raise HTTPException(
            status_code=400,
            detail=f"CLI command is not queue-eligible (missing --tenant-id): {command_key}",
        )
    return command_meta


def _serialize_job(job: Job) -> dict:
    definition = getattr(job, "definition", None)
    return {
        "id": str(job.id),
        "tenant_id": str(job.tenant_id),
        "definition_id": str(job.definition_id),
        "definition_key": str(getattr(definition, "key", "") or ""),
        "source": job.source,
        "source_ref": job.source_ref,
        "status": job.status,
        "priority": job.priority,
        "payload": job.payload or {},
        "dedupe_key": job.dedupe_key,
        "correlation_id": job.correlation_id,
        "scheduled_for": job.scheduled_for,
        "queued_at": job.queued_at,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
        "attempt_count": job.attempt_count,
        "max_attempts": job.max_attempts,
        "lease_expires_at": job.lease_expires_at,
        "claimed_by_worker": job.claimed_by_worker,
        "last_error": job.last_error,
        "created_by": str(job.created_by) if job.created_by else None,
    }


def _serialize_attempt(attempt: JobAttempt) -> dict:
    return {
        "id": str(attempt.id),
        "job_id": str(attempt.job_id),
        "attempt_no": attempt.attempt_no,
        "worker_id": attempt.worker_id,
        "pid": attempt.pid,
        "started_at": attempt.started_at,
        "finished_at": attempt.finished_at,
        "exit_code": attempt.exit_code,
        "status": attempt.status,
        "stdout_tail": attempt.stdout_tail,
        "stderr_tail": attempt.stderr_tail,
        "error_text": attempt.error_text,
    }


def _serialize_definition(definition: JobDefinition) -> dict:
    cli_command = get_cli_command_metadata(str(definition.key or "").strip())
    computed_schema = build_payload_schema_for_command(str(definition.key or "").strip())
    return {
        "id": str(definition.id),
        "key": definition.key,
        "description": definition.description,
        "arg_schema": computed_schema or definition.arg_schema or {},
        "cli_command": cli_command,
        "timeout_seconds": definition.timeout_seconds,
        "max_attempts": definition.max_attempts,
        "is_active": definition.is_active,
        "created_at": definition.created_at,
        "updated_at": definition.updated_at,
    }


def _serialize_trigger(trigger: JobTrigger) -> dict:
    definition = getattr(trigger, "definition", None)
    return {
        "id": str(trigger.id),
        "tenant_id": str(trigger.tenant_id) if trigger.tenant_id else None,
        "label": trigger.label,
        "is_enabled": trigger.is_enabled,
        "trigger_type": trigger.trigger_type,
        "event_name": trigger.event_name,
        "cron_expr": trigger.cron_expr,
        "timezone": trigger.timezone,
        "definition_id": str(trigger.definition_id),
        "definition_key": str(getattr(definition, "key", "") or ""),
        "payload_template": trigger.payload_template or {},
        "dedupe_window_seconds": trigger.dedupe_window_seconds,
        "created_by": str(trigger.created_by) if trigger.created_by else None,
        "created_at": trigger.created_at,
        "updated_at": trigger.updated_at,
    }


def _serialize_workflow_definition(definition: WorkflowDefinition) -> dict:
    return {
        "id": str(definition.id),
        "key": str(definition.key or ""),
        "description": str(definition.description or ""),
        "steps": list(definition.steps or []),
        "max_parallel_steps": int(definition.max_parallel_steps or 1),
        "failure_policy": str(definition.failure_policy or "fail_fast"),
        "is_active": bool(definition.is_active),
        "created_at": definition.created_at,
        "updated_at": definition.updated_at,
    }


def _serialize_workflow_step_run(step_run: WorkflowStepRun) -> dict:
    definition = getattr(step_run, "definition", None)
    child_job = getattr(step_run, "child_job", None)
    return {
        "id": str(step_run.id),
        "step_key": str(step_run.step_key or ""),
        "definition_id": str(step_run.definition_id),
        "definition_key": str(getattr(definition, "key", "") or ""),
        "status": str(step_run.status or ""),
        "payload": step_run.payload or {},
        "depends_on": list(step_run.depends_on or []),
        "child_job_id": str(step_run.child_job_id) if step_run.child_job_id else None,
        "child_job_status": str(getattr(child_job, "status", "") or ""),
        "queued_at": step_run.queued_at,
        "started_at": step_run.started_at,
        "finished_at": step_run.finished_at,
        "last_error": step_run.last_error,
    }


def _serialize_workflow_run(run: WorkflowRun, *, include_steps: bool = True) -> dict:
    definition = getattr(run, "definition", None)
    payload = {
        "id": str(run.id),
        "tenant_id": str(run.tenant_id),
        "workflow_definition_id": str(run.workflow_definition_id),
        "workflow_key": str(getattr(definition, "key", "") or ""),
        "workflow_description": str(getattr(definition, "description", "") or ""),
        "status": str(run.status or ""),
        "payload": run.payload or {},
        "priority": int(run.priority or 100),
        "max_parallel_steps": int(run.max_parallel_steps or 1),
        "failure_policy": str(run.failure_policy or "fail_fast"),
        "queued_at": run.queued_at,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
        "created_by": str(run.created_by) if run.created_by else None,
        "last_error": run.last_error,
    }
    if include_steps:
        step_runs = list(getattr(run, "step_runs", []) or [])
        payload["steps"] = [_serialize_workflow_step_run(step) for step in step_runs]
    return payload


def _parse_iso_datetime(value) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value).strip()
        if not text:
            return None
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid datetime format")
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _to_int(value, *, default: int, minimum: int | None = None, maximum: int | None = None, field_name: str = "value") -> int:
    if value is None:
        result = default
    else:
        try:
            result = int(value)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"Invalid integer for {field_name}")
    if minimum is not None and result < minimum:
        raise HTTPException(status_code=400, detail=f"{field_name} must be >= {minimum}")
    if maximum is not None and result > maximum:
        raise HTTPException(status_code=400, detail=f"{field_name} must be <= {maximum}")
    return result


def _upsert_worker_heartbeat(
    db: Session,
    *,
    worker_id: str,
    hostname: str,
    version: str,
    queues: list[str],
    running_count: int,
    metadata_json: dict,
) -> None:
    stmt = pg_insert(JobWorker).values(
        worker_id=worker_id,
        hostname=hostname,
        version=version,
        queues=queues,
        last_seen_at=_now_utc(),
        running_count=running_count,
        metadata_json=metadata_json or {},
    ).on_conflict_do_update(
        index_elements=[JobWorker.worker_id],
        set_={
            "hostname": hostname,
            "version": version,
            "queues": queues,
            "last_seen_at": _now_utc(),
            "running_count": running_count,
            "metadata": metadata_json or {},
        },
    )
    db.execute(stmt)


def _job_or_404(db: Session, tenant: Tenant, job_id: str) -> Job:
    parsed_job_id = _parse_uuid_or_400(job_id)
    job = db.query(Job).options(joinedload(Job.definition)).filter(
        Job.id == parsed_job_id,
        tenant_column_filter(Job, tenant),
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def _workflow_run_or_404(db: Session, tenant: Tenant, run_id: str) -> WorkflowRun:
    parsed_run_id = _parse_uuid_or_400(run_id)
    run = (
        db.query(WorkflowRun)
        .options(
            joinedload(WorkflowRun.definition),
            joinedload(WorkflowRun.step_runs).joinedload(WorkflowStepRun.definition),
            joinedload(WorkflowRun.step_runs).joinedload(WorkflowStepRun.child_job),
        )
        .filter(
            WorkflowRun.id == parsed_run_id,
            tenant_column_filter(WorkflowRun, tenant),
        )
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Workflow run not found")
    return run


@router.get("/definitions")
async def list_job_definitions(
    include_inactive: bool = Query(default=False),
    _super_admin: UserProfile = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """List allowlisted job definitions (super-admin)."""
    query = db.query(JobDefinition)
    if not include_inactive:
        query = query.filter(JobDefinition.is_active.is_(True))
    rows = query.order_by(JobDefinition.key.asc()).all()
    return {"definitions": [_serialize_definition(row) for row in rows]}


@router.get("/catalog")
async def list_job_catalog(
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_role_from_header("admin")),
    db: Session = Depends(get_db),
):
    """List active job definitions for tenant enqueue UI."""
    _ = tenant
    rows = db.query(JobDefinition).filter(
        JobDefinition.is_active.is_(True)
    ).order_by(JobDefinition.key.asc()).all()
    serialized = [_serialize_definition(row) for row in rows]
    definitions = [
        row
        for row in serialized
        if isinstance(row.get("cli_command"), dict) and bool(row["cli_command"].get("queue_eligible"))
    ]
    return {"definitions": definitions}


@router.post("/definitions")
async def create_job_definition(
    body: dict = Body(default_factory=dict),
    _super_admin: UserProfile = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Create a job definition (super-admin)."""
    key = str((body or {}).get("key") or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="key is required")
    command_meta = _require_queue_command_key(key)
    description = str((body or {}).get("description") or "").strip() or str(command_meta.get("help") or "").strip()
    arg_schema = build_payload_schema_for_command(key) or {}
    timeout_seconds = _to_int((body or {}).get("timeout_seconds"), default=3600, minimum=1, maximum=86400, field_name="timeout_seconds")
    max_attempts = _to_int((body or {}).get("max_attempts"), default=3, minimum=1, maximum=100, field_name="max_attempts")
    is_active = bool((body or {}).get("is_active", True))

    row = JobDefinition(
        key=key,
        description=description,
        arg_schema=arg_schema,
        timeout_seconds=timeout_seconds,
        max_attempts=max_attempts,
        is_active=is_active,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Job definition key already exists")
    db.refresh(row)
    return _serialize_definition(row)


@router.patch("/definitions/{definition_id}")
async def update_job_definition(
    definition_id: str,
    body: dict = Body(default_factory=dict),
    _super_admin: UserProfile = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Update a job definition (super-admin)."""
    parsed_definition_id = _parse_uuid_or_400(definition_id)
    row = db.query(JobDefinition).filter(JobDefinition.id == parsed_definition_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Job definition not found")

    if "key" in (body or {}):
        key = str((body or {}).get("key") or "").strip()
        if not key:
            raise HTTPException(status_code=400, detail="key cannot be empty")
        _require_queue_command_key(key)
        row.key = key
    if "description" in (body or {}):
        row.description = str((body or {}).get("description") or "").strip()
    row.arg_schema = build_payload_schema_for_command(str(row.key or "").strip()) or {}
    if "timeout_seconds" in (body or {}):
        row.timeout_seconds = _to_int((body or {}).get("timeout_seconds"), default=row.timeout_seconds, minimum=1, maximum=86400, field_name="timeout_seconds")
    if "max_attempts" in (body or {}):
        row.max_attempts = _to_int((body or {}).get("max_attempts"), default=row.max_attempts, minimum=1, maximum=100, field_name="max_attempts")
    if "is_active" in (body or {}):
        row.is_active = bool((body or {}).get("is_active"))
    row.updated_at = _now_utc()
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Job definition key already exists")
    db.refresh(row)
    return _serialize_definition(row)


@router.post("")
async def enqueue_job(
    body: dict = Body(default_factory=dict),
    tenant: Tenant = Depends(get_tenant),
    admin: UserProfile = Depends(require_tenant_role_from_header("admin")),
    db: Session = Depends(get_db),
):
    """Enqueue a manual job for the current tenant."""
    definition_key = str((body or {}).get("definition_key") or "").strip()
    if not definition_key:
        raise HTTPException(status_code=400, detail="definition_key is required")

    payload = (body or {}).get("payload")
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="payload must be an object")

    definition = db.query(JobDefinition).filter(
        JobDefinition.key == definition_key,
        JobDefinition.is_active.is_(True),
    ).first()
    if not definition:
        raise HTTPException(status_code=404, detail="Active job definition not found")
    try:
        payload = normalize_queue_payload(str(definition.key or "").strip(), payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    priority = _to_int((body or {}).get("priority"), default=100, minimum=0, maximum=100000, field_name="priority")
    max_attempts = _to_int(
        (body or {}).get("max_attempts"),
        default=int(definition.max_attempts or 3),
        minimum=1,
        maximum=100,
        field_name="max_attempts",
    )
    scheduled_for = _parse_iso_datetime((body or {}).get("scheduled_for")) or _now_utc()
    dedupe_key = str((body or {}).get("dedupe_key") or "").strip() or None
    correlation_id = str((body or {}).get("correlation_id") or "").strip() or None

    job = Job(
        tenant_id=UUID(str(tenant.id)),
        definition_id=definition.id,
        source="manual",
        status="queued",
        priority=priority,
        payload=payload,
        dedupe_key=dedupe_key,
        correlation_id=correlation_id,
        scheduled_for=scheduled_for,
        queued_at=_now_utc(),
        max_attempts=max_attempts,
        created_by=admin.supabase_uid,
    )
    db.add(job)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Job dedupe key already queued/running for tenant")
    db.refresh(job)
    job.definition = definition
    return _serialize_job(job)


@router.get("/triggers")
async def list_job_triggers(
    include_disabled: bool = Query(default=False),
    _super_admin: UserProfile = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """List global job triggers (super-admin)."""
    query = db.query(JobTrigger).options(joinedload(JobTrigger.definition)).filter(
        JobTrigger.tenant_id.is_(None)
    )
    if not include_disabled:
        query = query.filter(JobTrigger.is_enabled.is_(True))
    rows = query.order_by(JobTrigger.created_at.desc()).all()
    return {"scope": "global", "triggers": [_serialize_trigger(row) for row in rows]}


@router.post("/triggers")
async def create_job_trigger(
    body: dict = Body(default_factory=dict),
    admin: UserProfile = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Create global trigger for event/schedule-driven enqueue (super-admin)."""
    trigger_type = str((body or {}).get("trigger_type") or "").strip().lower()
    if trigger_type not in _VALID_TRIGGER_TYPES:
        raise HTTPException(status_code=400, detail="trigger_type must be event or schedule")

    label = str((body or {}).get("label") or "").strip()
    if not label:
        raise HTTPException(status_code=400, detail="label is required")

    definition_key = str((body or {}).get("definition_key") or "").strip()
    definition_id = str((body or {}).get("definition_id") or "").strip()
    definition = None
    if definition_key:
        definition = db.query(JobDefinition).filter(
            JobDefinition.key == definition_key,
            JobDefinition.is_active.is_(True),
        ).first()
    elif definition_id:
        parsed_definition_id = _parse_uuid_or_400(definition_id)
        definition = db.query(JobDefinition).filter(
            JobDefinition.id == parsed_definition_id,
            JobDefinition.is_active.is_(True),
        ).first()
    else:
        raise HTTPException(status_code=400, detail="definition_key or definition_id is required")
    if not definition:
        raise HTTPException(status_code=404, detail="Active job definition not found")

    payload_template = (body or {}).get("payload_template") or {}
    if not isinstance(payload_template, dict):
        raise HTTPException(status_code=400, detail="payload_template must be an object")

    event_name = None
    cron_expr = None
    timezone_name = None
    if trigger_type == "event":
        event_name = str((body or {}).get("event_name") or "").strip()
        if not event_name:
            raise HTTPException(status_code=400, detail="event_name is required for event trigger")
    else:
        cron_expr = str((body or {}).get("cron_expr") or "").strip()
        timezone_name = str((body or {}).get("timezone") or "").strip()
        if not cron_expr or not timezone_name:
            raise HTTPException(status_code=400, detail="cron_expr and timezone are required for schedule trigger")

    row = JobTrigger(
        tenant_id=None,
        label=label,
        is_enabled=bool((body or {}).get("is_enabled", True)),
        trigger_type=trigger_type,
        event_name=event_name,
        cron_expr=cron_expr,
        timezone=timezone_name,
        definition_id=definition.id,
        payload_template=payload_template,
        dedupe_window_seconds=_to_int(
            (body or {}).get("dedupe_window_seconds"),
            default=300,
            minimum=0,
            maximum=86400,
            field_name="dedupe_window_seconds",
        ),
        created_by=admin.supabase_uid,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    row.definition = definition
    return _serialize_trigger(row)


@router.patch("/triggers/{trigger_id}")
async def update_job_trigger(
    trigger_id: str,
    body: dict = Body(default_factory=dict),
    _admin: UserProfile = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Update global trigger (super-admin)."""
    parsed_trigger_id = _parse_uuid_or_400(trigger_id)
    row = db.query(JobTrigger).options(joinedload(JobTrigger.definition)).filter(
        JobTrigger.id == parsed_trigger_id,
        JobTrigger.tenant_id.is_(None),
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Trigger not found")

    if "label" in (body or {}):
        label = str((body or {}).get("label") or "").strip()
        if not label:
            raise HTTPException(status_code=400, detail="label cannot be empty")
        row.label = label
    if "is_enabled" in (body or {}):
        row.is_enabled = bool((body or {}).get("is_enabled"))
    if "payload_template" in (body or {}):
        payload_template = (body or {}).get("payload_template")
        if not isinstance(payload_template, dict):
            raise HTTPException(status_code=400, detail="payload_template must be an object")
        row.payload_template = payload_template
    if "dedupe_window_seconds" in (body or {}):
        row.dedupe_window_seconds = _to_int(
            (body or {}).get("dedupe_window_seconds"),
            default=row.dedupe_window_seconds,
            minimum=0,
            maximum=86400,
            field_name="dedupe_window_seconds",
        )
    if row.trigger_type == "event" and "event_name" in (body or {}):
        event_name = str((body or {}).get("event_name") or "").strip()
        if not event_name:
            raise HTTPException(status_code=400, detail="event_name cannot be empty")
        row.event_name = event_name
    if row.trigger_type == "schedule":
        if "cron_expr" in (body or {}):
            cron_expr = str((body or {}).get("cron_expr") or "").strip()
            if not cron_expr:
                raise HTTPException(status_code=400, detail="cron_expr cannot be empty")
            row.cron_expr = cron_expr
        if "timezone" in (body or {}):
            timezone_name = str((body or {}).get("timezone") or "").strip()
            if not timezone_name:
                raise HTTPException(status_code=400, detail="timezone cannot be empty")
            row.timezone = timezone_name

    if "definition_key" in (body or {}) or "definition_id" in (body or {}):
        next_definition = None
        definition_key = str((body or {}).get("definition_key") or "").strip()
        definition_id = str((body or {}).get("definition_id") or "").strip()
        if definition_key:
            next_definition = db.query(JobDefinition).filter(
                JobDefinition.key == definition_key,
                JobDefinition.is_active.is_(True),
            ).first()
        elif definition_id:
            parsed_definition_id = _parse_uuid_or_400(definition_id)
            next_definition = db.query(JobDefinition).filter(
                JobDefinition.id == parsed_definition_id,
                JobDefinition.is_active.is_(True),
            ).first()
        if not next_definition:
            raise HTTPException(status_code=404, detail="Active job definition not found")
        row.definition_id = next_definition.id
        row.definition = next_definition

    row.updated_at = _now_utc()
    db.commit()
    db.refresh(row)
    return _serialize_trigger(row)


@router.delete("/triggers/{trigger_id}")
async def delete_job_trigger(
    trigger_id: str,
    _admin: UserProfile = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Delete global trigger (super-admin)."""
    parsed_trigger_id = _parse_uuid_or_400(trigger_id)
    row = db.query(JobTrigger).filter(
        JobTrigger.id == parsed_trigger_id,
        JobTrigger.tenant_id.is_(None),
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Trigger not found")
    db.delete(row)
    db.commit()
    return {"deleted": True, "trigger_id": str(parsed_trigger_id)}


@router.get("/workflows")
async def list_workflow_definitions(
    include_inactive: bool = Query(default=False),
    _super_admin: UserProfile = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """List global workflow definitions (super-admin)."""
    query = db.query(WorkflowDefinition)
    if not include_inactive:
        query = query.filter(WorkflowDefinition.is_active.is_(True))
    rows = query.order_by(WorkflowDefinition.key.asc()).all()
    return {"workflows": [_serialize_workflow_definition(row) for row in rows]}


@router.post("/workflows")
async def create_workflow_definition(
    body: dict = Body(default_factory=dict),
    _super_admin: UserProfile = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Create a global workflow definition (super-admin)."""
    key = str((body or {}).get("key") or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="key is required")
    description = str((body or {}).get("description") or "").strip()
    steps = (body or {}).get("steps")
    try:
        validated_steps = validate_workflow_steps(db, steps or [], require_active_definitions=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    failure_policy = str((body or {}).get("failure_policy") or "fail_fast").strip().lower()
    if failure_policy not in _VALID_WORKFLOW_FAILURE_POLICIES:
        raise HTTPException(status_code=400, detail="failure_policy must be fail_fast or continue")
    max_parallel_steps = _to_int(
        (body or {}).get("max_parallel_steps"),
        default=2,
        minimum=1,
        maximum=64,
        field_name="max_parallel_steps",
    )
    row = WorkflowDefinition(
        key=key,
        description=description,
        steps=validated_steps,
        max_parallel_steps=max_parallel_steps,
        failure_policy=failure_policy,
        is_active=bool((body or {}).get("is_active", True)),
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Workflow key already exists")
    db.refresh(row)
    return _serialize_workflow_definition(row)


@router.patch("/workflows/{workflow_id}")
async def update_workflow_definition(
    workflow_id: str,
    body: dict = Body(default_factory=dict),
    _super_admin: UserProfile = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Update a global workflow definition (super-admin)."""
    parsed_id = _parse_uuid_or_400(workflow_id)
    row = db.query(WorkflowDefinition).filter(WorkflowDefinition.id == parsed_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Workflow definition not found")

    if "key" in (body or {}):
        key = str((body or {}).get("key") or "").strip()
        if not key:
            raise HTTPException(status_code=400, detail="key cannot be empty")
        row.key = key
    if "description" in (body or {}):
        row.description = str((body or {}).get("description") or "").strip()
    if "steps" in (body or {}):
        try:
            row.steps = validate_workflow_steps(db, (body or {}).get("steps") or [], require_active_definitions=True)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
    if "failure_policy" in (body or {}):
        failure_policy = str((body or {}).get("failure_policy") or "").strip().lower()
        if failure_policy not in _VALID_WORKFLOW_FAILURE_POLICIES:
            raise HTTPException(status_code=400, detail="failure_policy must be fail_fast or continue")
        row.failure_policy = failure_policy
    if "max_parallel_steps" in (body or {}):
        row.max_parallel_steps = _to_int(
            (body or {}).get("max_parallel_steps"),
            default=row.max_parallel_steps,
            minimum=1,
            maximum=64,
            field_name="max_parallel_steps",
        )
    if "is_active" in (body or {}):
        row.is_active = bool((body or {}).get("is_active"))
    row.updated_at = _now_utc()

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Workflow key already exists")
    db.refresh(row)
    return _serialize_workflow_definition(row)


@router.delete("/workflows/{workflow_id}")
async def delete_workflow_definition(
    workflow_id: str,
    _super_admin: UserProfile = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Delete a global workflow definition if no active runs exist."""
    parsed_id = _parse_uuid_or_400(workflow_id)
    row = db.query(WorkflowDefinition).filter(WorkflowDefinition.id == parsed_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Workflow definition not found")

    active_runs = (
        db.query(WorkflowRun.id)
        .filter(
            WorkflowRun.workflow_definition_id == row.id,
            WorkflowRun.status == "running",
        )
        .limit(1)
        .first()
    )
    if active_runs:
        raise HTTPException(status_code=409, detail="Cannot delete workflow with running executions")

    db.delete(row)
    db.commit()
    return {"deleted": True, "workflow_id": str(parsed_id)}


@router.get("/workflows/catalog")
async def list_workflow_catalog(
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_role_from_header("admin")),
    db: Session = Depends(get_db),
):
    """List active workflow definitions available to this tenant."""
    _ = tenant
    rows = (
        db.query(WorkflowDefinition)
        .filter(WorkflowDefinition.is_active.is_(True))
        .order_by(WorkflowDefinition.key.asc())
        .all()
    )
    return {"workflows": [_serialize_workflow_definition(row) for row in rows]}


@router.post("/workflows/runs")
async def enqueue_workflow_run(
    body: dict = Body(default_factory=dict),
    tenant: Tenant = Depends(get_tenant),
    admin: UserProfile = Depends(require_tenant_role_from_header("admin")),
    db: Session = Depends(get_db),
):
    """Start a workflow run for the current tenant."""
    workflow_key = str((body or {}).get("workflow_key") or "").strip()
    if not workflow_key:
        raise HTTPException(status_code=400, detail="workflow_key is required")
    workflow = (
        db.query(WorkflowDefinition)
        .filter(
            WorkflowDefinition.key == workflow_key,
            WorkflowDefinition.is_active.is_(True),
        )
        .first()
    )
    if not workflow:
        raise HTTPException(status_code=404, detail="Active workflow definition not found")

    payload = (body or {}).get("payload")
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="payload must be an object")
    priority = _to_int((body or {}).get("priority"), default=100, minimum=0, maximum=100000, field_name="priority")

    try:
        run = start_workflow_run(
            db,
            tenant_id=UUID(str(tenant.id)),
            workflow=workflow,
            created_by=admin.supabase_uid,
            priority=priority,
            payload=payload,
        )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Workflow enqueue conflict")

    run = _workflow_run_or_404(db, tenant, str(run.id))
    return {"workflow_run": _serialize_workflow_run(run, include_steps=True)}


@router.get("/workflows/runs")
async def list_workflow_runs(
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    include_steps: bool = Query(default=False),
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_role_from_header("admin")),
    db: Session = Depends(get_db),
):
    """List workflow runs for tenant."""
    try:
        reconcile_running_workflows(db, limit_runs=200)
        db.commit()
    except Exception:
        db.rollback()

    status_value = str(status or "").strip().lower() or None
    if status_value and status_value not in _VALID_WORKFLOW_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid workflow status filter")

    query = (
        db.query(WorkflowRun)
        .options(
            joinedload(WorkflowRun.definition),
            joinedload(WorkflowRun.step_runs).joinedload(WorkflowStepRun.definition),
            joinedload(WorkflowRun.step_runs).joinedload(WorkflowStepRun.child_job),
        )
        .filter(tenant_column_filter(WorkflowRun, tenant))
    )
    if status_value:
        query = query.filter(WorkflowRun.status == status_value)
    total = int(query.order_by(None).count() or 0)
    rows = query.order_by(WorkflowRun.queued_at.desc(), WorkflowRun.id.desc()).limit(limit).offset(offset).all()
    return {
        "tenant_id": str(tenant.id),
        "total": total,
        "limit": limit,
        "offset": offset,
        "runs": [_serialize_workflow_run(row, include_steps=include_steps) for row in rows],
    }


@router.get("/workflows/runs/{run_id}")
async def get_workflow_run(
    run_id: str,
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_role_from_header("admin")),
    db: Session = Depends(get_db),
):
    """Fetch one workflow run with step state."""
    try:
        reconcile_running_workflows(db, limit_runs=200)
        db.commit()
    except Exception:
        db.rollback()

    run = _workflow_run_or_404(db, tenant, run_id)
    return _serialize_workflow_run(run, include_steps=True)


@router.post("/workflows/runs/{run_id}/cancel")
async def cancel_workflow_run_endpoint(
    run_id: str,
    body: dict = Body(default_factory=dict),
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_role_from_header("admin")),
    db: Session = Depends(get_db),
):
    """Cancel an in-flight workflow run."""
    run = _workflow_run_or_404(db, tenant, run_id)
    reason = str((body or {}).get("reason") or "").strip() or None
    changed = cancel_workflow_run(db, run=run, reason=reason)
    if not changed:
        return {
            "workflow_run": _serialize_workflow_run(run, include_steps=True),
            "changed": False,
            "message": f"Workflow run already terminal ({run.status})",
        }
    db.commit()
    refreshed_run = _workflow_run_or_404(db, tenant, run_id)
    return {
        "workflow_run": _serialize_workflow_run(refreshed_run, include_steps=True),
        "changed": True,
    }


@router.delete("/workflows/runs/{run_id}")
async def delete_workflow_run(
    run_id: str,
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_role_from_header("admin")),
    db: Session = Depends(get_db),
):
    """Delete a workflow run after it reaches a terminal state."""
    run = _workflow_run_or_404(db, tenant, run_id)
    run_status = str(run.status or "").strip().lower()
    if run_status == "running":
        raise HTTPException(
            status_code=409,
            detail="Cannot delete a running workflow run.",
        )

    deleted_run_id = str(run.id)
    db.delete(run)
    db.commit()
    return {"deleted": True, "workflow_run_id": deleted_run_id}


@router.post("/{job_id}/cancel")
async def cancel_job(
    job_id: str,
    body: dict = Body(default_factory=dict),
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_role_from_header("admin")),
    db: Session = Depends(get_db),
):
    """Cancel a queued/running job."""
    job = _job_or_404(db, tenant, job_id)
    if job.status in {"succeeded", "failed", "dead_letter", "canceled"}:
        return {
            "job": _serialize_job(job),
            "changed": False,
            "message": f"Job already terminal ({job.status})",
        }

    reason = str((body or {}).get("reason") or "").strip()
    now = _now_utc()
    job.status = "canceled"
    job.finished_at = now
    job.lease_expires_at = None
    job.last_error = reason or job.last_error

    if job.attempt_count and job.attempt_count > 0:
        attempt = db.query(JobAttempt).filter(
            JobAttempt.job_id == job.id,
            JobAttempt.attempt_no == job.attempt_count,
        ).first()
        if attempt and attempt.status == "running":
            attempt.status = "canceled"
            attempt.finished_at = now
            if reason:
                attempt.error_text = reason

    handle_workflow_job_state_change(db, job=job)
    db.commit()
    db.refresh(job)
    return {"job": _serialize_job(job), "changed": True}


@router.delete("/{job_id}")
async def delete_job(
    job_id: str,
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_role_from_header("admin")),
    db: Session = Depends(get_db),
):
    """Delete a tenant job that is not currently running."""
    job = _job_or_404(db, tenant, job_id)
    if job.status == "running":
        raise HTTPException(
            status_code=409,
            detail="Cannot delete a running job. Cancel it first.",
        )
    if parse_workflow_source_ref(job.source_ref):
        raise HTTPException(
            status_code=409,
            detail="Cannot delete workflow-managed jobs directly.",
        )

    deleted_job_id = str(job.id)
    db.delete(job)
    db.commit()
    return {"deleted": True, "job_id": deleted_job_id}


@router.post("/{job_id}/retry")
async def retry_job(
    job_id: str,
    body: dict = Body(default_factory=dict),
    tenant: Tenant = Depends(get_tenant),
    admin: UserProfile = Depends(require_tenant_role_from_header("admin")),
    db: Session = Depends(get_db),
):
    """Create a new queued job copied from a previous terminal job."""
    source_job = _job_or_404(db, tenant, job_id)
    if parse_workflow_source_ref(source_job.source_ref):
        raise HTTPException(status_code=409, detail="Retry is not supported for workflow-managed jobs")
    if source_job.status not in _VALID_RETRY_FROM_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=f"Can only retry jobs in {_VALID_RETRY_FROM_STATUSES}. Current status: {source_job.status}",
        )

    payload = (body or {}).get("payload", source_job.payload or {})
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="payload must be an object")
    definition = source_job.definition or db.query(JobDefinition).filter(JobDefinition.id == source_job.definition_id).first()
    if not definition:
        raise HTTPException(status_code=404, detail="Job definition not found")
    try:
        payload = normalize_queue_payload(str(definition.key or "").strip(), payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    priority = _to_int((body or {}).get("priority"), default=int(source_job.priority or 100), minimum=0, maximum=100000, field_name="priority")
    max_attempts = _to_int((body or {}).get("max_attempts"), default=int(source_job.max_attempts or 3), minimum=1, maximum=100, field_name="max_attempts")
    scheduled_for = _parse_iso_datetime((body or {}).get("scheduled_for")) or _now_utc()
    dedupe_key = str((body or {}).get("dedupe_key") or "").strip() or None

    retry_job = Job(
        tenant_id=source_job.tenant_id,
        definition_id=source_job.definition_id,
        source="manual",
        source_ref=f"retry:{source_job.id}",
        status="queued",
        priority=priority,
        payload=payload,
        dedupe_key=dedupe_key,
        correlation_id=source_job.correlation_id,
        scheduled_for=scheduled_for,
        queued_at=_now_utc(),
        max_attempts=max_attempts,
        created_by=admin.supabase_uid,
    )
    db.add(retry_job)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Retry job dedupe key already queued/running for tenant")
    db.refresh(retry_job)
    retry_job.definition = definition
    return {
        "retried_from_job_id": str(source_job.id),
        "job": _serialize_job(retry_job),
    }


@router.post("/worker/claim")
async def worker_claim_jobs(
    body: dict = Body(default_factory=dict),
    tenant: Tenant = Depends(get_tenant),
    _super_admin: UserProfile = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Claim queued jobs for a worker (tenant-scoped, skip-locked semantics)."""
    worker_id = str((body or {}).get("worker_id") or "").strip()
    if not worker_id:
        raise HTTPException(status_code=400, detail="worker_id is required")

    batch_size = _to_int((body or {}).get("batch_size"), default=1, minimum=1, maximum=50, field_name="batch_size")
    lease_seconds = _to_int((body or {}).get("lease_seconds"), default=300, minimum=30, maximum=3600, field_name="lease_seconds")
    pid = _to_int((body or {}).get("pid"), default=0, minimum=0, field_name="pid")
    hostname = str((body or {}).get("hostname") or "").strip() or "unknown"
    version = str((body or {}).get("version") or "").strip() or ""
    queues = (body or {}).get("queues") or []
    if not isinstance(queues, list):
        raise HTTPException(status_code=400, detail="queues must be an array")
    queues = [str(value).strip() for value in queues if str(value).strip()]
    metadata_json = (body or {}).get("metadata") or {}
    if not isinstance(metadata_json, dict):
        raise HTTPException(status_code=400, detail="metadata must be an object")

    now = _now_utc()
    claimed_jobs = db.query(Job).options(joinedload(Job.definition)).filter(
        tenant_column_filter(Job, tenant),
        Job.status == "queued",
        Job.scheduled_for <= now,
    ).order_by(
        Job.priority.asc(),
        Job.queued_at.asc(),
        Job.id.asc(),
    ).with_for_update(skip_locked=True).limit(batch_size).all()

    lease_expires_at = now + timedelta(seconds=lease_seconds)
    for job in claimed_jobs:
        job.status = "running"
        if not job.started_at:
            job.started_at = now
        job.lease_expires_at = lease_expires_at
        job.claimed_by_worker = worker_id
        job.attempt_count = int(job.attempt_count or 0) + 1
        mark_workflow_step_running(db, job=job, started_at=job.started_at or now)
        db.add(JobAttempt(
            job_id=job.id,
            attempt_no=job.attempt_count,
            worker_id=worker_id,
            pid=(pid or None),
            started_at=now,
            status="running",
        ))

    _upsert_worker_heartbeat(
        db,
        worker_id=worker_id,
        hostname=hostname,
        version=version,
        queues=queues,
        running_count=len(claimed_jobs),
        metadata_json=metadata_json,
    )
    db.commit()

    return {
        "tenant_id": tenant.id,
        "worker_id": worker_id,
        "claimed": len(claimed_jobs),
        "jobs": [_serialize_job(job) for job in claimed_jobs],
    }


@router.post("/worker/{job_id}/heartbeat")
async def worker_heartbeat(
    job_id: str,
    body: dict = Body(default_factory=dict),
    tenant: Tenant = Depends(get_tenant),
    _super_admin: UserProfile = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Extend lease for a running job claimed by worker_id."""
    worker_id = str((body or {}).get("worker_id") or "").strip()
    if not worker_id:
        raise HTTPException(status_code=400, detail="worker_id is required")
    lease_seconds = _to_int((body or {}).get("lease_seconds"), default=300, minimum=30, maximum=3600, field_name="lease_seconds")

    job = _job_or_404(db, tenant, job_id)
    if job.status != "running":
        raise HTTPException(status_code=409, detail="Job is not running")
    if (job.claimed_by_worker or "").strip() != worker_id:
        raise HTTPException(status_code=409, detail="Job is claimed by a different worker")

    now = _now_utc()
    job.lease_expires_at = now + timedelta(seconds=lease_seconds)

    _upsert_worker_heartbeat(
        db,
        worker_id=worker_id,
        hostname=str((body or {}).get("hostname") or "").strip() or "unknown",
        version=str((body or {}).get("version") or "").strip() or "",
        queues=[str(value).strip() for value in ((body or {}).get("queues") or []) if str(value).strip()],
        running_count=_to_int((body or {}).get("running_count"), default=1, minimum=0, maximum=100000, field_name="running_count"),
        metadata_json=(body or {}).get("metadata") if isinstance((body or {}).get("metadata"), dict) else {},
    )
    db.commit()
    return {
        "job_id": str(job.id),
        "worker_id": worker_id,
        "lease_expires_at": job.lease_expires_at,
    }


@router.post("/worker/{job_id}/complete")
async def worker_complete_job(
    job_id: str,
    body: dict = Body(default_factory=dict),
    tenant: Tenant = Depends(get_tenant),
    _super_admin: UserProfile = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Mark a running job as succeeded."""
    worker_id = str((body or {}).get("worker_id") or "").strip()
    if not worker_id:
        raise HTTPException(status_code=400, detail="worker_id is required")
    exit_code = _to_int((body or {}).get("exit_code"), default=0, minimum=0, maximum=255, field_name="exit_code")
    stdout_tail = str((body or {}).get("stdout_tail") or "")[:20000] or None
    stderr_tail = str((body or {}).get("stderr_tail") or "")[:20000] or None

    job = _job_or_404(db, tenant, job_id)
    if job.status != "running":
        raise HTTPException(status_code=409, detail="Job is not running")
    if (job.claimed_by_worker or "").strip() != worker_id:
        raise HTTPException(status_code=409, detail="Job is claimed by a different worker")

    now = _now_utc()
    job.status = "succeeded"
    job.finished_at = now
    job.lease_expires_at = None
    job.claimed_by_worker = None
    job.last_error = None

    attempt = db.query(JobAttempt).filter(
        JobAttempt.job_id == job.id,
        JobAttempt.attempt_no == job.attempt_count,
    ).first()
    if attempt:
        attempt.status = "succeeded"
        attempt.finished_at = now
        attempt.exit_code = exit_code
        attempt.stdout_tail = stdout_tail
        attempt.stderr_tail = stderr_tail

    handle_workflow_job_state_change(db, job=job)

    _upsert_worker_heartbeat(
        db,
        worker_id=worker_id,
        hostname=str((body or {}).get("hostname") or "").strip() or "unknown",
        version=str((body or {}).get("version") or "").strip() or "",
        queues=[str(value).strip() for value in ((body or {}).get("queues") or []) if str(value).strip()],
        running_count=_to_int((body or {}).get("running_count"), default=0, minimum=0, maximum=100000, field_name="running_count"),
        metadata_json=(body or {}).get("metadata") if isinstance((body or {}).get("metadata"), dict) else {},
    )
    db.commit()
    db.refresh(job)
    return {"job": _serialize_job(job)}


@router.post("/worker/{job_id}/fail")
async def worker_fail_job(
    job_id: str,
    body: dict = Body(default_factory=dict),
    tenant: Tenant = Depends(get_tenant),
    _super_admin: UserProfile = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Fail a running job and optionally requeue with backoff."""
    worker_id = str((body or {}).get("worker_id") or "").strip()
    if not worker_id:
        raise HTTPException(status_code=400, detail="worker_id is required")

    attempt_status = str((body or {}).get("attempt_status") or "failed").strip().lower()
    if attempt_status not in _VALID_ATTEMPT_STATUSES - {"running", "succeeded"}:
        raise HTTPException(status_code=400, detail="attempt_status must be one of failed, timeout, canceled")

    retryable = bool((body or {}).get("retryable", True))
    exit_code = _to_int((body or {}).get("exit_code"), default=1, minimum=0, maximum=255, field_name="exit_code")
    stdout_tail = str((body or {}).get("stdout_tail") or "")[:20000] or None
    stderr_tail = str((body or {}).get("stderr_tail") or "")[:20000] or None
    error_text = str((body or {}).get("error_text") or "").strip() or "Job execution failed"

    job = _job_or_404(db, tenant, job_id)
    if job.status != "running":
        raise HTTPException(status_code=409, detail="Job is not running")
    if (job.claimed_by_worker or "").strip() != worker_id:
        raise HTTPException(status_code=409, detail="Job is claimed by a different worker")

    now = _now_utc()
    attempts_used = int(job.attempt_count or 0)
    max_attempts = int(job.max_attempts or 1)
    should_requeue = retryable and attempts_used < max_attempts

    attempt = db.query(JobAttempt).filter(
        JobAttempt.job_id == job.id,
        JobAttempt.attempt_no == job.attempt_count,
    ).first()
    if attempt:
        attempt.status = attempt_status
        attempt.finished_at = now
        attempt.exit_code = exit_code
        attempt.stdout_tail = stdout_tail
        attempt.stderr_tail = stderr_tail
        attempt.error_text = error_text

    if should_requeue:
        delay_seconds = min(300 * (2 ** max(attempts_used - 1, 0)), 3600)
        job.status = "queued"
        job.scheduled_for = now + timedelta(seconds=delay_seconds)
        job.started_at = None
        job.finished_at = None
        job.lease_expires_at = None
        job.claimed_by_worker = None
        job.last_error = error_text
    else:
        job.status = "dead_letter"
        job.finished_at = now
        job.lease_expires_at = None
        job.claimed_by_worker = None
        job.last_error = error_text

    handle_workflow_job_state_change(db, job=job)

    _upsert_worker_heartbeat(
        db,
        worker_id=worker_id,
        hostname=str((body or {}).get("hostname") or "").strip() or "unknown",
        version=str((body or {}).get("version") or "").strip() or "",
        queues=[str(value).strip() for value in ((body or {}).get("queues") or []) if str(value).strip()],
        running_count=_to_int((body or {}).get("running_count"), default=0, minimum=0, maximum=100000, field_name="running_count"),
        metadata_json=(body or {}).get("metadata") if isinstance((body or {}).get("metadata"), dict) else {},
    )
    db.commit()
    db.refresh(job)
    return {
        "job": _serialize_job(job),
        "requeued": should_requeue,
    }


@router.get("")
async def list_jobs(
    status: str | None = Query(default=None),
    source: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    created_after: datetime | None = Query(default=None),
    created_before: datetime | None = Query(default=None),
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_role_from_header("admin")),
    db: Session = Depends(get_db),
):
    """List tenant jobs with status/source/time filters."""
    status_value = (status or "").strip().lower() or None
    source_value = (source or "").strip().lower() or None
    if status_value and status_value not in _VALID_JOB_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status filter")
    if source_value and source_value not in _VALID_JOB_SOURCES:
        raise HTTPException(status_code=400, detail="Invalid source filter")

    query = db.query(Job).options(joinedload(Job.definition)).filter(
        tenant_column_filter(Job, tenant)
    )
    if status_value:
        query = query.filter(Job.status == status_value)
    if source_value:
        query = query.filter(Job.source == source_value)
    if created_after:
        query = query.filter(Job.queued_at >= created_after)
    if created_before:
        query = query.filter(Job.queued_at <= created_before)

    total = int(query.order_by(None).count() or 0)
    jobs = query.order_by(Job.queued_at.desc(), Job.id.desc()).limit(limit).offset(offset).all()

    return {
        "tenant_id": tenant.id,
        "total": total,
        "limit": limit,
        "offset": offset,
        "jobs": [_serialize_job(job) for job in jobs],
    }


@router.get("/summary")
async def get_jobs_summary(
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_role_from_header("admin")),
    db: Session = Depends(get_db),
):
    """Get queue summary metrics for the current tenant."""
    base = db.query(Job).filter(tenant_column_filter(Job, tenant))
    status_rows = base.with_entities(Job.status, func.count(Job.id)).group_by(Job.status).all()
    counts = {key: int(value or 0) for key, value in status_rows}
    for key in _VALID_JOB_STATUSES:
        counts.setdefault(key, 0)

    oldest_queued_at = base.filter(Job.status == "queued").with_entities(func.min(Job.queued_at)).scalar()
    now = datetime.now(timezone.utc)
    oldest_queued_age_seconds = None
    if oldest_queued_at:
        queued_at = oldest_queued_at
        if queued_at.tzinfo is None:
            queued_at = queued_at.replace(tzinfo=timezone.utc)
        oldest_queued_age_seconds = max(0, int((now - queued_at).total_seconds()))

    stale_running_count = int(
        base.filter(
            Job.status == "running",
            Job.lease_expires_at.is_not(None),
            Job.lease_expires_at < now,
        ).count()
        or 0
    )

    return {
        "tenant_id": tenant.id,
        "counts": counts,
        "running_count": counts.get("running", 0),
        "queued_oldest_age_seconds": oldest_queued_age_seconds,
        "stale_running_count": stale_running_count,
    }


@router.get("/{job_id}")
async def get_job(
    job_id: str,
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_role_from_header("admin")),
    db: Session = Depends(get_db),
):
    """Fetch a single tenant job by id."""
    job = _job_or_404(db, tenant, job_id)
    return _serialize_job(job)


@router.get("/{job_id}/attempts")
async def get_job_attempts(
    job_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_role_from_header("admin")),
    db: Session = Depends(get_db),
):
    """List attempt history for a single tenant job."""
    parsed_job_id = _parse_uuid_or_400(job_id)

    job_exists = db.query(Job.id).filter(
        Job.id == parsed_job_id,
        tenant_column_filter(Job, tenant),
    ).first()
    if not job_exists:
        raise HTTPException(status_code=404, detail="Job not found")

    attempts_query = db.query(JobAttempt).filter(JobAttempt.job_id == parsed_job_id)
    total = int(attempts_query.order_by(None).count() or 0)
    attempts = attempts_query.order_by(JobAttempt.attempt_no.desc()).limit(limit).offset(offset).all()

    return {
        "job_id": str(parsed_job_id),
        "total": total,
        "limit": limit,
        "offset": offset,
        "attempts": [_serialize_attempt(attempt) for attempt in attempts],
    }
