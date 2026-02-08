"""add_asset_storage_tables

Revision ID: 202602071200
Revises: 202602041945
Create Date: 2026-02-07 12:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "202602071200"
down_revision: Union[str, None] = "202602041945"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "assets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("tenant_id", sa.String(length=255), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=512)),
        sa.Column("description", sa.Text()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("idx_assets_tenant_id", "assets", ["tenant_id"])

    op.create_table(
        "blobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("tenant_id", sa.String(length=255), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content_hash", sa.String(length=128), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("mime_type", sa.String(length=255)),
        sa.Column("width", sa.Integer()),
        sa.Column("height", sa.Integer()),
        sa.Column("duration_ms", sa.Integer()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("idx_blobs_tenant_id", "blobs", ["tenant_id"])
    op.create_index("uq_blobs_tenant_hash", "blobs", ["tenant_id", "content_hash"], unique=True)

    op.create_table(
        "blob_storage",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("blob_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("blobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("storage_provider", sa.String(length=64), nullable=False),
        sa.Column("storage_bucket", sa.String(length=255)),
        sa.Column("storage_key", sa.String(length=1024), nullable=False),
        sa.Column("storage_rev", sa.String(length=255)),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("last_verified_at", sa.DateTime()),
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
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("assets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("blob_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("blobs.id"), nullable=False),
        sa.Column("role", sa.String(length=64), nullable=False),
        sa.Column("variant", sa.String(length=128)),
        sa.Column("filename", sa.String(length=1024)),
        sa.Column("source_system", sa.String(length=64)),
        sa.Column("authoritative", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("parent_asset_file_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("asset_files.id")),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("user_profiles.supabase_uid", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("edit_recipe", postgresql.JSONB()),
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
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("asset_file_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("asset_files.id", ondelete="CASCADE"), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("metadata", postgresql.JSONB()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("user_profiles.supabase_uid", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("idx_asset_file_audit_asset_file_id", "asset_file_audit", ["asset_file_id"])
    op.create_index("idx_asset_file_audit_created_at", "asset_file_audit", ["created_at"])


def downgrade() -> None:
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

    op.drop_index("idx_assets_tenant_id", table_name="assets")
    op.drop_table("assets")
