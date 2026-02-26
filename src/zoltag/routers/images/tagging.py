"""Tagging endpoints: upload, analyze, retag single, retag all."""

import base64
import hashlib
import mimetypes
import traceback
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Query
from sqlalchemy.orm import Session
from google.cloud import storage
from uuid import uuid4

from zoltag.auth.dependencies import require_tenant_permission_from_header
from zoltag.auth.models import UserProfile
from zoltag.asset_helpers import AssetReadinessError, load_assets_for_images, resolve_image_storage
from zoltag.dependencies import get_db, get_tenant
from zoltag.exif import (
    get_exif_value,
    parse_exif_datetime,
    parse_exif_float,
    parse_exif_int,
    parse_exif_str,
)
from zoltag.tenant import Tenant
from zoltag.metadata import Asset, ImageMetadata, JobDefinition, MachineTag
from zoltag.models.config import Keyword
from zoltag.settings import settings
from zoltag.image import ImageProcessor, VideoProcessor, is_supported_media_file, is_supported_video_file
from zoltag.config.db_config import ConfigManager
from zoltag.tagging import get_tagger
from zoltag.learning import ensure_image_embedding, score_keywords_for_categories
from zoltag.tenant_scope import assign_tenant_scope, tenant_column_filter

# Sub-router with no prefix/tags (inherits from parent)
router = APIRouter()

PHASE1_MAX_IMAGE_BYTES = 20 * 1024 * 1024   # 20 MB for images
PHASE1_MAX_VIDEO_BYTES = 500 * 1024 * 1024  # 500 MB for videos
PHASE1_ALLOWED_DEDUP_POLICIES = {"keep_both", "skip_duplicate", "refresh_duplicate_thumbnail"}


def _resolve_storage_or_409(
    *,
    image: ImageMetadata,
    tenant: Tenant,
    db: Session,
    require_thumbnail: bool = False,
    assets_by_id=None,
):
    try:
        return resolve_image_storage(
            image=image,
            tenant=tenant,
            db=None if assets_by_id is not None else db,
            assets_by_id=assets_by_id,
            strict=settings.asset_strict_reads,
            require_thumbnail=require_thumbnail,
        )
    except AssetReadinessError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.post("/images/upload", response_model=dict, operation_id="upload_images")
async def upload_images(
    files: List[UploadFile] = File(...),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Analyze uploaded images and return tag results without saving."""
    processor = ImageProcessor(thumbnail_size=(settings.thumbnail_size, settings.thumbnail_size))

    results = []

    for file in files:
        try:
            # Check if file is a supported image or video
            if not is_supported_media_file(file.filename, mime_type=file.content_type):
                results.append({
                    "filename": file.filename,
                    "status": "skipped",
                    "message": "Unsupported file format"
                })
                continue

            # Read file data
            image_data = await file.read()

            # Extract lightweight preview thumbnail for results display
            features = processor.extract_features(image_data)
            thumbnail_b64 = base64.b64encode(features['thumbnail']).decode('utf-8')

            # Apply automatic tags from keywords using CLIP
            try:
                config_mgr = ConfigManager(db, tenant.id)
                all_keywords = config_mgr.get_all_keywords()

                # Group keywords by category to avoid softmax suppression
                by_category = {}
                for kw in all_keywords:
                    cat = kw['category']
                    if cat not in by_category:
                        by_category[cat] = []
                    by_category[cat].append(kw)

                # Run CLIP separately for each category
                all_tags = []
                tagger = get_tagger(model_type=settings.tagging_model)

                for category, keywords in by_category.items():
                    category_tags = tagger.tag_image(
                        image_data,
                        keywords,
                        threshold=settings.zeroshot_tag_threshold
                    )
                    if settings.zeroshot_tag_top_n is not None:
                        category_tags = category_tags[:settings.zeroshot_tag_top_n]
                    all_tags.extend(category_tags)

                tags_with_confidence = all_tags

                # Map tags to category + confidence
                keyword_to_category = {kw['keyword']: kw['category'] for kw in all_keywords}

                tag_results = [{
                    "keyword": keyword,
                    "category": keyword_to_category.get(keyword),
                    "confidence": confidence,
                } for keyword, confidence in tags_with_confidence]
                tag_results.sort(key=lambda tag: tag["confidence"], reverse=True)
            except Exception as e:
                print(f"Tagging error: {e}")
                traceback.print_exc()
                tag_results = []

            results.append({
                "filename": file.filename,
                "status": "success",
                "thumbnail_base64": thumbnail_b64,
                "tags": tag_results
            })

        except Exception as e:
            results.append({
                "filename": file.filename,
                "status": "error",
                "message": str(e)
            })

    return {
        "tenant_id": tenant.id,
        "uploaded": len([r for r in results if r["status"] == "success"]),
        "failed": len([r for r in results if r["status"] == "error"]),
        "results": results
    }


def _enqueue_build_embeddings(db: Session, tenant: Tenant) -> None:
    """Queue a build-embeddings job for the tenant after upload. Silently skips if definition missing."""
    import logging
    from datetime import timezone
    from sqlalchemy import text
    logger = logging.getLogger(__name__)
    try:
        definition = db.query(JobDefinition).filter(
            JobDefinition.key == "build-embeddings",
            JobDefinition.is_active.is_(True),
        ).first()
        if not definition:
            return
        now = datetime.now(timezone.utc)
        db.execute(text("""
            INSERT INTO jobs (tenant_id, definition_id, source, status, priority, payload,
                              scheduled_for, queued_at, max_attempts)
            SELECT :tenant_id, :definition_id, 'system', 'queued', 100, '{}',
                   :now, :now, :max_attempts
            WHERE NOT EXISTS (
                SELECT 1 FROM jobs
                WHERE tenant_id = :tenant_id
                  AND definition_id = :definition_id
                  AND status IN ('queued', 'running')
            )
        """), {
            "tenant_id": str(tenant.id),
            "definition_id": str(definition.id),
            "now": now,
            "max_attempts": int(definition.max_attempts or 2),
        })
        db.commit()
        logger.info("Enqueued build-embeddings job for tenant %s", tenant.id)
    except Exception as exc:
        logger.warning("Failed to enqueue build-embeddings job: %s", exc)
        db.rollback()


@router.post("/images/upload-and-ingest", response_model=dict, operation_id="upload_and_ingest_image")
async def upload_and_ingest_image(
    file: UploadFile = File(...),
    dedup_policy: str = Query(
        "keep_both",
        description="Dedup policy: keep_both, skip_duplicate, or refresh_duplicate_thumbnail",
    ),
    relative_path: Optional[str] = Query(None, description="Relative path within uploaded folder (e.g. vacation/2024/img.jpg)"),
    store_original: bool = Query(True, description="When false, only the thumbnail is stored; the original file bytes are discarded after processing"),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(require_tenant_permission_from_header("image.variant.manage")),
):
    """Upload one image, persist original + thumbnail, and create Asset/ImageMetadata rows."""
    policy = (dedup_policy or "keep_both").strip().lower()
    if policy not in PHASE1_ALLOWED_DEDUP_POLICIES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported dedup policy '{dedup_policy}'. Allowed: keep_both, "
                "skip_duplicate, refresh_duplicate_thumbnail."
            ),
        )

    # Use relative_path (from folder upload) as the display filename when provided.
    filename = (relative_path or file.filename or "").strip()
    if not filename:
        raise HTTPException(status_code=400, detail="Missing filename.")

    _thumb_size = (settings.thumbnail_size, settings.thumbnail_size)
    processor = ImageProcessor(thumbnail_size=_thumb_size)
    _is_video = is_supported_video_file(filename, mime_type=file.content_type)
    if not _is_video and not processor.is_supported(filename):
        raise HTTPException(status_code=400, detail="Unsupported file format.")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    max_bytes = PHASE1_MAX_VIDEO_BYTES if _is_video else PHASE1_MAX_IMAGE_BYTES
    if len(file_bytes) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds upload limit ({max_bytes // (1024 * 1024)} MB).",
        )

    # For images: validate file bytes are actually an image.
    # For videos: skip PIL validation — rely on extension/mime check above.
    if not _is_video:
        try:
            probe = processor.load_image(file_bytes)
            probe.verify()
        except Exception:
            raise HTTPException(status_code=400, detail="Uploaded file content is not a valid image.")

    content_hash = hashlib.sha256(file_bytes).hexdigest()
    guessed_content_type = mimetypes.guess_type(filename)[0]
    content_type = (file.content_type or guessed_content_type or "application/octet-stream").strip()

    existing_matches = []
    if policy in {"skip_duplicate", "refresh_duplicate_thumbnail"}:
        existing_matches = (
            db.query(ImageMetadata)
            .filter(
                tenant_column_filter(ImageMetadata, tenant),
                ImageMetadata.content_hash == content_hash,
            )
            .order_by(ImageMetadata.id.asc())
            .all()
        )

    if policy == "skip_duplicate" and existing_matches:
        existing = existing_matches[0]
        return {
            "status": "skipped_duplicate",
            "tenant_id": tenant.id,
            "dedup_policy": policy,
            "image_id": existing.id,
            "filename": existing.filename,
        }

    if policy == "refresh_duplicate_thumbnail" and existing_matches:
        missing_asset_rows = [row.id for row in existing_matches if row.asset_id is None]
        if missing_asset_rows:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Duplicate image rows found without asset_id. "
                    f"Cannot refresh all duplicates (missing_asset_id_rows={len(missing_asset_rows)})."
                ),
            )

        asset_ids = [row.asset_id for row in existing_matches if row.asset_id is not None]
        existing_assets = (
            db.query(Asset)
            .filter(
                tenant_column_filter(Asset, tenant),
                Asset.id.in_(asset_ids) if asset_ids else False,
            )
            .all()
        )
        assets_by_id = {asset.id: asset for asset in existing_assets}
        missing_asset_ids = [asset_id for asset_id in asset_ids if asset_id not in assets_by_id]
        if missing_asset_ids:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Duplicate image rows found with missing assets. "
                    f"Cannot refresh all duplicates (missing={len(missing_asset_ids)})."
                ),
            )

        try:
            if _is_video:
                features = VideoProcessor(thumbnail_size=_thumb_size).extract_features(file_bytes, filename=filename)
            else:
                features = processor.extract_features(file_bytes)
            exif = features.get("exif", {}) or {}

            capture_timestamp = parse_exif_datetime(get_exif_value(exif, "DateTimeOriginal", "DateTime"))
            gps_latitude = parse_exif_float(get_exif_value(exif, "GPSLatitude"))
            gps_longitude = parse_exif_float(get_exif_value(exif, "GPSLongitude"))
            iso = parse_exif_int(get_exif_value(exif, "ISOSpeedRatings", "ISOSpeed", "ISO"))
            aperture = parse_exif_float(get_exif_value(exif, "FNumber", "ApertureValue"))
            shutter_speed = parse_exif_str(get_exif_value(exif, "ExposureTime", "ShutterSpeedValue"))
            focal_length = parse_exif_float(get_exif_value(exif, "FocalLength"))
            camera_make = parse_exif_str(get_exif_value(exif, "Make"))
            camera_model = parse_exif_str(get_exif_value(exif, "Model"))
            lens_model = parse_exif_str(get_exif_value(exif, "LensModel", "Lens"))

            mime_type = guessed_content_type
            if not mime_type and features.get("format"):
                mime_type = f"image/{str(features.get('format')).lower()}"

            if settings.local_mode:
                from pathlib import Path
                from zoltag.routers.local import _LocalThumbnailBucket

                local_thumb_dir = Path(settings.local_data_dir) / "thumbnails"
                thumbnail_bucket = _LocalThumbnailBucket(local_thumb_dir)
            else:
                storage_client = storage.Client(project=settings.gcp_project_id)
                thumbnail_bucket = storage_client.bucket(tenant.get_thumbnail_bucket(settings))
            now_utc = datetime.utcnow()
            refreshed_image_ids = []
            refreshed_asset_ids = []

            for existing in existing_matches:
                existing_asset = assets_by_id.get(existing.asset_id)
                if not existing_asset:
                    continue

                refresh_thumbnail_key = existing_asset.thumbnail_key or tenant.get_asset_thumbnail_key(
                    str(existing_asset.id),
                    "default-320.jpg",
                )
                thumbnail_blob = thumbnail_bucket.blob(refresh_thumbnail_key)
                thumbnail_blob.cache_control = "public, max-age=31536000, immutable"
                thumbnail_blob.upload_from_string(features["thumbnail"], content_type="image/jpeg")

                if not existing_asset.thumbnail_key:
                    existing_asset.thumbnail_key = refresh_thumbnail_key
                existing_asset.width = features.get("width")
                existing_asset.height = features.get("height")
                if mime_type:
                    existing_asset.mime_type = mime_type

                existing.file_size = len(file_bytes)
                existing.content_hash = content_hash
                existing.modified_time = now_utc
                existing.width = features.get("width")
                existing.height = features.get("height")
                existing.format = features.get("format")
                existing.perceptual_hash = features.get("perceptual_hash")
                existing.color_histogram = features.get("color_histogram")
                existing.exif_data = exif
                existing.camera_make = camera_make
                existing.camera_model = camera_model
                existing.lens_model = lens_model
                existing.iso = iso
                existing.aperture = aperture
                existing.shutter_speed = shutter_speed
                existing.focal_length = focal_length
                existing.capture_timestamp = capture_timestamp
                existing.gps_latitude = gps_latitude
                existing.gps_longitude = gps_longitude
                existing.last_processed = now_utc
                if settings.asset_write_legacy_fields and hasattr(ImageMetadata, "thumbnail_path"):
                    setattr(existing, "thumbnail_path", refresh_thumbnail_key)

                refreshed_image_ids.append(existing.id)
                refreshed_asset_ids.append(str(existing_asset.id))

            db.commit()
        except HTTPException:
            db.rollback()
            raise
        except Exception as exc:
            db.rollback()
            raise HTTPException(
                status_code=500,
                detail=f"Failed to refresh duplicate thumbnail: {exc}",
            )

        return {
            "status": "refreshed_duplicate_thumbnail",
            "tenant_id": tenant.id,
            "dedup_policy": policy,
            "refreshed_count": len(refreshed_image_ids),
            "image_ids": refreshed_image_ids,
            "asset_ids": refreshed_asset_ids,
            "filename": filename,
        }

    asset_id = uuid4()
    source_key = tenant.get_asset_source_key(str(asset_id), filename) if store_original else f"managed-thumbnail-only/{asset_id}"
    thumbnail_key = tenant.get_asset_thumbnail_key(str(asset_id), "default-256.jpg")

    if settings.local_mode:
        from zoltag.routers.local import _LocalThumbnailBucket
        from pathlib import Path
        _local_thumb_dir = Path(settings.local_data_dir) / "thumbnails"
        storage_bucket = None
        thumbnail_bucket = _LocalThumbnailBucket(_local_thumb_dir)
        source_blob = None
        thumbnail_blob = thumbnail_bucket.blob(thumbnail_key)
    else:
        storage_client = storage.Client(project=settings.gcp_project_id)
        storage_bucket = storage_client.bucket(tenant.get_storage_bucket(settings)) if store_original else None
        thumbnail_bucket = storage_client.bucket(tenant.get_thumbnail_bucket(settings))
        source_blob = storage_bucket.blob(source_key) if store_original else None
        thumbnail_blob = thumbnail_bucket.blob(thumbnail_key)

    source_uploaded = False
    thumbnail_uploaded = False
    try:
        if store_original and source_blob is not None:
            source_blob.upload_from_string(file_bytes, content_type=content_type)
            source_uploaded = True

        if _is_video:
            features = VideoProcessor(thumbnail_size=_thumb_size).extract_features(file_bytes, filename=filename)
        else:
            features = processor.extract_features(file_bytes)
        model_name = settings.tagging_model
        model_version = settings.tagging_model
        if not _is_video and settings.upload_generate_embeddings:
            tagger = get_tagger(model_type=settings.tagging_model)
            model_name = getattr(tagger, "model_name", settings.tagging_model)
            model_version = getattr(tagger, "model_version", model_name)
        exif = features.get("exif", {}) or {}

        thumbnail_blob.cache_control = "public, max-age=31536000, immutable"
        thumbnail_blob.upload_from_string(features["thumbnail"], content_type="image/jpeg")
        thumbnail_uploaded = True

        capture_timestamp = parse_exif_datetime(get_exif_value(exif, "DateTimeOriginal", "DateTime"))
        gps_latitude = parse_exif_float(get_exif_value(exif, "GPSLatitude"))
        gps_longitude = parse_exif_float(get_exif_value(exif, "GPSLongitude"))
        iso = parse_exif_int(get_exif_value(exif, "ISOSpeedRatings", "ISOSpeed", "ISO"))
        aperture = parse_exif_float(get_exif_value(exif, "FNumber", "ApertureValue"))
        shutter_speed = parse_exif_str(get_exif_value(exif, "ExposureTime", "ShutterSpeedValue"))
        focal_length = parse_exif_float(get_exif_value(exif, "FocalLength"))
        camera_make = parse_exif_str(get_exif_value(exif, "Make"))
        camera_model = parse_exif_str(get_exif_value(exif, "Model"))
        lens_model = parse_exif_str(get_exif_value(exif, "LensModel", "Lens"))

        mime_type = guessed_content_type
        if not mime_type and features.get("format"):
            prefix = "video" if _is_video else "image"
            mime_type = f"{prefix}/{str(features.get('format')).lower()}"

        asset = assign_tenant_scope(Asset(
            id=asset_id,
            filename=filename,
            source_provider="managed",
            source_key=source_key,
            source_rev=str(source_blob.generation) if (store_original and source_blob is not None and getattr(source_blob, 'generation', None) is not None) else None,
            thumbnail_key=thumbnail_key,
            media_type="video" if _is_video else "image",
            mime_type=mime_type,
            width=features.get("width"),
            height=features.get("height"),
            duration_ms=features.get("duration_ms"),
            created_by=current_user.supabase_uid,
        ), tenant)
        db.add(asset)

        metadata = assign_tenant_scope(ImageMetadata(
            asset_id=asset.id,
            filename=filename,
            file_size=len(file_bytes),
            content_hash=content_hash,
            modified_time=datetime.utcnow(),
            width=features.get("width"),
            height=features.get("height"),
            format=features.get("format"),
            perceptual_hash=features.get("perceptual_hash"),
            color_histogram=features.get("color_histogram"),
            exif_data=exif,
            camera_make=camera_make,
            camera_model=camera_model,
            lens_model=lens_model,
            iso=iso,
            aperture=aperture,
            shutter_speed=shutter_speed,
            focal_length=focal_length,
            capture_timestamp=capture_timestamp,
            gps_latitude=gps_latitude,
            gps_longitude=gps_longitude,
            embedding_generated=False,
            faces_detected=False,
            tags_applied=False,
            dropbox_properties=None,
        ), tenant)
        if settings.asset_write_legacy_fields and hasattr(ImageMetadata, "thumbnail_path"):
            setattr(metadata, "thumbnail_path", thumbnail_key)
        db.add(metadata)
        db.flush()

        if settings.upload_generate_embeddings:
            # Optional: generate embedding during ingest for immediate duplicate/model workflows.
            ensure_image_embedding(
                db=db,
                tenant_id=tenant.id,
                image_id=metadata.id,
                image_data=features["thumbnail"],
                model_name=model_name,
                model_version=model_version,
                asset_id=asset.id,
            )

        db.commit()
        db.refresh(metadata)

        # Enqueue background embedding generation for this tenant.
        _enqueue_build_embeddings(db, tenant)
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        if thumbnail_uploaded:
            try:
                thumbnail_blob.delete()
            except Exception:
                pass
        if source_uploaded and source_blob is not None:
            try:
                source_blob.delete()
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=f"Failed to upload and ingest image: {exc}")

    return {
        "status": "processed",
        "tenant_id": tenant.id,
        "dedup_policy": policy,
        "image_id": metadata.id,
        "asset_id": str(asset.id),
        "filename": filename,
        "source_provider": asset.source_provider,
        "source_key": asset.source_key,
        "thumbnail_key": asset.thumbnail_key,
        "thumbnail_url": tenant.get_thumbnail_url(settings, asset.thumbnail_key),
    }


@router.get("/images/{image_id}/analyze", response_model=dict, operation_id="analyze_image_keywords")
async def analyze_image_keywords(
    image_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Analyze an image and return ALL keyword scores (not just above threshold)."""
    # Get the image
    image = db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        tenant_column_filter(ImageMetadata, tenant)
    ).first()

    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    # Load config
    config_mgr = ConfigManager(db, tenant.id)
    all_keywords = config_mgr.get_all_keywords()

    # Group keywords by category
    by_category = {}
    for kw in all_keywords:
        cat = kw['category']
        if cat not in by_category:
            by_category[cat] = []
        by_category[cat].append(kw)

    # Setup tagger and storage
    tagger = get_tagger(model_type=settings.tagging_model)
    storage_client = storage.Client(project=settings.gcp_project_id)
    thumbnail_bucket = storage_client.bucket(tenant.get_thumbnail_bucket(settings))

    try:
        storage_info = _resolve_storage_or_409(
            image=image,
            tenant=tenant,
            db=db,
            require_thumbnail=True,
        )
        if not storage_info.thumbnail_key:
            raise HTTPException(status_code=404, detail="Thumbnail path not set")

        # Download thumbnail
        blob = thumbnail_bucket.blob(storage_info.thumbnail_key)
        if not blob.exists():
            raise HTTPException(status_code=404, detail="Thumbnail not found in storage")

        image_data = blob.download_as_bytes()

        # Run model with threshold=0 to get ALL scores
        all_scores_by_category = {}
        for category, keywords in by_category.items():
            category_scores = tagger.tag_image(
                image_data,
                keywords,
                threshold=0.0  # Get all scores
            )
            all_scores_by_category[category] = [
                {"keyword": kw, "confidence": round(conf, 3)}
                for kw, conf in category_scores
            ]

        return {
            "tenant_id": tenant.id,
            "image_id": image_id,
            "filename": image.filename,
            "model": settings.tagging_model,
            "threshold": settings.zeroshot_tag_threshold,  # Show current threshold
            "scores_by_category": all_scores_by_category
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error analyzing {image.filename}: {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


@router.post("/images/{image_id}/retag", response_model=dict, operation_id="retag_single_image")
async def retag_single_image(
    image_id: int,
    model: str = Query(None),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Retag a single image with current keywords."""
    # Get the image
    image = db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        tenant_column_filter(ImageMetadata, tenant)
    ).first()

    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    # Load config
    config_mgr = ConfigManager(db, tenant.id)
    all_keywords = config_mgr.get_all_keywords()

    # Group keywords by category
    by_category = {}
    for kw in all_keywords:
        cat = kw['category']
        if cat not in by_category:
            by_category[cat] = []
        by_category[cat].append(kw)

    # Setup CLIP tagger and storage
    model_type = model or settings.tagging_model
    tagger = get_tagger(model_type=model_type)
    model_name = getattr(tagger, "model_name", model_type)
    model_version = getattr(tagger, "model_version", model_name)
    storage_client = storage.Client(project=settings.gcp_project_id)
    thumbnail_bucket = storage_client.bucket(tenant.get_thumbnail_bucket(settings))

    try:
        storage_info = _resolve_storage_or_409(
            image=image,
            tenant=tenant,
            db=db,
            require_thumbnail=True,
        )
        if not storage_info.thumbnail_key:
            raise HTTPException(status_code=404, detail="Thumbnail path not set")

        # Delete existing tags
        db.query(MachineTag).filter(
            MachineTag.asset_id == image.asset_id,
            tenant_column_filter(MachineTag, tenant),
            MachineTag.tag_type == 'siglip'
        ).delete()

        # Download thumbnail
        blob = thumbnail_bucket.blob(storage_info.thumbnail_key)
        if not blob.exists():
            raise HTTPException(status_code=404, detail="Thumbnail not found in storage")

        image_data = blob.download_as_bytes()

        all_tags = score_keywords_for_categories(
            image_data=image_data,
            keywords_by_category=by_category,
            model_type=model_type,
            threshold=settings.zeroshot_tag_threshold,
            top_n=settings.zeroshot_tag_top_n,
        )

        # Create new tags - look up keyword_ids from database
        db_keywords = db.query(Keyword).filter(
            tenant_column_filter(Keyword, tenant)
        ).all()
        keyword_to_id = {kw.keyword: kw.id for kw in db_keywords}

        for keyword, confidence in all_tags:
            keyword_id = keyword_to_id.get(keyword)
            if not keyword_id:
                print(f"Warning: Keyword '{keyword}' not found in keyword config")
                continue

            tag = assign_tenant_scope(MachineTag(
                asset_id=image.asset_id,
                keyword_id=keyword_id,
                confidence=confidence,
                tag_type='siglip',
                model_name=model_name,
                model_version=model_version
            ), tenant)
            db.add(tag)

        # Update tags_applied flag
        image.tags_applied = len(all_tags) > 0

        db.commit()

        return {
            "tenant_id": tenant.id,
            "image_id": image_id,
            "filename": image.filename,
            "tags_count": len(all_tags),
            "tags": [{"keyword": kw, "confidence": round(conf, 2)} for kw, conf in all_tags]
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error processing {image.filename}: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Retagging failed: {str(e)}")


@router.post("/retag", response_model=dict, operation_id="retag_all_images")
async def retag_all_images(
    model: str = Query(None),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Retag all images with current keywords."""
    # Load config
    config_mgr = ConfigManager(db, tenant.id)
    all_keywords = config_mgr.get_all_keywords()

    # Group keywords by category
    by_category = {}
    for kw in all_keywords:
        cat = kw['category']
        if cat not in by_category:
            by_category[cat] = []
        by_category[cat].append(kw)

    # Get all images
    images = db.query(ImageMetadata).filter(
        tenant_column_filter(ImageMetadata, tenant)
    ).all()
    assets_by_id = load_assets_for_images(db, images)

    # Setup CLIP tagger and storage
    model_type = model or settings.tagging_model
    tagger = get_tagger(model_type=model_type)
    model_name = getattr(tagger, "model_name", model_type)
    model_version = getattr(tagger, "model_version", model_name)
    storage_client = storage.Client(project=settings.gcp_project_id)
    thumbnail_bucket = storage_client.bucket(tenant.get_thumbnail_bucket(settings))

    # Build keyword name to ID mapping once, before processing images
    db_keywords = db.query(Keyword).filter(
        tenant_column_filter(Keyword, tenant)
    ).all()
    keyword_to_id = {kw.keyword: kw.id for kw in db_keywords}

    processed = 0
    failed = 0

    for image in images:
        try:
            storage_info = _resolve_storage_or_409(
                image=image,
                tenant=tenant,
                db=db,
                require_thumbnail=True,
                assets_by_id=assets_by_id,
            )
            if not storage_info.thumbnail_key:
                failed += 1
                continue

            # Delete existing tags
            db.query(MachineTag).filter(
                MachineTag.asset_id == image.asset_id,
                tenant_column_filter(MachineTag, tenant),
                MachineTag.tag_type == 'siglip'
            ).delete()

            # Download thumbnail
            blob = thumbnail_bucket.blob(storage_info.thumbnail_key)
            if not blob.exists():
                failed += 1
                continue

            image_data = blob.download_as_bytes()

            all_tags = score_keywords_for_categories(
                image_data=image_data,
                keywords_by_category=by_category,
                model_type=model_type,
                threshold=settings.zeroshot_tag_threshold,
                top_n=settings.zeroshot_tag_top_n,
            )

            for keyword, confidence in all_tags:
                keyword_id = keyword_to_id.get(keyword)
                if not keyword_id:
                    print(f"Warning: Keyword '{keyword}' not found in keyword config")
                    continue

                tag = assign_tenant_scope(MachineTag(
                    asset_id=image.asset_id,
                    keyword_id=keyword_id,
                    confidence=confidence,
                    tag_type='siglip',
                    model_name=model_name,
                    model_version=model_version
                ), tenant)
                db.add(tag)

            # Update tags_applied flag
            image.tags_applied = len(all_tags) > 0

            db.commit()
            processed += 1

        except Exception as e:
            print(f"Error processing {image.filename}: {e}")
            db.rollback()
            failed += 1

    return {
        "tenant_id": tenant.id,
        "total": len(images),
        "processed": processed,
        "failed": failed
    }
