"""add build-embeddings job definition

Revision ID: 202602211400
Revises: 202602211130
Create Date: 2026-02-21 14:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "202602211400"
down_revision: Union[str, None] = "202602211130"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = bind.execute(
        sa.text("SELECT id FROM job_definitions WHERE key = 'build-embeddings' LIMIT 1")
    ).scalar()
    if existing:
        return
    bind.execute(
        sa.text(
            """
            INSERT INTO job_definitions (key, description, arg_schema, timeout_seconds, max_attempts, is_active, created_at, updated_at)
            VALUES (
                'build-embeddings',
                'Generate image embeddings for visual similarity search',
                '{"type": "object", "properties": {"force": {"type": "boolean"}}, "additionalProperties": true}'::jsonb,
                10800,
                2,
                true,
                now(),
                now()
            )
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text("DELETE FROM job_definitions WHERE key = 'build-embeddings'")
    )
