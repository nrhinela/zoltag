"""Shared dependencies for FastAPI endpoints."""

from typing import Optional

from fastapi import Header, HTTPException, Depends, status
from sqlalchemy.orm import Session
from google.cloud import secretmanager

from zoltag.database import get_db
from zoltag.tenant import Tenant
from zoltag.metadata import Tenant as TenantModel
from zoltag.integrations import TenantIntegrationRepository
from zoltag.settings import settings
from zoltag.auth.dependencies import get_current_user
from zoltag.auth.models import UserProfile, UserTenant
from zoltag.tenant_scope import tenant_column_filter_for_values, tenant_reference_filter


def _resolve_tenant(db: Session, tenant_ref: str) -> Optional[TenantModel]:
    """Resolve tenant by id, identifier, or UUID."""
    return db.query(TenantModel).filter(tenant_reference_filter(TenantModel, tenant_ref)).first()


async def get_tenant(
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> Tenant:
    """Extract and validate tenant from request headers.

    Requires an authenticated user and verifies tenant membership
    unless the user is a super admin.

    Args:
        x_tenant_id: Tenant ID or UUID from X-Tenant-ID header
        user: Authenticated user
        db: Database session

    Returns:
        Tenant: The validated tenant dataclass

    Raises:
        HTTPException 404: Tenant not found
    """
    tenant_row = _resolve_tenant(db, x_tenant_id)
    if not tenant_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Tenant {x_tenant_id} not found")

    if not user.is_super_admin:
        canonical_tenant_id = str(tenant_row.id)
        membership = db.query(UserTenant).filter(
            UserTenant.supabase_uid == user.supabase_uid,
            tenant_column_filter_for_values(
                UserTenant,
                canonical_tenant_id,
            ),
            UserTenant.accepted_at.isnot(None),
        ).first()
        if not membership:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"No access to tenant {x_tenant_id}"
            )

    integration_repo = TenantIntegrationRepository(db)
    runtime_context = integration_repo.build_runtime_context(tenant_row)
    tenant_settings = tenant_row.settings if isinstance(tenant_row.settings, dict) else {}
    dropbox_runtime = runtime_context.get("dropbox") or {}
    gdrive_runtime = runtime_context.get("gdrive") or {}
    dropbox_app_key = str(dropbox_runtime.get("app_key") or "").strip() or None

    # Convert database row to Tenant dataclass
    canonical_tenant_id = str(tenant_row.id)
    key_prefix = (getattr(tenant_row, "key_prefix", None) or canonical_tenant_id).strip()

    tenant = Tenant(
        id=canonical_tenant_id,
        name=tenant_row.name,
        identifier=getattr(tenant_row, "identifier", None) or canonical_tenant_id,
        key_prefix=key_prefix,
        active=tenant_row.active,
        dropbox_token_secret=str(dropbox_runtime.get("token_secret_name") or f"dropbox-token-{key_prefix}").strip(),
        dropbox_app_key=dropbox_app_key,
        dropbox_app_secret=str(dropbox_runtime.get("app_secret_name") or f"dropbox-app-secret-{key_prefix}").strip(),
        dropbox_oauth_mode=str(dropbox_runtime.get("oauth_mode") or "").strip().lower() or None,
        dropbox_sync_folders=list(dropbox_runtime.get("sync_folders") or []),
        gdrive_sync_folders=list(gdrive_runtime.get("sync_folders") or []),
        default_source_provider=str(runtime_context.get("default_source_provider") or "dropbox").strip().lower(),
        gdrive_client_id=str(gdrive_runtime.get("client_id") or "").strip() or None,
        gdrive_token_secret=str(gdrive_runtime.get("token_secret_name") or f"gdrive-token-{key_prefix}").strip(),
        gdrive_client_secret=str(gdrive_runtime.get("client_secret_name") or f"gdrive-client-secret-{key_prefix}").strip(),
        storage_bucket=tenant_row.storage_bucket,
        thumbnail_bucket=tenant_row.thumbnail_bucket,
        settings=tenant_settings,
    )
    return tenant


def get_secret(secret_id: str) -> str:
    """Get secret from Google Cloud Secret Manager."""
    client = secretmanager.SecretManagerServiceClient()
    name = f"projects/{settings.gcp_project_id}/secrets/{secret_id}/versions/latest"
    response = client.access_secret_version(request={"name": name})
    return response.payload.data.decode('UTF-8')


def store_secret(secret_id: str, value: str) -> None:
    """Store secret in Google Cloud Secret Manager."""
    client = secretmanager.SecretManagerServiceClient()
    parent = f"projects/{settings.gcp_project_id}"

    try:
        # Try to create secret
        secret = client.create_secret(
            request={
                "parent": parent,
                "secret_id": secret_id,
                "secret": {"replication": {"automatic": {}}},
            }
        )
    except Exception:
        # Secret already exists
        pass

    # Add version
    parent_secret = f"projects/{settings.gcp_project_id}/secrets/{secret_id}"
    client.add_secret_version(
        request={
            "parent": parent_secret,
            "payload": {"data": value.encode('UTF-8')},
        }
    )


def delete_secret(secret_id: str) -> None:
    """Delete a secret from Google Cloud Secret Manager if it exists."""
    client = secretmanager.SecretManagerServiceClient()
    name = f"projects/{settings.gcp_project_id}/secrets/{secret_id}"
    try:
        client.delete_secret(request={"name": name})
    except Exception as exc:
        message = str(exc).lower()
        if "not found" in message or "404" in message:
            return
        raise


def get_tenant_setting(db: Session, tenant_id: str, key: str, default=None):
    """Safely get tenant setting with fallback.

    Retrieves tenant configuration values with a safe default fallback.
    Works with either JSONB settings column or separate configuration columns.

    Args:
        db: Database session
        tenant_id: Tenant ID or UUID
        key: Setting key (e.g., 'active_machine_tag_type')
        default: Fallback value if not found (default: None)

    Returns:
        Setting value or default if not found
    """
    tenant = _resolve_tenant(db, tenant_id)
    if not tenant:
        return default

    # If tenant.settings is JSONB:
    settings_dict = getattr(tenant, 'settings', {}) or {}
    return settings_dict.get(key, default)
