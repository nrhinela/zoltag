"""expand_image_metadata_file_size_to_bigint

Revision ID: 202602152140
Revises: 202602151030
Create Date: 2026-02-15 21:40:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "202602152140"
down_revision: Union[str, None] = "202602151030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.alter_column(
            "image_metadata",
            "file_size",
            existing_type=sa.Integer(),
            type_=sa.BigInteger(),
            existing_nullable=True,
            postgresql_using="file_size::bigint",
        )
    else:
        with op.batch_alter_table("image_metadata") as batch_op:
            batch_op.alter_column(
                "file_size",
                existing_type=sa.Integer(),
                type_=sa.BigInteger(),
                existing_nullable=True,
            )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.alter_column(
            "image_metadata",
            "file_size",
            existing_type=sa.BigInteger(),
            type_=sa.Integer(),
            existing_nullable=True,
            postgresql_using="file_size::integer",
        )
    else:
        with op.batch_alter_table("image_metadata") as batch_op:
            batch_op.alter_column(
                "file_size",
                existing_type=sa.BigInteger(),
                type_=sa.Integer(),
                existing_nullable=True,
            )
