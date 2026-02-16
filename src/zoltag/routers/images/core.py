"""Core image endpoints: list, get, asset."""

import json
import threading
import time
from typing import Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, distinct, and_, case, cast, Text, literal
from sqlalchemy.orm import Session, load_only
from google.cloud import storage
import numpy as np

from zoltag.dependencies import get_db, get_tenant, get_tenant_setting
from zoltag.auth.dependencies import get_current_user, require_tenant_role_from_header
from zoltag.auth.models import UserProfile
from zoltag.list_visibility import is_tenant_admin_user
from zoltag.asset_helpers import load_assets_for_images
from zoltag.tenant import Tenant
from zoltag.metadata import (
    Asset,
    AssetDerivative,
    ImageEmbedding,
    ImageMetadata,
    MachineTag,
    Permatag,
)
from zoltag.models.config import Keyword, PhotoListItem
from zoltag.tagging import calculate_tags
from zoltag.config.db_utils import load_keywords_map
from zoltag.settings import settings
from zoltag.tenant_scope import tenant_column_filter
from zoltag.routers.images._shared import (
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

SIMILARITY_CACHE_TTL_SECONDS = 300
SIMILARITY_CACHE_MAX_ENTRIES = 12
_similarity_cache_lock = threading.Lock()
_similarity_index_cache = {}


def _build_similarity_index(
    db: Session,
    tenant: Tenant,
    media_type: Optional[str],
    embedding_dim: int,
) -> dict:
    query = db.query(
        ImageMetadata.id.label("image_id"),
        ImageEmbedding.embedding.label("embedding"),
    ).join(
        ImageEmbedding,
        and_(
            ImageEmbedding.asset_id == ImageMetadata.asset_id,
            tenant_column_filter(ImageEmbedding, tenant),
            ImageEmbedding.embedding.is_not(None),
        ),
    ).filter(
        tenant_column_filter(ImageMetadata, tenant),
        ImageMetadata.asset_id.is_not(None),
    )

    if media_type:
        query = query.join(
            Asset,
            and_(
                Asset.id == ImageMetadata.asset_id,
                tenant_column_filter(Asset, tenant),
            ),
        ).filter(
            func.lower(func.coalesce(Asset.media_type, "image")) == media_type
        )

    rows = query.all()
    image_ids = []
    vectors = []
    for row in rows:
        embedding = row.embedding
        if not embedding:
            continue
        vec = np.asarray(embedding, dtype=np.float32)
        if vec.ndim != 1 or vec.size != embedding_dim:
            continue
        norm = float(np.linalg.norm(vec))
        if norm <= 1e-12:
            continue
        image_ids.append(int(row.image_id))
        vectors.append(vec / norm)

    if not vectors:
        matrix = np.empty((0, embedding_dim), dtype=np.float32)
        ids = np.empty((0,), dtype=np.int64)
    else:
        matrix = np.vstack(vectors)
        ids = np.asarray(image_ids, dtype=np.int64)

    return {
        "built_at": time.time(),
        "matrix": matrix,
        "image_ids": ids,
        "media_type": media_type or "",
        "embedding_dim": embedding_dim,
    }


def _get_similarity_index(
    db: Session,
    tenant: Tenant,
    media_type: Optional[str],
    embedding_dim: int,
) -> dict:
    key = (str(tenant.id), media_type or "", int(embedding_dim))
    now = time.time()
    with _similarity_cache_lock:
        cached = _similarity_index_cache.get(key)
        if cached and (now - float(cached.get("built_at", 0))) <= SIMILARITY_CACHE_TTL_SECONDS:
            return cached

    built = _build_similarity_index(
        db=db,
        tenant=tenant,
        media_type=media_type,
        embedding_dim=embedding_dim,
    )
    with _similarity_cache_lock:
        _similarity_index_cache[key] = built
        if len(_similarity_index_cache) > SIMILARITY_CACHE_MAX_ENTRIES:
            oldest_key = min(
                _similarity_index_cache.keys(),
                key=lambda cache_key: float(_similarity_index_cache[cache_key].get("built_at", 0.0)),
            )
            if oldest_key != key:
                _similarity_index_cache.pop(oldest_key, None)
    return built


@router.get("/images", response_model=dict, operation_id="list_images")
async def list_images(
    tenant: Tenant = Depends(get_tenant),
    current_user: UserProfile = Depends(get_current_user),
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
    media_type: Optional[str] = None,
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
                tenant_column_filter(Keyword, tenant)
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
    media_type_value = (media_type or "all").strip().lower()
    if media_type_value not in {"all", "image", "video"}:
        media_type_value = "all"

    base_query, subqueries_list, exclude_subqueries_list, has_empty_filter = build_image_query_with_subqueries(
        db,
        tenant,
        current_user=current_user,
        is_tenant_admin=is_tenant_admin_user(db, tenant, current_user),
        list_id=list_id,
        list_exclude_id=list_exclude_id,
        rating=rating,
        rating_operator=rating_operator,
        hide_zero_rating=hide_zero_rating,
        reviewed=reviewed,
        media_type=None if media_type_value == "all" else media_type_value,
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
            query = db.query(ImageMetadata).filter(
                tenant_column_filter(ImageMetadata, tenant)
            )
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
                tenant_column_filter(Keyword, tenant)
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
                    tenant_column_filter(MachineTag, tenant),
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
                        tenant_column_filter(MachineTag, tenant),
                        MachineTag.tag_type == active_tag_type
                    )
                ).filter(
                    tenant_column_filter(ImageMetadata, tenant),
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
                tenant_column_filter(Keyword, tenant)
            ).all()
            keyword_id_list = [kw[0] for kw in keyword_ids]

            if not keyword_id_list or len(keyword_id_list) < len(keyword_list):
                # Not all keywords exist, return empty result
                images = []
                total = 0
            else:
                # Start with images that have tenant_id
                and_query = db.query(ImageMetadata.id).filter(
                    tenant_column_filter(ImageMetadata, tenant)
                )

                # For each keyword, filter images that have that keyword
                for keyword_id in keyword_id_list:
                    keyword_subquery = db.query(MachineTag.asset_id).filter(
                        MachineTag.keyword_id == keyword_id,
                        tenant_column_filter(MachineTag, tenant),
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
                        tenant_column_filter(MachineTag, tenant),
                        MachineTag.tag_type == active_tag_type
                    )
                ).filter(
                    tenant_column_filter(ImageMetadata, tenant),
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
        tenant_column_filter(MachineTag, tenant),
        MachineTag.tag_type == tag_type_filter
    ).all() if asset_ids else []

    # Get permatags for all images
    permatags = db.query(Permatag).filter(
        Permatag.asset_id.in_(asset_ids),
        tenant_column_filter(Permatag, tenant)
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
            "media_type": (storage_info.asset.media_type if storage_info.asset else None) or "image",
            "mime_type": storage_info.asset.mime_type if storage_info.asset else None,
            "duration_ms": storage_info.asset.duration_ms if storage_info.asset else None,
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
    """List duplicate assets using embedding hash (preferred) or content hash fallback."""
    date_order = (date_order or "desc").lower()
    if date_order not in ("asc", "desc"):
        date_order = "desc"

    embedding_key_expr = case(
        (
            ImageEmbedding.id.is_not(None),
            cast(literal("emb:"), Text) + func.md5(cast(ImageEmbedding.embedding, Text)),
        ),
        else_=None,
    )
    content_hash_key_expr = case(
        (
            ImageMetadata.content_hash.is_not(None),
            cast(literal("sha:"), Text) + ImageMetadata.content_hash,
        ),
        else_=None,
    )
    # Prefer content hash so duplicate grouping matches upload dedup behavior.
    # Fall back to embedding hash only when content hash is unavailable.
    duplicate_key_expr = func.coalesce(content_hash_key_expr, embedding_key_expr)

    image_keys = db.query(
        ImageMetadata.id.label("image_id"),
        ImageMetadata.filename.label("filename"),
        ImageMetadata.created_at.label("created_at"),
        duplicate_key_expr.label("duplicate_key"),
    ).outerjoin(
        ImageEmbedding,
        and_(
            ImageEmbedding.asset_id == ImageMetadata.asset_id,
            tenant_column_filter(ImageEmbedding, tenant),
            ImageEmbedding.asset_id.is_not(None),
        ),
    ).filter(
        tenant_column_filter(ImageMetadata, tenant),
    ).subquery()

    duplicate_groups = db.query(
        image_keys.c.duplicate_key.label("duplicate_key"),
        func.count(image_keys.c.image_id).label("duplicate_count"),
    ).filter(
        image_keys.c.duplicate_key.is_not(None),
    ).group_by(
        image_keys.c.duplicate_key,
    ).having(
        func.count(image_keys.c.image_id) > 1,
    ).subquery()

    base_query = db.query(
        image_keys.c.image_id.label("image_id"),
        duplicate_groups.c.duplicate_key.label("duplicate_key"),
        duplicate_groups.c.duplicate_count.label("duplicate_count"),
        image_keys.c.created_at.label("created_at"),
    ).join(
        duplicate_groups,
        image_keys.c.duplicate_key == duplicate_groups.c.duplicate_key,
    )
    if filename_query:
        filename_pattern = f"%{filename_query.strip()}%"
        if filename_pattern != "%%":
            base_query = base_query.filter(image_keys.c.filename.ilike(filename_pattern))

    created_order = image_keys.c.created_at.desc() if date_order == "desc" else image_keys.c.created_at.asc()
    id_order = image_keys.c.image_id.desc() if date_order == "desc" else image_keys.c.image_id.asc()
    requested_limit = max(1, int(limit or 100))
    rows = base_query.order_by(
        duplicate_groups.c.duplicate_count.desc(),
        duplicate_groups.c.duplicate_key.asc(),
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
            "duplicate_key": row.duplicate_key,
            "duplicate_count": int(row.duplicate_count or 0),
        }
        for row in rows
    }

    permatags = db.query(Permatag).filter(
        Permatag.asset_id.in_(asset_ids),
        tenant_column_filter(Permatag, tenant)
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
        duplicate_key = dup_meta.get("duplicate_key")
        duplicate_basis = "embedding" if (duplicate_key or "").startswith("emb:") else "content_hash"
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
            "media_type": (storage_info.asset.media_type if storage_info.asset else None) or "image",
            "mime_type": storage_info.asset.mime_type if storage_info.asset else None,
            "duration_ms": storage_info.asset.duration_ms if storage_info.asset else None,
            "rating": img.rating,
            "permatags": image_permatags,
            "duplicate_group": duplicate_key,
            "duplicate_count": dup_meta.get("duplicate_count", 0),
            "duplicate_basis": duplicate_basis,
        })

    return {
        "tenant_id": tenant.id,
        "images": images_list,
        "total": total,
        "limit": requested_limit,
        "offset": offset,
        "has_more": has_more,
    }


@router.get("/images/{image_id}/similar", response_model=dict, operation_id="get_similar_images")
def get_similar_images(
    image_id: int,
    tenant: Tenant = Depends(get_tenant),
    limit: int = 40,
    min_score: Optional[float] = None,
    same_media_type: bool = True,
    db: Session = Depends(get_db),
):
    """Return top embedding-similar images for a given image."""
    requested_limit = max(1, min(int(limit or 40), 200))
    if min_score is not None:
        if min_score < -1.0 or min_score > 1.0:
            raise HTTPException(status_code=400, detail="min_score must be between -1.0 and 1.0")

    source_image = db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        tenant_column_filter(ImageMetadata, tenant),
    ).options(
        load_only(*LIST_IMAGES_LOAD_ONLY_COLUMNS)
    ).first()
    if not source_image:
        raise HTTPException(status_code=404, detail="Image not found")
    if source_image.asset_id is None:
        raise HTTPException(status_code=400, detail="Image has no linked asset")

    source_embedding = db.query(ImageEmbedding).filter(
        tenant_column_filter(ImageEmbedding, tenant),
        ImageEmbedding.asset_id == source_image.asset_id,
        ImageEmbedding.embedding.is_not(None),
    ).first()
    if not source_embedding or not source_embedding.embedding:
        raise HTTPException(status_code=400, detail="Embedding not found for source image")

    source_vector = np.asarray(source_embedding.embedding, dtype=np.float32)
    if source_vector.ndim != 1 or source_vector.size == 0:
        raise HTTPException(status_code=400, detail="Invalid source embedding")
    source_norm = float(np.linalg.norm(source_vector))
    if source_norm <= 1e-12:
        raise HTTPException(status_code=400, detail="Source embedding has zero magnitude")
    source_unit_vector = source_vector / source_norm

    source_storage_info = _resolve_storage_or_409(image=source_image, tenant=tenant, db=db)
    source_media_type = ((source_storage_info.asset.media_type if source_storage_info.asset else None) or "image").lower()
    similarity_media_type = source_media_type if same_media_type else None

    index = _get_similarity_index(
        db=db,
        tenant=tenant,
        media_type=similarity_media_type,
        embedding_dim=int(source_vector.size),
    )
    matrix = index["matrix"]
    candidate_ids = index["image_ids"]
    if matrix.size == 0 or candidate_ids.size == 0:
        return {
            "tenant_id": tenant.id,
            "source_image_id": source_image.id,
            "source_asset_id": str(source_image.asset_id),
            "source_media_type": source_media_type,
            "same_media_type": bool(same_media_type),
            "images": [],
            "count": 0,
            "limit": requested_limit,
        }

    scores = np.dot(matrix, source_unit_vector)
    keep_mask = candidate_ids != int(source_image.id)
    filtered_ids = candidate_ids[keep_mask]
    filtered_scores = scores[keep_mask]
    if filtered_ids.size == 0:
        return {
            "tenant_id": tenant.id,
            "source_image_id": source_image.id,
            "source_asset_id": str(source_image.asset_id),
            "source_media_type": source_media_type,
            "same_media_type": bool(same_media_type),
            "images": [],
            "count": 0,
            "limit": requested_limit,
        }

    if min_score is not None:
        score_mask = filtered_scores >= float(min_score)
        filtered_scores = filtered_scores[score_mask]
        filtered_ids = filtered_ids[score_mask]
        if filtered_ids.size == 0:
            return {
                "tenant_id": tenant.id,
                "source_image_id": source_image.id,
                "source_asset_id": str(source_image.asset_id),
                "source_media_type": source_media_type,
                "same_media_type": bool(same_media_type),
                "images": [],
                "count": 0,
                "limit": requested_limit,
            }

    if requested_limit < filtered_scores.size:
        top_unsorted = np.argpartition(filtered_scores, -requested_limit)[-requested_limit:]
        ordered_indices = top_unsorted[np.argsort(filtered_scores[top_unsorted])[::-1]]
    else:
        ordered_indices = np.argsort(filtered_scores)[::-1]

    top_image_ids = [int(filtered_ids[int(idx)]) for idx in ordered_indices]
    score_by_image_id = {
        int(filtered_ids[int(idx)]): round(float(filtered_scores[int(idx)]), 4)
        for idx in ordered_indices
    }

    if not top_image_ids:
        return {
            "tenant_id": tenant.id,
            "source_image_id": source_image.id,
            "source_asset_id": str(source_image.asset_id),
            "source_media_type": source_media_type,
            "same_media_type": bool(same_media_type),
            "images": [],
            "count": 0,
            "limit": requested_limit,
        }

    top_images = db.query(ImageMetadata).filter(
        tenant_column_filter(ImageMetadata, tenant),
        ImageMetadata.id.in_(top_image_ids),
    ).options(
        load_only(*LIST_IMAGES_LOAD_ONLY_COLUMNS)
    ).all()
    images_by_id = {int(img.id): img for img in top_images}
    ordered_images = [images_by_id[img_id] for img_id in top_image_ids if img_id in images_by_id]
    assets_by_id = load_assets_for_images(db, ordered_images)
    asset_id_to_image_id = {img.asset_id: int(img.id) for img in ordered_images if img.asset_id is not None}
    asset_ids = list(asset_id_to_image_id.keys())
    permatags = db.query(Permatag).filter(
        Permatag.asset_id.in_(asset_ids),
        tenant_column_filter(Permatag, tenant),
    ).all() if asset_ids else []
    keyword_ids = {tag.keyword_id for tag in permatags}
    keywords_map = load_keywords_map(db, tenant.id, keyword_ids)
    permatags_by_image = {}
    for tag in permatags:
        image_row_id = asset_id_to_image_id.get(tag.asset_id)
        if image_row_id is None:
            continue
        kw_info = keywords_map.get(tag.keyword_id, {"keyword": "unknown", "category": "unknown"})
        permatags_by_image.setdefault(image_row_id, []).append({
            "id": tag.id,
            "keyword": kw_info["keyword"],
            "category": kw_info["category"],
            "signum": tag.signum,
        })

    images_list = []
    for image_row in ordered_images:
        try:
            storage_info = _resolve_storage_or_409(
                image=image_row,
                tenant=tenant,
                db=db,
                assets_by_id=assets_by_id,
            )
        except HTTPException:
            continue
        similarity_score = score_by_image_id.get(int(image_row.id), 0.0)
        image_permatags = permatags_by_image.get(int(image_row.id), [])
        images_list.append({
            "id": image_row.id,
            "asset_id": storage_info.asset_id,
            "filename": image_row.filename,
            "width": image_row.width,
            "height": image_row.height,
            "file_size": image_row.file_size,
            "capture_timestamp": image_row.capture_timestamp.isoformat() if image_row.capture_timestamp else None,
            "modified_time": image_row.modified_time.isoformat() if image_row.modified_time else None,
            "created_at": image_row.created_at.isoformat() if image_row.created_at else None,
            "source_provider": storage_info.source_provider,
            "source_key": storage_info.source_key,
            "source_url": _build_source_url(storage_info, tenant, image_row),
            "thumbnail_url": storage_info.thumbnail_url,
            "media_type": (storage_info.asset.media_type if storage_info.asset else None) or "image",
            "mime_type": storage_info.asset.mime_type if storage_info.asset else None,
            "duration_ms": storage_info.asset.duration_ms if storage_info.asset else None,
            "rating": image_row.rating,
            "permatags": image_permatags,
            "similarity_score": similarity_score,
        })

    return {
        "tenant_id": tenant.id,
        "source_image_id": source_image.id,
        "source_asset_id": str(source_image.asset_id),
        "source_media_type": source_media_type,
        "same_media_type": bool(same_media_type),
        "images": images_list,
        "count": len(images_list),
        "limit": requested_limit,
    }


@router.get("/images/{image_id}", response_model=dict, operation_id="get_image")
async def get_image(
    image_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Get image details with signed thumbnail URL."""
    image = db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        tenant_column_filter(ImageMetadata, tenant),
    ).first()

    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    # Get tags
    active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')
    tags = db.query(MachineTag).filter(
        MachineTag.asset_id == image.asset_id,
        tenant_column_filter(MachineTag, tenant)
    ).all()

    # Get permatags
    permatags = db.query(Permatag).filter(
        Permatag.asset_id == image.asset_id,
        tenant_column_filter(Permatag, tenant),
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
        from zoltag.models.config import KeywordCategory
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
        tenant_column_filter(Permatag, tenant),
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
        "media_type": (storage_info.asset.media_type if storage_info.asset else None) or "image",
        "mime_type": storage_info.asset.mime_type if storage_info.asset else None,
        "duration_ms": storage_info.asset.duration_ms if storage_info.asset else None,
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
    image = db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        tenant_column_filter(ImageMetadata, tenant),
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
        "media_type": (asset.media_type if asset else None) or "image",
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
        tenant_column_filter(Asset, tenant),
    ).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    linked_image_ids = [
        row[0]
        for row in db.query(ImageMetadata.id)
        .filter(
            tenant_column_filter(ImageMetadata, tenant),
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
        "media_type": asset.media_type,
        "mime_type": asset.mime_type,
        "width": asset.width,
        "height": asset.height,
        "duration_ms": asset.duration_ms,
        "linked_image_ids": linked_image_ids,
    }


@router.delete("/images/{image_id}", response_model=dict, operation_id="delete_image")
async def delete_image(
    image_id: int,
    _current_user: UserProfile = Depends(require_tenant_role_from_header("admin")),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    """Delete an asset image and related tenant-scoped records."""
    image = db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        tenant_column_filter(ImageMetadata, tenant),
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
            tenant_column_filter(Asset, tenant),
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
            tenant_column_filter(Permatag, tenant),
            Permatag.asset_id == asset_id,
        ).delete(synchronize_session=False)
        db.query(MachineTag).filter(
            tenant_column_filter(MachineTag, tenant),
            MachineTag.asset_id == asset_id,
        ).delete(synchronize_session=False)
        db.query(ImageEmbedding).filter(
            tenant_column_filter(ImageEmbedding, tenant),
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
        tenant_column_filter(ImageMetadata, tenant),
    ).delete(synchronize_session=False)
    if asset is not None:
        db.query(Asset).filter(
            Asset.id == asset_id,
            tenant_column_filter(Asset, tenant),
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
