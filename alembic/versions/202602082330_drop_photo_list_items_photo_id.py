"""drop_photo_list_items_photo_id

Revision ID: 202602082330
Revises: 202602082320
Create Date: 2026-02-08 23:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "202602082330"
down_revision: Union[str, None] = "202602082320"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("SET LOCAL statement_timeout = 0")
    op.execute("SET LOCAL lock_timeout = '30s'")

    op.execute(
        """
        DO $$
        DECLARE
            v_count bigint;
        BEGIN
            SELECT count(*) INTO v_count
            FROM photo_list_items
            WHERE asset_id IS NULL;
            IF v_count > 0 THEN
                RAISE EXCEPTION
                    'Cannot drop photo_list_items.photo_id: % rows have NULL asset_id',
                    v_count;
            END IF;
        END
        $$;
        """
    )

    op.execute("DROP INDEX IF EXISTS idx_photo_list_items_list_photo")
    op.execute("DROP INDEX IF EXISTS ix_photo_list_items_photo_id")
    op.drop_column("photo_list_items", "photo_id")


def downgrade() -> None:
    op.execute("SET LOCAL statement_timeout = 0")
    op.execute("SET LOCAL lock_timeout = '30s'")

    op.add_column("photo_list_items", sa.Column("photo_id", sa.Integer(), nullable=True))
    op.execute(
        """
        UPDATE photo_list_items pli
        SET photo_id = im.id
        FROM image_metadata im
        WHERE im.asset_id = pli.asset_id
          AND pli.photo_id IS NULL
        """
    )
    op.execute(
        """
        DO $$
        DECLARE
            v_count bigint;
        BEGIN
            SELECT count(*) INTO v_count
            FROM photo_list_items
            WHERE photo_id IS NULL;
            IF v_count > 0 THEN
                RAISE EXCEPTION
                    'Cannot restore photo_list_items.photo_id: % rows failed asset_id -> image_id mapping',
                    v_count;
            END IF;
        END
        $$;
        """
    )
    op.alter_column("photo_list_items", "photo_id", existing_type=sa.Integer(), nullable=False)
    op.create_index("ix_photo_list_items_photo_id", "photo_list_items", ["photo_id"])
    op.create_index("idx_photo_list_items_list_photo", "photo_list_items", ["list_id", "photo_id"])

