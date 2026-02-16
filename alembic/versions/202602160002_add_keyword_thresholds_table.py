"""add keyword_thresholds table

Revision ID: 202602160002
Revises: 202602160001
Create Date: 2026-02-16 00:02:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '202602160002'
down_revision = '202602160001'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'keyword_thresholds',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('keyword_id', sa.Integer(), nullable=False),
        sa.Column('tag_type', sa.String(50), nullable=False),
        sa.Column('threshold_calc', sa.Float(), nullable=True),
        sa.Column('threshold_manual', sa.Float(), nullable=True),
        sa.Column('calc_method', sa.String(50), nullable=True),
        sa.Column('calc_sample_n', sa.Integer(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('idx_keyword_thresholds_tenant', 'keyword_thresholds', ['tenant_id'])
    op.create_index('idx_keyword_thresholds_keyword_id', 'keyword_thresholds', ['keyword_id'])
    op.create_unique_constraint(
        'uq_keyword_thresholds_keyword_tag_type',
        'keyword_thresholds',
        ['keyword_id', 'tag_type'],
    )


def downgrade():
    op.drop_constraint('uq_keyword_thresholds_keyword_tag_type', 'keyword_thresholds', type_='unique')
    op.drop_index('idx_keyword_thresholds_keyword_id', table_name='keyword_thresholds')
    op.drop_index('idx_keyword_thresholds_tenant', table_name='keyword_thresholds')
    op.drop_table('keyword_thresholds')
