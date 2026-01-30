"""Shared Dropbox ingestion pipeline for web and CLI sync."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
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
from photocat.learning import (
    ensure_image_embedding,
    recompute_trained_tags_for_image,
    score_keywords_for_categories,
)
from photocat.metadata import ImageMetadata, MachineTag
from photocat.settings import settings
from photocat.tagging import get_tagger
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
    keywords_by_category: Dict[str, list[dict]],
    keyword_to_category: Dict[str, str],
    model_type: str,
    keyword_models: Optional[Dict[str, Any]] = None,
    log: Optional[Callable[[str], None]] = None,
) -> ProcessResult:
    """Process a Dropbox FileMetadata entry into ImageMetadata + tags."""
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

    existing = db.query(ImageMetadata).filter(
        ImageMetadata.tenant_id == tenant.id,
        ImageMetadata.dropbox_id == entry.id
    ).first()
    if existing:
        return ProcessResult(status="skipped", image_id=existing.id)

    # Use Dropbox file ID to ensure unique thumbnail paths
    # (prevents collisions when files have same name but different extensions)
    thumbnail_filename = f"{entry.id}_thumb.jpg"
    thumbnail_path = tenant.get_storage_path(thumbnail_filename, "thumbnails")
    blob = thumbnail_bucket.blob(thumbnail_path)
    blob.cache_control = "public, max-age=31536000, immutable"
    blob.upload_from_string(features["thumbnail"], content_type="image/jpeg")

    metadata = ImageMetadata(
        tenant_id=tenant.id,
        dropbox_path=entry.path_display,
        dropbox_id=entry.id,
        filename=entry.name,
        file_size=getattr(entry, "size", None),
        content_hash=getattr(entry, "content_hash", None),
        modified_time=getattr(entry, "server_modified", None),
        width=features.get("width"),
        height=features.get("height"),
        format=features.get("format"),
        perceptual_hash=features.get("perceptual_hash"),
        color_histogram=features.get("color_histogram"),
        exif_data=exif,
        dropbox_properties=dropbox_props or None,
        camera_make=camera_make,
        camera_model=camera_model,
        lens_model=lens_model,
        capture_timestamp=capture_timestamp,
        gps_latitude=gps_latitude,
        gps_longitude=gps_longitude,
        iso=iso,
        aperture=aperture,
        shutter_speed=shutter_speed,
        focal_length=focal_length,
        thumbnail_path=thumbnail_path,
        embedding_generated=False,
        faces_detected=False,
        tags_applied=False,
    )
    db.add(metadata)
    db.commit()
    db.refresh(metadata)

    tagger = get_tagger(model_type=model_type)
    model_name = getattr(tagger, "model_name", model_type)
    model_version = getattr(tagger, "model_version", model_name)

    db.query(MachineTag).filter(
        MachineTag.image_id == metadata.id,
        MachineTag.tag_type == 'siglip'
    ).delete()

    embedding_record = ensure_image_embedding(
        db,
        tenant.id,
        metadata.id,
        image_data,
        model_name,
        model_version
    )

    trained_tags = []
    if settings.use_keyword_models and keyword_models:
        _log(log, f"[Sync] Keyword-model: scoring {len(keyword_models)} models")
        trained_tags = recompute_trained_tags_for_image(
            db=db,
            tenant_id=tenant.id,
            image_id=metadata.id,
            image_data=image_data,
            keywords_by_category=keywords_by_category,
            keyword_models=keyword_models,
            keyword_to_category=keyword_to_category,
            model_name=model_name,
            model_version=model_version,
            model_type=model_type,
            threshold=settings.keyword_model_threshold,
            model_weight=settings.keyword_model_weight
        )
        _log(log, f"[Sync] Keyword-model: {len(trained_tags)} trained tags")

    _log(log, "[Sync] SigLIP: scoring categories")
    all_tags = score_keywords_for_categories(
        image_data=image_data,
        keywords_by_category=keywords_by_category,
        model_type=model_type,
        threshold=settings.keyword_model_threshold
    )
    _log(log, f"[Sync] SigLIP: {len(all_tags)} tags")

    from photocat.models.config import Keyword
    for keyword_str, confidence in all_tags:
        keyword_record = db.query(Keyword).filter(
            Keyword.tenant_id == tenant.id,
            Keyword.keyword == keyword_str
        ).first()
        if not keyword_record:
            continue
        db.add(MachineTag(
            image_id=metadata.id,
            tenant_id=tenant.id,
            keyword_id=keyword_record.id,
            confidence=confidence,
            tag_type='siglip',
            model_name=model_name,
            model_version=model_version
        ))

    metadata.tags_applied = len(all_tags) > 0
    db.commit()

    return ProcessResult(
        status="processed",
        image_id=metadata.id,
        tags_count=len(all_tags),
        trained_tags_count=len(trained_tags),
        width=metadata.width,
        height=metadata.height,
        capture_timestamp=capture_timestamp,
        used_full_download=used_full_download
    )
