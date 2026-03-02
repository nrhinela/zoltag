"""add sync-providers job definition

Revision ID: 202603021000
Revises: 202603011110
Create Date: 2026-03-02 10:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "202603021000"
down_revision: Union[str, None] = "202603011110"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ARG_SCHEMA = (
    '{"type": "object", "properties": {"count": {"type": "integer"}, '
    '"reprocess_existing": {"type": "boolean"}}, '
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
                    14400,
                    2,
                    true,
                    now(),
                    now()
                )
                """
            ),
            {"key": key, "description": description, "arg_schema": _ARG_SCHEMA},
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
                14400,
                2,
                true,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            )
            """
        ),
        {"key": key, "description": description, "arg_schema": _ARG_SCHEMA},
    )


def upgrade() -> None:
    bind = op.get_bind()
    _insert_if_missing(
        bind,
        key="sync-providers",
        description=(
            "Sequentially sync all active connected providers for a tenant and, "
            "when new assets are added, run build-embeddings and rebuild-asset-text-index"
        ),
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text("DELETE FROM job_definitions WHERE key = 'sync-providers'")
    )
