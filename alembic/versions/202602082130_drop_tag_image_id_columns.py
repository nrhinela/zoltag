"""drop_tag_image_id_columns

Revision ID: 202602082130
Revises: 202602082030
Create Date: 2026-02-08 21:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "202602082130"
down_revision: Union[str, None] = "202602082030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("SET LOCAL statement_timeout = 0")
    op.execute("SET LOCAL lock_timeout = '30s'")

    op.execute(
        """
        DO $$
        DECLARE
            v_permatag_dupe_count bigint;
            v_machine_dupe_count bigint;
        BEGIN
            SELECT count(*) INTO v_permatag_dupe_count
            FROM (
                SELECT asset_id, keyword_id
                FROM permatags
                GROUP BY asset_id, keyword_id
                HAVING count(*) > 1
            ) dupes;

            IF v_permatag_dupe_count > 0 THEN
                RAISE EXCEPTION
                    'Cannot drop permatags.image_id: % duplicate (asset_id, keyword_id) groups found',
                    v_permatag_dupe_count;
            END IF;

            SELECT count(*) INTO v_machine_dupe_count
            FROM (
                SELECT asset_id, keyword_id, tag_type, model_name
                FROM machine_tags
                GROUP BY asset_id, keyword_id, tag_type, model_name
                HAVING count(*) > 1
            ) dupes;

            IF v_machine_dupe_count > 0 THEN
                RAISE EXCEPTION
                    'Cannot drop machine_tags.image_id: % duplicate (asset_id, keyword_id, tag_type, model_name) groups found',
                    v_machine_dupe_count;
            END IF;
        END
        $$;
        """
    )

    op.execute("DROP TRIGGER IF EXISTS trg_machine_tags_image_asset_consistency ON machine_tags")
    op.execute("DROP TRIGGER IF EXISTS trg_permatags_image_asset_consistency ON permatags")
    op.execute("DROP FUNCTION IF EXISTS enforce_tag_image_asset_consistency()")

    op.execute("DROP INDEX IF EXISTS idx_machine_tags_per_asset")
    op.execute("DROP INDEX IF EXISTS idx_machine_tags_unique")
    op.execute("DROP INDEX IF EXISTS idx_permatag_asset_keyword_signum")
    op.execute("ALTER TABLE permatags DROP CONSTRAINT IF EXISTS uq_permatags_asset_keyword")

    op.drop_column("machine_tags", "image_id")
    op.drop_column("permatags", "image_id")

    op.create_index(
        "idx_machine_tags_per_asset",
        "machine_tags",
        ["tenant_id", "asset_id", "tag_type"],
    )
    op.create_index(
        "idx_machine_tags_unique",
        "machine_tags",
        ["asset_id", "keyword_id", "tag_type", "model_name"],
        unique=True,
    )
    op.create_index(
        "idx_permatag_asset_keyword_signum",
        "permatags",
        ["asset_id", "keyword_id", "signum"],
    )
    op.create_unique_constraint(
        "uq_permatags_asset_keyword",
        "permatags",
        ["asset_id", "keyword_id"],
    )


def downgrade() -> None:
    op.execute("SET LOCAL statement_timeout = 0")
    op.execute("SET LOCAL lock_timeout = '30s'")

    op.drop_constraint("uq_permatags_asset_keyword", "permatags", type_="unique")
    op.drop_index("idx_permatag_asset_keyword_signum", table_name="permatags")
    op.drop_index("idx_machine_tags_unique", table_name="machine_tags")
    op.drop_index("idx_machine_tags_per_asset", table_name="machine_tags")

    op.add_column("machine_tags", sa.Column("image_id", sa.Integer(), nullable=True))
    op.add_column("permatags", sa.Column("image_id", sa.Integer(), nullable=True))

    op.execute(
        """
        UPDATE machine_tags t
        SET image_id = im.id
        FROM image_metadata im
        WHERE im.asset_id = t.asset_id
          AND t.image_id IS NULL
        """
    )
    op.execute(
        """
        UPDATE permatags t
        SET image_id = im.id
        FROM image_metadata im
        WHERE im.asset_id = t.asset_id
          AND t.image_id IS NULL
        """
    )

    op.execute(
        """
        DO $$
        DECLARE
            v_machine_missing bigint;
            v_permatag_missing bigint;
        BEGIN
            SELECT count(*) INTO v_machine_missing
            FROM machine_tags
            WHERE image_id IS NULL;
            IF v_machine_missing > 0 THEN
                RAISE EXCEPTION
                    'Cannot restore machine_tags.image_id: % rows could not map from asset_id',
                    v_machine_missing;
            END IF;

            SELECT count(*) INTO v_permatag_missing
            FROM permatags
            WHERE image_id IS NULL;
            IF v_permatag_missing > 0 THEN
                RAISE EXCEPTION
                    'Cannot restore permatags.image_id: % rows could not map from asset_id',
                    v_permatag_missing;
            END IF;
        END
        $$;
        """
    )

    op.alter_column("machine_tags", "image_id", existing_type=sa.Integer(), nullable=False)
    op.alter_column("permatags", "image_id", existing_type=sa.Integer(), nullable=False)

    op.create_foreign_key(
        "fk_machine_tags_image_id_image_metadata",
        "machine_tags",
        "image_metadata",
        ["image_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_permatags_image_id_image_metadata",
        "permatags",
        "image_metadata",
        ["image_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.create_index(
        "idx_machine_tags_per_image",
        "machine_tags",
        ["tenant_id", "image_id", "tag_type"],
    )
    op.create_index(
        "idx_machine_tags_tenant_type_keyword",
        "machine_tags",
        ["tenant_id", "tag_type", "keyword_id", "image_id"],
    )
    op.create_index(
        "idx_machine_tags_unique",
        "machine_tags",
        ["image_id", "keyword_id", "tag_type", "model_name"],
        unique=True,
    )

    op.create_index("idx_permatag_image_id", "permatags", ["image_id"])
    op.create_index(
        "idx_permatag_image_keyword_signum",
        "permatags",
        ["image_id", "keyword_id", "signum"],
    )
    op.create_index(
        "idx_permatag_tenant_keyword_signum_image",
        "permatags",
        ["tenant_id", "keyword_id", "signum", "image_id"],
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION enforce_tag_image_asset_consistency()
        RETURNS trigger AS $$
        DECLARE
            v_image_id integer;
            v_image_asset_id uuid;
            v_image_tenant varchar(255);
        BEGIN
            IF NEW.image_id IS NULL AND NEW.asset_id IS NULL THEN
                RAISE EXCEPTION 'Both image_id and asset_id are NULL for %', TG_TABLE_NAME;
            END IF;

            IF NEW.image_id IS NULL THEN
                SELECT im.id, im.tenant_id
                INTO v_image_id, v_image_tenant
                FROM image_metadata im
                WHERE im.asset_id = NEW.asset_id;

                IF v_image_id IS NULL THEN
                    RAISE EXCEPTION 'No image_metadata row found for asset_id=% in %', NEW.asset_id, TG_TABLE_NAME;
                END IF;

                NEW.image_id := v_image_id;
                IF NEW.tenant_id IS NULL THEN
                    NEW.tenant_id := v_image_tenant;
                END IF;
            END IF;

            SELECT im.asset_id, im.tenant_id
            INTO v_image_asset_id, v_image_tenant
            FROM image_metadata im
            WHERE im.id = NEW.image_id;

            IF v_image_asset_id IS NULL THEN
                RAISE EXCEPTION 'No image_metadata row found for image_id=% in %', NEW.image_id, TG_TABLE_NAME;
            END IF;

            IF NEW.asset_id IS NULL THEN
                NEW.asset_id := v_image_asset_id;
            END IF;

            IF NEW.asset_id IS DISTINCT FROM v_image_asset_id THEN
                RAISE EXCEPTION
                    'asset_id mismatch for %: image_id=% expects asset_id=% but got %',
                    TG_TABLE_NAME, NEW.image_id, v_image_asset_id, NEW.asset_id;
            END IF;

            IF NEW.tenant_id IS DISTINCT FROM v_image_tenant THEN
                RAISE EXCEPTION
                    'tenant mismatch for %: image_id=% expects tenant_id=% but got %',
                    TG_TABLE_NAME, NEW.image_id, v_image_tenant, NEW.tenant_id;
            END IF;

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )

    op.execute(
        """
        CREATE TRIGGER trg_machine_tags_image_asset_consistency
        BEFORE INSERT OR UPDATE OF image_id, asset_id, tenant_id
        ON machine_tags
        FOR EACH ROW
        EXECUTE FUNCTION enforce_tag_image_asset_consistency();
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_permatags_image_asset_consistency
        BEFORE INSERT OR UPDATE OF image_id, asset_id, tenant_id
        ON permatags
        FOR EACH ROW
        EXECUTE FUNCTION enforce_tag_image_asset_consistency();
        """
    )
