"""simplify_asset_storage_schema

Revision ID: 202602081000
Revises: 202602071200
Create Date: 2026-02-08 10:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "202602081000"
down_revision: Union[str, None] = "202602071200"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Some tenants have large/active legacy tables; avoid per-session timeout cancels.
    op.execute("SET LOCAL statement_timeout = 0")
    op.execute("SET LOCAL lock_timeout = 0")

    # Transition existing assets table from blob-linked shape to simplified shape.
    op.add_column("assets", sa.Column("filename", sa.String(length=1024), nullable=True))
    op.add_column("assets", sa.Column("source_provider", sa.String(length=64), nullable=True))
    op.add_column("assets", sa.Column("source_key", sa.String(length=1024), nullable=True))
    op.add_column("assets", sa.Column("source_rev", sa.String(length=255), nullable=True))
    op.add_column("assets", sa.Column("thumbnail_key", sa.String(length=1024), nullable=True))
    op.add_column("assets", sa.Column("mime_type", sa.String(length=255), nullable=True))
    op.add_column("assets", sa.Column("width", sa.Integer(), nullable=True))
    op.add_column("assets", sa.Column("height", sa.Integer(), nullable=True))
    op.add_column("assets", sa.Column("duration_ms", sa.Integer(), nullable=True))
    op.add_column("assets", sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_assets_created_by_user_profiles",
        "assets",
        "user_profiles",
        ["created_by"],
        ["supabase_uid"],
        ondelete="SET NULL",
    )

    op.create_index("idx_assets_source_key", "assets", ["source_provider", "source_key"])

    op.create_table(
        "asset_derivatives",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "asset_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("storage_key", sa.String(length=1024), nullable=False),
        sa.Column("filename", sa.String(length=1024), nullable=False),
        sa.Column("variant", sa.String(length=128), nullable=True),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user_profiles.supabase_uid", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_asset_derivatives_asset_id", "asset_derivatives", ["asset_id"])
    op.create_index("idx_asset_derivatives_variant", "asset_derivatives", ["variant"])

    # Data backfill and NOT NULL enforcement will be handled in a follow-up migration.
    op.alter_column(
        "assets",
        "id",
        existing_type=postgresql.UUID(as_uuid=True),
        existing_nullable=False,
        server_default=sa.text("gen_random_uuid()"),
    )

    # Remove blob-era schema.
    op.drop_index("idx_asset_file_audit_created_at", table_name="asset_file_audit")
    op.drop_index("idx_asset_file_audit_asset_file_id", table_name="asset_file_audit")
    op.drop_table("asset_file_audit")

    op.drop_index("uq_asset_files_authoritative", table_name="asset_files")
    op.drop_index("idx_asset_files_role_variant", table_name="asset_files")
    op.drop_index("idx_asset_files_parent", table_name="asset_files")
    op.drop_index("idx_asset_files_blob_id", table_name="asset_files")
    op.drop_index("idx_asset_files_asset_id", table_name="asset_files")
    op.drop_table("asset_files")

    op.drop_index("uq_blob_storage_provider_key", table_name="blob_storage")
    op.drop_index("idx_blob_storage_provider", table_name="blob_storage")
    op.drop_index("idx_blob_storage_blob_id", table_name="blob_storage")
    op.drop_table("blob_storage")

    op.drop_index("uq_blobs_tenant_hash", table_name="blobs")
    op.drop_index("idx_blobs_tenant_id", table_name="blobs")
    op.drop_table("blobs")

    op.drop_column("assets", "description")
    op.drop_column("assets", "title")


def downgrade() -> None:
    op.execute("SET LOCAL statement_timeout = 0")
    op.execute("SET LOCAL lock_timeout = 0")

    # Recreate blob-era schema (data restoration is best-effort only).
    op.add_column("assets", sa.Column("title", sa.String(length=512), nullable=True))
    op.add_column("assets", sa.Column("description", sa.Text(), nullable=True))

    op.create_table(
        "blobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", sa.String(length=255), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content_hash", sa.String(length=128), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("mime_type", sa.String(length=255), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_blobs_tenant_id", "blobs", ["tenant_id"])
    op.create_index("uq_blobs_tenant_hash", "blobs", ["tenant_id", "content_hash"], unique=True)

    op.create_table(
        "blob_storage",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("blob_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("blobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("storage_provider", sa.String(length=64), nullable=False),
        sa.Column("storage_bucket", sa.String(length=255), nullable=True),
        sa.Column("storage_key", sa.String(length=1024), nullable=False),
        sa.Column("storage_rev", sa.String(length=255), nullable=True),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("last_verified_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_blob_storage_blob_id", "blob_storage", ["blob_id"])
    op.create_index("idx_blob_storage_provider", "blob_storage", ["storage_provider"])
    op.create_index(
        "uq_blob_storage_provider_key",
        "blob_storage",
        ["storage_provider", "storage_key"],
        unique=True,
    )

    op.create_table(
        "asset_files",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("assets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("blob_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("blobs.id"), nullable=False),
        sa.Column("role", sa.String(length=64), nullable=False),
        sa.Column("variant", sa.String(length=128), nullable=True),
        sa.Column("filename", sa.String(length=1024), nullable=True),
        sa.Column("source_system", sa.String(length=64), nullable=True),
        sa.Column("authoritative", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("parent_asset_file_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("asset_files.id"), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("user_profiles.supabase_uid", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("edit_recipe", postgresql.JSONB(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_asset_files_asset_id", "asset_files", ["asset_id"])
    op.create_index("idx_asset_files_blob_id", "asset_files", ["blob_id"])
    op.create_index("idx_asset_files_parent", "asset_files", ["parent_asset_file_id"])
    op.create_index("idx_asset_files_role_variant", "asset_files", ["role", "variant"])
    op.create_index(
        "uq_asset_files_authoritative",
        "asset_files",
        ["asset_id"],
        unique=True,
        postgresql_where=sa.text("authoritative IS TRUE"),
    )

    op.create_table(
        "asset_file_audit",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("asset_file_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("asset_files.id", ondelete="CASCADE"), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("user_profiles.supabase_uid", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_asset_file_audit_asset_file_id", "asset_file_audit", ["asset_file_id"])
    op.create_index("idx_asset_file_audit_created_at", "asset_file_audit", ["created_at"])

    op.drop_index("idx_asset_derivatives_variant", table_name="asset_derivatives")
    op.drop_index("idx_asset_derivatives_asset_id", table_name="asset_derivatives")
    op.drop_table("asset_derivatives")

    op.drop_index("idx_assets_source_key", table_name="assets")
    op.drop_constraint("fk_assets_created_by_user_profiles", "assets", type_="foreignkey")

    op.alter_column(
        "assets",
        "id",
        existing_type=postgresql.UUID(as_uuid=True),
        existing_nullable=False,
        server_default=None,
    )
    op.drop_column("assets", "created_by")
    op.drop_column("assets", "duration_ms")
    op.drop_column("assets", "height")
    op.drop_column("assets", "width")
    op.drop_column("assets", "mime_type")
    op.drop_column("assets", "thumbnail_key")
    op.drop_column("assets", "source_rev")
    op.drop_column("assets", "source_key")
    op.drop_column("assets", "source_provider")
    op.drop_column("assets", "filename")
