"""Permatag endpoints: get, add, delete, accept-all, freeze."""

from datetime import datetime
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Body, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from photocat.dependencies import get_db, get_tenant, get_tenant_setting
from photocat.tenant import Tenant
from photocat.metadata import ImageMetadata, MachineTag, Permatag
from photocat.models.config import Keyword, KeywordCategory
from photocat.tagging import calculate_tags
from photocat.config.db_config import ConfigManager

# Sub-router with no prefix/tags (inherits from parent)
router = APIRouter()


def get_keyword_info(db: Session, keyword_id: int) -> dict:
    """Get keyword name and category by keyword_id."""
    result = db.query(
        Keyword.keyword,
        KeywordCategory.name
    ).join(
        KeywordCategory, Keyword.category_id == KeywordCategory.id
    ).filter(
        Keyword.id == keyword_id
    ).first()
    if result:
        return {"keyword": result[0], "category": result[1]}
    return {"keyword": "unknown", "category": "unknown"}


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
        Permatag.image_id == image_id
    ).all()

    # Load keyword info in bulk
    keyword_ids = {p.keyword_id for p in permatags}
    keywords_map = {}
    if keyword_ids:
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

    return {
        "image_id": image_id,
        "permatags": [
            {
                "id": p.id,
                "keyword": keywords_map.get(p.keyword_id, {}).get("keyword", "unknown"),
                "category": keywords_map.get(p.keyword_id, {}).get("category", "unknown"),
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
    keyword_name = body.get("keyword")
    signum = body.get("signum", 1)

    if not keyword_name:
        raise HTTPException(status_code=400, detail="keyword is required")

    if signum not in [-1, 1]:
        raise HTTPException(status_code=400, detail="signum must be -1 or 1")

    image = db.query(ImageMetadata).filter_by(
        id=image_id,
        tenant_id=tenant.id
    ).first()

    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    # Look up keyword by name
    keyword = db.query(Keyword).filter(
        Keyword.keyword == keyword_name,
        Keyword.tenant_id == tenant.id
    ).first()

    if not keyword:
        raise HTTPException(status_code=404, detail=f"Keyword '{keyword_name}' not found in tenant config")

    # Check if permatag already exists (update or insert)
    existing = db.query(Permatag).filter(
        Permatag.image_id == image_id,
        Permatag.keyword_id == keyword.id
    ).first()

    if existing:
        # Update existing permatag
        existing.signum = signum
        existing.created_at = datetime.utcnow()
        permatag = existing
    else:
        # Create new permatag
        permatag = Permatag(
            image_id=image_id,
            keyword_id=keyword.id,
            signum=signum,
            created_by=None  # Could be set from auth header if available
        )
        db.add(permatag)

    db.commit()
    db.refresh(permatag)

    # Get keyword info for response
    kw_info = get_keyword_info(db, permatag.keyword_id)

    return {
        "id": permatag.id,
        "keyword": kw_info["keyword"],
        "category": kw_info["category"],
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
    keyword_names = set()
    normalized_ops = []
    errors = []

    for index, op in enumerate(operations):
        if not isinstance(op, dict):
            errors.append({"index": index, "error": "operation must be an object"})
            continue
        image_id = op.get("image_id")
        keyword_name = op.get("keyword")
        signum = op.get("signum", 1)

        if not image_id or not keyword_name:
            errors.append({"index": index, "error": "image_id and keyword are required"})
            continue
        if signum not in (-1, 1):
            errors.append({"index": index, "error": "signum must be -1 or 1"})
            continue

        normalized_ops.append({
            "image_id": int(image_id),
            "keyword_name": keyword_name,
            "signum": signum,
        })
        image_ids.add(int(image_id))
        keyword_names.add(keyword_name)

    if not normalized_ops:
        raise HTTPException(status_code=400, detail="no valid operations provided")

    valid_image_ids = {
        row[0] for row in db.query(ImageMetadata.id)
        .filter(
            ImageMetadata.tenant_id == tenant.id,
            ImageMetadata.id.in_(image_ids)
        ).all()
    }

    # Look up keyword IDs
    keywords = db.query(Keyword).filter(
        Keyword.keyword.in_(keyword_names),
        Keyword.tenant_id == tenant.id
    ).all()
    keyword_name_to_id = {kw.keyword: kw.id for kw in keywords}

    # Get existing permatags
    keyword_ids = list(keyword_name_to_id.values())
    existing_rows = db.query(Permatag).filter(
        Permatag.image_id.in_(image_ids),
        Permatag.keyword_id.in_(keyword_ids)
    ).all()
    existing_map = {(row.image_id, row.keyword_id): row for row in existing_rows}

    created = 0
    updated = 0
    skipped = 0
    now = datetime.utcnow()

    for op in normalized_ops:
        image_id = op["image_id"]
        keyword_name = op["keyword_name"]

        if image_id not in valid_image_ids:
            errors.append({"image_id": image_id, "keyword": keyword_name, "error": "image not found"})
            skipped += 1
            continue

        keyword_id = keyword_name_to_id.get(keyword_name)
        if not keyword_id:
            errors.append({"image_id": image_id, "keyword": keyword_name, "error": "keyword not found in tenant config"})
            skipped += 1
            continue

        key = (image_id, keyword_id)
        existing = existing_map.get(key)
        if existing:
            existing.signum = op["signum"]
            existing.created_at = now
            updated += 1
        else:
            permatag = Permatag(
                image_id=image_id,
                keyword_id=keyword_id,
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
    # Verify image belongs to tenant
    image = db.query(ImageMetadata).filter_by(
        id=image_id,
        tenant_id=tenant.id
    ).first()

    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    permatag = db.query(Permatag).filter(
        Permatag.id == permatag_id,
        Permatag.image_id == image_id
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

    # Build set of current tag keyword IDs
    current_keyword_ids = {tag.keyword_id for tag in current_tags}

    # Create map of keyword_id to keyword info
    all_keyword_ids = {kw['id']: kw for kw in all_keywords}

    # Delete existing permatags ONLY for keywords in the controlled vocabulary
    # This preserves manually added permatags for keywords not in the vocabulary
    db.query(Permatag).filter(
        Permatag.image_id == image_id,
        Permatag.keyword_id.in_(list(all_keyword_ids.keys()))
    ).delete(synchronize_session=False)

    # Create positive permatags for all current tags
    for tag in current_tags:
        permatag = Permatag(
            image_id=image_id,
            keyword_id=tag.keyword_id,
            signum=1
        )
        db.add(permatag)

    # Create negative permatags for all keywords NOT in current tags
    for keyword_id in all_keyword_ids.keys():
        if keyword_id not in current_keyword_ids:
            permatag = Permatag(
                image_id=image_id,
                keyword_id=keyword_id,
                signum=-1
            )
            db.add(permatag)

    db.commit()

    # Return counts
    positive_count = len(current_keyword_ids)
    negative_count = len(all_keyword_ids) - positive_count

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
    all_keyword_ids = {kw['id']: kw for kw in all_keywords}

    active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')
    machine_tags = db.query(MachineTag).filter(
        MachineTag.image_id == image_id,
        MachineTag.tenant_id == tenant.id,
        MachineTag.tag_type == active_tag_type
    ).all()
    machine_tag_ids = {tag.keyword_id for tag in machine_tags}

    existing_permatags = db.query(Permatag).filter(
        Permatag.image_id == image_id,
        Permatag.keyword_id.in_(list(all_keyword_ids.keys()))
    ).all()
    existing_keyword_ids = {p.keyword_id for p in existing_permatags}

    positive_count = 0
    negative_count = 0
    for keyword_id in all_keyword_ids.keys():
        if keyword_id in existing_keyword_ids:
            continue
        signum = 1 if keyword_id in machine_tag_ids else -1
        permatag = Permatag(
            image_id=image_id,
            keyword_id=keyword_id,
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
