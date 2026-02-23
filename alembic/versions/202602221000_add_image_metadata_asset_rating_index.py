"""add image_metadata asset_id rating index for stats join

Revision ID: 202602221000
Revises: 202602211400
Create Date: 2026-02-22 10:00:00.000000
"""

from typing import Sequence, Union

from alembic import op


revision: str = "202602221000"
down_revision: Union[str, None] = "202602211400"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "idx_image_metadata_asset_rating",
        "image_metadata",
        ["asset_id", "rating"],
        postgresql_where="rating IS NOT NULL",
    )


def downgrade() -> None:
    op.drop_index("idx_image_metadata_asset_rating", table_name="image_metadata")
