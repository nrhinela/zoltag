"""Tests for activity event logging."""

import asyncio
import uuid
from datetime import datetime, timezone

from starlette.requests import Request
from sqlalchemy.orm import Session

from zoltag.activity import EVENT_AUTH_LOGIN, EVENT_SEARCH_IMAGES, record_activity_event
from zoltag.auth.dependencies import get_current_user
from zoltag.auth.models import UserProfile, UserTenant
from zoltag.metadata import ActivityEvent, Tenant as TenantModel


def _build_request(path: str = "/api/v1/auth/me") -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": path,
            "headers": [],
        }
    )


def _create_tenant(test_db: Session) -> TenantModel:
    tenant_id = uuid.uuid4()
    tenant = TenantModel(
        id=tenant_id,
        identifier=f"tenant-{tenant_id.hex[:8]}",
        key_prefix=f"tenant-{tenant_id.hex[:8]}",
        name="Activity Tenant",
        active=True,
    )
    test_db.add(tenant)
    test_db.commit()
    test_db.refresh(tenant)
    return tenant


def _create_user(test_db: Session, email: str, *, is_active: bool = True) -> UserProfile:
    user = UserProfile(
        supabase_uid=uuid.uuid4(),
        email=email,
        email_verified=True,
        display_name=email.split("@")[0],
        is_active=is_active,
        is_super_admin=False,
    )
    test_db.add(user)
    test_db.commit()
    test_db.refresh(user)
    return user


def _create_membership(
    test_db: Session,
    *,
    user: UserProfile,
    tenant: TenantModel,
    accepted: bool = True,
) -> UserTenant:
    membership = UserTenant(
        supabase_uid=user.supabase_uid,
        tenant_id=tenant.id,
        role="admin",
        invited_at=datetime.utcnow(),
        accepted_at=datetime.utcnow() if accepted else None,
    )
    test_db.add(membership)
    test_db.commit()
    test_db.refresh(membership)
    return membership


def test_record_activity_event_persists_row(test_db: Session):
    tenant = _create_tenant(test_db)
    user = _create_user(test_db, "activity@example.com")

    record_activity_event(
        test_db,
        event_type=EVENT_SEARCH_IMAGES,
        actor_supabase_uid=user.supabase_uid,
        tenant_id=tenant.id,
        request_path="/api/v1/images",
        client_ip="203.0.113.10",
        user_agent="pytest-agent",
        details={"mode": "text", "query": "sunset beach"},
    )

    row = test_db.query(ActivityEvent).order_by(ActivityEvent.created_at.desc()).first()
    assert row is not None
    assert row.event_type == EVENT_SEARCH_IMAGES
    assert row.tenant_id == tenant.id
    assert row.actor_supabase_uid == user.supabase_uid
    assert row.request_path == "/api/v1/images"
    assert row.client_ip == "203.0.113.10"
    assert row.details.get("query") == "sunset beach"


def test_get_current_user_logs_login_once_per_hour(test_db: Session, monkeypatch):
    user = _create_user(test_db, "login-track@example.com", is_active=True)
    base_iat = int(datetime.now(timezone.utc).timestamp())

    async def _fake_uid_from_token(_token: str):
        return user.supabase_uid

    def _fake_claims(token: str):
        if token == "token-a":
            return {"iat": base_iat}
        return {"iat": base_iat + 60}

    monkeypatch.setattr("zoltag.auth.dependencies.get_supabase_uid_from_token", _fake_uid_from_token)
    monkeypatch.setattr("zoltag.auth.dependencies.jose_jwt.get_unverified_claims", _fake_claims)

    first = asyncio.run(
        get_current_user(
            authorization="Bearer token-a",
            db=test_db,
            request=_build_request(),
            x_forwarded_for="198.51.100.15",
            user_agent="pytest-auth-agent",
        )
    )
    second = asyncio.run(
        get_current_user(
            authorization="Bearer token-a",
            db=test_db,
            request=_build_request(),
            x_forwarded_for="198.51.100.15",
            user_agent="pytest-auth-agent",
        )
    )
    assert first.supabase_uid == user.supabase_uid
    assert second.supabase_uid == user.supabase_uid

    rows = test_db.query(ActivityEvent).filter(
        ActivityEvent.event_type == EVENT_AUTH_LOGIN
    ).all()
    assert len(rows) == 1
    assert rows[0].actor_supabase_uid == user.supabase_uid
    assert rows[0].client_ip == "198.51.100.15"
    assert rows[0].details.get("source") == "jwt"

    third = asyncio.run(
        get_current_user(
            authorization="Bearer token-b",
            db=test_db,
            request=_build_request(),
            x_forwarded_for="198.51.100.16",
            user_agent="pytest-auth-agent",
        )
    )
    assert third.supabase_uid == user.supabase_uid

    rows_after_relogin = test_db.query(ActivityEvent).filter(
        ActivityEvent.event_type == EVENT_AUTH_LOGIN
    ).order_by(ActivityEvent.created_at.asc()).all()
    assert len(rows_after_relogin) == 2
    assert rows_after_relogin[-1].client_ip == "198.51.100.16"


def test_get_current_user_login_event_uses_x_tenant_id(test_db: Session, monkeypatch):
    tenant = _create_tenant(test_db)
    user = _create_user(test_db, "tenant-header@example.com", is_active=True)
    base_iat = int(datetime.now(timezone.utc).timestamp())

    async def _fake_uid_from_token(_token: str):
        return user.supabase_uid

    def _fake_claims(_token: str):
        return {"iat": base_iat}

    monkeypatch.setattr("zoltag.auth.dependencies.get_supabase_uid_from_token", _fake_uid_from_token)
    monkeypatch.setattr("zoltag.auth.dependencies.jose_jwt.get_unverified_claims", _fake_claims)

    current_user = asyncio.run(
        get_current_user(
            authorization="Bearer token-a",
            db=test_db,
            request=_build_request("/api/v1/images"),
            x_tenant_id=tenant.identifier,
            x_forwarded_for="198.51.100.20",
            user_agent="pytest-auth-agent",
        )
    )
    assert current_user.supabase_uid == user.supabase_uid

    row = test_db.query(ActivityEvent).filter(
        ActivityEvent.event_type == EVENT_AUTH_LOGIN
    ).order_by(ActivityEvent.created_at.desc()).first()
    assert row is not None
    assert row.tenant_id == tenant.id


def test_get_current_user_login_event_uses_single_membership_fallback(test_db: Session, monkeypatch):
    tenant = _create_tenant(test_db)
    user = _create_user(test_db, "tenant-fallback@example.com", is_active=True)
    _create_membership(test_db, user=user, tenant=tenant, accepted=True)
    base_iat = int(datetime.now(timezone.utc).timestamp())

    async def _fake_uid_from_token(_token: str):
        return user.supabase_uid

    def _fake_claims(_token: str):
        return {"iat": base_iat}

    monkeypatch.setattr("zoltag.auth.dependencies.get_supabase_uid_from_token", _fake_uid_from_token)
    monkeypatch.setattr("zoltag.auth.dependencies.jose_jwt.get_unverified_claims", _fake_claims)

    current_user = asyncio.run(
        get_current_user(
            authorization="Bearer token-a",
            db=test_db,
            request=_build_request("/api/v1/images"),
            x_forwarded_for="198.51.100.21",
            user_agent="pytest-auth-agent",
        )
    )
    assert current_user.supabase_uid == user.supabase_uid

    row = test_db.query(ActivityEvent).filter(
        ActivityEvent.event_type == EVENT_AUTH_LOGIN
    ).order_by(ActivityEvent.created_at.desc()).first()
    assert row is not None
    assert row.tenant_id == tenant.id


def test_get_current_user_login_event_does_not_guess_multi_membership(test_db: Session, monkeypatch):
    tenant_a = _create_tenant(test_db)
    tenant_b = _create_tenant(test_db)
    user = _create_user(test_db, "tenant-multi@example.com", is_active=True)
    _create_membership(test_db, user=user, tenant=tenant_a, accepted=True)
    _create_membership(test_db, user=user, tenant=tenant_b, accepted=True)
    base_iat = int(datetime.now(timezone.utc).timestamp())

    async def _fake_uid_from_token(_token: str):
        return user.supabase_uid

    def _fake_claims(_token: str):
        return {"iat": base_iat}

    monkeypatch.setattr("zoltag.auth.dependencies.get_supabase_uid_from_token", _fake_uid_from_token)
    monkeypatch.setattr("zoltag.auth.dependencies.jose_jwt.get_unverified_claims", _fake_claims)

    current_user = asyncio.run(
        get_current_user(
            authorization="Bearer token-a",
            db=test_db,
            request=_build_request("/api/v1/images"),
            x_forwarded_for="198.51.100.22",
            user_agent="pytest-auth-agent",
        )
    )
    assert current_user.supabase_uid == user.supabase_uid

    row = test_db.query(ActivityEvent).filter(
        ActivityEvent.event_type == EVENT_AUTH_LOGIN
    ).order_by(ActivityEvent.created_at.desc()).first()
    assert row is not None
    assert row.tenant_id is None
