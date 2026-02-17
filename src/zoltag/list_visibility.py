"""List visibility and access helpers."""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from zoltag.auth.dependencies import get_effective_membership_permissions
from zoltag.auth.models import UserProfile, UserTenant
from zoltag.models.config import PhotoList
from zoltag.tenant import Tenant
from zoltag.tenant_scope import tenant_column_filter_for_values

LIST_VISIBILITY_SHARED = "shared"
LIST_VISIBILITY_PRIVATE = "private"
VALID_LIST_VISIBILITIES = {LIST_VISIBILITY_SHARED, LIST_VISIBILITY_PRIVATE}
VALID_LIST_SCOPES = {"default", "private", "all"}


def normalize_list_visibility(raw_value: str | None, *, default: str = LIST_VISIBILITY_SHARED) -> str:
    value = str(raw_value or "").strip().lower()
    if not value:
        return default
    if value not in VALID_LIST_VISIBILITIES:
        raise HTTPException(status_code=400, detail="visibility must be one of: shared, private")
    return value


def normalize_list_scope(raw_value: str | None, *, default: str = "default") -> str:
    value = str(raw_value or "").strip().lower()
    if not value:
        return default
    if value not in VALID_LIST_SCOPES:
        raise HTTPException(status_code=400, detail="visibility_scope must be one of: default, private, all")
    return value


def get_tenant_role_for_user(db: Session, tenant: Tenant, user: UserProfile) -> str | None:
    if not user:
        return None
    if bool(getattr(user, "is_super_admin", False)):
        return "admin"
    membership = (
        db.query(UserTenant.role)
        .filter(
            UserTenant.supabase_uid == user.supabase_uid,
            tenant_column_filter_for_values(UserTenant, tenant.id, tenant.id),
            UserTenant.accepted_at.isnot(None),
        )
        .first()
    )
    if not membership:
        return None
    return str(membership[0] or "").strip().lower() or None


def is_tenant_admin_user(db: Session, tenant: Tenant, user: UserProfile) -> bool:
    if not user:
        return False
    if bool(getattr(user, "is_super_admin", False)):
        return True
    membership = (
        db.query(UserTenant)
        .filter(
            UserTenant.supabase_uid == user.supabase_uid,
            tenant_column_filter_for_values(UserTenant, tenant.id, tenant.id),
            UserTenant.accepted_at.isnot(None),
        )
        .first()
    )
    if not membership:
        return False
    permissions = get_effective_membership_permissions(db, membership)
    return "tenant.settings.manage" in permissions


def is_list_owner(list_row: PhotoList, user: UserProfile) -> bool:
    if not list_row or not user or not getattr(list_row, "created_by_uid", None):
        return False
    return str(list_row.created_by_uid) == str(user.supabase_uid)


def can_view_list(list_row: PhotoList, *, user: UserProfile, is_tenant_admin: bool) -> bool:
    if not list_row:
        return False
    if is_tenant_admin:
        return True
    if is_list_owner(list_row, user):
        return True
    return normalize_list_visibility(getattr(list_row, "visibility", None)) == LIST_VISIBILITY_SHARED


def can_edit_list(list_row: PhotoList, *, user: UserProfile, is_tenant_admin: bool) -> bool:
    if not list_row:
        return False
    if is_tenant_admin:
        return True
    return is_list_owner(list_row, user)


def get_list_scope_clause(*, user: UserProfile, scope: str, is_tenant_admin: bool):
    normalized_scope = normalize_list_scope(scope)
    if normalized_scope == "all":
        if not is_tenant_admin:
            raise HTTPException(status_code=403, detail="Admin role required for all list scope")
        return None

    owner_clause = PhotoList.created_by_uid == user.supabase_uid
    if normalized_scope == "private":
        return and_(
            owner_clause,
            PhotoList.visibility == LIST_VISIBILITY_PRIVATE,
        )

    # default scope: shared lists + caller-owned private/shared lists
    shared_clause = or_(
        PhotoList.visibility == LIST_VISIBILITY_SHARED,
        PhotoList.visibility.is_(None),
    )
    return or_(shared_clause, owner_clause)
