"""add_asset_id_to_tag_tables

Revision ID: 202602081530
Revises: 202602081430
Create Date: 2026-02-08 15:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "202602081530"
down_revision: Union[str, None] = "202602081430"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "permatags",
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index("idx_permatag_asset_id", "permatags", ["asset_id"])
    op.create_index(
        "idx_permatag_tenant_keyword_signum_asset",
        "permatags",
        ["tenant_id", "keyword_id", "signum", "asset_id"],
    )
    op.execute(
        """
        ALTER TABLE permatags
        ADD CONSTRAINT fk_permatags_asset_id_assets
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL
        NOT VALID
        """
    )

    op.add_column(
        "machine_tags",
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index("idx_machine_tags_asset_id", "machine_tags", ["asset_id"])
    op.create_index(
        "idx_machine_tags_tenant_type_keyword_asset",
        "machine_tags",
        ["tenant_id", "tag_type", "keyword_id", "asset_id"],
    )
    op.execute(
        """
        ALTER TABLE machine_tags
        ADD CONSTRAINT fk_machine_tags_asset_id_assets
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL
        NOT VALID
        """
    )


def downgrade() -> None:
    op.drop_constraint("fk_machine_tags_asset_id_assets", "machine_tags", type_="foreignkey")
    op.drop_index("idx_machine_tags_tenant_type_keyword_asset", table_name="machine_tags")
    op.drop_index("idx_machine_tags_asset_id", table_name="machine_tags")
    op.drop_column("machine_tags", "asset_id")

    op.drop_constraint("fk_permatags_asset_id_assets", "permatags", type_="foreignkey")
    op.drop_index("idx_permatag_tenant_keyword_signum_asset", table_name="permatags")
    op.drop_index("idx_permatag_asset_id", table_name="permatags")
    op.drop_column("permatags", "asset_id")
