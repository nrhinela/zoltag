"""Shared Dropbox ingestion pipeline for web and CLI sync."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import mimetypes
from typing import Any, Callable, Dict, Optional

from sqlalchemy.orm import Session

from photocat.exif import (
    get_exif_value,
    parse_exif_datetime,
    parse_exif_float,
    parse_exif_int,
    parse_exif_str,
)
from photocat.image import ImageProcessor
from photocat.metadata import Asset, ImageMetadata
from photocat.settings import settings
from photocat.tenant import Tenant


class DropboxAdapter:
    """Adapter for Dropbox SDK or client wrappers."""

    def __init__(self, client: Any):
        self._client = client

    def get_metadata_with_media_info(self, path: str) -> Any:
        if hasattr(self._client, "get_metadata_with_media_info"):
            return self._client.get_metadata_with_media_info(path)
        kwargs: Dict[str, Any] = {"include_media_info": True}
        try:
            from dropbox.files import IncludePropertyGroups
            kwargs["include_property_groups"] = IncludePropertyGroups.filter_some([])
        except Exception:
            pass
        return self._client.files_get_metadata(path, **kwargs)

    def get_thumbnail(self, path: str, size: str = "w640h480") -> Optional[bytes]:
        if hasattr(self._client, "get_thumbnail"):
            return self._client.get_thumbnail(path, size=size)
        if hasattr(self._client, "files_get_thumbnail_v2"):
            from dropbox.files import ThumbnailSize
            target_size = getattr(ThumbnailSize, size, None)
            if target_size is None:
                raise ValueError(f"Unsupported thumbnail size: {size}")
            metadata, response = self._client.files_get_thumbnail_v2(path, size=target_size)
            return response.content
        from dropbox.files import ThumbnailFormat, ThumbnailSize
        metadata, response = self._client.files_get_thumbnail(
            path=path,
            format=ThumbnailFormat.jpeg,
            size=ThumbnailSize.w640h480,
        )
        return response.content

    def download_file(self, path: str) -> bytes:
        if hasattr(self._client, "download_file"):
            return self._client.download_file(path)
        metadata, response = self._client.files_download(path)
        return response.content


@dataclass
class ProcessResult:
    status: str
    image_id: Optional[int] = None
    tags_count: int = 0
    trained_tags_count: int = 0
    width: Optional[int] = None
    height: Optional[int] = None
    capture_timestamp: Optional[datetime] = None
    used_full_download: bool = False


def _log(log: Optional[Callable[[str], None]], message: str) -> None:
    if log:
        log(message)


def process_dropbox_entry(
    *,
    db: Session,
    tenant: Tenant,
    entry: Any,
    dropbox_client: Any,
    thumbnail_bucket: Any,
    keywords_by_category: Optional[Dict[str, list[dict]]] = None,
    keyword_to_category: Optional[Dict[str, str]] = None,
    model_type: str = "siglip",
    keyword_models: Optional[Dict[str, Any]] = None,
    reprocess_existing: bool = False,
    log: Optional[Callable[[str], None]] = None,
) -> ProcessResult:
    """Process a Dropbox FileMetadata entry into Asset + ImageMetadata."""
    adapter = DropboxAdapter(dropbox_client)
    processor = ImageProcessor()
    dropbox_exif: Dict[str, Any] = {}
    dropbox_props: Dict[str, Any] = {}

    try:
        metadata_result = adapter.get_metadata_with_media_info(entry.path_display)
        if hasattr(metadata_result, "media_info") and metadata_result.media_info:
            media_info = metadata_result.media_info.get_metadata()
            _log(log, f"[Sync] Media info type: {type(media_info).__name__}")
            _log(log, f"[Sync] Media info time_taken present: {hasattr(media_info, 'time_taken')}")
            if hasattr(media_info, "dimensions") and media_info.dimensions:
                dropbox_exif["ImageWidth"] = media_info.dimensions.width
                dropbox_exif["ImageLength"] = media_info.dimensions.height
            if hasattr(media_info, "location") and media_info.location:
                dropbox_exif["GPSLatitude"] = media_info.location.latitude
                dropbox_exif["GPSLongitude"] = media_info.location.longitude
            if hasattr(media_info, "time_taken") and media_info.time_taken:
                dropbox_exif["DateTimeOriginal"] = media_info.time_taken.isoformat()
                dropbox_exif["DateTime"] = media_info.time_taken.isoformat()
            else:
                _log(log, "[Sync] Time taken not available on media_info")
        if hasattr(metadata_result, "property_groups") and metadata_result.property_groups:
            for prop_group in metadata_result.property_groups:
                template_name = prop_group.template_id
                for field in prop_group.fields:
                    dropbox_props[f"{template_name}.{field.name}"] = field.value
    except Exception as exc:
        _log(log, f"[Sync] Dropbox metadata lookup failed: {exc}")

    image_data = None
    used_full_download = False
    if not entry.name.lower().endswith((".heic", ".heif")):
        try:
            image_data = adapter.get_thumbnail(entry.path_display, size="w640h480")
        except Exception as exc:
            _log(log, f"[Sync] Thumbnail download failed: {exc}")

    if image_data is None:
        image_data = adapter.download_file(entry.path_display)
        used_full_download = True

    features = processor.extract_features(image_data)
    exif = features.get("exif", {}) or {}
    exif.update(dropbox_exif)

    capture_timestamp = parse_exif_datetime(
        get_exif_value(exif, "DateTimeOriginal", "DateTime")
    )
    if capture_timestamp is None and not used_full_download:
        try:
            full_data = adapter.download_file(entry.path_display)
            used_full_download = True
            full_features = processor.extract_features(full_data)
            full_exif = full_features.get("exif", {}) or {}
            if full_exif:
                full_exif.update(dropbox_exif)
                exif = full_exif
                capture_timestamp = parse_exif_datetime(
                    get_exif_value(exif, "DateTimeOriginal", "DateTime")
                )
        except Exception as exc:
            _log(log, f"[Sync] Full EXIF download failed: {exc}")

    gps_latitude = parse_exif_float(get_exif_value(exif, "GPSLatitude"))
    gps_longitude = parse_exif_float(get_exif_value(exif, "GPSLongitude"))
    iso = parse_exif_int(get_exif_value(exif, "ISOSpeedRatings", "ISOSpeed", "ISO"))
    aperture = parse_exif_float(get_exif_value(exif, "FNumber", "ApertureValue"))
    shutter_speed = parse_exif_str(get_exif_value(exif, "ExposureTime", "ShutterSpeedValue"))
    focal_length = parse_exif_float(get_exif_value(exif, "FocalLength"))
    camera_make = parse_exif_str(get_exif_value(exif, "Make"))
    camera_model = parse_exif_str(get_exif_value(exif, "Model"))
    lens_model = parse_exif_str(get_exif_value(exif, "LensModel", "Lens"))

    existing = (
        db.query(ImageMetadata)
        .join(Asset, Asset.id == ImageMetadata.asset_id)
        .filter(
            ImageMetadata.tenant_id == tenant.id,
            Asset.tenant_id == tenant.id,
            Asset.source_provider == "dropbox",
            Asset.source_key == entry.path_display,
        )
        .order_by(ImageMetadata.id.asc())
        .first()
    )
    if existing and not reprocess_existing:
        return ProcessResult(status="skipped", image_id=existing.id)

    source_provider = "dropbox"
    source_key = entry.path_display
    source_rev = getattr(entry, "rev", None)
    guessed_mime_type = mimetypes.guess_type(entry.name)[0]
    mime_type = guessed_mime_type
    if not mime_type and features.get("format"):
        mime_type = f"image/{str(features.get('format')).lower()}"

    asset = (
        db.query(Asset)
        .filter(
            Asset.tenant_id == tenant.id,
            Asset.source_provider == source_provider,
            Asset.source_key == source_key,
        )
        .order_by(Asset.created_at.asc(), Asset.id.asc())
        .first()
    )
    if asset is None:
        asset = Asset(
            tenant_id=tenant.id,
            filename=entry.name,
            source_provider=source_provider,
            source_key=source_key,
            source_rev=source_rev,
            thumbnail_key=f"legacy:{tenant.id}:{entry.id}:thumbnail",
            mime_type=mime_type,
            width=features.get("width"),
            height=features.get("height"),
            duration_ms=None,
        )
        db.add(asset)
        db.flush()
    else:
        asset.filename = entry.name or asset.filename
        if source_rev:
            asset.source_rev = source_rev
        if asset.mime_type is None:
            asset.mime_type = mime_type
        if asset.width is None:
            asset.width = features.get("width")
        if asset.height is None:
            asset.height = features.get("height")

    thumbnail_key = tenant.get_asset_thumbnail_key(str(asset.id), "default-256.jpg")
    blob = thumbnail_bucket.blob(thumbnail_key)
    blob.cache_control = "public, max-age=31536000, immutable"
    blob.upload_from_string(features["thumbnail"], content_type="image/jpeg")
    asset.thumbnail_key = thumbnail_key

    metadata = existing or ImageMetadata(tenant_id=tenant.id)
    metadata.asset_id = asset.id
    metadata.tenant_id = tenant.id
    if hasattr(ImageMetadata, "dropbox_path"):
        legacy_dropbox_path = getattr(metadata, "dropbox_path", None)
        if settings.asset_write_legacy_fields or not legacy_dropbox_path:
            setattr(metadata, "dropbox_path", entry.path_display)
    if hasattr(ImageMetadata, "dropbox_id"):
        setattr(metadata, "dropbox_id", entry.id)
    metadata.filename = entry.name
    metadata.file_size = getattr(entry, "size", None)
    metadata.content_hash = getattr(entry, "content_hash", None)
    metadata.modified_time = getattr(entry, "server_modified", None)
    metadata.width = features.get("width")
    metadata.height = features.get("height")
    metadata.format = features.get("format")
    metadata.perceptual_hash = features.get("perceptual_hash")
    metadata.color_histogram = features.get("color_histogram")
    metadata.exif_data = exif
    metadata.dropbox_properties = dropbox_props or None
    metadata.camera_make = camera_make
    metadata.camera_model = camera_model
    metadata.lens_model = lens_model
    metadata.capture_timestamp = capture_timestamp
    metadata.gps_latitude = gps_latitude
    metadata.gps_longitude = gps_longitude
    metadata.iso = iso
    metadata.aperture = aperture
    metadata.shutter_speed = shutter_speed
    metadata.focal_length = focal_length
    if settings.asset_write_legacy_fields and hasattr(ImageMetadata, "thumbnail_path"):
        setattr(metadata, "thumbnail_path", thumbnail_key)
    metadata.embedding_generated = False
    metadata.faces_detected = False
    metadata.tags_applied = False
    if existing is None:
        db.add(metadata)
    db.commit()
    db.refresh(metadata)

    return ProcessResult(
        status="processed",
        image_id=metadata.id,
        tags_count=0,
        trained_tags_count=0,
        width=metadata.width,
        height=metadata.height,
        capture_timestamp=capture_timestamp,
        used_full_download=used_full_download
    )
