"""Tests for automatic invitation claiming during auth."""

import asyncio
from datetime import datetime, timedelta
import uuid

from fastapi import HTTPException
from starlette.requests import Request
from sqlalchemy.orm import Session

from zoltag.auth.dependencies import claim_pending_invitations_for_user
from zoltag.auth.schemas import RegisterRequest
from zoltag.auth.models import Invitation, UserProfile, UserTenant
from zoltag.metadata import Tenant as TenantModel
from zoltag.routers.auth import get_current_user_info, register


def _create_tenant(test_db: Session) -> uuid.UUID:
    tenant_id = uuid.uuid4()
    tenant = TenantModel(
        id=tenant_id,
        identifier=f"tenant-{tenant_id.hex[:8]}",
        key_prefix=f"tenant-{tenant_id.hex[:8]}",
        name="Test Tenant",
        active=True,
    )
    test_db.add(tenant)
    test_db.flush()
    return tenant_id


def _create_user(test_db: Session, email: str, *, is_active: bool) -> UserProfile:
    user = UserProfile(
        supabase_uid=uuid.uuid4(),
        email=email,
        email_verified=True,
        display_name=email.split("@")[0],
        is_active=is_active,
        is_super_admin=False,
    )
    test_db.add(user)
    test_db.flush()
    return user


def _build_request(path: str = "/api/v1/auth/register") -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "headers": [],
        }
    )


def test_claim_pending_invitations_creates_membership_and_activates_user(test_db: Session):
    tenant_id = _create_tenant(test_db)
    inviter = _create_user(test_db, "admin@example.com", is_active=True)
    invited = _create_user(test_db, "invited@example.com", is_active=False)

    invitation = Invitation(
        email="INVITED@example.com",
        tenant_id=tenant_id,
        role="editor",
        invited_by=inviter.supabase_uid,
        token="token-a",
        expires_at=datetime.utcnow() + timedelta(days=1),
        accepted_at=None,
    )
    test_db.add(invitation)
    test_db.commit()

    changed_tenants = claim_pending_invitations_for_user(test_db, user=invited)
    test_db.commit()

    assert str(tenant_id) in changed_tenants

    refreshed_user = test_db.query(UserProfile).filter(UserProfile.supabase_uid == invited.supabase_uid).one()
    assert refreshed_user.is_active is True

    membership = test_db.query(UserTenant).filter(
        UserTenant.supabase_uid == invited.supabase_uid,
        UserTenant.tenant_id == tenant_id,
    ).one()
    assert membership.role == "editor"
    assert membership.accepted_at is not None

    refreshed_invitation = test_db.query(Invitation).filter(Invitation.id == invitation.id).one()
    assert refreshed_invitation.accepted_at is not None


def test_claim_pending_invitations_updates_existing_membership_role(test_db: Session):
    tenant_id = _create_tenant(test_db)
    inviter = _create_user(test_db, "admin2@example.com", is_active=True)
    invited = _create_user(test_db, "member@example.com", is_active=True)

    membership = UserTenant(
        supabase_uid=invited.supabase_uid,
        tenant_id=tenant_id,
        role="user",
        invited_by=inviter.supabase_uid,
        invited_at=datetime.utcnow() - timedelta(days=2),
        accepted_at=datetime.utcnow() - timedelta(days=2),
    )
    test_db.add(membership)

    invitation = Invitation(
        email="member@example.com",
        tenant_id=tenant_id,
        role="admin",
        invited_by=inviter.supabase_uid,
        token="token-b",
        expires_at=datetime.utcnow() + timedelta(days=1),
        accepted_at=None,
    )
    test_db.add(invitation)
    test_db.commit()

    changed_tenants = claim_pending_invitations_for_user(test_db, user=invited)
    test_db.commit()

    assert str(tenant_id) in changed_tenants

    refreshed_membership = test_db.query(UserTenant).filter(
        UserTenant.supabase_uid == invited.supabase_uid,
        UserTenant.tenant_id == tenant_id,
    ).one()
    assert refreshed_membership.role == "admin"

    refreshed_invitation = test_db.query(Invitation).filter(Invitation.id == invitation.id).one()
    assert refreshed_invitation.accepted_at is not None


def test_get_current_user_info_uses_membership_role_when_tenant_role_missing(test_db: Session):
    tenant_id = _create_tenant(test_db)
    invited = _create_user(test_db, "fallback-admin@example.com", is_active=True)

    membership = UserTenant(
        supabase_uid=invited.supabase_uid,
        tenant_id=tenant_id,
        tenant_role_id=None,
        role="admin",
        accepted_at=datetime.utcnow(),
    )
    test_db.add(membership)
    test_db.commit()

    response = asyncio.run(get_current_user_info(user=invited, db=test_db))

    assert len(response.tenants) == 1
    assert response.tenants[0].role == "admin"
    assert response.tenants[0].role_key == "admin"


def test_register_fails_without_pending_invitation(test_db: Session, monkeypatch):
    supabase_uid = uuid.uuid4()

    async def _fake_uid_from_token(_token: str):
        return supabase_uid

    async def _fake_verify_jwt(_token: str):
        return {
            "email": "no-invite@example.com",
            "email_confirmed_at": "2026-02-19T00:00:00Z",
        }

    monkeypatch.setattr("zoltag.routers.auth.get_supabase_uid_from_token", _fake_uid_from_token)
    monkeypatch.setattr("zoltag.auth.jwt.verify_supabase_jwt", _fake_verify_jwt)

    try:
        asyncio.run(
            register(
                request=_build_request(),
                body=RegisterRequest(display_name="No Invite"),
                db=test_db,
                authorization="Bearer test-token",
            )
        )
        assert False, "Expected register() to raise HTTPException"
    except HTTPException as exc:
        assert exc.status_code == 403
        assert exc.detail == "Invitation required before registration"

    profile = test_db.query(UserProfile).filter(
        UserProfile.supabase_uid == supabase_uid
    ).first()
    assert profile is None


def test_register_succeeds_with_pending_invitation(test_db: Session, monkeypatch):
    tenant_id = _create_tenant(test_db)
    inviter = _create_user(test_db, "invite-admin@example.com", is_active=True)
    supabase_uid = uuid.uuid4()

    invitation = Invitation(
        email="invited-register@example.com",
        tenant_id=tenant_id,
        role="user",
        invited_by=inviter.supabase_uid,
        token="token-register",
        expires_at=datetime.utcnow() + timedelta(days=1),
        accepted_at=None,
    )
    test_db.add(invitation)
    test_db.commit()

    async def _fake_uid_from_token(_token: str):
        return supabase_uid

    async def _fake_verify_jwt(_token: str):
        return {
            "email": "Invited-Register@example.com",
            "email_confirmed_at": "2026-02-19T00:00:00Z",
        }

    monkeypatch.setattr("zoltag.routers.auth.get_supabase_uid_from_token", _fake_uid_from_token)
    monkeypatch.setattr("zoltag.auth.jwt.verify_supabase_jwt", _fake_verify_jwt)

    response = asyncio.run(
        register(
            request=_build_request(),
            body=RegisterRequest(display_name="Invited Register"),
            db=test_db,
            authorization="Bearer test-token",
        )
    )

    assert response.get("status") == "pending_approval"
    created_profile = test_db.query(UserProfile).filter(
        UserProfile.supabase_uid == supabase_uid
    ).first()
    assert created_profile is not None
    assert created_profile.email == "Invited-Register@example.com"
