"""validate_asset_bridge_foreign_keys

Revision ID: 202602081430
Revises: 202602081330
Create Date: 2026-02-08 14:30:00.000000
"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "202602081430"
down_revision: Union[str, None] = "202602081330"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Keep this migration additive and focused: only validate existing bridge FKs.
    op.execute("SET LOCAL statement_timeout = 0")
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute(
        "ALTER TABLE image_metadata VALIDATE CONSTRAINT fk_image_metadata_asset_id_assets"
    )
    op.execute(
        "ALTER TABLE photo_list_items VALIDATE CONSTRAINT fk_photo_list_items_asset_id_assets"
    )


def downgrade() -> None:
    # PostgreSQL does not support UNVALIDATE; keep downgrade as no-op.
    pass
