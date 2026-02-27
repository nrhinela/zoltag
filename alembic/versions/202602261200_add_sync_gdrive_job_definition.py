"""add sync-gdrive job definition

Revision ID: 202602261200
Revises: 202602241030
Create Date: 2026-02-26 12:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "202602261200"
down_revision: Union[str, None] = "202602241030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = bind.execute(
        sa.text("SELECT id FROM job_definitions WHERE key = 'sync-gdrive' LIMIT 1")
    ).scalar()
    if existing:
        return
    bind.execute(
        sa.text(
            """
            INSERT INTO job_definitions (key, description, arg_schema, timeout_seconds, max_attempts, is_active, created_at, updated_at)
            VALUES (
                'sync-gdrive',
                'Sync images from Google Drive to GCP Cloud Storage',
                '{"type": "object", "properties": {"count": {"type": "integer"}, "reprocess_existing": {"type": "boolean"}}, "additionalProperties": true}'::jsonb,
                7200,
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
        sa.text("DELETE FROM job_definitions WHERE key = 'sync-gdrive'")
    )
