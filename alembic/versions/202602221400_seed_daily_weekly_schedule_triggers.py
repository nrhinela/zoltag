"""seed daily and weekly global schedule triggers (merged into 202602221300)

This migration is intentionally empty — its content was merged into
202602221300 to avoid a within-transaction DDL/DML ordering issue.
Kept as a stub so the alembic_version stamp is valid.

Revision ID: 202602221400
Revises: 202602221300
Create Date: 2026-02-22 14:00:00.000000
"""

from typing import Sequence, Union


revision: str = "202602221400"
down_revision: Union[str, None] = "202602221300"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
