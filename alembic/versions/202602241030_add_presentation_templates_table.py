"""add presentation templates table

Revision ID: 202602241030
Revises: 202602221400
Create Date: 2026-02-24 10:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "202602241030"
down_revision: Union[str, None] = "202602221400"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "presentation_templates",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("visibility", sa.String(length=20), nullable=False, server_default="private"),
        sa.Column("created_by_uid", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.CheckConstraint("visibility IN ('shared', 'private')", name="chk_presentation_templates_visibility"),
    )
    op.create_index("idx_presentation_templates_tenant", "presentation_templates", ["tenant_id"])
    op.create_index(
        "idx_presentation_templates_tenant_visibility",
        "presentation_templates",
        ["tenant_id", "visibility"],
    )
    op.create_index(
        "idx_presentation_templates_tenant_creator",
        "presentation_templates",
        ["tenant_id", "created_by_uid"],
    )


def downgrade() -> None:
    op.drop_index("idx_presentation_templates_tenant_creator", table_name="presentation_templates")
    op.drop_index("idx_presentation_templates_tenant_visibility", table_name="presentation_templates")
    op.drop_index("idx_presentation_templates_tenant", table_name="presentation_templates")
    op.drop_table("presentation_templates")
