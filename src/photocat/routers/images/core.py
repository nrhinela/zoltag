"""Core image endpoints: list, get, stats, rating, thumbnail."""

import json
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Body
from fastapi.responses import StreamingResponse
from sqlalchemy import func, distinct, and_
from sqlalchemy.orm import Session
from google.cloud import storage

from photocat.dependencies import get_db, get_tenant, get_tenant_setting
from photocat.tenant import Tenant
from photocat.metadata import ImageMetadata, MachineTag, Permatag, Tenant as TenantModel, KeywordModel
from photocat.models.config import PhotoList, PhotoListItem, Keyword
from photocat.settings import settings
from photocat.tagging import calculate_tags

# Sub-router with no prefix/tags (inherits from parent)
router = APIRouter()


def get_keyword_name(db: Session, keyword_id: int) -> Optional[str]:
    """Get keyword name from keyword_id."""
    keyword = db.query(Keyword.keyword).filter(Keyword.id == keyword_id).first()
    return keyword[0] if keyword else None


def get_keyword_category_name(db: Session, keyword_id: int) -> Optional[str]:
    """Get category name from keyword_id via the keyword's category_id."""
    from photocat.models.config import KeywordCategory
    result = db.query(KeywordCategory.name).join(
        Keyword, Keyword.category_id == KeywordCategory.id
    ).filter(Keyword.id == keyword_id).first()
    return result[0] if result else None


@router.get("/images", response_model=dict, operation_id="list_images")
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
    permatag_keyword: Optional[str] = None,
    permatag_category: Optional[str] = None,
    permatag_signum: Optional[int] = None,
    permatag_missing: bool = False,
    category_filter_source: Optional[str] = None,
    date_order: str = "desc",
    order_by: Optional[str] = None,
    ml_keyword: Optional[str] = None,
    ml_tag_type: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """List images for tenant with optional faceted search by keywords."""
    from ..filtering import (
        apply_list_filter,
        apply_rating_filter,
        apply_hide_zero_rating_filter,
        apply_reviewed_filter,
        apply_permatag_filter,
        apply_category_filters,
        calculate_relevance_scores
    )

    filter_ids = None
    if list_id is not None:
        filter_ids = apply_list_filter(db, tenant, list_id)

    if rating is not None:
        filter_ids = apply_rating_filter(db, tenant, rating, rating_operator, filter_ids)

    if hide_zero_rating:
        filter_ids = apply_hide_zero_rating_filter(db, tenant, filter_ids)

    if reviewed is not None:
        filter_ids = apply_reviewed_filter(db, tenant, reviewed, filter_ids)

    if permatag_keyword:
        filter_ids = apply_permatag_filter(
            db,
            tenant,
            permatag_keyword,
            signum=permatag_signum,
            missing=permatag_missing,
            category=permatag_category,
            existing_filter=filter_ids
        )

    if filter_ids is not None and not filter_ids:
        return {
            "tenant_id": tenant.id,
            "images": [],
            "total": 0,
            "limit": limit,
            "offset": offset
        }

    # Handle per-category filters if provided
    ml_keyword_id = None
    if ml_keyword:
        normalized_keyword = ml_keyword.strip().lower()
        if normalized_keyword:
            keyword_row = db.query(Keyword.id).filter(
                func.lower(Keyword.keyword) == normalized_keyword,
                Keyword.tenant_id == tenant.id
            ).first()
            if keyword_row:
                ml_keyword_id = keyword_row[0]

    date_order = (date_order or "desc").lower()
    if date_order not in ("asc", "desc"):
        date_order = "desc"
    order_by_value = (order_by or "").lower()
    if order_by_value not in ("photo_creation", "image_id", "ml_score"):
        order_by_value = None
    if order_by_value == "ml_score" and not ml_keyword_id:
        order_by_value = None
    order_by_date = func.coalesce(ImageMetadata.capture_timestamp, ImageMetadata.modified_time)
    order_by_date = order_by_date.desc() if date_order == "desc" else order_by_date.asc()
    id_order = ImageMetadata.id.desc() if date_order == "desc" else ImageMetadata.id.asc()
    order_by_clauses = (id_order,) if order_by_value == "image_id" else (order_by_date, id_order)

    if category_filters:
        try:
            filters = json.loads(category_filters)

            # Apply category filters using helper
            unique_image_ids_set = apply_category_filters(
                db,
                tenant,
                category_filters,
                filter_ids,
                source=category_filter_source or "current"
            )

            if unique_image_ids_set:
                unique_image_ids = list(unique_image_ids_set)

                # Get all keywords for relevance counting
                all_keywords = []
                for filter_data in filters.values():
                    all_keywords.extend(filter_data.get('keywords', []))

                # Total count of matching images
                total = len(unique_image_ids)

                if total:
                    # Get active tag type for scoring
                    active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')

                    date_rows = db.query(
                        ImageMetadata.id,
                        ImageMetadata.capture_timestamp,
                        ImageMetadata.modified_time,
                    ).filter(ImageMetadata.id.in_(unique_image_ids)).all()
                    date_map = {
                        row[0]: row[1] or row[2]
                        for row in date_rows
                    }
                    if order_by_value == "image_id":
                        sorted_ids = sorted(
                            unique_image_ids,
                            key=lambda img_id: -img_id if date_order == "desc" else img_id
                        )
                    elif order_by_value == "photo_creation":
                        def date_key(img_id: int) -> float:
                            date_value = date_map.get(img_id)
                            if not date_value:
                                return float('inf')
                            ts = date_value.timestamp()
                            return -ts if date_order == "desc" else ts

                        sorted_ids = sorted(
                            unique_image_ids,
                            key=lambda img_id: (
                                date_key(img_id),
                                -img_id if date_order == "desc" else img_id
                            )
                        )
                    else:
                        # Calculate relevance scores using helper
                        score_map = calculate_relevance_scores(db, tenant, unique_image_ids, all_keywords, active_tag_type)
                        # Sort unique_image_ids by relevance score (descending), then by date (order), then by ID (order)
                        sorted_ids = sorted(
                            unique_image_ids,
                            key=lambda img_id: (
                                -(score_map.get(img_id) or 0),
                                (
                                    -(date_map.get(img_id).timestamp())
                                    if date_map.get(img_id) and date_order == "desc"
                                    else (date_map.get(img_id).timestamp() if date_map.get(img_id) else float('inf'))
                                ),
                                -img_id if date_order == "desc" else img_id
                            )
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
            images = query.order_by(*order_by_clauses).limit(limit).offset(offset).all() if limit else query.order_by(*order_by_clauses).offset(offset).all()

    # Apply keyword filtering if provided (legacy support)
    elif keywords:
        keyword_list = [k.strip() for k in keywords.split(',') if k.strip()]

        if keyword_list and operator.upper() == "OR":
            # OR: Image must have ANY of the selected keywords
            # Get active tag type for filtering
            active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')

            # Find keyword IDs for the given keyword names
            keyword_ids = db.query(Keyword.id).filter(
                Keyword.keyword.in_(keyword_list),
                Keyword.tenant_id == tenant.id
            ).all()
            keyword_id_list = [kw[0] for kw in keyword_ids]

            if not keyword_id_list:
                # No matching keywords, return empty result
                images = []
                total = 0
            else:
                # Use subquery to get image IDs that match keywords
                matching_image_ids = db.query(MachineTag.image_id).filter(
                    MachineTag.keyword_id.in_(keyword_id_list),
                    MachineTag.tenant_id == tenant.id,
                    MachineTag.tag_type == active_tag_type
                ).distinct().subquery()

                # Main query with relevance ordering (by sum of confidence scores)
                order_by_date = func.coalesce(ImageMetadata.capture_timestamp, ImageMetadata.modified_time).desc()
                query = db.query(
                    ImageMetadata,
                    func.sum(MachineTag.confidence).label('relevance_score')
                ).join(
                    MachineTag,
                    and_(
                        MachineTag.image_id == ImageMetadata.id,
                        MachineTag.keyword_id.in_(keyword_id_list),
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
                    order_by_date,
                    id_order
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

            # Find keyword IDs for the given keyword names
            keyword_ids = db.query(Keyword.id).filter(
                Keyword.keyword.in_(keyword_list),
                Keyword.tenant_id == tenant.id
            ).all()
            keyword_id_list = [kw[0] for kw in keyword_ids]

            if not keyword_id_list or len(keyword_id_list) < len(keyword_list):
                # Not all keywords exist, return empty result
                images = []
                total = 0
            else:
                # Start with images that have tenant_id
                base_query = db.query(ImageMetadata.id).filter_by(tenant_id=tenant.id)

                # For each keyword, filter images that have that keyword
                for keyword_id in keyword_id_list:
                    subquery = db.query(MachineTag.image_id).filter(
                        MachineTag.keyword_id == keyword_id,
                        MachineTag.tenant_id == tenant.id,
                        MachineTag.tag_type == active_tag_type
                    ).subquery()

                    base_query = base_query.filter(ImageMetadata.id.in_(subquery))

                if filter_ids is not None:
                    base_query = base_query.filter(ImageMetadata.id.in_(filter_ids))

                # Get matching image IDs
                matching_image_ids = base_query.subquery()

                # Query with relevance ordering (by sum of confidence scores)
                order_by_date = func.coalesce(ImageMetadata.capture_timestamp, ImageMetadata.modified_time).desc()
                query = db.query(
                    ImageMetadata,
                    func.sum(MachineTag.confidence).label('relevance_score')
                ).join(
                    MachineTag,
                    and_(
                        MachineTag.image_id == ImageMetadata.id,
                        MachineTag.keyword_id.in_(keyword_id_list),
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
                    order_by_date,
                    id_order
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
            order_by_date = func.coalesce(ImageMetadata.capture_timestamp, ImageMetadata.modified_time).desc()
            images = query.order_by(*order_by_clauses).limit(limit).offset(offset).all() if limit else query.order_by(*order_by_clauses).offset(offset).all()
    else:
        # No keywords filter, return all
        query = db.query(ImageMetadata).filter_by(tenant_id=tenant.id)
        if filter_ids is not None:
            query = query.filter(ImageMetadata.id.in_(filter_ids))
        total = query.count()
        if order_by_value == "ml_score" and ml_keyword_id:
            active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')
            selected_tag_type = (ml_tag_type or active_tag_type).strip().lower()
            model_name = None
            if selected_tag_type == 'trained':
                model_row = db.query(KeywordModel.model_name).filter(
                    KeywordModel.tenant_id == tenant.id
                ).order_by(
                    func.coalesce(KeywordModel.updated_at, KeywordModel.created_at).desc()
                ).first()
                if model_row:
                    model_name = model_row[0]
            ml_scores = db.query(
                MachineTag.image_id.label('image_id'),
                func.max(MachineTag.confidence).label('ml_score')
            ).filter(
                MachineTag.keyword_id == ml_keyword_id,
                MachineTag.tenant_id == tenant.id,
                MachineTag.tag_type == selected_tag_type,
                *([MachineTag.model_name == model_name] if model_name else [])
            ).group_by(
                MachineTag.image_id
            ).subquery()
            scored_query = query.outerjoin(ml_scores, ml_scores.c.image_id == ImageMetadata.id)
            order_clauses = (
                ml_scores.c.ml_score.desc().nullslast(),
                order_by_date,
                id_order
            )
            images = scored_query.order_by(*order_clauses).limit(limit).offset(offset).all() if limit else scored_query.order_by(*order_clauses).offset(offset).all()
        else:
            images = query.order_by(*order_by_clauses).limit(limit).offset(offset).all() if limit else query.order_by(*order_by_clauses).offset(offset).all()

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
        Permatag.image_id.in_(image_ids)
    ).all() if image_ids else []

    # Load all keywords to avoid N+1 queries
    keyword_ids = set()
    for tag in tags:
        keyword_ids.add(tag.keyword_id)
    for permatag in permatags:
        keyword_ids.add(permatag.keyword_id)

    # Build keyword lookup map
    keywords_map = {}
    if keyword_ids:
        from photocat.models.config import KeywordCategory
        keywords_data = db.query(
            Keyword.id,
            Keyword.keyword,
            KeywordCategory.name
        ).join(
            KeywordCategory, Keyword.category_id == KeywordCategory.id
        ).filter(
            Keyword.id.in_(keyword_ids)
        ).all()
        for kw_id, kw_name, cat_name in keywords_data:
            keywords_map[kw_id] = {"keyword": kw_name, "category": cat_name}

    # Group tags by image_id
    tags_by_image = {}
    for tag in tags:
        if tag.image_id not in tags_by_image:
            tags_by_image[tag.image_id] = []
        kw_info = keywords_map.get(tag.keyword_id, {"keyword": "unknown", "category": "unknown"})
        tags_by_image[tag.image_id].append({
            "keyword": kw_info["keyword"],
            "category": kw_info["category"],
            "confidence": round(tag.confidence, 2)
        })

    # Group permatags by image_id
    permatags_by_image = {}
    reviewed_at_by_image = {}
    for permatag in permatags:
        if permatag.image_id not in permatags_by_image:
            permatags_by_image[permatag.image_id] = []
        kw_info = keywords_map.get(permatag.keyword_id, {"keyword": "unknown", "category": "unknown"})
        permatags_by_image[permatag.image_id].append({
            "id": permatag.id,
            "keyword": kw_info["keyword"],
            "category": kw_info["category"],
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
            "shutter_speed": img.shutter_speed,
            "focal_length": img.focal_length,
            "gps_latitude": img.gps_latitude,
            "gps_longitude": img.gps_longitude,
            "capture_timestamp": img.capture_timestamp.isoformat() if img.capture_timestamp else None,
            "modified_time": img.modified_time.isoformat() if img.modified_time else None,
            "created_at": img.created_at.isoformat() if img.created_at else None,
            "thumbnail_path": img.thumbnail_path,
            "thumbnail_url": tenant.get_thumbnail_url(settings, img.thumbnail_path),
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


@router.get("/images/stats", response_model=dict, operation_id="get_image_stats")
async def get_image_stats(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Return image summary stats for a tenant."""
    image_count = db.query(func.count(ImageMetadata.id)).filter(
        ImageMetadata.tenant_id == tenant.id
    ).scalar() or 0

    reviewed_image_count = db.query(func.count(distinct(Permatag.image_id))).join(
        ImageMetadata, ImageMetadata.id == Permatag.image_id
    ).filter(
        ImageMetadata.tenant_id == tenant.id
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


@router.get("/images/{image_id}", response_model=dict, operation_id="get_image")
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
        MachineTag.tenant_id == tenant.id
    ).all()

    # Get permatags
    permatags = db.query(Permatag).filter(
        Permatag.image_id == image_id
    ).all()

    # Load keyword info for all tags
    keyword_ids = set()
    for tag in tags:
        keyword_ids.add(tag.keyword_id)
    for permatag in permatags:
        keyword_ids.add(permatag.keyword_id)

    # Build keyword lookup map
    keywords_map = {}
    if keyword_ids:
        from photocat.models.config import KeywordCategory
        keywords_data = db.query(
            Keyword.id,
            Keyword.keyword,
            KeywordCategory.name
        ).join(
            KeywordCategory, Keyword.category_id == KeywordCategory.id
        ).filter(
            Keyword.id.in_(keyword_ids)
        ).all()
        for kw_id, kw_name, cat_name in keywords_data:
            keywords_map[kw_id] = {"keyword": kw_name, "category": cat_name}

    tags_by_type = {}
    for tag in tags:
        kw_info = keywords_map.get(tag.keyword_id, {"keyword": "unknown", "category": "unknown"})
        tags_by_type.setdefault(tag.tag_type, []).append({
            "keyword": kw_info["keyword"],
            "category": kw_info["category"],
            "confidence": round(tag.confidence, 2),
            "created_at": tag.created_at.isoformat() if tag.created_at else None
        })
    machine_tags_list = tags_by_type.get(active_tag_type, [])
    permatags_list = []
    for p in permatags:
        kw_info = keywords_map.get(p.keyword_id, {"keyword": "unknown", "category": "unknown"})
        permatags_list.append({
            "id": p.id,
            "keyword": kw_info["keyword"],
            "category": kw_info["category"],
            "signum": p.signum,
            "created_at": p.created_at.isoformat() if p.created_at else None
        })

    calculated_tags = calculate_tags(machine_tags_list, permatags_list)
    reviewed_at = db.query(func.max(Permatag.created_at)).filter(
        Permatag.image_id == image_id
    ).scalar()

    # Compute thumbnail_url as in the batch endpoint
    thumbnail_url = tenant.get_thumbnail_url(settings, image.thumbnail_path)
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
        "lens_model": image.lens_model,
        "iso": image.iso,
        "aperture": image.aperture,
        "shutter_speed": image.shutter_speed,
        "focal_length": image.focal_length,
        "gps_latitude": image.gps_latitude,
        "gps_longitude": image.gps_longitude,
        "capture_timestamp": image.capture_timestamp.isoformat() if image.capture_timestamp else None,
        "modified_time": image.modified_time.isoformat() if image.modified_time else None,
        "created_at": image.created_at.isoformat() if image.created_at else None,
        "perceptual_hash": image.perceptual_hash,
        "thumbnail_path": image.thumbnail_path,
        "thumbnail_url": thumbnail_url,
        "rating": image.rating,
        "reviewed_at": reviewed_at.isoformat() if reviewed_at else None,
        "tags": machine_tags_list,
        "machine_tags_by_type": tags_by_type,
        "permatags": permatags_list,
        "calculated_tags": calculated_tags,
        "exif_data": image.exif_data,
        "dropbox_properties": image.dropbox_properties,
    }


@router.patch("/images/{image_id}/rating", response_model=dict, operation_id="update_image_rating")
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


@router.get("/images/{image_id}/thumbnail", operation_id="get_thumbnail")
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
