"""cutover_tenant_id_to_uuid

Revision ID: 202602141330
Revises: 202602141240
Create Date: 2026-02-14 13:30:00.000000

Cut over tenant IDs to UUID values while preserving human-facing identifier
and immutable key_prefix.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "202602141330"
down_revision: Union[str, None] = "202602141240"
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

BATCH_SIZE = 5000


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


def _rewrite_table_tenant_ids(table_name: str, map_table: str, batch_size: int = BATCH_SIZE) -> None:
    bind = op.get_bind()

    while True:
        updated_rows = bind.execute(
            sa.text(
                f"""
                WITH batch AS (
                    SELECT target.ctid AS ctid, map.new_id AS new_id
                    FROM {table_name} AS target
                    JOIN {map_table} AS map ON target.tenant_id = map.old_id
                    LIMIT :batch_size
                ),
                updated AS (
                    UPDATE {table_name} AS target
                    SET tenant_id = batch.new_id
                    FROM batch
                    WHERE target.ctid = batch.ctid
                    RETURNING 1
                )
                SELECT count(*) FROM updated
                """
            ),
            {"batch_size": batch_size},
        ).scalar_one()

        if updated_rows == 0:
            break


def _rewrite_all_table_tenant_ids(map_table: str) -> None:
    for table_name in TENANT_ID_TABLES:
        _rewrite_table_tenant_ids(table_name=table_name, map_table=map_table)


def upgrade() -> None:
    op.execute("SET LOCAL statement_timeout = 0")
    op.execute("SET LOCAL lock_timeout = 0")

    op.execute(
        """
        CREATE TEMP TABLE _tenant_id_map ON COMMIT DROP AS
        SELECT id AS old_id, tenant_uuid::text AS new_id
        FROM tenants
        WHERE id IS DISTINCT FROM tenant_uuid::text;
        """
    )

    _capture_tenant_fk_defs("_tenant_fk_defs")
    _drop_captured_tenant_fks("_tenant_fk_defs")

    op.execute(
        """
        UPDATE tenants AS target
        SET id = map.new_id
        FROM _tenant_id_map AS map
        WHERE target.id = map.old_id;
        """
    )

    _rewrite_all_table_tenant_ids("_tenant_id_map")

    _restore_captured_tenant_fks("_tenant_fk_defs")

    op.alter_column(
        "tenants",
        "id",
        existing_type=sa.String(length=255),
        server_default=sa.text("gen_random_uuid()::text"),
    )

    op.execute("ALTER TABLE tenants DROP CONSTRAINT IF EXISTS ck_tenants_id_matches_tenant_uuid")
    op.create_check_constraint(
        "ck_tenants_id_matches_tenant_uuid",
        "tenants",
        "id::uuid = tenant_uuid",
    )


def downgrade() -> None:
    op.execute("SET LOCAL statement_timeout = 0")
    op.execute("SET LOCAL lock_timeout = 0")

    op.execute("ALTER TABLE tenants DROP CONSTRAINT IF EXISTS ck_tenants_id_matches_tenant_uuid")

    op.execute(
        """
        CREATE TEMP TABLE _tenant_id_restore_map ON COMMIT DROP AS
        SELECT id AS old_id, key_prefix AS new_id
        FROM tenants
        WHERE id IS DISTINCT FROM key_prefix;
        """
    )

    _capture_tenant_fk_defs("_tenant_fk_restore_defs")
    _drop_captured_tenant_fks("_tenant_fk_restore_defs")

    op.execute(
        """
        UPDATE tenants AS target
        SET id = map.new_id
        FROM _tenant_id_restore_map AS map
        WHERE target.id = map.old_id;
        """
    )

    _rewrite_all_table_tenant_ids("_tenant_id_restore_map")

    _restore_captured_tenant_fks("_tenant_fk_restore_defs")

    op.alter_column(
        "tenants",
        "id",
        existing_type=sa.String(length=255),
        server_default=None,
    )
