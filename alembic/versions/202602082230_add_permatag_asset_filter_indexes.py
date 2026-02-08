"""add_permatag_asset_filter_indexes

Revision ID: 202602082230
Revises: 202602082130
Create Date: 2026-02-08 22:30:00.000000
"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "202602082230"
down_revision: Union[str, None] = "202602082130"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # These are additive indexes for asset-first permatag filtering paths.
    op.execute("SET LOCAL statement_timeout = 0")
    op.execute("SET LOCAL lock_timeout = '30s'")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_permatag_tenant_signum_asset "
        "ON permatags (tenant_id, signum, asset_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_permatag_tenant_asset "
        "ON permatags (tenant_id, asset_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_permatag_tenant_asset")
    op.execute("DROP INDEX IF EXISTS idx_permatag_tenant_signum_asset")

