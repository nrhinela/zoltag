"""add_editor_tenant_role

Revision ID: 202602111130
Revises: 202602101215
Create Date: 2026-02-11 11:30:00.000000

Allow 'editor' as a tenant role for user memberships and invitations.
"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "202602111130"
down_revision: Union[str, None] = "202602101215"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("ck_user_tenants_role", "user_tenants", type_="check")
    op.create_check_constraint(
        "ck_user_tenants_role",
        "user_tenants",
        "role IN ('admin', 'editor', 'user')",
    )

    op.drop_constraint("ck_invitations_role", "invitations", type_="check")
    op.create_check_constraint(
        "ck_invitations_role",
        "invitations",
        "role IN ('admin', 'editor', 'user')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_user_tenants_role", "user_tenants", type_="check")
    op.create_check_constraint(
        "ck_user_tenants_role",
        "user_tenants",
        "role IN ('admin', 'user')",
    )

    op.drop_constraint("ck_invitations_role", "invitations", type_="check")
    op.create_check_constraint(
        "ck_invitations_role",
        "invitations",
        "role IN ('admin', 'user')",
    )
