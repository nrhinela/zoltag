"""add_job_queue_tables

Revision ID: 202602160915
Revises: 202602152140
Create Date: 2026-02-16 09:15:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "202602160915"
down_revision: Union[str, None] = "202602152140"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "job_definitions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("arg_schema", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("timeout_seconds", sa.Integer(), nullable=False, server_default=sa.text("3600")),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default=sa.text("3")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key", name="uq_job_definitions_key"),
    )
    op.create_index("idx_job_definitions_active", "job_definitions", ["is_active"], unique=False)

    op.create_table(
        "job_triggers",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("trigger_type", sa.Text(), nullable=False),
        sa.Column("event_name", sa.Text(), nullable=True),
        sa.Column("cron_expr", sa.Text(), nullable=True),
        sa.Column("timezone", sa.Text(), nullable=True),
        sa.Column("definition_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("payload_template", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("dedupe_window_seconds", sa.Integer(), nullable=False, server_default=sa.text("300")),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["definition_id"], ["job_definitions.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by"], ["user_profiles.supabase_uid"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "trigger_type in ('event','schedule')",
            name="ck_job_triggers_trigger_type",
        ),
        sa.CheckConstraint(
            "("
            "(trigger_type = 'event' and event_name is not null and cron_expr is null)"
            " or "
            "(trigger_type = 'schedule' and cron_expr is not null and timezone is not null and event_name is null)"
            ")",
            name="ck_job_triggers_event_or_schedule",
        ),
    )
    op.create_index("idx_job_triggers_tenant_enabled", "job_triggers", ["tenant_id", "is_enabled"], unique=False)
    op.create_index(
        "idx_job_triggers_event",
        "job_triggers",
        ["event_name"],
        unique=False,
        postgresql_where=sa.text("trigger_type = 'event'"),
    )

    op.create_table(
        "jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("definition_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("source_ref", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'queued'")),
        sa.Column("priority", sa.Integer(), nullable=False, server_default=sa.text("100")),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("dedupe_key", sa.Text(), nullable=True),
        sa.Column("correlation_id", sa.Text(), nullable=True),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("queued_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default=sa.text("3")),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("claimed_by_worker", sa.Text(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["definition_id"], ["job_definitions.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by"], ["user_profiles.supabase_uid"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("source in ('manual','event','schedule','system')", name="ck_jobs_source"),
        sa.CheckConstraint(
            "status in ('queued','running','succeeded','failed','canceled','dead_letter')",
            name="ck_jobs_status",
        ),
    )
    op.create_index(
        "idx_jobs_queue_scan",
        "jobs",
        ["status", "scheduled_for", "priority", "queued_at"],
        unique=False,
        postgresql_where=sa.text("status = 'queued'"),
    )
    op.create_index("idx_jobs_tenant_status_time", "jobs", ["tenant_id", "status", "queued_at"], unique=False)
    op.create_index(
        "idx_jobs_worker_lease",
        "jobs",
        ["claimed_by_worker", "lease_expires_at"],
        unique=False,
        postgresql_where=sa.text("status = 'running'"),
    )
    op.create_index(
        "uq_jobs_active_dedupe",
        "jobs",
        ["tenant_id", "dedupe_key"],
        unique=True,
        postgresql_where=sa.text("dedupe_key is not null and status in ('queued','running')"),
    )

    op.create_table(
        "job_attempts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("job_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("attempt_no", sa.Integer(), nullable=False),
        sa.Column("worker_id", sa.Text(), nullable=False),
        sa.Column("pid", sa.Integer(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("exit_code", sa.Integer(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("stdout_tail", sa.Text(), nullable=True),
        sa.Column("stderr_tail", sa.Text(), nullable=True),
        sa.Column("error_text", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["job_id"], ["jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "status in ('running','succeeded','failed','timeout','canceled')",
            name="ck_job_attempts_status",
        ),
    )
    op.create_index("uq_job_attempts_job_attempt", "job_attempts", ["job_id", "attempt_no"], unique=True)
    op.create_index("idx_job_attempts_job_started", "job_attempts", ["job_id", "started_at"], unique=False)

    op.create_table(
        "job_workers",
        sa.Column("worker_id", sa.Text(), nullable=False),
        sa.Column("hostname", sa.Text(), nullable=False),
        sa.Column("version", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("queues", postgresql.ARRAY(sa.Text()), nullable=False, server_default=sa.text("'{}'::text[]")),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("running_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.PrimaryKeyConstraint("worker_id"),
    )


def downgrade() -> None:
    op.drop_table("job_workers")

    op.drop_index("idx_job_attempts_job_started", table_name="job_attempts")
    op.drop_index("uq_job_attempts_job_attempt", table_name="job_attempts")
    op.drop_table("job_attempts")

    op.drop_index("uq_jobs_active_dedupe", table_name="jobs")
    op.drop_index("idx_jobs_worker_lease", table_name="jobs")
    op.drop_index("idx_jobs_tenant_status_time", table_name="jobs")
    op.drop_index("idx_jobs_queue_scan", table_name="jobs")
    op.drop_table("jobs")

    op.drop_index("idx_job_triggers_event", table_name="job_triggers")
    op.drop_index("idx_job_triggers_tenant_enabled", table_name="job_triggers")
    op.drop_table("job_triggers")

    op.drop_index("idx_job_definitions_active", table_name="job_definitions")
    op.drop_table("job_definitions")
