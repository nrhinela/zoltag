"""Normalize tagging: Phase 1 - Add foreign key columns for keyword_id and person_id.

This migration adds new columns for normalized foreign keys without removing the
old denormalized string columns. This allows a gradual migration path:
- Phase 1: Add new FK columns (this)
- Phase 2: Backfill FK columns from string values
- Phase 3: Add NOT NULL constraints once backfill is verified
- Phase 4: Drop old string columns (optional, can delay)

Revision ID: 202601200800
Revises: 202601171500
Create Date: 2026-01-20 08:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "202601200800"
down_revision = "202601171500"
branch_labels = None
depends_on = None


def upgrade():
    # ========================================================================
    # 1. Add tenant_id to keywords table (nullable during migration)
    # ========================================================================
    op.add_column(
        "keywords",
        sa.Column("tenant_id", sa.String(length=255), nullable=True)
    )
    op.create_index(
        "idx_keywords_tenant_id",
        "keywords",
        ["tenant_id"]
    )
    # Note: Will be populated during Phase 2 backfill from keyword_categories

    # Drop old uniqueness constraint on (category_id, keyword)
    # We'll add a new constraint (tenant_id, keyword, category_id) in Phase 3
    op.drop_constraint(
        "uq_keyword_category_keyword",
        "keywords",
        type_="unique"
    )

    # ========================================================================
    # 2. Add keyword_id FK columns to tag tables (nullable during migration)
    # ========================================================================
    # NOTE: image_tags and trained_image_tags were dropped in migration 202601160200
    # Only machine_tags, permatags, and keyword_models remain

    # machine_tags: Add keyword_id
    op.add_column(
        "machine_tags",
        sa.Column(
            "keyword_id",
            sa.Integer(),
            sa.ForeignKey("keywords.id", ondelete="CASCADE"),
            nullable=True
        )
    )
    op.create_index(
        "idx_machine_tags_keyword_id",
        "machine_tags",
        ["keyword_id"]
    )

    # permatags: Add keyword_id
    op.add_column(
        "permatags",
        sa.Column(
            "keyword_id",
            sa.Integer(),
            sa.ForeignKey("keywords.id", ondelete="CASCADE"),
            nullable=True
        )
    )
    op.create_index(
        "idx_permatags_keyword_id",
        "permatags",
        ["keyword_id"]
    )

    # keyword_models: Add keyword_id
    op.add_column(
        "keyword_models",
        sa.Column(
            "keyword_id",
            sa.Integer(),
            sa.ForeignKey("keywords.id", ondelete="CASCADE"),
            nullable=True
        )
    )
    op.create_index(
        "idx_keyword_models_keyword_id",
        "keyword_models",
        ["keyword_id"]
    )

    # ========================================================================
    # 3. Add person_id FK column to detected_faces (nullable, for unmatched faces)
    # ========================================================================
    op.add_column(
        "detected_faces",
        sa.Column(
            "person_id",
            sa.Integer(),
            sa.ForeignKey("people.id", ondelete="SET NULL"),
            nullable=True
        )
    )
    op.create_index(
        "idx_detected_faces_person_id",
        "detected_faces",
        ["person_id"]
    )

    # ========================================================================
    # 4. Create composite unique constraints to prevent duplicates
    # ========================================================================

    # machine_tags: Unique constraint on (image_id, keyword_id, tag_type, model_name)
    op.create_unique_constraint(
        "uq_machine_tags_image_keyword_type_model",
        "machine_tags",
        ["image_id", "keyword_id", "tag_type", "model_name"]
    )

    # permatags: Unique constraint on (image_id, keyword_id)
    # Only one approval/rejection state per image-keyword pair
    op.create_unique_constraint(
        "uq_permatags_image_keyword",
        "permatags",
        ["image_id", "keyword_id"]
    )


def downgrade():
    # ========================================================================
    # Reverse: Drop constraints and columns in reverse order
    # ========================================================================

    # Drop unique constraints from tag tables
    op.drop_constraint("uq_permatags_image_keyword", "permatags", type_="unique")
    op.drop_constraint("uq_machine_tags_image_keyword_type_model", "machine_tags", type_="unique")

    # Drop foreign key columns and indexes from tag tables
    op.drop_index("idx_detected_faces_person_id", "detected_faces")
    op.drop_column("detected_faces", "person_id")

    op.drop_index("idx_keyword_models_keyword_id", "keyword_models")
    op.drop_column("keyword_models", "keyword_id")

    op.drop_index("idx_permatags_keyword_id", "permatags")
    op.drop_column("permatags", "keyword_id")

    op.drop_index("idx_machine_tags_keyword_id", "machine_tags")
    op.drop_column("machine_tags", "keyword_id")

    # Restore keywords table to original state
    op.drop_index("idx_keywords_tenant_id", "keywords")
    op.drop_column("keywords", "tenant_id")

    # Restore old uniqueness constraint on (category_id, keyword)
    op.create_unique_constraint(
        "uq_keyword_category_keyword",
        "keywords",
        ["category_id", "keyword"]
    )
