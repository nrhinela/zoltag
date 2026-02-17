"""Keyword score threshold management endpoints."""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session

from zoltag.auth.dependencies import require_tenant_role_from_header
from zoltag.auth.models import UserProfile
from zoltag.dependencies import get_db, get_tenant
from zoltag.metadata import KeywordThreshold
from zoltag.models.config import Keyword, KeywordCategory
from zoltag.tenant import Tenant
from zoltag.tenant_scope import tenant_column_filter

router = APIRouter(
    prefix="/api/v1/admin/keyword-thresholds",
    tags=["keyword-thresholds"],
)


@router.get("", response_model=dict, operation_id="list_keyword_thresholds")
async def list_keyword_thresholds(
    tag_type: Optional[str] = None,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(require_tenant_role_from_header("admin")),
):
    """List all keyword thresholds for the tenant, joined with keyword/category info."""
    # Load keywords with category names
    kw_query = db.query(
        Keyword.id,
        Keyword.keyword,
        KeywordCategory.name.label("category"),
    ).join(
        KeywordCategory, Keyword.category_id == KeywordCategory.id
    ).filter(
        tenant_column_filter(Keyword, tenant),
    ).order_by(KeywordCategory.name, Keyword.keyword)
    keywords = kw_query.all()
    keyword_ids = [kw.id for kw in keywords]
    keyword_map = {kw.id: {"keyword": kw.keyword, "category": kw.category} for kw in keywords}

    # Load thresholds
    tq = db.query(KeywordThreshold).filter(
        KeywordThreshold.tenant_id == tenant.id,
        KeywordThreshold.keyword_id.in_(keyword_ids),
    )
    if tag_type:
        tq = tq.filter(KeywordThreshold.tag_type == tag_type)
    threshold_rows = tq.all()

    threshold_map = {}
    for row in threshold_rows:
        threshold_map[(row.keyword_id, row.tag_type)] = row

    results = []
    for kw in keywords:
        # Return one entry per (keyword, tag_type) that has a threshold, plus
        # bare keyword entries for keywords with no threshold yet
        matched = [v for (kid, tt), v in threshold_map.items() if kid == kw.id]
        if matched:
            for row in matched:
                results.append(_serialize(row, keyword_map))
        else:
            results.append({
                "keyword_id": kw.id,
                "keyword": kw.keyword,
                "category": kw.category,
                "tag_type": tag_type or None,
                "threshold_calc": None,
                "threshold_manual": None,
                "effective_threshold": None,
                "calc_method": None,
                "calc_sample_n": None,
                "updated_at": None,
            })

    return {"thresholds": results, "total": len(results)}


@router.patch("/{keyword_id}/{tag_type}", response_model=dict, operation_id="set_keyword_threshold_manual")
async def set_keyword_threshold_manual(
    keyword_id: int,
    tag_type: str,
    threshold_manual: Optional[float] = Body(default=None, embed=True),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(require_tenant_role_from_header("admin")),
):
    """Set or clear the manual threshold override for a keyword+tag_type."""
    # Verify keyword belongs to tenant
    kw = db.query(Keyword).filter(
        Keyword.id == keyword_id,
        tenant_column_filter(Keyword, tenant),
    ).first()
    if not kw:
        raise HTTPException(status_code=404, detail="Keyword not found")

    row = db.query(KeywordThreshold).filter(
        KeywordThreshold.keyword_id == keyword_id,
        KeywordThreshold.tag_type == tag_type,
    ).first()

    if row:
        row.threshold_manual = threshold_manual
        row.updated_at = datetime.utcnow()
    else:
        row = KeywordThreshold(
            tenant_id=tenant.id,
            keyword_id=keyword_id,
            tag_type=tag_type,
            threshold_manual=threshold_manual,
            updated_at=datetime.utcnow(),
        )
        db.add(row)

    db.commit()
    db.refresh(row)

    kw_info = {"keyword": kw.keyword, "category": None}
    cat = db.query(KeywordCategory.name).filter(KeywordCategory.id == kw.category_id).scalar()
    kw_info["category"] = cat
    return _serialize(row, {keyword_id: kw_info})


def _serialize(row: KeywordThreshold, keyword_map: dict) -> dict:
    kw_info = keyword_map.get(row.keyword_id, {})
    effective = (
        row.threshold_manual
        if row.threshold_manual is not None
        else row.threshold_calc
    )
    return {
        "keyword_id": row.keyword_id,
        "keyword": kw_info.get("keyword"),
        "category": kw_info.get("category"),
        "tag_type": row.tag_type,
        "threshold_calc": row.threshold_calc,
        "threshold_manual": row.threshold_manual,
        "effective_threshold": effective,
        "calc_method": row.calc_method,
        "calc_sample_n": row.calc_sample_n,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }
