"""add_zero_shot_recompute_job_definition

Revision ID: 202602161215
Revises: 202602161030
Create Date: 2026-02-16 12:15:00.000000
"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "202602161215"
down_revision: Union[str, None] = "202602161030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO job_definitions (key, description, arg_schema, timeout_seconds, max_attempts, is_active)
        VALUES
          (
            'zero-shot.recompute',
            'Recompute SigLIP zero-shot tags',
            jsonb_build_object(
              'type', 'object',
              'properties', jsonb_build_object(
                'replace', jsonb_build_object('type', 'boolean'),
                'folder_path', jsonb_build_object('type', 'string')
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


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM job_definitions
        WHERE key = 'zero-shot.recompute'
        """
    )
