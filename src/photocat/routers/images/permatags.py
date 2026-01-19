"""Permatag endpoints: get, add, delete, accept-all, freeze."""

from datetime import datetime
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Body, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from photocat.dependencies import get_db, get_tenant, get_tenant_setting
from photocat.tenant import Tenant
from photocat.metadata import ImageMetadata, MachineTag, Permatag
from photocat.tagging import calculate_tags
from photocat.config.db_config import ConfigManager

# Sub-router with no prefix/tags (inherits from parent)
router = APIRouter()


@router.get("/images/{image_id}/permatags", response_model=dict, operation_id="get_permatags")
async def get_permatags(
    image_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Get all permatags for an image."""
    image = db.query(ImageMetadata).filter_by(
        id=image_id,
        tenant_id=tenant.id
    ).first()

    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    permatags = db.query(Permatag).filter(
        Permatag.image_id == image_id,
        Permatag.tenant_id == tenant.id
    ).all()

    return {
        "image_id": image_id,
        "permatags": [
            {
                "id": p.id,
                "keyword": p.keyword,
                "category": p.category,
                "signum": p.signum,
                "created_at": p.created_at.isoformat(),
                "created_by": p.created_by
            }
            for p in permatags
        ]
    }


@router.post("/images/{image_id}/permatags", response_model=dict, operation_id="add_permatag")
async def add_permatag(
    image_id: int,
    request: Request,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Add or update a permatag for an image."""
    body = await request.json()
    keyword = body.get("keyword")
    category = body.get("category")
    signum = body.get("signum", 1)

    if not keyword:
        raise HTTPException(status_code=400, detail="keyword is required")

    if signum not in [-1, 1]:
        raise HTTPException(status_code=400, detail="signum must be -1 or 1")

    image = db.query(ImageMetadata).filter_by(
        id=image_id,
        tenant_id=tenant.id
    ).first()

    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    # Check if permatag already exists (update or insert)
    existing = db.query(Permatag).filter(
        Permatag.image_id == image_id,
        Permatag.tenant_id == tenant.id,
        Permatag.keyword == keyword
    ).first()

    if existing:
        # Update existing permatag
        existing.category = category
        existing.signum = signum
        existing.created_at = datetime.utcnow()
        permatag = existing
    else:
        # Create new permatag
        permatag = Permatag(
            image_id=image_id,
            tenant_id=tenant.id,
            keyword=keyword,
            category=category,
            signum=signum,
            created_by=None  # Could be set from auth header if available
        )
        db.add(permatag)

    db.commit()
    db.refresh(permatag)

    return {
        "id": permatag.id,
        "keyword": permatag.keyword,
        "category": permatag.category,
        "signum": permatag.signum,
        "created_at": permatag.created_at.isoformat()
    }


@router.post("/images/permatags/bulk", response_model=dict, operation_id="bulk_permatags")
async def bulk_permatags(
    payload: dict = Body(...),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Bulk add/update permatags for multiple images."""
    operations = payload.get("operations") if isinstance(payload, dict) else None
    if not isinstance(operations, list) or not operations:
        raise HTTPException(status_code=400, detail="operations must be a non-empty list")

    image_ids = set()
    keywords = set()
    normalized_ops = []
    errors = []

    for index, op in enumerate(operations):
        if not isinstance(op, dict):
            errors.append({"index": index, "error": "operation must be an object"})
            continue
        image_id = op.get("image_id")
        keyword = op.get("keyword")
        category = op.get("category")
        signum = op.get("signum", 1)

        if not image_id or not keyword:
            errors.append({"index": index, "error": "image_id and keyword are required"})
            continue
        if signum not in (-1, 1):
            errors.append({"index": index, "error": "signum must be -1 or 1"})
            continue

        normalized_ops.append({
            "image_id": int(image_id),
            "keyword": keyword,
            "category": category,
            "signum": signum,
        })
        image_ids.add(int(image_id))
        keywords.add(keyword)

    if not normalized_ops:
        raise HTTPException(status_code=400, detail="no valid operations provided")

    valid_image_ids = {
        row[0] for row in db.query(ImageMetadata.id)
        .filter(
            ImageMetadata.tenant_id == tenant.id,
            ImageMetadata.id.in_(image_ids)
        ).all()
    }

    existing_rows = db.query(Permatag).filter(
        Permatag.tenant_id == tenant.id,
        Permatag.image_id.in_(image_ids),
        Permatag.keyword.in_(keywords)
    ).all()
    existing_map = {(row.image_id, row.keyword): row for row in existing_rows}

    created = 0
    updated = 0
    skipped = 0
    now = datetime.utcnow()

    for op in normalized_ops:
        image_id = op["image_id"]
        if image_id not in valid_image_ids:
            errors.append({"image_id": image_id, "keyword": op["keyword"], "error": "image not found"})
            skipped += 1
            continue
        key = (image_id, op["keyword"])
        existing = existing_map.get(key)
        if existing:
            existing.category = op["category"]
            existing.signum = op["signum"]
            existing.created_at = now
            updated += 1
        else:
            permatag = Permatag(
                image_id=image_id,
                tenant_id=tenant.id,
                keyword=op["keyword"],
                category=op["category"],
                signum=op["signum"],
                created_by=None
            )
            db.add(permatag)
            created += 1

    db.commit()

    return {
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "errors": errors
    }


@router.delete("/images/{image_id}/permatags/{permatag_id}", response_model=dict, operation_id="delete_permatag")
async def delete_permatag(
    image_id: int,
    permatag_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Delete a permatag."""
    permatag = db.query(Permatag).filter(
        Permatag.id == permatag_id,
        Permatag.image_id == image_id,
        Permatag.tenant_id == tenant.id
    ).first()

    if not permatag:
        raise HTTPException(status_code=404, detail="Permatag not found")

    db.delete(permatag)
    db.commit()

    return {"success": True}


@router.post("/images/{image_id}/permatags/accept-all", response_model=dict, operation_id="accept_all_tags")
async def accept_all_tags(
    image_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Accept all current tags as positive permatags and create negative permatags for all other keywords."""
    image = db.query(ImageMetadata).filter_by(
        id=image_id,
        tenant_id=tenant.id
    ).first()

    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    # Get current machine tags
    active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')
    current_tags = db.query(MachineTag).filter(
        MachineTag.image_id == image_id,
        MachineTag.tenant_id == tenant.id,
        MachineTag.tag_type == active_tag_type
    ).all()

    # Get all keywords from config
    config_manager = ConfigManager(db, tenant.id)
    all_keywords = config_manager.get_all_keywords()

    # Build set of current tag keywords
    current_keywords = {tag.keyword for tag in current_tags}
    all_keyword_names = {kw['keyword'] for kw in all_keywords}

    # Delete existing permatags ONLY for keywords in the controlled vocabulary
    # This preserves manually added permatags for keywords not in the vocabulary
    db.query(Permatag).filter(
        Permatag.image_id == image_id,
        Permatag.tenant_id == tenant.id,
        Permatag.keyword.in_(all_keyword_names)
    ).delete(synchronize_session=False)

    # Create positive permatags for all current tags
    for tag in current_tags:
        permatag = Permatag(
            image_id=image_id,
            tenant_id=tenant.id,
            keyword=tag.keyword,
            category=tag.category,
            signum=1
        )
        db.add(permatag)

    # Create negative permatags for all keywords NOT in current tags
    for kw_info in all_keywords:
        keyword = kw_info['keyword']
        if keyword not in current_keywords:
            permatag = Permatag(
                image_id=image_id,
                tenant_id=tenant.id,
                keyword=keyword,
                category=kw_info['category'],
                signum=-1
            )
            db.add(permatag)

    db.commit()

    # Return counts
    positive_count = len(current_keywords)
    negative_count = len(all_keyword_names - current_keywords)

    return {
        "success": True,
        "positive_permatags": positive_count,
        "negative_permatags": negative_count
    }


@router.post("/images/{image_id}/permatags/freeze", response_model=dict, operation_id="freeze_permatags")
async def freeze_permatags(
    image_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Create permatags for all keywords without existing permatags."""
    image = db.query(ImageMetadata).filter_by(
        id=image_id,
        tenant_id=tenant.id
    ).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    config_manager = ConfigManager(db, tenant.id)
    all_keywords = config_manager.get_all_keywords()
    keyword_to_category = {kw['keyword']: kw['category'] for kw in all_keywords}
    all_keyword_names = set(keyword_to_category.keys())

    active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')
    machine_tags = db.query(MachineTag).filter(
        MachineTag.image_id == image_id,
        MachineTag.tenant_id == tenant.id,
        MachineTag.tag_type == active_tag_type
    ).all()
    machine_tag_names = {tag.keyword for tag in machine_tags}

    existing_permatags = db.query(Permatag).filter(
        Permatag.image_id == image_id,
        Permatag.tenant_id == tenant.id,
        Permatag.keyword.in_(all_keyword_names)
    ).all()
    existing_keywords = {p.keyword for p in existing_permatags}

    positive_count = 0
    negative_count = 0
    for keyword in all_keyword_names:
        if keyword in existing_keywords:
            continue
        signum = 1 if keyword in machine_tag_names else -1
        permatag = Permatag(
            image_id=image_id,
            tenant_id=tenant.id,
            keyword=keyword,
            category=keyword_to_category.get(keyword),
            signum=signum,
            created_by=None
        )
        db.add(permatag)
        if signum == 1:
            positive_count += 1
        else:
            negative_count += 1

    db.commit()

    return {
        "success": True,
        "positive_permatags": positive_count,
        "negative_permatags": negative_count
    }
