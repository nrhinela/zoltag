"""add_image_metadata_asset_id_bridge

Revision ID: 202602081130
Revises: 202602081000
Create Date: 2026-02-08 11:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "202602081130"
down_revision: Union[str, None] = "202602081000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "image_metadata",
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index("idx_image_metadata_asset_id", "image_metadata", ["asset_id"])

    # NOT VALID avoids a full table scan lock during this bridge migration.
    op.execute(
        """
        ALTER TABLE image_metadata
        ADD CONSTRAINT fk_image_metadata_asset_id_assets
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL
        NOT VALID
        """
    )


def downgrade() -> None:
    op.drop_constraint("fk_image_metadata_asset_id_assets", "image_metadata", type_="foreignkey")
    op.drop_index("idx_image_metadata_asset_id", table_name="image_metadata")
    op.drop_column("image_metadata", "asset_id")
