"""restore_recompute_trained_tags_definition

Revision ID: 202602161545
Revises: 202602161520
Create Date: 2026-02-16 15:45:00.000000
"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "202602161545"
down_revision: Union[str, None] = "202602161520"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO job_definitions (key, description, arg_schema, timeout_seconds, max_attempts, is_active)
        VALUES
          (
            'recompute-trained-tags',
            'Recompute ML trained tags for images',
            jsonb_build_object(
              'type', 'object',
              'properties', jsonb_build_object(
                'batch_size', jsonb_build_object('type', 'integer', 'minimum', 1, 'default', 50),
                'limit', jsonb_build_object('type', 'integer', 'minimum', 1),
                'offset', jsonb_build_object('type', 'integer', 'minimum', 0, 'default', 0),
                'replace', jsonb_build_object('type', 'boolean', 'default', false),
                'older_than_days', jsonb_build_object('type', 'number', 'minimum', 0)
              ),
              'additionalProperties', false
            ),
            10800,
            2,
            true
          )
        ON CONFLICT (key) DO UPDATE
          SET is_active = true,
              updated_at = now()
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM job_definitions
        WHERE key = 'recompute-trained-tags'
        """
    )
