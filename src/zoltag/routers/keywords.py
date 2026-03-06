"""Router for keyword operations."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, distinct, and_, or_
from sqlalchemy.orm import Session
from typing import Optional, List

from zoltag.dependencies import get_db, get_tenant, get_tenant_setting
from zoltag.auth.dependencies import get_current_user
from zoltag.auth.models import UserProfile
from zoltag.asset_helpers import bulk_preload_thumbnail_urls, load_assets_for_images
from zoltag.list_visibility import can_view_list, is_tenant_admin_user
from zoltag.config.db_config import ConfigManager
from zoltag.tenant import Tenant
from zoltag.metadata import Asset, ImageMetadata, Permatag, KeywordModel, MachineTag
from zoltag.models.config import PhotoList, PhotoListItem, Keyword, KeywordCategory
from zoltag.tenant_scope import tenant_column_filter

router = APIRouter(
    prefix="/api/v1",
    tags=["keywords"]
)


@router.get("/keywords")
async def get_available_keywords(
    tenant: Tenant = Depends(get_tenant),
    current_user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db),
    list_id: Optional[int] = None,
    rating: Optional[int] = None,
    rating_operator: str = "eq",
    hide_zero_rating: bool = False,
    reviewed: Optional[bool] = None,
    source: Optional[str] = None,
    include_people: bool = False
):
    """Get all available keywords from config for faceted search with counts.

    Counts reflect active filters (list, rating) so dropdown matches actual results.
    """
    config_mgr = ConfigManager(db, tenant.id)
    all_keywords = config_mgr.get_all_keywords(include_people=include_people)

    # Base on Asset so videos are included — ImageMetadata only covers images.
    # Only join ImageMetadata when a rating filter actually requires it.
    needs_image_metadata = rating is not None or hide_zero_rating

    if needs_image_metadata:
        image_assets_query = db.query(ImageMetadata.asset_id).filter(
            tenant_column_filter(ImageMetadata, tenant),
            ImageMetadata.asset_id.is_not(None),
        )
    else:
        image_assets_query = db.query(Asset.id.label("asset_id")).filter(
            tenant_column_filter(Asset, tenant),
        )

    if list_id is not None:
        is_tenant_admin = is_tenant_admin_user(db, tenant, current_user)
        lst = db.query(PhotoList).filter(
            PhotoList.id == list_id,
            tenant_column_filter(PhotoList, tenant),
        ).first()
        if not lst or not can_view_list(lst, user=current_user, is_tenant_admin=is_tenant_admin):
            return {"tenant_id": tenant.id, "keywords_by_category": {}, "all_keywords": []}
        list_assets_subq = db.query(PhotoListItem.asset_id).filter(
            PhotoListItem.list_id == list_id,
            PhotoListItem.asset_id.is_not(None),
        )
        if needs_image_metadata:
            image_assets_query = image_assets_query.filter(ImageMetadata.asset_id.in_(list_assets_subq))
        else:
            image_assets_query = image_assets_query.filter(Asset.id.in_(list_assets_subq))

    if rating is not None:
        if rating_operator == "gte":
            image_assets_query = image_assets_query.filter(ImageMetadata.rating >= rating)
        elif rating_operator == "gt":
            image_assets_query = image_assets_query.filter(ImageMetadata.rating > rating)
        else:
            image_assets_query = image_assets_query.filter(ImageMetadata.rating == rating)

    if hide_zero_rating:
        image_assets_query = image_assets_query.filter(ImageMetadata.rating != 0)

    if reviewed is not None:
        reviewed_subq = db.query(distinct(Permatag.asset_id)).filter(
            tenant_column_filter(Permatag, tenant),
            Permatag.asset_id.is_not(None),
        )
        if needs_image_metadata:
            if reviewed:
                image_assets_query = image_assets_query.filter(ImageMetadata.asset_id.in_(reviewed_subq))
            else:
                image_assets_query = image_assets_query.filter(ImageMetadata.asset_id.notin_(reviewed_subq))
        else:
            if reviewed:
                image_assets_query = image_assets_query.filter(Asset.id.in_(reviewed_subq))
            else:
                image_assets_query = image_assets_query.filter(Asset.id.notin_(reviewed_subq))

    image_assets_subq = image_assets_query.subquery()
    total_assets_in_scope = int(
        db.query(func.count(distinct(image_assets_subq.c.asset_id))).scalar() or 0
    )

    source_mode = (source or "current").lower()
    active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')

    counts_query = None
    if source_mode == "permatags":
        counts_query = db.query(
            Keyword.keyword,
            KeywordCategory.name.label("category"),
            func.count(distinct(Permatag.asset_id)).label("count")
        ).join(
            Keyword, Keyword.id == Permatag.keyword_id
        ).join(
            KeywordCategory, Keyword.category_id == KeywordCategory.id
        ).join(
            image_assets_subq, image_assets_subq.c.asset_id == Permatag.asset_id
        ).filter(
            tenant_column_filter(Permatag, tenant),
            Permatag.signum == 1
        ).group_by(
            Keyword.keyword, KeywordCategory.name
        )
    else:
        machine_base = db.query(
            MachineTag.keyword_id.label("keyword_id"),
            MachineTag.asset_id.label("asset_id")
        ).join(
            image_assets_subq, image_assets_subq.c.asset_id == MachineTag.asset_id
        ).outerjoin(
            Permatag,
            (Permatag.asset_id == MachineTag.asset_id)
            & (Permatag.keyword_id == MachineTag.keyword_id)
            & (Permatag.signum == -1)
        ).filter(
            tenant_column_filter(MachineTag, tenant),
            MachineTag.tag_type == active_tag_type,
            MachineTag.asset_id.is_not(None),
            Permatag.id.is_(None)
        )

        permatag_base = db.query(
            Permatag.keyword_id.label("keyword_id"),
            Permatag.asset_id.label("asset_id")
        ).join(
            image_assets_subq, image_assets_subq.c.asset_id == Permatag.asset_id
        ).filter(
            tenant_column_filter(Permatag, tenant),
            Permatag.asset_id.is_not(None),
            Permatag.signum == 1
        )

        union_tags = machine_base.union_all(permatag_base).subquery()
        counts_query = db.query(
            Keyword.keyword,
            KeywordCategory.name.label("category"),
            func.count(distinct(union_tags.c.asset_id)).label("count")
        ).join(
            Keyword, Keyword.id == union_tags.c.keyword_id
        ).join(
            KeywordCategory, Keyword.category_id == KeywordCategory.id
        ).group_by(
            Keyword.keyword, KeywordCategory.name
        )

    category_tagged_counts = None
    if source_mode == "permatags":
        category_tagged_rows = db.query(
            KeywordCategory.name.label("category"),
            func.count(distinct(Permatag.asset_id)).label("count")
        ).join(
            Keyword, Keyword.id == Permatag.keyword_id
        ).join(
            KeywordCategory, Keyword.category_id == KeywordCategory.id
        ).join(
            image_assets_subq, image_assets_subq.c.asset_id == Permatag.asset_id
        ).filter(
            tenant_column_filter(Permatag, tenant),
            Permatag.signum == 1
        ).group_by(
            KeywordCategory.name
        ).all()
        category_tagged_counts = {
            category: int(count or 0)
            for category, count in category_tagged_rows
        }

    counts_dict = {}
    if counts_query is not None:
        for keyword, category, count in counts_query.all():
            counts_dict[keyword] = count

    # Group by category with counts
    by_category = {}
    for kw in all_keywords:
        cat = kw['category']
        keyword = kw['keyword']
        if cat not in by_category:
            by_category[cat] = []
        category_tagged_count = category_tagged_counts.get(cat, 0) if category_tagged_counts is not None else None
        category_missing_count = (
            max(total_assets_in_scope - category_tagged_count, 0)
            if category_tagged_count is not None
            else None
        )
        by_category[cat].append({
            'keyword': keyword,
            'count': counts_dict.get(keyword, 0),
            'prompt': kw.get('prompt'),
            'person_id': kw.get('person_id'),
            'tag_type': kw.get('tag_type', 'keyword'),
            'category_tagged_count': category_tagged_count,
            'category_missing_count': category_missing_count,
        })

    return {
        "tenant_id": tenant.id,
        "keywords_by_category": by_category,
        "all_keywords": [kw['keyword'] for kw in all_keywords]
    }


@router.get("/keywords/gallery-previews")
async def get_keyword_gallery_previews(
    tenant: Tenant = Depends(get_tenant),
    _current_user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db),
    preview_count: int = 3,
    target: Optional[List[str]] = Query(default=None),
):
    """Return keyword counts and representative thumbnail previews in one request."""
    capped_preview_count = max(1, min(int(preview_count or 3), 6))

    target_pairs = []
    for value in target or []:
        raw = str(value or "").strip()
        if not raw or "::" not in raw:
            continue
        category, keyword = raw.split("::", 1)
        category = category.strip()
        keyword = keyword.strip()
        if not category or not keyword:
            continue
        target_pairs.append((category, keyword))
    target_pairs = list(set(target_pairs))

    count_by_keyword = {}
    keyword_rows = []
    if target_pairs:
        keyword_query = db.query(
            Keyword.id.label("keyword_id"),
            Keyword.keyword.label("keyword"),
            KeywordCategory.name.label("category"),
        ).join(
            KeywordCategory, Keyword.category_id == KeywordCategory.id
        ).filter(
            tenant_column_filter(Keyword, tenant),
            tenant_column_filter(KeywordCategory, tenant),
            or_(*[
                and_(KeywordCategory.name == category, Keyword.keyword == keyword)
                for category, keyword in target_pairs
            ]),
        )
        keyword_rows = keyword_query.order_by(
            KeywordCategory.name.asc(),
            Keyword.keyword.asc(),
        ).all()
        if keyword_rows:
            target_keyword_ids = [int(row.keyword_id) for row in keyword_rows]
            count_rows = db.query(
                Permatag.keyword_id,
                func.count(distinct(Permatag.asset_id)).label("count"),
            ).filter(
                tenant_column_filter(Permatag, tenant),
                Permatag.signum == 1,
                Permatag.asset_id.is_not(None),
                Permatag.keyword_id.in_(target_keyword_ids),
            ).group_by(
                Permatag.keyword_id
            ).all()
            count_by_keyword = {
                int(keyword_id): int(count or 0)
                for keyword_id, count in count_rows
            }
            keyword_rows = [
                row for row in keyword_rows
                if count_by_keyword.get(int(row.keyword_id), 0) > 0
            ]
    else:
        counted_keyword_rows = db.query(
            Permatag.keyword_id.label("keyword_id"),
            Keyword.keyword.label("keyword"),
            KeywordCategory.name.label("category"),
            func.count(distinct(Permatag.asset_id)).label("count"),
        ).join(
            Keyword, Keyword.id == Permatag.keyword_id
        ).join(
            KeywordCategory, Keyword.category_id == KeywordCategory.id
        ).filter(
            tenant_column_filter(Permatag, tenant),
            tenant_column_filter(Keyword, tenant),
            tenant_column_filter(KeywordCategory, tenant),
            Permatag.signum == 1,
            Permatag.asset_id.is_not(None),
        ).group_by(
            Permatag.keyword_id,
            Keyword.keyword,
            KeywordCategory.name,
        ).order_by(
            KeywordCategory.name.asc(),
            Keyword.keyword.asc(),
        ).all()
        keyword_rows = counted_keyword_rows
        count_by_keyword = {
            int(row.keyword_id): int(row.count or 0)
            for row in counted_keyword_rows
        }

    if not keyword_rows:
        return {
            "tenant_id": tenant.id,
            "preview_count": capped_preview_count,
            "previews": [],
        }

    keyword_ids = [int(row.keyword_id) for row in keyword_rows]

    previews_by_keyword = {}
    if len(keyword_ids) <= 24:
        # Gallery requests are usually a small targeted set.
        # Per-keyword LIMIT queries stay fast and index-friendly.
        for keyword_id in keyword_ids:
            image_rows = db.query(
                ImageMetadata.id.label("image_id"),
            ).join(
                Permatag,
                and_(
                    Permatag.asset_id == ImageMetadata.asset_id,
                    tenant_column_filter(Permatag, tenant),
                    Permatag.signum == 1,
                    Permatag.keyword_id == int(keyword_id),
                    Permatag.asset_id.is_not(None),
                ),
            ).filter(
                tenant_column_filter(ImageMetadata, tenant),
            ).order_by(
                Permatag.id.desc(),
            ).limit(
                capped_preview_count
            ).all()
            if not image_rows:
                continue
            previews_by_keyword[int(keyword_id)] = [
                {
                    "id": int(image_id),
                    "rank": rank,
                }
                for rank, (image_id,) in enumerate(image_rows, start=1)
                if image_id is not None
            ]
    else:
        ranked_preview_subquery = db.query(
            Permatag.keyword_id.label("keyword_id"),
            Permatag.asset_id.label("asset_id"),
            func.row_number().over(
                partition_by=Permatag.keyword_id,
                order_by=Permatag.id.desc(),
            ).label("preview_rank"),
        ).filter(
            tenant_column_filter(Permatag, tenant),
            Permatag.signum == 1,
            Permatag.asset_id.is_not(None),
            Permatag.keyword_id.in_(keyword_ids),
        ).subquery()

        preview_rows = db.query(
            ranked_preview_subquery.c.keyword_id,
            ImageMetadata.id.label("image_id"),
            ranked_preview_subquery.c.preview_rank,
        ).join(
            ImageMetadata,
            and_(
                ImageMetadata.asset_id == ranked_preview_subquery.c.asset_id,
                tenant_column_filter(ImageMetadata, tenant),
            ),
        ).filter(
            ranked_preview_subquery.c.preview_rank <= capped_preview_count
        ).order_by(
            ranked_preview_subquery.c.keyword_id.asc(),
            ranked_preview_subquery.c.preview_rank.asc(),
        ).all()

        for keyword_id, image_id, preview_rank in preview_rows:
            keyword_int = int(keyword_id)
            image_int = int(image_id)
            previews_by_keyword.setdefault(keyword_int, []).append({
                "id": image_int,
                "rank": int(preview_rank),
            })

    preview_image_ids = {
        int(image.get("id"))
        for images in previews_by_keyword.values()
        for image in (images or [])
        if image.get("id") is not None
    }
    thumbnail_by_image_id = {}
    if preview_image_ids:
        preview_image_rows = db.query(ImageMetadata).filter(
            ImageMetadata.id.in_(list(preview_image_ids)),
            tenant_column_filter(ImageMetadata, tenant),
        ).all()
        assets_by_id = load_assets_for_images(db, preview_image_rows)
        thumbnail_by_image_id = bulk_preload_thumbnail_urls(
            preview_image_rows,
            tenant,
            assets_by_id,
        )

    for images in previews_by_keyword.values():
        for image in images:
            image_id = int(image.get("id"))
            image["thumbnail_url"] = (
                thumbnail_by_image_id.get(image_id)
                or f"/api/v1/images/{image_id}/thumbnail"
            )

    return {
        "tenant_id": tenant.id,
        "preview_count": capped_preview_count,
        "previews": [
            {
                "category": row.category,
                "keyword": row.keyword,
                "count": count_by_keyword.get(int(row.keyword_id), 0),
                "images": previews_by_keyword.get(int(row.keyword_id), []),
            }
            for row in keyword_rows
        ],
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
        tenant_column_filter(Keyword, tenant)
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
        func.count(distinct(MachineTag.asset_id)).label("count")
    ).filter(
        tenant_column_filter(MachineTag, tenant),
        MachineTag.tag_type == 'siglip',
        MachineTag.asset_id.is_not(None),
    ).group_by(
        MachineTag.keyword_id
    ).all()

    # Get latest keyword model name
    model_row = db.query(KeywordModel.model_name).filter(
        tenant_column_filter(KeywordModel, tenant)
    ).order_by(
        func.coalesce(KeywordModel.updated_at, KeywordModel.created_at).desc()
    ).first()

    # Get trained keyword model tags from machine_tags
    keyword_model_rows = []
    if model_row:
        keyword_model_rows = db.query(
            MachineTag.keyword_id,
            func.count(distinct(MachineTag.asset_id)).label("count")
        ).filter(
            tenant_column_filter(MachineTag, tenant),
            MachineTag.tag_type == 'trained',
            MachineTag.model_name == model_row.model_name,
            MachineTag.asset_id.is_not(None),
        ).group_by(
            MachineTag.keyword_id
        ).all()

    permatag_rows = db.query(
        Permatag.keyword_id,
        func.count(distinct(Permatag.asset_id)).label("count")
    ).filter(
        tenant_column_filter(Permatag, tenant),
        Permatag.asset_id.is_not(None),
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

    permatag_counts = {keyword_id: int(count or 0) for keyword_id, count in permatag_rows}

    def permatags_to_by_category_all():
        by_category = {}
        for keyword_id, keyword, category in keywords_data:
            label = category or "uncategorized"
            by_category.setdefault(label, []).append({
                "keyword": keyword,
                "count": permatag_counts.get(keyword_id, 0)
            })
        return by_category

    return {
        "tenant_id": tenant.id,
        "sources": {
            "zero_shot": to_by_category(zero_shot_rows),
            "keyword_model": to_by_category(keyword_model_rows),
            "permatags": permatags_to_by_category_all()
        }
    }
