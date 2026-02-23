"""add shared lists phase i

Revision ID: 202602192300
Revises: 202602192230
Create Date: 2026-02-19 23:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202602192300"
down_revision: Union[str, None] = "202602192230"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "list_shares",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("list_id", sa.Integer, sa.ForeignKey("photo_lists.id", ondelete="CASCADE"), nullable=False),
        sa.Column("guest_uid", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("guest_email", sa.String(255), nullable=False),
        sa.Column("created_by_uid", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("allow_download_thumbs", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("allow_download_originals", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("list_id", "guest_uid", name="uq_list_shares_list_guest"),
    )
    op.create_index("idx_list_shares_tenant", "list_shares", ["tenant_id"])
    op.create_index("idx_list_shares_list", "list_shares", ["list_id"])
    op.create_index("idx_list_shares_guest_uid", "list_shares", ["guest_uid"])

    op.create_table(
        "member_comments",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("asset_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("user_uid", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("comment_text", sa.Text, nullable=False),
        sa.Column("source", sa.String(20), nullable=False, server_default="user"),
        sa.Column("share_id", sa.UUID(as_uuid=True), sa.ForeignKey("list_shares.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("idx_member_comments_tenant", "member_comments", ["tenant_id"])
    op.create_index("idx_member_comments_asset", "member_comments", ["asset_id"])
    op.create_index("idx_member_comments_user", "member_comments", ["user_uid"])
    op.create_index("idx_member_comments_share", "member_comments", ["share_id"])

    op.create_table(
        "member_ratings",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("asset_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("user_uid", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("rating", sa.SmallInteger, nullable=False),
        sa.Column("source", sa.String(20), nullable=False, server_default="user"),
        sa.Column("share_id", sa.UUID(as_uuid=True), sa.ForeignKey("list_shares.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.UniqueConstraint("asset_id", "user_uid", name="uq_member_ratings_asset_user"),
        sa.CheckConstraint("rating BETWEEN 1 AND 5", name="chk_member_ratings_range"),
    )
    op.create_index("idx_member_ratings_tenant", "member_ratings", ["tenant_id"])
    op.create_index("idx_member_ratings_asset", "member_ratings", ["asset_id"])
    op.create_index("idx_member_ratings_user", "member_ratings", ["user_uid"])
    op.create_index("idx_member_ratings_share", "member_ratings", ["share_id"])


def downgrade() -> None:
    op.drop_table("member_ratings")
    op.drop_table("member_comments")
    op.drop_table("list_shares")
