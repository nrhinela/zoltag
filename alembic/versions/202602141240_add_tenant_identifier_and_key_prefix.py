"""add_tenant_identifier_and_key_prefix

Revision ID: 202602141240
Revises: 202602141120
Create Date: 2026-02-14 12:40:00.000000

Add editable tenant identifier and immutable key prefix for secret/object naming.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "202602141240"
down_revision: Union[str, None] = "202602141120"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tenants", sa.Column("identifier", sa.String(length=255), nullable=True))
    op.add_column("tenants", sa.Column("key_prefix", sa.String(length=255), nullable=True))

    op.execute(
        """
        CREATE OR REPLACE FUNCTION set_tenants_identifier_defaults()
        RETURNS trigger AS $$
        BEGIN
            IF NEW.identifier IS NULL OR btrim(NEW.identifier) = '' THEN
                NEW.identifier := NEW.id;
            END IF;
            IF NEW.key_prefix IS NULL OR btrim(NEW.key_prefix) = '' THEN
                NEW.key_prefix := NEW.id;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_tenants_fill_identifier_defaults
        BEFORE INSERT
        ON tenants
        FOR EACH ROW
        EXECUTE FUNCTION set_tenants_identifier_defaults();
        """
    )

    op.execute("UPDATE tenants SET identifier = id WHERE identifier IS NULL")
    op.execute("UPDATE tenants SET key_prefix = id WHERE key_prefix IS NULL")

    op.alter_column("tenants", "identifier", nullable=False)
    op.alter_column("tenants", "key_prefix", nullable=False)

    op.create_index("idx_tenants_identifier", "tenants", ["identifier"], unique=True)
    op.create_index("idx_tenants_key_prefix", "tenants", ["key_prefix"], unique=True)

    op.execute(
        """
        CREATE OR REPLACE FUNCTION prevent_tenants_key_prefix_update()
        RETURNS trigger AS $$
        BEGIN
            IF NEW.key_prefix IS DISTINCT FROM OLD.key_prefix THEN
                RAISE EXCEPTION 'tenants.key_prefix is immutable';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )

    op.execute(
        """
        CREATE TRIGGER trg_tenants_key_prefix_immutable
        BEFORE UPDATE OF key_prefix
        ON tenants
        FOR EACH ROW
        EXECUTE FUNCTION prevent_tenants_key_prefix_update();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_tenants_fill_identifier_defaults ON tenants")
    op.execute("DROP FUNCTION IF EXISTS set_tenants_identifier_defaults()")

    op.execute("DROP TRIGGER IF EXISTS trg_tenants_key_prefix_immutable ON tenants")
    op.execute("DROP FUNCTION IF EXISTS prevent_tenants_key_prefix_update()")

    op.drop_index("idx_tenants_key_prefix", table_name="tenants")
    op.drop_index("idx_tenants_identifier", table_name="tenants")

    op.drop_column("tenants", "key_prefix")
    op.drop_column("tenants", "identifier")
