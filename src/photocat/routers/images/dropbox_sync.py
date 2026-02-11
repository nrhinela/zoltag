"""Dropbox sync endpoints: folder listing, metadata refresh, tag propagation."""

import re
import mimetypes
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from google.cloud import storage
from dropbox import Dropbox

from photocat.dependencies import get_db, get_tenant, get_secret
from photocat.auth.dependencies import require_tenant_role_from_header
from photocat.auth.models import UserProfile
from photocat.asset_helpers import ensure_asset_for_image
from photocat.tenant import Tenant
from photocat.metadata import Asset, ImageMetadata, Permatag
from photocat.settings import settings
from photocat.storage import create_storage_provider
from photocat.config.db_utils import load_keywords_map
from photocat.image import ImageProcessor
from photocat.exif import (
    get_exif_value,
    parse_exif_datetime,
    parse_exif_float,
    parse_exif_int,
    parse_exif_str,
)
from photocat.routers.images._shared import (
    _resolve_storage_or_409,
    _resolve_dropbox_ref,
    _resolve_provider_ref,
    _extract_dropbox_tag_text,
)

router = APIRouter()


@router.get("/images/dropbox-folders")
async def list_dropbox_folders(
    tenant: Tenant = Depends(get_tenant),
    q: Optional[str] = None,
    limit: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """List Dropbox folder paths for a tenant, filtered by query."""
    parent_expr = func.regexp_replace(Asset.source_key, "/[^/]+$", "")
    folder_expr = func.coalesce(func.nullif(parent_expr, ""), "/")
    query = (
        db.query(folder_expr.label("folder"))
        .join(ImageMetadata, ImageMetadata.asset_id == Asset.id)
        .filter(
            ImageMetadata.tenant_id == tenant.id,
            Asset.tenant_id == tenant.id,
            Asset.source_provider == "dropbox",
            Asset.source_key.isnot(None),
        )
    )
    if q:
        query = query.filter(folder_expr.ilike(f"%{q}%"))
    query = query.distinct().order_by(folder_expr)
    if limit:
        query = query.limit(limit)
    rows = query.all()
    folders = [row[0] for row in rows]
    return {"tenant_id": tenant.id, "folders": folders}


@router.post("/images/{image_id}/refresh-metadata", response_model=dict, operation_id="refresh_image_metadata")
async def refresh_image_metadata(
    image_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Re-download image and refresh EXIF metadata without changing tags."""
    image = db.query(ImageMetadata).filter_by(
        id=image_id,
        tenant_id=tenant.id
    ).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    storage_info = _resolve_storage_or_409(
        image=image,
        tenant=tenant,
        db=db,
        require_source=True,
    )
    provider_name, source_ref = _resolve_provider_ref(storage_info, image)
    if not source_ref:
        if provider_name == "dropbox":
            raise HTTPException(status_code=404, detail="Image not available in Dropbox")
        raise HTTPException(status_code=404, detail=f"Image not available in {provider_name}")

    try:
        provider = create_storage_provider(provider_name, tenant=tenant, get_secret=get_secret)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to initialize {provider_name} provider: {exc}")

    try:
        entry = provider.get_entry(source_ref)
    except Exception:
        entry = None

    try:
        image_bytes = provider.download_file(source_ref)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error downloading {provider_name} image: {exc}")

    try:
        processor = ImageProcessor()
        features = processor.extract_features(image_bytes)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error parsing image metadata: {exc}")

    exif = features.get("exif", {}) or {}
    capture_timestamp = parse_exif_datetime(
        get_exif_value(exif, "DateTimeOriginal", "DateTime")
    )
    gps_latitude = parse_exif_float(get_exif_value(exif, "GPSLatitude"))
    gps_longitude = parse_exif_float(get_exif_value(exif, "GPSLongitude"))
    iso = parse_exif_int(get_exif_value(exif, "ISOSpeedRatings", "ISOSpeed", "ISO"))
    aperture = parse_exif_float(get_exif_value(exif, "FNumber", "ApertureValue"))
    shutter_speed = parse_exif_str(get_exif_value(exif, "ExposureTime", "ShutterSpeedValue"))
    focal_length = parse_exif_float(get_exif_value(exif, "FocalLength"))

    asset = ensure_asset_for_image(
        db=db,
        image=image,
        tenant=tenant,
        source_provider=provider_name,
        source_key=(entry.source_key if entry else storage_info.source_key),
        source_rev=(entry.revision if entry else None),
    )
    thumbnail_path = asset.thumbnail_key
    if not thumbnail_path or thumbnail_path.startswith("legacy:"):
        thumbnail_path = tenant.get_asset_thumbnail_key(str(asset.id), "default-256.jpg")

    try:
        storage_client = storage.Client(project=settings.gcp_project_id)
        bucket = storage_client.bucket(tenant.get_thumbnail_bucket(settings))
        blob = bucket.blob(thumbnail_path)
        blob.cache_control = "public, max-age=31536000, immutable"
        blob.upload_from_string(features["thumbnail"], content_type="image/jpeg")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error uploading thumbnail: {exc}")

    image.width = features.get("width")
    image.height = features.get("height")
    image.format = features.get("format")
    image.perceptual_hash = features.get("perceptual_hash")
    image.color_histogram = features.get("color_histogram")
    image.exif_data = exif
    image.camera_make = parse_exif_str(get_exif_value(exif, "Make"))
    image.camera_model = parse_exif_str(get_exif_value(exif, "Model"))
    image.lens_model = parse_exif_str(get_exif_value(exif, "LensModel", "Lens"))
    image.capture_timestamp = capture_timestamp
    image.gps_latitude = gps_latitude
    image.gps_longitude = gps_longitude
    image.iso = iso
    image.aperture = aperture
    image.shutter_speed = shutter_speed
    image.focal_length = focal_length
    if settings.asset_write_legacy_fields and hasattr(ImageMetadata, "thumbnail_path"):
        setattr(image, "thumbnail_path", thumbnail_path)
    image.last_processed = datetime.utcnow()

    if entry is not None:
        image.file_size = entry.size if entry.size is not None else image.file_size
        image.modified_time = entry.modified_time or image.modified_time
        image.content_hash = entry.content_hash or image.content_hash
        if provider_name == "dropbox" and settings.asset_write_legacy_fields and hasattr(ImageMetadata, "dropbox_path"):
            if entry.display_path:
                setattr(image, "dropbox_path", entry.display_path)
        if provider_name == "dropbox" and hasattr(ImageMetadata, "dropbox_id") and entry.file_id:
            setattr(image, "dropbox_id", entry.file_id)

    guessed_mime_type = mimetypes.guess_type(image.filename or "")[0]
    asset.thumbnail_key = thumbnail_path
    asset.filename = image.filename or asset.filename
    asset.source_provider = provider_name
    if entry and entry.source_key:
        asset.source_key = entry.source_key
    if entry and entry.revision:
        asset.source_rev = entry.revision
    if asset.mime_type is None:
        asset.mime_type = guessed_mime_type or (f"image/{str(image.format).lower()}" if image.format else None)
    asset.width = image.width
    asset.height = image.height
    image.asset_id = asset.id

    db.add(asset)
    db.add(image)
    db.commit()

    return {
        "status": "ok",
        "image_id": image.id
    }


@router.post("/images/{image_id}/dropbox-tags", response_model=dict, operation_id="propagate_dropbox_tags")
async def propagate_dropbox_tags(
    image_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(require_tenant_role_from_header("editor"))
):
    """Apply calculated tags to Dropbox for a single image."""
    image = db.query(ImageMetadata).filter_by(
        id=image_id,
        tenant_id=tenant.id
    ).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    storage_info = _resolve_storage_or_409(
        image=image,
        tenant=tenant,
        db=db,
        require_source=True,
    )
    dropbox_ref = _resolve_dropbox_ref(storage_info, image)
    if not dropbox_ref:
        raise HTTPException(status_code=404, detail="Image not available in Dropbox")

    if not tenant.dropbox_app_key:
        raise HTTPException(status_code=400, detail="Dropbox app key not configured for tenant")
    if not tenant.dropbox_token_secret or not tenant.dropbox_app_secret:
        raise HTTPException(status_code=400, detail="Dropbox secrets not configured for tenant")

    try:
        refresh_token = get_secret(tenant.dropbox_token_secret)
        app_secret = get_secret(tenant.dropbox_app_secret)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Dropbox secrets missing: {exc}")

    permatags = db.query(Permatag).filter(
        Permatag.asset_id == image.asset_id,
        Permatag.tenant_id == tenant.id,
    ).all()
    keyword_ids = {tag.keyword_id for tag in permatags}
    keywords_map = load_keywords_map(db, tenant.id, keyword_ids)

    gmm_tags = []
    for tag in permatags:
        if tag.signum != 1:
            continue
        kw_info = keywords_map.get(tag.keyword_id, {"keyword": "unknown"})
        keyword = (kw_info.get("keyword") or "").strip()
        if not keyword:
            continue
        normalized = re.sub(r"[^A-Za-z0-9_]+", "_", keyword.lower()).strip("_")
        if not normalized:
            continue
        gmm_tags.append(f"gmm_{normalized}")
    if image.rating is not None:
        gmm_tags.append(f"gmm_rating_{image.rating}")
    gmm_tags = sorted(set(gmm_tags))

    try:
        dbx = Dropbox(
            oauth2_refresh_token=refresh_token,
            app_key=tenant.dropbox_app_key,
            app_secret=app_secret
        )
        tags_result = dbx.files_tags_get([dropbox_ref])
        existing_tags = []
        for path_to_tags in getattr(tags_result, "paths_to_tags", []) or []:
            for tag in getattr(path_to_tags, "tags", []) or []:
                tag_text = _extract_dropbox_tag_text(tag)
                if tag_text:
                    existing_tags.append(tag_text)

        existing_gmm_tags = {
            tag_text for tag_text in existing_tags
            if tag_text.lower().startswith("gmm_")
        }
        desired_gmm_tags = set(gmm_tags)

        removed = sorted(existing_gmm_tags - desired_gmm_tags)
        added = sorted(desired_gmm_tags - set(existing_tags))

        for tag_text in removed:
            dbx.files_tags_remove(dropbox_ref, tag_text)

        for tag_text in added:
            dbx.files_tags_add(dropbox_ref, tag_text)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error applying Dropbox tags: {exc}")

    return {
        "status": "ok",
        "image_id": image.id,
        "dropbox_ref": dropbox_ref,
        "applied_tags": gmm_tags,
        "added_tags": added,
        "removed_tags": removed,
    }
