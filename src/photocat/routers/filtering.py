"""Shared filtering utilities for image queries.

This module contains extracted filtering logic from the images router.
The functions return in-memory ID sets to preserve exact behavior from the
monolithic implementation.

TODO (Phase 4): Refactor these functions to return SQLAlchemy subquery/CTE objects
instead of materialized sets for better performance with large datasets.
"""

from typing import Optional, Set, Dict, List
import json

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from photocat.tenant import Tenant
from photocat.metadata import ImageMetadata, MachineTag, Permatag
from photocat.models.config import PhotoList, PhotoListItem, Keyword, KeywordCategory
from photocat.dependencies import get_tenant_setting


def apply_list_filter(
    db: Session,
    tenant: Tenant,
    list_id: int
) -> Set[int]:
    """Filter images by PhotoList membership.

    Args:
        db: Database session
        tenant: Current tenant
        list_id: PhotoList ID

    Returns:
        Set of image IDs in the list

    Raises:
        HTTPException: If list not found
    """
    lst = db.query(PhotoList).filter_by(id=list_id, tenant_id=tenant.id).first()
    if not lst:
        raise HTTPException(status_code=404, detail="List not found")

    list_image_ids = db.query(PhotoListItem.photo_id).filter(
        PhotoListItem.list_id == list_id
    ).all()
    return {row[0] for row in list_image_ids}


def apply_rating_filter(
    db: Session,
    tenant: Tenant,
    rating: int,
    operator: str,
    existing_filter: Optional[Set[int]] = None
) -> Set[int]:
    """Filter images by rating.

    Args:
        db: Database session
        tenant: Current tenant
        rating: Rating value (0-3)
        operator: Comparison operator ("eq", "gte", "gt")
        existing_filter: Existing filter set to intersect with

    Returns:
        Set of image IDs matching rating criteria
    """
    rating_query = db.query(ImageMetadata.id).filter(
        ImageMetadata.tenant_id == tenant.id
    )

    if operator == "gte":
        rating_query = rating_query.filter(ImageMetadata.rating >= rating)
    elif operator == "gt":
        rating_query = rating_query.filter(ImageMetadata.rating > rating)
    else:
        rating_query = rating_query.filter(ImageMetadata.rating == rating)

    rating_image_ids = rating_query.all()
    rating_ids = {row[0] for row in rating_image_ids}

    if existing_filter is None:
        return rating_ids
    else:
        return existing_filter.intersection(rating_ids)


def apply_hide_zero_rating_filter(
    db: Session,
    tenant: Tenant,
    existing_filter: Optional[Set[int]] = None
) -> Set[int]:
    """Exclude images with zero rating.

    Args:
        db: Database session
        tenant: Current tenant
        existing_filter: Existing filter set to exclude from

    Returns:
        Set of image IDs excluding zero-rated images
    """
    zero_rating_ids = db.query(ImageMetadata.id).filter(
        ImageMetadata.tenant_id == tenant.id,
        ImageMetadata.rating == 0
    ).all()
    zero_ids = {row[0] for row in zero_rating_ids}

    if existing_filter is None:
        all_image_ids = db.query(ImageMetadata.id).filter(
            ImageMetadata.tenant_id == tenant.id
        ).all()
        return {row[0] for row in all_image_ids} - zero_ids
    else:
        return existing_filter - zero_ids


def apply_reviewed_filter(
    db: Session,
    tenant: Tenant,
    reviewed: bool,
    existing_filter: Optional[Set[int]] = None
) -> Set[int]:
    """Filter by permatag review status.

    Args:
        db: Database session
        tenant: Current tenant
        reviewed: True for reviewed images, False for unreviewed
        existing_filter: Existing filter set to intersect with

    Returns:
        Set of image IDs matching review status
    """
    reviewed_rows = db.query(Permatag.image_id).filter(
        Permatag.tenant_id == tenant.id
    ).distinct().all()
    reviewed_ids = {row[0] for row in reviewed_rows}

    if existing_filter is None:
        all_image_ids = db.query(ImageMetadata.id).filter(
            ImageMetadata.tenant_id == tenant.id
        ).all()
        base_ids = {row[0] for row in all_image_ids}
        return reviewed_ids if reviewed else (base_ids - reviewed_ids)
    else:
        return existing_filter.intersection(reviewed_ids) if reviewed else (existing_filter - reviewed_ids)


def apply_permatag_filter(
    db: Session,
    tenant: Tenant,
    keyword: str,
    signum: Optional[int] = None,
    missing: bool = False,
    category: Optional[str] = None,
    existing_filter: Optional[Set[int]] = None
) -> Set[int]:
    """Filter images by permatag keyword (and optional category/signum).

    Args:
        db: Database session
        tenant: Current tenant
        keyword: Permatag keyword to match
        signum: Optional permatag signum to match (1 or -1)
        missing: When true, exclude matching permatags from the result set
        category: Optional permatag category to match
        existing_filter: Existing filter set to intersect with

    Returns:
        Set of image IDs matching permatag criteria
    """
    normalized_keyword = (keyword or "").strip()
    if not normalized_keyword:
        return existing_filter if existing_filter is not None else set()

    # Look up keyword by name (case-insensitive)
    keyword_query = db.query(Keyword).filter(
        Keyword.tenant_id == tenant.id,
        func.lower(Keyword.keyword) == func.lower(normalized_keyword)
    )

    # Join with category if provided
    if category:
        keyword_query = keyword_query.join(
            KeywordCategory, Keyword.category_id == KeywordCategory.id
        ).filter(
            KeywordCategory.name == category
        )

    keyword_obj = keyword_query.first()

    if not keyword_obj:
        # Keyword not found
        if missing:
            # Return all images (since the keyword doesn't exist, nothing is missing)
            if existing_filter is None:
                all_image_ids = db.query(ImageMetadata.id).filter(
                    ImageMetadata.tenant_id == tenant.id
                ).all()
                return {row[0] for row in all_image_ids}
            return existing_filter
        else:
            # Return empty set (keyword not found)
            return set()

    # Query permatags by keyword_id
    permatag_query = db.query(Permatag.image_id).filter(
        Permatag.keyword_id == keyword_obj.id
    )
    if signum is not None:
        permatag_query = permatag_query.filter(Permatag.signum == signum)
    permatag_rows = permatag_query.all()
    permatag_ids = {row[0] for row in permatag_rows}

    if missing:
        if existing_filter is None:
            all_image_ids = db.query(ImageMetadata.id).filter(
                ImageMetadata.tenant_id == tenant.id
            ).all()
            return {row[0] for row in all_image_ids} - permatag_ids
        return existing_filter - permatag_ids

    if existing_filter is None:
        return permatag_ids
    return existing_filter.intersection(permatag_ids)


def compute_current_tags_for_images(
    db: Session,
    tenant: Tenant,
    image_ids: List[int],
    active_tag_type: str
) -> Dict[int, List[str]]:
    """Compute current tags for images (machine tags + permatags with precedence).

    Args:
        db: Database session
        tenant: Current tenant
        image_ids: List of image IDs to compute tags for
        active_tag_type: Active machine tag type (e.g., 'siglip')

    Returns:
        Dict mapping image_id to list of current keywords
    """
    # Get all machine tags for these images (from primary algorithm only)
    all_tags = db.query(MachineTag).filter(
        MachineTag.tenant_id == tenant.id,
        MachineTag.image_id.in_(image_ids),
        MachineTag.tag_type == active_tag_type
    ).all()

    # Get all permatags for these images
    all_permatags = db.query(Permatag).filter(
        Permatag.image_id.in_(image_ids)
    ).all()

    # Load all keywords to get names
    keyword_ids = set()
    for tag in all_tags:
        keyword_ids.add(tag.keyword_id)
    for p in all_permatags:
        keyword_ids.add(p.keyword_id)

    keywords_map = {}
    if keyword_ids:
        keywords = db.query(Keyword).filter(Keyword.id.in_(keyword_ids)).all()
        keywords_map = {kw.id: kw.keyword for kw in keywords}

    # Build permatag map by image_id and keyword_id
    permatag_map = {}
    for p in all_permatags:
        if p.image_id not in permatag_map:
            permatag_map[p.image_id] = {}
        permatag_map[p.image_id][p.keyword_id] = p.signum

    # Initialize current tags for ALL images (not just ones with tags)
    current_tags_by_image = {img_id: [] for img_id in image_ids}

    # Add machine tags for each image
    for tag in all_tags:
        # Include machine tag only if not negatively permatagged
        if tag.image_id in permatag_map and permatag_map[tag.image_id].get(tag.keyword_id) == -1:
            continue  # Skip negatively permatagged machine tags
        keyword_name = keywords_map.get(tag.keyword_id, "unknown")
        current_tags_by_image[tag.image_id].append(keyword_name)

    # Add positive permatags
    for p in all_permatags:
        if p.signum == 1:
            keyword_name = keywords_map.get(p.keyword_id, "unknown")
            # Only add if not already in machine tags
            if keyword_name not in current_tags_by_image[p.image_id]:
                current_tags_by_image[p.image_id].append(keyword_name)

    return current_tags_by_image


def apply_category_filters(
    db: Session,
    tenant: Tenant,
    category_filters_json: str,
    existing_filter: Optional[Set[int]] = None
) -> Optional[Set[int]]:
    """Apply per-category keyword filters.

    Args:
        db: Database session
        tenant: Current tenant
        category_filters_json: JSON string with category filters
        existing_filter: Existing filter set to intersect with

    Returns:
        Set of image IDs matching category filters, or None if no matches
    """
    try:
        filters = json.loads(category_filters_json)
    except json.JSONDecodeError:
        return existing_filter

    # Get active tag type from tenant config for filtering
    active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')

    # Determine base image set
    if existing_filter is not None:
        all_image_ids = list(existing_filter)
    else:
        all_images = db.query(ImageMetadata.id).filter_by(tenant_id=tenant.id).all()
        all_image_ids = [img[0] for img in all_images]

    # Compute current tags for all images
    current_tags_by_image = compute_current_tags_for_images(
        db, tenant, all_image_ids, active_tag_type
    )

    # Collect image IDs matching any category filter
    category_image_ids = []

    for category, filter_data in filters.items():
        category_keywords = filter_data.get('keywords', [])
        category_operator = filter_data.get('operator', 'OR').upper()

        if not category_keywords:
            continue

        # Filter based on current tags
        if category_operator == "OR":
            # Image must have ANY of the keywords in this category
            for image_id, current_keywords in current_tags_by_image.items():
                if any(kw in category_keywords for kw in current_keywords):
                    category_image_ids.append(image_id)
        elif category_operator == "AND":
            # Image must have ALL keywords in this category
            for image_id, current_keywords in current_tags_by_image.items():
                if all(kw in current_keywords for kw in category_keywords):
                    category_image_ids.append(image_id)

    if not category_image_ids:
        return set()  # Empty set means no matches

    # Remove duplicates
    unique_image_ids = set(category_image_ids)

    # Intersect with existing filter if provided
    if existing_filter is not None:
        unique_image_ids = unique_image_ids.intersection(existing_filter)

    return unique_image_ids


def calculate_relevance_scores(
    db: Session,
    tenant: Tenant,
    image_ids: List[int],
    keywords: List[str],
    active_tag_type: str
) -> Dict[int, float]:
    """Calculate relevance scores for images based on keyword matches.

    Args:
        db: Database session
        tenant: Current tenant
        image_ids: List of image IDs to score
        keywords: List of keywords to match against
        active_tag_type: Active machine tag type

    Returns:
        Dict mapping image_id to relevance score
    """
    # Look up keyword IDs for the given keyword names
    keyword_ids = db.query(Keyword.id).filter(
        Keyword.keyword.in_(keywords),
        Keyword.tenant_id == tenant.id
    ).all()
    keyword_id_list = [kw[0] for kw in keyword_ids]

    if not keyword_id_list:
        return {}

    image_tags = db.query(
        MachineTag.image_id,
        func.sum(MachineTag.confidence).label('relevance_score')
    ).filter(
        MachineTag.image_id.in_(image_ids),
        MachineTag.keyword_id.in_(keyword_id_list),
        MachineTag.tenant_id == tenant.id,
        MachineTag.tag_type == active_tag_type
    ).group_by(
        MachineTag.image_id
    ).all()

    return {img_id: float(score) for img_id, score in image_tags}
