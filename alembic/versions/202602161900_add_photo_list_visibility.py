"""Add visibility to photo lists.

Revision ID: 202602161900
Revises: 202602161710
Create Date: 2026-02-16 19:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "202602161900"
down_revision = "202602161710"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "photo_lists",
        sa.Column(
            "visibility",
            sa.String(length=20),
            nullable=False,
            server_default="shared",
        ),
    )
    op.create_check_constraint(
        "ck_photo_lists_visibility",
        "photo_lists",
        "visibility in ('shared','private')",
    )
    op.create_index(
        "idx_photo_lists_tenant_visibility",
        "photo_lists",
        ["tenant_id", "visibility"],
        unique=False,
    )


def downgrade():
    op.drop_index("idx_photo_lists_tenant_visibility", table_name="photo_lists")
    op.drop_constraint("ck_photo_lists_visibility", "photo_lists", type_="check")
    op.drop_column("photo_lists", "visibility")

