"""default provider integrations inactive

Revision ID: 202602211130
Revises: 202602201520
Create Date: 2026-02-21 11:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "202602211130"
down_revision: Union[str, None] = "202602201520"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "tenant_provider_integrations",
        "is_active",
        existing_type=sa.Boolean(),
        nullable=False,
        server_default=sa.text("false"),
    )


def downgrade() -> None:
    op.alter_column(
        "tenant_provider_integrations",
        "is_active",
        existing_type=sa.Boolean(),
        nullable=False,
        server_default=sa.text("true"),
    )

