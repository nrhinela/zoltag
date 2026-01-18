"""Add created_at to image_metadata.

Revision ID: 202601171400
Revises: 202601160200
Create Date: 2026-01-17 14:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "202601171400"
down_revision = "202601160200"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "image_metadata",
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=True)
    )
    op.execute(
        "UPDATE image_metadata "
        "SET created_at = COALESCE(last_processed, modified_time, NOW()) "
        "WHERE created_at IS NULL"
    )
    op.alter_column(
        "image_metadata",
        "created_at",
        nullable=False,
        server_default=sa.func.now()
    )


def downgrade():
    op.drop_column("image_metadata", "created_at")
