"""Tenant management and isolation."""

import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Dict, List, Optional

# In-process cache for signed thumbnail URLs: path -> (url, expiry_timestamp)
_signed_url_cache: dict[str, tuple[str, float]] = {}
_signed_url_cache_lock = threading.Lock()
_SIGNED_URL_TTL = 3600       # 1 hour signature validity
_SIGNED_URL_CACHE_TTL = 3300 # Evict from cache 5 min before expiry

# Shared GCS client and credentials — initialized once, reused across requests
_gcs_client = None
_gcs_credentials = None
_gcs_client_lock = threading.Lock()


@dataclass
class Tenant:
    """Represents a tenant in the system."""

    id: str
    name: str
    identifier: Optional[str] = None
    key_prefix: Optional[str] = None
    active: bool = True
    dropbox_token_secret: Optional[str] = None  # Secret Manager reference
    dropbox_app_key: Optional[str] = None  # Dropbox app key (public, stored in DB)
    dropbox_app_secret: Optional[str] = None  # Secret Manager reference
    dropbox_oauth_mode: Optional[str] = None  # Dropbox OAuth mode (managed)
    dropbox_sync_folders: Optional[list[str]] = None
    gdrive_sync_folders: Optional[list[str]] = None
    default_source_provider: Optional[str] = None
    gdrive_client_id: Optional[str] = None  # Google OAuth client ID
    gdrive_token_secret: Optional[str] = None  # Secret Manager reference
    gdrive_client_secret: Optional[str] = None  # Secret Manager reference
    storage_bucket: Optional[str] = None  # GCS bucket for full-size images
    thumbnail_bucket: Optional[str] = None  # GCS bucket for thumbnails
    settings: Optional[dict[str, Any]] = None  # Tenant-level settings JSON
    
    def __post_init__(self) -> None:
        """Validate tenant data."""
        self.id = str(self.id).strip()
        if not self.id:
            raise ValueError("Tenant ID is required")
        if not self.name:
            raise ValueError("Tenant name is required")
        if not self.identifier:
            self.identifier = self.id
        if not self.key_prefix:
            self.key_prefix = self.id

    @property
    def secret_scope(self) -> str:
        """Stable prefix for secret names and object keys."""
        value = (self.key_prefix or "").strip()
        if value:
            return value
        value = (self.identifier or "").strip()
        if value:
            return value
        return self.id

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
            Path in format: {tenant_key_prefix}/{path_type}/{filename}
        """
        return f"{self.secret_scope}/{path_type}/{filename}"

    def get_thumbnail_url(self, settings, thumbnail_path: Optional[str]) -> Optional[str]:
        """Build a thumbnail URL — signed for private buckets, or plain public URL."""
        if not thumbnail_path:
            return None
        base = (settings.thumbnail_cdn_base_url or "").strip()
        if base:
            return f"{base.rstrip('/')}/{thumbnail_path}"
        if getattr(settings, "thumbnail_signed_urls", False):
            return self._get_signed_thumbnail_url(settings, thumbnail_path)
        return f"https://storage.googleapis.com/{self.get_thumbnail_bucket(settings)}/{thumbnail_path}"

    def _get_signed_thumbnail_url(self, settings, thumbnail_path: str) -> Optional[str]:
        """Return a cached V4 signed URL for a private GCS thumbnail.

        Uses generate_signed_url with service_account_email + access_token so that
        the IAM signBlob API is used instead of a private key. The GCS client and
        credentials are shared across requests; the token is only refreshed when
        expired to avoid per-request IAM latency.
        """
        now = time.monotonic()
        with _signed_url_cache_lock:
            cached = _signed_url_cache.get(thumbnail_path)
            if cached and cached[1] > now:
                return cached[0]

        try:
            import google.auth
            from google.auth.transport import requests as google_requests
            from google.cloud import storage as gcs

            global _gcs_client, _gcs_credentials

            with _gcs_client_lock:
                if _gcs_credentials is None:
                    _gcs_credentials, _ = google.auth.default(
                        scopes=["https://www.googleapis.com/auth/cloud-platform"]
                    )
                # Refresh only when token is missing or expired
                if not _gcs_credentials.token or not _gcs_credentials.valid:
                    _gcs_credentials.refresh(google_requests.Request())
                if _gcs_client is None:
                    _gcs_client = gcs.Client(
                        project=settings.gcp_project_id,
                        credentials=_gcs_credentials,
                    )
                credentials = _gcs_credentials
                client = _gcs_client

            service_account_email = getattr(settings, "signing_service_account", None) or \
                "978982171858-compute@developer.gserviceaccount.com"

            bucket_name = self.get_thumbnail_bucket(settings)
            blob = client.bucket(bucket_name).blob(thumbnail_path)
            url = blob.generate_signed_url(
                version="v4",
                expiration=timedelta(seconds=_SIGNED_URL_TTL),
                method="GET",
                service_account_email=service_account_email,
                access_token=credentials.token,
            )
            with _signed_url_cache_lock:
                _signed_url_cache[thumbnail_path] = (url, now + _SIGNED_URL_CACHE_TTL)
            return url
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning("Thumbnail signing failed: %s", e)
            return f"https://storage.googleapis.com/{self.get_thumbnail_bucket(settings)}/{thumbnail_path}"

    def bulk_sign_thumbnail_urls(self, settings, thumbnail_paths: List[Optional[str]], max_workers: int = 20) -> Dict[str, Optional[str]]:
        """Sign multiple thumbnail URLs in parallel. Returns a dict of path -> url.

        Cache hits are resolved immediately without spawning threads. Only
        cache misses are signed concurrently, up to max_workers at a time.
        """
        if not getattr(settings, "thumbnail_signed_urls", False):
            bucket = self.get_thumbnail_bucket(settings)
            base = (settings.thumbnail_cdn_base_url or "").strip()
            result = {}
            for path in thumbnail_paths:
                if not path:
                    result[path] = None
                elif base:
                    result[path] = f"{base.rstrip('/')}/{path}"
                else:
                    result[path] = f"https://storage.googleapis.com/{bucket}/{path}"
            return result

        now = time.monotonic()
        result: Dict[str, Optional[str]] = {}
        uncached: List[str] = []

        # Resolve cache hits without any I/O
        for path in thumbnail_paths:
            if not path:
                result[path] = None
                continue
            with _signed_url_cache_lock:
                cached = _signed_url_cache.get(path)
            if cached and cached[1] > now:
                result[path] = cached[0]
            else:
                uncached.append(path)

        if not uncached:
            return result

        # Sign cache misses in parallel
        with ThreadPoolExecutor(max_workers=min(max_workers, len(uncached))) as executor:
            futures = {executor.submit(self._get_signed_thumbnail_url, settings, path): path for path in uncached}
            for future in as_completed(futures):
                path = futures[future]
                try:
                    result[path] = future.result()
                except Exception:
                    result[path] = None

        return result

    @staticmethod
    def _sanitize_storage_filename(filename: str, fallback: str = "file") -> str:
        """Keep only the basename segment for object-key safety."""
        safe_name = (filename or "").strip().split("/")[-1]
        return safe_name or fallback

    def get_asset_source_key(self, asset_id: str, original_filename: str) -> str:
        """
        Build the canonical source object key.

        Format:
        tenants/{tenant_key_prefix}/assets/{asset_id}/{original_filename}
        """
        safe_name = self._sanitize_storage_filename(original_filename, fallback="file")
        return f"tenants/{self.secret_scope}/assets/{asset_id}/{safe_name}"

    def get_asset_derivative_key(self, derivative_id: str, filename: str) -> str:
        """
        Build a derivative object key.

        Format:
        tenants/{tenant_key_prefix}/derivatives/{derivative_id}/{filename}
        """
        safe_name = self._sanitize_storage_filename(filename, fallback="derivative")
        return f"tenants/{self.secret_scope}/derivatives/{derivative_id}/{safe_name}"

    def get_asset_thumbnail_key(self, asset_id: str, filename: str = "default-256.jpg") -> str:
        """
        Build a thumbnail object key for a specific asset.

        Format:
        tenants/{tenant_key_prefix}/assets/{asset_id}/thumbnails/{filename}
        """
        safe_name = self._sanitize_storage_filename(filename, fallback="default-256.jpg")
        return f"tenants/{self.secret_scope}/assets/{asset_id}/thumbnails/{safe_name}"

    def get_person_reference_key(self, person_id: int, reference_id: str, filename: str) -> str:
        """
        Build a storage key for uploaded person reference photos.

        Format:
        tenants/{tenant_key_prefix}/person-references/{person_id}/{reference_id}/{filename}
        """
        safe_name = self._sanitize_storage_filename(filename, fallback="reference")
        return f"tenants/{self.secret_scope}/person-references/{int(person_id)}/{reference_id}/{safe_name}"

    def get_person_reference_bucket(self, settings) -> str:
        """Get dedicated bucket for person reference photos."""
        return str(getattr(settings, "person_reference_bucket", "") or self.get_storage_bucket(settings)).strip()

    def get_asset_file_path(self, asset_id: str, asset_file_id: str, original_filename: str) -> str:
        """
        Backward-compatible alias for the old helper signature.

        asset_file_id is intentionally ignored now that source keys are:
        tenants/{tenant_key_prefix}/assets/{asset_id}/{original_filename}
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
