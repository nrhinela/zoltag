"""Helper utilities for CLI commands.

Consolidates common patterns like database setup, tenant loading, and tag processing
to reduce duplication across CLI commands.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from photocat.database import get_engine_kwargs
from photocat.metadata import Tenant as TenantModel
from photocat.settings import settings
from photocat.tenant import Tenant, TenantContext
from photocat.tenant_scope import tenant_reference_filter


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
    tenant = Tenant(
        id=canonical_tenant_id,
        name=tenant_row.name,
        identifier=getattr(tenant_row, "identifier", None) or canonical_tenant_id,
        key_prefix=getattr(tenant_row, "key_prefix", None) or canonical_tenant_id,
        storage_bucket=tenant_row.storage_bucket,
        thumbnail_bucket=tenant_row.thumbnail_bucket,
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
