"""Normalize tagging: Phase 4 - Drop old denormalized columns.

This migration removes the old denormalized string columns (keyword, category, person_name)
that are now replaced by normalized foreign keys.

NOTE: image_tags and trained_image_tags tables were dropped in migration 202601160200,
so only machine_tags, permatags, and keyword_models are affected here.

This phase is safe and non-breaking because:
1. All data has been backfilled to new FK columns (Phase 2)
2. All new writes use FK columns (code deployed after Phase 3)
3. Indexes and constraints on old columns have been superseded by new FK indexes

This phase is OPTIONAL and can be delayed if you need a rollback window.

Revision ID: 202601201100
Revises: 202601201000
Create Date: 2026-01-20 11:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "202601201100"
down_revision = "202601201000"
branch_labels = None
depends_on = None


def upgrade():
    # ========================================================================
    # Drop old denormalized string columns and old constraints
    # NOTE: image_tags and trained_image_tags were dropped in migration 202601160200
    # ========================================================================

    # machine_tags: Drop keyword and category columns
    # (idx_machine_tags_facets and idx_machine_tags_unique were already replaced by FK indexes)
    op.drop_column("machine_tags", "category")
    op.drop_column("machine_tags", "keyword")

    # permatags: Drop keyword and category columns
    # (idx_permatag_keyword was already replaced by FK indexes)
    op.drop_column("permatags", "category")
    op.drop_column("permatags", "keyword")

    # keyword_models: Drop keyword column
    # (idx_keyword_models_tenant_keyword was already replaced by FK indexes)
    op.drop_column("keyword_models", "keyword")

    # detected_faces: Drop person_name column (now using person_id)
    # Keep as optional step since person_name is useful for unmatched faces
    # Uncomment if you want to fully normalize:
    # op.drop_column("detected_faces", "person_name")


def downgrade():
    # Reverse: Re-add old denormalized columns
    # This is a lossy operation—data from old columns cannot be recovered
    # NOTE: image_tags and trained_image_tags are not restored here (they don't exist)

    op.add_column(
        "keyword_models",
        sa.Column("keyword", sa.String(length=255), nullable=True)
    )

    op.add_column(
        "permatags",
        sa.Column("keyword", sa.String(length=255), nullable=True)
    )
    op.add_column(
        "permatags",
        sa.Column("category", sa.String(length=255), nullable=True)
    )

    op.add_column(
        "machine_tags",
        sa.Column("keyword", sa.String(length=255), nullable=True)
    )
    op.add_column(
        "machine_tags",
        sa.Column("category", sa.String(length=255), nullable=True)
    )
