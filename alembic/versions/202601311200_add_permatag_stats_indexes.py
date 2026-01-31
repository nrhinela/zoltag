"""Add indexes to speed permatag stats queries.

Revision ID: 202601311200
Revises: 202601291400
Create Date: 2026-01-31 12:00:00.000000
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "202601311200"
down_revision = "202601291400"
branch_labels = None
depends_on = None


def upgrade():
    # Use CONCURRENTLY to avoid write locks on large tables (Postgres only).
    with op.get_context().autocommit_block():
        op.create_index(
            "idx_permatag_tenant_keyword_signum_image",
            "permatags",
            ["tenant_id", "keyword_id", "signum", "image_id"],
            postgresql_concurrently=True,
        )
        op.create_index(
            "idx_permatag_tenant_signum_image",
            "permatags",
            ["tenant_id", "signum", "image_id"],
            postgresql_concurrently=True,
        )


def downgrade():
    with op.get_context().autocommit_block():
        op.drop_index(
            "idx_permatag_tenant_signum_image",
            table_name="permatags",
            postgresql_concurrently=True,
        )
        op.drop_index(
            "idx_permatag_tenant_keyword_signum_image",
            table_name="permatags",
            postgresql_concurrently=True,
        )
