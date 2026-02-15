"""Storage provider abstraction with Dropbox and Google Drive implementations."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import mimetypes
from typing import Any, Callable, Dict, Optional, Sequence

import httpx

from zoltag.settings import settings


@dataclass
class ProviderEntry:
    """Normalized storage file metadata used by ingestion/sync paths."""

    provider: str
    source_key: str
    name: str
    file_id: Optional[str] = None
    display_path: Optional[str] = None
    modified_time: Optional[datetime] = None
    size: Optional[int] = None
    content_hash: Optional[str] = None
    revision: Optional[str] = None
    mime_type: Optional[str] = None


@dataclass
class ProviderMediaMetadata:
    """Provider-side metadata translated into EXIF-like values + custom properties."""

    exif_overrides: Dict[str, Any] = field(default_factory=dict)
    provider_properties: Dict[str, Any] = field(default_factory=dict)


class StorageProvider(ABC):
    """Abstract storage provider contract."""

    provider_name: str

    @abstractmethod
    def list_image_entries(self, sync_folders: Optional[Sequence[str]] = None) -> list[ProviderEntry]:
        """List candidate image entries for sync."""

    @abstractmethod
    def get_entry(self, source_key: str) -> ProviderEntry:
        """Fetch latest metadata for one file by canonical source key."""

    @abstractmethod
    def get_media_metadata(self, source_key: str) -> ProviderMediaMetadata:
        """Fetch provider-native media metadata for one file."""

    @abstractmethod
    def download_file(self, source_key: str) -> bytes:
        """Download full file bytes."""

    @abstractmethod
    def get_thumbnail(self, source_key: str, size: str = "w640h480") -> Optional[bytes]:
        """Fetch a thumbnail if available; return None when unsupported."""

    def get_playback_url(self, source_key: str, expires_seconds: int = 300) -> Optional[str]:
        """Return a temporary browser-playable URL for media when supported."""
        _ = source_key
        _ = expires_seconds
        return None

    def resolve_source_key(self, source_key: Optional[str], image: Any = None) -> Optional[str]:
        """Resolve source key from storage data with optional legacy fallback."""
        value = (source_key or "").strip()
        if not value:
            return None
        if value.startswith("/local/"):
            return None
        return value


class DropboxStorageProvider(StorageProvider):
    """Dropbox-backed storage provider."""

    provider_name = "dropbox"

    def __init__(
        self,
        *,
        refresh_token: Optional[str] = None,
        app_key: Optional[str] = None,
        app_secret: Optional[str] = None,
        client: Optional[Any] = None,
    ):
        if client is not None:
            self._client = client
            return
        if not refresh_token or not app_key or not app_secret:
            raise ValueError("DropboxStorageProvider requires refresh_token, app_key, and app_secret")
        from dropbox import Dropbox

        self._client = Dropbox(
            oauth2_refresh_token=refresh_token,
            app_key=app_key,
            app_secret=app_secret,
        )

    def _files_list_folder(self, path: str, recursive: bool) -> Any:
        if hasattr(self._client, "files_list_folder"):
            return self._client.files_list_folder(path, recursive=recursive)
        if hasattr(self._client, "list_folder"):
            # DropboxClient wrapper yields FileMetadata entries directly.
            entries = list(self._client.list_folder(path, recursive=recursive))
            return type("ListFolderResult", (), {"entries": entries, "has_more": False, "cursor": None})
        raise RuntimeError("Dropbox client does not support folder listing")

    def _files_list_folder_continue(self, cursor: str) -> Any:
        if hasattr(self._client, "files_list_folder_continue"):
            return self._client.files_list_folder_continue(cursor)
        raise RuntimeError("Dropbox client does not support cursor continuation")

    def _entry_from_dropbox_metadata(self, metadata: Any) -> ProviderEntry:
        source_key = getattr(metadata, "path_display", None) or getattr(metadata, "path_lower", None)
        if not source_key:
            raise ValueError("Dropbox metadata missing path")
        modified_time = getattr(metadata, "server_modified", None)
        if modified_time and isinstance(modified_time, str):
            modified_time = _parse_iso_datetime(modified_time)
        size = getattr(metadata, "size", None)
        try:
            size = int(size) if size is not None else None
        except Exception:
            size = None
        return ProviderEntry(
            provider=self.provider_name,
            source_key=source_key,
            file_id=getattr(metadata, "id", None),
            display_path=getattr(metadata, "path_display", None),
            name=getattr(metadata, "name", source_key.rsplit("/", 1)[-1]),
            modified_time=modified_time,
            size=size,
            content_hash=getattr(metadata, "content_hash", None),
            revision=getattr(metadata, "rev", None),
            mime_type=mimetypes.guess_type(getattr(metadata, "name", source_key.rsplit("/", 1)[-1]))[0],
        )

    def list_image_entries(self, sync_folders: Optional[Sequence[str]] = None) -> list[ProviderEntry]:
        from dropbox.files import FileMetadata

        folders = [folder for folder in (sync_folders or []) if isinstance(folder, str)]
        if not folders:
            folders = [""]

        entries: list[ProviderEntry] = []
        for folder in folders:
            result = self._files_list_folder(folder, recursive=True)
            for metadata in getattr(result, "entries", []) or []:
                if isinstance(metadata, FileMetadata):
                    entries.append(self._entry_from_dropbox_metadata(metadata))

            # Preserve existing behavior: avoid paginating root sync by default.
            should_paginate = bool(folder)
            while should_paginate and getattr(result, "has_more", False):
                result = self._files_list_folder_continue(result.cursor)
                for metadata in getattr(result, "entries", []) or []:
                    if isinstance(metadata, FileMetadata):
                        entries.append(self._entry_from_dropbox_metadata(metadata))

        entries.sort(key=lambda item: item.modified_time or datetime.min, reverse=True)
        return entries

    def get_entry(self, source_key: str) -> ProviderEntry:
        metadata = self._get_metadata(source_key, include_media_info=False)
        return self._entry_from_dropbox_metadata(metadata)

    def get_media_metadata(self, source_key: str) -> ProviderMediaMetadata:
        metadata = self._get_metadata(source_key, include_media_info=True)
        exif_overrides: Dict[str, Any] = {}
        provider_properties: Dict[str, Any] = {}

        media_info_union = getattr(metadata, "media_info", None)
        if media_info_union is not None:
            try:
                media_info = media_info_union.get_metadata()
            except Exception:
                media_info = None
            if media_info is not None:
                dimensions = getattr(media_info, "dimensions", None)
                if dimensions is not None:
                    width = getattr(dimensions, "width", None)
                    height = getattr(dimensions, "height", None)
                    if width is not None:
                        exif_overrides["ImageWidth"] = width
                    if height is not None:
                        exif_overrides["ImageLength"] = height
                location = getattr(media_info, "location", None)
                if location is not None:
                    lat = getattr(location, "latitude", None)
                    lon = getattr(location, "longitude", None)
                    if lat is not None:
                        exif_overrides["GPSLatitude"] = lat
                    if lon is not None:
                        exif_overrides["GPSLongitude"] = lon
                time_taken = getattr(media_info, "time_taken", None)
                if time_taken is not None:
                    if isinstance(time_taken, datetime):
                        time_value = time_taken.isoformat()
                    else:
                        time_value = str(time_taken)
                    exif_overrides["DateTimeOriginal"] = time_value
                    exif_overrides["DateTime"] = time_value
                duration_value = getattr(media_info, "duration", None)
                duration_ms = _coerce_duration_to_ms(duration_value, assume_ms=True)
                if duration_ms is not None:
                    provider_properties["media.duration_ms"] = duration_ms

        for group in getattr(metadata, "property_groups", []) or []:
            template_name = getattr(group, "template_id", "")
            for field in getattr(group, "fields", []) or []:
                key = f"{template_name}.{getattr(field, 'name', '')}".strip(".")
                value = getattr(field, "value", None)
                if key:
                    provider_properties[key] = value

        return ProviderMediaMetadata(
            exif_overrides=exif_overrides,
            provider_properties=provider_properties,
        )

    def download_file(self, source_key: str) -> bytes:
        if hasattr(self._client, "files_download"):
            _, response = self._client.files_download(source_key)
            return response.content
        if hasattr(self._client, "download_file"):
            return self._client.download_file(source_key)
        raise RuntimeError("Dropbox client does not support file download")

    def get_thumbnail(self, source_key: str, size: str = "w640h480") -> Optional[bytes]:
        if hasattr(self._client, "get_thumbnail"):
            return self._client.get_thumbnail(source_key, size=size)
        if hasattr(self._client, "files_get_thumbnail_v2"):
            from dropbox.files import ThumbnailSize

            target_size = getattr(ThumbnailSize, size, None)
            if target_size is None:
                return None
            _, response = self._client.files_get_thumbnail_v2(source_key, size=target_size)
            return response.content
        return None

    def get_playback_url(self, source_key: str, expires_seconds: int = 300) -> Optional[str]:
        _ = expires_seconds  # Dropbox temporary link TTL is provider-controlled.
        if hasattr(self._client, "files_get_temporary_link"):
            result = self._client.files_get_temporary_link(source_key)
            return str(getattr(result, "link", "") or "").strip() or None
        if hasattr(self._client, "get_temporary_link"):
            value = self._client.get_temporary_link(source_key)
            return str(value or "").strip() or None
        return None

    def resolve_source_key(self, source_key: Optional[str], image: Any = None) -> Optional[str]:
        dropbox_ref = super().resolve_source_key(source_key, image=image)
        if dropbox_ref:
            return dropbox_ref

        if image is None:
            return None

        legacy_path = (getattr(image, "dropbox_path", None) or "").strip()
        legacy_id = (getattr(image, "dropbox_id", None) or "").strip()
        if legacy_path and not legacy_path.startswith("/local/"):
            return legacy_path
        if legacy_id and not legacy_id.startswith("local_"):
            return legacy_id if legacy_id.startswith("id:") else f"id:{legacy_id}"
        return None

    def _get_metadata(self, source_key: str, include_media_info: bool) -> Any:
        if hasattr(self._client, "get_metadata_with_media_info") and include_media_info:
            return self._client.get_metadata_with_media_info(source_key)
        if hasattr(self._client, "get_metadata") and not include_media_info:
            return self._client.get_metadata(source_key)

        if not hasattr(self._client, "files_get_metadata"):
            raise RuntimeError("Dropbox client does not support metadata reads")

        kwargs: Dict[str, Any] = {"include_media_info": include_media_info}
        if include_media_info:
            try:
                from dropbox.files import IncludePropertyGroups

                kwargs["include_property_groups"] = IncludePropertyGroups.filter_some([])
            except Exception:
                pass
        return self._client.files_get_metadata(source_key, **kwargs)


class GoogleDriveStorageProvider(StorageProvider):
    """Google Drive-backed storage provider (OAuth refresh-token flow)."""

    provider_name = "gdrive"

    _drive_base_url = "https://www.googleapis.com/drive/v3"
    _token_url = "https://oauth2.googleapis.com/token"

    def __init__(self, *, client_id: str, client_secret: str, refresh_token: str):
        if not client_id or not client_secret or not refresh_token:
            raise ValueError("GoogleDriveStorageProvider requires client_id, client_secret, and refresh_token")
        self._client_id = client_id
        self._client_secret = client_secret
        self._refresh_token = refresh_token
        self._access_token: Optional[str] = None
        self._access_token_expires_at: Optional[datetime] = None

    def list_image_entries(self, sync_folders: Optional[Sequence[str]] = None) -> list[ProviderEntry]:
        folders = [folder.strip() for folder in (sync_folders or []) if isinstance(folder, str) and folder.strip()]
        media_query = "(mimeType contains 'image/' or mimeType contains 'video/')"
        if not folders:
            queries = [f"trashed = false and {media_query}"]
        else:
            queries = [
                f"'{folder}' in parents and trashed = false and {media_query}"
                for folder in folders
            ]

        deduped: Dict[str, ProviderEntry] = {}
        for query in queries:
            for item in self._list_files(query):
                deduped[item.source_key] = item

        entries = list(deduped.values())
        entries.sort(key=lambda item: item.modified_time or datetime.min, reverse=True)
        return entries

    def get_entry(self, source_key: str) -> ProviderEntry:
        file_obj = self._get_file(source_key)
        return self._entry_from_file(file_obj)

    def get_media_metadata(self, source_key: str) -> ProviderMediaMetadata:
        file_obj = self._get_file(source_key)

        exif_overrides: Dict[str, Any] = {}
        provider_properties: Dict[str, Any] = {}

        media = file_obj.get("imageMediaMetadata") or {}
        video_media = file_obj.get("videoMediaMetadata") or {}
        width = media.get("width")
        height = media.get("height")
        if width is None:
            width = video_media.get("width")
        if height is None:
            height = video_media.get("height")
        if width is not None:
            exif_overrides["ImageWidth"] = width
        if height is not None:
            exif_overrides["ImageLength"] = height

        timestamp = media.get("time")
        if timestamp:
            exif_overrides["DateTimeOriginal"] = timestamp
            exif_overrides["DateTime"] = timestamp
        duration_ms = _coerce_duration_to_ms(video_media.get("durationMillis"), assume_ms=True)
        if duration_ms is not None:
            provider_properties["media.duration_ms"] = duration_ms

        location = media.get("location") or {}
        latitude = location.get("latitude")
        longitude = location.get("longitude")
        if latitude is not None:
            exif_overrides["GPSLatitude"] = latitude
        if longitude is not None:
            exif_overrides["GPSLongitude"] = longitude

        app_props = file_obj.get("appProperties") or {}
        for key, value in app_props.items():
            provider_properties[f"app.{key}"] = value
        props = file_obj.get("properties") or {}
        for key, value in props.items():
            provider_properties[f"file.{key}"] = value

        return ProviderMediaMetadata(
            exif_overrides=exif_overrides,
            provider_properties=provider_properties,
        )

    def download_file(self, source_key: str) -> bytes:
        response = self._request(
            "GET",
            f"/files/{source_key}",
            params={
                "alt": "media",
                "supportsAllDrives": "true",
            },
            timeout=120,
        )
        return response.content

    def get_thumbnail(self, source_key: str, size: str = "w640h480") -> Optional[bytes]:
        _ = size
        # Drive does not expose a stable equivalent to Dropbox thumbnail size controls.
        return None

    def resolve_source_key(self, source_key: Optional[str], image: Any = None) -> Optional[str]:
        value = (source_key or "").strip()
        if not value:
            return None
        if value.startswith("/local/"):
            return None
        return value

    def _list_files(self, query: str) -> list[ProviderEntry]:
        entries: list[ProviderEntry] = []
        next_page_token: Optional[str] = None

        while True:
            params = {
                "q": query,
                "fields": (
                    "nextPageToken,files("
                    "id,name,mimeType,size,md5Checksum,modifiedTime,createdTime,version,"
                    "imageMediaMetadata(width,height,time,location),"
                    "videoMediaMetadata(width,height,durationMillis),"
                    "appProperties,properties"
                    ")"
                ),
                "orderBy": "modifiedTime desc",
                "pageSize": "1000",
                "includeItemsFromAllDrives": "true",
                "supportsAllDrives": "true",
            }
            if next_page_token:
                params["pageToken"] = next_page_token

            response = self._request("GET", "/files", params=params)
            payload = response.json()
            for item in payload.get("files", []) or []:
                entries.append(self._entry_from_file(item))

            next_page_token = payload.get("nextPageToken")
            if not next_page_token:
                break

        return entries

    def _get_file(self, source_key: str) -> Dict[str, Any]:
        response = self._request(
            "GET",
            f"/files/{source_key}",
            params={
                "fields": (
                    "id,name,mimeType,size,md5Checksum,modifiedTime,createdTime,version,"
                    "imageMediaMetadata(width,height,time,location),"
                    "videoMediaMetadata(width,height,durationMillis),"
                    "appProperties,properties"
                ),
                "supportsAllDrives": "true",
            },
        )
        return response.json()

    def _entry_from_file(self, item: Dict[str, Any]) -> ProviderEntry:
        modified_time = _parse_iso_datetime(item.get("modifiedTime"))
        size = item.get("size")
        try:
            size = int(size) if size is not None else None
        except Exception:
            size = None
        version = item.get("version")
        return ProviderEntry(
            provider=self.provider_name,
            source_key=item.get("id") or "",
            file_id=item.get("id"),
            display_path=item.get("name"),
            name=item.get("name") or (item.get("id") or "unknown"),
            modified_time=modified_time,
            size=size,
            content_hash=item.get("md5Checksum"),
            revision=str(version) if version is not None else None,
            mime_type=item.get("mimeType"),
        )

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, str]] = None,
        timeout: int = 60,
    ) -> httpx.Response:
        access_token = self._get_access_token()
        headers = {"Authorization": f"Bearer {access_token}"}
        with httpx.Client(timeout=timeout) as client:
            response = client.request(
                method,
                f"{self._drive_base_url}{path}",
                headers=headers,
                params=params,
            )
        if response.status_code >= 400:
            detail = response.text
            raise RuntimeError(
                f"Google Drive API error {response.status_code} for {path}: {detail}"
            )
        return response

    def _get_access_token(self) -> str:
        if self._access_token and self._access_token_expires_at:
            if datetime.utcnow() + timedelta(seconds=30) < self._access_token_expires_at:
                return self._access_token

        with httpx.Client(timeout=30) as client:
            response = client.post(
                self._token_url,
                data={
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "refresh_token": self._refresh_token,
                    "grant_type": "refresh_token",
                },
            )

        if response.status_code >= 400:
            raise RuntimeError(f"Failed to refresh Google Drive access token: {response.text}")

        payload = response.json()
        access_token = payload.get("access_token")
        expires_in = int(payload.get("expires_in") or 3600)
        if not access_token:
            raise RuntimeError("Google Drive token response missing access_token")

        self._access_token = access_token
        self._access_token_expires_at = datetime.utcnow() + timedelta(seconds=expires_in)
        return access_token


class ManagedStorageProvider(StorageProvider):
    """Zoltag-managed objects stored directly in tenant GCS bucket."""

    provider_name = "managed"

    def __init__(self, *, bucket_name: str, project_id: Optional[str] = None, client: Optional[Any] = None):
        if not bucket_name:
            raise ValueError("ManagedStorageProvider requires a storage bucket name")

        if client is None:
            from google.cloud import storage

            client = storage.Client(project=project_id) if project_id else storage.Client()

        self._bucket = client.bucket(bucket_name)

    def list_image_entries(self, sync_folders: Optional[Sequence[str]] = None) -> list[ProviderEntry]:
        _ = sync_folders
        return []

    def get_entry(self, source_key: str) -> ProviderEntry:
        blob = self._bucket.blob(source_key)
        blob.reload()
        updated = blob.updated
        if updated is not None and updated.tzinfo is not None:
            updated = updated.astimezone(timezone.utc).replace(tzinfo=None)

        return ProviderEntry(
            provider=self.provider_name,
            source_key=source_key,
            file_id=str(blob.id) if blob.id is not None else None,
            display_path=source_key,
            name=source_key.rsplit("/", 1)[-1],
            modified_time=updated,
            size=int(blob.size) if blob.size is not None else None,
            content_hash=blob.md5_hash,
            revision=str(blob.generation) if blob.generation is not None else None,
            mime_type=blob.content_type,
        )

    def get_media_metadata(self, source_key: str) -> ProviderMediaMetadata:
        _ = source_key
        return ProviderMediaMetadata(exif_overrides={}, provider_properties={})

    def download_file(self, source_key: str) -> bytes:
        blob = self._bucket.blob(source_key)
        return blob.download_as_bytes()

    def get_thumbnail(self, source_key: str, size: str = "w640h480") -> Optional[bytes]:
        _ = source_key
        _ = size
        return None

    def get_playback_url(self, source_key: str, expires_seconds: int = 300) -> Optional[str]:
        blob = self._bucket.blob(source_key)
        ttl_seconds = max(60, int(expires_seconds or 300))
        try:
            return blob.generate_signed_url(
                version="v4",
                expiration=timedelta(seconds=ttl_seconds),
                method="GET",
            )
        except Exception:
            return None


def create_storage_provider(
    provider_name: str,
    *,
    tenant: Any,
    get_secret: Callable[[str], str],
) -> StorageProvider:
    """Instantiate a storage provider for a tenant."""

    normalized = (provider_name or "dropbox").strip().lower()
    if normalized in {"dropbox", "dbx"}:
        token_secret = getattr(tenant, "dropbox_token_secret", None)
        if not token_secret:
            raise ValueError("Dropbox secrets not configured for tenant")

        refresh_token = str(get_secret(token_secret) or "").strip()
        if not refresh_token:
            raise ValueError("Dropbox refresh token is not configured for tenant")

        try:
            managed_app_key = str(get_secret(settings.dropbox_app_key_secret) or "").strip()
            managed_app_secret = str(get_secret(settings.dropbox_app_secret_secret) or "").strip()
        except Exception:
            managed_app_key = ""
            managed_app_secret = ""

        if not managed_app_key or not managed_app_secret:
            raise ValueError("Managed Dropbox OAuth credentials are not configured")

        return DropboxStorageProvider(
            refresh_token=refresh_token,
            app_key=managed_app_key,
            app_secret=managed_app_secret,
        )

    if normalized in {"gdrive", "google-drive", "google_drive", "drive"}:
        client_id = getattr(tenant, "gdrive_client_id", None)
        token_secret = getattr(tenant, "gdrive_token_secret", None)
        client_secret_name = getattr(tenant, "gdrive_client_secret", None)
        if not client_id:
            raise ValueError("Google Drive client ID not configured for tenant")
        if not token_secret or not client_secret_name:
            raise ValueError("Google Drive secrets not configured for tenant")
        refresh_token = get_secret(token_secret)
        client_secret = get_secret(client_secret_name)
        return GoogleDriveStorageProvider(
            client_id=client_id,
            client_secret=client_secret,
            refresh_token=refresh_token,
        )

    if normalized in {"managed"}:
        bucket_name = tenant.get_storage_bucket(settings)
        return ManagedStorageProvider(
            bucket_name=bucket_name,
            project_id=settings.gcp_project_id,
        )

    raise ValueError(f"Unsupported storage provider: {provider_name}")

def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value or not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None
    if parsed.tzinfo is not None:
        return parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _coerce_duration_to_ms(value: Any, *, assume_ms: bool = False) -> Optional[int]:
    try:
        if value is None:
            return None
        if hasattr(value, "total_seconds"):
            return int(round(float(value.total_seconds()) * 1000))
        numeric = float(value)
        if numeric < 0:
            return None
        if assume_ms:
            return int(round(numeric))
        return int(round(numeric * 1000))
    except Exception:
        return None
