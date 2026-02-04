"""add_keyword_category_slug

Revision ID: 202602041430
Revises: 202602041315
Create Date: 2026-02-04 14:30:00.000000
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "202602041430"
down_revision: Union[str, None] = "202602041315"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "keyword_categories",
        sa.Column("slug", sa.String(length=60), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("keyword_categories", "slug")
