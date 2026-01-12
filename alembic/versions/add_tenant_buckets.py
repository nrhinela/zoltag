
"""add tenant storage buckets

Revision ID: add_tenant_buckets
Revises: 4ec3b2e868df
Create Date: 2026-01-09 14:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
# revision identifiers, used by Alembic.
revision = 'add_tenant_buckets'
down_revision = '4ec3b2e868df'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add storage_bucket and thumbnail_bucket columns to tenants table
    op.add_column('tenants', sa.Column('storage_bucket', sa.String(255), nullable=True))
    op.add_column('tenants', sa.Column('thumbnail_bucket', sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column('tenants', 'thumbnail_bucket')
    op.drop_column('tenants', 'storage_bucket')
