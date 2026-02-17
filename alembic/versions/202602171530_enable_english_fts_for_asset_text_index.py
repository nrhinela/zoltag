"""enable_english_fts_for_asset_text_index

Revision ID: 202602171530
Revises: 202602171100
Create Date: 2026-02-17 15:30:00.000000
"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "202602171530"
down_revision: Union[str, None] = "202602171100"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute("DROP INDEX IF EXISTS idx_asset_text_index_search_tsv")
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_asset_text_index_search_tsv
        ON asset_text_index
        USING gin (to_tsvector('english', coalesce(search_text, '')))
        """
    )
    op.execute("DROP INDEX IF EXISTS idx_asset_text_index_search_text_trgm")
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_asset_text_index_search_text_trgm
        ON asset_text_index
        USING gin (lower(coalesce(search_text, '')) gin_trgm_ops)
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute("DROP INDEX IF EXISTS idx_asset_text_index_search_text_trgm")
    op.execute("DROP INDEX IF EXISTS idx_asset_text_index_search_tsv")
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_asset_text_index_search_tsv
        ON asset_text_index
        USING gin (to_tsvector('simple', coalesce(search_text, '')))
        """
    )
