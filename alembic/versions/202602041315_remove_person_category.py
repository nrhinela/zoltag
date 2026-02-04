"""remove_person_category

Revision ID: 202602041315
Revises: 202602041230
Create Date: 2026-02-04 13:15:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '202602041315'
down_revision: Union[str, None] = '202602041230'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop keyword_categories.person_category_id + unique constraint
    op.drop_constraint("uq_keyword_categories_person_category_id", "keyword_categories", type_="unique")
    op.drop_column("keyword_categories", "person_category_id")

    # Drop people.person_category and its index
    op.drop_index("idx_people_tenant_category", table_name="people")
    op.drop_column("people", "person_category")

    # Drop person_categories table
    op.drop_table("person_categories")


def downgrade() -> None:
    # Recreate person_categories table
    op.create_table(
        "person_categories",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("display_name", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_person_categories_tenant_name", "person_categories", ["tenant_id", "name"], unique=True)

    # Recreate people.person_category + index
    op.add_column(
        "people",
        sa.Column("person_category", sa.String(length=50), nullable=False, server_default="people_in_scene")
    )
    op.create_index("idx_people_tenant_category", "people", ["tenant_id", "person_category"])

    # Recreate keyword_categories.person_category_id + unique constraint
    op.add_column(
        "keyword_categories",
        sa.Column("person_category_id", sa.Integer(), nullable=True)
    )
    op.create_unique_constraint(
        "uq_keyword_categories_person_category_id",
        "keyword_categories",
        ["person_category_id"]
    )
