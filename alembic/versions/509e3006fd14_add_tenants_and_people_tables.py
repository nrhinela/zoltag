
"""add_tenants_and_people_tables

Revision ID: 509e3006fd14
Revises: 99f16914f12a
Create Date: 2026-01-09 10:58:09.015484
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
# revision identifiers, used by Alembic.
revision = '509e3006fd14'
down_revision = '99f16914f12a'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create tenants table
    op.create_table(
        'tenants',
        sa.Column('id', sa.String(255), primary_key=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('dropbox_app_key', sa.String(255), nullable=True),
        sa.Column('dropbox_app_secret_ref', sa.String(255), nullable=True),
        sa.Column('dropbox_access_token_ref', sa.String(255), nullable=True),
        sa.Column('settings', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('ix_tenants_active', 'tenants', ['active'])
    
    # People table already exists from previous migration (39c1d04f32bf)
    # Just add the foreign key constraint
    op.create_foreign_key(
        'fk_people_tenant_id',
        'people',
        'tenants',
        ['tenant_id'],
        ['id'],
        ondelete='CASCADE'
    )


def downgrade() -> None:
    op.drop_constraint('fk_people_tenant_id', 'people', type_='foreignkey')
    op.drop_index('ix_tenants_active', table_name='tenants')
    op.drop_table('tenants')
