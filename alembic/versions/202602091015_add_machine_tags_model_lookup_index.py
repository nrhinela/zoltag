"""add_machine_tags_model_lookup_index

Revision ID: 202602091015
Revises: 202602082340
Create Date: 2026-02-09 10:15:00.000000
"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "202602091015"
down_revision: Union[str, None] = "202602082340"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("SET LOCAL statement_timeout = 0")
    op.execute("SET LOCAL lock_timeout = '30s'")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_machine_tags_tenant_type_keyword_model_asset "
        "ON machine_tags (tenant_id, tag_type, keyword_id, model_name, asset_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_machine_tags_tenant_type_keyword_model_asset")
