"""SQLAlchemy models for Supabase authentication."""

from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, CheckConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import uuid

from photocat.metadata import Base


class UserProfile(Base):
    """User profile synced from Supabase auth.users.

    Stores user identity, approval status, and role information.
    Each user in Supabase Auth has a corresponding UserProfile record
    in PostgreSQL for authorization and tenant membership tracking.

    Attributes:
        supabase_uid: UUID primary key from auth.users.id
        email: User's email address (unique)
        email_verified: Whether email has been verified
        display_name: User's display name (optional)
        photo_url: Profile photo URL (optional)
        is_active: Whether user has been approved (default False)
        is_super_admin: System-wide admin flag (default False)
        created_at: Account creation timestamp
        updated_at: Last update timestamp
        last_login_at: Last successful login timestamp
        tenant_memberships: Relationship to UserTenant records
    """

    __tablename__ = "user_profiles"

    supabase_uid = Column(UUID(as_uuid=True), primary_key=True)
    email = Column(String(255), nullable=False, unique=True, index=True)
    email_verified = Column(Boolean, default=False)
    display_name = Column(String(255))
    photo_url = Column(String)

    # Approval workflow
    is_active = Column(Boolean, default=False, index=True)
    is_super_admin = Column(Boolean, default=False)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_login_at = Column(DateTime, nullable=True)

    # Relationships
    tenant_memberships = relationship(
        "UserTenant",
        back_populates="user",
        cascade="all, delete-orphan",
        foreign_keys="[UserTenant.supabase_uid]"
    )

    def __repr__(self) -> str:
        return f"<UserProfile(uid={self.supabase_uid}, email={self.email}, active={self.is_active})>"


class UserTenant(Base):
    """User-tenant membership with role assignment.

    Represents a user's membership in a tenant with an assigned role.
    Supports invitation workflow where memberships are created as pending
    (accepted_at=NULL) and then accepted by the user.

    Attributes:
        id: UUID primary key
        supabase_uid: Reference to UserProfile (UUID)
        tenant_id: Reference to Tenant (string)
        role: User's role in the tenant ('admin' or 'user')
        invited_by: Which admin created this membership (optional)
        invited_at: When the invitation was created
        accepted_at: When user accepted the invitation (NULL = pending)
        created_at: Record creation timestamp
        user: Relationship to UserProfile
    """

    __tablename__ = "user_tenants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    supabase_uid = Column(
        UUID(as_uuid=True),
        ForeignKey("user_profiles.supabase_uid", ondelete="CASCADE"),
        nullable=False
    )
    tenant_id = Column(
        String(255),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False
    )

    role = Column(String(50), nullable=False, default="user")

    invited_by = Column(
        UUID(as_uuid=True),
        ForeignKey("user_profiles.supabase_uid", ondelete="SET NULL"),
        nullable=True
    )
    invited_at = Column(DateTime, nullable=True)
    accepted_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship(
        "UserProfile",
        back_populates="tenant_memberships",
        foreign_keys=[supabase_uid],
        primaryjoin="UserTenant.supabase_uid == UserProfile.supabase_uid"
    )

    __table_args__ = (
        CheckConstraint("role IN ('admin', 'user')", name="ck_user_tenants_role"),
        Index("idx_user_tenants_supabase_uid", "supabase_uid"),
        Index("idx_user_tenants_tenant_id", "tenant_id"),
    )

    @property
    def is_accepted(self) -> bool:
        """Check if membership invitation has been accepted."""
        return self.accepted_at is not None

    @property
    def is_admin(self) -> bool:
        """Check if user has admin role in this tenant."""
        return self.role == "admin"

    def __repr__(self) -> str:
        return (
            f"<UserTenant(uid={self.supabase_uid}, tenant={self.tenant_id}, "
            f"role={self.role}, accepted={self.is_accepted})>"
        )


class Invitation(Base):
    """Token-based invitation for onboarding new users.

    Invitations are created by tenant admins to invite new users to join
    their tenant. Each invitation includes:
    - A secure random token for verification
    - 7-day expiration time
    - Specification of the role the user will have

    When a user accepts the invitation, a UserTenant record is created
    with the specified role, and the user is immediately activated
    (is_active=TRUE).

    Attributes:
        id: UUID primary key
        email: Email address being invited
        tenant_id: Tenant the user is being invited to
        role: Role the user will have in the tenant
        invited_by: Which admin created the invitation
        token: Cryptographically secure token for verification
        expires_at: When the invitation expires
        accepted_at: When the invitation was accepted (NULL = pending)
        created_at: Invitation creation timestamp
    """

    __tablename__ = "invitations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), nullable=False, index=True)
    tenant_id = Column(
        String(255),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False
    )
    role = Column(String(50), nullable=False, default="user")

    invited_by = Column(
        UUID(as_uuid=True),
        ForeignKey("user_profiles.supabase_uid", ondelete="CASCADE"),
        nullable=False
    )
    token = Column(String(64), unique=True, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    accepted_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        CheckConstraint("role IN ('admin', 'user')", name="ck_invitations_role"),
    )

    @property
    def is_pending(self) -> bool:
        """Check if invitation is still pending acceptance."""
        return self.accepted_at is None

    @property
    def is_expired(self) -> bool:
        """Check if invitation has expired."""
        return datetime.utcnow() > self.expires_at

    def __repr__(self) -> str:
        return (
            f"<Invitation(email={self.email}, tenant={self.tenant_id}, "
            f"pending={self.is_pending}, expired={self.is_expired})>"
        )
