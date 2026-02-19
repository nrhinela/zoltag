"""Authentication endpoints for Supabase Auth.

IMPORTANT - OAuth Provider Linking:
When a user has signed up via email/password and later tries to login via
Google OAuth, Supabase may create a NEW user account with a different UUID
but the same email. This /register endpoint handles this scenario by:

1. Checking if a user_profile already exists with the given email
2. If found, returning that profile's status instead of creating a duplicate
3. This allows users to migrate between auth methods without creating new accounts

To fix this properly, configure Supabase to link OAuth providers to existing
email accounts:
- Go to Supabase Dashboard > Authentication > Providers > Google
- Enable "Link multiple providers to the same user account"
- This makes OAuth authenticate existing email accounts instead of creating new ones

See: https://supabase.com/docs/guides/auth/social-login/auth-google
"""

import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request, status, Header
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import Optional
from jose import JWTError

logger = logging.getLogger(__name__)

from zoltag.database import get_db
from zoltag.auth.dependencies import (
    get_authenticated_user_allow_pending,
    get_current_user,
    get_effective_membership_permissions,
    get_tenant_role_id_by_key,
    invalidate_tenant_permission_cache,
)
from zoltag.auth.jwt import get_supabase_uid_from_token
from zoltag.auth.models import UserProfile, UserTenant, Invitation
from zoltag.auth.schemas import (
    LoginResponse,
    RegisterRequest,
    AcceptInvitationRequest,
    UserProfileResponse,
    TenantMembershipResponse,
)
from zoltag.metadata import Tenant as TenantModel
from zoltag.ratelimit import limiter


router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
_LEGACY_ROLE_KEYS = {"user", "editor", "admin"}


def _legacy_role_from_key(role_key: Optional[str]) -> str:
    normalized = str(role_key or "").strip().lower()
    return normalized if normalized in _LEGACY_ROLE_KEYS else "user"


@router.post("/register", response_model=dict, status_code=201)
@limiter.limit("120/minute")
async def register(
    request: Request,
    body: RegisterRequest,
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(None)
):
    """Complete registration after Supabase signup.

    User must have already signed up via Supabase Auth and obtained a JWT token.
    This endpoint creates the user_profile record in the database.

    The user starts with is_active=FALSE and must be approved by a super admin
    before they can access any tenant (unless they accept an invitation, which
    auto-approves them).

    This endpoint does NOT require the user profile to already exist - it handles
    the initial registration flow after Supabase signup.

    Args:
        request: Registration data (display_name)
        db: Database session
        authorization: Bearer token from Authorization header

    Returns:
        dict: Status message and user ID

    Raises:
        HTTPException 401: Invalid or missing JWT token
    """
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header format",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = authorization[7:]  # Remove "Bearer " prefix

    try:
        supabase_uid = await get_supabase_uid_from_token(token)
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check if profile already exists
    existing = db.query(UserProfile).filter(
        UserProfile.supabase_uid == supabase_uid
    ).first()

    if existing:
        return {
            "message": "Profile already exists",
            "status": "active" if existing.is_active else "pending_approval",
            "user_id": str(supabase_uid)
        }

    # For new registrations, we need to extract email from Supabase
    # The JWT token includes the email claim
    from zoltag.auth.jwt import verify_supabase_jwt
    try:
        decoded = await verify_supabase_jwt(token)
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Failed to verify token: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )

    email = decoded.get("email", "")
    email_verified = decoded.get("email_confirmed_at") is not None

    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Token does not contain email claim",
        )

    # Check if a profile with this email already exists (from a different provider)
    # This can happen when:
    # 1. User signed up with email/password first
    # 2. Then tries to login via Google OAuth (creates a NEW Supabase user with same email)
    # In this case, return the existing profile status instead of creating a duplicate
    existing_by_email = db.query(UserProfile).filter(
        UserProfile.email == email
    ).first()

    if existing_by_email:
        # Email already exists - likely OAuth provider linking scenario
        # Return existing profile status
        return {
            "message": "Email already registered with different provider",
            "status": "active" if existing_by_email.is_active else "pending_approval",
            "user_id": str(existing_by_email.supabase_uid),
            "note": "Please sign in with your original authentication method"
        }

    has_pending_invitation = db.query(Invitation.id).filter(
        func.lower(Invitation.email) == str(email).strip().lower(),
        Invitation.accepted_at.is_(None),
        Invitation.expires_at > datetime.utcnow(),
    ).first() is not None
    if not has_pending_invitation:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invitation required before registration",
        )

    # Create new profile (inactive until invitation claim during authenticated login)
    try:
        profile = UserProfile(
            supabase_uid=supabase_uid,
            email=email,
            email_verified=email_verified,
            display_name=body.display_name or email.split("@")[0],
            is_active=False,
            is_super_admin=False
        )

        db.add(profile)
        db.commit()
        db.refresh(profile)
    except Exception as e:
        db.rollback()
        logger.error("Failed to create user profile for %s: %s", supabase_uid, e)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to create user profile. Please try again or contact support.",
        )

    return {
        "message": "Registration pending admin approval",
        "status": "pending_approval",
        "user_id": str(supabase_uid)
    }


@router.get("/me", response_model=LoginResponse)
async def get_current_user_info(
    user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get current user info with tenant memberships.

    Returns the authenticated user's profile and list of accepted tenant memberships.
    Pending invitations (accepted_at=NULL) are not included in the response.

    This endpoint is used by the frontend to:
    - Display user profile information
    - Populate tenant selector
    - Verify user approval status

    Args:
        user: Current authenticated user
        db: Database session

    Returns:
        LoginResponse: User profile and list of tenant memberships

    Raises:
        HTTPException 401: Invalid or missing JWT token
        HTTPException 403: User account pending approval
    """
    # Fetch accepted tenant memberships
    memberships = db.query(UserTenant).filter(
        UserTenant.supabase_uid == user.supabase_uid,
        UserTenant.accepted_at.isnot(None)
    ).all()

    tenants = []
    for membership in memberships:
        tenant = db.query(TenantModel).filter(
            TenantModel.id == membership.tenant_id
        ).first()
        if tenant:
            role_key = None
            role_label = None
            role_ref = getattr(membership, "tenant_role", None)
            if role_ref is not None:
                role_key = str(role_ref.role_key or "").strip() or None
                role_label = str(role_ref.label or "").strip() or None
            if not role_key:
                fallback_role = _legacy_role_from_key(getattr(membership, "role", None))
                role_key = fallback_role
                role_label = role_label or fallback_role.title()
            legacy_role = _legacy_role_from_key(role_key)
            permissions = sorted(get_effective_membership_permissions(db, membership))
            tenants.append(TenantMembershipResponse(
                tenant_id=tenant.id,
                tenant_identifier=getattr(tenant, "identifier", None),
                tenant_name=tenant.name,
                role=legacy_role,
                role_key=role_key,
                role_label=role_label,
                permissions=permissions,
                accepted_at=membership.accepted_at
            ))

    return LoginResponse(
        user=UserProfileResponse.from_orm(user),
        tenants=tenants
    )


@router.post("/accept-invitation", response_model=LoginResponse)
@limiter.limit("20/minute")
async def accept_invitation(
    request: Request,
    body: AcceptInvitationRequest,
    user: UserProfile = Depends(get_authenticated_user_allow_pending),
    db: Session = Depends(get_db)
):
    """Accept an invitation and join a tenant.

    When a user accepts an invitation:
    1. The invitation token is verified (must match email, not expired, not already accepted)
    2. The user account is activated (is_active=TRUE)
    3. A user_tenants record is created with the specified role
    4. The invitation is marked as accepted

    This flow allows admins to invite users with a specific role, and the user
    is automatically approved upon accepting the invitation (no super admin approval needed).

    Args:
        request: Invitation token from email link
        user: Current authenticated user
        db: Database session

    Returns:
        LoginResponse: Updated user profile and tenant list

    Raises:
        HTTPException 401: Invalid or missing JWT token
        HTTPException 404: Invalid, expired, or already-accepted invitation
    """
    # Find invitation
    invitation = db.query(Invitation).filter(
        Invitation.token == body.invitation_token,
        Invitation.email == user.email,
        Invitation.accepted_at.is_(None),
        Invitation.expires_at > datetime.utcnow()
    ).first()

    if not invitation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invalid, expired, or already-accepted invitation"
        )

    # Activate user account (auto-approve via invitation)
    user.is_active = True

    accepted_at = datetime.utcnow()
    tenant_role_id = get_tenant_role_id_by_key(
        db,
        tenant_id=invitation.tenant_id,
        role_key=invitation.role,
    )

    # Upsert tenant membership with invitation role.
    membership = db.query(UserTenant).filter(
        UserTenant.supabase_uid == user.supabase_uid,
        UserTenant.tenant_id == invitation.tenant_id,
    ).first()
    if membership is None:
        membership = UserTenant(
            supabase_uid=user.supabase_uid,
            tenant_id=invitation.tenant_id,
            tenant_role_id=tenant_role_id,
            role=invitation.role,
            invited_by=invitation.invited_by,
            invited_at=invitation.created_at,
            accepted_at=accepted_at,
        )
        db.add(membership)
    else:
        membership.tenant_role_id = tenant_role_id
        membership.role = invitation.role
        membership.invited_by = membership.invited_by or invitation.invited_by
        membership.invited_at = membership.invited_at or invitation.created_at
        membership.accepted_at = membership.accepted_at or accepted_at

    # Mark invitation as accepted
    invitation.accepted_at = accepted_at

    db.commit()
    invalidate_tenant_permission_cache(
        supabase_uid=str(user.supabase_uid),
        tenant_id=str(invitation.tenant_id),
    )

    # Return updated user info with new tenant
    return await get_current_user_info(user, db)


@router.post("/logout", status_code=200)
async def logout(user: UserProfile = Depends(get_current_user)):
    """Logout endpoint (server-side cleanup).

    This is a no-op on the server side. The frontend should:
    1. Call `supabase.auth.signOut()` to revoke the token
    2. Clear localStorage/sessionStorage
    3. Clear any cookies (if using httpOnly cookies)

    This endpoint is provided for:
    - Audit logging (future)
    - Explicit token revocation (future, with Supabase Pro)
    - Consistent API design

    Args:
        user: Current authenticated user

    Returns:
        dict: Success message
    """
    return {"message": "Logged out successfully"}
