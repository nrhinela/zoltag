"""Base command class for shared CLI setup/teardown."""

import click
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from zoltag.database import get_engine_kwargs
from zoltag.settings import settings
from zoltag.tenant import Tenant, TenantContext


class CliCommand:
    """Base class for all CLI commands with shared setup/teardown."""

    def __init__(self):
        self.engine = None
        self.Session = None
        self.db = None
        self.tenant = None

    def setup_db(self):
        """Initialize database connection."""
        self.engine = create_engine(
            settings.database_url,
            **get_engine_kwargs(),
        )
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

    def cleanup_db(self):
        """Close database connection."""
        if self.db:
            self.db.close()

    def load_tenant(self, tenant_id: str) -> Tenant:
        """Load tenant from database and set context."""
        if not self.db:
            raise click.ClickException("Database not initialized")

        result = self.db.execute(
            text("SELECT id, name, storage_bucket, thumbnail_bucket FROM tenants WHERE id = :tenant_id"),
            {"tenant_id": tenant_id}
        ).first()

        if not result:
            raise click.ClickException(f"Tenant {tenant_id} not found in database")

        tenant = Tenant(
            id=result[0],
            name=result[1],
            storage_bucket=result[2],
            thumbnail_bucket=result[3]
        )
        TenantContext.set(tenant)
        self.tenant = tenant
        return tenant

    def run(self):
        """Execute command - override in subclasses."""
        raise NotImplementedError

    def __enter__(self):
        """Context manager entry."""
        self.setup_db()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.cleanup_db()
