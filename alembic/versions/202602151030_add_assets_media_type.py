"""add_assets_media_type

Revision ID: 202602151030
Revises: 202602142020
Create Date: 2026-02-15 10:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "202602151030"
down_revision: Union[str, None] = "202602142020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "assets",
        sa.Column(
            "media_type",
            sa.String(length=16),
            nullable=True,
            server_default=sa.text("'image'"),
        ),
    )

    op.execute(
        """
        UPDATE assets
        SET media_type = CASE
            WHEN lower(COALESCE(mime_type, '')) LIKE 'video/%' THEN 'video'
            ELSE 'image'
        END
        """
    )

    op.alter_column("assets", "media_type", nullable=False)
    op.create_check_constraint(
        "ck_assets_media_type",
        "assets",
        "media_type IN ('image', 'video')",
    )
    op.create_index(
        "idx_assets_tenant_media_type",
        "assets",
        ["tenant_id", "media_type"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_assets_tenant_media_type", table_name="assets")
    op.drop_constraint("ck_assets_media_type", "assets", type_="check")
    op.drop_column("assets", "media_type")
