"""retire_ingest_folder_job_definition

Revision ID: 202602161245
Revises: 202602161215
Create Date: 2026-02-16 12:45:00.000000
"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "202602161245"
down_revision: Union[str, None] = "202602161215"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Retire ingest.folder from queue usage:
    # 1) remove triggers bound to it
    # 2) deactivate the definition so it does not appear in active catalogs
    # 3) hard-delete only if completely unreferenced by historical jobs
    op.execute(
        """
        DELETE FROM job_triggers
        WHERE definition_id IN (
          SELECT id FROM job_definitions WHERE key = 'ingest.folder'
        )
        """
    )

    op.execute(
        """
        UPDATE job_definitions
        SET is_active = false,
            updated_at = now()
        WHERE key = 'ingest.folder'
        """
    )

    op.execute(
        """
        DELETE FROM job_definitions d
        WHERE d.key = 'ingest.folder'
          AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.definition_id = d.id)
          AND NOT EXISTS (SELECT 1 FROM job_triggers t WHERE t.definition_id = d.id)
        """
    )


def downgrade() -> None:
    # Restore definition as active if it still exists.
    op.execute(
        """
        UPDATE job_definitions
        SET is_active = true,
            updated_at = now()
        WHERE key = 'ingest.folder'
        """
    )

    # Re-seed the definition only if it was hard-deleted.
    op.execute(
        """
        INSERT INTO job_definitions (key, description, arg_schema, timeout_seconds, max_attempts, is_active)
        VALUES
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
          )
        ON CONFLICT (key) DO NOTHING
        """
    )

