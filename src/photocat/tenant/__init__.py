"""Tenant management and isolation."""

from dataclasses import dataclass
from typing import Optional


@dataclass
class Tenant:
    """Represents a tenant in the system."""

    id: str
    name: str
    active: bool = True
    dropbox_token_secret: Optional[str] = None  # Secret Manager reference
    dropbox_app_key: Optional[str] = None  # Dropbox app key (public, stored in DB)
    dropbox_app_secret: Optional[str] = None  # Secret Manager reference
    storage_bucket: Optional[str] = None  # GCS bucket for full-size images
    thumbnail_bucket: Optional[str] = None  # GCS bucket for thumbnails
    
    def __post_init__(self) -> None:
        """Validate tenant data."""
        if not self.id:
            raise ValueError("Tenant ID is required")
        if not self.name:
            raise ValueError("Tenant name is required")

    def get_storage_bucket(self, settings) -> str:
        """
        Get storage bucket name using environment-aware convention.

        Returns tenant-specific bucket if configured, otherwise shared bucket.
        Format: {project_id}-{environment}-{tenant_id|shared}
        """
        if self.storage_bucket:
            return self.storage_bucket
        # Use shared bucket with environment (lowercase for GCS compatibility)
        env = settings.environment.lower()
        return f"{settings.gcp_project_id}-{env}-shared"

    def get_thumbnail_bucket(self, settings) -> str:
        """
        Get thumbnail bucket name using environment-aware convention.

        Falls back to storage bucket if thumbnail bucket not specified.
        """
        if self.thumbnail_bucket:
            return self.thumbnail_bucket
        return self.get_storage_bucket(settings)

    def get_storage_path(self, filename: str, path_type: str = "thumbnails") -> str:
        """
        Get storage path with tenant ID prefix (consistent across all bucket types).

        Args:
            filename: The filename to store
            path_type: Path category (e.g., 'thumbnails', 'images', 'originals')

        Returns:
            Path in format: {tenant_id}/{path_type}/{filename}
        """
        return f"{self.id}/{path_type}/{filename}"


class TenantContext:
    """Thread-local tenant context for request isolation."""
    
    _current_tenant: Optional[Tenant] = None
    
    @classmethod
    def set(cls, tenant: Tenant) -> None:
        """Set the current tenant context."""
        cls._current_tenant = tenant
    
    @classmethod
    def get(cls) -> Optional[Tenant]:
        """Get the current tenant context."""
        return cls._current_tenant
    
    @classmethod
    def clear(cls) -> None:
        """Clear the current tenant context."""
        cls._current_tenant = None
    
    @classmethod
    def require(cls) -> Tenant:
        """Get the current tenant or raise if not set."""
        if cls._current_tenant is None:
            raise RuntimeError("No tenant context set")
        return cls._current_tenant
