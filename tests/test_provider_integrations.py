"""Provider integration repository behavior."""

import uuid

from zoltag.auth.models import UserProfile
from zoltag.integrations import TenantIntegrationRepository
from zoltag.metadata import Tenant as TenantModel

# Force auth table registration on metadata before test_db creates schema.
_USER_PROFILE_TABLE = UserProfile.__table__


def _create_tenant_row(test_db):
    tenant_row = TenantModel(
        id=uuid.uuid4(),
        identifier=f"tenant-{uuid.uuid4()}",
        key_prefix=f"tenant-{uuid.uuid4()}",
        name="Provider Test Tenant",
        active=True,
        settings={},
    )
    test_db.add(tenant_row)
    test_db.flush()
    return tenant_row


def test_create_provider_defaults_inactive(test_db):
    tenant_row = _create_tenant_row(test_db)
    repo = TenantIntegrationRepository(test_db)

    record = repo.create_provider(tenant_row, "dropbox")

    assert record.is_active is False


def test_update_provider_activation_reflected_in_runtime_context(test_db):
    tenant_row = _create_tenant_row(test_db)
    repo = TenantIntegrationRepository(test_db)

    created = repo.create_provider(tenant_row, "dropbox")
    assert created.is_active is False

    updated = repo.update_provider(
        tenant_row,
        "dropbox",
        provider_id=created.id,
        is_active=True,
        sync_folders=["/Events"],
    )
    runtime = repo.build_runtime_context(tenant_row)

    assert updated.is_active is True
    assert runtime["dropbox"]["is_active"] is True
    assert runtime["dropbox"]["sync_folders"] == ["/Events"]


def test_runtime_context_keeps_inactive_provider_config(test_db):
    tenant_row = _create_tenant_row(test_db)
    repo = TenantIntegrationRepository(test_db)

    created = repo.create_provider(
        tenant_row,
        "dropbox",
        config_json={
            "app_key": "app-key-1",
            "sync_folders": ["/One", "/Two"],
        },
    )
    assert created.is_active is False

    runtime = repo.build_runtime_context(tenant_row)

    assert runtime["dropbox"]["is_active"] is False
    assert runtime["dropbox"]["app_key"] == "app-key-1"
    assert runtime["dropbox"]["sync_folders"] == ["/One", "/Two"]
