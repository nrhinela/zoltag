"""add_tenant_provider_integrations_table

Revision ID: 202602141730
Revises: 202602141500
Create Date: 2026-02-14 17:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "202602141730"
down_revision: Union[str, None] = "202602141500"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tenant_provider_integrations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider_type", sa.String(length=32), nullable=False),
        sa.Column("label", sa.String(length=128), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("is_default_sync_source", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("secret_scope", sa.String(length=255), nullable=False),
        sa.Column("config_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("legacy_mirror_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_index("ix_tpi_tenant_type", "tenant_provider_integrations", ["tenant_id", "provider_type"], unique=False)
    op.create_index(
        "uq_tpi_tenant_type_label",
        "tenant_provider_integrations",
        ["tenant_id", "provider_type", sa.text("lower(label)")],
        unique=True,
    )
    op.create_index(
        "uq_tpi_tenant_default_sync_source",
        "tenant_provider_integrations",
        ["tenant_id"],
        unique=True,
        postgresql_where=sa.text("is_default_sync_source = true"),
    )


def downgrade() -> None:
    op.drop_index("uq_tpi_tenant_default_sync_source", table_name="tenant_provider_integrations")
    op.drop_index("uq_tpi_tenant_type_label", table_name="tenant_provider_integrations")
    op.drop_index("ix_tpi_tenant_type", table_name="tenant_provider_integrations")
    op.drop_table("tenant_provider_integrations")
