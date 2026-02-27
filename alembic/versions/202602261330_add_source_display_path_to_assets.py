"""add source_display_path to assets

Revision ID: 202602261330
Revises: 202602261200
Create Date: 2026-02-26 13:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "202602261330"
down_revision: Union[str, None] = "202602261200"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("assets", sa.Column("source_display_path", sa.String(2048), nullable=True))
    # Backfill Dropbox: source_key is already the human-readable display path
    op.execute(
        "UPDATE assets SET source_display_path = source_key "
        "WHERE source_provider = 'dropbox' AND source_display_path IS NULL"
    )
    op.create_index(
        "idx_assets_source_display_path",
        "assets",
        ["tenant_id", "source_provider", "source_display_path"],
    )


def downgrade() -> None:
    op.drop_index("idx_assets_source_display_path", table_name="assets")
    op.drop_column("assets", "source_display_path")
