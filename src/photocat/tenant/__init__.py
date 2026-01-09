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
    storage_bucket: Optional[str] = None  # GCS bucket for full-size images
    thumbnail_bucket: Optional[str] = None  # GCS bucket for thumbnails
    
    def __post_init__(self) -> None:
        """Validate tenant data."""
        if not self.id:
            raise ValueError("Tenant ID is required")
        if not self.name:
            raise ValueError("Tenant name is required")

    def get_storage_bucket(self, settings) -> str:
        """Get storage bucket name, falling back to global settings."""
        return self.storage_bucket or settings.storage_bucket_name

    def get_thumbnail_bucket(self, settings) -> str:
        """Get thumbnail bucket name, falling back to storage bucket or global settings."""
        if self.thumbnail_bucket:
            return self.thumbnail_bucket
        if self.storage_bucket:
            return self.storage_bucket
        return settings.thumbnail_bucket


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
