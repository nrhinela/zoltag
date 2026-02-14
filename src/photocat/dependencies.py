"""Shared dependencies for FastAPI endpoints."""

from typing import Optional

from fastapi import Header, HTTPException, Depends, status
from sqlalchemy.orm import Session
from google.cloud import secretmanager

from photocat.database import get_db
from photocat.tenant import Tenant
from photocat.metadata import Tenant as TenantModel
from photocat.settings import settings
from photocat.auth.dependencies import get_current_user
from photocat.auth.models import UserProfile, UserTenant
from photocat.tenant_scope import tenant_column_filter_for_values, tenant_reference_filter


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

    tenant_settings = tenant_row.settings or {}

    # Convert database row to Tenant dataclass
    canonical_tenant_id = str(tenant_row.id)
    key_prefix = (getattr(tenant_row, "key_prefix", None) or canonical_tenant_id).strip()

    tenant = Tenant(
        id=canonical_tenant_id,
        name=tenant_row.name,
        identifier=getattr(tenant_row, "identifier", None) or canonical_tenant_id,
        key_prefix=key_prefix,
        active=tenant_row.active,
        dropbox_token_secret=f"dropbox-token-{key_prefix}",
        dropbox_app_key=tenant_row.dropbox_app_key,
        dropbox_app_secret=f"dropbox-app-secret-{key_prefix}",
        gdrive_client_id=tenant_settings.get("gdrive_client_id"),
        gdrive_token_secret=tenant_settings.get("gdrive_token_secret") or f"gdrive-token-{key_prefix}",
        gdrive_client_secret=tenant_settings.get("gdrive_client_secret") or f"gdrive-client-secret-{key_prefix}",
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
