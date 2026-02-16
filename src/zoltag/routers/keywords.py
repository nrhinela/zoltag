"""Router for keyword operations."""

from fastapi import APIRouter, Depends
from sqlalchemy import func, distinct
from sqlalchemy.orm import Session
from typing import Optional

from zoltag.dependencies import get_db, get_tenant, get_tenant_setting
from zoltag.auth.dependencies import get_current_user
from zoltag.auth.models import UserProfile
from zoltag.list_visibility import can_view_list, is_tenant_admin_user
from zoltag.config.db_config import ConfigManager
from zoltag.tenant import Tenant
from zoltag.metadata import ImageMetadata, Permatag, KeywordModel, MachineTag
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

    image_assets_query = db.query(ImageMetadata.asset_id).filter(
        tenant_column_filter(ImageMetadata, tenant),
        ImageMetadata.asset_id.is_not(None),
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
        image_assets_query = image_assets_query.filter(ImageMetadata.asset_id.in_(list_assets_subq))

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
        if reviewed:
            image_assets_query = image_assets_query.filter(ImageMetadata.asset_id.in_(reviewed_subq))
        else:
            image_assets_query = image_assets_query.filter(ImageMetadata.asset_id.notin_(reviewed_subq))

    image_assets_subq = image_assets_query.subquery()

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
