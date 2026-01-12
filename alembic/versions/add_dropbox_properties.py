
"""add dropbox properties column

Revision ID: add_dropbox_properties
Revises: add_tenant_buckets
Create Date: 2026-01-11 16:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
# revision identifiers, used by Alembic.
revision = 'add_dropbox_properties'
down_revision = 'add_tenant_buckets'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add dropbox_properties JSONB column to image_metadata table
    op.add_column('image_metadata', sa.Column('dropbox_properties', JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column('image_metadata', 'dropbox_properties')
