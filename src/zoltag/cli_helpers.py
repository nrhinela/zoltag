"""Helper utilities for CLI commands.

Consolidates common patterns like database setup, tenant loading, and tag processing
to reduce duplication across CLI commands.
"""

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from zoltag.database import get_engine_kwargs
from zoltag.settings import settings
from zoltag.tenant import Tenant, TenantContext


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
    result = session.execute(
        text("SELECT id, name, storage_bucket, thumbnail_bucket FROM tenants WHERE id = :tenant_id"),
        {"tenant_id": tenant_id}
    ).first()

    if not result:
        session.close()
        raise ValueError(f"Tenant {tenant_id} not found in database")

    tenant = Tenant(
        id=result[0],
        name=result[1],
        storage_bucket=result[2],
        thumbnail_bucket=result[3]
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
