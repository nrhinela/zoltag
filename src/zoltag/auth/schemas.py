"""Pydantic schemas for authentication requests and responses."""

from datetime import datetime
from typing import Optional, List, Literal
from pydantic import BaseModel, UUID4, Field

TenantRole = Literal["user", "editor", "admin"]


class UserProfileResponse(BaseModel):
    """User profile response schema."""

    supabase_uid: UUID4 = Field(..., description="Supabase UUID")
    email: str = Field(..., description="User email address")
    email_verified: bool = Field(..., description="Whether email is verified")
    display_name: Optional[str] = Field(None, description="User display name")
    photo_url: Optional[str] = Field(None, description="Profile photo URL")
    is_active: bool = Field(..., description="Whether user is approved")
    is_super_admin: bool = Field(..., description="System-wide admin status")
    created_at: datetime = Field(..., description="Account creation time")
    last_login_at: Optional[datetime] = Field(None, description="Last login time")

    class Config:
        from_attributes = True


class TenantMembershipResponse(BaseModel):
    """User's tenant membership response."""

    tenant_id: str = Field(..., description="Tenant ID")
    tenant_name: str = Field(..., description="Tenant display name")
    role: TenantRole = Field(..., description="User's role in tenant (admin|editor|user)")
    accepted_at: Optional[datetime] = Field(None, description="When membership was accepted")

    class Config:
        from_attributes = True


class LoginResponse(BaseModel):
    """Login response with user info and tenants."""

    user: UserProfileResponse = Field(..., description="Current user profile")
    tenants: List[TenantMembershipResponse] = Field(..., description="User's tenant memberships")

    class Config:
        from_attributes = True


class RegisterRequest(BaseModel):
    """Registration request body."""

    display_name: Optional[str] = Field(None, max_length=255, description="User display name")

    class Config:
        json_schema_extra = {
            "example": {
                "display_name": "John Doe"
            }
        }


class AcceptInvitationRequest(BaseModel):
    """Accept invitation request body."""

    invitation_token: str = Field(..., description="Invitation token from email link")

    class Config:
        json_schema_extra = {
            "example": {
                "invitation_token": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            }
        }


class CreateInvitationRequest(BaseModel):
    """Create invitation request body."""

    email: str = Field(..., description="Email address to invite")
    tenant_id: str = Field(..., description="Tenant ID")
    role: TenantRole = Field("user", description="Role (admin|editor|user)")

    class Config:
        json_schema_extra = {
            "example": {
                "email": "user@example.com",
                "tenant_id": "tenant-1",
                "role": "user"
            }
        }


class ApproveUserRequest(BaseModel):
    """Approve pending user request body."""

    tenant_id: Optional[str] = Field(None, description="Optionally assign to tenant")
    role: TenantRole = Field("user", description="Role (admin|editor|user)")

    class Config:
        json_schema_extra = {
            "example": {
                "tenant_id": "tenant-1",
                "role": "user"
            }
        }


class UpdateTenantMembershipRequest(BaseModel):
    """Update an existing tenant membership role."""

    role: TenantRole = Field(..., description="Role (admin|editor|user)")

    class Config:
        json_schema_extra = {
            "example": {
                "role": "admin"
            }
        }


class InvitationResponse(BaseModel):
    """Invitation response schema."""

    id: UUID4 = Field(..., description="Invitation ID")
    email: str = Field(..., description="Invited email")
    tenant_id: str = Field(..., description="Tenant ID")
    role: str = Field(..., description="Role in tenant")
    expires_at: datetime = Field(..., description="Expiration time")
    accepted_at: Optional[datetime] = Field(None, description="When accepted")
    created_at: datetime = Field(..., description="Creation time")

    class Config:
        from_attributes = True


class ErrorResponse(BaseModel):
    """Standard error response."""

    detail: str = Field(..., description="Error message")
    code: Optional[str] = Field(None, description="Error code")

    class Config:
        json_schema_extra = {
            "example": {
                "detail": "Account pending admin approval",
                "code": "ACCOUNT_PENDING_APPROVAL"
            }
        }
