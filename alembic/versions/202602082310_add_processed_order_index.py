"""add_processed_order_index

Revision ID: 202602082310
Revises: 202602082300
Create Date: 2026-02-08 23:10:00.000000
"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "202602082310"
down_revision: Union[str, None] = "202602082300"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("SET LOCAL statement_timeout = 0")
    op.execute("SET LOCAL lock_timeout = '30s'")
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_image_metadata_tenant_processed_order
        ON image_metadata (
            tenant_id,
            COALESCE(last_processed, created_at) DESC,
            id DESC
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_image_metadata_tenant_processed_order")

