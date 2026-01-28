"""Admin endpoints for user and invitation management."""

from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
import secrets

from photocat.database import get_db
from photocat.auth.dependencies import get_current_user, require_super_admin, require_tenant_role
from photocat.auth.models import UserProfile, UserTenant, Invitation
from photocat.auth.schemas import (
    UserProfileResponse,
    CreateInvitationRequest,
    ApproveUserRequest,
    InvitationResponse,
)
from photocat.metadata import Tenant as TenantModel


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


@router.post("/users/{supabase_uid}/approve", response_model=dict)
async def approve_user(
    supabase_uid: str,
    request: ApproveUserRequest,
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
    if request.tenant_id:
        # Verify tenant exists
        tenant = db.query(TenantModel).filter(
            TenantModel.id == request.tenant_id
        ).first()
        if not tenant:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")

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

    return {"message": "User approved", "user_id": str(user.supabase_uid)}


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


# ============================================================================
# Invitation Management Endpoints
# ============================================================================


@router.post("/invitations", response_model=dict, status_code=201)
async def create_invitation(
    request: CreateInvitationRequest,
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
    # Verify admin has access to tenant
    if not user.is_super_admin:
        membership = db.query(UserTenant).filter(
            UserTenant.supabase_uid == user.supabase_uid,
            UserTenant.tenant_id == request.tenant_id,
            UserTenant.role == "admin"
        ).first()

        if not membership:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Admin role required for this tenant"
            )

    # Check for existing invitation
    existing = db.query(Invitation).filter(
        Invitation.email == request.email,
        Invitation.tenant_id == request.tenant_id,
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
        email=request.email,
        tenant_id=request.tenant_id,
        role=request.role,
        invited_by=user.supabase_uid,
        token=token,
        expires_at=datetime.utcnow() + timedelta(days=7)
    )
    db.add(invitation)
    db.commit()
    db.refresh(invitation)

    # TODO: Send invitation email with link
    # invitation_link = f"https://photocat.app/accept-invitation?token={token}"
    # send_invitation_email(request.email, invitation_link)

    return {
        "message": "Invitation created",
        "invitation_id": str(invitation.id),
        "token": token,  # Return for now, would not be returned in production
        "expires_at": invitation.expires_at.isoformat()
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
