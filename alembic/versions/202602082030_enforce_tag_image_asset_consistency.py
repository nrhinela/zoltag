"""enforce_tag_image_asset_consistency

Revision ID: 202602082030
Revises: 202602082000
Create Date: 2026-02-08 20:30:00.000000
"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "202602082030"
down_revision: Union[str, None] = "202602082000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("SET LOCAL statement_timeout = 0")
    op.execute("SET LOCAL lock_timeout = '30s'")

    # Preflight: fail if any existing rows are inconsistent with image_metadata bridge.
    op.execute(
        """
        DO $$
        DECLARE
            v_count bigint;
        BEGIN
            SELECT count(*) INTO v_count
            FROM machine_tags t
            JOIN image_metadata im ON im.id = t.image_id
            WHERE t.asset_id IS DISTINCT FROM im.asset_id
               OR t.tenant_id IS DISTINCT FROM im.tenant_id;
            IF v_count > 0 THEN
                RAISE EXCEPTION
                    'Cannot enforce machine_tags consistency: % rows have image_id/asset_id/tenant_id mismatch',
                    v_count;
            END IF;

            SELECT count(*) INTO v_count
            FROM permatags t
            JOIN image_metadata im ON im.id = t.image_id
            WHERE t.asset_id IS DISTINCT FROM im.asset_id
               OR t.tenant_id IS DISTINCT FROM im.tenant_id;
            IF v_count > 0 THEN
                RAISE EXCEPTION
                    'Cannot enforce permatags consistency: % rows have image_id/asset_id/tenant_id mismatch',
                    v_count;
            END IF;
        END
        $$;
        """
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

            -- Allow future asset-first writes while image_id is still present.
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


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_machine_tags_image_asset_consistency ON machine_tags")
    op.execute("DROP TRIGGER IF EXISTS trg_permatags_image_asset_consistency ON permatags")
    op.execute("DROP FUNCTION IF EXISTS enforce_tag_image_asset_consistency()")
