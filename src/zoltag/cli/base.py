"""Base command class for shared CLI setup/teardown."""

import click
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from zoltag.database import get_engine_kwargs
from zoltag.settings import settings
from zoltag.tenant import Tenant, TenantContext
from zoltag.integrations import TenantIntegrationRepository
from zoltag.metadata import Tenant as TenantModel
from zoltag.tenant_scope import tenant_column_filter_for_values, tenant_reference_filter


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

        tenant_row = self.db.query(TenantModel).filter(
            tenant_reference_filter(TenantModel, tenant_id)
        ).first()

        if not tenant_row:
            raise click.ClickException(f"Tenant {tenant_id} not found in database")

        canonical_tenant_id = str(tenant_row.id)
        integration_repo = TenantIntegrationRepository(self.db)
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

        # Normalize user-provided tenant references (id or uuid) to canonical tenant ID.
        if hasattr(self, "tenant_id"):
            self.tenant_id = tenant.id

        TenantContext.set(tenant)
        self.tenant = tenant
        return tenant

    def tenant_filter(self, model, include_legacy_fallback: bool = True):
        """Build a tenant filter for the current command tenant."""
        if not self.tenant:
            raise click.ClickException("Tenant not loaded")
        return tenant_column_filter_for_values(
            model=model,
            tenant_id=self.tenant.id,
            include_legacy_fallback=include_legacy_fallback,
        )

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
