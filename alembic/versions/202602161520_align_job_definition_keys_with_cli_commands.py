"""align_job_definition_keys_with_cli_commands

Revision ID: 202602161520
Revises: 202602161430
Create Date: 2026-02-16 15:20:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "202602161520"
down_revision: Union[str, None] = "202602161430"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _remap_definition_key(old_key: str, new_key: str) -> None:
    bind = op.get_bind()
    old_id = bind.execute(
        sa.text("SELECT id FROM job_definitions WHERE key = :key LIMIT 1"),
        {"key": old_key},
    ).scalar()
    if old_id is None:
        return

    new_id = bind.execute(
        sa.text("SELECT id FROM job_definitions WHERE key = :key LIMIT 1"),
        {"key": new_key},
    ).scalar()

    if new_id is not None:
        bind.execute(
            sa.text("UPDATE jobs SET definition_id = :new_id WHERE definition_id = :old_id"),
            {"new_id": new_id, "old_id": old_id},
        )
        bind.execute(
            sa.text("UPDATE job_triggers SET definition_id = :new_id WHERE definition_id = :old_id"),
            {"new_id": new_id, "old_id": old_id},
        )
        bind.execute(
            sa.text("DELETE FROM job_definitions WHERE id = :old_id"),
            {"old_id": old_id},
        )
        return

    bind.execute(
        sa.text(
            """
            UPDATE job_definitions
            SET key = :new_key,
                updated_at = now()
            WHERE id = :old_id
            """
        ),
        {"new_key": new_key, "old_id": old_id},
    )


def upgrade() -> None:
    _remap_definition_key("provider.sync", "sync-dropbox")
    _remap_definition_key("training.recompute", "recompute-trained-tags")
    _remap_definition_key("zero-shot.recompute", "recompute-zeroshot-tags")
    _remap_definition_key("training.train-models", "train-keyword-models")


def downgrade() -> None:
    _remap_definition_key("sync-dropbox", "provider.sync")
    _remap_definition_key("recompute-trained-tags", "training.recompute")
    _remap_definition_key("recompute-zeroshot-tags", "zero-shot.recompute")
    _remap_definition_key("train-keyword-models", "training.train-models")
