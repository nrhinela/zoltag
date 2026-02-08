"""drop_legacy_image_metadata_storage_columns

Revision ID: 202602081930
Revises: 202602081830
Create Date: 2026-02-08 19:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "202602081930"
down_revision: Union[str, None] = "202602081830"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("SET LOCAL statement_timeout = 0")
    op.execute("SET LOCAL lock_timeout = '5s'")

    # Legacy lookup indexes tied to image_metadata storage columns.
    op.execute("DROP INDEX IF EXISTS idx_image_metadata_tenant_dropbox_folder_expr")
    op.execute("DROP INDEX IF EXISTS idx_image_metadata_tenant_dropbox_path")
    op.execute("DROP INDEX IF EXISTS ix_image_metadata_dropbox_id")

    # Legacy storage columns now superseded by assets.source_key/assets.thumbnail_key.
    op.execute("ALTER TABLE image_metadata DROP COLUMN IF EXISTS thumbnail_path")
    op.execute("ALTER TABLE image_metadata DROP COLUMN IF EXISTS dropbox_id")
    op.execute("ALTER TABLE image_metadata DROP COLUMN IF EXISTS dropbox_path")


def downgrade() -> None:
    op.add_column("image_metadata", sa.Column("dropbox_path", sa.String(length=1024), nullable=True))
    op.add_column("image_metadata", sa.Column("dropbox_id", sa.String(length=255), nullable=True))
    op.add_column("image_metadata", sa.Column("thumbnail_path", sa.String(length=1024), nullable=True))

    op.create_index(
        "ix_image_metadata_dropbox_id",
        "image_metadata",
        ["dropbox_id"],
        unique=True,
    )
    op.create_index(
        "idx_image_metadata_tenant_dropbox_path",
        "image_metadata",
        ["tenant_id", "dropbox_path"],
        unique=False,
    )
    with op.get_context().autocommit_block():
        op.create_index(
            "idx_image_metadata_tenant_dropbox_folder_expr",
            "image_metadata",
            ["tenant_id", sa.text("coalesce(nullif(regexp_replace(dropbox_path, '/[^/]+$', ''), ''), '/')")],
            unique=False,
            postgresql_concurrently=True,
        )
