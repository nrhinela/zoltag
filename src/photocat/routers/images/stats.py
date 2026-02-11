"""Image stats endpoint."""

import asyncio
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy import func, distinct, and_, case
from photocat.database import SessionLocal
from photocat.dependencies import get_tenant, get_tenant_setting
from photocat.tenant import Tenant
from photocat.metadata import ImageMetadata, MachineTag, Permatag
from photocat.models.config import Keyword, KeywordCategory, PhotoList

router = APIRouter()


def _compute_image_stats(tenant_id: str, include_ratings: bool) -> dict:
    """Synchronous stats computation - runs in a thread via run_in_executor.

    Opens its own DB session to avoid cross-thread session sharing.
    """
    db = SessionLocal()
    try:
        now_utc = datetime.utcnow()
        cutoff_6mo = now_utc - timedelta(days=183)
        cutoff_12mo = now_utc - timedelta(days=365)
        cutoff_2y = now_utc - timedelta(days=365 * 2)
        cutoff_5y = now_utc - timedelta(days=365 * 5)
        cutoff_10y = now_utc - timedelta(days=365 * 10)

        photo_date_expr = func.coalesce(
            ImageMetadata.capture_timestamp,
            ImageMetadata.modified_time,
            ImageMetadata.created_at,
        )

        # Single pass over image_metadata: count, newest date, age bins, rating counts
        img_row = db.query(
            func.count(ImageMetadata.id),
            func.max(photo_date_expr),
            func.sum(case((photo_date_expr >= cutoff_6mo, 1), else_=0)),
            func.sum(case((and_(photo_date_expr < cutoff_6mo, photo_date_expr >= cutoff_12mo), 1), else_=0)),
            func.sum(case((and_(photo_date_expr < cutoff_12mo, photo_date_expr >= cutoff_2y), 1), else_=0)),
            func.sum(case((and_(photo_date_expr < cutoff_2y, photo_date_expr >= cutoff_5y), 1), else_=0)),
            func.sum(case((and_(photo_date_expr < cutoff_5y, photo_date_expr >= cutoff_10y), 1), else_=0)),
            func.sum(case((photo_date_expr < cutoff_10y, 1), else_=0)),
            func.sum(case((ImageMetadata.rating == 0, 1), else_=0)),
            func.sum(case((ImageMetadata.rating == 1, 1), else_=0)),
            func.sum(case((ImageMetadata.rating == 2, 1), else_=0)),
            func.sum(case((ImageMetadata.rating == 3, 1), else_=0)),
            func.sum(case((ImageMetadata.rating > 0, 1), else_=0)),
        ).filter(
            ImageMetadata.tenant_id == tenant_id
        ).one()

        image_count = int(img_row[0] or 0)
        image_newest = img_row[1]
        asset_newest = img_row[1]  # same value, legacy field name kept
        photo_age_bins = [
            {"label": "0-6mo",  "count": int(img_row[2] or 0)},
            {"label": "6-12mo", "count": int(img_row[3] or 0)},
            {"label": "1-2y",   "count": int(img_row[4] or 0)},
            {"label": "2-5y",   "count": int(img_row[5] or 0)},
            {"label": "5-10y",  "count": int(img_row[6] or 0)},
            {"label": "10y+",   "count": int(img_row[7] or 0)},
        ]
        rating_counts = {
            'trash':   int(img_row[8] or 0),
            'stars_1': int(img_row[9] or 0),
            'stars_2': int(img_row[10] or 0),
            'stars_3': int(img_row[11] or 0),
        }
        rated_image_count = int(img_row[12] or 0)

        # Single pass over permatags: reviewed count, positive image count, positive tag count, oldest/newest
        ptag_row = db.query(
            func.count(distinct(Permatag.asset_id)),
            func.count(distinct(case((Permatag.signum == 1, Permatag.asset_id)))),
            func.count(case((Permatag.signum == 1, Permatag.id))),
            func.min(case((Permatag.signum == 1, Permatag.created_at))),
            func.max(case((Permatag.signum == 1, Permatag.created_at))),
        ).filter(
            Permatag.tenant_id == tenant_id,
            Permatag.asset_id.is_not(None),
        ).one()

        reviewed_image_count = int(ptag_row[0] or 0)
        positive_permatag_image_count = int(ptag_row[1] or 0)
        positive_permatag_count = int(ptag_row[2] or 0)
        positive_permatag_oldest = ptag_row[3]
        positive_permatag_newest = ptag_row[4]

        # Get active tag type from tenant settings
        active_tag_type = get_tenant_setting(db, tenant_id, 'active_machine_tag_type', default='siglip')

        ml_tag_count = db.query(func.count(distinct(MachineTag.asset_id))).filter(
            MachineTag.tenant_id == tenant_id,
            MachineTag.tag_type == active_tag_type,
            MachineTag.asset_id.is_not(None),
        ).scalar() or 0

        keyword_count = db.query(func.count(Keyword.id)).filter(
            Keyword.tenant_id == tenant_id
        ).scalar() or 0

        category_count = db.query(func.count(KeywordCategory.id)).filter(
            KeywordCategory.tenant_id == tenant_id
        ).scalar() or 0

        list_count = db.query(func.count(PhotoList.id)).filter(
            PhotoList.tenant_id == tenant_id
        ).scalar() or 0

        rating_by_category = {}
        if include_ratings:
            categories = db.query(KeywordCategory.id, KeywordCategory.name).filter(
                KeywordCategory.tenant_id == tenant_id
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
                    Keyword.tenant_id == tenant_id
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
                    func.count(distinct(Permatag.asset_id))
                ).filter(
                    Permatag.tenant_id == tenant_id,
                    Permatag.asset_id.is_not(None),
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
                    func.count(distinct(Permatag.asset_id))
                ).join(
                    ImageMetadata, ImageMetadata.asset_id == Permatag.asset_id
                ).filter(
                    Permatag.tenant_id == tenant_id,
                    ImageMetadata.tenant_id == tenant_id,
                    Permatag.asset_id.is_not(None),
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
                    func.count(distinct(Permatag.asset_id))
                ).join(
                    Keyword, Keyword.id == Permatag.keyword_id
                ).join(
                    ImageMetadata, ImageMetadata.asset_id == Permatag.asset_id
                ).filter(
                    Permatag.tenant_id == tenant_id,
                    ImageMetadata.tenant_id == tenant_id,
                    Permatag.asset_id.is_not(None),
                    Permatag.signum == 1,
                    Keyword.category_id.in_(category_ids),
                    Keyword.tenant_id == tenant_id,
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
            "tenant_id": tenant_id,
            "image_count": image_count,
            "reviewed_image_count": reviewed_image_count,
            "asset_newest": asset_newest.isoformat() if asset_newest else None,
            "image_newest": image_newest.isoformat() if image_newest else None,
            "positive_permatag_image_count": positive_permatag_image_count,
            "positive_permatag_count": positive_permatag_count,
            "positive_permatag_oldest": positive_permatag_oldest.isoformat() if positive_permatag_oldest else None,
            "positive_permatag_newest": positive_permatag_newest.isoformat() if positive_permatag_newest else None,
            "untagged_positive_count": int(max(image_count - positive_permatag_image_count, 0)),
            "ml_tag_count": int(ml_tag_count),
            "list_count": int(list_count),
            "category_count": int(category_count),
            "keyword_count": int(keyword_count),
            "rated_image_count": rated_image_count,
            "rating_counts": rating_counts,
            "photo_age_bins": photo_age_bins,
            "rating_by_category": rating_by_category
        }
    finally:
        db.close()


@router.get("/images/stats", response_model=dict, operation_id="get_image_stats")
async def get_image_stats(
    tenant: Tenant = Depends(get_tenant),
    include_ratings: bool = False
):
    """Return image summary stats for a tenant."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None, _compute_image_stats, tenant.id, include_ratings
    )
