"""add_thumbnail_migration_audit_table

Revision ID: 202602081230
Revises: 202602081130
Create Date: 2026-02-08 12:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "202602081230"
down_revision: Union[str, None] = "202602081130"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "thumbnail_migration_audit",
        sa.Column(
            "image_id",
            sa.Integer(),
            sa.ForeignKey("image_metadata.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tenant_id", sa.String(length=255), nullable=False),
        sa.Column(
            "asset_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assets.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("old_thumbnail_key", sa.String(length=1024), nullable=True),
        sa.Column("new_thumbnail_key", sa.String(length=1024), nullable=True),
        sa.Column("old_exists", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("new_exists", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("old_sha256", sa.String(length=64), nullable=True),
        sa.Column("new_sha256", sa.String(length=64), nullable=True),
        sa.Column("old_phash", sa.String(length=64), nullable=True),
        sa.Column("new_phash", sa.String(length=64), nullable=True),
        sa.Column("phash_distance", sa.Integer(), nullable=True),
        sa.Column("byte_hash_equal", sa.Boolean(), nullable=True),
        sa.Column("phash_equal", sa.Boolean(), nullable=True),
        sa.Column("visually_different", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("shared_old_key_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("permatag_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("machine_tag_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("needs_review", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("last_audited_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("image_id"),
    )
    op.create_index("idx_thumbnail_migration_audit_tenant_id", "thumbnail_migration_audit", ["tenant_id"])
    op.create_index("idx_thumbnail_migration_audit_asset_id", "thumbnail_migration_audit", ["asset_id"])
    op.create_index("idx_thumbnail_migration_audit_needs_review", "thumbnail_migration_audit", ["needs_review"])
    op.create_index(
        "idx_thumbnail_migration_audit_tenant_review",
        "thumbnail_migration_audit",
        ["tenant_id", "needs_review", "visually_different"],
    )


def downgrade() -> None:
    op.drop_index("idx_thumbnail_migration_audit_tenant_review", table_name="thumbnail_migration_audit")
    op.drop_index("idx_thumbnail_migration_audit_needs_review", table_name="thumbnail_migration_audit")
    op.drop_index("idx_thumbnail_migration_audit_asset_id", table_name="thumbnail_migration_audit")
    op.drop_index("idx_thumbnail_migration_audit_tenant_id", table_name="thumbnail_migration_audit")
    op.drop_table("thumbnail_migration_audit")
