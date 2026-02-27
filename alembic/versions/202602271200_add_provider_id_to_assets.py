"""add provider_id to assets

Revision ID: 202602271200
Revises: 202602261330
Create Date: 2026-02-27 12:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "202602271200"
down_revision: Union[str, None] = "202602261330"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "assets",
        sa.Column(
            "provider_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenant_provider_integrations.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "idx_assets_provider_id",
        "assets",
        ["tenant_id", "provider_id"],
    )


def downgrade() -> None:
    op.drop_index("idx_assets_provider_id", table_name="assets")
    op.drop_column("assets", "provider_id")
