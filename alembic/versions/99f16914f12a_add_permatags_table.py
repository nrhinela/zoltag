
"""add_permatags_table

Revision ID: 99f16914f12a
Revises: 39c1d04f32bf
Create Date: 2026-01-08 22:34:21.770067
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
# revision identifiers, used by Alembic.
revision = '99f16914f12a'
down_revision = '39c1d04f32bf'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'permatags',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.String(length=50), nullable=False),
        sa.Column('image_id', sa.Integer(), nullable=False),
        sa.Column('keyword', sa.String(length=100), nullable=False),
        sa.Column('category', sa.String(length=100), nullable=True),
        sa.Column('signum', sa.Integer(), nullable=False),  # -1 (rejected) or 1 (approved)
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('NOW()')),
        sa.Column('created_by', sa.String(length=100), nullable=True),  # Future: user who created it
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['image_id'], ['image_metadata.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('tenant_id', 'image_id', 'keyword', name='uq_permatag_tenant_image_keyword')
    )
    op.create_index('ix_permatags_tenant_id', 'permatags', ['tenant_id'])
    op.create_index('ix_permatags_image_id', 'permatags', ['image_id'])
    op.create_index('ix_permatags_keyword', 'permatags', ['keyword'])


def downgrade() -> None:
    op.drop_index('ix_permatags_keyword', table_name='permatags')
    op.drop_index('ix_permatags_image_id', table_name='permatags')
    op.drop_index('ix_permatags_tenant_id', table_name='permatags')
    op.drop_table('permatags')
