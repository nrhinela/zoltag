
"""add_tenant_config_tables

Revision ID: 39c1d04f32bf
Revises: 7c78a8bd4b5f
Create Date: 2026-01-08 15:01:40.899222
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
# revision identifiers, used by Alembic.
revision = '39c1d04f32bf'
down_revision = '7c78a8bd4b5f'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create keyword_categories table
    op.create_table(
        'keyword_categories',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.String(length=50), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('parent_id', sa.Integer(), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('NOW()')),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['parent_id'], ['keyword_categories.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('tenant_id', 'name', 'parent_id', name='uq_keyword_category_tenant_name_parent')
    )
    op.create_index('ix_keyword_categories_tenant_id', 'keyword_categories', ['tenant_id'])
    
    # Create keywords table
    op.create_table(
        'keywords',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('category_id', sa.Integer(), nullable=False),
        sa.Column('keyword', sa.String(length=100), nullable=False),
        sa.Column('prompt', sa.Text(), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('NOW()')),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['category_id'], ['keyword_categories.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('category_id', 'keyword', name='uq_keyword_category_keyword')
    )
    op.create_index('ix_keywords_category_id', 'keywords', ['category_id'])
    
    # Create people table
    op.create_table(
        'people',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.String(length=50), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('aliases', sa.JSON(), nullable=True),
        sa.Column('face_embedding_ref', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('NOW()')),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'name', name='uq_people_tenant_name')
    )
    op.create_index('ix_people_tenant_id', 'people', ['tenant_id'])


def downgrade() -> None:
    op.drop_table('people')
    op.drop_table('keywords')
    op.drop_table('keyword_categories')
