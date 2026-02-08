"""add_asset_id_to_image_embeddings

Revision ID: 202602081730
Revises: 202602081630
Create Date: 2026-02-08 17:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "202602081730"
down_revision: Union[str, None] = "202602081630"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "image_embeddings",
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index("idx_image_embeddings_asset_id", "image_embeddings", ["asset_id"])
    op.create_index(
        "idx_image_embeddings_tenant_asset_model",
        "image_embeddings",
        ["tenant_id", "asset_id", "model_name"],
    )
    op.execute(
        """
        ALTER TABLE image_embeddings
        ADD CONSTRAINT fk_image_embeddings_asset_id_assets
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL
        NOT VALID
        """
    )


def downgrade() -> None:
    op.drop_constraint("fk_image_embeddings_asset_id_assets", "image_embeddings", type_="foreignkey")
    op.drop_index("idx_image_embeddings_tenant_asset_model", table_name="image_embeddings")
    op.drop_index("idx_image_embeddings_asset_id", table_name="image_embeddings")
    op.drop_column("image_embeddings", "asset_id")
