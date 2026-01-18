"""Router for photo list operations."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session

from photocat.dependencies import get_db, get_tenant, get_tenant_setting
from photocat.tenant import Tenant
from photocat.models.config import PhotoList, PhotoListItem
from photocat.metadata import ImageMetadata, MachineTag, Permatag
from photocat.tagging import calculate_tags
from photocat.models.requests import AddPhotoRequest
from photocat.settings import settings

router = APIRouter(
    prefix="/api/v1/lists",
    tags=["lists"]
)


def get_active_list(db: Session, tenant_id: str):
    """Get the active list for a tenant."""
    return db.query(PhotoList).filter_by(tenant_id=tenant_id, is_active=True).first()


@router.get("/active", response_model=dict)
async def get_active_list_api(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Get the current active list for the tenant (if any)."""
    active = get_active_list(db, tenant.id)
    if not active:
        return {}
    return {
        "id": active.id,
        "title": active.title,
        "notebox": active.notebox,
        "is_active": active.is_active,
        "created_at": active.created_at,
        "updated_at": active.updated_at
    }


@router.get("/{list_id:int}", response_model=dict)
async def get_list(
    list_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Get a single list by ID for the tenant."""
    lst = db.query(PhotoList).filter_by(id=list_id, tenant_id=tenant.id).first()
    if not lst:
        raise HTTPException(status_code=404, detail="List not found")
    return {
        "id": lst.id,
        "title": lst.title,
        "notebox": lst.notebox,
        "is_active": lst.is_active,
        "created_at": lst.created_at,
        "updated_at": lst.updated_at,
        "item_count": len(lst.items)
    }


@router.delete("/items/{item_id}", response_model=dict)
async def delete_list_item(
    item_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Remove a photo from a list by PhotoListItem ID (must belong to tenant)."""
    item = db.query(PhotoListItem).join(PhotoList, PhotoListItem.list_id == PhotoList.id).filter(PhotoListItem.id == item_id, PhotoList.tenant_id == tenant.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="List item not found")
    db.delete(item)
    db.commit()
    return {"deleted": True, "item_id": item_id}


@router.post("", response_model=dict)
async def create_list(
    title: str = Body(...),
    notebox: Optional[str] = Body(None),
    is_active: bool = Body(False),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Create a new list (inactive by default unless is_active=True)."""
    if is_active:
        # Deactivate any existing active list
        db.query(PhotoList).filter_by(tenant_id=tenant.id, is_active=True).update({"is_active": False})
    new_list = PhotoList(
        tenant_id=tenant.id,
        title=title,
        notebox=notebox,
        is_active=is_active
    )
    db.add(new_list)
    db.commit()
    db.refresh(new_list)
    return {"id": new_list.id, "title": new_list.title, "is_active": new_list.is_active}


@router.get("", response_model=list)
async def list_lists(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """List all lists for the tenant."""
    lists = db.query(PhotoList).filter_by(tenant_id=tenant.id).order_by(PhotoList.created_at.asc()).all()
    return [
        {
            "id": l.id,
            "title": l.title,
            "notebox": l.notebox,
            "is_active": l.is_active,
            "created_at": l.created_at,
            "updated_at": l.updated_at,
            "item_count": len(l.items)
        } for l in lists
    ]


@router.patch("/{list_id:int}", response_model=dict)
async def edit_list(
    list_id: int,
    title: Optional[str] = Body(None),
    notebox: Optional[str] = Body(None),
    is_active: Optional[bool] = Body(None),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Edit a list (title, notebox, and/or active status)."""
    lst = db.query(PhotoList).filter_by(id=list_id, tenant_id=tenant.id).first()
    if not lst:
        raise HTTPException(status_code=404, detail="List not found")
    if title is not None:
        lst.title = title
    if notebox is not None:
        lst.notebox = notebox
    if is_active is not None:
        if is_active:
            db.query(PhotoList).filter_by(tenant_id=tenant.id, is_active=True).update({"is_active": False})
        lst.is_active = is_active
    db.commit()
    db.refresh(lst)
    return {
        "id": lst.id,
        "title": lst.title,
        "notebox": lst.notebox,
        "is_active": lst.is_active,
        "created_at": lst.created_at,
        "updated_at": lst.updated_at,
        "item_count": len(lst.items)
    }


@router.delete("/{list_id:int}", response_model=dict)
async def delete_list(
    list_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Delete a list and its items. If active, leaves tenant with no active list."""
    lst = db.query(PhotoList).filter_by(id=list_id, tenant_id=tenant.id).first()
    if not lst:
        raise HTTPException(status_code=404, detail="List not found")
    was_active = lst.is_active
    db.delete(lst)
    db.commit()
    return {"deleted": True, "was_active": was_active}


@router.get("/{list_id:int}/items", response_model=list)
async def get_list_items(
    list_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Get all items in a list, ordered by added_at ascending."""
    lst = db.query(PhotoList).filter_by(id=list_id, tenant_id=tenant.id).first()
    if not lst:
        raise HTTPException(status_code=404, detail="List not found")
    items = (
        db.query(PhotoListItem, ImageMetadata)
        .join(ImageMetadata, PhotoListItem.photo_id == ImageMetadata.id)
        .filter(
            PhotoListItem.list_id == list_id,
            ImageMetadata.tenant_id == tenant.id
        )
        .order_by(PhotoListItem.added_at.asc())
        .all()
    )
    image_ids = [img.id for _, img in items]
    active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')
    tags = db.query(MachineTag).filter(
        MachineTag.image_id.in_(image_ids),
        MachineTag.tenant_id == tenant.id,
        MachineTag.tag_type == active_tag_type
    ).all()
    permatags = db.query(Permatag).filter(
        Permatag.image_id.in_(image_ids),
        Permatag.tenant_id == tenant.id
    ).all()
    tags_by_image = {}
    for tag in tags:
        tags_by_image.setdefault(tag.image_id, []).append({
            "keyword": tag.keyword,
            "category": tag.category,
            "confidence": round(tag.confidence, 2)
        })
    permatags_by_image = {}
    for permatag in permatags:
        permatags_by_image.setdefault(permatag.image_id, []).append({
            "id": permatag.id,
            "keyword": permatag.keyword,
            "category": permatag.category,
            "signum": permatag.signum
        })
    response_items = []
    for item, img in items:
        machine_tags = sorted(tags_by_image.get(img.id, []), key=lambda x: x['confidence'], reverse=True)
        image_permatags = permatags_by_image.get(img.id, [])
        calculated_tags = calculate_tags(machine_tags, image_permatags)
        response_items.append({
            "id": item.id,
            "photo_id": item.photo_id,
            "added_at": item.added_at,
            "image": {
                "id": img.id,
                "filename": img.filename,
                "width": img.width,
                "height": img.height,
                "format": img.format,
                "file_size": img.file_size,
                "dropbox_path": img.dropbox_path,
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
                "thumbnail_path": img.thumbnail_path,
                "thumbnail_url": tenant.get_thumbnail_url(settings, img.thumbnail_path),
                "tags_applied": img.tags_applied,
                "faces_detected": img.faces_detected,
                "rating": img.rating,
                "tags": machine_tags,
                "permatags": image_permatags,
                "calculated_tags": calculated_tags
            }
        })
    return response_items


@router.post("/add-photo", response_model=dict)
async def add_photo_to_list(
    req: AddPhotoRequest,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Add a photo to the current active list. If no active list, create one and add the photo."""
    photo_id = req.photo_id
    active = get_active_list(db, tenant.id)
    if not active:
        # Auto-create new active list
        active = PhotoList(
            tenant_id=tenant.id,
            title="Untitled List",
            is_active=True
        )
        db.add(active)
        db.commit()
        db.refresh(active)
    # Prevent duplicate items in the list
    existing_item = db.query(PhotoListItem).filter_by(list_id=active.id, photo_id=photo_id).first()
    if existing_item:
        # Silent no-op if already present
        return {"list_id": active.id, "item_id": existing_item.id, "added_at": existing_item.added_at}
    item = PhotoListItem(list_id=active.id, photo_id=photo_id)
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"list_id": active.id, "item_id": item.id, "added_at": item.added_at}
