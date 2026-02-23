"""align member ratings to 0-3 scale

Revision ID: 202602201430
Revises: 202602192300
Create Date: 2026-02-20 14:30:00.000000
"""

from typing import Sequence, Union

from alembic import op


revision: str = "202602201430"
down_revision: Union[str, None] = "202602192300"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Normalize legacy guest ratings before tightening the constraint.
    op.execute("UPDATE member_ratings SET rating = 3 WHERE rating > 3")
    op.execute("UPDATE member_ratings SET rating = 0 WHERE rating < 0")
    op.drop_constraint("chk_member_ratings_range", "member_ratings", type_="check")
    op.create_check_constraint(
        "chk_member_ratings_range",
        "member_ratings",
        "rating BETWEEN 0 AND 3",
    )


def downgrade() -> None:
    # Move rows back into the old 1-5 domain before restoring the old constraint.
    op.execute("UPDATE member_ratings SET rating = 1 WHERE rating < 1")
    op.drop_constraint("chk_member_ratings_range", "member_ratings", type_="check")
    op.create_check_constraint(
        "chk_member_ratings_range",
        "member_ratings",
        "rating BETWEEN 1 AND 5",
    )

