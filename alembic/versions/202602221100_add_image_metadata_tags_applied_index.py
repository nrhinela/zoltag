"""add image_metadata partial index on tags_applied for stats query

Revision ID: 202602221100
Revises: 202602221000
Create Date: 2026-02-22 11:00:00.000000
"""

from typing import Sequence, Union

from alembic import op


revision: str = "202602221100"
down_revision: Union[str, None] = "202602221000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "idx_image_metadata_tenant_tags_applied",
        "image_metadata",
        ["tenant_id"],
        postgresql_where="tags_applied = true",
    )


def downgrade() -> None:
    op.drop_index("idx_image_metadata_tenant_tags_applied", table_name="image_metadata")
