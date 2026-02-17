"""merge asset notes and workflow heads

Revision ID: 202602161710
Revises: 202602160001, 202602161700
Create Date: 2026-02-16 17:10:00.000000
"""

from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = "202602161710"
down_revision: Union[str, Sequence[str], None] = ("202602160001", "202602161700")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
