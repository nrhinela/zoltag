"""enforce_asset_id_on_tags_and_lists

Revision ID: 202602082000
Revises: 202602081930
Create Date: 2026-02-08 20:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "202602082000"
down_revision: Union[str, None] = "202602081930"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("SET LOCAL statement_timeout = 0")
    op.execute("SET LOCAL lock_timeout = '30s'")

    # Preflight checks: fail with explicit counts before tightening nullability.
    op.execute(
        """
        DO $$
        DECLARE
            v_count bigint;
        BEGIN
            SELECT count(*) INTO v_count
            FROM permatags
            WHERE asset_id IS NULL;
            IF v_count > 0 THEN
                RAISE EXCEPTION
                    'Cannot enforce permatags.asset_id NOT NULL: % rows are NULL',
                    v_count;
            END IF;

            SELECT count(*) INTO v_count
            FROM machine_tags
            WHERE asset_id IS NULL;
            IF v_count > 0 THEN
                RAISE EXCEPTION
                    'Cannot enforce machine_tags.asset_id NOT NULL: % rows are NULL',
                    v_count;
            END IF;

            SELECT count(*) INTO v_count
            FROM photo_list_items
            WHERE asset_id IS NULL;
            IF v_count > 0 THEN
                RAISE EXCEPTION
                    'Cannot enforce photo_list_items.asset_id NOT NULL: % rows are NULL',
                    v_count;
            END IF;
        END
        $$;
        """
    )

    # Ensure FK constraints remain validated before strict mode.
    op.execute("ALTER TABLE permatags VALIDATE CONSTRAINT fk_permatags_asset_id_assets")
    op.execute("ALTER TABLE machine_tags VALIDATE CONSTRAINT fk_machine_tags_asset_id_assets")
    op.execute("ALTER TABLE photo_list_items VALIDATE CONSTRAINT fk_photo_list_items_asset_id_assets")

    # Enforce strict bridge nullability.
    op.alter_column("permatags", "asset_id", existing_type=sa.UUID(), nullable=False)
    op.alter_column("machine_tags", "asset_id", existing_type=sa.UUID(), nullable=False)
    op.alter_column("photo_list_items", "asset_id", existing_type=sa.UUID(), nullable=False)


def downgrade() -> None:
    op.alter_column("photo_list_items", "asset_id", existing_type=sa.UUID(), nullable=True)
    op.alter_column("machine_tags", "asset_id", existing_type=sa.UUID(), nullable=True)
    op.alter_column("permatags", "asset_id", existing_type=sa.UUID(), nullable=True)
