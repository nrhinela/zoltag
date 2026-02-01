"""Router for photo list operations."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy import func
from sqlalchemy.orm import Session

from photocat.dependencies import get_db, get_tenant, get_tenant_setting
from photocat.tenant import Tenant
from photocat.models.config import PhotoList, PhotoListItem, Keyword, KeywordCategory
from photocat.metadata import ImageMetadata, MachineTag, Permatag
from photocat.tagging import calculate_tags
from photocat.models.requests import AddPhotoRequest
from photocat.settings import settings
from photocat.auth.dependencies import get_current_user
from photocat.auth.models import UserProfile

router = APIRouter(
    prefix="/api/v1/lists",
    tags=["lists"]
)


def get_most_recent_list(db: Session, tenant_id: str):
    """Get the most recently created list for a tenant."""
    return db.query(PhotoList).filter_by(tenant_id=tenant_id).order_by(PhotoList.created_at.desc()).first()


@router.get("/recent", response_model=dict)
async def get_recent_list(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Get the most recently created list for the tenant (if any)."""
    recent = get_most_recent_list(db, tenant.id)
    if not recent:
        return {}
    return {
        "id": recent.id,
        "title": recent.title,
        "notebox": recent.notebox,
        "created_at": recent.created_at,
        "updated_at": recent.updated_at,
        "created_by_uid": recent.created_by_uid
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
    item_count = db.query(func.count(PhotoListItem.id)).filter(
        PhotoListItem.list_id == lst.id
    ).scalar() or 0
    return {
        "id": lst.id,
        "title": lst.title,
        "notebox": lst.notebox,
        "created_at": lst.created_at,
        "updated_at": lst.updated_at,
        "created_by_uid": lst.created_by_uid,
        "item_count": item_count
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
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user)
):
    """Create a new list."""
    new_list = PhotoList(
        tenant_id=tenant.id,
        title=title,
        notebox=notebox,
        created_by_uid=current_user.supabase_uid if current_user else None
    )
    db.add(new_list)
    db.commit()
    db.refresh(new_list)
    return {"id": new_list.id, "title": new_list.title}


@router.get("", response_model=list)
async def list_lists(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """List all lists for the tenant."""
    lists = db.query(PhotoList).filter_by(tenant_id=tenant.id).order_by(PhotoList.created_at.asc()).all()
    counts = dict(
        db.query(PhotoListItem.list_id, func.count(PhotoListItem.id))
        .join(PhotoList, PhotoListItem.list_id == PhotoList.id)
        .filter(PhotoList.tenant_id == tenant.id)
        .group_by(PhotoListItem.list_id)
        .all()
    )
    # Build a map of user UUIDs to display names
    user_names = {}
    if lists:
        uids = [l.created_by_uid for l in lists if l.created_by_uid]
        if uids:
            users = db.query(UserProfile.supabase_uid, UserProfile.display_name).filter(
                UserProfile.supabase_uid.in_(uids)
            ).all()
            user_names = {u[0]: u[1] for u in users}

    return [
        {
            "id": l.id,
            "title": l.title,
            "notebox": l.notebox,
            "created_at": l.created_at,
            "updated_at": l.updated_at,
            "created_by_uid": l.created_by_uid,
            "created_by_name": user_names.get(l.created_by_uid) if l.created_by_uid else None,
            "item_count": counts.get(l.id, 0)
        } for l in lists
    ]


@router.patch("/{list_id:int}", response_model=dict)
async def edit_list(
    list_id: int,
    title: Optional[str] = Body(None),
    notebox: Optional[str] = Body(None),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Edit a list (title and/or notebox)."""
    lst = db.query(PhotoList).filter_by(id=list_id, tenant_id=tenant.id).first()
    if not lst:
        raise HTTPException(status_code=404, detail="List not found")
    if title is not None:
        lst.title = title
    if notebox is not None:
        lst.notebox = notebox
    db.commit()
    db.refresh(lst)

    # Get creator display name
    created_by_name = None
    if lst.created_by_uid:
        user = db.query(UserProfile.display_name).filter(
            UserProfile.supabase_uid == lst.created_by_uid
        ).first()
        created_by_name = user[0] if user else None

    return {
        "id": lst.id,
        "title": lst.title,
        "notebox": lst.notebox,
        "created_at": lst.created_at,
        "updated_at": lst.updated_at,
        "created_by_uid": lst.created_by_uid,
        "created_by_name": created_by_name,
        "item_count": len(lst.items)
    }


@router.delete("/{list_id:int}", response_model=dict)
async def delete_list(
    list_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Delete a list and its items."""
    lst = db.query(PhotoList).filter_by(id=list_id, tenant_id=tenant.id).first()
    if not lst:
        raise HTTPException(status_code=404, detail="List not found")
    db.delete(lst)
    db.commit()
    return {"deleted": True}


@router.get("/{list_id:int}/items", response_model=list)
async def get_list_items(
    list_id: int,
    ids_only: bool = False,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Get all items in a list, ordered by added_at ascending."""
    lst = db.query(PhotoList).filter_by(id=list_id, tenant_id=tenant.id).first()
    if not lst:
        raise HTTPException(status_code=404, detail="List not found")
    if ids_only:
        items = (
            db.query(PhotoListItem.id, PhotoListItem.photo_id, PhotoListItem.added_at)
            .join(PhotoList, PhotoListItem.list_id == PhotoList.id)
            .filter(PhotoListItem.list_id == list_id, PhotoList.tenant_id == tenant.id)
            .order_by(PhotoListItem.added_at.asc())
            .all()
        )
        return [
            {"id": item_id, "photo_id": photo_id, "added_at": added_at}
            for item_id, photo_id, added_at in items
        ]
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
        Permatag.image_id.in_(image_ids)
    ).all()

    # Load all keywords
    keyword_ids = set()
    for tag in tags:
        keyword_ids.add(tag.keyword_id)
    for permatag in permatags:
        keyword_ids.add(permatag.keyword_id)

    # Build keyword lookup map
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

    tags_by_image = {}
    for tag in tags:
        kw_info = keywords_map.get(tag.keyword_id, {"keyword": "unknown", "category": "unknown"})
        tags_by_image.setdefault(tag.image_id, []).append({
            "keyword": kw_info["keyword"],
            "category": kw_info["category"],
            "confidence": round(tag.confidence, 2)
        })
    permatags_by_image = {}
    for permatag in permatags:
        kw_info = keywords_map.get(permatag.keyword_id, {"keyword": "unknown", "category": "unknown"})
        permatags_by_image.setdefault(permatag.image_id, []).append({
            "id": permatag.id,
            "keyword": kw_info["keyword"],
            "category": kw_info["category"],
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


@router.post("/{list_id:int}/add-photo", response_model=dict)
async def add_photo_to_specific_list(
    list_id: int,
    req: AddPhotoRequest,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Add a photo to a specific list."""
    photo_id = req.photo_id

    # Verify list belongs to tenant
    lst = db.query(PhotoList).filter_by(id=list_id, tenant_id=tenant.id).first()
    if not lst:
        raise HTTPException(status_code=404, detail="List not found")

    # Prevent duplicate items in the list
    existing_item = db.query(PhotoListItem).filter_by(list_id=list_id, photo_id=photo_id).first()
    if existing_item:
        # Silent no-op if already present
        return {"list_id": list_id, "item_id": existing_item.id, "added_at": existing_item.added_at}

    item = PhotoListItem(list_id=list_id, photo_id=photo_id)
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"list_id": list_id, "item_id": item.id, "added_at": item.added_at}


@router.post("/add-photo", response_model=dict)
async def add_photo_to_list(
    req: AddPhotoRequest,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Add a photo to the most recently created list. If no lists exist, create one and add the photo."""
    photo_id = req.photo_id
    recent = get_most_recent_list(db, tenant.id)
    if not recent:
        # Auto-create new list
        recent = PhotoList(
            tenant_id=tenant.id,
            title="Untitled List"
        )
        db.add(recent)
        db.commit()
        db.refresh(recent)
    # Prevent duplicate items in the list
    existing_item = db.query(PhotoListItem).filter_by(list_id=recent.id, photo_id=photo_id).first()
    if existing_item:
        # Silent no-op if already present
        return {"list_id": recent.id, "item_id": existing_item.id, "added_at": existing_item.added_at}
    item = PhotoListItem(list_id=recent.id, photo_id=photo_id)
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"list_id": recent.id, "item_id": item.id, "added_at": item.added_at}
