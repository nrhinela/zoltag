"""add asset_notes table

Revision ID: 202602160001
Revises: 202602161545_restore_recompute_trained_tags_definition
Create Date: 2026-02-16 00:01:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision = '202602160001'
down_revision = '202602161900'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'asset_notes',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('asset_id', UUID(as_uuid=True), sa.ForeignKey('assets.id', ondelete='CASCADE'), nullable=False),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('note_type', sa.String(64), nullable=False, server_default='general'),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('created_by', UUID(as_uuid=True), sa.ForeignKey('user_profiles.supabase_uid', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('idx_asset_notes_asset_id', 'asset_notes', ['asset_id'])
    op.create_index('idx_asset_notes_tenant_id', 'asset_notes', ['tenant_id'])
    op.create_unique_constraint('uq_asset_notes_asset_note_type', 'asset_notes', ['asset_id', 'note_type'])


def downgrade():
    op.drop_constraint('uq_asset_notes_asset_note_type', 'asset_notes', type_='unique')
    op.drop_index('idx_asset_notes_tenant_id', table_name='asset_notes')
    op.drop_index('idx_asset_notes_asset_id', table_name='asset_notes')
    op.drop_table('asset_notes')
