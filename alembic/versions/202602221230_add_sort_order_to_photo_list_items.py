"""add sort_order to photo_list_items for drag-and-drop ordering

Revision ID: 202602221230
Revises: 202602221100
Create Date: 2026-02-22 12:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "202602221230"
down_revision: Union[str, None] = "202602221100"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "photo_list_items",
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )

    op.execute(
        """
        with ranked as (
          select
            id,
            row_number() over (
              partition by list_id
              order by added_at asc, id asc
            ) as rn
          from photo_list_items
        )
        update photo_list_items pli
        set sort_order = ranked.rn
        from ranked
        where pli.id = ranked.id
        """
    )

    op.create_index(
        "idx_photo_list_items_list_sort_order",
        "photo_list_items",
        ["list_id", "sort_order"],
    )


def downgrade() -> None:
    op.drop_index("idx_photo_list_items_list_sort_order", table_name="photo_list_items")
    op.drop_column("photo_list_items", "sort_order")
