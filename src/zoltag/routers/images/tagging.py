"""Tagging endpoints: upload, analyze, retag single, retag all."""

import base64
import hashlib
import mimetypes
import traceback
from datetime import datetime
from typing import List
from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Query
from sqlalchemy.orm import Session
from google.cloud import storage
from uuid import uuid4

from zoltag.auth.dependencies import require_tenant_role_from_header
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
from zoltag.metadata import Asset, ImageMetadata, MachineTag
from zoltag.models.config import Keyword
from zoltag.settings import settings
from zoltag.image import ImageProcessor
from zoltag.config.db_config import ConfigManager
from zoltag.tagging import get_tagger
from zoltag.learning import ensure_image_embedding, score_keywords_for_categories
from zoltag.tenant_scope import assign_tenant_scope, tenant_column_filter

# Sub-router with no prefix/tags (inherits from parent)
router = APIRouter()

PHASE1_MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB
PHASE1_ALLOWED_DEDUP_POLICIES = {"keep_both", "skip_duplicate"}


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
            # Check if file is an image
            if not processor.is_supported(file.filename):
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


@router.post("/images/upload-and-ingest", response_model=dict, operation_id="upload_and_ingest_image")
async def upload_and_ingest_image(
    file: UploadFile = File(...),
    dedup_policy: str = Query("keep_both", description="Dedup policy: keep_both or skip_duplicate"),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(require_tenant_role_from_header("user")),
):
    """Upload one image, persist original + thumbnail, and create Asset/ImageMetadata rows."""
    policy = (dedup_policy or "keep_both").strip().lower()
    if policy not in PHASE1_ALLOWED_DEDUP_POLICIES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported dedup policy '{dedup_policy}'. Allowed: keep_both, skip_duplicate.",
        )

    filename = (file.filename or "").strip()
    if not filename:
        raise HTTPException(status_code=400, detail="Missing filename.")

    processor = ImageProcessor(thumbnail_size=(settings.thumbnail_size, settings.thumbnail_size))
    if not processor.is_supported(filename):
        raise HTTPException(status_code=400, detail="Unsupported file format.")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(file_bytes) > PHASE1_MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds Phase 1 upload limit ({PHASE1_MAX_UPLOAD_BYTES // (1024 * 1024)} MB).",
        )

    # Header-level validation: reject non-image bytes even if extension/mime are spoofed.
    try:
        probe = processor.load_image(file_bytes)
        probe.verify()
    except Exception:
        raise HTTPException(status_code=400, detail="Uploaded file content is not a valid image.")

    content_hash = hashlib.sha256(file_bytes).hexdigest()
    if policy == "skip_duplicate":
        existing = (
            db.query(ImageMetadata)
            .filter(
                tenant_column_filter(ImageMetadata, tenant),
                ImageMetadata.content_hash == content_hash,
            )
            .order_by(ImageMetadata.id.asc())
            .first()
        )
        if existing:
            return {
                "status": "skipped_duplicate",
                "tenant_id": tenant.id,
                "dedup_policy": policy,
                "image_id": existing.id,
                "filename": existing.filename,
            }

    guessed_content_type = mimetypes.guess_type(filename)[0]
    content_type = (file.content_type or guessed_content_type or "application/octet-stream").strip()

    storage_client = storage.Client(project=settings.gcp_project_id)
    storage_bucket = storage_client.bucket(tenant.get_storage_bucket(settings))
    thumbnail_bucket = storage_client.bucket(tenant.get_thumbnail_bucket(settings))

    asset_id = uuid4()
    source_key = tenant.get_asset_source_key(str(asset_id), filename)
    thumbnail_key = tenant.get_asset_thumbnail_key(str(asset_id), "default-256.jpg")
    source_blob = storage_bucket.blob(source_key)
    thumbnail_blob = thumbnail_bucket.blob(thumbnail_key)

    source_uploaded = False
    thumbnail_uploaded = False
    try:
        source_blob.upload_from_string(file_bytes, content_type=content_type)
        source_uploaded = True

        features = processor.extract_features(file_bytes)
        model_name = settings.tagging_model
        model_version = settings.tagging_model
        if settings.upload_generate_embeddings:
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
            mime_type = f"image/{str(features.get('format')).lower()}"

        asset = assign_tenant_scope(Asset(
            id=asset_id,
            filename=filename,
            source_provider="managed",
            source_key=source_key,
            source_rev=str(source_blob.generation) if source_blob.generation is not None else None,
            thumbnail_key=thumbnail_key,
            mime_type=mime_type,
            width=features.get("width"),
            height=features.get("height"),
            duration_ms=None,
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
        if source_uploaded:
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
            threshold=settings.zeroshot_tag_threshold
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
                threshold=settings.zeroshot_tag_threshold
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
