"""Router for image management endpoints."""

import json
import base64
import traceback
from typing import Optional, List
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, File, UploadFile, Body, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, distinct, and_
from sqlalchemy.orm import Session, aliased
from google.cloud import storage

from photocat.dependencies import get_db, get_tenant, get_tenant_setting
from photocat.tenant import Tenant
from photocat.metadata import (
    ImageMetadata, MachineTag, Permatag,
    Tenant as TenantModel, KeywordModel, ImageEmbedding
)
from photocat.models.config import PhotoList, PhotoListItem
from photocat.settings import settings
from photocat.image import ImageProcessor
from photocat.config.db_config import ConfigManager
from photocat.tagging import calculate_tags, get_tagger
from photocat.learning import (
    ensure_image_embedding,
    load_keyword_models,
    score_image_with_models,
    score_keywords_for_categories,
    recompute_trained_tags_for_image,
)

router = APIRouter(
    prefix="/api/v1",
    tags=["images"]
)


@router.get("/images", response_model=dict)
async def list_images(
    tenant: Tenant = Depends(get_tenant),
    limit: int = None,
    offset: int = 0,
    keywords: Optional[str] = None,  # Comma-separated keywords (deprecated)
    operator: str = "OR",  # "AND" or "OR" (deprecated)
    category_filters: Optional[str] = None,  # JSON string with per-category filters
    list_id: Optional[int] = None,
    rating: Optional[int] = None,
    rating_operator: str = "eq",
    hide_zero_rating: bool = False,
    reviewed: Optional[bool] = None,
    db: Session = Depends(get_db)
):
    """List images for tenant with optional faceted search by keywords."""
    filter_ids = None
    if list_id is not None:
        lst = db.query(PhotoList).filter_by(id=list_id, tenant_id=tenant.id).first()
        if not lst:
            raise HTTPException(status_code=404, detail="List not found")
        list_image_ids = db.query(PhotoListItem.photo_id).filter(
            PhotoListItem.list_id == list_id
        ).all()
        filter_ids = {row[0] for row in list_image_ids}

    if rating is not None:
        rating_query = db.query(ImageMetadata.id).filter(
            ImageMetadata.tenant_id == tenant.id
        )
        if rating_operator == "gte":
            rating_query = rating_query.filter(ImageMetadata.rating >= rating)
        elif rating_operator == "gt":
            rating_query = rating_query.filter(ImageMetadata.rating > rating)
        else:
            rating_query = rating_query.filter(ImageMetadata.rating == rating)
        rating_image_ids = rating_query.all()
        rating_ids = {row[0] for row in rating_image_ids}
        if filter_ids is None:
            filter_ids = rating_ids
        else:
            filter_ids = filter_ids.intersection(rating_ids)

    if hide_zero_rating:
        zero_rating_ids = db.query(ImageMetadata.id).filter(
            ImageMetadata.tenant_id == tenant.id,
            ImageMetadata.rating == 0
        ).all()
        zero_ids = {row[0] for row in zero_rating_ids}
        if filter_ids is None:
            all_image_ids = db.query(ImageMetadata.id).filter(
                ImageMetadata.tenant_id == tenant.id
            ).all()
            filter_ids = {row[0] for row in all_image_ids} - zero_ids
        else:
            filter_ids = filter_ids - zero_ids

    if reviewed is not None:
        reviewed_rows = db.query(Permatag.image_id).filter(
            Permatag.tenant_id == tenant.id
        ).distinct().all()
        reviewed_ids = {row[0] for row in reviewed_rows}
        if filter_ids is None:
            all_image_ids = db.query(ImageMetadata.id).filter(
                ImageMetadata.tenant_id == tenant.id
            ).all()
            base_ids = {row[0] for row in all_image_ids}
            filter_ids = reviewed_ids if reviewed else (base_ids - reviewed_ids)
        else:
            filter_ids = filter_ids.intersection(reviewed_ids) if reviewed else (filter_ids - reviewed_ids)

    if filter_ids is not None and not filter_ids:
        return {
            "tenant_id": tenant.id,
            "images": [],
            "total": 0,
            "limit": limit,
            "offset": offset
        }

    # Handle per-category filters if provided
    if category_filters:
        try:
            filters = json.loads(category_filters)
            # filters structure: {category: {keywords: [...], operator: "OR"|"AND"}}

            # Start with base query
            base_query = db.query(ImageMetadata).filter_by(tenant_id=tenant.id)

            # For each category, apply its filter
            # Categories are combined with OR (image matches any category's criteria)
            category_image_ids = []

            for category, filter_data in filters.items():
                category_keywords = filter_data.get('keywords', [])
                category_operator = filter_data.get('operator', 'OR').upper()

                if not category_keywords:
                    continue

                # Get all images and their tags/permatags to compute "current tags"
                # This is necessary because we need to exclude machine tags that are negatively permatagged
                # Only consider images matching active filters (rating, list, hide_zero_rating)
                if filter_ids is not None:
                    all_image_ids = list(filter_ids)
                else:
                    all_images = db.query(ImageMetadata.id).filter_by(tenant_id=tenant.id).all()
                    all_image_ids = [img[0] for img in all_images]

                # Get active tag type from tenant config for filtering
                active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')

                # Get all tags for these images (from primary algorithm only)
                all_tags = db.query(MachineTag).filter(
                    MachineTag.tenant_id == tenant.id,
                    MachineTag.image_id.in_(all_image_ids),
                    MachineTag.tag_type == active_tag_type  # Filter by primary algorithm
                ).all()

                # Get all permatags for these images
                all_permatags = db.query(Permatag).filter(
                    Permatag.tenant_id == tenant.id,
                    Permatag.image_id.in_(all_image_ids)
                ).all()

                # Build permatag map by image_id and keyword
                permatag_map = {}
                for p in all_permatags:
                    if p.image_id not in permatag_map:
                        permatag_map[p.image_id] = {}
                    permatag_map[p.image_id][p.keyword] = p.signum

                # Initialize current tags for ALL images (not just ones with tags)
                current_tags_by_image = {img_id: [] for img_id in all_image_ids}

                # Add machine tags for each image
                for tag in all_tags:
                    # Include machine tag only if not negatively permatagged
                    if tag.image_id in permatag_map and permatag_map[tag.image_id].get(tag.keyword) == -1:
                        continue  # Skip negatively permatagged machine tags
                    current_tags_by_image[tag.image_id].append(tag.keyword)

                # Add positive permatags
                for p in all_permatags:
                    if p.signum == 1:
                        # Only add if not already in machine tags
                        if p.keyword not in current_tags_by_image[p.image_id]:
                            current_tags_by_image[p.image_id].append(p.keyword)

                # Now filter based on current tags
                if category_operator == "OR":
                    # Image must have ANY of the keywords in this category (in current tags)
                    for image_id, current_keywords in current_tags_by_image.items():
                        if any(kw in category_keywords for kw in current_keywords):
                            category_image_ids.append(image_id)

                elif category_operator == "AND":
                    # Image must have ALL keywords in this category (in current tags)
                    for image_id, current_keywords in current_tags_by_image.items():
                        if all(kw in current_keywords for kw in category_keywords):
                            category_image_ids.append(image_id)

            if category_image_ids:
                # Remove duplicates
                unique_image_ids = list(set(category_image_ids))
                if filter_ids is not None:
                    unique_image_ids = [image_id for image_id in unique_image_ids if image_id in filter_ids]

                # Get all keywords for relevance counting
                all_keywords = []
                for filter_data in filters.values():
                    all_keywords.extend(filter_data.get('keywords', []))

                # Total count of matching images
                total = len(unique_image_ids)

                if total:
                    # For ordering by relevance, we need to calculate confidence scores
                    # But we've already filtered to unique_image_ids, so just order those

                    # Get tags for these images to calculate relevance scores
                    image_tags = db.query(
                        MachineTag.image_id,
                        func.sum(MachineTag.confidence).label('relevance_score')
                    ).filter(
                        MachineTag.image_id.in_(unique_image_ids),
                        MachineTag.keyword.in_(all_keywords),
                        MachineTag.tenant_id == tenant.id,
                        MachineTag.tag_type == active_tag_type  # Filter by primary algorithm
                    ).group_by(
                        MachineTag.image_id
                    ).all()

                    # Create a score map for ordering
                    score_map = {img_id: score for img_id, score in image_tags}

                    # Sort unique_image_ids by relevance score (descending), then by ID (descending)
                    sorted_ids = sorted(
                        unique_image_ids,
                        key=lambda img_id: (-(score_map.get(img_id) or 0), -img_id)
                    )

                    # Apply offset and limit
                    paginated_ids = sorted_ids[offset:offset + limit] if limit else sorted_ids[offset:]

                    # Now fetch full ImageMetadata objects in order
                    if paginated_ids:
                        # Preserve order from pagination
                        images = db.query(ImageMetadata).filter(
                            ImageMetadata.id.in_(paginated_ids)
                        ).all()
                        # Re-sort to match paginated_ids order
                        id_to_image = {img.id: img for img in images}
                        images = [id_to_image[img_id] for img_id in paginated_ids if img_id in id_to_image]
                    else:
                        images = []
                else:
                    images = []
            else:
                # No matches
                total = 0
                images = []

        except (json.JSONDecodeError, KeyError, TypeError) as e:
            print(f"Error parsing category_filters: {e}")
            # Fall back to returning all images
            query = db.query(ImageMetadata).filter_by(tenant_id=tenant.id)
            total = query.count()
            images = query.order_by(ImageMetadata.id.desc()).limit(limit).offset(offset).all() if limit else query.order_by(ImageMetadata.id.desc()).offset(offset).all()

    # Apply keyword filtering if provided (legacy support)
    elif keywords:
        keyword_list = [k.strip() for k in keywords.split(',') if k.strip()]

        if keyword_list and operator.upper() == "OR":
            # OR: Image must have ANY of the selected keywords
            # Get active tag type for filtering
            active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')

            # Use subquery to get image IDs that match keywords
            matching_image_ids = db.query(MachineTag.image_id).filter(
                MachineTag.keyword.in_(keyword_list),
                MachineTag.tenant_id == tenant.id,
                MachineTag.tag_type == active_tag_type
            ).distinct().subquery()

            # Main query with relevance ordering (by sum of confidence scores)
            query = db.query(
                ImageMetadata,
                func.sum(MachineTag.confidence).label('relevance_score')
            ).join(
                MachineTag,
                and_(
                    MachineTag.image_id == ImageMetadata.id,
                    MachineTag.keyword.in_(keyword_list),
                    MachineTag.tenant_id == tenant.id,
                    MachineTag.tag_type == active_tag_type
                )
            ).filter(
                ImageMetadata.tenant_id == tenant.id,
                ImageMetadata.id.in_(matching_image_ids)
            ).group_by(
                ImageMetadata.id
            ).order_by(
                func.sum(MachineTag.confidence).desc(),
                ImageMetadata.id.desc()
            )

            if filter_ids is not None:
                query = query.filter(ImageMetadata.id.in_(filter_ids))
                total = db.query(ImageMetadata).filter(
                    ImageMetadata.tenant_id == tenant.id,
                    ImageMetadata.id.in_(matching_image_ids),
                    ImageMetadata.id.in_(filter_ids)
                ).count()
            else:
                total = db.query(ImageMetadata).filter(
                    ImageMetadata.tenant_id == tenant.id,
                    ImageMetadata.id.in_(matching_image_ids)
                ).count()

            results = query.limit(limit).offset(offset).all() if limit else query.offset(offset).all()
            images = [img for img, _ in results]

        elif keyword_list and operator.upper() == "AND":
            # AND: Image must have ALL selected keywords
            # Get active tag type for filtering
            active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')

            # Start with images that have tenant_id
            base_query = db.query(ImageMetadata.id).filter_by(tenant_id=tenant.id)

            # For each keyword, filter images that have that keyword
            for keyword in keyword_list:
                subquery = db.query(MachineTag.image_id).filter(
                    MachineTag.keyword == keyword,
                    MachineTag.tenant_id == tenant.id,
                    MachineTag.tag_type == active_tag_type
                ).subquery()

                base_query = base_query.filter(ImageMetadata.id.in_(subquery))

            if filter_ids is not None:
                base_query = base_query.filter(ImageMetadata.id.in_(filter_ids))

            # Get matching image IDs
            matching_image_ids = base_query.subquery()

            # Query with relevance ordering (by sum of confidence scores)
            query = db.query(
                ImageMetadata,
                func.sum(MachineTag.confidence).label('relevance_score')
            ).join(
                MachineTag,
                and_(
                    MachineTag.image_id == ImageMetadata.id,
                    MachineTag.keyword.in_(keyword_list),
                    MachineTag.tenant_id == tenant.id,
                    MachineTag.tag_type == active_tag_type
                )
            ).filter(
                ImageMetadata.tenant_id == tenant.id,
                ImageMetadata.id.in_(matching_image_ids)
            ).group_by(
                ImageMetadata.id
            ).order_by(
                func.sum(MachineTag.confidence).desc(),
                ImageMetadata.id.desc()
            )

            total = db.query(ImageMetadata).filter(
                ImageMetadata.tenant_id == tenant.id,
                ImageMetadata.id.in_(matching_image_ids)
            ).count()

            results = query.limit(limit).offset(offset).all() if limit else query.offset(offset).all()
            images = [img for img, _ in results]
        else:
            # No valid keywords, return all
            query = db.query(ImageMetadata).filter_by(tenant_id=tenant.id)
            if filter_ids is not None:
                query = query.filter(ImageMetadata.id.in_(filter_ids))
            total = query.count()
            images = query.order_by(ImageMetadata.id.desc()).limit(limit).offset(offset).all() if limit else query.order_by(ImageMetadata.id.desc()).offset(offset).all()
    else:
        # No keywords filter, return all
        query = db.query(ImageMetadata).filter_by(tenant_id=tenant.id)
        if filter_ids is not None:
            query = query.filter(ImageMetadata.id.in_(filter_ids))
        total = query.count()
        images = query.order_by(ImageMetadata.id.desc()).limit(limit).offset(offset).all() if limit else query.order_by(ImageMetadata.id.desc()).offset(offset).all()

    # Get tags for all images
    image_ids = [img.id for img in images]
    active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')
    tags = db.query(MachineTag).filter(
        MachineTag.image_id.in_(image_ids),
        MachineTag.tenant_id == tenant.id,
        MachineTag.tag_type == active_tag_type
    ).all() if image_ids else []

    # Get permatags for all images
    permatags = db.query(Permatag).filter(
        Permatag.image_id.in_(image_ids),
        Permatag.tenant_id == tenant.id
    ).all() if image_ids else []

    # Group tags by image_id
    tags_by_image = {}
    for tag in tags:
        if tag.image_id not in tags_by_image:
            tags_by_image[tag.image_id] = []
        tags_by_image[tag.image_id].append({
            "keyword": tag.keyword,
            "category": tag.category,
            "confidence": round(tag.confidence, 2)
        })

    # Group permatags by image_id
    permatags_by_image = {}
    reviewed_at_by_image = {}
    for permatag in permatags:
        if permatag.image_id not in permatags_by_image:
            permatags_by_image[permatag.image_id] = []
        permatags_by_image[permatag.image_id].append({
            "id": permatag.id,
            "keyword": permatag.keyword,
            "category": permatag.category,
            "signum": permatag.signum
        })
        if permatag.created_at:
            current_latest = reviewed_at_by_image.get(permatag.image_id)
            if current_latest is None or permatag.created_at > current_latest:
                reviewed_at_by_image[permatag.image_id] = permatag.created_at

    images_list = []
    for img in images:
        machine_tags = sorted(tags_by_image.get(img.id, []), key=lambda x: x['confidence'], reverse=True)
        image_permatags = permatags_by_image.get(img.id, [])
        calculated_tags = calculate_tags(machine_tags, image_permatags)
        images_list.append({
            "id": img.id,
            "filename": img.filename,
            "width": img.width,
            "height": img.height,
            "format": img.format,
            "file_size": img.file_size,
            "dropbox_path": img.dropbox_path,
            "camera_make": img.camera_make,
            "camera_model": img.camera_model,
            "lens_model": img.lens_model,
            "iso": img.iso,
            "aperture": img.aperture,
            "capture_timestamp": img.capture_timestamp.isoformat() if img.capture_timestamp else None,
            "modified_time": img.modified_time.isoformat() if img.modified_time else None,
            "thumbnail_path": img.thumbnail_path,
            "thumbnail_url": f"https://storage.googleapis.com/{tenant.get_thumbnail_bucket(settings)}/{img.thumbnail_path}" if img.thumbnail_path else None,
            "tags_applied": img.tags_applied,
            "faces_detected": img.faces_detected,
            "rating": img.rating,
            "reviewed_at": reviewed_at_by_image.get(img.id).isoformat() if reviewed_at_by_image.get(img.id) else None,
            "tags": machine_tags,
            "permatags": image_permatags,
            "calculated_tags": calculated_tags
        })

    return {
        "tenant_id": tenant.id,
        "images": images_list,
        "total": total,
        "limit": limit,
        "offset": offset
    }


@router.get("/images/stats", response_model=dict)
async def get_image_stats(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Return image summary stats for a tenant."""
    image_count = db.query(func.count(ImageMetadata.id)).filter(
        ImageMetadata.tenant_id == tenant.id
    ).scalar() or 0

    reviewed_image_count = db.query(func.count(distinct(Permatag.image_id))).filter(
        Permatag.tenant_id == tenant.id
    ).scalar() or 0

    # Get active tag type from tenant settings
    active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')

    ml_tag_count = db.query(func.count(distinct(MachineTag.image_id))).filter(
        MachineTag.tenant_id == tenant.id,
        MachineTag.tag_type == active_tag_type
    ).scalar() or 0

    return {
        "tenant_id": tenant.id,
        "image_count": int(image_count),
        "reviewed_image_count": int(reviewed_image_count),
        "ml_tag_count": int(ml_tag_count)
    }


@router.get("/images/{image_id}", response_model=dict)
async def get_image(
    image_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Get image details with signed thumbnail URL."""
    image = db.query(ImageMetadata).filter_by(
        id=image_id,
        tenant_id=tenant.id
    ).first()

    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    # Get tags
    active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')
    tags = db.query(MachineTag).filter(
        MachineTag.image_id == image_id,
        MachineTag.tenant_id == tenant.id,
        MachineTag.tag_type == active_tag_type
    ).all()

    # Get permatags
    permatags = db.query(Permatag).filter(
        Permatag.image_id == image_id,
        Permatag.tenant_id == tenant.id
    ).all()

    machine_tags_list = [{"keyword": t.keyword, "category": t.category, "confidence": round(t.confidence, 2), "created_at": t.created_at.isoformat() if t.created_at else None} for t in tags]
    permatags_list = [{"id": p.id, "keyword": p.keyword, "category": p.category, "signum": p.signum, "created_at": p.created_at.isoformat() if p.created_at else None} for p in permatags]

    calculated_tags = calculate_tags(machine_tags_list, permatags_list)
    reviewed_at = db.query(func.max(Permatag.created_at)).filter(
        Permatag.tenant_id == tenant.id,
        Permatag.image_id == image_id
    ).scalar()

    # Compute thumbnail_url as in the batch endpoint
    if image.thumbnail_path:
        thumbnail_url = f"https://storage.googleapis.com/{tenant.get_thumbnail_bucket(settings)}/{image.thumbnail_path}"
    else:
        thumbnail_url = None
    return {
        "id": image.id,
        "filename": image.filename,
        "width": image.width,
        "height": image.height,
        "format": image.format,
        "file_size": image.file_size,
        "dropbox_path": image.dropbox_path,
        "camera_make": image.camera_make,
        "camera_model": image.camera_model,
        "perceptual_hash": image.perceptual_hash,
        "thumbnail_path": image.thumbnail_path,
        "thumbnail_url": thumbnail_url,
        "rating": image.rating,
        "reviewed_at": reviewed_at.isoformat() if reviewed_at else None,
        "tags": machine_tags_list,
        "permatags": permatags_list,
        "calculated_tags": calculated_tags,
        "exif_data": image.exif_data,
        "dropbox_properties": image.dropbox_properties,
    }


@router.patch("/images/{image_id}/rating", response_model=dict)
async def update_image_rating(
    image_id: int,
    rating: int = Body(..., embed=True),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Update the rating for an image (0-3)."""
    if rating is not None and (rating < 0 or rating > 3):
        raise HTTPException(status_code=400, detail="Rating must be between 0 and 3.")
    image = db.query(ImageMetadata).filter_by(id=image_id, tenant_id=tenant.id).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    image.rating = rating
    db.commit()
    return {"id": image.id, "rating": image.rating}


@router.get("/images/{image_id}/thumbnail")
async def get_thumbnail(
    image_id: int,
    db: Session = Depends(get_db)
):
    """Get image thumbnail from Cloud Storage with aggressive caching."""
    image = db.query(ImageMetadata).filter_by(
        id=image_id
    ).first()

    if not image or not image.thumbnail_path:
        raise HTTPException(status_code=404, detail="Thumbnail not found")

    # Get tenant to determine correct bucket
    tenant_row = db.query(TenantModel).filter(TenantModel.id == image.tenant_id).first()
    if not tenant_row:
        raise HTTPException(status_code=404, detail=f"Tenant {image.tenant_id} not found")

    tenant = Tenant(
        id=tenant_row.id,
        name=tenant_row.name,
        active=tenant_row.active,
        dropbox_token_secret=f"dropbox-token-{tenant_row.id}",
        dropbox_app_key=f"dropbox-app-key-{tenant_row.id}",
        dropbox_app_secret=f"dropbox-app-secret-{tenant_row.id}",
        storage_bucket=tenant_row.storage_bucket,
        thumbnail_bucket=tenant_row.thumbnail_bucket
    )

    try:
        storage_client = storage.Client(project=settings.gcp_project_id)
        bucket = storage_client.bucket(tenant.get_thumbnail_bucket(settings))
        blob = bucket.blob(image.thumbnail_path)

        if not blob.exists():
            raise HTTPException(status_code=404, detail="Thumbnail not found in storage")

        thumbnail_data = blob.download_as_bytes()

        return StreamingResponse(
            iter([thumbnail_data]),
            media_type="image/jpeg",
            headers={
                "Cache-Control": "public, max-age=3600",  # Cache for 1 hour
                "ETag": f'"{image.id}-{image.modified_time.timestamp() if image.modified_time else 0}"'
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching thumbnail: {str(e)}")


@router.get("/ml-training/images", response_model=dict)
async def list_ml_training_images(
    tenant: Tenant = Depends(get_tenant),
    limit: int = 50,
    offset: int = 0,
    refresh: bool = False,
    db: Session = Depends(get_db)
):
    """List images with permatags, ML tags, and trained-ML tags for comparison."""
    images_query = db.query(ImageMetadata).filter_by(tenant_id=tenant.id)
    total = images_query.count()
    images = images_query.order_by(ImageMetadata.id.desc()).limit(limit).offset(offset).all()

    image_ids = [img.id for img in images]
    if not image_ids:
        return {"tenant_id": tenant.id, "images": [], "total": total, "limit": limit, "offset": offset}

    # Get active tag type from tenant settings
    active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')

    tags = db.query(MachineTag).filter(
        MachineTag.tenant_id == tenant.id,
        MachineTag.image_id.in_(image_ids),
        MachineTag.tag_type == active_tag_type
    ).all()

    permatags = db.query(Permatag).filter(
        Permatag.tenant_id == tenant.id,
        Permatag.image_id.in_(image_ids)
    ).all()

    # Get latest keyword model name
    model_row = db.query(KeywordModel.model_name).filter(
        KeywordModel.tenant_id == tenant.id
    ).order_by(
        func.coalesce(KeywordModel.updated_at, KeywordModel.created_at).desc()
    ).first()

    cached_trained = []
    if model_row:
        cached_trained = db.query(MachineTag).filter(
            MachineTag.tenant_id == tenant.id,
            MachineTag.image_id.in_(image_ids),
            MachineTag.tag_type == 'trained',
            MachineTag.model_name == model_row.model_name
        ).all()

    tags_by_image = {}
    for tag in tags:
        tags_by_image.setdefault(tag.image_id, []).append({
            "keyword": tag.keyword,
            "category": tag.category,
            "confidence": round(tag.confidence, 2)
        })

    permatags_by_image = {}
    for tag in permatags:
        permatags_by_image.setdefault(tag.image_id, []).append(tag)

    trained_by_image = {}
    for tag in cached_trained:
        trained_by_image.setdefault(tag.image_id, []).append({
            "keyword": tag.keyword,
            "category": tag.category,
            "confidence": round(tag.confidence or 0, 2)
        })

    config_mgr = ConfigManager(db, tenant.id)
    all_keywords = config_mgr.get_all_keywords()
    keyword_to_category = {kw['keyword']: kw['category'] for kw in all_keywords}
    by_category = {}
    for kw in all_keywords:
        by_category.setdefault(kw['category'], []).append(kw)

    tagger = get_tagger(model_type=settings.tagging_model)
    model_name = getattr(tagger, "model_name", settings.tagging_model)
    model_version = getattr(tagger, "model_version", model_name)
    keyword_models = load_keyword_models(db, tenant.id, model_name)

    storage_client = storage.Client(project=settings.gcp_project_id)
    thumbnail_bucket = storage_client.bucket(tenant.get_thumbnail_bucket(settings))
    trained_by_model = {
        tag.image_id
        for tag in cached_trained
        if tag.model_name == model_name
    }

    images_list = []
    for image in images:
        positive_permatags = sorted(
            [tag.keyword for tag in permatags_by_image.get(image.id, []) if tag.signum == 1]
        )
        machine_tags = sorted(
            tags_by_image.get(image.id, []),
            key=lambda x: x["confidence"],
            reverse=True
        )

        trained_tags = trained_by_image.get(image.id, [])
        if refresh and keyword_models and image.thumbnail_path and image.id not in trained_by_model:
            blob = thumbnail_bucket.blob(image.thumbnail_path)
            if blob.exists():
                image_data = blob.download_as_bytes()
                trained_tags = recompute_trained_tags_for_image(
                    db=db,
                    tenant_id=tenant.id,
                    image_id=image.id,
                    image_data=image_data,
                    keywords_by_category=by_category,
                    keyword_models=keyword_models,
                    keyword_to_category=keyword_to_category,
                    model_name=model_name,
                    model_version=model_version,
                    model_type=settings.tagging_model,
                    threshold=0.15,
                    model_weight=settings.keyword_model_weight
                )
                trained_by_image[image.id] = trained_tags

        images_list.append({
            "id": image.id,
            "filename": image.filename,
            "thumbnail_url": f"https://storage.googleapis.com/{tenant.get_thumbnail_bucket(settings)}/{image.thumbnail_path}" if image.thumbnail_path else None,
            "embedding_generated": bool(image.embedding_generated),
            "positive_permatags": positive_permatags,
            "ml_tags": machine_tags,
            "trained_tags": trained_tags
        })

    if refresh:
        db.commit()

    return {
        "tenant_id": tenant.id,
        "images": images_list,
        "total": total,
        "limit": limit,
        "offset": offset
    }


@router.get("/ml-training/stats", response_model=dict)
async def get_ml_training_stats(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Return ML training summary stats for a tenant."""
    image_count = db.query(func.count(ImageMetadata.id)).filter(
        ImageMetadata.tenant_id == tenant.id
    ).scalar() or 0

    embedding_count = db.query(func.count(ImageEmbedding.id)).filter(
        ImageEmbedding.tenant_id == tenant.id
    ).scalar() or 0

    zero_shot_image_count = db.query(func.count(distinct(MachineTag.image_id))).filter(
        MachineTag.tenant_id == tenant.id,
        MachineTag.tag_type == 'siglip'
    ).scalar() or 0

    model_count = db.query(func.count(KeywordModel.id)).filter(
        KeywordModel.tenant_id == tenant.id
    ).scalar() or 0

    last_trained = db.query(func.max(func.coalesce(
        KeywordModel.updated_at,
        KeywordModel.created_at
    ))).filter(
        KeywordModel.tenant_id == tenant.id
    ).scalar()

    trained_count, trained_oldest, trained_newest = db.query(
        func.count(MachineTag.id),
        func.min(MachineTag.created_at),
        func.max(MachineTag.created_at)
    ).filter(
        MachineTag.tenant_id == tenant.id,
        MachineTag.tag_type == 'trained'
    ).one()

    trained_image_count = db.query(func.count(distinct(MachineTag.image_id))).filter(
        MachineTag.tenant_id == tenant.id,
        MachineTag.tag_type == 'trained'
    ).scalar() or 0

    return {
        "tenant_id": tenant.id,
        "image_count": int(image_count),
        "embedding_count": int(embedding_count),
        "zero_shot_image_count": int(zero_shot_image_count),
        "trained_image_count": int(trained_image_count),
        "keyword_model_count": int(model_count),
        "keyword_model_last_trained": last_trained.isoformat() if last_trained else None,
        "trained_tag_count": int(trained_count or 0),
        "trained_tag_oldest": trained_oldest.isoformat() if trained_oldest else None,
        "trained_tag_newest": trained_newest.isoformat() if trained_newest else None
    }


@router.get("/images/{image_id}/permatags", response_model=dict)
async def get_permatags(
    image_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Get all permatags for an image."""
    image = db.query(ImageMetadata).filter_by(
        id=image_id,
        tenant_id=tenant.id
    ).first()

    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    permatags = db.query(Permatag).filter(
        Permatag.image_id == image_id,
        Permatag.tenant_id == tenant.id
    ).all()

    return {
        "image_id": image_id,
        "permatags": [
            {
                "id": p.id,
                "keyword": p.keyword,
                "category": p.category,
                "signum": p.signum,
                "created_at": p.created_at.isoformat(),
                "created_by": p.created_by
            }
            for p in permatags
        ]
    }


@router.post("/images/{image_id}/permatags", response_model=dict)
async def add_permatag(
    image_id: int,
    request: Request,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Add or update a permatag for an image."""
    body = await request.json()
    keyword = body.get("keyword")
    category = body.get("category")
    signum = body.get("signum", 1)

    if not keyword:
        raise HTTPException(status_code=400, detail="keyword is required")

    if signum not in [-1, 1]:
        raise HTTPException(status_code=400, detail="signum must be -1 or 1")

    image = db.query(ImageMetadata).filter_by(
        id=image_id,
        tenant_id=tenant.id
    ).first()

    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    # Check if permatag already exists (update or insert)
    existing = db.query(Permatag).filter(
        Permatag.image_id == image_id,
        Permatag.tenant_id == tenant.id,
        Permatag.keyword == keyword
    ).first()

    if existing:
        # Update existing permatag
        existing.category = category
        existing.signum = signum
        existing.created_at = datetime.utcnow()
        permatag = existing
    else:
        # Create new permatag
        permatag = Permatag(
            image_id=image_id,
            tenant_id=tenant.id,
            keyword=keyword,
            category=category,
            signum=signum,
            created_by=None  # Could be set from auth header if available
        )
        db.add(permatag)

    db.commit()
    db.refresh(permatag)

    return {
        "id": permatag.id,
        "keyword": permatag.keyword,
        "category": permatag.category,
        "signum": permatag.signum,
        "created_at": permatag.created_at.isoformat()
    }


@router.delete("/images/{image_id}/permatags/{permatag_id}", response_model=dict)
async def delete_permatag(
    image_id: int,
    permatag_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Delete a permatag."""
    permatag = db.query(Permatag).filter(
        Permatag.id == permatag_id,
        Permatag.image_id == image_id,
        Permatag.tenant_id == tenant.id
    ).first()

    if not permatag:
        raise HTTPException(status_code=404, detail="Permatag not found")

    db.delete(permatag)
    db.commit()

    return {"success": True}


@router.post("/images/{image_id}/permatags/accept-all", response_model=dict)
async def accept_all_tags(
    image_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Accept all current tags as positive permatags and create negative permatags for all other keywords."""
    image = db.query(ImageMetadata).filter_by(
        id=image_id,
        tenant_id=tenant.id
    ).first()

    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    # Get current machine tags
    active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')
    current_tags = db.query(MachineTag).filter(
        MachineTag.image_id == image_id,
        MachineTag.tenant_id == tenant.id,
        MachineTag.tag_type == active_tag_type
    ).all()

    # Get all keywords from config
    config_manager = ConfigManager(db, tenant.id)
    all_keywords = config_manager.get_all_keywords()

    # Build set of current tag keywords
    current_keywords = {tag.keyword for tag in current_tags}
    all_keyword_names = {kw['keyword'] for kw in all_keywords}

    # Delete existing permatags ONLY for keywords in the controlled vocabulary
    # This preserves manually added permatags for keywords not in the vocabulary
    db.query(Permatag).filter(
        Permatag.image_id == image_id,
        Permatag.tenant_id == tenant.id,
        Permatag.keyword.in_(all_keyword_names)
    ).delete(synchronize_session=False)

    # Create positive permatags for all current tags
    for tag in current_tags:
        permatag = Permatag(
            image_id=image_id,
            tenant_id=tenant.id,
            keyword=tag.keyword,
            category=tag.category,
            signum=1
        )
        db.add(permatag)

    # Create negative permatags for all keywords NOT in current tags
    for kw_info in all_keywords:
        keyword = kw_info['keyword']
        if keyword not in current_keywords:
            permatag = Permatag(
                image_id=image_id,
                tenant_id=tenant.id,
                keyword=keyword,
                category=kw_info['category'],
                signum=-1
            )
            db.add(permatag)

    db.commit()

    # Return counts
    positive_count = len(current_keywords)
    negative_count = len(all_keyword_names - current_keywords)

    return {
        "success": True,
        "positive_permatags": positive_count,
        "negative_permatags": negative_count
    }


@router.post("/images/{image_id}/permatags/freeze", response_model=dict)
async def freeze_permatags(
    image_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Create permatags for all keywords without existing permatags."""
    image = db.query(ImageMetadata).filter_by(
        id=image_id,
        tenant_id=tenant.id
    ).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    config_manager = ConfigManager(db, tenant.id)
    all_keywords = config_manager.get_all_keywords()
    keyword_to_category = {kw['keyword']: kw['category'] for kw in all_keywords}
    all_keyword_names = set(keyword_to_category.keys())

    active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')
    machine_tags = db.query(MachineTag).filter(
        MachineTag.image_id == image_id,
        MachineTag.tenant_id == tenant.id,
        MachineTag.tag_type == active_tag_type
    ).all()
    machine_tag_names = {tag.keyword for tag in machine_tags}

    existing_permatags = db.query(Permatag).filter(
        Permatag.image_id == image_id,
        Permatag.tenant_id == tenant.id,
        Permatag.keyword.in_(all_keyword_names)
    ).all()
    existing_keywords = {p.keyword for p in existing_permatags}

    positive_count = 0
    negative_count = 0
    for keyword in all_keyword_names:
        if keyword in existing_keywords:
            continue
        signum = 1 if keyword in machine_tag_names else -1
        permatag = Permatag(
            image_id=image_id,
            tenant_id=tenant.id,
            keyword=keyword,
            category=keyword_to_category.get(keyword),
            signum=signum,
            created_by=None
        )
        db.add(permatag)
        if signum == 1:
            positive_count += 1
        else:
            negative_count += 1

    db.commit()

    return {
        "success": True,
        "positive_permatags": positive_count,
        "negative_permatags": negative_count
    }


@router.post("/images/upload", response_model=dict)
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
                        threshold=0.15
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


@router.get("/images/{image_id}/analyze", response_model=dict)
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
        # Download thumbnail
        blob = thumbnail_bucket.blob(image.thumbnail_path)
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
            "threshold": 0.15,  # Show current threshold
            "scores_by_category": all_scores_by_category
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error analyzing {image.filename}: {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


@router.post("/images/{image_id}/retag", response_model=dict)
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
        # Delete existing tags
        db.query(MachineTag).filter(
            MachineTag.image_id == image.id,
            MachineTag.tag_type == 'siglip'
        ).delete()

        # Download thumbnail
        blob = thumbnail_bucket.blob(image.thumbnail_path)
        if not blob.exists():
            raise HTTPException(status_code=404, detail="Thumbnail not found in storage")

        image_data = blob.download_as_bytes()

        model_scores = None
        if settings.use_keyword_models:
            embedding_record = ensure_image_embedding(
                db,
                tenant.id,
                image.id,
                image_data,
                model_name,
                model_version
            )
            keyword_models = load_keyword_models(db, tenant.id, model_name)
            model_scores = score_image_with_models(embedding_record.embedding, keyword_models)

        all_tags = score_keywords_for_categories(
            image_data=image_data,
            keywords_by_category=by_category,
            model_type=model_type,
            threshold=0.15,
            model_scores=model_scores,
            model_weight=settings.keyword_model_weight
        )

        # Create new tags
        keyword_to_category = {kw['keyword']: kw['category'] for kw in all_keywords}

        for keyword, confidence in all_tags:
            tag = MachineTag(
                image_id=image.id,
                tenant_id=tenant.id,
                keyword=keyword,
                category=keyword_to_category[keyword],
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


@router.post("/retag", response_model=dict)
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

    # Setup CLIP tagger and storage
    model_type = model or settings.tagging_model
    tagger = get_tagger(model_type=model_type)
    model_name = getattr(tagger, "model_name", model_type)
    model_version = getattr(tagger, "model_version", model_name)
    storage_client = storage.Client(project=settings.gcp_project_id)
    thumbnail_bucket = storage_client.bucket(tenant.get_thumbnail_bucket(settings))

    processed = 0
    failed = 0

    for image in images:
        try:
            # Delete existing tags
            db.query(MachineTag).filter(
                MachineTag.image_id == image.id,
                MachineTag.tag_type == 'siglip'
            ).delete()

            # Download thumbnail
            blob = thumbnail_bucket.blob(image.thumbnail_path)
            if not blob.exists():
                failed += 1
                continue

            image_data = blob.download_as_bytes()

            model_scores = None
            if settings.use_keyword_models:
                embedding_record = ensure_image_embedding(
                    db,
                    tenant.id,
                    image.id,
                    image_data,
                    model_name,
                    model_version
                )
                keyword_models = load_keyword_models(db, tenant.id, model_name)
                model_scores = score_image_with_models(embedding_record.embedding, keyword_models)

            all_tags = score_keywords_for_categories(
                image_data=image_data,
                keywords_by_category=by_category,
                model_type=model_type,
                threshold=0.15,
                model_scores=model_scores,
                model_weight=settings.keyword_model_weight
            )

            # Create new tags
            keyword_to_category = {kw['keyword']: kw['category'] for kw in all_keywords}

            for keyword, confidence in all_tags:
                tag = MachineTag(
                    image_id=image.id,
                    tenant_id=tenant.id,
                    keyword=keyword,
                    category=keyword_to_category[keyword],
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
