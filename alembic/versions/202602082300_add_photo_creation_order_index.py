"""add_photo_creation_order_index

Revision ID: 202602082300
Revises: 202602082230
Create Date: 2026-02-08 23:00:00.000000
"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "202602082300"
down_revision: Union[str, None] = "202602082230"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("SET LOCAL statement_timeout = 0")
    op.execute("SET LOCAL lock_timeout = '30s'")
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_image_metadata_tenant_photo_creation_order
        ON image_metadata (
            tenant_id,
            COALESCE(capture_timestamp, modified_time) DESC,
            id DESC
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_image_metadata_tenant_photo_creation_order")

