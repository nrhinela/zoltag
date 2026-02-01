"""Add index for image_metadata dropbox_path lookups.

Revision ID: 202601311530
Revises: 202601311500
Create Date: 2026-01-31 15:30:00.000000
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "202601311530"
down_revision = "202601311500"
branch_labels = None
depends_on = None


def upgrade():
    # Use CONCURRENTLY to avoid write locks on large tables (Postgres only).
    with op.get_context().autocommit_block():
        op.create_index(
            "idx_image_metadata_tenant_dropbox_path",
            "image_metadata",
            ["tenant_id", "dropbox_path"],
            postgresql_concurrently=True,
        )


def downgrade():
    with op.get_context().autocommit_block():
        op.drop_index(
            "idx_image_metadata_tenant_dropbox_path",
            table_name="image_metadata",
            postgresql_concurrently=True,
        )
