"""Admin endpoints for user and invitation management."""

from datetime import datetime, timedelta
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Request, status, Query, Header
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
import secrets

from zoltag.ratelimit import limiter

from zoltag.database import get_db
from zoltag.activity import EVENT_AUTH_LOGIN
from zoltag.auth.dependencies import (
    get_effective_membership_permissions,
    get_tenant_role_id_by_key,
    get_current_user,
    invalidate_tenant_permission_cache,
    require_tenant_permission_from_header,
    require_super_admin,
)
from zoltag.auth.models import UserProfile, UserTenant, Invitation, TenantRole
from zoltag.auth.schemas import (
    UserProfileResponse,
    CreateInvitationRequest,
    ApproveUserRequest,
    UpdateTenantMembershipRequest,
    InvitationResponse,
)
from zoltag.metadata import ActivityEvent, Tenant as TenantModel
from zoltag.settings import settings
from zoltag.tenant_scope import tenant_column_filter_for_values, tenant_reference_filter


router = APIRouter(prefix="/api/v1/admin", tags=["admin"])
_LEGACY_ROLE_KEYS = {"user", "editor", "admin"}


def _resolve_tenant(db: Session, tenant_ref: str) -> Optional[TenantModel]:
    return db.query(TenantModel).filter(tenant_reference_filter(TenantModel, tenant_ref)).first()


def _tenant_filter(db: Session, model, tenant_ref: str):
    tenant = _resolve_tenant(db, tenant_ref)
    tenant_id = tenant.id if tenant else tenant_ref
    return tenant_column_filter_for_values(model, tenant_id)


def _legacy_role_for_key(role_key: Optional[str]) -> str:
    normalized = str(role_key or "").strip().lower()
    return normalized if normalized in _LEGACY_ROLE_KEYS else "user"


def _resolve_membership_role_fields(
    membership: UserTenant,
) -> tuple[str, str, Optional[str], str]:
    role_ref = getattr(membership, "tenant_role", None)
    role_key = str(getattr(role_ref, "role_key", "") or "").strip().lower()
    if not role_key:
        role_key = _legacy_role_for_key(getattr(membership, "role", None))
    role_label = str(getattr(role_ref, "label", "") or "").strip() or role_key.title()
    tenant_role_id = str(getattr(role_ref, "id", "") or "").strip() or (
        str(membership.tenant_role_id) if membership.tenant_role_id else None
    )
    legacy_role = _legacy_role_for_key(role_key)
    return role_key, role_label, tenant_role_id, legacy_role


def _require_tenant_role_id_by_key(
    db: Session,
    *,
    tenant_id: UUID,
    role_key: str,
) -> UUID:
    resolved_role_id = get_tenant_role_id_by_key(
        db,
        tenant_id=tenant_id,
        role_key=role_key,
    )
    if not resolved_role_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Role '{role_key}' is not active for this tenant",
        )
    return resolved_role_id


def _membership_or_403(
    db: Session,
    *,
    user_id,
    tenant_ref: str,
) -> UserTenant:
    membership = db.query(UserTenant).options(joinedload(UserTenant.tenant_role)).filter(
        UserTenant.supabase_uid == user_id,
        _tenant_filter(db, UserTenant, tenant_ref),
        UserTenant.accepted_at.isnot(None),
    ).first()
    if not membership:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return membership


def _require_membership_permission(
    db: Session,
    *,
    user: UserProfile,
    tenant_ref: str,
    permission_key: str,
) -> Optional[UserTenant]:
    if user.is_super_admin:
        return None

    membership = _membership_or_403(
        db,
        user_id=user.supabase_uid,
        tenant_ref=tenant_ref,
    )
    effective_permissions = get_effective_membership_permissions(db, membership)
    if permission_key not in effective_permissions:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return membership


def _require_any_membership_permission(
    db: Session,
    *,
    user: UserProfile,
    tenant_ref: str,
    permission_keys: tuple[str, ...],
) -> Optional[UserTenant]:
    if user.is_super_admin:
        return None

    normalized_keys = tuple(
        str(permission_key or "").strip()
        for permission_key in permission_keys
        if str(permission_key or "").strip()
    )
    if not normalized_keys:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    membership = _membership_or_403(
        db,
        user_id=user.supabase_uid,
        tenant_ref=tenant_ref,
    )
    effective_permissions = get_effective_membership_permissions(db, membership)
    if not any(permission_key in effective_permissions for permission_key in normalized_keys):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return membership


def _resolve_tenant_role(
    db: Session,
    *,
    tenant_ref: str,
    role_key: Optional[str] = None,
    role_id: Optional[str] = None,
) -> TenantRole:
    tenant = _resolve_tenant(db, tenant_ref)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")

    selected_role_id = str(role_id or "").strip()
    selected_role_key = str(role_key or "").strip().lower()

    query = db.query(TenantRole).filter(
        TenantRole.tenant_id == tenant.id,
    )
    if selected_role_id:
        try:
            parsed_role_id = UUID(selected_role_id)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role_id format")
        target = query.filter(TenantRole.id == parsed_role_id).first()
    elif selected_role_key:
        target = query.filter(TenantRole.role_key == selected_role_key).first()
    else:
        target = None

    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant role not found")
    if not target.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Role is not active")
    return target


def _parse_activity_user_id(user_id: Optional[str]) -> Optional[UUID]:
    raw = str(user_id or "").strip()
    if not raw:
        return None
    try:
        return UUID(raw)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user_id format")


def _apply_activity_filters(
    query,
    *,
    since_hours: Optional[int],
    event_type: Optional[str],
    actor_user_id: Optional[UUID],
):
    if since_hours:
        cutoff = datetime.utcnow() - timedelta(hours=int(since_hours))
        query = query.filter(ActivityEvent.created_at >= cutoff)

    normalized_event_type = str(event_type or "").strip().lower()
    if normalized_event_type:
        query = query.filter(ActivityEvent.event_type == normalized_event_type)

    if actor_user_id is not None:
        query = query.filter(ActivityEvent.actor_supabase_uid == actor_user_id)

    return query


def _build_activity_summary(query) -> dict:
    total = int(query.order_by(None).count() or 0)
    unique_actor_count = int(
        query.with_entities(func.count(func.distinct(ActivityEvent.actor_supabase_uid))).scalar() or 0
    )

    type_rows = query.with_entities(
        ActivityEvent.event_type,
        func.count(ActivityEvent.id),
    ).group_by(
        ActivityEvent.event_type
    ).all()
    event_type_counts = {
        str(event_type): int(count or 0)
        for event_type, count in type_rows
        if event_type
    }

    daily_rows = query.with_entities(
        func.date(ActivityEvent.created_at),
        func.count(ActivityEvent.id),
    ).group_by(
        func.date(ActivityEvent.created_at)
    ).order_by(
        func.date(ActivityEvent.created_at)
    ).all()
    daily_counts = [
        {
            "date": str(day),
            "count": int(count or 0),
        }
        for day, count in daily_rows
        if day is not None
    ]

    return {
        "total_events": total,
        "unique_actors": unique_actor_count,
        "event_type_counts": event_type_counts,
        "daily_counts": daily_counts,
    }


def _serialize_activity_rows(db: Session, rows: list[ActivityEvent]) -> list[dict]:
    actor_ids = sorted({
        row.actor_supabase_uid
        for row in rows
        if row.actor_supabase_uid is not None
    })
    actor_by_uid: dict[UUID, dict] = {}
    if actor_ids:
        actor_rows = db.query(
            UserProfile.supabase_uid,
            UserProfile.email,
            UserProfile.display_name,
        ).filter(
            UserProfile.supabase_uid.in_(actor_ids)
        ).all()
        actor_by_uid = {
            actor_uid: {
                "email": str(email or "").strip() or None,
                "display_name": str(display_name or "").strip() or None,
            }
            for actor_uid, email, display_name in actor_rows
        }

    return [
        {
            "id": str(row.id),
            "tenant_id": str(row.tenant_id) if row.tenant_id else None,
            "actor_supabase_uid": str(row.actor_supabase_uid) if row.actor_supabase_uid else None,
            "actor_email": actor_by_uid.get(row.actor_supabase_uid, {}).get("email"),
            "actor_display_name": actor_by_uid.get(row.actor_supabase_uid, {}).get("display_name"),
            "event_type": row.event_type,
            "request_path": row.request_path,
            "client_ip": row.client_ip,
            "user_agent": row.user_agent,
            "details": row.details if isinstance(row.details, dict) else {},
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]


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
        memberships = db.query(UserTenant).options(joinedload(UserTenant.tenant_role)).filter(
            UserTenant.supabase_uid == user.supabase_uid,
            UserTenant.accepted_at.isnot(None)
        ).all()

        tenants = []
        for membership in memberships:
            tenant = db.query(TenantModel).filter(
                TenantModel.id == membership.tenant_id
            ).first()
            if tenant:
                role_key, role_label, tenant_role_id, legacy_role = _resolve_membership_role_fields(membership)
                tenants.append({
                    "tenant_id": tenant.id,
                    "tenant_name": tenant.name,
                    "role": legacy_role,
                    "role_key": role_key,
                    "role_label": role_label,
                    "tenant_role_id": tenant_role_id,
                    "accepted_at": membership.accepted_at.isoformat() if membership.accepted_at else None,
                })

        user_data["tenants"] = tenants
        result.append(user_data)

    return result


@router.get("/tenant-users", response_model=List[dict])
async def list_tenant_users(
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("tenant.users.view")),
    db: Session = Depends(get_db),
):
    """List users assigned to the tenant in X-Tenant-ID (tenant admin or super admin)."""

    memberships = db.query(UserTenant).options(joinedload(UserTenant.tenant_role)).filter(
        _tenant_filter(db, UserTenant, x_tenant_id),
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
        role_key, role_label, tenant_role_id, legacy_role = _resolve_membership_role_fields(membership)
        profile["role"] = legacy_role
        profile["role_key"] = role_key
        profile["role_label"] = role_label
        profile["tenant_role_id"] = tenant_role_id
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
        tenant = _resolve_tenant(db, body.tenant_id)
        if not tenant:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")

        # Create membership
        membership = UserTenant(
            supabase_uid=user.supabase_uid,
            tenant_id=tenant.id,
            tenant_role_id=_require_tenant_role_id_by_key(
                db,
                tenant_id=tenant.id,
                role_key=body.role,
            ),
            role=_legacy_role_for_key(body.role),
            invited_by=admin.supabase_uid,
            invited_at=datetime.utcnow(),
            accepted_at=datetime.utcnow()
        )
        db.add(membership)

    db.commit()
    if body.tenant_id and tenant:
        invalidate_tenant_permission_cache(
            supabase_uid=str(user.supabase_uid),
            tenant_id=str(tenant.id),
        )

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
    tenant = _resolve_tenant(db, request.tenant_id)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")

    # Check if already assigned
    existing = db.query(UserTenant).filter(
        UserTenant.supabase_uid == user.supabase_uid,
        _tenant_filter(db, UserTenant, request.tenant_id),
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is already assigned to this tenant"
        )

    # Create membership
    membership = UserTenant(
        supabase_uid=user.supabase_uid,
        tenant_id=tenant.id,
        tenant_role_id=_require_tenant_role_id_by_key(
            db,
            tenant_id=tenant.id,
            role_key=request.role,
        ),
        role=_legacy_role_for_key(request.role),
        invited_by=admin.supabase_uid,
        invited_at=datetime.utcnow(),
        accepted_at=datetime.utcnow()
    )
    db.add(membership)
    db.commit()
    invalidate_tenant_permission_cache(
        supabase_uid=str(user.supabase_uid),
        tenant_id=str(tenant.id),
    )

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
    role_id = str(request.role_id or "").strip()
    role_key = str(request.role_key or request.role or "").strip().lower()
    if not role_id and not role_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="One of role_key, role_id, or role is required for this endpoint",
        )

    membership = db.query(UserTenant).filter(
        UserTenant.supabase_uid == supabase_uid,
        _tenant_filter(db, UserTenant, tenant_id),
        UserTenant.accepted_at.isnot(None),
    ).first()

    if not membership:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant membership not found",
        )

    target_role = _resolve_tenant_role(
        db,
        tenant_ref=tenant_id,
        role_key=role_key,
        role_id=role_id,
    )
    next_role_key = str(target_role.role_key or "").strip().lower()
    membership.role = _legacy_role_for_key(next_role_key)
    membership.tenant_role_id = target_role.id
    db.commit()
    invalidate_tenant_permission_cache(
        supabase_uid=str(supabase_uid),
        tenant_id=str(membership.tenant_id),
    )

    return {
        "message": "Tenant role updated",
        "user_id": supabase_uid,
        "tenant_id": membership.tenant_id,
        "role": membership.role,
        "role_key": next_role_key,
        "role_label": str(target_role.label or "").strip() or next_role_key.title(),
        "tenant_role_id": str(target_role.id),
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
        _tenant_filter(db, UserTenant, tenant_id),
        UserTenant.accepted_at.isnot(None),
    ).first()

    if not membership:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant membership not found",
        )

    db.delete(membership)
    db.commit()
    invalidate_tenant_permission_cache(
        supabase_uid=str(supabase_uid),
        tenant_id=str(membership.tenant_id),
    )

    return {
        "message": "Tenant membership removed",
        "user_id": supabase_uid,
        "tenant_id": membership.tenant_id,
    }


@router.patch("/tenant-users/{supabase_uid}/role", response_model=dict)
async def update_tenant_user_role(
    supabase_uid: str,
    request: UpdateTenantMembershipRequest,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    admin: UserProfile = Depends(require_tenant_permission_from_header("tenant.users.manage")),
    db: Session = Depends(get_db),
):
    """Update role for a user in the current tenant (tenant admin or super admin)."""

    membership = db.query(UserTenant).options(joinedload(UserTenant.tenant_role)).filter(
        UserTenant.supabase_uid == supabase_uid,
        _tenant_filter(db, UserTenant, x_tenant_id),
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

    role_id = str(request.role_id or "").strip()
    role_key = str(request.role_key or "").strip().lower()
    if not role_id and not role_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="One of role_key or role_id is required",
        )

    target_role = _resolve_tenant_role(
        db,
        tenant_ref=x_tenant_id,
        role_key=role_key,
        role_id=role_id,
    )
    next_role_key = str(target_role.role_key or "").strip().lower()
    next_legacy_role = _legacy_role_for_key(next_role_key)
    current_role_key, _, _, _ = _resolve_membership_role_fields(membership)

    if supabase_uid == admin.supabase_uid and next_role_key != current_role_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot change your own role",
        )

    membership.tenant_role_id = target_role.id
    membership.role = next_legacy_role
    db.commit()
    invalidate_tenant_permission_cache(
        supabase_uid=str(supabase_uid),
        tenant_id=str(membership.tenant_id),
    )

    return {
        "message": "Tenant role updated",
        "user_id": supabase_uid,
        "tenant_id": membership.tenant_id,
        "role": membership.role,
        "role_key": next_role_key,
        "role_label": str(target_role.label or "").strip() or next_role_key.title(),
        "tenant_role_id": str(target_role.id),
    }


@router.delete("/tenant-users/{supabase_uid}", response_model=dict)
async def remove_tenant_user(
    supabase_uid: str,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    admin: UserProfile = Depends(require_tenant_permission_from_header("tenant.users.manage")),
    db: Session = Depends(get_db),
):
    """Remove a user from the current tenant (tenant admin or super admin)."""

    membership = db.query(UserTenant).filter(
        UserTenant.supabase_uid == supabase_uid,
        _tenant_filter(db, UserTenant, x_tenant_id),
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
    invalidate_tenant_permission_cache(
        supabase_uid=str(supabase_uid),
        tenant_id=str(membership.tenant_id),
    )

    return {
        "message": "Tenant membership removed",
        "user_id": supabase_uid,
        "tenant_id": membership.tenant_id,
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

    tenant = _resolve_tenant(db, body.tenant_id)
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found",
        )

    _require_membership_permission(
        db,
        user=user,
        tenant_ref=body.tenant_id,
        permission_key="tenant.users.manage",
    )

    # If user already exists, assign them immediately and skip invitation flow.
    existing_user = db.query(UserProfile).filter(
        func.lower(UserProfile.email) == normalized_email
    ).first()
    if existing_user:
        now = datetime.utcnow()
        existing_membership = db.query(UserTenant).filter(
            UserTenant.supabase_uid == existing_user.supabase_uid,
            _tenant_filter(db, UserTenant, body.tenant_id),
        ).first()

        if existing_membership:
            if existing_membership.accepted_at is None:
                existing_membership.accepted_at = now
                existing_membership.invited_at = existing_membership.invited_at or now
                existing_membership.invited_by = existing_membership.invited_by or user.supabase_uid
            existing_membership.role = _legacy_role_for_key(body.role)
            existing_membership.tenant_role_id = _require_tenant_role_id_by_key(
                db,
                tenant_id=tenant.id,
                role_key=body.role,
            )
        else:
            db.add(
                UserTenant(
                    supabase_uid=existing_user.supabase_uid,
                    tenant_id=tenant.id,
                    tenant_role_id=_require_tenant_role_id_by_key(
                        db,
                        tenant_id=tenant.id,
                        role_key=body.role,
                    ),
                    role=_legacy_role_for_key(body.role),
                    invited_by=user.supabase_uid,
                    invited_at=now,
                    accepted_at=now,
                )
            )

        # Remove stale pending invitations for this tenant/email.
        stale_invitations = db.query(Invitation).filter(
            func.lower(Invitation.email) == normalized_email,
            _tenant_filter(db, Invitation, body.tenant_id),
            Invitation.accepted_at.is_(None),
        ).all()
        for stale in stale_invitations:
            db.delete(stale)

        db.commit()
        invalidate_tenant_permission_cache(
            supabase_uid=str(existing_user.supabase_uid),
            tenant_id=str(tenant.id),
        )

        return {
            "message": "Existing user added to tenant",
            "user_id": str(existing_user.supabase_uid),
            "invitation_created": False,
            "role": body.role,
        }

    # Check for existing invitation
    existing = db.query(Invitation).filter(
        func.lower(Invitation.email) == normalized_email,
        _tenant_filter(db, Invitation, body.tenant_id),
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
        tenant_id=tenant.id,
        role=body.role,
        invited_by=user.supabase_uid,
        token=token,
        expires_at=datetime.utcnow() + timedelta(days=7)
    )
    db.add(invitation)
    db.commit()
    db.refresh(invitation)

    invitation_link = f"{settings.app_url}/signup?invitation_token={token}"

    return {
        "message": "Invitation created",
        "invitation_id": str(invitation.id),
        "token": token,
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
        _require_membership_permission(
            db,
            user=user,
            tenant_ref=tenant_id,
            permission_key="tenant.users.view",
        )

        query = query.filter(_tenant_filter(db, Invitation, tenant_id))
    elif tenant_id:
        query = query.filter(_tenant_filter(db, Invitation, tenant_id))

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

    if not user.is_super_admin:
        _require_membership_permission(
            db,
            user=user,
            tenant_ref=str(invitation.tenant_id),
            permission_key="tenant.users.manage",
        )

    db.delete(invitation)
    db.commit()

    return {"message": "Invitation cancelled"}


@router.get("/activity", response_model=dict)
async def list_activity_events(
    tenant_id: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    since_hours: Optional[int] = Query(168, ge=1, le=4320),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _admin: UserProfile = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """List recent activity events (super admin only)."""
    query = db.query(ActivityEvent)

    if tenant_id:
        try:
            tenant_uuid = UUID(str(tenant_id))
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tenant_id format")
        query = query.filter(ActivityEvent.tenant_id == tenant_uuid)

    actor_user_id = _parse_activity_user_id(user_id)
    query = _apply_activity_filters(
        query,
        since_hours=since_hours,
        event_type=event_type,
        actor_user_id=actor_user_id,
    )
    summary = _build_activity_summary(query)
    rows = query.order_by(
        ActivityEvent.created_at.desc(),
        ActivityEvent.id.desc(),
    ).limit(limit).offset(offset).all()
    events = _serialize_activity_rows(db, rows)

    return {
        "events": events,
        "total": summary["total_events"],
        "summary": summary,
        "scope": "global",
        "tenant_id": str(tenant_id) if tenant_id else None,
        "since_hours": since_hours,
        "limit": limit,
        "offset": offset,
    }


@router.get("/tenant-activity", response_model=dict)
async def list_tenant_activity_events(
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    event_type: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    since_hours: Optional[int] = Query(168, ge=1, le=4320),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    viewer: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List tenant activity events (tenant admin/viewer scope)."""
    tenant = _resolve_tenant(db, x_tenant_id)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    _require_any_membership_permission(
        db,
        user=viewer,
        tenant_ref=str(tenant.id),
        permission_keys=("tenant.audit.view", "tenant.users.view"),
    )

    actor_user_id = _parse_activity_user_id(user_id)
    tenant_member_uids_subquery = db.query(UserTenant.supabase_uid).filter(
        UserTenant.tenant_id == tenant.id,
        UserTenant.accepted_at.isnot(None),
    ).subquery()
    query = db.query(ActivityEvent).filter(
        or_(
            ActivityEvent.tenant_id == tenant.id,
            and_(
                ActivityEvent.event_type == EVENT_AUTH_LOGIN,
                ActivityEvent.actor_supabase_uid.in_(tenant_member_uids_subquery),
            ),
        )
    )
    query = _apply_activity_filters(
        query,
        since_hours=since_hours,
        event_type=event_type,
        actor_user_id=actor_user_id,
    )
    summary = _build_activity_summary(query)
    rows = query.order_by(
        ActivityEvent.created_at.desc(),
        ActivityEvent.id.desc(),
    ).limit(limit).offset(offset).all()
    events = _serialize_activity_rows(db, rows)

    return {
        "events": events,
        "total": summary["total_events"],
        "summary": summary,
        "scope": "tenant",
        "tenant_id": str(tenant.id),
        "tenant_identifier": str(getattr(tenant, "identifier", "") or "").strip() or None,
        "since_hours": since_hours,
        "limit": limit,
        "offset": offset,
    }
