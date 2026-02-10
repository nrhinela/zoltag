"""add_machine_tags_tenant_type_asset_index

Revision ID: 202602091200
Revises: 202602091015
Create Date: 2026-02-09 12:00:00.000000

Fixes slow COUNT(DISTINCT asset_id) stats queries on machine_tags.
The planner was using MACHINE_TAGS_TAG_TYPE_IDX (tag_type only), reading
all rows for a tag_type across all tenants, then filtering by tenant_id.
This index puts tenant_id first so the scan is scoped to the tenant,
and includes asset_id as a covering column for COUNT(DISTINCT).
"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "202602091200"
down_revision: Union[str, None] = "202602091015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.create_index(
            "idx_machine_tags_tenant_type_asset",
            "machine_tags",
            ["tenant_id", "tag_type", "asset_id"],
            postgresql_concurrently=True,
            if_not_exists=True,
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.drop_index(
            "idx_machine_tags_tenant_type_asset",
            table_name="machine_tags",
            postgresql_concurrently=True,
            if_exists=True,
        )
