"""Tagging endpoints: upload, analyze, retag single, retag all."""

import base64
import traceback
from typing import List
from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Query
from sqlalchemy.orm import Session
from google.cloud import storage

from photocat.asset_helpers import AssetReadinessError, load_assets_for_images, resolve_image_storage
from photocat.dependencies import get_db, get_tenant
from photocat.tenant import Tenant
from photocat.metadata import ImageMetadata, MachineTag
from photocat.models.config import Keyword
from photocat.settings import settings
from photocat.image import ImageProcessor
from photocat.config.db_config import ConfigManager
from photocat.tagging import get_tagger
from photocat.learning import score_keywords_for_categories

# Sub-router with no prefix/tags (inherits from parent)
router = APIRouter()


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
                        threshold=settings.keyword_model_threshold
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
        ImageMetadata.tenant_id == tenant.id
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
            "threshold": settings.keyword_model_threshold,  # Show current threshold
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
        ImageMetadata.tenant_id == tenant.id
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
            MachineTag.tenant_id == tenant.id,
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
            threshold=settings.keyword_model_threshold
        )

        # Create new tags - look up keyword_ids from database
        db_keywords = db.query(Keyword).filter(
            Keyword.tenant_id == tenant.id
        ).all()
        keyword_to_id = {kw.keyword: kw.id for kw in db_keywords}

        for keyword, confidence in all_tags:
            keyword_id = keyword_to_id.get(keyword)
            if not keyword_id:
                print(f"Warning: Keyword '{keyword}' not found in keyword config")
                continue

            tag = MachineTag(
                asset_id=image.asset_id,
                tenant_id=tenant.id,
                keyword_id=keyword_id,
                confidence=confidence,
                tag_type='siglip',
                model_name=model_name,
                model_version=model_version
            )
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
        ImageMetadata.tenant_id == tenant.id
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
        Keyword.tenant_id == tenant.id
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
                MachineTag.tenant_id == tenant.id,
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
                threshold=settings.keyword_model_threshold
            )

            for keyword, confidence in all_tags:
                keyword_id = keyword_to_id.get(keyword)
                if not keyword_id:
                    print(f"Warning: Keyword '{keyword}' not found in keyword config")
                    continue

                tag = MachineTag(
                    asset_id=image.asset_id,
                    tenant_id=tenant.id,
                    keyword_id=keyword_id,
                    confidence=confidence,
                    tag_type='siglip',
                    model_name=model_name,
                    model_version=model_version
                )
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
