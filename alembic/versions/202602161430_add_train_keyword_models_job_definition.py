"""add_train_keyword_models_job_definition

Revision ID: 202602161430
Revises: 202602161245
Create Date: 2026-02-16 14:30:00.000000
"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "202602161430"
down_revision: Union[str, None] = "202602161245"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO job_definitions (key, description, arg_schema, timeout_seconds, max_attempts, is_active)
        VALUES
          (
            'training.train-models',
            'Train keyword classification models for a tenant',
            jsonb_build_object(
              'type', 'object',
              'properties', jsonb_build_object(
                'min_positive', jsonb_build_object('type', 'integer', 'minimum', 1),
                'min_negative', jsonb_build_object('type', 'integer', 'minimum', 1)
              ),
              'additionalProperties', false
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
        WHERE key = 'training.train-models'
        """
    )
