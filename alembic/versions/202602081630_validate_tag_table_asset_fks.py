"""validate_tag_table_asset_fks

Revision ID: 202602081630
Revises: 202602081530
Create Date: 2026-02-08 16:30:00.000000
"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "202602081630"
down_revision: Union[str, None] = "202602081530"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("SET LOCAL statement_timeout = 0")
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute(
        "ALTER TABLE permatags VALIDATE CONSTRAINT fk_permatags_asset_id_assets"
    )
    op.execute(
        "ALTER TABLE machine_tags VALIDATE CONSTRAINT fk_machine_tags_asset_id_assets"
    )


def downgrade() -> None:
    # PostgreSQL has no UNVALIDATE operation.
    pass
