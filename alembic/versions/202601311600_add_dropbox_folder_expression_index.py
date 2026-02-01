"""Add functional index for dropbox folder expression.

Revision ID: 202601311600
Revises: 202601311530
Create Date: 2026-01-31 16:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "202601311600"
down_revision = "202601311530"
branch_labels = None
depends_on = None


def upgrade():
    # Use CONCURRENTLY to avoid write locks on large tables (Postgres only).
    with op.get_context().autocommit_block():
        op.create_index(
            "idx_image_metadata_tenant_dropbox_folder_expr",
            "image_metadata",
            ["tenant_id", sa.text("coalesce(nullif(regexp_replace(dropbox_path, '/[^/]+$', ''), ''), '/')")],
            postgresql_concurrently=True,
        )


def downgrade():
    with op.get_context().autocommit_block():
        op.drop_index(
            "idx_image_metadata_tenant_dropbox_folder_expr",
            table_name="image_metadata",
            postgresql_concurrently=True,
        )
