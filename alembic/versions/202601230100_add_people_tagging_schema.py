"""Add people tagging schema and bridge to keywords infrastructure.

This migration extends the existing tagging system to support people tagging by:
1. Extending people table with instagram_url and person_category
2. Creating person_categories table for organizing people
3. Extending keywords table with person_id and tag_type
4. Extending keyword_categories with person_category linking
5. Adding indexes for efficient queries

The design treats people as special keywords, reusing 90% of the existing
tagging infrastructure (MachineTag, search, filters, etc.) while maintaining
rich Person attributes (name, instagram_url, category).

Revision ID: 202601230100
Revises: 202601201100
Create Date: 2026-01-23 01:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "202601230100"
down_revision = "202601201100"
branch_labels = None
depends_on = None


def upgrade():
    """Add people tagging schema extensions."""

    # ========================================================================
    # Phase 1: Create person_categories table (for organizing people by type)
    # ========================================================================
    op.create_table(
        "person_categories",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("display_name", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_index(
        "idx_person_categories_tenant_name",
        "person_categories",
        ["tenant_id", "name"],
        unique=True
    )

    # ========================================================================
    # Phase 2: Extend people table with instagram_url and person_category
    # ========================================================================
    op.add_column(
        "people",
        sa.Column("instagram_url", sa.String(length=512), nullable=True)
    )
    op.add_column(
        "people",
        sa.Column("person_category", sa.String(length=50), nullable=False, server_default="people_in_scene")
    )

    # Add index for person_category queries
    op.create_index(
        "idx_people_tenant_category",
        "people",
        ["tenant_id", "person_category"]
    )

    # ========================================================================
    # Phase 3: Extend keyword_categories table with person_category linking
    # ========================================================================
    op.add_column(
        "keyword_categories",
        sa.Column("person_category_id", sa.Integer(), nullable=True)
    )
    op.add_column(
        "keyword_categories",
        sa.Column("is_people_category", sa.Boolean(), nullable=False, server_default=sa.text("false"))
    )

    # Add unique constraint for person_category linking (one-to-one)
    op.create_unique_constraint(
        "uq_keyword_categories_person_category_id",
        "keyword_categories",
        ["person_category_id"]
    )

    # ========================================================================
    # Phase 4: Extend keywords table with person_id and tag_type
    # ========================================================================
    op.add_column(
        "keywords",
        sa.Column("person_id", sa.Integer(), nullable=True)
    )
    op.add_column(
        "keywords",
        sa.Column("tag_type", sa.String(length=20), nullable=False, server_default="keyword")
    )

    # Add unique constraint for person_id (one person per keyword)
    op.create_unique_constraint(
        "uq_keywords_person_id",
        "keywords",
        ["person_id"]
    )

    # Add indexes for efficient queries
    op.create_index(
        "idx_keywords_person_id",
        "keywords",
        ["person_id"]
    )
    op.create_index(
        "idx_keywords_tag_type",
        "keywords",
        ["tag_type"]
    )

    print("""
    ========================================================================
    Migration 202601230100: People Tagging Schema Added
    ========================================================================

    Schema Changes:
    ✓ Created person_categories table
    ✓ Extended people table with instagram_url and person_category
    ✓ Extended keyword_categories with person_category linking
    ✓ Extended keywords with person_id and tag_type

    Next Steps:
    1. Run application with new schema
    2. Create default person categories via API:
       - photo_author (Photo Author)
       - people_in_scene (People in Scene)
    3. Begin tagging people to images

    Design Notes:
    - Each person gets ONE keyword automatically created
    - Keywords table bridges Person → MachineTag (unified tagging)
    - tag_type field allows future extensions (detected_face, etc.)
    - Reuses 90% of existing search/filter/ML infrastructure
    ========================================================================
    """)


def downgrade():
    """Reverse people tagging schema extensions."""

    # Drop new indexes
    op.drop_index("idx_keywords_tag_type", table_name="keywords")
    op.drop_index("idx_keywords_person_id", table_name="keywords")
    op.drop_index("idx_people_tenant_category", table_name="people")
    op.drop_index("idx_person_categories_tenant_name", table_name="person_categories")

    # Drop new constraints
    op.drop_constraint("uq_keywords_person_id", "keywords", type_="unique")
    op.drop_constraint("uq_keyword_categories_person_category_id", "keyword_categories", type_="unique")

    # Drop new columns
    op.drop_column("keywords", "tag_type")
    op.drop_column("keywords", "person_id")
    op.drop_column("keyword_categories", "is_people_category")
    op.drop_column("keyword_categories", "person_category_id")
    op.drop_column("people", "person_category")
    op.drop_column("people", "instagram_url")

    # Drop new table
    op.drop_table("person_categories")
