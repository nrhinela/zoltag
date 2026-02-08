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

    def get_thumbnail_url(self, settings, thumbnail_path: Optional[str]) -> Optional[str]:
        """Build a public thumbnail URL using CDN when configured."""
        if not thumbnail_path:
            return None
        base = (settings.thumbnail_cdn_base_url or "").strip()
        if base:
            return f"{base.rstrip('/')}/{thumbnail_path}"
        return f"https://storage.googleapis.com/{self.get_thumbnail_bucket(settings)}/{thumbnail_path}"

    @staticmethod
    def _sanitize_storage_filename(filename: str, fallback: str = "file") -> str:
        """Keep only the basename segment for object-key safety."""
        safe_name = (filename or "").strip().split("/")[-1]
        return safe_name or fallback

    def get_asset_source_key(self, asset_id: str, original_filename: str) -> str:
        """
        Build the canonical source object key.

        Format:
        tenants/{tenant_id}/assets/{asset_id}/{original_filename}
        """
        safe_name = self._sanitize_storage_filename(original_filename, fallback="file")
        return f"tenants/{self.id}/assets/{asset_id}/{safe_name}"

    def get_asset_derivative_key(self, derivative_id: str, filename: str) -> str:
        """
        Build a derivative object key.

        Format:
        tenants/{tenant_id}/derivatives/{derivative_id}/{filename}
        """
        safe_name = self._sanitize_storage_filename(filename, fallback="derivative")
        return f"tenants/{self.id}/derivatives/{derivative_id}/{safe_name}"

    def get_asset_thumbnail_key(self, asset_id: str, filename: str = "default-256.jpg") -> str:
        """
        Build a thumbnail object key for a specific asset.

        Format:
        tenants/{tenant_id}/assets/{asset_id}/thumbnails/{filename}
        """
        safe_name = self._sanitize_storage_filename(filename, fallback="default-256.jpg")
        return f"tenants/{self.id}/assets/{asset_id}/thumbnails/{safe_name}"

    def get_asset_file_path(self, asset_id: str, asset_file_id: str, original_filename: str) -> str:
        """
        Backward-compatible alias for the old helper signature.

        asset_file_id is intentionally ignored now that source keys are:
        tenants/{tenant_id}/assets/{asset_id}/{original_filename}
        """
        _ = asset_file_id
        return self.get_asset_source_key(asset_id=asset_id, original_filename=original_filename)


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
