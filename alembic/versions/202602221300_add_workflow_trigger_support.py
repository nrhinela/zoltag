"""add workflow_definition_id to job_triggers and seed daily/weekly schedule triggers

Schedule triggers dispatch workflow runs (not single jobs). definition_id is
relaxed to nullable for schedule triggers; workflow_definition_id is the new
target column. A check constraint enforces the right target per trigger type.

Also seeds the 'weekly' workflow definition and global schedule triggers for
both 'daily' and 'weekly' workflows.

NOTE: The ALTER COLUMN and subsequent INSERTs cannot share a single Alembic
transaction because PostgreSQL enforces the NOT NULL constraint at statement
time within the same transaction. This migration uses raw SQL with IF NOT
EXISTS / DO NOTHING guards so it is safe to run against a DB where any subset
of steps already applied.

Revision ID: 202602221300
Revises: 202602221230
Create Date: 2026-02-22 13:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "202602221300"
down_revision: Union[str, None] = "202602221230"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    # 1. Add workflow_definition_id column if not already present.
    bind.execute(sa.text("""
        ALTER TABLE job_triggers
        ADD COLUMN IF NOT EXISTS workflow_definition_id UUID REFERENCES workflow_definitions(id) ON DELETE RESTRICT
    """))

    # 2. Add partial index if not already present.
    bind.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS idx_job_triggers_workflow_definition
        ON job_triggers (workflow_definition_id)
        WHERE workflow_definition_id IS NOT NULL
    """))

    # 3. Relax definition_id to nullable.
    bind.execute(sa.text("""
        ALTER TABLE job_triggers ALTER COLUMN definition_id DROP NOT NULL
    """))

    # 4. Add type/target check constraint if not already present.
    bind.execute(sa.text("""
        ALTER TABLE job_triggers DROP CONSTRAINT IF EXISTS ck_job_triggers_type_target
    """))
    bind.execute(sa.text("""
        ALTER TABLE job_triggers ADD CONSTRAINT ck_job_triggers_type_target CHECK (
            (trigger_type = 'schedule' AND workflow_definition_id IS NOT NULL AND definition_id IS NULL)
            OR (trigger_type = 'event' AND definition_id IS NOT NULL AND workflow_definition_id IS NULL)
        )
    """))

    # 5. Seed 'weekly' workflow definition.
    bind.execute(sa.text("""
        INSERT INTO workflow_definitions (key, description, steps, max_parallel_steps, failure_policy, is_active)
        VALUES (
          'weekly',
          'Weekly maintenance: build embeddings and full tag recompute',
          jsonb_build_array(
            jsonb_build_object(
              'step_key', 'build-embeddings',
              'definition_key', 'build-embeddings',
              'depends_on', jsonb_build_array(),
              'payload', jsonb_build_object()
            )
          ),
          1, 'fail_fast', true
        )
        ON CONFLICT (key) DO NOTHING
    """))

    # 6. Seed global schedule trigger for 'daily' workflow — 02:00 UTC every day.
    bind.execute(sa.text("""
        INSERT INTO job_triggers
          (tenant_id, label, is_enabled, trigger_type, event_name, cron_expr, timezone,
           definition_id, workflow_definition_id, payload_template, dedupe_window_seconds)
        SELECT NULL, 'Daily workflow (all tenants)', true, 'schedule', NULL,
               '0 2 * * *', 'UTC', NULL, wd.id, '{}'::jsonb, 3600
        FROM workflow_definitions wd WHERE wd.key = 'daily'
          AND NOT EXISTS (
            SELECT 1 FROM job_triggers
            WHERE label = 'Daily workflow (all tenants)' AND tenant_id IS NULL
          )
    """))

    # 7. Seed global schedule trigger for 'weekly' workflow — 04:00 UTC every Sunday.
    bind.execute(sa.text("""
        INSERT INTO job_triggers
          (tenant_id, label, is_enabled, trigger_type, event_name, cron_expr, timezone,
           definition_id, workflow_definition_id, payload_template, dedupe_window_seconds)
        SELECT NULL, 'Weekly workflow (all tenants)', true, 'schedule', NULL,
               '0 4 * * 0', 'UTC', NULL, wd.id, '{}'::jsonb, 7200
        FROM workflow_definitions wd WHERE wd.key = 'weekly'
          AND NOT EXISTS (
            SELECT 1 FROM job_triggers
            WHERE label = 'Weekly workflow (all tenants)' AND tenant_id IS NULL
          )
    """))


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("""
        DELETE FROM job_triggers
        WHERE tenant_id IS NULL
          AND label IN ('Daily workflow (all tenants)', 'Weekly workflow (all tenants)')
    """))
    bind.execute(sa.text("DELETE FROM workflow_definitions WHERE key = 'weekly'"))
    bind.execute(sa.text(
        "ALTER TABLE job_triggers DROP CONSTRAINT IF EXISTS ck_job_triggers_type_target"
    ))
    bind.execute(sa.text(
        "ALTER TABLE job_triggers ALTER COLUMN definition_id SET NOT NULL"
    ))
    bind.execute(sa.text(
        "DROP INDEX IF EXISTS idx_job_triggers_workflow_definition"
    ))
    bind.execute(sa.text(
        "ALTER TABLE job_triggers DROP COLUMN IF EXISTS workflow_definition_id"
    ))
