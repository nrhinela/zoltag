"""add sync-flickr job definition

Revision ID: 202603011100
Revises: 202602281530
Create Date: 2026-03-01 11:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "202603011100"
down_revision: Union[str, None] = "202602281530"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_SYNC_ARG_SCHEMA = (
    '{"type": "object", "properties": {"count": {"type": "integer"}, '
    '"reprocess_existing": {"type": "boolean"}, "provider_id": {"type": "string"}}, '
    '"additionalProperties": true}'
)


def _insert_if_missing(bind, *, key: str, description: str) -> None:
    existing = bind.execute(
        sa.text("SELECT id FROM job_definitions WHERE key = :key LIMIT 1"),
        {"key": key},
    ).scalar()
    if existing:
        return

    if bind.dialect.name == "postgresql":
        bind.execute(
            sa.text(
                """
                INSERT INTO job_definitions (key, description, arg_schema, timeout_seconds, max_attempts, is_active, created_at, updated_at)
                VALUES (
                    :key,
                    :description,
                    CAST(:arg_schema AS jsonb),
                    7200,
                    2,
                    true,
                    now(),
                    now()
                )
                """
            ),
            {"key": key, "description": description, "arg_schema": _SYNC_ARG_SCHEMA},
        )
        return

    bind.execute(
        sa.text(
            """
            INSERT INTO job_definitions (key, description, arg_schema, timeout_seconds, max_attempts, is_active, created_at, updated_at)
            VALUES (
                :key,
                :description,
                :arg_schema,
                7200,
                2,
                true,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            )
            """
        ),
        {"key": key, "description": description, "arg_schema": _SYNC_ARG_SCHEMA},
    )


def upgrade() -> None:
    bind = op.get_bind()
    _insert_if_missing(
        bind,
        key="sync-flickr",
        description="Sync media from Flickr",
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text("DELETE FROM job_definitions WHERE key = 'sync-flickr'")
    )
