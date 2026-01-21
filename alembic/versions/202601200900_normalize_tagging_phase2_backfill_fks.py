"""Normalize tagging: Phase 2 - Backfill foreign key columns.

This migration populates the new keyword_id and person_id foreign key columns
from existing string values. This allows verification before making columns NOT NULL.

NOTE: image_tags and trained_image_tags tables were dropped in migration 202601160200,
so only machine_tags, permatags, and keyword_models are backfilled here.

IMPORTANT PRE-CONDITIONS:
1. Run audit query to detect duplicate keywords per tenant:
   SELECT keyword, COUNT(*) as count FROM keywords
   GROUP BY tenant_id, keyword
   HAVING COUNT(*) > 1;

   If duplicates exist, resolve by merging or renaming before proceeding.

2. Find orphaned tags (keywords in tags but not in keywords table):
   SELECT DISTINCT mt.keyword FROM machine_tags mt
   WHERE NOT EXISTS (SELECT 1 FROM keywords k WHERE k.keyword = mt.keyword AND k.tenant_id = mt.tenant_id);

   If orphaned tags exist, either INSERT missing keywords or DELETE orphaned tags.

3. After backfill, verify NO rows have NULL keyword_id:
   SELECT 'machine_tags' as table_name, COUNT(*) as null_count FROM machine_tags WHERE keyword_id IS NULL
   UNION ALL
   SELECT 'permatags', COUNT(*) FROM permatags WHERE keyword_id IS NULL
   UNION ALL
   SELECT 'keyword_models', COUNT(*) FROM keyword_models WHERE keyword_id IS NULL;

   If any NULLs exist, resolve them before proceeding to Phase 3.

Revision ID: 202601200900
Revises: 202601200800
Create Date: 2026-01-20 09:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "202601200900"
down_revision = "202601200800"
branch_labels = None
depends_on = None


def upgrade():
    # ========================================================================
    # 1. Backfill tenant_id on keywords table from keyword_categories
    # ========================================================================
    op.execute("""
    UPDATE keywords k
    SET tenant_id = kc.tenant_id
    FROM keyword_categories kc
    WHERE k.category_id = kc.id;
    """)

    # ========================================================================
    # 2. Backfill keyword_id for machine_tags
    #
    # CRITICAL: This join only matches on keyword text + tenant.
    # If the same keyword exists in multiple categories (which should not happen
    # with the new uniqueness constraint added in Phase 1), the JOIN will be ambiguous.
    #
    # If you see rows with NULL keyword_id after this, it means either:
    # a) Duplicate keywords per tenant (fix with rename/merge)
    # b) Orphaned keyword references (fix with INSERT missing keywords or DELETE orphaned tags)
    # ========================================================================
    op.execute("""
    UPDATE machine_tags mt
    SET keyword_id = k.id
    FROM keywords k
    WHERE k.keyword = mt.keyword
    AND mt.tenant_id = k.tenant_id;
    """)

    # ========================================================================
    # 3. Backfill keyword_id for permatags
    # ========================================================================
    op.execute("""
    UPDATE permatags p
    SET keyword_id = k.id
    FROM keywords k
    WHERE k.keyword = p.keyword
    AND p.tenant_id = k.tenant_id;
    """)

    # ========================================================================
    # 4. Backfill keyword_id for keyword_models
    # ========================================================================
    op.execute("""
    UPDATE keyword_models km
    SET keyword_id = k.id
    FROM keywords k
    WHERE k.keyword = km.keyword
    AND km.tenant_id = k.tenant_id;
    """)

    # ========================================================================
    # 5. Backfill person_id for detected_faces
    #
    # Note: person_id remains nullable for unmatched/unrecognized faces
    # ========================================================================
    op.execute("""
    UPDATE detected_faces df
    SET person_id = p.id
    FROM people p
    WHERE p.name = df.person_name
    AND df.tenant_id = p.tenant_id;
    """)


def downgrade():
    # Reverse: Clear the backfilled columns
    op.execute("UPDATE keyword_models SET keyword_id = NULL;")
    op.execute("UPDATE permatags SET keyword_id = NULL;")
    op.execute("UPDATE machine_tags SET keyword_id = NULL;")
    op.execute("UPDATE detected_faces SET person_id = NULL;")
    op.execute("UPDATE keywords SET tenant_id = NULL;")
