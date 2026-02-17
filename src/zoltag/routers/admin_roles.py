"""Tenant-scoped RBAC role and permission management endpoints."""

from __future__ import annotations

import re
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from zoltag.auth.dependencies import (
    invalidate_tenant_permission_cache,
    require_tenant_permission_from_header,
)
from zoltag.auth.models import (
    PermissionCatalog,
    TenantRole,
    TenantRolePermission,
    UserProfile,
    UserTenant,
)
from zoltag.database import get_db
from zoltag.metadata import Tenant as TenantModel
from zoltag.tenant_scope import tenant_reference_filter

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

ROLE_KEY_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{1,49}$")


def _resolve_tenant_id(db: Session, tenant_ref: str):
    row = db.query(TenantModel.id).filter(
        tenant_reference_filter(TenantModel, tenant_ref)
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return row[0]


def _parse_uuid_or_400(raw_value: str) -> UUID:
    try:
        return UUID(str(raw_value))
    except (TypeError, ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="Invalid UUID format")


def _normalize_permission_keys(value) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise HTTPException(status_code=400, detail="permission_keys must be an array")
    keys: list[str] = []
    seen: set[str] = set()
    for item in value:
        key = str(item or "").strip()
        if not key or key in seen:
            continue
        keys.append(key)
        seen.add(key)
    return keys


def _validate_permission_keys(db: Session, permission_keys: list[str]) -> list[str]:
    if not permission_keys:
        return []
    rows = db.query(PermissionCatalog.key).filter(
        PermissionCatalog.key.in_(permission_keys),
        PermissionCatalog.is_active.is_(True),
    ).all()
    existing = {str(row[0]) for row in rows}
    missing = sorted(set(permission_keys) - existing)
    if missing:
        raise HTTPException(status_code=400, detail=f"Unknown permission_keys: {', '.join(missing)}")
    return permission_keys


def _replace_role_permissions(db: Session, role_id: UUID, permission_keys: list[str]) -> None:
    db.query(TenantRolePermission).filter(
        TenantRolePermission.role_id == role_id
    ).delete(synchronize_session=False)
    for key in permission_keys:
        db.add(TenantRolePermission(
            role_id=role_id,
            permission_key=key,
            effect="allow",
        ))


def _serialize_permission(permission: PermissionCatalog) -> dict:
    return {
        "key": str(permission.key or ""),
        "description": str(permission.description or ""),
        "category": str(permission.category or ""),
        "is_active": bool(permission.is_active),
        "created_at": permission.created_at,
        "updated_at": permission.updated_at,
    }


def _serialize_role(role: TenantRole, *, member_count: int = 0) -> dict:
    permission_keys = sorted({
        str(mapping.permission_key or "")
        for mapping in (role.role_permissions or [])
        if str(mapping.effect or "allow").lower() == "allow"
    })
    return {
        "id": str(role.id),
        "tenant_id": str(role.tenant_id),
        "role_key": str(role.role_key or ""),
        "label": str(role.label or ""),
        "description": str(role.description or ""),
        "is_system": bool(role.is_system),
        "is_active": bool(role.is_active),
        "member_count": int(member_count or 0),
        "permission_keys": permission_keys,
        "created_at": role.created_at,
        "updated_at": role.updated_at,
    }


@router.get("/permissions/catalog")
async def list_permission_catalog(
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("tenant.users.manage")),
    db: Session = Depends(get_db),
):
    """List active permission catalog entries for tenant RBAC configuration."""
    tenant_id = _resolve_tenant_id(db, x_tenant_id)
    rows = db.query(PermissionCatalog).filter(
        PermissionCatalog.is_active.is_(True),
    ).order_by(
        PermissionCatalog.category.asc(),
        PermissionCatalog.key.asc(),
    ).all()
    return {
        "tenant_id": str(tenant_id),
        "permissions": [_serialize_permission(row) for row in rows],
    }


@router.get("/roles")
async def list_tenant_roles(
    include_inactive: bool = Query(default=False),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("tenant.users.view")),
    db: Session = Depends(get_db),
):
    """List tenant roles and permission mappings."""
    tenant_id = _resolve_tenant_id(db, x_tenant_id)
    query = db.query(TenantRole).options(joinedload(TenantRole.role_permissions)).filter(
        TenantRole.tenant_id == tenant_id,
    )
    if not include_inactive:
        query = query.filter(TenantRole.is_active.is_(True))
    roles = query.order_by(
        TenantRole.is_system.desc(),
        TenantRole.role_key.asc(),
    ).all()

    member_counts = {
        row[0]: int(row[1] or 0)
        for row in db.query(
            UserTenant.tenant_role_id,
            func.count(UserTenant.id),
        ).filter(
            UserTenant.tenant_id == tenant_id,
            UserTenant.accepted_at.is_not(None),
            UserTenant.tenant_role_id.is_not(None),
        ).group_by(UserTenant.tenant_role_id).all()
    }

    return {
        "tenant_id": str(tenant_id),
        "roles": [
            _serialize_role(role, member_count=member_counts.get(role.id, 0))
            for role in roles
        ],
    }


@router.post("/roles")
async def create_tenant_role(
    body: dict = Body(default_factory=dict),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("tenant.users.manage")),
    db: Session = Depends(get_db),
):
    """Create a custom tenant role."""
    tenant_id = _resolve_tenant_id(db, x_tenant_id)
    role_key = str((body or {}).get("role_key") or "").strip().lower()
    if not role_key:
        raise HTTPException(status_code=400, detail="role_key is required")
    if not ROLE_KEY_PATTERN.match(role_key):
        raise HTTPException(
            status_code=400,
            detail="role_key must match ^[a-z0-9][a-z0-9._-]{1,49}$",
        )

    label = str((body or {}).get("label") or "").strip()
    if not label:
        raise HTTPException(status_code=400, detail="label is required")

    description = str((body or {}).get("description") or "").strip() or None
    is_active = bool((body or {}).get("is_active", True))
    permission_keys = _validate_permission_keys(
        db,
        _normalize_permission_keys((body or {}).get("permission_keys")),
    )

    role = TenantRole(
        tenant_id=tenant_id,
        role_key=role_key,
        label=label,
        description=description,
        is_system=False,
        is_active=is_active,
    )
    db.add(role)
    try:
        db.flush()
        _replace_role_permissions(db, role.id, permission_keys)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Role key already exists for tenant")

    invalidate_tenant_permission_cache(tenant_id=str(tenant_id))
    refreshed = db.query(TenantRole).options(joinedload(TenantRole.role_permissions)).filter(
        TenantRole.id == role.id
    ).first()
    return _serialize_role(refreshed or role, member_count=0)


@router.patch("/roles/{role_id}")
async def update_tenant_role(
    role_id: str,
    body: dict = Body(default_factory=dict),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("tenant.users.manage")),
    db: Session = Depends(get_db),
):
    """Update role metadata and activation state for a tenant role."""
    tenant_id = _resolve_tenant_id(db, x_tenant_id)
    parsed_role_id = _parse_uuid_or_400(role_id)
    role = db.query(TenantRole).options(joinedload(TenantRole.role_permissions)).filter(
        TenantRole.id == parsed_role_id,
        TenantRole.tenant_id == tenant_id,
    ).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    if "role_key" in (body or {}):
        next_role_key = str((body or {}).get("role_key") or "").strip().lower()
        if not next_role_key:
            raise HTTPException(status_code=400, detail="role_key cannot be empty")
        if not ROLE_KEY_PATTERN.match(next_role_key):
            raise HTTPException(
                status_code=400,
                detail="role_key must match ^[a-z0-9][a-z0-9._-]{1,49}$",
            )
        if role.is_system and next_role_key != str(role.role_key):
            raise HTTPException(status_code=400, detail="System role_key cannot be changed")
        role.role_key = next_role_key

    if "label" in (body or {}):
        next_label = str((body or {}).get("label") or "").strip()
        if not next_label:
            raise HTTPException(status_code=400, detail="label cannot be empty")
        role.label = next_label

    if "description" in (body or {}):
        role.description = str((body or {}).get("description") or "").strip() or None

    if "is_active" in (body or {}):
        role.is_active = bool((body or {}).get("is_active"))

    if "permission_keys" in (body or {}):
        permission_keys = _validate_permission_keys(
            db,
            _normalize_permission_keys((body or {}).get("permission_keys")),
        )
        _replace_role_permissions(db, role.id, permission_keys)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Role key already exists for tenant")

    invalidate_tenant_permission_cache(tenant_id=str(tenant_id))
    refreshed = db.query(TenantRole).options(joinedload(TenantRole.role_permissions)).filter(
        TenantRole.id == parsed_role_id
    ).first()
    member_count = int(
        db.query(func.count(UserTenant.id)).filter(
            UserTenant.tenant_role_id == parsed_role_id,
            UserTenant.accepted_at.is_not(None),
        ).scalar()
        or 0
    )
    return _serialize_role(refreshed or role, member_count=member_count)


@router.put("/roles/{role_id}/permissions")
async def replace_tenant_role_permissions(
    role_id: str,
    body: dict = Body(default_factory=dict),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("tenant.users.manage")),
    db: Session = Depends(get_db),
):
    """Replace a role's permission set."""
    tenant_id = _resolve_tenant_id(db, x_tenant_id)
    parsed_role_id = _parse_uuid_or_400(role_id)
    role = db.query(TenantRole).options(joinedload(TenantRole.role_permissions)).filter(
        TenantRole.id == parsed_role_id,
        TenantRole.tenant_id == tenant_id,
    ).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    permission_keys = _validate_permission_keys(
        db,
        _normalize_permission_keys((body or {}).get("permission_keys")),
    )
    _replace_role_permissions(db, role.id, permission_keys)
    db.commit()

    invalidate_tenant_permission_cache(tenant_id=str(tenant_id))
    refreshed = db.query(TenantRole).options(joinedload(TenantRole.role_permissions)).filter(
        TenantRole.id == parsed_role_id
    ).first()
    member_count = int(
        db.query(func.count(UserTenant.id)).filter(
            UserTenant.tenant_role_id == parsed_role_id,
            UserTenant.accepted_at.is_not(None),
        ).scalar()
        or 0
    )
    return _serialize_role(refreshed or role, member_count=member_count)


@router.delete("/roles/{role_id}")
async def delete_tenant_role(
    role_id: str,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("tenant.users.manage")),
    db: Session = Depends(get_db),
):
    """Delete a custom role that has no active user assignments."""
    tenant_id = _resolve_tenant_id(db, x_tenant_id)
    parsed_role_id = _parse_uuid_or_400(role_id)
    role = db.query(TenantRole).filter(
        TenantRole.id == parsed_role_id,
        TenantRole.tenant_id == tenant_id,
    ).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    if role.is_system:
        raise HTTPException(status_code=400, detail="System roles cannot be deleted")

    membership_exists = db.query(UserTenant.id).filter(
        UserTenant.tenant_role_id == parsed_role_id,
        UserTenant.accepted_at.is_not(None),
    ).limit(1).first()
    if membership_exists:
        raise HTTPException(
            status_code=409,
            detail="Cannot delete role while assigned to users",
        )

    db.delete(role)
    db.commit()
    invalidate_tenant_permission_cache(tenant_id=str(tenant_id))
    return {
        "deleted": True,
        "role_id": str(parsed_role_id),
    }
