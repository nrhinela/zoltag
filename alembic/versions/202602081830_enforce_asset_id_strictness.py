"""enforce_asset_id_strictness

Revision ID: 202602081830
Revises: 202602081730
Create Date: 2026-02-08 18:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "202602081830"
down_revision: Union[str, None] = "202602081730"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("SET LOCAL statement_timeout = 0")
    op.execute("SET LOCAL lock_timeout = '5s'")

    # Preflight checks: fail fast with actionable errors before strict constraints.
    op.execute(
        """
        DO $$
        DECLARE
            v_count bigint;
        BEGIN
            SELECT count(*) INTO v_count
            FROM image_metadata
            WHERE asset_id IS NULL;
            IF v_count > 0 THEN
                RAISE EXCEPTION
                    'Cannot enforce strict asset_id: image_metadata has % rows with NULL asset_id',
                    v_count;
            END IF;

            SELECT count(*) INTO v_count
            FROM (
                SELECT asset_id
                FROM image_metadata
                GROUP BY asset_id
                HAVING count(*) > 1
            ) dup;
            IF v_count > 0 THEN
                RAISE EXCEPTION
                    'Cannot enforce strict asset_id: image_metadata has % duplicate asset_id values',
                    v_count;
            END IF;

            SELECT count(*) INTO v_count
            FROM image_embeddings ie
            LEFT JOIN image_metadata im ON im.id = ie.image_id
            WHERE im.id IS NULL;
            IF v_count > 0 THEN
                RAISE EXCEPTION
                    'Cannot enforce strict asset_id: image_embeddings has % rows referencing missing image_metadata rows',
                    v_count;
            END IF;

            SELECT count(*) INTO v_count
            FROM image_embeddings
            WHERE asset_id IS NULL;
            IF v_count > 0 THEN
                RAISE EXCEPTION
                    'Cannot enforce strict asset_id: image_embeddings has % rows with NULL asset_id',
                    v_count;
            END IF;

            SELECT count(*) INTO v_count
            FROM image_embeddings ie
            JOIN image_metadata im ON im.id = ie.image_id
            WHERE ie.asset_id IS DISTINCT FROM im.asset_id;
            IF v_count > 0 THEN
                RAISE EXCEPTION
                    'Cannot enforce strict asset_id: image_embeddings has % rows with asset_id mismatch vs image_metadata',
                    v_count;
            END IF;

            SELECT count(*) INTO v_count
            FROM (
                SELECT asset_id
                FROM image_embeddings
                GROUP BY asset_id
                HAVING count(*) > 1
            ) dup;
            IF v_count > 0 THEN
                RAISE EXCEPTION
                    'Cannot enforce strict asset_id: image_embeddings has % duplicate asset_id values',
                    v_count;
            END IF;
        END
        $$;
        """
    )

    # Ensure the FK constraints are validated before tightening nullability.
    op.execute(
        "ALTER TABLE image_metadata VALIDATE CONSTRAINT fk_image_metadata_asset_id_assets"
    )
    op.execute(
        "ALTER TABLE image_embeddings VALIDATE CONSTRAINT fk_image_embeddings_asset_id_assets"
    )

    # Enforce required 1:1 bridge columns.
    op.alter_column("image_metadata", "asset_id", existing_type=sa.UUID(), nullable=False)
    op.alter_column("image_embeddings", "asset_id", existing_type=sa.UUID(), nullable=False)

    # Replace non-unique lookup indexes with strict uniqueness guarantees.
    op.drop_index("idx_image_metadata_asset_id", table_name="image_metadata")
    op.create_index("uq_image_metadata_asset_id", "image_metadata", ["asset_id"], unique=True)

    op.drop_index("idx_image_embeddings_asset_id", table_name="image_embeddings")
    op.create_index("uq_image_embeddings_asset_id", "image_embeddings", ["asset_id"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_image_embeddings_asset_id", table_name="image_embeddings")
    op.create_index("idx_image_embeddings_asset_id", "image_embeddings", ["asset_id"], unique=False)

    op.drop_index("uq_image_metadata_asset_id", table_name="image_metadata")
    op.create_index("idx_image_metadata_asset_id", "image_metadata", ["asset_id"], unique=False)

    op.alter_column("image_embeddings", "asset_id", existing_type=sa.UUID(), nullable=True)
    op.alter_column("image_metadata", "asset_id", existing_type=sa.UUID(), nullable=True)
