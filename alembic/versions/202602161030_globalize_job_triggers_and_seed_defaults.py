"""globalize_job_triggers_and_seed_defaults

Revision ID: 202602161030
Revises: 202602160915
Create Date: 2026-02-16 10:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "202602161030"
down_revision: Union[str, None] = "202602160915"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.alter_column(
            "job_triggers",
            "tenant_id",
            existing_type=sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=True,
        )
    else:
        with op.batch_alter_table("job_triggers") as batch_op:
            batch_op.alter_column(
                "tenant_id",
                existing_type=sa.String(),
                nullable=True,
            )

    # Promote all existing triggers to global scope.
    op.execute("UPDATE job_triggers SET tenant_id = NULL")

    # Seed default global job definitions.
    op.execute(
        """
        INSERT INTO job_definitions (key, description, arg_schema, timeout_seconds, max_attempts, is_active)
        VALUES
          (
            'provider.sync',
            'Sync provider updates for a tenant scope',
            jsonb_build_object(
              'type', 'object',
              'properties', jsonb_build_object(
                'provider_id', jsonb_build_object('type', 'string'),
                'path_prefix', jsonb_build_object('type', 'string')
              ),
              'additionalProperties', true
            ),
            3600,
            3,
            true
          ),
          (
            'ingest.folder',
            'Ingest media from a folder scope',
            jsonb_build_object(
              'type', 'object',
              'properties', jsonb_build_object(
                'path_prefix', jsonb_build_object('type', 'string')
              ),
              'additionalProperties', true
            ),
            7200,
            3,
            true
          ),
          (
            'training.recompute',
            'Recompute trained tags',
            jsonb_build_object(
              'type', 'object',
              'properties', jsonb_build_object(
                'model', jsonb_build_object('type', 'string')
              ),
              'additionalProperties', true
            ),
            10800,
            2,
            true
          )
        ON CONFLICT (key) DO NOTHING
        """
    )

    # Seed default global triggers.
    op.execute(
        """
        INSERT INTO job_triggers (
          tenant_id,
          label,
          is_enabled,
          trigger_type,
          event_name,
          cron_expr,
          timezone,
          definition_id,
          payload_template,
          dedupe_window_seconds
        )
        SELECT
          NULL,
          'Sync on provider folder update',
          true,
          'event',
          'provider.folder.updated',
          NULL,
          NULL,
          d.id,
          '{"provider_id":"{{event.provider_id}}","path_prefix":"{{event.folder_path}}"}'::jsonb,
          120
        FROM job_definitions d
        WHERE d.key = 'provider.sync'
          AND NOT EXISTS (
            SELECT 1 FROM job_triggers t WHERE t.label = 'Sync on provider folder update' AND t.tenant_id IS NULL
          )
        """
    )

    op.execute(
        """
        INSERT INTO job_triggers (
          tenant_id,
          label,
          is_enabled,
          trigger_type,
          event_name,
          cron_expr,
          timezone,
          definition_id,
          payload_template,
          dedupe_window_seconds
        )
        SELECT
          NULL,
          'Nightly ingest scan',
          true,
          'schedule',
          NULL,
          '0 2 * * *',
          'America/New_York',
          d.id,
          '{"path_prefix":"/"}'::jsonb,
          300
        FROM job_definitions d
        WHERE d.key = 'ingest.folder'
          AND NOT EXISTS (
            SELECT 1 FROM job_triggers t WHERE t.label = 'Nightly ingest scan' AND t.tenant_id IS NULL
          )
        """
    )


def downgrade() -> None:
    # Remove default seeded global triggers and definitions.
    op.execute(
        """
        DELETE FROM job_triggers
        WHERE tenant_id IS NULL
          AND label IN ('Sync on provider folder update', 'Nightly ingest scan')
        """
    )
    op.execute(
        """
        DELETE FROM job_definitions
        WHERE key IN ('provider.sync', 'ingest.folder', 'training.recompute')
        """
    )

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        # Put global triggers on a deterministic tenant before making NOT NULL.
        op.execute(
            """
            WITH first_tenant AS (
              SELECT id FROM tenants ORDER BY created_at ASC NULLS LAST, id ASC LIMIT 1
            )
            UPDATE job_triggers t
            SET tenant_id = (SELECT id FROM first_tenant)
            WHERE t.tenant_id IS NULL
            """
        )
        op.alter_column(
            "job_triggers",
            "tenant_id",
            existing_type=sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=False,
        )
    else:
        with op.batch_alter_table("job_triggers") as batch_op:
            batch_op.alter_column(
                "tenant_id",
                existing_type=sa.String(),
                nullable=False,
            )
