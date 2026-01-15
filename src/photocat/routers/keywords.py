"""Router for keyword operations."""

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import Optional

from photocat.dependencies import get_db, get_tenant
from photocat.tenant import Tenant
from photocat.metadata import ImageTag, ImageMetadata, Permatag
from photocat.models.config import PhotoList, PhotoListItem
from photocat.config.db_config import ConfigManager

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
    hide_zero_rating: bool = False
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

    # Apply permatag filtering to get "current keywords" for each image
    # This matches the logic in the images endpoint
    effective_images = filter_ids if filter_ids is not None else None

    if effective_images is None:
        # Get all images if no filters
        all_img_ids = db.query(ImageMetadata.id).filter_by(tenant_id=tenant.id).all()
        effective_images = {row[0] for row in all_img_ids}

    # Get all tags for filtered images
    all_tags = db.query(ImageTag).filter(
        ImageTag.tenant_id == tenant.id,
        ImageTag.image_id.in_(effective_images)
    ).all() if effective_images else []

    # Get all permatags for filtered images
    all_permatags = db.query(Permatag).filter(
        Permatag.tenant_id == tenant.id,
        Permatag.image_id.in_(effective_images)
    ).all() if effective_images else []

    # Build permatag map by image_id and keyword
    permatag_map = {}
    for p in all_permatags:
        if p.image_id not in permatag_map:
            permatag_map[p.image_id] = {}
        permatag_map[p.image_id][p.keyword] = p.signum

    # Compute "current tags" for each image (with permatag overrides)
    current_tags_by_image = {}
    for img_id in effective_images:
        current_tags_by_image[img_id] = []

    for tag in all_tags:
        # Include machine tag only if not negatively permatagged
        if tag.image_id in permatag_map and permatag_map[tag.image_id].get(tag.keyword) == -1:
            continue  # Skip negatively permatagged machine tags
        current_tags_by_image[tag.image_id].append(tag.keyword)

    # Add positive permatags
    for p in all_permatags:
        if p.signum == 1:
            if p.keyword not in current_tags_by_image.get(p.image_id, []):
                if p.image_id not in current_tags_by_image:
                    current_tags_by_image[p.image_id] = []
                current_tags_by_image[p.image_id].append(p.keyword)

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
