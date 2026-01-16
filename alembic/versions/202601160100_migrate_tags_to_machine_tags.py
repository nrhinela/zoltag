"""Migrate data from image_tags and trained_image_tags to machine_tags table.

This migration transfers all existing tag data into the new consolidated
machine_tags table with proper algorithm identification.

Revision ID: 202601160100
Revises: 202601160000_add_machine_tags_table
Create Date: 2026-01-16 01:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "202601160100"
down_revision = "202601160000_add_machine_tags_table"
branch_labels = None
depends_on = None


def upgrade():
    # Migrate from image_tags (zero-shot SigLIP tags)
    # Populate model_name with known current model to avoid NULL uniqueness bypass
    # Use full model name as per tagging.py: SigLIPTagger uses "google/siglip-so400m-patch14-384"
    op.execute("""
        INSERT INTO machine_tags
            (image_id, tenant_id, keyword, category, confidence, tag_type, model_name, created_at, updated_at)
        SELECT
            image_id,
            tenant_id,
            keyword,
            category,
            COALESCE(confidence, 0.0),
            'siglip',
            'google/siglip-so400m-patch14-384',
            COALESCE(created_at, NOW()),
            NOW()
        FROM image_tags
        ON CONFLICT (tenant_id, image_id, keyword, tag_type, model_name) DO NOTHING
    """)

    # Migrate from trained_image_tags (trained keyword model outputs)
    # Keep existing model_name if present; default to 'trained' if null
    op.execute("""
        INSERT INTO machine_tags
            (image_id, tenant_id, keyword, category, confidence, tag_type, model_name, model_version, created_at, updated_at)
        SELECT
            image_id,
            tenant_id,
            keyword,
            category,
            COALESCE(confidence, 0.0),
            'trained',
            COALESCE(model_name, 'trained'),
            model_version,
            COALESCE(created_at, NOW()),
            NOW()
        FROM trained_image_tags
        ON CONFLICT (tenant_id, image_id, keyword, tag_type, model_name) DO NOTHING
    """)


def downgrade():
    # Delete migrated data on downgrade
    op.execute("DELETE FROM machine_tags WHERE tag_type IN ('siglip', 'trained')")
