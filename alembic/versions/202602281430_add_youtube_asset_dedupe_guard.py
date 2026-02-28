"""add DB guard to prevent new duplicate YouTube assets

Revision ID: 202602281430
Revises: 202602281100
Create Date: 2026-02-28 14:30:00.000000
"""

from typing import Sequence, Union

from alembic import op


revision: str = "202602281430"
down_revision: Union[str, None] = "202602281100"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute(
        """
        CREATE OR REPLACE FUNCTION prevent_duplicate_youtube_asset_insert()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            IF lower(coalesce(NEW.source_provider, '')) = 'youtube' THEN
                PERFORM pg_advisory_xact_lock(
                    hashtext(NEW.tenant_id::text),
                    hashtext(lower(coalesce(NEW.source_key, '')))
                );

                IF EXISTS (
                    SELECT 1
                    FROM assets a
                    WHERE a.tenant_id = NEW.tenant_id
                      AND lower(coalesce(a.source_provider, '')) = 'youtube'
                      AND a.source_key = NEW.source_key
                ) THEN
                    RAISE EXCEPTION
                        USING ERRCODE = '23505',
                              MESSAGE = format(
                                  'duplicate YouTube asset blocked for tenant=%s source_key=%s',
                                  NEW.tenant_id,
                                  coalesce(NEW.source_key, '<null>')
                              );
                END IF;
            END IF;

            RETURN NEW;
        END;
        $$;
        """
    )
    op.execute("DROP TRIGGER IF EXISTS trg_prevent_duplicate_youtube_asset_insert ON assets")
    op.execute(
        """
        CREATE TRIGGER trg_prevent_duplicate_youtube_asset_insert
        BEFORE INSERT ON assets
        FOR EACH ROW
        EXECUTE FUNCTION prevent_duplicate_youtube_asset_insert()
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute("DROP TRIGGER IF EXISTS trg_prevent_duplicate_youtube_asset_insert ON assets")
    op.execute("DROP FUNCTION IF EXISTS prevent_duplicate_youtube_asset_insert()")
