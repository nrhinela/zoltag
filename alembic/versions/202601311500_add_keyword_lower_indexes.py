"""Add indexes for keyword lookups used in permatag filters.

Revision ID: 202601311500
Revises: 202601311230
Create Date: 2026-01-31 15:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "202601311500"
down_revision = "202601311230"
branch_labels = None
depends_on = None


def upgrade():
    # Use CONCURRENTLY to avoid write locks on large tables (Postgres only).
    with op.get_context().autocommit_block():
        op.create_index(
            "idx_keyword_categories_tenant_name",
            "keyword_categories",
            ["tenant_id", "name"],
            postgresql_concurrently=True,
        )
        op.create_index(
            "idx_keywords_tenant_lower_keyword_category",
            "keywords",
            ["tenant_id", sa.text("lower(keyword)"), "category_id"],
            postgresql_concurrently=True,
        )


def downgrade():
    with op.get_context().autocommit_block():
        op.drop_index(
            "idx_keywords_tenant_lower_keyword_category",
            table_name="keywords",
            postgresql_concurrently=True,
        )
        op.drop_index(
            "idx_keyword_categories_tenant_name",
            table_name="keyword_categories",
            postgresql_concurrently=True,
        )
