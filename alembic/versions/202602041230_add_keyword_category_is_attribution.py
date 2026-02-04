"""add_keyword_category_is_attribution

Revision ID: 202602041230
Revises: 202601311600
Create Date: 2026-02-04 12:30:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '202602041230'
down_revision: Union[str, None] = '202601311600'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'keyword_categories',
        sa.Column('is_attribution', sa.Boolean(), nullable=False, server_default=sa.text('false'))
    )


def downgrade() -> None:
    op.drop_column('keyword_categories', 'is_attribution')
