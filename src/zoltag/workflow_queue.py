"""Workflow orchestration for composite/parallel job execution."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from zoltag.cli.introspection import normalize_queue_payload
from zoltag.metadata import (
    Job,
    JobDefinition,
    WorkflowDefinition,
    WorkflowRun,
    WorkflowStepRun,
)


WORKFLOW_SOURCE_PREFIX = "workflow"

_RUN_TERMINAL = {"succeeded", "failed", "canceled"}
_STEP_TERMINAL = {"succeeded", "failed", "canceled", "skipped"}
_STEP_OPEN = {"pending", "queued", "running"}


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def make_workflow_source_ref(run_id: UUID | str, step_key: str) -> str:
    return f"{WORKFLOW_SOURCE_PREFIX}:{str(run_id)}:{str(step_key)}"


def parse_workflow_source_ref(source_ref: str | None) -> tuple[UUID, str] | None:
    raw = str(source_ref or "").strip()
    if not raw:
        return None
    parts = raw.split(":", 2)
    if len(parts) != 3 or parts[0] != WORKFLOW_SOURCE_PREFIX:
        return None
    try:
        run_id = UUID(parts[1])
    except (ValueError, TypeError):
        return None
    step_key = str(parts[2] or "").strip()
    if not step_key:
        return None
    return run_id, step_key


def _normalize_step_definition(step: dict) -> dict:
    if not isinstance(step, dict):
        raise ValueError("Each workflow step must be an object")
    step_key = str(step.get("step_key") or "").strip()
    if not step_key:
        raise ValueError("Each workflow step requires step_key")
    definition_key = str(step.get("definition_key") or "").strip()
    if not definition_key:
        raise ValueError(f"Step {step_key} requires definition_key")
    payload = step.get("payload")
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        raise ValueError(f"Step {step_key} payload must be an object")
    depends_on = step.get("depends_on")
    if depends_on is None:
        depends_on = []
    if not isinstance(depends_on, list):
        raise ValueError(f"Step {step_key} depends_on must be an array")
    normalized_depends = []
    seen = set()
    for raw_dep in depends_on:
        dep = str(raw_dep or "").strip()
        if not dep:
            continue
        if dep == step_key:
            raise ValueError(f"Step {step_key} cannot depend on itself")
        if dep in seen:
            continue
        seen.add(dep)
        normalized_depends.append(dep)
    return {
        "step_key": step_key,
        "definition_key": definition_key,
        "payload": payload,
        "depends_on": normalized_depends,
    }


def validate_workflow_steps(
    db: Session,
    steps: list[dict],
    *,
    require_active_definitions: bool = True,
) -> list[dict]:
    if not isinstance(steps, list) or not steps:
        raise ValueError("steps must be a non-empty array")

    normalized = [_normalize_step_definition(step) for step in steps]
    keys = [step["step_key"] for step in normalized]
    if len(keys) != len(set(keys)):
        raise ValueError("step_key values must be unique")

    key_set = set(keys)
    for step in normalized:
        for dep in step["depends_on"]:
            if dep not in key_set:
                raise ValueError(f"Step {step['step_key']} depends on unknown step: {dep}")

    # Cycle detection
    incoming = {step["step_key"]: set(step["depends_on"]) for step in normalized}
    ready = [key for key, deps in incoming.items() if not deps]
    seen_count = 0
    while ready:
        node = ready.pop()
        seen_count += 1
        for key, deps in incoming.items():
            if node in deps:
                deps.remove(node)
                if not deps:
                    ready.append(key)
    if seen_count != len(normalized):
        raise ValueError("Workflow steps contain a dependency cycle")

    definition_keys = sorted({step["definition_key"] for step in normalized})
    query = db.query(JobDefinition).filter(JobDefinition.key.in_(definition_keys))
    if require_active_definitions:
        query = query.filter(JobDefinition.is_active.is_(True))
    definitions = {str(row.key): row for row in query.all()}
    missing = [key for key in definition_keys if key not in definitions]
    if missing:
        raise ValueError(f"Unknown or inactive job definition(s): {', '.join(missing)}")

    validated = []
    for step in normalized:
        definition = definitions[step["definition_key"]]
        payload = normalize_queue_payload(str(definition.key), step["payload"])
        validated.append({
            "step_key": step["step_key"],
            "definition_key": str(definition.key),
            "payload": payload,
            "depends_on": list(step["depends_on"]),
        })
    return validated


def _lock_workflow_run(db: Session, run_id: UUID) -> WorkflowRun | None:
    return (
        db.query(WorkflowRun)
        .filter(WorkflowRun.id == run_id)
        .with_for_update()
        .first()
    )


def _load_step_runs(db: Session, run_id: UUID) -> list[WorkflowStepRun]:
    return (
        db.query(WorkflowStepRun)
        .filter(WorkflowStepRun.workflow_run_id == run_id)
        .order_by(WorkflowStepRun.step_key.asc())
        .all()
    )


def _cancel_open_steps_for_run(db: Session, run: WorkflowRun, *, reason: str | None = None) -> None:
    now = _now_utc()
    open_steps = (
        db.query(WorkflowStepRun)
        .filter(
            WorkflowStepRun.workflow_run_id == run.id,
            WorkflowStepRun.status.in_(list(_STEP_OPEN)),
        )
        .all()
    )
    for step in open_steps:
        step.status = "canceled"
        step.finished_at = now
        if reason and not step.last_error:
            step.last_error = reason
        if step.child_job_id:
            job = db.query(Job).filter(Job.id == step.child_job_id).first()
            if job and job.status in {"queued", "running"}:
                job.status = "canceled"
                job.finished_at = now
                job.last_error = reason or "Canceled by workflow fail-fast policy"
                job.lease_expires_at = None
                job.claimed_by_worker = None


def _reconcile_run_status(db: Session, run: WorkflowRun) -> None:
    now = _now_utc()
    steps = _load_step_runs(db, run.id)
    statuses = [str(step.status or "") for step in steps]
    if not statuses:
        run.status = "failed"
        run.finished_at = now
        run.last_error = "Workflow has no steps"
        return

    has_open = any(status in _STEP_OPEN for status in statuses)
    has_failed = any(status == "failed" for status in statuses)
    has_canceled = any(status == "canceled" for status in statuses)
    all_terminal = all(status in _STEP_TERMINAL for status in statuses)

    if all_terminal:
        if has_failed:
            run.status = "failed"
        elif has_canceled:
            run.status = "canceled"
        else:
            run.status = "succeeded"
        if not run.finished_at:
            run.finished_at = now
        return

    if run.status in _RUN_TERMINAL:
        return

    if run.status != "running":
        run.status = "running"
    if not run.started_at:
        run.started_at = now
    if has_open:
        run.finished_at = None
        return

    if has_failed:
        run.status = "failed"
        run.finished_at = now
    elif has_canceled:
        run.status = "canceled"
        run.finished_at = now


def _enqueue_ready_steps(db: Session, run: WorkflowRun) -> None:
    if run.status in _RUN_TERMINAL:
        return

    step_runs = _load_step_runs(db, run.id)
    by_key = {str(step.step_key): step for step in step_runs}
    now = _now_utc()

    # Mark steps as skipped when they depend on terminal non-success steps.
    for step in step_runs:
        if str(step.status or "") != "pending":
            continue
        deps = list(step.depends_on or [])
        blocked = False
        for dep in deps:
            dep_step = by_key.get(dep)
            dep_status = str(getattr(dep_step, "status", "") or "")
            if dep_status in {"failed", "canceled", "skipped"}:
                blocked = True
                break
        if blocked:
            step.status = "skipped"
            step.finished_at = now
            if not step.last_error:
                step.last_error = "Skipped because dependency did not succeed"

    running_or_queued = sum(1 for step in step_runs if str(step.status or "") in {"queued", "running"})
    max_parallel = max(1, int(run.max_parallel_steps or 1))
    capacity = max_parallel - running_or_queued
    if capacity <= 0:
        return

    definition_ids = sorted({step.definition_id for step in step_runs if step.definition_id})
    definitions = {
        row.id: row
        for row in db.query(JobDefinition).filter(JobDefinition.id.in_(definition_ids)).all()
    }
    for step in step_runs:
        if capacity <= 0:
            break
        if str(step.status or "") != "pending":
            continue
        dependencies = list(step.depends_on or [])
        deps_satisfied = all(
            str(by_key.get(dep).status or "") == "succeeded"
            for dep in dependencies
            if by_key.get(dep) is not None
        )
        if not deps_satisfied:
            continue

        definition = definitions.get(step.definition_id)
        if definition is None or not bool(definition.is_active):
            step.status = "failed"
            step.finished_at = now
            step.last_error = f"Definition unavailable: {step.definition_id}"
            run.last_error = step.last_error
            if str(run.failure_policy or "fail_fast") == "fail_fast":
                run.status = "failed"
                run.finished_at = now
                _cancel_open_steps_for_run(db, run, reason=step.last_error)
                return
            continue

        try:
            normalized_payload = normalize_queue_payload(str(definition.key), step.payload or {})
        except ValueError as exc:
            step.status = "failed"
            step.finished_at = now
            step.last_error = str(exc)
            run.last_error = step.last_error
            if str(run.failure_policy or "fail_fast") == "fail_fast":
                run.status = "failed"
                run.finished_at = now
                _cancel_open_steps_for_run(db, run, reason=step.last_error)
                return
            continue

        job = Job(
            tenant_id=run.tenant_id,
            definition_id=definition.id,
            source="system",
            source_ref=make_workflow_source_ref(run.id, str(step.step_key)),
            status="queued",
            priority=int(run.priority or 100),
            payload=normalized_payload,
            dedupe_key=f"workflow-step:{run.id}:{step.step_key}",
            correlation_id=f"workflow:{run.id}",
            scheduled_for=now,
            queued_at=now,
            max_attempts=int(definition.max_attempts or 3),
            created_by=run.created_by,
        )
        db.add(job)
        db.flush()

        step.status = "queued"
        step.queued_at = now
        step.child_job_id = job.id
        capacity -= 1


def start_workflow_run(
    db: Session,
    *,
    tenant_id: UUID,
    workflow: WorkflowDefinition,
    created_by: UUID | None,
    priority: int,
    payload: dict | None = None,
) -> WorkflowRun:
    steps = validate_workflow_steps(db, list(workflow.steps or []), require_active_definitions=True)
    now = _now_utc()
    run = WorkflowRun(
        tenant_id=tenant_id,
        workflow_definition_id=workflow.id,
        status="running",
        payload=payload or {},
        priority=int(priority or 100),
        max_parallel_steps=max(1, int(workflow.max_parallel_steps or 1)),
        failure_policy=str(workflow.failure_policy or "fail_fast"),
        queued_at=now,
        started_at=now,
        created_by=created_by,
    )
    db.add(run)
    db.flush()

    definition_ids = {
        str(row.key): row.id
        for row in db.query(JobDefinition).filter(
            JobDefinition.key.in_([step["definition_key"] for step in steps])
        ).all()
    }
    for step in steps:
        definition_id = definition_ids.get(step["definition_key"])
        if not definition_id:
            raise ValueError(f"Unknown definition for step {step['step_key']}: {step['definition_key']}")
        db.add(
            WorkflowStepRun(
                workflow_run_id=run.id,
                step_key=step["step_key"],
                definition_id=definition_id,
                status="pending",
                payload=step.get("payload") or {},
                depends_on=step.get("depends_on") or [],
            )
        )

    db.flush()
    _enqueue_ready_steps(db, run)
    _reconcile_run_status(db, run)
    return run


def mark_workflow_step_running(db: Session, *, job: Job, started_at: datetime | None = None) -> None:
    parsed = parse_workflow_source_ref(job.source_ref)
    if not parsed:
        return
    run_id, step_key = parsed
    if str(job.status or "").lower() != "running":
        return
    step = (
        db.query(WorkflowStepRun)
        .filter(
            WorkflowStepRun.workflow_run_id == run_id,
            WorkflowStepRun.step_key == step_key,
        )
        .first()
    )
    if not step:
        return
    if str(step.status or "") in _STEP_TERMINAL:
        return
    step.status = "running"
    if started_at and not step.started_at:
        step.started_at = started_at


def handle_workflow_job_state_change(db: Session, *, job: Job) -> None:
    parsed = parse_workflow_source_ref(job.source_ref)
    if not parsed:
        return
    run_id, step_key = parsed
    run = _lock_workflow_run(db, run_id)
    if not run:
        return

    step = (
        db.query(WorkflowStepRun)
        .filter(
            WorkflowStepRun.workflow_run_id == run.id,
            WorkflowStepRun.step_key == step_key,
        )
        .first()
    )
    if not step:
        return

    job_status = str(job.status or "").lower()
    now = _now_utc()
    if job_status == "running":
        if str(step.status or "") not in _STEP_TERMINAL:
            step.status = "running"
            if not step.started_at:
                step.started_at = job.started_at or now
        return

    if job_status == "queued":
        if str(step.status or "") not in _STEP_TERMINAL:
            step.status = "queued"
            if not step.queued_at:
                step.queued_at = job.queued_at or now
        return

    if job_status == "succeeded":
        step.status = "succeeded"
        step.started_at = step.started_at or job.started_at or now
        step.finished_at = job.finished_at or now
        step.last_error = None
    elif job_status in {"failed", "dead_letter"}:
        step.status = "failed"
        step.started_at = step.started_at or job.started_at or now
        step.finished_at = job.finished_at or now
        step.last_error = str(job.last_error or "").strip() or f"Job ended with {job_status}"
        run.last_error = step.last_error
    elif job_status == "canceled":
        step.status = "canceled"
        step.started_at = step.started_at or job.started_at or now
        step.finished_at = job.finished_at or now
        step.last_error = str(job.last_error or "").strip() or "Canceled"
        if str(run.last_error or "").strip() == "":
            run.last_error = step.last_error
    else:
        return

    if run.status in _RUN_TERMINAL:
        _reconcile_run_status(db, run)
        return

    if str(step.status or "") in {"failed", "canceled"} and str(run.failure_policy or "fail_fast") == "fail_fast":
        run.status = "failed" if step.status == "failed" else "canceled"
        run.finished_at = now
        _cancel_open_steps_for_run(db, run, reason=run.last_error or step.last_error)
        _reconcile_run_status(db, run)
        return

    _enqueue_ready_steps(db, run)
    _reconcile_run_status(db, run)


def reconcile_running_workflows(db: Session, *, limit_runs: int = 50) -> int:
    """Reconcile running workflows against current child job state.

    This recovers workflows if a worker crashed between child job completion and
    workflow callback handling.
    """
    run_ids = [
        row_id
        for (row_id,) in (
            db.query(WorkflowRun.id)
            .filter(WorkflowRun.status == "running")
            .order_by(WorkflowRun.queued_at.asc(), WorkflowRun.id.asc())
            .limit(max(1, int(limit_runs or 50)))
            .all()
        )
    ]

    processed = 0
    for run_id in run_ids:
        run = _lock_workflow_run(db, run_id)
        if not run or str(run.status or "") in _RUN_TERMINAL:
            continue

        step_runs = _load_step_runs(db, run.id)
        child_job_ids = [step.child_job_id for step in step_runs if step.child_job_id is not None]
        jobs_by_id = {}
        if child_job_ids:
            jobs_by_id = {
                row.id: row
                for row in db.query(Job).filter(Job.id.in_(child_job_ids)).all()
            }

        now = _now_utc()
        for step in step_runs:
            if step.child_job_id is None:
                continue
            job = jobs_by_id.get(step.child_job_id)
            if job is None:
                continue
            job_status = str(job.status or "").lower()
            if job_status == "queued":
                if str(step.status or "") not in _STEP_TERMINAL:
                    step.status = "queued"
                    step.queued_at = step.queued_at or job.queued_at or now
            elif job_status == "running":
                if str(step.status or "") not in _STEP_TERMINAL:
                    step.status = "running"
                    step.started_at = step.started_at or job.started_at or now
            elif job_status == "succeeded":
                step.status = "succeeded"
                step.started_at = step.started_at or job.started_at or now
                step.finished_at = step.finished_at or job.finished_at or now
                step.last_error = None
            elif job_status in {"failed", "dead_letter"}:
                step.status = "failed"
                step.started_at = step.started_at or job.started_at or now
                step.finished_at = step.finished_at or job.finished_at or now
                step.last_error = str(job.last_error or "").strip() or f"Job ended with {job_status}"
                run.last_error = step.last_error
            elif job_status == "canceled":
                step.status = "canceled"
                step.started_at = step.started_at or job.started_at or now
                step.finished_at = step.finished_at or job.finished_at or now
                step.last_error = str(job.last_error or "").strip() or "Canceled"
                if str(run.last_error or "").strip() == "":
                    run.last_error = step.last_error

        _enqueue_ready_steps(db, run)
        _reconcile_run_status(db, run)
        processed += 1

    return processed


def cancel_workflow_run(db: Session, *, run: WorkflowRun, reason: str | None = None) -> bool:
    """Cancel a workflow run and any open child steps/jobs.

    Returns True when a state change was applied, False when the run was already terminal.
    """
    if str(run.status or "") in _RUN_TERMINAL:
        return False

    now = _now_utc()
    message = str(reason or "").strip() or "Canceled by user"
    run.status = "canceled"
    run.finished_at = now
    run.last_error = message
    _cancel_open_steps_for_run(db, run, reason=message)
    _reconcile_run_status(db, run)
    return True
