"""drop_image_embeddings_image_id

Revision ID: 202602082320
Revises: 202602082310
Create Date: 2026-02-08 23:20:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "202602082320"
down_revision: Union[str, None] = "202602082310"
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
            FROM image_embeddings
            WHERE asset_id IS NULL;
            IF v_count > 0 THEN
                RAISE EXCEPTION
                    'Cannot drop image_embeddings.image_id: % rows have NULL asset_id',
                    v_count;
            END IF;
        END
        $$;
        """
    )

    op.drop_column("image_embeddings", "image_id")


def downgrade() -> None:
    op.execute("SET LOCAL statement_timeout = 0")
    op.execute("SET LOCAL lock_timeout = '30s'")

    op.add_column("image_embeddings", sa.Column("image_id", sa.Integer(), nullable=True))

    op.execute(
        """
        UPDATE image_embeddings ie
        SET image_id = im.id
        FROM image_metadata im
        WHERE im.asset_id = ie.asset_id
          AND ie.image_id IS NULL
        """
    )

    op.execute(
        """
        DO $$
        DECLARE
            v_count bigint;
        BEGIN
            SELECT count(*) INTO v_count
            FROM image_embeddings
            WHERE image_id IS NULL;
            IF v_count > 0 THEN
                RAISE EXCEPTION
                    'Cannot restore image_embeddings.image_id: % rows failed asset_id -> image_id mapping',
                    v_count;
            END IF;
        END
        $$;
        """
    )

    op.alter_column("image_embeddings", "image_id", existing_type=sa.Integer(), nullable=False)
    op.create_foreign_key(
        "fk_image_embeddings_image_id_image_metadata",
        "image_embeddings",
        "image_metadata",
        ["image_id"],
        ["id"],
    )
    op.create_unique_constraint(
        "uq_image_embeddings_image_id",
        "image_embeddings",
        ["image_id"],
    )

