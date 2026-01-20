"""Router for keyword operations."""

from fastapi import APIRouter, Depends
from sqlalchemy import func, distinct
from sqlalchemy.orm import Session
from typing import Optional

from photocat.dependencies import get_db, get_tenant, get_tenant_setting
from photocat.config.db_config import ConfigManager
from photocat.tenant import Tenant
from photocat.metadata import ImageMetadata, Permatag, KeywordModel, MachineTag
from photocat.models.config import PhotoList, PhotoListItem, Keyword, KeywordCategory

router = APIRouter(
    prefix="/api/v1",
    tags=["keywords"]
)


@router.get("/keywords")
async def get_available_keywords(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    list_id: Optional[int] = None,
    rating: Optional[int] = None,
    rating_operator: str = "eq",
    hide_zero_rating: bool = False,
    reviewed: Optional[bool] = None
):
    """Get all available keywords from config for faceted search with counts.

    Counts reflect active filters (list, rating) so dropdown matches actual results.
    """
    config_mgr = ConfigManager(db, tenant.id)
    all_keywords = config_mgr.get_all_keywords()

    # Build filter_ids based on active filters (same logic as images endpoint)
    filter_ids = None

    if list_id is not None:
        lst = db.query(PhotoList).filter_by(id=list_id, tenant_id=tenant.id).first()
        if lst:
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
        reviewed_rows = db.query(Permatag.image_id).join(
            ImageMetadata, ImageMetadata.id == Permatag.image_id
        ).filter(
            ImageMetadata.tenant_id == tenant.id
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

    # Apply permatag filtering to get "current keywords" for each image
    # This matches the logic in the images endpoint
    effective_images = filter_ids if filter_ids is not None else None

    if effective_images is None:
        # Get all images if no filters
        all_img_ids = db.query(ImageMetadata.id).filter_by(tenant_id=tenant.id).all()
        effective_images = {row[0] for row in all_img_ids}

    # Get active tag type from tenant config (must be added in PR 2 or earlier)
    # Fallback to 'siglip' if not configured (for backward compatibility)
    active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')

    # Get all tags for filtered images (from primary algorithm only)
    all_tags = db.query(MachineTag).filter(
        MachineTag.tenant_id == tenant.id,
        MachineTag.image_id.in_(effective_images),
        MachineTag.tag_type == active_tag_type  # Filter by primary algorithm
    ).all() if effective_images else []

    # Get all permatags for filtered images
    all_permatags = db.query(Permatag).filter(
        Permatag.image_id.in_(effective_images)
    ).all() if effective_images else []

    # Load keyword info for all tags and permatags
    all_keyword_ids = set()
    for tag in all_tags:
        all_keyword_ids.add(tag.keyword_id)
    for p in all_permatags:
        all_keyword_ids.add(p.keyword_id)

    # Build keyword lookup map
    keywords_map = {}
    if all_keyword_ids:
        keywords_data = db.query(
            Keyword.id,
            Keyword.keyword,
            KeywordCategory.name
        ).join(
            KeywordCategory, Keyword.category_id == KeywordCategory.id
        ).filter(
            Keyword.id.in_(all_keyword_ids)
        ).all()
        for kw_id, kw_name, cat_name in keywords_data:
            keywords_map[kw_id] = {"keyword": kw_name, "category": cat_name}

    # Build permatag map by image_id and keyword_id
    permatag_map = {}
    for p in all_permatags:
        if p.image_id not in permatag_map:
            permatag_map[p.image_id] = {}
        permatag_map[p.image_id][p.keyword_id] = p.signum

    # Compute "current tags" for each image (with permatag overrides)
    current_tags_by_image = {}
    for img_id in effective_images:
        current_tags_by_image[img_id] = []

    for tag in all_tags:
        # Include machine tag only if not negatively permatagged
        if tag.image_id in permatag_map and permatag_map[tag.image_id].get(tag.keyword_id) == -1:
            continue  # Skip negatively permatagged machine tags
        keyword_name = keywords_map.get(tag.keyword_id, {}).get("keyword", "unknown")
        current_tags_by_image[tag.image_id].append(keyword_name)

    # Add positive permatags
    for p in all_permatags:
        if p.signum == 1:
            keyword_name = keywords_map.get(p.keyword_id, {}).get("keyword", "unknown")
            if keyword_name not in current_tags_by_image.get(p.image_id, []):
                if p.image_id not in current_tags_by_image:
                    current_tags_by_image[p.image_id] = []
                current_tags_by_image[p.image_id].append(keyword_name)

    # Count images by keyword (using current/effective tags)
    keyword_image_counts = {}
    for img_id, current_keywords in current_tags_by_image.items():
        for keyword in current_keywords:
            keyword_image_counts[keyword] = keyword_image_counts.get(keyword, 0) + 1

    counts_dict = keyword_image_counts

    # Group by category with counts
    by_category = {}
    for kw in all_keywords:
        cat = kw['category']
        keyword = kw['keyword']
        if cat not in by_category:
            by_category[cat] = []
        by_category[cat].append({
            'keyword': keyword,
            'count': counts_dict.get(keyword, 0)
        })

    return {
        "tenant_id": tenant.id,
        "keywords_by_category": by_category,
        "all_keywords": [kw['keyword'] for kw in all_keywords]
    }


@router.get("/tag-stats")
async def get_tag_stats(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Get tag counts by category for different tag sources."""
    # Fetch keywords from database with IDs for FK mapping
    keywords_data = db.query(
        Keyword.id,
        Keyword.keyword,
        KeywordCategory.name.label("category")
    ).join(
        KeywordCategory, Keyword.category_id == KeywordCategory.id
    ).filter(
        Keyword.tenant_id == tenant.id
    ).all()

    # Build mapping from keyword_id to keyword info
    keyword_id_to_info = {
        row.id: {
            "keyword": row.keyword,
            "category": row.category
        }
        for row in keywords_data
    }

    # Get zero-shot (SigLIP) tags from machine_tags
    zero_shot_rows = db.query(
        MachineTag.keyword_id,
        func.count(distinct(MachineTag.image_id)).label("count")
    ).filter(
        MachineTag.tenant_id == tenant.id,
        MachineTag.tag_type == 'siglip'
    ).group_by(
        MachineTag.keyword_id
    ).all()

    # Get latest keyword model name
    model_row = db.query(KeywordModel.model_name).filter(
        KeywordModel.tenant_id == tenant.id
    ).order_by(
        func.coalesce(KeywordModel.updated_at, KeywordModel.created_at).desc()
    ).first()

    # Get trained keyword model tags from machine_tags
    keyword_model_rows = []
    if model_row:
        keyword_model_rows = db.query(
            MachineTag.keyword_id,
            func.count(distinct(MachineTag.image_id)).label("count")
        ).filter(
            MachineTag.tenant_id == tenant.id,
            MachineTag.tag_type == 'trained',
            MachineTag.model_name == model_row.model_name
        ).group_by(
            MachineTag.keyword_id
        ).all()

    permatag_rows = db.query(
        Permatag.keyword_id,
        func.count(distinct(Permatag.image_id)).label("count")
    ).join(
        ImageMetadata, ImageMetadata.id == Permatag.image_id
    ).filter(
        ImageMetadata.tenant_id == tenant.id,
        Permatag.signum == 1
    ).group_by(
        Permatag.keyword_id
    ).all()

    def to_by_category(rows):
        by_category = {}
        for keyword_id, count in rows:
            kw_info = keyword_id_to_info.get(keyword_id)
            if not kw_info:
                continue
            category = kw_info.get("category", "uncategorized")
            keyword = kw_info.get("keyword", "unknown")
            label = category or "uncategorized"
            by_category.setdefault(label, []).append({
                "keyword": keyword,
                "count": int(count or 0)
            })
        return by_category

    def permatags_to_by_category(rows):
        by_category = {}
        for keyword_id, count in rows:
            kw_info = keyword_id_to_info.get(keyword_id)
            if not kw_info:
                continue
            category = kw_info.get("category", "uncategorized")
            keyword = kw_info.get("keyword", "unknown")
            label = category or "uncategorized"
            by_category.setdefault(label, []).append({
                "keyword": keyword,
                "count": int(count or 0)
            })
        return by_category

    return {
        "tenant_id": tenant.id,
        "sources": {
            "zero_shot": to_by_category(zero_shot_rows),
            "keyword_model": to_by_category(keyword_model_rows),
            "permatags": permatags_to_by_category(permatag_rows)
        }
    }
