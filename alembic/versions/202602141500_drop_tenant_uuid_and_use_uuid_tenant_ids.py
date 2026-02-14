"""drop_tenant_uuid_and_use_uuid_tenant_ids

Revision ID: 202602141500
Revises: 202602141330
Create Date: 2026-02-14 15:00:00.000000

Convert tenant identifiers to native UUID columns and remove redundant tenant_uuid
columns across tenant-scoped tables.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "202602141500"
down_revision: Union[str, None] = "202602141330"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TENANT_ID_TABLES: list[str] = [
    "people",
    "assets",
    "image_metadata",
    "permatags",
    "detected_faces",
    "dropbox_cursors",
    "image_embeddings",
    "keyword_models",
    "machine_tags",
    "keyword_categories",
    "keywords",
    "photo_lists",
    "user_tenants",
    "invitations",
]

TENANT_UUID_TABLES: list[str] = [
    "tenants",
    *TENANT_ID_TABLES,
]


def _capture_tenant_fk_defs(temp_table: str) -> None:
    op.execute(
        f"""
        CREATE TEMP TABLE {temp_table} ON COMMIT DROP AS
        SELECT
            conrelid::regclass::text AS table_name,
            conname,
            pg_get_constraintdef(oid) AS constraint_def
        FROM pg_constraint
        WHERE contype = 'f' AND confrelid = 'tenants'::regclass;
        """
    )


def _drop_captured_tenant_fks(temp_table: str) -> None:
    op.execute(
        f"""
        DO $$
        DECLARE rec RECORD;
        BEGIN
            FOR rec IN SELECT table_name, conname FROM {temp_table}
            LOOP
                EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', rec.table_name, rec.conname);
            END LOOP;
        END;
        $$;
        """
    )


def _restore_captured_tenant_fks(temp_table: str) -> None:
    op.execute(
        f"""
        DO $$
        DECLARE rec RECORD;
        BEGIN
            FOR rec IN SELECT table_name, conname, constraint_def FROM {temp_table}
            LOOP
                EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', rec.table_name, rec.conname, rec.constraint_def);
            END LOOP;
        END;
        $$;
        """
    )


def _drop_tenant_uuid_sync_triggers() -> None:
    for table_name in TENANT_ID_TABLES:
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table_name}_set_tenant_uuid ON {table_name}")
    op.execute("DROP FUNCTION IF EXISTS set_tenant_uuid_from_tenant_id()")


def _drop_tenant_admin_invitation_policy() -> None:
    op.execute('DROP POLICY IF EXISTS "Tenant admins can manage invitations" ON invitations')


def _restore_tenant_admin_invitation_policy() -> None:
    op.execute(
        """
        CREATE POLICY "Tenant admins can manage invitations"
        ON invitations
        FOR ALL
        USING (
            EXISTS (
                SELECT 1
                FROM user_tenants ut
                WHERE ut.supabase_uid = auth.uid()
                  AND ut.tenant_id::text = invitations.tenant_id::text
                  AND ut.role::text = 'admin'
                  AND ut.accepted_at IS NOT NULL
            )
        )
        """
    )


def _alter_tenant_id_columns_to_uuid() -> None:
    for table_name in TENANT_ID_TABLES:
        op.alter_column(
            table_name,
            "tenant_id",
            type_=postgresql.UUID(as_uuid=True),
            postgresql_using="tenant_id::uuid",
        )


def _alter_tenant_id_columns_to_text() -> None:
    for table_name in TENANT_ID_TABLES:
        op.alter_column(
            table_name,
            "tenant_id",
            type_=sa.String(length=255),
            postgresql_using="tenant_id::text",
        )


def _drop_tenant_uuid_columns() -> None:
    for table_name in TENANT_UUID_TABLES:
        op.execute(f"ALTER TABLE {table_name} DROP COLUMN IF EXISTS tenant_uuid")


def _add_tenant_uuid_columns() -> None:
    op.add_column("tenants", sa.Column("tenant_uuid", postgresql.UUID(as_uuid=True), nullable=True))
    op.execute("UPDATE tenants SET tenant_uuid = id")
    op.alter_column("tenants", "tenant_uuid", nullable=False)
    op.create_index("idx_tenants_tenant_uuid", "tenants", ["tenant_uuid"], unique=True)

    for table_name in TENANT_ID_TABLES:
        op.add_column(table_name, sa.Column("tenant_uuid", postgresql.UUID(as_uuid=True), nullable=True))
        op.execute(
            f"""
            UPDATE {table_name} AS target
            SET tenant_uuid = tenants.tenant_uuid
            FROM tenants
            WHERE target.tenant_id = tenants.id
            """
        )
        op.create_index(f"idx_{table_name}_tenant_uuid", table_name, ["tenant_uuid"], unique=False)


def _restore_tenant_uuid_sync_triggers() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION set_tenant_uuid_from_tenant_id()
        RETURNS trigger AS $$
        BEGIN
            IF NEW.tenant_id IS NULL THEN
                NEW.tenant_uuid := NULL;
                RETURN NEW;
            END IF;
            IF NEW.tenant_uuid IS NULL THEN
                SELECT tenant_uuid
                INTO NEW.tenant_uuid
                FROM tenants
                WHERE id = NEW.tenant_id
                LIMIT 1;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )

    for table_name in TENANT_ID_TABLES:
        op.execute(
            f"""
            CREATE TRIGGER trg_{table_name}_set_tenant_uuid
            BEFORE INSERT OR UPDATE OF tenant_id, tenant_uuid
            ON {table_name}
            FOR EACH ROW
            EXECUTE FUNCTION set_tenant_uuid_from_tenant_id();
            """
        )


def upgrade() -> None:
    op.execute("SET LOCAL statement_timeout = 0")
    op.execute("SET LOCAL lock_timeout = 0")

    # Legacy btree index on ARRAY column can exceed tuple-size limits during rewrites.
    op.execute("DROP INDEX IF EXISTS idx_image_embeddings_tenant_embedding")

    _drop_tenant_uuid_sync_triggers()
    _drop_tenant_admin_invitation_policy()
    op.execute("ALTER TABLE tenants DROP CONSTRAINT IF EXISTS ck_tenants_id_matches_tenant_uuid")

    _capture_tenant_fk_defs("_tenant_fk_defs_uuid_cutover")
    _drop_captured_tenant_fks("_tenant_fk_defs_uuid_cutover")

    _alter_tenant_id_columns_to_uuid()
    op.alter_column("tenants", "id", server_default=None)
    op.alter_column(
        "tenants",
        "id",
        type_=postgresql.UUID(as_uuid=True),
        postgresql_using="id::uuid",
    )
    op.alter_column(
        "tenants",
        "id",
        server_default=sa.text("gen_random_uuid()"),
        existing_type=postgresql.UUID(as_uuid=True),
    )

    _restore_captured_tenant_fks("_tenant_fk_defs_uuid_cutover")
    _restore_tenant_admin_invitation_policy()
    _drop_tenant_uuid_columns()


def downgrade() -> None:
    op.execute("SET LOCAL statement_timeout = 0")
    op.execute("SET LOCAL lock_timeout = 0")

    _drop_tenant_admin_invitation_policy()
    _capture_tenant_fk_defs("_tenant_fk_defs_uuid_downgrade")
    _drop_captured_tenant_fks("_tenant_fk_defs_uuid_downgrade")

    _alter_tenant_id_columns_to_text()
    op.alter_column("tenants", "id", server_default=None)
    op.alter_column(
        "tenants",
        "id",
        type_=sa.String(length=255),
        postgresql_using="id::text",
    )
    op.alter_column(
        "tenants",
        "id",
        server_default=sa.text("gen_random_uuid()::text"),
        existing_type=sa.String(length=255),
    )

    _add_tenant_uuid_columns()
    _restore_captured_tenant_fks("_tenant_fk_defs_uuid_downgrade")
    _restore_tenant_admin_invitation_policy()
    _restore_tenant_uuid_sync_triggers()

    op.create_check_constraint(
        "ck_tenants_id_matches_tenant_uuid",
        "tenants",
        "id::uuid = tenant_uuid",
    )
