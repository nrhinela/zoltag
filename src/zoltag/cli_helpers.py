"""Helper utilities for CLI commands.

Consolidates common patterns like database setup, tenant loading, and tag processing
to reduce duplication across CLI commands.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from zoltag.database import get_engine_kwargs
from zoltag.integrations import TenantIntegrationRepository
from zoltag.metadata import Tenant as TenantModel
from zoltag.settings import settings
from zoltag.tenant import Tenant, TenantContext
from zoltag.tenant_scope import tenant_reference_filter


def setup_database_and_tenant(tenant_id: str):
    """Set up database connection and load tenant context.

    Consolidates repeated pattern of:
    - Creating database engine
    - Loading tenant from database
    - Setting tenant context

    Args:
        tenant_id: The ID of the tenant to load

    Returns:
        Tuple of (engine, Session, session, tenant)

    Raises:
        ValueError: If tenant is not found in database
    """
    # Setup database
    engine = create_engine(settings.database_url, **get_engine_kwargs())
    SessionLocal = sessionmaker(bind=engine)
    session = SessionLocal()

    # Load tenant from database
    tenant_row = session.query(TenantModel).filter(
        tenant_reference_filter(TenantModel, tenant_id)
    ).first()
    if not tenant_row:
        session.close()
        raise ValueError(f"Tenant {tenant_id} not found in database")

    canonical_tenant_id = str(tenant_row.id)
    integration_repo = TenantIntegrationRepository(session)
    runtime_context = integration_repo.build_runtime_context(tenant_row)
    tenant_settings = tenant_row.settings if isinstance(tenant_row.settings, dict) else {}
    dropbox_runtime = runtime_context.get("dropbox") or {}
    gdrive_runtime = runtime_context.get("gdrive") or {}
    key_prefix = getattr(tenant_row, "key_prefix", None) or canonical_tenant_id
    tenant = Tenant(
        id=canonical_tenant_id,
        name=tenant_row.name,
        identifier=getattr(tenant_row, "identifier", None) or canonical_tenant_id,
        key_prefix=key_prefix,
        dropbox_token_secret=str(dropbox_runtime.get("token_secret_name") or f"dropbox-token-{key_prefix}").strip(),
        dropbox_app_key=str(dropbox_runtime.get("app_key") or "").strip() or None,
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
    TenantContext.set(tenant)

    return engine, SessionLocal, session, tenant


def close_database(engine, session):
    """Close database connection and session.

    Args:
        engine: SQLAlchemy engine
        session: SQLAlchemy session
    """
    session.close()
    engine.dispose()


def get_tenant_display_info(tenant: Tenant) -> str:
    """Get formatted tenant information for display.

    Args:
        tenant: Tenant object

    Returns:
        Formatted string with tenant details
    """
    return (
        f"Using tenant: {tenant.name}\n"
        f"  Storage bucket: {tenant.get_storage_bucket(settings)}\n"
        f"  Thumbnail bucket: {tenant.get_thumbnail_bucket(settings)}"
    )
