"""Database models for shared list collaboration (Phase I)."""

import uuid

import sqlalchemy as sa
from sqlalchemy import Column, String, Text, Boolean, ForeignKey, Index
from sqlalchemy.sql import func

from zoltag.models.config import Base


class GuestIdentity(Base):
    """Canonical mapping of guest email -> Supabase user UUID."""

    __tablename__ = "guest_identities"

    email_normalized = Column(String(255), primary_key=True)
    supabase_uid = Column(sa.UUID(as_uuid=True), nullable=False, unique=True)
    created_at = Column(sa.DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(sa.DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("idx_guest_identities_uid", "supabase_uid"),
    )


class ListShare(Base):
    """One row per (list, guest) pair — links a guest to a shared PhotoList."""

    __tablename__ = "list_shares"

    id = Column(sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(sa.UUID(as_uuid=True), nullable=False, index=True)
    list_id = Column(sa.Integer, ForeignKey("photo_lists.id", ondelete="CASCADE"), nullable=False, index=True)
    guest_uid = Column(sa.UUID(as_uuid=True), nullable=False)       # Supabase auth.users.id
    guest_email = Column(String(255), nullable=False)                # denormalized for display
    created_by_uid = Column(sa.UUID(as_uuid=True), nullable=False)  # inviting user's Supabase uid
    allow_download_thumbs = Column(Boolean, nullable=False, server_default=sa.text("false"))
    allow_download_originals = Column(Boolean, nullable=False, server_default=sa.text("false"))
    expires_at = Column(sa.DateTime(timezone=True), nullable=True)   # NULL = never expires
    created_at = Column(sa.DateTime(timezone=True), nullable=False, server_default=func.now())
    revoked_at = Column(sa.DateTime(timezone=True), nullable=True)   # NULL = active

    __table_args__ = (
        Index("idx_list_shares_tenant", "tenant_id"),
        Index("idx_list_shares_list", "list_id"),
        Index("idx_list_shares_guest_uid", "guest_uid"),
    )


class MemberComment(Base):
    """Free-text comment by any user (guest or member) on an asset."""

    __tablename__ = "member_comments"

    id = Column(sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(sa.UUID(as_uuid=True), nullable=False, index=True)
    asset_id = Column(sa.UUID(as_uuid=True), nullable=False)        # references assets.id (no FK)
    user_uid = Column(sa.UUID(as_uuid=True), nullable=False)        # Supabase auth.users.id
    comment_text = Column(Text, nullable=False)
    source = Column(String(20), nullable=False, server_default="user")  # 'user' or 'guest'
    share_id = Column(sa.UUID(as_uuid=True), ForeignKey("list_shares.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(sa.DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(sa.DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("idx_member_comments_tenant", "tenant_id"),
        Index("idx_member_comments_asset", "asset_id"),
        Index("idx_member_comments_user", "user_uid"),
        Index("idx_member_comments_share", "share_id"),
    )


class MemberRating(Base):
    """Per-user rating (0-3) on an asset. One rating per user per asset (upsert)."""

    __tablename__ = "member_ratings"

    id = Column(sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(sa.UUID(as_uuid=True), nullable=False, index=True)
    asset_id = Column(sa.UUID(as_uuid=True), nullable=False)        # references assets.id (no FK)
    user_uid = Column(sa.UUID(as_uuid=True), nullable=False)        # Supabase auth.users.id
    rating = Column(sa.SmallInteger, nullable=False)
    source = Column(String(20), nullable=False, server_default="user")  # 'user' or 'guest'
    share_id = Column(sa.UUID(as_uuid=True), ForeignKey("list_shares.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(sa.DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(sa.DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        sa.UniqueConstraint("asset_id", "user_uid", name="uq_member_ratings_asset_user"),
        sa.CheckConstraint("rating BETWEEN 0 AND 3", name="chk_member_ratings_range"),
        Index("idx_member_ratings_tenant", "tenant_id"),
        Index("idx_member_ratings_asset", "asset_id"),
        Index("idx_member_ratings_user", "user_uid"),
        Index("idx_member_ratings_share", "share_id"),
    )
