"""Tests for tenant scope safety guards in admin integration endpoints."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from zoltag.routers.admin_integrations import _assert_dropbox_provider_scope_safe


def _tenant_row(*, tenant_id: str = "tenant-uuid", key_prefix: str = "ned-tenant", identifier: str = "ned") -> SimpleNamespace:
    return SimpleNamespace(id=tenant_id, key_prefix=key_prefix, identifier=identifier)


def _dropbox_record(
    *,
    secret_scope: str = "ned-tenant",
    token_secret_name: str = "dropbox-token-ned-tenant",
) -> SimpleNamespace:
    return SimpleNamespace(
        provider_type="dropbox",
        secret_scope=secret_scope,
        dropbox_token_secret_name=token_secret_name,
    )


def test_dropbox_scope_guard_allows_matching_key_prefix() -> None:
    tenant_row = _tenant_row()
    record = _dropbox_record(secret_scope="ned-tenant", token_secret_name="dropbox-token-ned-tenant")
    _assert_dropbox_provider_scope_safe(tenant_row, record)


def test_dropbox_scope_guard_allows_matching_tenant_id_scope() -> None:
    tenant_row = _tenant_row(tenant_id="3e5f51c5-4f47-4118-b77f-f47dbba2b403")
    record = _dropbox_record(
        secret_scope="3e5f51c5-4f47-4118-b77f-f47dbba2b403",
        token_secret_name="dropbox-token-3e5f51c5-4f47-4118-b77f-f47dbba2b403",
    )
    _assert_dropbox_provider_scope_safe(tenant_row, record)


def test_dropbox_scope_guard_rejects_mismatched_scope() -> None:
    tenant_row = _tenant_row()
    record = _dropbox_record(secret_scope="bcg")
    with pytest.raises(HTTPException) as exc:
        _assert_dropbox_provider_scope_safe(tenant_row, record)
    assert exc.value.status_code == 409
    assert "scope does not match this tenant" in str(exc.value.detail)


def test_dropbox_scope_guard_rejects_mismatched_token_secret_name() -> None:
    tenant_row = _tenant_row()
    record = _dropbox_record(secret_scope="ned-tenant", token_secret_name="dropbox-token-bcg")
    with pytest.raises(HTTPException) as exc:
        _assert_dropbox_provider_scope_safe(tenant_row, record)
    assert exc.value.status_code == 409
    assert "token secret appears bound to another tenant" in str(exc.value.detail)

