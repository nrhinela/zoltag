"""Admin endpoints for user and invitation management."""

from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request, status, Query, Header
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import List, Optional
import secrets

from zoltag.ratelimit import limiter

from zoltag.database import get_db
from zoltag.auth.dependencies import (
    get_current_user,
    require_super_admin,
    require_tenant_role_from_header,
)
from zoltag.auth.models import UserProfile, UserTenant, Invitation
from zoltag.auth.schemas import (
    UserProfileResponse,
    CreateInvitationRequest,
    ApproveUserRequest,
    UpdateTenantMembershipRequest,
    InvitationResponse,
)
from zoltag.metadata import Tenant as TenantModel
from zoltag.settings import settings


router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


# ============================================================================
# User Management Endpoints
# ============================================================================


@router.get("/users/pending", response_model=List[UserProfileResponse])
async def list_pending_users(
    admin: UserProfile = Depends(require_super_admin),
    db: Session = Depends(get_db)
):
    """List users pending approval (super admin only).

    Returns all users with is_active=FALSE, sorted by creation time (newest first).

    Args:
        admin: Current user (must be super admin)
        db: Database session

    Returns:
        List[UserProfileResponse]: List of pending users

    Raises:
        HTTPException 403: User is not a super admin
    """
    users = db.query(UserProfile).filter(
        UserProfile.is_active == False
    ).order_by(UserProfile.created_at.desc()).all()

    return [UserProfileResponse.from_orm(u) for u in users]


@router.get("/users/approved", response_model=List[dict])
async def list_approved_users(
    admin: UserProfile = Depends(require_super_admin),
    db: Session = Depends(get_db)
):
    """List approved users with their tenant memberships (super admin only).

    Returns all users with is_active=TRUE, sorted by creation time (newest first).
    Each user includes their tenant memberships with roles.

    Args:
        admin: Current user (must be super admin)
        db: Database session

    Returns:
        List[dict]: List of approved users with tenant info

    Raises:
        HTTPException 403: User is not a super admin
    """
    users = db.query(UserProfile).filter(
        UserProfile.is_active == True
    ).order_by(UserProfile.created_at.desc()).all()

    result = []
    for user in users:
        user_data = UserProfileResponse.from_orm(user).dict()

        # Fetch tenant memberships
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
                tenants.append({
                    "tenant_id": tenant.id,
                    "tenant_name": tenant.name,
                    "role": membership.role,
                    "accepted_at": membership.accepted_at.isoformat() if membership.accepted_at else None
                })

        user_data["tenants"] = tenants
        result.append(user_data)

    return result


@router.get("/tenant-users", response_model=List[dict])
async def list_tenant_users(
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    _admin: UserProfile = Depends(require_tenant_role_from_header("admin")),
    db: Session = Depends(get_db),
):
    """List users assigned to the tenant in X-Tenant-ID (tenant admin or super admin)."""

    memberships = db.query(UserTenant).filter(
        UserTenant.tenant_id == x_tenant_id,
        UserTenant.accepted_at.isnot(None),
    ).all()

    users_by_id = {}
    if memberships:
        user_ids = [membership.supabase_uid for membership in memberships]
        users = db.query(UserProfile).filter(UserProfile.supabase_uid.in_(user_ids)).all()
        users_by_id = {user.supabase_uid: user for user in users}

    result = []
    for membership in memberships:
        user = users_by_id.get(membership.supabase_uid)
        if not user:
            continue
        profile = UserProfileResponse.from_orm(user).dict()
        profile["role"] = membership.role
        profile["tenant_id"] = membership.tenant_id
        profile["accepted_at"] = membership.accepted_at.isoformat() if membership.accepted_at else None
        result.append(profile)

    result.sort(
        key=lambda item: (
            (item.get("display_name") or "").lower(),
            (item.get("email") or "").lower(),
        )
    )
    return result


@router.post("/users/{supabase_uid}/approve", response_model=dict)
@limiter.limit("10/minute")
async def approve_user(
    request: Request,
    supabase_uid: str,
    body: ApproveUserRequest,
    admin: UserProfile = Depends(require_super_admin),
    db: Session = Depends(get_db)
):
    """Approve a pending user and optionally assign to a tenant.

    When approving a user:
    1. Set is_active=TRUE
    2. Optionally create a user_tenants entry for a specific tenant
    3. Optionally assign a specific role (default: user)

    Args:
        supabase_uid: User UUID to approve
        request: Approval details (optional tenant_id, role)
        admin: Current user (must be super admin)
        db: Database session

    Returns:
        dict: Success message

    Raises:
        HTTPException 403: User is not a super admin
        HTTPException 404: User not found or tenant not found
    """
    user = db.query(UserProfile).filter(
        UserProfile.supabase_uid == supabase_uid
    ).first()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Activate user
    user.is_active = True

    # Optionally assign to tenant
    if body.tenant_id:
        # Verify tenant exists
        tenant = db.query(TenantModel).filter(
            TenantModel.id == body.tenant_id
        ).first()
        if not tenant:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")

        # Create membership
        membership = UserTenant(
            supabase_uid=user.supabase_uid,
            tenant_id=body.tenant_id,
            role=body.role,
            invited_by=admin.supabase_uid,
            invited_at=datetime.utcnow(),
            accepted_at=datetime.utcnow()
        )
        db.add(membership)

    db.commit()

    return {"message": "User approved", "user_id": str(user.supabase_uid)}


@router.post("/users/{supabase_uid}/assign-tenant", response_model=dict)
async def assign_user_to_tenant(
    supabase_uid: str,
    request: ApproveUserRequest,
    admin: UserProfile = Depends(require_super_admin),
    db: Session = Depends(get_db)
):
    """Assign an approved user to a tenant with a specific role.

    This endpoint allows super admins to add already-approved users to tenants.

    Args:
        supabase_uid: User UUID to assign
        request: Assignment details (tenant_id, role)
        admin: Current user (must be super admin)
        db: Database session

    Returns:
        dict: Success message

    Raises:
        HTTPException 403: User is not a super admin
        HTTPException 404: User or tenant not found
        HTTPException 400: User already assigned to this tenant
    """
    user = db.query(UserProfile).filter(
        UserProfile.supabase_uid == supabase_uid
    ).first()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if not request.tenant_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant ID is required")

    # Verify tenant exists
    tenant = db.query(TenantModel).filter(
        TenantModel.id == request.tenant_id
    ).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")

    # Check if already assigned
    existing = db.query(UserTenant).filter(
        UserTenant.supabase_uid == user.supabase_uid,
        UserTenant.tenant_id == request.tenant_id
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is already assigned to this tenant"
        )

    # Create membership
    membership = UserTenant(
        supabase_uid=user.supabase_uid,
        tenant_id=request.tenant_id,
        role=request.role,
        invited_by=admin.supabase_uid,
        invited_at=datetime.utcnow(),
        accepted_at=datetime.utcnow()
    )
    db.add(membership)
    db.commit()

    return {"message": "User assigned to tenant", "user_id": str(user.supabase_uid)}


@router.patch("/users/{supabase_uid}/tenant-memberships/{tenant_id}", response_model=dict)
async def update_user_tenant_membership(
    supabase_uid: str,
    tenant_id: str,
    request: UpdateTenantMembershipRequest,
    _admin: UserProfile = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Update role for an existing user-tenant membership (super admin only)."""

    membership = db.query(UserTenant).filter(
        UserTenant.supabase_uid == supabase_uid,
        UserTenant.tenant_id == tenant_id,
        UserTenant.accepted_at.isnot(None),
    ).first()

    if not membership:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant membership not found",
        )

    membership.role = request.role
    db.commit()

    return {
        "message": "Tenant role updated",
        "user_id": supabase_uid,
        "tenant_id": tenant_id,
        "role": membership.role,
    }


@router.delete("/users/{supabase_uid}/tenant-memberships/{tenant_id}", response_model=dict)
async def remove_user_tenant_membership(
    supabase_uid: str,
    tenant_id: str,
    _admin: UserProfile = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Remove an existing user-tenant membership (super admin only)."""

    membership = db.query(UserTenant).filter(
        UserTenant.supabase_uid == supabase_uid,
        UserTenant.tenant_id == tenant_id,
        UserTenant.accepted_at.isnot(None),
    ).first()

    if not membership:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant membership not found",
        )

    db.delete(membership)
    db.commit()

    return {
        "message": "Tenant membership removed",
        "user_id": supabase_uid,
        "tenant_id": tenant_id,
    }


@router.patch("/tenant-users/{supabase_uid}/role", response_model=dict)
async def update_tenant_user_role(
    supabase_uid: str,
    request: UpdateTenantMembershipRequest,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    admin: UserProfile = Depends(require_tenant_role_from_header("admin")),
    db: Session = Depends(get_db),
):
    """Update role for a user in the current tenant (tenant admin or super admin)."""

    membership = db.query(UserTenant).filter(
        UserTenant.supabase_uid == supabase_uid,
        UserTenant.tenant_id == x_tenant_id,
        UserTenant.accepted_at.isnot(None),
    ).first()

    if not membership:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant membership not found",
        )

    target_user = db.query(UserProfile).filter(UserProfile.supabase_uid == supabase_uid).first()
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if target_user.is_super_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin users cannot be edited from tenant admin",
        )

    if request.role not in {"user", "editor", "admin"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Role must be 'user', 'editor', or 'admin'",
        )

    if supabase_uid == admin.supabase_uid and request.role != membership.role:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot change your own role",
        )

    membership.role = request.role
    db.commit()

    return {
        "message": "Tenant role updated",
        "user_id": supabase_uid,
        "tenant_id": x_tenant_id,
        "role": membership.role,
    }


@router.delete("/tenant-users/{supabase_uid}", response_model=dict)
async def remove_tenant_user(
    supabase_uid: str,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    admin: UserProfile = Depends(require_tenant_role_from_header("admin")),
    db: Session = Depends(get_db),
):
    """Remove a user from the current tenant (tenant admin or super admin)."""

    membership = db.query(UserTenant).filter(
        UserTenant.supabase_uid == supabase_uid,
        UserTenant.tenant_id == x_tenant_id,
        UserTenant.accepted_at.isnot(None),
    ).first()

    if not membership:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant membership not found",
        )

    target_user = db.query(UserProfile).filter(UserProfile.supabase_uid == supabase_uid).first()
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if target_user.is_super_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin users cannot be edited from tenant admin",
        )

    if supabase_uid == admin.supabase_uid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot remove yourself from the tenant",
        )

    db.delete(membership)
    db.commit()

    return {
        "message": "Tenant membership removed",
        "user_id": supabase_uid,
        "tenant_id": x_tenant_id,
    }


@router.post("/users/{supabase_uid}/reject", response_model=dict)
async def reject_user(
    supabase_uid: str,
    admin: UserProfile = Depends(require_super_admin),
    db: Session = Depends(get_db)
):
    """Reject a pending user (delete profile).

    When rejecting a user:
    - Delete user_profile record
    - All related user_tenants and invitations are cascade-deleted
    - User can re-register later if needed

    Args:
        supabase_uid: User UUID to reject
        admin: Current user (must be super admin)
        db: Database session

    Returns:
        dict: Success message

    Raises:
        HTTPException 403: User is not a super admin
        HTTPException 404: User not found
    """
    user = db.query(UserProfile).filter(
        UserProfile.supabase_uid == supabase_uid
    ).first()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    db.delete(user)
    db.commit()

    return {"message": "User rejected and deleted"}


@router.post("/users/{supabase_uid}/disable", response_model=dict)
async def disable_user(
    supabase_uid: str,
    admin: UserProfile = Depends(require_super_admin),
    db: Session = Depends(get_db)
):
    """Disable an approved user account.

    When disabling a user:
    - Set is_active=FALSE
    - User cannot log in or access tenants
    - All user data is preserved
    - Account can be re-enabled later

    Args:
        supabase_uid: User UUID to disable
        admin: Current user (must be super admin)
        db: Database session

    Returns:
        dict: Success message

    Raises:
        HTTPException 403: User is not a super admin
        HTTPException 404: User not found
        HTTPException 400: User is already disabled
    """
    user = db.query(UserProfile).filter(
        UserProfile.supabase_uid == supabase_uid
    ).first()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is already disabled"
        )

    user.is_active = False
    db.commit()

    return {"message": "User disabled", "user_id": str(user.supabase_uid)}


@router.post("/users/{supabase_uid}/enable", response_model=dict)
async def enable_user(
    supabase_uid: str,
    admin: UserProfile = Depends(require_super_admin),
    db: Session = Depends(get_db)
):
    """Re-enable a disabled user account.

    When enabling a user:
    - Set is_active=TRUE
    - User can log in and access assigned tenants
    - All user data and tenant assignments are preserved

    Args:
        supabase_uid: User UUID to enable
        admin: Current user (must be super admin)
        db: Database session

    Returns:
        dict: Success message

    Raises:
        HTTPException 403: User is not a super admin
        HTTPException 404: User not found
        HTTPException 400: User is already enabled
    """
    user = db.query(UserProfile).filter(
        UserProfile.supabase_uid == supabase_uid
    ).first()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is already enabled"
        )

    user.is_active = True
    db.commit()

    return {"message": "User enabled", "user_id": str(user.supabase_uid)}


@router.post("/users/{supabase_uid}/set-super-admin", response_model=dict)
async def set_super_admin(
    supabase_uid: str,
    request: dict,
    admin: UserProfile = Depends(require_super_admin),
    db: Session = Depends(get_db)
):
    """Set or unset super admin status for a user.

    Only super admins can modify super admin status.

    Args:
        supabase_uid: User UUID to modify
        request: dict with 'is_super_admin' boolean field
        admin: Current user (must be super admin)
        db: Database session

    Returns:
        dict: Success message and updated user status

    Raises:
        HTTPException 403: User is not a super admin
        HTTPException 404: User not found
    """
    is_super_admin = request.get("is_super_admin", False)

    user = db.query(UserProfile).filter(
        UserProfile.supabase_uid == supabase_uid
    ).first()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.is_super_admin = is_super_admin
    db.commit()

    return {
        "message": f"User {'promoted to' if is_super_admin else 'removed from'} super admin",
        "user_id": str(user.supabase_uid),
        "is_super_admin": user.is_super_admin
    }


# ============================================================================
# Invitation Management Endpoints
# ============================================================================


@router.post("/invitations", response_model=dict, status_code=201)
@limiter.limit("20/minute")
async def create_invitation(
    request: Request,
    body: CreateInvitationRequest,
    user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create invitation to join tenant.

    When creating an invitation:
    1. Verify the user has admin role for the tenant (or is super admin)
    2. Generate a cryptographically secure token
    3. Set 7-day expiration
    4. Create invitations record

    The invited user can then:
    1. Sign up (or log in) via Supabase Auth
    2. Accept the invitation with the token
    3. Be immediately activated and added to the tenant

    Args:
        request: Invitation details (email, tenant_id, role)
        user: Current authenticated user (must be admin of tenant)
        db: Database session

    Returns:
        dict: Invitation details including token

    Raises:
        HTTPException 403: User is not admin of the tenant
        HTTPException 400: Invitation already exists for this email
    """
    normalized_email = (body.email or "").strip().lower()
    if not normalized_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email is required",
        )

    # Verify admin has access to tenant
    if not user.is_super_admin:
        membership = db.query(UserTenant).filter(
            UserTenant.supabase_uid == user.supabase_uid,
            UserTenant.tenant_id == body.tenant_id,
            UserTenant.role == "admin"
        ).first()

        if not membership:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Admin role required for this tenant"
            )

    # If user already exists, assign them immediately and skip invitation flow.
    existing_user = db.query(UserProfile).filter(
        func.lower(UserProfile.email) == normalized_email
    ).first()
    if existing_user:
        now = datetime.utcnow()
        existing_membership = db.query(UserTenant).filter(
            UserTenant.supabase_uid == existing_user.supabase_uid,
            UserTenant.tenant_id == body.tenant_id,
        ).first()

        if existing_membership:
            if existing_membership.accepted_at is None:
                existing_membership.accepted_at = now
                existing_membership.invited_at = existing_membership.invited_at or now
                existing_membership.invited_by = existing_membership.invited_by or user.supabase_uid
            if existing_membership.role != body.role:
                existing_membership.role = body.role
        else:
            db.add(
                UserTenant(
                    supabase_uid=existing_user.supabase_uid,
                    tenant_id=body.tenant_id,
                    role=body.role,
                    invited_by=user.supabase_uid,
                    invited_at=now,
                    accepted_at=now,
                )
            )

        # Remove stale pending invitations for this tenant/email.
        stale_invitations = db.query(Invitation).filter(
            func.lower(Invitation.email) == normalized_email,
            Invitation.tenant_id == body.tenant_id,
            Invitation.accepted_at.is_(None),
        ).all()
        for stale in stale_invitations:
            db.delete(stale)

        db.commit()

        return {
            "message": "Existing user added to tenant",
            "user_id": str(existing_user.supabase_uid),
            "invitation_created": False,
            "role": body.role,
        }

    # Check for existing invitation
    existing = db.query(Invitation).filter(
        func.lower(Invitation.email) == normalized_email,
        Invitation.tenant_id == body.tenant_id,
        Invitation.accepted_at.is_(None),
        Invitation.expires_at > datetime.utcnow()
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invitation already exists for this email"
        )

    # Generate secure token
    token = secrets.token_urlsafe(32)

    # Create invitation
    invitation = Invitation(
        email=normalized_email,
        tenant_id=body.tenant_id,
        role=body.role,
        invited_by=user.supabase_uid,
        token=token,
        expires_at=datetime.utcnow() + timedelta(days=7)
    )
    db.add(invitation)
    db.commit()
    db.refresh(invitation)

    invitation_link = f"{settings.app_url}/accept-invitation?token={token}"

    return {
        "message": "Invitation created",
        "invitation_id": str(invitation.id),
        "invitation_link": invitation_link,
        "expires_at": invitation.expires_at.isoformat(),
        "invitation_created": True,
    }


@router.get("/invitations", response_model=List[InvitationResponse])
async def list_invitations(
    tenant_id: Optional[str] = Query(None),
    user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List invitations (pending and accepted).

    Super admins can see all invitations. Tenant admins can see invitations
    for their tenants only.

    Args:
        tenant_id: Tenant to filter by (required for non-super-admins)
        user: Current authenticated user
        db: Database session

    Returns:
        List[InvitationResponse]: Invitations matching criteria

    Raises:
        HTTPException 400: tenant_id required for non-super-admins
        HTTPException 403: User not admin of the specified tenant
    """
    query = db.query(Invitation)

    if not user.is_super_admin:
        if not tenant_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="tenant_id required for non-super-admins"
            )

        # Verify admin access
        membership = db.query(UserTenant).filter(
            UserTenant.supabase_uid == user.supabase_uid,
            UserTenant.tenant_id == tenant_id,
            UserTenant.role == "admin"
        ).first()

        if not membership:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

        query = query.filter(Invitation.tenant_id == tenant_id)
    elif tenant_id:
        query = query.filter(Invitation.tenant_id == tenant_id)

    invitations = query.order_by(Invitation.created_at.desc()).all()

    return [InvitationResponse.from_orm(inv) for inv in invitations]


@router.delete("/invitations/{invitation_id}", response_model=dict)
async def cancel_invitation(
    invitation_id: str,
    user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Cancel an invitation (delete).

    Only super admins or tenant admins can cancel invitations for their tenants.

    Args:
        invitation_id: Invitation UUID to cancel
        user: Current authenticated user
        db: Database session

    Returns:
        dict: Success message

    Raises:
        HTTPException 403: User not authorized to cancel this invitation
        HTTPException 404: Invitation not found
    """
    invitation = db.query(Invitation).filter(
        Invitation.id == invitation_id
    ).first()

    if not invitation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")

    # Verify admin access
    if not user.is_super_admin:
        membership = db.query(UserTenant).filter(
            UserTenant.supabase_uid == user.supabase_uid,
            UserTenant.tenant_id == invitation.tenant_id,
            UserTenant.role == "admin"
        ).first()

        if not membership:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    db.delete(invitation)
    db.commit()

    return {"message": "Invitation cancelled"}
