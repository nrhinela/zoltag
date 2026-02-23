"""add person reference images table

Revision ID: 202602192100
Revises: 202602191545
Create Date: 2026-02-19 21:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "202602192100"
down_revision: Union[str, None] = "202602191545"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "person_reference_images",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("person_id", sa.Integer(), nullable=False),
        sa.Column("source_type", sa.String(length=16), nullable=False),
        sa.Column("source_asset_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("storage_key", sa.String(length=1024), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("face_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("quality_score", sa.Float(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("source_type in ('upload','asset')", name="ck_person_reference_images_source_type"),
        sa.ForeignKeyConstraint(["created_by"], ["user_profiles.supabase_uid"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["person_id"], ["people.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_asset_id"], ["assets.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_index(
        "idx_person_reference_images_tenant_person_active",
        "person_reference_images",
        ["tenant_id", "person_id", "is_active"],
        unique=False,
    )
    op.create_index(
        "idx_person_reference_images_tenant_source_asset",
        "person_reference_images",
        ["tenant_id", "source_asset_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_person_reference_images_tenant_source_asset", table_name="person_reference_images")
    op.drop_index("idx_person_reference_images_tenant_person_active", table_name="person_reference_images")
    op.drop_table("person_reference_images")
