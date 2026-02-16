"""add_workflow_queue_tables

Revision ID: 202602161700
Revises: 202602161545
Create Date: 2026-02-16 17:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "202602161700"
down_revision: Union[str, None] = "202602161545"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "workflow_definitions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("steps", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("max_parallel_steps", sa.Integer(), nullable=False, server_default=sa.text("2")),
        sa.Column("failure_policy", sa.Text(), nullable=False, server_default=sa.text("'fail_fast'")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key", name="uq_workflow_definitions_key"),
        sa.CheckConstraint(
            "failure_policy in ('fail_fast','continue')",
            name="ck_workflow_definitions_failure_policy",
        ),
    )
    op.create_index("idx_workflow_definitions_active", "workflow_definitions", ["is_active"], unique=False)

    op.create_table(
        "workflow_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workflow_definition_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'running'")),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("priority", sa.Integer(), nullable=False, server_default=sa.text("100")),
        sa.Column("max_parallel_steps", sa.Integer(), nullable=False, server_default=sa.text("2")),
        sa.Column("failure_policy", sa.Text(), nullable=False, server_default=sa.text("'fail_fast'")),
        sa.Column("queued_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workflow_definition_id"], ["workflow_definitions.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by"], ["user_profiles.supabase_uid"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("status in ('running','succeeded','failed','canceled')", name="ck_workflow_runs_status"),
        sa.CheckConstraint("failure_policy in ('fail_fast','continue')", name="ck_workflow_runs_failure_policy"),
    )
    op.create_index("idx_workflow_runs_tenant_status", "workflow_runs", ["tenant_id", "status", "queued_at"], unique=False)

    op.create_table(
        "workflow_step_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("workflow_run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("step_key", sa.Text(), nullable=False),
        sa.Column("definition_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("depends_on", postgresql.ARRAY(sa.Text()), nullable=False, server_default=sa.text("'{}'::text[]")),
        sa.Column("child_job_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("queued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["workflow_run_id"], ["workflow_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["definition_id"], ["job_definitions.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["child_job_id"], ["jobs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workflow_run_id", "step_key", name="uq_workflow_step_runs_run_step"),
        sa.UniqueConstraint("child_job_id", name="uq_workflow_step_runs_child_job_id"),
        sa.CheckConstraint(
            "status in ('pending','queued','running','succeeded','failed','canceled','skipped')",
            name="ck_workflow_step_runs_status",
        ),
    )
    op.create_index("idx_workflow_step_runs_run_status", "workflow_step_runs", ["workflow_run_id", "status"], unique=False)

    # Seed a default "daily" workflow that mirrors the current make daily flow.
    op.execute(
        """
        INSERT INTO workflow_definitions (key, description, steps, max_parallel_steps, failure_policy, is_active)
        VALUES (
          'daily',
          'Sync provider, train models, and recompute tags',
          jsonb_build_array(
            jsonb_build_object(
              'step_key', 'sync',
              'definition_key', 'sync-dropbox',
              'depends_on', jsonb_build_array(),
              'payload', jsonb_build_object()
            ),
            jsonb_build_object(
              'step_key', 'train',
              'definition_key', 'train-keyword-models',
              'depends_on', jsonb_build_array('sync'),
              'payload', jsonb_build_object()
            ),
            jsonb_build_object(
              'step_key', 'recompute-trained',
              'definition_key', 'recompute-trained-tags',
              'depends_on', jsonb_build_array('train'),
              'payload', jsonb_build_object('replace', true)
            ),
            jsonb_build_object(
              'step_key', 'recompute-zeroshot',
              'definition_key', 'recompute-zeroshot-tags',
              'depends_on', jsonb_build_array('sync'),
              'payload', jsonb_build_object('replace', true)
            )
          ),
          3,
          'fail_fast',
          true
        )
        ON CONFLICT (key) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM workflow_definitions WHERE key = 'daily'")
    op.drop_index("idx_workflow_step_runs_run_status", table_name="workflow_step_runs")
    op.drop_table("workflow_step_runs")
    op.drop_index("idx_workflow_runs_tenant_status", table_name="workflow_runs")
    op.drop_table("workflow_runs")
    op.drop_index("idx_workflow_definitions_active", table_name="workflow_definitions")
    op.drop_table("workflow_definitions")
