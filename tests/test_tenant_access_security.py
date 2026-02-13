"""Security tests for tenant resolution and membership enforcement."""

import asyncio
from datetime import datetime
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from zoltag.auth.models import UserProfile, UserTenant
from zoltag.dependencies import get_tenant
from zoltag.metadata import Tenant as TenantModel


def _create_tenant(db: Session, tenant_id: str = "tenant_a") -> TenantModel:
    tenant = TenantModel(id=tenant_id, name=f"Tenant {tenant_id}")
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    return tenant


def _create_user(
    db: Session,
    *,
    is_super_admin: bool = False,
    email: str = "user@example.com",
) -> UserProfile:
    user = UserProfile(
        supabase_uid=uuid.uuid4(),
        email=email,
        is_active=True,
        is_super_admin=is_super_admin,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _add_membership(
    db: Session,
    *,
    user: UserProfile,
    tenant_id: str,
    accepted: bool = True,
) -> UserTenant:
    membership = UserTenant(
        supabase_uid=user.supabase_uid,
        tenant_id=tenant_id,
        role="user",
        accepted_at=datetime.utcnow() if accepted else None,
    )
    db.add(membership)
    db.commit()
    db.refresh(membership)
    return membership


def test_get_tenant_allows_member_access(test_db: Session):
    tenant = _create_tenant(test_db, "tenant_access_ok")
    user = _create_user(test_db, email="member@example.com")
    _add_membership(test_db, user=user, tenant_id=tenant.id, accepted=True)

    resolved = asyncio.run(get_tenant(x_tenant_id=tenant.id, user=user, db=test_db))

    assert resolved.id == tenant.id


def test_get_tenant_blocks_non_member(test_db: Session):
    tenant = _create_tenant(test_db, "tenant_access_denied")
    user = _create_user(test_db, email="outsider@example.com")

    with pytest.raises(HTTPException) as exc:
        asyncio.run(get_tenant(x_tenant_id=tenant.id, user=user, db=test_db))

    assert exc.value.status_code == 403
    assert "No access to tenant" in str(exc.value.detail)


def test_get_tenant_allows_super_admin_without_membership(test_db: Session):
    tenant = _create_tenant(test_db, "tenant_super_admin")
    admin = _create_user(
        test_db,
        is_super_admin=True,
        email="superadmin@example.com",
    )

    resolved = asyncio.run(get_tenant(x_tenant_id=tenant.id, user=admin, db=test_db))

    assert resolved.id == tenant.id


def test_get_tenant_requires_existing_tenant(test_db: Session):
    admin = _create_user(
        test_db,
        is_super_admin=True,
        email="superadmin2@example.com",
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(get_tenant(x_tenant_id="missing_tenant", user=admin, db=test_db))

    assert exc.value.status_code == 404
