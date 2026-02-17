"""Shared storage-provider ingestion pipeline for web and CLI sync."""

from __future__ import annotations

from dataclasses import dataclass
import mimetypes
from datetime import datetime
from typing import Any, Callable, Dict, Optional

from sqlalchemy.orm import Session

from zoltag.exif import (
    get_exif_value,
    parse_exif_datetime,
    parse_exif_float,
    parse_exif_int,
    parse_exif_str,
)
from zoltag.image import ImageProcessor, VideoProcessor, is_supported_video_file
from zoltag.metadata import Asset, ImageMetadata
from zoltag.settings import settings
from zoltag.storage import (
    DropboxStorageProvider,
    ProviderEntry,
    StorageProvider,
)
from zoltag.tenant import Tenant
from zoltag.tenant_scope import assign_tenant_scope, tenant_column_filter


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


MAX_VIDEO_THUMBNAIL_DOWNLOAD_BYTES = 250 * 1024 * 1024


def _log(log: Optional[Callable[[str], None]], message: str) -> None:
    if log:
        log(message)


def _to_int(value: Any) -> Optional[int]:
    try:
        if value is None:
            return None
        return int(float(value))
    except Exception:
        return None


def _duration_to_ms(value: Any, *, assume_ms: bool = False) -> Optional[int]:
    try:
        if value is None:
            return None
        numeric = float(value)
        if numeric < 0:
            return None
        if assume_ms:
            return int(round(numeric))
        return int(round(numeric * 1000))
    except Exception:
        return None


def _extract_provider_duration_ms(provider_props: Dict[str, Any]) -> Optional[int]:
    ms_keys = (
        "media.duration_ms",
        "video.duration_ms",
        "video.durationMillis",
        "duration_ms",
        "durationMillis",
    )
    sec_keys = (
        "media.duration",
        "video.duration",
        "duration",
    )

    for key in ms_keys:
        value = _duration_to_ms(provider_props.get(key), assume_ms=True)
        if value is not None:
            return value
    for key in sec_keys:
        value = _duration_to_ms(provider_props.get(key), assume_ms=False)
        if value is not None:
            return value
    return None


def _infer_media_type(entry: ProviderEntry) -> str:
    if is_supported_video_file(entry.name or "", mime_type=entry.mime_type):
        return "video"
    return "image"


def _infer_format_from_name(name: str) -> Optional[str]:
    filename = str(name or "").strip()
    if "." not in filename:
        return None
    ext = filename.rsplit(".", 1)[-1].strip().upper()
    return ext or None


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
        mime_type=mimetypes.guess_type(getattr(entry, "name", source_key.rsplit("/", 1)[-1]))[0],
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
    video_processor = VideoProcessor(thumbnail_size=(settings.thumbnail_size, settings.thumbnail_size))
    media_type = _infer_media_type(entry)
    provider_exif: Dict[str, Any] = {}
    provider_props: Dict[str, Any] = {}

    try:
        media_metadata = provider.get_media_metadata(entry.source_key)
        provider_exif = dict(media_metadata.exif_overrides or {})
        provider_props = dict(media_metadata.provider_properties or {})
    except Exception as exc:
        _log(log, f"[Sync] {provider.provider_name} metadata lookup failed: {exc}")

    used_full_download = False
    duration_ms = _extract_provider_duration_ms(provider_props) if media_type == "video" else None

    if media_type == "video":
        thumbnail_data = None
        thumb_features = None
        width = parse_exif_int(get_exif_value(provider_exif, "ImageWidth", "VideoWidth"))
        height = parse_exif_int(get_exif_value(provider_exif, "ImageLength", "VideoHeight"))

        try:
            thumbnail_data = provider.get_thumbnail(entry.source_key, size="w640h480")
        except Exception as exc:
            _log(log, f"[Sync] Video thumbnail request failed: {exc}")

        if thumbnail_data:
            try:
                thumb_features = processor.extract_features(thumbnail_data)
            except Exception as exc:
                _log(log, f"[Sync] Video thumbnail parse failed: {exc}")
                thumb_features = None

        features = {
            "thumbnail": thumb_features.get("thumbnail") if thumb_features else None,
            "width": width or (thumb_features.get("width") if thumb_features else None),
            "height": height or (thumb_features.get("height") if thumb_features else None),
            "format": _infer_format_from_name(entry.name),
            "perceptual_hash": thumb_features.get("perceptual_hash") if thumb_features else None,
            "color_histogram": thumb_features.get("color_histogram") if thumb_features else None,
            "exif": dict(provider_exif or {}),
        }

        if features["thumbnail"] is None:
            entry_size = _to_int(entry.size)
            should_download = entry_size is None or entry_size <= MAX_VIDEO_THUMBNAIL_DOWNLOAD_BYTES
            if should_download:
                try:
                    video_data = provider.download_file(entry.source_key)
                    used_full_download = True
                    video_features = video_processor.extract_features(video_data, filename=entry.name)
                    features["thumbnail"] = video_features.get("thumbnail")
                    features["width"] = features.get("width") or video_features.get("width")
                    features["height"] = features.get("height") or video_features.get("height")
                    features["format"] = features.get("format") or video_features.get("format")
                    duration_ms = duration_ms or video_features.get("duration_ms")
                except Exception as exc:
                    _log(log, f"[Sync] Video frame extraction failed: {exc}")
            else:
                _log(
                    log,
                    f"[Sync] Skipping full video download for thumbnail (size={entry_size} bytes, limit={MAX_VIDEO_THUMBNAIL_DOWNLOAD_BYTES}).",
                )

        if features["thumbnail"] is None:
            features["thumbnail"] = video_processor.create_placeholder_thumbnail()

        exif = features.get("exif", {}) or {}
        capture_timestamp = parse_exif_datetime(get_exif_value(exif, "DateTimeOriginal", "DateTime"))
    else:
        image_data = None
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
            tenant_column_filter(ImageMetadata, tenant),
            tenant_column_filter(Asset, tenant),
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
        mime_type = f"{media_type}/{str(features.get('format')).lower()}"

    asset = (
        db.query(Asset)
        .filter(
            tenant_column_filter(Asset, tenant),
            Asset.source_provider == provider.provider_name,
            Asset.source_key == entry.source_key,
        )
        .order_by(Asset.created_at.asc(), Asset.id.asc())
        .first()
    )
    if asset is None:
        asset = assign_tenant_scope(Asset(
            filename=entry.name,
            source_provider=provider.provider_name,
            source_key=entry.source_key,
            source_rev=entry.revision,
            thumbnail_key=f"legacy:{tenant.secret_scope}:{entry.source_key}:thumbnail",
            media_type=media_type,
            mime_type=mime_type,
            width=features.get("width"),
            height=features.get("height"),
            duration_ms=duration_ms if media_type == "video" else None,
        ), tenant)
        db.add(asset)
        db.flush()
    else:
        asset.filename = entry.name or asset.filename
        if getattr(asset, "media_type", None) != media_type:
            asset.media_type = media_type
        if entry.revision:
            asset.source_rev = entry.revision
        if asset.mime_type is None:
            asset.mime_type = mime_type
        if asset.width is None:
            asset.width = features.get("width")
        if asset.height is None:
            asset.height = features.get("height")
        if media_type == "video" and duration_ms is not None:
            current_duration = _to_int(getattr(asset, "duration_ms", None))
            if current_duration is None or abs(current_duration - duration_ms) > 100:
                asset.duration_ms = duration_ms

    thumbnail_key = tenant.get_asset_thumbnail_key(str(asset.id), "default-256.jpg")
    blob = thumbnail_bucket.blob(thumbnail_key)
    blob.cache_control = "public, max-age=31536000, immutable"
    blob.upload_from_string(features["thumbnail"], content_type="image/jpeg")
    asset.thumbnail_key = thumbnail_key

    metadata = existing or assign_tenant_scope(ImageMetadata(), tenant)
    metadata.asset_id = asset.id
    assign_tenant_scope(metadata, tenant)
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
