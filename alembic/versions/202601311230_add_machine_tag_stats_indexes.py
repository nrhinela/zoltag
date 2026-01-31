"""Add indexes to speed ML training stats queries.

Revision ID: 202601311230
Revises: 202601311200
Create Date: 2026-01-31 12:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "202601311230"
down_revision = "202601311200"
branch_labels = None
depends_on = None


def upgrade():
    # Use CONCURRENTLY to avoid write locks on large tables (Postgres only).
    with op.get_context().autocommit_block():
        op.create_index(
            "idx_machine_tags_trained_tenant_image",
            "machine_tags",
            ["tenant_id", "image_id"],
            unique=False,
            postgresql_concurrently=True,
            postgresql_where=sa.text("tag_type = 'trained'"),
        )
        op.create_index(
            "idx_machine_tags_trained_tenant_created_at",
            "machine_tags",
            ["tenant_id", "created_at"],
            unique=False,
            postgresql_concurrently=True,
            postgresql_where=sa.text("tag_type = 'trained'"),
        )
        op.create_index(
            "idx_machine_tags_siglip_tenant_image",
            "machine_tags",
            ["tenant_id", "image_id"],
            unique=False,
            postgresql_concurrently=True,
            postgresql_where=sa.text("tag_type = 'siglip'"),
        )


def downgrade():
    with op.get_context().autocommit_block():
        op.drop_index(
            "idx_machine_tags_siglip_tenant_image",
            table_name="machine_tags",
            postgresql_concurrently=True,
        )
        op.drop_index(
            "idx_machine_tags_trained_tenant_created_at",
            table_name="machine_tags",
            postgresql_concurrently=True,
        )
        op.drop_index(
            "idx_machine_tags_trained_tenant_image",
            table_name="machine_tags",
            postgresql_concurrently=True,
        )
