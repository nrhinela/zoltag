"""Core image endpoints: list, get, stats, rating, thumbnail."""

import json
import mimetypes
from datetime import datetime
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Body
from fastapi.responses import StreamingResponse
from sqlalchemy import func, distinct, and_
from sqlalchemy.orm import Session
from google.cloud import storage
from dropbox import Dropbox

from photocat.dependencies import get_db, get_tenant, get_tenant_setting, get_secret
from photocat.tenant import Tenant
from photocat.metadata import ImageMetadata, MachineTag, Permatag, Tenant as TenantModel, KeywordModel
from photocat.models.config import PhotoList, PhotoListItem, Keyword
from photocat.settings import settings
from photocat.tagging import calculate_tags
from photocat.config.db_utils import load_keywords_map
from photocat.image import ImageProcessor
from photocat.exif import (
    get_exif_value,
    parse_exif_datetime,
    parse_exif_float,
    parse_exif_int,
    parse_exif_str,
)

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


@router.get("/images/dropbox-folders")
async def list_dropbox_folders(
    tenant: Tenant = Depends(get_tenant),
    q: Optional[str] = None,
    limit: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """List Dropbox folder paths for a tenant, filtered by query."""
    parent_expr = func.regexp_replace(ImageMetadata.dropbox_path, "/[^/]+$", "")
    folder_expr = func.coalesce(func.nullif(parent_expr, ""), "/")
    query = db.query(folder_expr.label("folder")).filter(
        ImageMetadata.tenant_id == tenant.id,
        ImageMetadata.dropbox_path.isnot(None),
    )
    if q:
        query = query.filter(folder_expr.ilike(f"%{q}%"))
    query = query.distinct().order_by(folder_expr)
    if limit:
        query = query.limit(limit)
    rows = query.all()
    folders = [row[0] for row in rows]
    return {"tenant_id": tenant.id, "folders": folders}


@router.get("/images", response_model=dict, operation_id="list_images")
async def list_images(
    tenant: Tenant = Depends(get_tenant),
    limit: int = 100,
    offset: int = 0,
    anchor_id: Optional[int] = None,
    keywords: Optional[str] = None,  # Comma-separated keywords (deprecated)
    operator: str = "OR",  # "AND" or "OR" (deprecated)
    category_filters: Optional[str] = None,  # JSON string with per-category filters
    list_id: Optional[int] = None,
    rating: Optional[int] = None,
    rating_operator: str = "eq",
    hide_zero_rating: bool = False,
    reviewed: Optional[bool] = None,
    dropbox_path_prefix: Optional[str] = None,
    permatag_keyword: Optional[str] = None,
    permatag_category: Optional[str] = None,
    permatag_signum: Optional[int] = None,
    permatag_missing: bool = False,
    permatag_positive_missing: bool = False,
    category_filter_source: Optional[str] = None,
    date_order: str = "desc",
    order_by: Optional[str] = None,
    ml_keyword: Optional[str] = None,
    ml_tag_type: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """List images for tenant with optional faceted search by keywords."""
    from ..filtering import (
        apply_category_filters,
        calculate_relevance_scores,
        build_image_query_with_subqueries
    )

    base_query, subqueries_list, has_empty_filter = build_image_query_with_subqueries(
        db,
        tenant,
        list_id=list_id,
        rating=rating,
        rating_operator=rating_operator,
        hide_zero_rating=hide_zero_rating,
        reviewed=reviewed,
        dropbox_path_prefix=dropbox_path_prefix,
        permatag_keyword=permatag_keyword,
        permatag_category=permatag_category,
        permatag_signum=permatag_signum,
        permatag_missing=permatag_missing,
        permatag_positive_missing=permatag_positive_missing,
        ml_keyword=ml_keyword,
        ml_tag_type=ml_tag_type
    )

    # If any filter resulted in empty set, return empty response
    if has_empty_filter:
        return {
            "tenant_id": tenant.id,
            "images": [],
            "total": 0,
            "limit": limit,
            "offset": offset
        }

    def resolve_anchor_offset(query, current_offset):
        if anchor_id is None or limit is None:
            return current_offset
        order_by_clauses = getattr(query, "_order_by_clauses", None)
        if not order_by_clauses:
            return current_offset
        subquery = query.with_entities(
            ImageMetadata.id.label("image_id"),
            func.row_number().over(order_by=order_by_clauses).label("rn")
        ).subquery()
        rn = db.query(subquery.c.rn).filter(subquery.c.image_id == anchor_id).scalar()
        if rn is None:
            return current_offset
        return max(int(rn) - 1, 0)

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
    if order_by_value not in ("photo_creation", "image_id", "processed", "ml_score", "rating"):
        order_by_value = None
    if order_by_value == "ml_score" and not ml_keyword_id:
        order_by_value = None
    if order_by_value == "processed":
        order_by_date = func.coalesce(ImageMetadata.last_processed, ImageMetadata.created_at)
    else:
        order_by_date = func.coalesce(ImageMetadata.capture_timestamp, ImageMetadata.modified_time)
    order_by_date = order_by_date.desc() if date_order == "desc" else order_by_date.asc()
    id_order = ImageMetadata.id.desc() if date_order == "desc" else ImageMetadata.id.asc()
    if order_by_value == "image_id":
        order_by_clauses = (id_order,)
    elif order_by_value == "rating":
        rating_order = ImageMetadata.rating.desc() if date_order == "desc" else ImageMetadata.rating.asc()
        rating_order = rating_order.nullslast()
        order_by_clauses = (rating_order, order_by_date, id_order)
    else:
        order_by_clauses = (order_by_date, id_order)

    if category_filters:
        try:
            from .query_builder import QueryBuilder

            filters = json.loads(category_filters)
            builder = QueryBuilder(db, tenant, date_order, order_by_value)

            # Apply category filters using helper
            unique_image_ids_set = apply_category_filters(
                db,
                tenant,
                category_filters,
                None,  # category_filters handles its own filtering now
                source=category_filter_source or "current"
            )

            if unique_image_ids_set:
                unique_image_ids = list(unique_image_ids_set)

                if subqueries_list:
                    unique_image_ids = builder.apply_filters_to_id_set(unique_image_ids, subqueries_list)

                # Get all keywords for relevance counting
                all_keywords = []
                for filter_data in filters.values():
                    all_keywords.extend(filter_data.get('keywords', []))

                # Total count of matching images
                total = builder.get_total_count(unique_image_ids)

                if total:
                    # Get active tag type for scoring
                    active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')

                    date_rows = db.query(
                        ImageMetadata.id,
                        ImageMetadata.capture_timestamp,
                        ImageMetadata.modified_time,
                        ImageMetadata.last_processed,
                        ImageMetadata.created_at,
                        ImageMetadata.rating,
                    ).filter(ImageMetadata.id.in_(unique_image_ids)).all()
                    rating_map = {row[0]: row[5] for row in date_rows}
                    if order_by_value == "processed":
                        date_map = {
                            row[0]: row[3] or row[4]
                            for row in date_rows
                        }
                    else:
                        date_map = {
                            row[0]: row[1] or row[2]
                            for row in date_rows
                        }
                    def date_key(img_id: int) -> float:
                        date_value = date_map.get(img_id)
                        if not date_value:
                            return float('inf')
                        ts = date_value.timestamp()
                        return -ts if date_order == "desc" else ts

                    def rating_key(img_id: int) -> tuple:
                        rating_value = rating_map.get(img_id)
                        if rating_value is None:
                            return (1, 0)
                        score = -rating_value if date_order == "desc" else rating_value
                        return (0, score)
                    if order_by_value == "image_id":
                        sorted_ids = sorted(
                            unique_image_ids,
                            key=lambda img_id: -img_id if date_order == "desc" else img_id
                        )
                    elif order_by_value in ("photo_creation", "processed"):
                        sorted_ids = sorted(
                            unique_image_ids,
                            key=lambda img_id: (
                                date_key(img_id),
                                -img_id if date_order == "desc" else img_id
                            )
                        )
                    elif order_by_value == "rating":
                        sorted_ids = sorted(
                            unique_image_ids,
                            key=lambda img_id: (
                                rating_key(img_id),
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

                    # Apply anchor offset if requested
                    if anchor_id is not None and limit is not None:
                        try:
                            anchor_index = sorted_ids.index(anchor_id)
                            offset = anchor_index
                        except ValueError:
                            pass

                    # Apply offset and limit
                    paginated_ids = builder.paginate_id_list(sorted_ids, offset, limit)

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
            query = query.order_by(*order_by_clauses)
            offset = resolve_anchor_offset(query, offset)
            images = query.limit(limit).offset(offset).all() if limit else query.offset(offset).all()

    # Apply keyword filtering if provided (legacy support)
    elif keywords:
        from .query_builder import QueryBuilder

        keyword_list = [k.strip() for k in keywords.split(',') if k.strip()]
        builder = QueryBuilder(db, tenant, date_order, order_by_value)

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

                # Apply base_query subquery filters (list, rating, etc.) to the keyword query
                query = builder.apply_subqueries(query, subqueries_list)

                total = builder.get_total_count(query)
                offset = resolve_anchor_offset(query, offset)
                results = builder.apply_pagination(query, offset, limit)
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
                and_query = db.query(ImageMetadata.id).filter_by(tenant_id=tenant.id)

                # For each keyword, filter images that have that keyword
                for keyword_id in keyword_id_list:
                    keyword_subquery = db.query(MachineTag.image_id).filter(
                        MachineTag.keyword_id == keyword_id,
                        MachineTag.tenant_id == tenant.id,
                        MachineTag.tag_type == active_tag_type
                    ).subquery()

                    and_query = and_query.filter(ImageMetadata.id.in_(keyword_subquery))

                # Apply base_query subquery filters (list, rating, etc.)
                and_query = builder.apply_subqueries(and_query, subqueries_list)

                # Get matching image IDs
                matching_image_ids = and_query.subquery()

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

                total = builder.get_total_count(query)
                offset = resolve_anchor_offset(query, offset)
                results = builder.apply_pagination(query, offset, limit)
                images = [img for img, _ in results]
        else:
            # No valid keywords, use base_query with subquery filters
            query = base_query
            query = builder.apply_subqueries(query, subqueries_list)
            total = builder.get_total_count(query)
            order_by_clauses = builder.build_order_clauses()
            images = builder.apply_pagination(query.order_by(*order_by_clauses), offset, limit)
    else:
        # No keywords filter, use base_query with subquery filters
        from .query_builder import QueryBuilder

        query = base_query
        builder = QueryBuilder(db, tenant, date_order, order_by_value)

        if order_by_value == "ml_score" and ml_keyword_id:
            # Apply ML score ordering via outer join
            query, ml_scores = builder.apply_ml_score_ordering(query, ml_keyword_id, ml_tag_type)
            # Build order clauses with ML score priority
            order_by_date_clause = func.coalesce(ImageMetadata.capture_timestamp, ImageMetadata.modified_time)
            order_by_date_clause = order_by_date_clause.desc() if date_order == "desc" else order_by_date_clause.asc()
            id_order_clause = ImageMetadata.id.desc() if date_order == "desc" else ImageMetadata.id.asc()
            order_clauses = (
                ml_scores.c.ml_score.desc().nullslast(),
                order_by_date_clause,
                id_order_clause
            )
            query = query.order_by(*order_clauses)
            offset = resolve_anchor_offset(query, offset)
            images = query.limit(limit).offset(offset).all() if limit else query.offset(offset).all()
        else:
            order_by_clauses = builder.build_order_clauses()
            query = query.order_by(*order_by_clauses)
            offset = resolve_anchor_offset(query, offset)
            images = query.limit(limit).offset(offset).all() if limit else query.offset(offset).all()

        total = query.count()

    # Get tags for all images
    image_ids = [img.id for img in images]
    # Use ml_tag_type if provided (for AI filtering), otherwise use active_tag_type
    tag_type_filter = ml_tag_type if ml_tag_type else get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')
    tags = db.query(MachineTag).filter(
        MachineTag.image_id.in_(image_ids),
        MachineTag.tenant_id == tenant.id,
        MachineTag.tag_type == tag_type_filter
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

    # Build keyword lookup map using utility function
    keywords_map = load_keywords_map(db, tenant.id, keyword_ids)

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
    db: Session = Depends(get_db),
    include_ratings: bool = False
):
    """Return image summary stats for a tenant."""
    image_count = db.query(func.count(ImageMetadata.id)).filter(
        ImageMetadata.tenant_id == tenant.id
    ).scalar() or 0

    reviewed_image_count = db.query(func.count(distinct(Permatag.image_id))).join(
        ImageMetadata, ImageMetadata.id == Permatag.image_id
    ).filter(
        ImageMetadata.tenant_id == tenant.id,
        Permatag.tenant_id == tenant.id
    ).scalar() or 0

    positive_permatag_image_count = db.query(func.count(distinct(Permatag.image_id))).join(
        ImageMetadata, ImageMetadata.id == Permatag.image_id
    ).filter(
        ImageMetadata.tenant_id == tenant.id,
        Permatag.tenant_id == tenant.id,
        Permatag.signum == 1
    ).scalar() or 0

    # Get active tag type from tenant settings
    active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')

    ml_tag_count = db.query(func.count(distinct(MachineTag.image_id))).filter(
        MachineTag.tenant_id == tenant.id,
        MachineTag.tag_type == active_tag_type
    ).scalar() or 0

    # Get rating counts by rating value
    rating_counts = {}
    for rating_val in [0, 1, 2, 3]:
        count = db.query(func.count(ImageMetadata.id)).filter(
            ImageMetadata.tenant_id == tenant.id,
            ImageMetadata.rating == rating_val
        ).scalar() or 0
        if rating_val == 0:
            rating_counts['trash'] = int(count)
        else:
            rating_counts[f'stars_{rating_val}'] = int(count)

    # Get total rated images (rating > 0)
    rated_image_count = db.query(func.count(ImageMetadata.id)).filter(
        ImageMetadata.tenant_id == tenant.id,
        ImageMetadata.rating > 0
    ).scalar() or 0

    rating_by_category = {}
    if include_ratings:
        from photocat.models.config import KeywordCategory

        categories = db.query(KeywordCategory.id, KeywordCategory.name).filter(
            KeywordCategory.tenant_id == tenant.id
        ).order_by(KeywordCategory.name).all()

        category_ids = [cat_id for cat_id, _ in categories]
        category_name_by_id = {cat_id: name for cat_id, name in categories}

        rating_by_category = {
            name: {
                'total': {'stars_3': 0, 'stars_2': 0, 'stars_1': 0, 'trash': 0},
                'keywords': {}
            }
            for name in category_name_by_id.values()
        }

        keyword_rows = []
        if category_ids:
            keyword_rows = db.query(
                Keyword.id,
                Keyword.keyword,
                Keyword.category_id
            ).filter(
                Keyword.category_id.in_(category_ids),
                Keyword.tenant_id == tenant.id
            ).all()

        keyword_ids = []
        keyword_name_by_id = {}
        keyword_category_name_by_id = {}
        for kw_id, kw_name, cat_id in keyword_rows:
            category_name = category_name_by_id.get(cat_id)
            if not category_name:
                continue
            keyword_ids.append(kw_id)
            keyword_name_by_id[kw_id] = kw_name
            keyword_category_name_by_id[kw_id] = category_name
            rating_by_category[category_name]['keywords'][kw_name] = {
                'total_images': 0,
                'rated_images': 0,
                'stars_3': 0,
                'stars_2': 0,
                'stars_1': 0,
                'trash': 0
            }

        if keyword_ids:
            keyword_total_rows = db.query(
                Permatag.keyword_id,
                func.count(distinct(Permatag.image_id))
            ).filter(
                Permatag.tenant_id == tenant.id,
                Permatag.signum == 1,
                Permatag.keyword_id.in_(keyword_ids)
            ).group_by(Permatag.keyword_id).all()

            for kw_id, total in keyword_total_rows:
                category_name = keyword_category_name_by_id.get(kw_id)
                keyword_name = keyword_name_by_id.get(kw_id)
                if not category_name or not keyword_name:
                    continue
                rating_by_category[category_name]['keywords'][keyword_name]['total_images'] = int(total or 0)

            keyword_rating_rows = db.query(
                Permatag.keyword_id,
                ImageMetadata.rating,
                func.count(distinct(Permatag.image_id))
            ).join(
                ImageMetadata, ImageMetadata.id == Permatag.image_id
            ).filter(
                Permatag.tenant_id == tenant.id,
                ImageMetadata.tenant_id == tenant.id,
                Permatag.signum == 1,
                Permatag.keyword_id.in_(keyword_ids),
                ImageMetadata.rating.in_([0, 1, 2, 3])
            ).group_by(
                Permatag.keyword_id,
                ImageMetadata.rating
            ).all()

            for kw_id, rating_val, count in keyword_rating_rows:
                category_name = keyword_category_name_by_id.get(kw_id)
                keyword_name = keyword_name_by_id.get(kw_id)
                if not category_name or not keyword_name:
                    continue
                if rating_val == 0:
                    rating_by_category[category_name]['keywords'][keyword_name]['trash'] = int(count or 0)
                else:
                    rating_by_category[category_name]['keywords'][keyword_name][f'stars_{rating_val}'] = int(count or 0)

            for kw_id in keyword_ids:
                category_name = keyword_category_name_by_id.get(kw_id)
                keyword_name = keyword_name_by_id.get(kw_id)
                if not category_name or not keyword_name:
                    continue
                keyword_stats = rating_by_category[category_name]['keywords'][keyword_name]
                keyword_stats['rated_images'] = int(
                    keyword_stats['stars_1']
                    + keyword_stats['stars_2']
                    + keyword_stats['stars_3']
                )

        if category_ids:
            category_rating_rows = db.query(
                Keyword.category_id,
                ImageMetadata.rating,
                func.count(distinct(Permatag.image_id))
            ).join(
                Keyword, Keyword.id == Permatag.keyword_id
            ).join(
                ImageMetadata, ImageMetadata.id == Permatag.image_id
            ).filter(
                Permatag.tenant_id == tenant.id,
                ImageMetadata.tenant_id == tenant.id,
                Permatag.signum == 1,
                Keyword.category_id.in_(category_ids),
                Keyword.tenant_id == tenant.id,
                ImageMetadata.rating.in_([0, 1, 2, 3])
            ).group_by(
                Keyword.category_id,
                ImageMetadata.rating
            ).all()

            for cat_id, rating_val, count in category_rating_rows:
                category_name = category_name_by_id.get(cat_id)
                if not category_name:
                    continue
                if rating_val == 0:
                    rating_by_category[category_name]['total']['trash'] = int(count or 0)
                else:
                    rating_by_category[category_name]['total'][f'stars_{rating_val}'] = int(count or 0)

    return {
        "tenant_id": tenant.id,
        "image_count": int(image_count),
        "reviewed_image_count": int(reviewed_image_count),
        "positive_permatag_image_count": int(positive_permatag_image_count),
        "untagged_positive_count": int(max(image_count - positive_permatag_image_count, 0)),
        "ml_tag_count": int(ml_tag_count),
        "rated_image_count": int(rated_image_count),
        "rating_counts": rating_counts,
        "rating_by_category": rating_by_category
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


@router.get("/images/{image_id}/full", operation_id="get_full_image")
async def get_full_image(
    image_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Stream full-size image from Dropbox without persisting it."""
    image = db.query(ImageMetadata).filter_by(
        id=image_id,
        tenant_id=tenant.id
    ).first()

    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    dropbox_ref = image.dropbox_path
    if not dropbox_ref and image.dropbox_id:
        dropbox_ref = image.dropbox_id if image.dropbox_id.startswith("id:") else f"id:{image.dropbox_id}"

    if not dropbox_ref or dropbox_ref.startswith("/local/") or (image.dropbox_id and image.dropbox_id.startswith("local_")):
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

    try:
        dbx = Dropbox(
            oauth2_refresh_token=refresh_token,
            app_key=tenant.dropbox_app_key,
            app_secret=app_secret
        )
        metadata, response = dbx.files_download(dropbox_ref)
        content_type = response.headers.get("Content-Type") or response.headers.get("content-type")
        if not content_type:
            content_type, _ = mimetypes.guess_type(image.filename or dropbox_ref)
            content_type = content_type or "application/octet-stream"
        filename = getattr(metadata, "name", None) or image.filename or "image"

        # Convert HEIC to JPEG for browser compatibility
        if filename.lower().endswith((".heic", ".heif")):
            try:
                from photocat.image import ImageProcessor
                image_data = response.content
                processor = ImageProcessor()
                pil_image = processor.load_image(image_data)
                # Convert to JPEG (create_thumbnail uses JPEG but we want full size)
                pil_image_rgb = pil_image.convert("RGB") if pil_image.mode != "RGB" else pil_image
                import io
                buffer = io.BytesIO()
                pil_image_rgb.save(buffer, format="JPEG", quality=95, optimize=False)
                converted_data = buffer.getvalue()
                filename = filename.rsplit(".", 1)[0] + ".jpg"
                content_type = "image/jpeg"
                return StreamingResponse(
                    iter([converted_data]),
                    media_type=content_type,
                    headers={
                        "Cache-Control": "no-store",
                        "Content-Disposition": f'inline; filename="{filename}"'
                    }
                )
            except Exception as e:
                # Fallback: stream original if conversion fails
                print(f"HEIC conversion failed for {image.filename}: {e}")
                return StreamingResponse(
                    response.iter_content(chunk_size=1024 * 1024),
                    media_type=content_type,
                    headers={
                        "Cache-Control": "no-store",
                        "Content-Disposition": f'inline; filename="{filename}"'
                    }
                )

        return StreamingResponse(
            response.iter_content(chunk_size=1024 * 1024),
            media_type=content_type,
            headers={
                "Cache-Control": "no-store",
                "Content-Disposition": f'inline; filename="{filename}"'
            }
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error fetching Dropbox image: {exc}")


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

    dropbox_ref = image.dropbox_path
    if not dropbox_ref and image.dropbox_id:
        dropbox_ref = image.dropbox_id if image.dropbox_id.startswith("id:") else f"id:{image.dropbox_id}"
    if not dropbox_ref or dropbox_ref.startswith("/local/") or (image.dropbox_id and image.dropbox_id.startswith("local_")):
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

    try:
        dbx = Dropbox(
            oauth2_refresh_token=refresh_token,
            app_key=tenant.dropbox_app_key,
            app_secret=app_secret
        )
        metadata, response = dbx.files_download(dropbox_ref)
        image_bytes = response.content
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error downloading Dropbox image: {exc}")

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

    thumbnail_path = image.thumbnail_path
    if not thumbnail_path:
        name_source = getattr(metadata, "name", None) or image.filename or f"image_{image.id}"
        thumbnail_filename = f"{Path(name_source).stem}_thumb.jpg"
        thumbnail_path = tenant.get_storage_path(thumbnail_filename, "thumbnails")

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
    image.thumbnail_path = thumbnail_path
    image.last_processed = datetime.utcnow()

    if metadata is not None:
        image.file_size = getattr(metadata, "size", image.file_size)
        image.modified_time = getattr(metadata, "server_modified", image.modified_time)
        image.content_hash = getattr(metadata, "content_hash", image.content_hash)
        if getattr(metadata, "path_display", None):
            image.dropbox_path = metadata.path_display
        if getattr(metadata, "id", None):
            image.dropbox_id = metadata.id

    db.add(image)
    db.commit()

    return {
        "status": "ok",
        "image_id": image.id
    }
