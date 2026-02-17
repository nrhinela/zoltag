"""Merge pgvector and keyword-threshold migration heads.

Revision ID: 202602162210
Revises: 202602160002, 202602162200
Create Date: 2026-02-16 22:10:00.000000
"""

from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = "202602162210"
down_revision: Union[str, Sequence[str], None] = ("202602160002", "202602162200")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
