
"""
Add photo lists and list items tables (per-tenant, single active list)
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
# revision identifiers, used by Alembic.
revision = '202601111700_add_photo_lists'
down_revision = 'add_dropbox_properties'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table(
        'photo_lists',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('tenant_id', sa.String(length=50), nullable=False, index=True),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('notebox', sa.Text, nullable=True),
        sa.Column('is_active', sa.Boolean, nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
    )
    op.create_index('ix_photo_lists_tenant_id', 'photo_lists', ['tenant_id'])
    op.create_index(
        'uq_photo_lists_active_per_tenant',
        'photo_lists',
        ['tenant_id'],
        unique=True,
        postgresql_where=sa.text('is_active')
    )

    op.create_table(
        'photo_list_items',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('list_id', sa.Integer, sa.ForeignKey('photo_lists.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('photo_id', sa.Integer, nullable=False, index=True),
        sa.Column('added_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
    )
    op.create_index('ix_photo_list_items_list_id', 'photo_list_items', ['list_id'])
    op.create_index('ix_photo_list_items_photo_id', 'photo_list_items', ['photo_id'])

def downgrade():
    op.drop_index('ix_photo_list_items_photo_id', table_name='photo_list_items')
    op.drop_index('ix_photo_list_items_list_id', table_name='photo_list_items')
    op.drop_table('photo_list_items')
    op.drop_index('ix_photo_lists_tenant_id', table_name='photo_lists')
    op.drop_table('photo_lists')
