"""Normalize tagging: Phase 3 - Add NOT NULL constraints.

This migration makes the foreign key columns NOT NULL, enforcing referential integrity.

NOTE: image_tags and trained_image_tags tables were dropped in migration 202601160200,
so only machine_tags, permatags, and keyword_models are constrained here.

CRITICAL PRE-CONDITIONS:
Before running this migration, verify that Phase 2 backfill completed successfully.

Execute this query to check for any NULL values:

    SELECT 'machine_tags' as table_name, COUNT(*) as null_count FROM machine_tags WHERE keyword_id IS NULL
    UNION ALL
    SELECT 'permatags', COUNT(*) FROM permatags WHERE keyword_id IS NULL
    UNION ALL
    SELECT 'keyword_models', COUNT(*) FROM keyword_models WHERE keyword_id IS NULL;

If any rows have NULL keyword_id, DO NOT PROCEED. Instead:
1. Identify the orphaned keywords:
   SELECT DISTINCT keyword FROM machine_tags WHERE keyword_id IS NULL;

2. Either:
   a) INSERT the missing keywords into the keywords table, then re-run Phase 2 backfill
   b) DELETE the orphaned rows

Only proceed to Phase 3 after all NULL values are resolved.

Revision ID: 202601201000
Revises: 202601200900
Create Date: 2026-01-20 10:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "202601201000"
down_revision = "202601200900"
branch_labels = None
depends_on = None


def upgrade():
    # ========================================================================
    # Add NOT NULL constraints to enforce referential integrity
    # ========================================================================

    # keywords.tenant_id: Must be NOT NULL for tenant isolation
    op.alter_column(
        "keywords",
        "tenant_id",
        existing_type=sa.String(length=255),
        nullable=False
    )

    # Add new uniqueness constraint (tenant_id, keyword, category_id)
    # This prevents the same keyword from appearing in multiple categories within a tenant
    op.create_unique_constraint(
        "uq_keywords_tenant_keyword_category",
        "keywords",
        ["tenant_id", "keyword", "category_id"]
    )

    # machine_tags.keyword_id: Every machine tag must reference a keyword
    op.alter_column(
        "machine_tags",
        "keyword_id",
        existing_type=sa.Integer(),
        nullable=False
    )

    # permatags.keyword_id: Every permatag must reference a keyword
    op.alter_column(
        "permatags",
        "keyword_id",
        existing_type=sa.Integer(),
        nullable=False
    )

    # keyword_models.keyword_id: Every keyword model must reference a keyword
    op.alter_column(
        "keyword_models",
        "keyword_id",
        existing_type=sa.Integer(),
        nullable=False
    )

    # detected_faces.person_id: Keep nullable for unmatched/unrecognized faces


def downgrade():
    # Reverse: Revert NOT NULL constraints and uniqueness constraint
    op.drop_constraint(
        "uq_keywords_tenant_keyword_category",
        "keywords",
        type_="unique"
    )

    op.alter_column(
        "keyword_models",
        "keyword_id",
        existing_type=sa.Integer(),
        nullable=True
    )

    op.alter_column(
        "permatags",
        "keyword_id",
        existing_type=sa.Integer(),
        nullable=True
    )

    op.alter_column(
        "machine_tags",
        "keyword_id",
        existing_type=sa.Integer(),
        nullable=True
    )

    op.alter_column(
        "keywords",
        "tenant_id",
        existing_type=sa.String(length=255),
        nullable=True
    )
