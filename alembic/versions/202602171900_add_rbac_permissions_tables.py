"""add_rbac_permissions_tables

Revision ID: 202602171900
Revises: 202602171530
Create Date: 2026-02-17 19:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "202602171900"
down_revision: Union[str, None] = "202602171530"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "permission_catalog",
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("category", sa.String(length=50), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("key", name="pk_permission_catalog"),
    )

    op.create_table(
        "tenant_roles",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role_key", sa.String(length=50), nullable=False),
        sa.Column("label", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], name="fk_tenant_roles_tenant_id", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_tenant_roles"),
        sa.UniqueConstraint("tenant_id", "role_key", name="uq_tenant_roles_tenant_role_key"),
    )
    op.create_index("ix_tenant_roles_tenant_active", "tenant_roles", ["tenant_id", "is_active"], unique=False)

    op.create_table(
        "tenant_role_permissions",
        sa.Column("role_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("permission_key", sa.String(length=100), nullable=False),
        sa.Column("effect", sa.String(length=10), nullable=False, server_default=sa.text("'allow'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("effect IN ('allow', 'deny')", name="ck_tenant_role_permissions_effect"),
        sa.ForeignKeyConstraint(
            ["permission_key"],
            ["permission_catalog.key"],
            name="fk_tenant_role_permissions_permission_key",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["role_id"],
            ["tenant_roles.id"],
            name="fk_tenant_role_permissions_role_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("role_id", "permission_key", name="pk_tenant_role_permissions"),
    )
    op.create_index(
        "ix_tenant_role_permissions_permission",
        "tenant_role_permissions",
        ["permission_key"],
        unique=False,
    )

    op.add_column(
        "user_tenants",
        sa.Column("tenant_role_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index("ix_user_tenants_tenant_role_id", "user_tenants", ["tenant_role_id"], unique=False)
    op.create_foreign_key(
        "fk_user_tenants_tenant_role_id",
        "user_tenants",
        "tenant_roles",
        ["tenant_role_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_user_tenants_tenant_role_id", "user_tenants", type_="foreignkey")
    op.drop_index("ix_user_tenants_tenant_role_id", table_name="user_tenants")
    op.drop_column("user_tenants", "tenant_role_id")

    op.drop_index("ix_tenant_role_permissions_permission", table_name="tenant_role_permissions")
    op.drop_table("tenant_role_permissions")

    op.drop_index("ix_tenant_roles_tenant_active", table_name="tenant_roles")
    op.drop_table("tenant_roles")

    op.drop_table("permission_catalog")

