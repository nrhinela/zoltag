"""Shared storage-provider ingestion pipeline for web and CLI sync."""

from __future__ import annotations

from dataclasses import dataclass
import mimetypes
from datetime import datetime
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
from photocat.storage import (
    DropboxStorageProvider,
    ProviderEntry,
    StorageProvider,
)
from photocat.tenant import Tenant


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


def _entry_from_dropbox_raw(entry: Any) -> ProviderEntry:
    source_key = getattr(entry, "path_display", None) or getattr(entry, "path_lower", None)
    if not source_key:
        raise ValueError("Dropbox entry is missing path metadata")
    modified_time = getattr(entry, "server_modified", None)
    if isinstance(modified_time, str):
        try:
            modified_time = datetime.fromisoformat(modified_time.replace("Z", "+00:00"))
        except Exception:
            modified_time = None
    return ProviderEntry(
        provider="dropbox",
        source_key=source_key,
        file_id=getattr(entry, "id", None),
        display_path=getattr(entry, "path_display", None),
        name=getattr(entry, "name", source_key.rsplit("/", 1)[-1]),
        modified_time=modified_time,
        size=getattr(entry, "size", None),
        content_hash=getattr(entry, "content_hash", None),
        revision=getattr(entry, "rev", None),
        mime_type=None,
    )


def process_storage_entry(
    *,
    db: Session,
    tenant: Tenant,
    entry: ProviderEntry,
    provider: StorageProvider,
    thumbnail_bucket: Any,
    keywords_by_category: Optional[Dict[str, list[dict]]] = None,
    keyword_to_category: Optional[Dict[str, str]] = None,
    model_type: str = "siglip",
    keyword_models: Optional[Dict[str, Any]] = None,
    reprocess_existing: bool = False,
    log: Optional[Callable[[str], None]] = None,
) -> ProcessResult:
    """Process a provider entry into Asset + ImageMetadata."""
    _ = keywords_by_category
    _ = keyword_to_category
    _ = model_type
    _ = keyword_models

    processor = ImageProcessor()
    provider_exif: Dict[str, Any] = {}
    provider_props: Dict[str, Any] = {}

    try:
        media_metadata = provider.get_media_metadata(entry.source_key)
        provider_exif = dict(media_metadata.exif_overrides or {})
        provider_props = dict(media_metadata.provider_properties or {})
    except Exception as exc:
        _log(log, f"[Sync] {provider.provider_name} metadata lookup failed: {exc}")

    image_data = None
    used_full_download = False
    if not entry.name.lower().endswith((".heic", ".heif")):
        try:
            image_data = provider.get_thumbnail(entry.source_key, size="w640h480")
        except Exception as exc:
            _log(log, f"[Sync] Thumbnail download failed: {exc}")

    if image_data is None:
        image_data = provider.download_file(entry.source_key)
        used_full_download = True

    features = processor.extract_features(image_data)
    exif = features.get("exif", {}) or {}
    exif.update(provider_exif)

    capture_timestamp = parse_exif_datetime(
        get_exif_value(exif, "DateTimeOriginal", "DateTime")
    )
    if capture_timestamp is None and not used_full_download:
        try:
            full_data = provider.download_file(entry.source_key)
            used_full_download = True
            full_features = processor.extract_features(full_data)
            full_exif = full_features.get("exif", {}) or {}
            if full_exif:
                full_exif.update(provider_exif)
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
            Asset.source_provider == provider.provider_name,
            Asset.source_key == entry.source_key,
        )
        .order_by(ImageMetadata.id.asc())
        .first()
    )
    if existing and not reprocess_existing:
        return ProcessResult(status="skipped", image_id=existing.id)

    guessed_mime_type = entry.mime_type or mimetypes.guess_type(entry.name)[0]
    mime_type = guessed_mime_type
    if not mime_type and features.get("format"):
        mime_type = f"image/{str(features.get('format')).lower()}"

    asset = (
        db.query(Asset)
        .filter(
            Asset.tenant_id == tenant.id,
            Asset.source_provider == provider.provider_name,
            Asset.source_key == entry.source_key,
        )
        .order_by(Asset.created_at.asc(), Asset.id.asc())
        .first()
    )
    if asset is None:
        asset = Asset(
            tenant_id=tenant.id,
            filename=entry.name,
            source_provider=provider.provider_name,
            source_key=entry.source_key,
            source_rev=entry.revision,
            thumbnail_key=f"legacy:{tenant.id}:{entry.source_key}:thumbnail",
            mime_type=mime_type,
            width=features.get("width"),
            height=features.get("height"),
            duration_ms=None,
        )
        db.add(asset)
        db.flush()
    else:
        asset.filename = entry.name or asset.filename
        if entry.revision:
            asset.source_rev = entry.revision
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
    metadata.filename = entry.name
    metadata.file_size = entry.size
    metadata.content_hash = entry.content_hash
    metadata.modified_time = entry.modified_time
    metadata.width = features.get("width")
    metadata.height = features.get("height")
    metadata.format = features.get("format")
    metadata.perceptual_hash = features.get("perceptual_hash")
    metadata.color_histogram = features.get("color_histogram")
    metadata.exif_data = exif
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
    metadata.embedding_generated = False
    metadata.faces_detected = False
    metadata.tags_applied = False

    if provider.provider_name == "dropbox":
        if hasattr(ImageMetadata, "dropbox_path"):
            legacy_dropbox_path = getattr(metadata, "dropbox_path", None)
            if settings.asset_write_legacy_fields or not legacy_dropbox_path:
                setattr(metadata, "dropbox_path", entry.display_path or entry.source_key)
        if hasattr(ImageMetadata, "dropbox_id") and entry.file_id:
            setattr(metadata, "dropbox_id", entry.file_id)
        metadata.dropbox_properties = provider_props or None
    else:
        metadata.dropbox_properties = None

    if settings.asset_write_legacy_fields and hasattr(ImageMetadata, "thumbnail_path"):
        setattr(metadata, "thumbnail_path", thumbnail_key)

    if existing is None:
        db.add(metadata)
    db.commit()
    db.refresh(metadata)

    return ProcessResult(
        status="processed",
        image_id=metadata.id,
        width=features.get("width"),
        height=features.get("height"),
        capture_timestamp=capture_timestamp,
        used_full_download=used_full_download,
    )


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
    """Backward-compatible Dropbox wrapper for existing callers."""
    provider = DropboxStorageProvider(client=dropbox_client)
    normalized_entry = _entry_from_dropbox_raw(entry)
    return process_storage_entry(
        db=db,
        tenant=tenant,
        entry=normalized_entry,
        provider=provider,
        thumbnail_bucket=thumbnail_bucket,
        keywords_by_category=keywords_by_category,
        keyword_to_category=keyword_to_category,
        model_type=model_type,
        keyword_models=keyword_models,
        reprocess_existing=reprocess_existing,
        log=log,
    )
