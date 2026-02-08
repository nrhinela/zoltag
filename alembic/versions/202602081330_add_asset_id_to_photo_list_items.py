"""add_asset_id_to_photo_list_items

Revision ID: 202602081330
Revises: 202602081230
Create Date: 2026-02-08 13:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "202602081330"
down_revision: Union[str, None] = "202602081230"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "photo_list_items",
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index("idx_photo_list_items_asset_id", "photo_list_items", ["asset_id"])
    op.create_index("idx_photo_list_items_list_asset", "photo_list_items", ["list_id", "asset_id"])

    # NOT VALID avoids full-table validation and heavy locking during rollout.
    op.execute(
        """
        ALTER TABLE photo_list_items
        ADD CONSTRAINT fk_photo_list_items_asset_id_assets
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL
        NOT VALID
        """
    )


def downgrade() -> None:
    op.drop_constraint("fk_photo_list_items_asset_id_assets", "photo_list_items", type_="foreignkey")
    op.drop_index("idx_photo_list_items_list_asset", table_name="photo_list_items")
    op.drop_index("idx_photo_list_items_asset_id", table_name="photo_list_items")
    op.drop_column("photo_list_items", "asset_id")
