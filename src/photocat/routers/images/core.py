"""Core image endpoints: list, get, asset."""

import json
from typing import Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, distinct, and_, case, cast, Text
from sqlalchemy.orm import Session, load_only
from google.cloud import storage

from photocat.dependencies import get_db, get_tenant, get_tenant_setting
from photocat.asset_helpers import load_assets_for_images
from photocat.tenant import Tenant
from photocat.metadata import (
    Asset,
    AssetDerivative,
    ImageEmbedding,
    ImageMetadata,
    MachineTag,
    Permatag,
)
from photocat.models.config import Keyword, PhotoListItem
from photocat.tagging import calculate_tags
from photocat.config.db_utils import load_keywords_map
from photocat.settings import settings
from photocat.routers.images._shared import (
    _build_source_url,
    _resolve_storage_or_409,
)

# Sub-router with no prefix/tags (inherits from parent)
router = APIRouter()

# Columns required by /images list response + ordering logic.
LIST_IMAGES_LOAD_ONLY_COLUMNS = (
    ImageMetadata.id,
    ImageMetadata.asset_id,
    ImageMetadata.tenant_id,
    ImageMetadata.created_at,
    ImageMetadata.filename,
    ImageMetadata.file_size,
    ImageMetadata.modified_time,
    ImageMetadata.width,
    ImageMetadata.height,
    ImageMetadata.format,
    ImageMetadata.camera_make,
    ImageMetadata.camera_model,
    ImageMetadata.lens_model,
    ImageMetadata.iso,
    ImageMetadata.aperture,
    ImageMetadata.shutter_speed,
    ImageMetadata.focal_length,
    ImageMetadata.capture_timestamp,
    ImageMetadata.gps_latitude,
    ImageMetadata.gps_longitude,
    ImageMetadata.last_processed,
    ImageMetadata.tags_applied,
    ImageMetadata.faces_detected,
    ImageMetadata.rating,
)


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
    list_exclude_id: Optional[int] = None,
    rating: Optional[int] = None,
    rating_operator: str = "eq",
    hide_zero_rating: bool = False,
    reviewed: Optional[bool] = None,
    dropbox_path_prefix: Optional[str] = None,
    filename_query: Optional[str] = None,
    permatag_keyword: Optional[str] = None,
    permatag_category: Optional[str] = None,
    permatag_signum: Optional[int] = None,
    permatag_missing: bool = False,
    permatag_positive_missing: bool = False,
    category_filter_source: Optional[str] = None,
    category_filter_operator: Optional[str] = None,
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
    if order_by_value not in ("photo_creation", "created_at", "image_id", "processed", "ml_score", "rating"):
        order_by_value = None
    if order_by_value == "ml_score" and not ml_keyword_id:
        order_by_value = None
    constrain_to_ml_matches = order_by_value == "ml_score" and ml_keyword_id is not None

    base_query, subqueries_list, exclude_subqueries_list, has_empty_filter = build_image_query_with_subqueries(
        db,
        tenant,
        list_id=list_id,
        list_exclude_id=list_exclude_id,
        rating=rating,
        rating_operator=rating_operator,
        hide_zero_rating=hide_zero_rating,
        reviewed=reviewed,
        dropbox_path_prefix=dropbox_path_prefix,
        filename_query=filename_query,
        permatag_keyword=permatag_keyword,
        permatag_category=permatag_category,
        permatag_signum=permatag_signum,
        permatag_missing=permatag_missing,
        permatag_positive_missing=permatag_positive_missing,
        ml_keyword=ml_keyword,
        ml_tag_type=ml_tag_type,
        apply_ml_tag_filter=not constrain_to_ml_matches,
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

    total = 0

    # Handle per-category filters if provided
    if order_by_value == "processed":
        order_by_date = func.coalesce(ImageMetadata.last_processed, ImageMetadata.created_at)
    elif order_by_value == "created_at":
        order_by_date = ImageMetadata.created_at
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
                source=category_filter_source or "current",
                combine_operator=category_filter_operator or "AND"
            )

            if unique_image_ids_set:
                unique_image_ids = list(unique_image_ids_set)

                if subqueries_list or exclude_subqueries_list:
                    unique_image_ids = builder.apply_filters_to_id_set(
                        unique_image_ids,
                        subqueries_list,
                        exclude_subqueries_list
                    )

                # Get all keywords for relevance counting
                all_keywords = []
                for filter_data in filters.values():
                    all_keywords.extend(filter_data.get('keywords', []))

                if unique_image_ids:
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
                    elif order_by_value == "created_at":
                        date_map = {
                            row[0]: row[4]
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
                    elif order_by_value in ("photo_creation", "processed", "created_at"):
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

                    total = len(sorted_ids)

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
                    total = 0
            else:
                # No matches
                images = []
                total = 0

        except (json.JSONDecodeError, KeyError, TypeError) as e:
            print(f"Error parsing category_filters: {e}")
            # Fall back to returning all images
            query = db.query(ImageMetadata).filter_by(tenant_id=tenant.id)
            total = int(query.order_by(None).count() or 0)
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
                # Use subquery to get asset IDs that match keywords.
                matching_asset_ids = db.query(MachineTag.asset_id).filter(
                    MachineTag.keyword_id.in_(keyword_id_list),
                    MachineTag.tenant_id == tenant.id,
                    MachineTag.tag_type == active_tag_type,
                    MachineTag.asset_id.is_not(None),
                ).distinct().subquery()

                # Main query with relevance ordering (by sum of confidence scores)
                order_by_date = func.coalesce(ImageMetadata.capture_timestamp, ImageMetadata.modified_time).desc()
                query = db.query(
                    ImageMetadata,
                    func.sum(MachineTag.confidence).label('relevance_score')
                ).join(
                    MachineTag,
                    and_(
                        MachineTag.asset_id == ImageMetadata.asset_id,
                        MachineTag.keyword_id.in_(keyword_id_list),
                        MachineTag.tenant_id == tenant.id,
                        MachineTag.tag_type == active_tag_type
                    )
                ).filter(
                    ImageMetadata.tenant_id == tenant.id,
                    ImageMetadata.asset_id.in_(matching_asset_ids)
                ).group_by(
                    ImageMetadata.id
                ).order_by(
                    func.sum(MachineTag.confidence).desc(),
                    order_by_date,
                    id_order
                )

                # Apply base_query subquery filters (list, rating, etc.) to the keyword query
                query = builder.apply_subqueries(query, subqueries_list, exclude_subqueries_list)

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
                    keyword_subquery = db.query(MachineTag.asset_id).filter(
                        MachineTag.keyword_id == keyword_id,
                        MachineTag.tenant_id == tenant.id,
                        MachineTag.tag_type == active_tag_type,
                        MachineTag.asset_id.is_not(None),
                    ).subquery()

                    and_query = and_query.filter(ImageMetadata.asset_id.in_(keyword_subquery))

                # Apply base_query subquery filters (list, rating, etc.)
                and_query = builder.apply_subqueries(and_query, subqueries_list, exclude_subqueries_list)

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
                        MachineTag.asset_id == ImageMetadata.asset_id,
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
            query = builder.apply_subqueries(query, subqueries_list, exclude_subqueries_list)
            order_by_clauses = builder.build_order_clauses()
            total = builder.get_total_count(query)
            images = builder.apply_pagination(query.order_by(*order_by_clauses), offset, limit)
    else:
        # No keywords filter, use base_query with subquery filters
        from .query_builder import QueryBuilder

        query = base_query
        builder = QueryBuilder(db, tenant, date_order, order_by_value)
        query = builder.apply_subqueries(query, subqueries_list, exclude_subqueries_list)
        query = query.options(load_only(*LIST_IMAGES_LOAD_ONLY_COLUMNS))

        if order_by_value == "ml_score" and ml_keyword_id:
            # Apply ML score ordering and require matching ML-tag rows for this keyword.
            query, ml_scores = builder.apply_ml_score_ordering(
                query,
                ml_keyword_id,
                ml_tag_type,
                require_match=True,
            )
            total = builder.get_total_count(query)
            # Build order clauses with ML score priority
            if order_by_value == "processed":
                order_by_date_clause = func.coalesce(ImageMetadata.last_processed, ImageMetadata.created_at)
            elif order_by_value == "created_at":
                order_by_date_clause = ImageMetadata.created_at
            else:
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
            total = builder.get_total_count(query)
            order_by_clauses = builder.build_order_clauses()
            query = query.order_by(*order_by_clauses)
            offset = resolve_anchor_offset(query, offset)
            images = query.limit(limit).offset(offset).all() if limit else query.offset(offset).all()

    # Get tags for all images
    image_ids = [img.id for img in images]
    asset_id_to_image_id = {img.asset_id: img.id for img in images if img.asset_id is not None}
    asset_ids = list(asset_id_to_image_id.keys())
    # Use ml_tag_type if provided (for AI filtering), otherwise use active_tag_type
    tag_type_filter = ml_tag_type if ml_tag_type else get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')
    tags = db.query(MachineTag).filter(
        MachineTag.asset_id.in_(asset_ids),
        MachineTag.tenant_id == tenant.id,
        MachineTag.tag_type == tag_type_filter
    ).all() if asset_ids else []

    # Get permatags for all images
    permatags = db.query(Permatag).filter(
        Permatag.asset_id.in_(asset_ids),
        Permatag.tenant_id == tenant.id
    ).all() if asset_ids else []
    variant_count_by_asset = {
        asset_id: int(count or 0)
        for asset_id, count in (
            db.query(
                AssetDerivative.asset_id,
                func.count(AssetDerivative.id),
            ).filter(
                AssetDerivative.asset_id.in_(asset_ids),
                AssetDerivative.deleted_at.is_(None),
            ).group_by(AssetDerivative.asset_id).all() if asset_ids else []
        )
    }

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
        image_id = asset_id_to_image_id.get(tag.asset_id)
        if image_id is None:
            continue
        if image_id not in tags_by_image:
            tags_by_image[image_id] = []
        kw_info = keywords_map.get(tag.keyword_id, {"keyword": "unknown", "category": "unknown"})
        tags_by_image[image_id].append({
            "keyword": kw_info["keyword"],
            "category": kw_info["category"],
            "confidence": round(tag.confidence, 2)
        })

    # Group permatags by image_id
    permatags_by_image = {}
    reviewed_at_by_image = {}
    for permatag in permatags:
        image_id = asset_id_to_image_id.get(permatag.asset_id)
        if image_id is None:
            continue
        if image_id not in permatags_by_image:
            permatags_by_image[image_id] = []
        kw_info = keywords_map.get(permatag.keyword_id, {"keyword": "unknown", "category": "unknown"})
        permatags_by_image[image_id].append({
            "id": permatag.id,
            "keyword": kw_info["keyword"],
            "category": kw_info["category"],
            "signum": permatag.signum
        })
        if permatag.created_at:
            current_latest = reviewed_at_by_image.get(image_id)
            if current_latest is None or permatag.created_at > current_latest:
                reviewed_at_by_image[image_id] = permatag.created_at

    assets_by_id = load_assets_for_images(db, images)
    images_list = []
    for img in images:
        storage_info = _resolve_storage_or_409(
            image=img,
            tenant=tenant,
            db=db,
            assets_by_id=assets_by_id,
        )
        machine_tags = sorted(tags_by_image.get(img.id, []), key=lambda x: x['confidence'], reverse=True)
        image_permatags = permatags_by_image.get(img.id, [])
        calculated_tags = calculate_tags(machine_tags, image_permatags)
        images_list.append({
            "id": img.id,
            "asset_id": storage_info.asset_id,
            "variant_count": int(variant_count_by_asset.get(img.asset_id, 0)),
            "has_variants": int(variant_count_by_asset.get(img.asset_id, 0)) > 0,
            "filename": img.filename,
            "width": img.width,
            "height": img.height,
            "format": img.format,
            "file_size": img.file_size,
            "dropbox_path": storage_info.source_key,
            "source_provider": storage_info.source_provider,
            "source_key": storage_info.source_key,
            "source_rev": storage_info.source_rev,
            "source_url": _build_source_url(storage_info, tenant, img),
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
            "thumbnail_path": storage_info.thumbnail_key,
            "thumbnail_url": storage_info.thumbnail_url,
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


@router.get("/images/duplicates", response_model=dict, operation_id="list_duplicate_images")
async def list_duplicate_images(
    tenant: Tenant = Depends(get_tenant),
    limit: int = 100,
    offset: int = 0,
    date_order: str = "desc",
    filename_query: Optional[str] = None,
    include_total: bool = False,
    db: Session = Depends(get_db),
):
    """List assets whose embedding value appears more than once."""
    date_order = (date_order or "desc").lower()
    if date_order not in ("asc", "desc"):
        date_order = "desc"

    embedding_hash_expr = func.md5(cast(ImageEmbedding.embedding, Text))
    duplicate_groups = db.query(
        embedding_hash_expr.label("embedding_hash"),
        func.count(ImageEmbedding.id).label("duplicate_count"),
    ).filter(
        ImageEmbedding.tenant_id == tenant.id,
        ImageEmbedding.asset_id.is_not(None),
    ).group_by(
        embedding_hash_expr,
    ).having(
        func.count(ImageEmbedding.id) > 1,
    ).subquery()

    base_query = db.query(
        ImageMetadata.id.label("image_id"),
        duplicate_groups.c.embedding_hash.label("embedding_hash"),
        duplicate_groups.c.duplicate_count.label("duplicate_count"),
    ).join(
        ImageEmbedding,
        and_(
            ImageEmbedding.asset_id == ImageMetadata.asset_id,
            ImageEmbedding.tenant_id == tenant.id,
            ImageEmbedding.asset_id.is_not(None),
        ),
    ).join(
        duplicate_groups,
        embedding_hash_expr == duplicate_groups.c.embedding_hash,
    ).filter(
        ImageMetadata.tenant_id == tenant.id,
    )
    if filename_query:
        filename_pattern = f"%{filename_query.strip()}%"
        if filename_pattern != "%%":
            base_query = base_query.filter(ImageMetadata.filename.ilike(filename_pattern))

    created_order = ImageMetadata.created_at.desc() if date_order == "desc" else ImageMetadata.created_at.asc()
    id_order = ImageMetadata.id.desc() if date_order == "desc" else ImageMetadata.id.asc()
    requested_limit = max(1, int(limit or 100))
    rows = base_query.order_by(
        duplicate_groups.c.duplicate_count.desc(),
        duplicate_groups.c.embedding_hash.asc(),
        created_order,
        id_order,
    ).limit(requested_limit + 1).offset(offset).all()
    has_more = len(rows) > requested_limit
    if has_more:
        rows = rows[:requested_limit]

    total = int(base_query.order_by(None).count() or 0) if include_total else (offset + len(rows) + (1 if has_more else 0))

    image_ids = [row.image_id for row in rows]
    images = db.query(ImageMetadata).filter(
        ImageMetadata.id.in_(image_ids)
    ).options(
        load_only(*LIST_IMAGES_LOAD_ONLY_COLUMNS)
    ).all() if image_ids else []
    image_by_id = {img.id: img for img in images}
    ordered_images = [image_by_id[img_id] for img_id in image_ids if img_id in image_by_id]

    assets_by_id = load_assets_for_images(db, ordered_images)
    asset_id_to_image_id = {img.asset_id: img.id for img in ordered_images if img.asset_id is not None}
    asset_ids = list(asset_id_to_image_id.keys())
    duplicate_meta_by_image_id = {
        row.image_id: {
            "embedding_hash": row.embedding_hash,
            "duplicate_count": int(row.duplicate_count or 0),
        }
        for row in rows
    }

    permatags = db.query(Permatag).filter(
        Permatag.asset_id.in_(asset_ids),
        Permatag.tenant_id == tenant.id
    ).all() if asset_ids else []
    variant_count_by_asset = {
        asset_id: int(count or 0)
        for asset_id, count in (
            db.query(
                AssetDerivative.asset_id,
                func.count(AssetDerivative.id),
            ).filter(
                AssetDerivative.asset_id.in_(asset_ids),
                AssetDerivative.deleted_at.is_(None),
            ).group_by(AssetDerivative.asset_id).all() if asset_ids else []
        )
    }

    keyword_ids = {tag.keyword_id for tag in permatags}
    keywords_map = load_keywords_map(db, tenant.id, keyword_ids)

    permatags_by_image = {}
    for permatag in permatags:
        image_id = asset_id_to_image_id.get(permatag.asset_id)
        if image_id is None:
            continue
        if image_id not in permatags_by_image:
            permatags_by_image[image_id] = []
        kw_info = keywords_map.get(permatag.keyword_id, {"keyword": "unknown", "category": "unknown"})
        permatags_by_image[image_id].append({
            "id": permatag.id,
            "keyword": kw_info["keyword"],
            "category": kw_info["category"],
            "signum": permatag.signum,
        })

    images_list = []
    for img in ordered_images:
        storage_info = _resolve_storage_or_409(
            image=img,
            tenant=tenant,
            db=db,
            assets_by_id=assets_by_id,
        )
        dup_meta = duplicate_meta_by_image_id.get(img.id, {})
        image_permatags = permatags_by_image.get(img.id, [])
        images_list.append({
            "id": img.id,
            "asset_id": storage_info.asset_id,
            "variant_count": int(variant_count_by_asset.get(img.asset_id, 0)),
            "has_variants": int(variant_count_by_asset.get(img.asset_id, 0)) > 0,
            "filename": img.filename,
            "file_size": img.file_size,
            "source_provider": storage_info.source_provider,
            "source_key": storage_info.source_key,
            "source_rev": storage_info.source_rev,
            "source_url": _build_source_url(storage_info, tenant, img),
            "capture_timestamp": img.capture_timestamp.isoformat() if img.capture_timestamp else None,
            "modified_time": img.modified_time.isoformat() if img.modified_time else None,
            "created_at": img.created_at.isoformat() if img.created_at else None,
            "thumbnail_path": storage_info.thumbnail_key,
            "thumbnail_url": storage_info.thumbnail_url,
            "rating": img.rating,
            "permatags": image_permatags,
            "duplicate_group": dup_meta.get("embedding_hash"),
            "duplicate_count": dup_meta.get("duplicate_count", 0),
        })

    return {
        "tenant_id": tenant.id,
        "images": images_list,
        "total": total,
        "limit": requested_limit,
        "offset": offset,
        "has_more": has_more,
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
        MachineTag.asset_id == image.asset_id,
        MachineTag.tenant_id == tenant.id
    ).all()

    # Get permatags
    permatags = db.query(Permatag).filter(
        Permatag.asset_id == image.asset_id,
        Permatag.tenant_id == tenant.id,
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
        Permatag.asset_id == image.asset_id,
        Permatag.tenant_id == tenant.id,
    ).scalar()

    storage_info = _resolve_storage_or_409(image=image, tenant=tenant, db=db)
    return {
        "id": image.id,
        "asset_id": storage_info.asset_id,
        "filename": image.filename,
        "width": image.width,
        "height": image.height,
        "format": image.format,
        "file_size": image.file_size,
        "dropbox_path": storage_info.source_key,
        "source_provider": storage_info.source_provider,
        "source_key": storage_info.source_key,
        "source_rev": storage_info.source_rev,
        "source_url": _build_source_url(storage_info, tenant, image),
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
        "thumbnail_path": storage_info.thumbnail_key,
        "thumbnail_url": storage_info.thumbnail_url,
        "rating": image.rating,
        "reviewed_at": reviewed_at.isoformat() if reviewed_at else None,
        "tags": machine_tags_list,
        "machine_tags_by_type": tags_by_type,
        "permatags": permatags_list,
        "calculated_tags": calculated_tags,
        "exif_data": image.exif_data,
        "dropbox_properties": image.dropbox_properties,
    }


@router.get("/images/{image_id}/asset", response_model=dict, operation_id="get_image_asset")
async def get_image_asset(
    image_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    """Get resolved asset info for an image, with fallback to image_metadata fields."""
    image = db.query(ImageMetadata).filter_by(
        id=image_id,
        tenant_id=tenant.id,
    ).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    storage_info = _resolve_storage_or_409(image=image, tenant=tenant, db=db)
    asset = storage_info.asset

    return {
        "image_id": image.id,
        "asset_id": storage_info.asset_id,
        "resolved_from": "assets" if asset else "image_metadata_fallback",
        "thumbnail_path": storage_info.thumbnail_key,
        "thumbnail_url": storage_info.thumbnail_url,
        "source_provider": storage_info.source_provider,
        "source_key": storage_info.source_key,
        "source_rev": storage_info.source_rev,
        "source_url": _build_source_url(storage_info, tenant, image),
        "filename": asset.filename if asset else image.filename,
        "mime_type": asset.mime_type if asset else None,
        "width": asset.width if asset and asset.width is not None else image.width,
        "height": asset.height if asset and asset.height is not None else image.height,
        "duration_ms": asset.duration_ms if asset else None,
    }


@router.get("/assets/{asset_id}", response_model=dict, operation_id="get_asset")
async def get_asset(
    asset_id: UUID,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    """Get canonical asset details for a tenant."""
    asset = db.query(Asset).filter(
        Asset.id == asset_id,
        Asset.tenant_id == tenant.id,
    ).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    linked_image_ids = [
        row[0]
        for row in db.query(ImageMetadata.id)
        .filter(
            ImageMetadata.tenant_id == tenant.id,
            ImageMetadata.asset_id == asset.id,
        )
        .order_by(ImageMetadata.id.asc())
        .limit(25)
        .all()
    ]

    return {
        "id": str(asset.id),
        "tenant_id": asset.tenant_id,
        "filename": asset.filename,
        "source_provider": asset.source_provider,
        "source_key": asset.source_key,
        "source_rev": asset.source_rev,
        "source_url": _build_source_url(asset, tenant, image=None),
        "thumbnail_key": asset.thumbnail_key,
        "thumbnail_url": tenant.get_thumbnail_url(settings, asset.thumbnail_key),
        "mime_type": asset.mime_type,
        "width": asset.width,
        "height": asset.height,
        "duration_ms": asset.duration_ms,
        "linked_image_ids": linked_image_ids,
    }


@router.delete("/images/{image_id}", response_model=dict, operation_id="delete_image")
async def delete_image(
    image_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    """Delete an asset image and related tenant-scoped records."""
    image = db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        ImageMetadata.tenant_id == tenant.id,
    ).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    asset_id = image.asset_id
    asset = None
    derivative_keys = []
    source_provider = None
    source_key = None
    thumbnail_key = None

    if asset_id is not None:
        asset = db.query(Asset).filter(
            Asset.id == asset_id,
            Asset.tenant_id == tenant.id,
        ).first()
        if asset:
            source_provider = (asset.source_provider or "").strip().lower() or None
            source_key = (asset.source_key or "").strip() or None
            thumbnail_key = (asset.thumbnail_key or "").strip() or None

        derivative_rows = db.query(AssetDerivative).filter(
            AssetDerivative.asset_id == asset_id
        ).all()
        derivative_keys = [
            (row.storage_key or "").strip()
            for row in derivative_rows
            if (row.storage_key or "").strip()
        ]

        db.query(Permatag).filter(
            Permatag.tenant_id == tenant.id,
            Permatag.asset_id == asset_id,
        ).delete(synchronize_session=False)
        db.query(MachineTag).filter(
            MachineTag.tenant_id == tenant.id,
            MachineTag.asset_id == asset_id,
        ).delete(synchronize_session=False)
        db.query(ImageEmbedding).filter(
            ImageEmbedding.tenant_id == tenant.id,
            ImageEmbedding.asset_id == asset_id,
        ).delete(synchronize_session=False)
        db.query(PhotoListItem).filter(
            PhotoListItem.asset_id == asset_id
        ).delete(synchronize_session=False)
        db.query(AssetDerivative).filter(
            AssetDerivative.asset_id == asset_id
        ).delete(synchronize_session=False)

    db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        ImageMetadata.tenant_id == tenant.id,
    ).delete(synchronize_session=False)
    if asset is not None:
        db.query(Asset).filter(
            Asset.id == asset_id,
            Asset.tenant_id == tenant.id,
        ).delete(synchronize_session=False)
    db.commit()

    deleted_objects = []
    storage_delete_errors = []

    def _delete_blob(bucket_name: str, key: Optional[str]) -> None:
        normalized_key = (key or "").strip()
        if not bucket_name or not normalized_key:
            return
        try:
            bucket = storage_client.bucket(bucket_name)
            blob = bucket.blob(normalized_key)
            blob.delete()
            deleted_objects.append(f"{bucket_name}/{normalized_key}")
        except Exception as exc:  # pragma: no cover - best effort cleanup
            storage_delete_errors.append(f"{bucket_name}/{normalized_key}: {exc}")

    try:
        storage_client = storage.Client(project=settings.gcp_project_id)
        if source_provider in ("managed", "gcs", "google_cloud_storage"):
            _delete_blob(tenant.get_storage_bucket(settings), source_key)
        _delete_blob(tenant.get_thumbnail_bucket(settings), thumbnail_key)
        for derivative_key in derivative_keys:
            _delete_blob(tenant.get_storage_bucket(settings), derivative_key)
    except Exception as exc:  # pragma: no cover - best effort cleanup
        storage_delete_errors.append(f"storage client init failed: {exc}")

    return {
        "status": "deleted",
        "tenant_id": tenant.id,
        "image_id": image_id,
        "asset_id": str(asset_id) if asset_id is not None else None,
        "deleted_storage_objects": deleted_objects,
        "storage_delete_errors": storage_delete_errors,
    }
