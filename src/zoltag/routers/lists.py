"""Router for photo list operations."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Body, Query
from sqlalchemy import func, and_
from sqlalchemy.orm import Session

from zoltag.asset_helpers import AssetReadinessError, load_assets_for_images, resolve_image_storage
from zoltag.dependencies import get_db, get_tenant, get_tenant_setting
from zoltag.list_visibility import (
    can_edit_list,
    can_view_list,
    get_list_scope_clause,
    is_list_owner,
    is_tenant_admin_user,
    normalize_list_visibility,
    normalize_list_scope,
)
from zoltag.tenant import Tenant
from zoltag.models.config import PhotoList, PhotoListItem, Keyword, KeywordCategory
from zoltag.metadata import AssetDerivative, ImageMetadata, MachineTag, Permatag
from zoltag.tagging import calculate_tags
from zoltag.models.requests import AddPhotoRequest
from zoltag.settings import settings
from zoltag.auth.dependencies import get_current_user
from zoltag.auth.models import UserProfile
from zoltag.routers.images._shared import _build_source_url
from zoltag.tenant_scope import assign_tenant_scope, tenant_column_filter, tenant_column_filter_for_values

router = APIRouter(
    prefix="/api/v1/lists",
    tags=["lists"]
)


def _resolve_storage_or_409(*, image: ImageMetadata, tenant: Tenant, db: Session, assets_by_id=None):
    try:
        return resolve_image_storage(
            image=image,
            tenant=tenant,
            db=None if assets_by_id is not None else db,
            assets_by_id=assets_by_id,
            strict=settings.asset_strict_reads,
        )
    except AssetReadinessError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


def _tenant_filter(model, tenant: Tenant | str):
    if isinstance(tenant, Tenant):
        return tenant_column_filter(model, tenant)
    return tenant_column_filter_for_values(model, tenant, tenant)


def _list_permissions(*, list_row: PhotoList, current_user: UserProfile, is_tenant_admin: bool) -> dict:
    return {
        "visibility": normalize_list_visibility(getattr(list_row, "visibility", None)),
        "is_owner": is_list_owner(list_row, current_user),
        "can_edit": can_edit_list(list_row, user=current_user, is_tenant_admin=is_tenant_admin),
    }


def _serialize_list_row(
    *,
    list_row: PhotoList,
    created_by_name: str | None,
    item_count: int,
    current_user: UserProfile,
    is_tenant_admin: bool,
) -> dict:
    permissions = _list_permissions(
        list_row=list_row,
        current_user=current_user,
        is_tenant_admin=is_tenant_admin,
    )
    return {
        "id": list_row.id,
        "title": list_row.title,
        "notebox": list_row.notebox,
        "visibility": permissions["visibility"],
        "is_owner": permissions["is_owner"],
        "can_edit": permissions["can_edit"],
        "created_at": list_row.created_at,
        "updated_at": list_row.updated_at,
        "created_by_uid": list_row.created_by_uid,
        "created_by_name": created_by_name,
        "item_count": int(item_count or 0),
    }


def _query_lists_for_scope(
    *,
    db: Session,
    tenant: Tenant | str,
    current_user: UserProfile,
    scope: str = "default",
    is_tenant_admin: bool,
):
    query = db.query(PhotoList).filter(_tenant_filter(PhotoList, tenant))
    clause = get_list_scope_clause(user=current_user, scope=scope, is_tenant_admin=is_tenant_admin)
    if clause is not None:
        query = query.filter(clause)
    return query


def get_most_recent_list(
    db: Session,
    tenant: Tenant | str,
    *,
    current_user: UserProfile,
    is_tenant_admin: bool,
):
    """Get the most recently created accessible list for a tenant."""
    return (
        _query_lists_for_scope(
            db=db,
            tenant=tenant,
            current_user=current_user,
            scope="default",
            is_tenant_admin=is_tenant_admin,
        )
        .order_by(PhotoList.created_at.desc(), PhotoList.id.desc())
        .first()
    )


def _get_accessible_list_or_404(
    *,
    db: Session,
    tenant: Tenant,
    list_id: int,
    current_user: UserProfile,
    is_tenant_admin: bool,
) -> PhotoList:
    list_row = db.query(PhotoList).filter(
        PhotoList.id == list_id,
        tenant_column_filter(PhotoList, tenant),
    ).first()
    if not list_row:
        raise HTTPException(status_code=404, detail="List not found")
    if not can_view_list(list_row, user=current_user, is_tenant_admin=is_tenant_admin):
        raise HTTPException(status_code=404, detail="List not found")
    return list_row


@router.get("/recent", response_model=dict)
async def get_recent_list(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
):
    """Get the most recently created list for the tenant (if any)."""
    is_tenant_admin = is_tenant_admin_user(db, tenant, current_user)
    recent = get_most_recent_list(
        db,
        tenant,
        current_user=current_user,
        is_tenant_admin=is_tenant_admin,
    )
    if not recent:
        return {}
    created_by_name = None
    if recent.created_by_uid:
        user = db.query(UserProfile.display_name).filter(
            UserProfile.supabase_uid == recent.created_by_uid
        ).first()
        created_by_name = user[0] if user else None
    item_count = db.query(func.count(PhotoListItem.id)).filter(
        PhotoListItem.list_id == recent.id
    ).scalar() or 0
    return {
        **_serialize_list_row(
            list_row=recent,
            created_by_name=created_by_name,
            item_count=item_count,
            current_user=current_user,
            is_tenant_admin=is_tenant_admin,
        )
    }


@router.get("/{list_id:int}", response_model=dict)
async def get_list(
    list_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
):
    """Get a single list by ID for the tenant."""
    is_tenant_admin = is_tenant_admin_user(db, tenant, current_user)
    lst = _get_accessible_list_or_404(
        db=db,
        tenant=tenant,
        list_id=list_id,
        current_user=current_user,
        is_tenant_admin=is_tenant_admin,
    )
    item_count = db.query(func.count(PhotoListItem.id)).filter(
        PhotoListItem.list_id == lst.id
    ).scalar() or 0
    created_by_name = None
    if lst.created_by_uid:
        user = db.query(UserProfile.display_name).filter(
            UserProfile.supabase_uid == lst.created_by_uid
        ).first()
        created_by_name = user[0] if user else None
    return _serialize_list_row(
        list_row=lst,
        created_by_name=created_by_name,
        item_count=item_count,
        current_user=current_user,
        is_tenant_admin=is_tenant_admin,
    )


@router.delete("/items/{item_id}", response_model=dict)
async def delete_list_item(
    item_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
):
    """Remove a photo from a list by PhotoListItem ID (must belong to tenant)."""
    item_row = db.query(PhotoListItem, PhotoList).join(
        PhotoList, PhotoListItem.list_id == PhotoList.id
    ).filter(
        PhotoListItem.id == item_id,
        tenant_column_filter(PhotoList, tenant),
    ).first()
    if not item_row:
        raise HTTPException(status_code=404, detail="List item not found")
    item, list_row = item_row
    is_tenant_admin = is_tenant_admin_user(db, tenant, current_user)
    if not can_view_list(list_row, user=current_user, is_tenant_admin=is_tenant_admin):
        raise HTTPException(status_code=404, detail="List item not found")
    db.delete(item)
    db.commit()
    return {"deleted": True, "item_id": item_id}


@router.post("", response_model=dict)
async def create_list(
    title: str = Body(...),
    notebox: Optional[str] = Body(None),
    visibility: Optional[str] = Body("shared"),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user)
):
    """Create a new list."""
    new_list = assign_tenant_scope(PhotoList(
        title=title,
        notebox=notebox,
        visibility=normalize_list_visibility(visibility, default="shared"),
        created_by_uid=current_user.supabase_uid if current_user else None
    ), tenant)
    db.add(new_list)
    db.commit()
    db.refresh(new_list)
    return {
        "id": new_list.id,
        "title": new_list.title,
        "visibility": normalize_list_visibility(new_list.visibility),
    }


@router.get("", response_model=list)
async def list_lists(
    visibility_scope: str = Query(default="default"),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
):
    """List tenant lists by visibility scope."""
    is_tenant_admin = is_tenant_admin_user(db, tenant, current_user)
    normalized_scope = normalize_list_scope(visibility_scope)
    lists = (
        _query_lists_for_scope(
            db=db,
            tenant=tenant,
            current_user=current_user,
            scope=normalized_scope,
            is_tenant_admin=is_tenant_admin,
        )
        .order_by(func.lower(PhotoList.title).asc(), PhotoList.created_at.asc(), PhotoList.id.asc())
        .all()
    )
    counts = dict(
        db.query(PhotoListItem.list_id, func.count(PhotoListItem.id))
        .join(PhotoList, PhotoListItem.list_id == PhotoList.id)
        .filter(tenant_column_filter(PhotoList, tenant))
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
        _serialize_list_row(
            list_row=l,
            created_by_name=user_names.get(l.created_by_uid) if l.created_by_uid else None,
            item_count=counts.get(l.id, 0),
            current_user=current_user,
            is_tenant_admin=is_tenant_admin,
        )
        for l in lists
    ]


@router.patch("/{list_id:int}", response_model=dict)
async def edit_list(
    list_id: int,
    title: Optional[str] = Body(None),
    notebox: Optional[str] = Body(None),
    visibility: Optional[str] = Body(None),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
):
    """Edit a list (title and/or notebox)."""
    is_tenant_admin = is_tenant_admin_user(db, tenant, current_user)
    lst = _get_accessible_list_or_404(
        db=db,
        tenant=tenant,
        list_id=list_id,
        current_user=current_user,
        is_tenant_admin=is_tenant_admin,
    )
    if not can_edit_list(lst, user=current_user, is_tenant_admin=is_tenant_admin):
        raise HTTPException(status_code=403, detail="Only list owner or admin can edit this list")
    if title is not None:
        lst.title = title
    if notebox is not None:
        lst.notebox = notebox
    if visibility is not None:
        lst.visibility = normalize_list_visibility(visibility, default=normalize_list_visibility(lst.visibility))
    db.commit()
    db.refresh(lst)

    # Get creator display name
    created_by_name = None
    if lst.created_by_uid:
        user = db.query(UserProfile.display_name).filter(
            UserProfile.supabase_uid == lst.created_by_uid
        ).first()
        created_by_name = user[0] if user else None

    return _serialize_list_row(
        list_row=lst,
        created_by_name=created_by_name,
        item_count=len(lst.items),
        current_user=current_user,
        is_tenant_admin=is_tenant_admin,
    )


@router.delete("/{list_id:int}", response_model=dict)
async def delete_list(
    list_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
):
    """Delete a list and its items."""
    is_tenant_admin = is_tenant_admin_user(db, tenant, current_user)
    lst = _get_accessible_list_or_404(
        db=db,
        tenant=tenant,
        list_id=list_id,
        current_user=current_user,
        is_tenant_admin=is_tenant_admin,
    )
    if not can_edit_list(lst, user=current_user, is_tenant_admin=is_tenant_admin):
        raise HTTPException(status_code=403, detail="Only list owner or admin can delete this list")
    db.delete(lst)
    db.commit()
    return {"deleted": True}


@router.get("/{list_id:int}/items", response_model=list)
async def get_list_items(
    list_id: int,
    ids_only: bool = False,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
):
    """Get all items in a list, ordered by added_at ascending."""
    is_tenant_admin = is_tenant_admin_user(db, tenant, current_user)
    _get_accessible_list_or_404(
        db=db,
        tenant=tenant,
        list_id=list_id,
        current_user=current_user,
        is_tenant_admin=is_tenant_admin,
    )
    if ids_only:
        items = (
            db.query(
                PhotoListItem.id,
                ImageMetadata.id.label("photo_id"),
                PhotoListItem.asset_id,
                PhotoListItem.added_at,
            )
            .join(PhotoList, PhotoListItem.list_id == PhotoList.id)
            .outerjoin(
                ImageMetadata,
                and_(
                    PhotoListItem.asset_id == ImageMetadata.asset_id,
                    tenant_column_filter(ImageMetadata, tenant),
                ),
            )
            .filter(PhotoListItem.list_id == list_id, tenant_column_filter(PhotoList, tenant))
            .order_by(PhotoListItem.added_at.asc())
            .all()
        )
        return [
            {"id": item_id, "photo_id": photo_id, "asset_id": str(asset_id) if asset_id else None, "added_at": added_at}
            for item_id, photo_id, asset_id, added_at in items
        ]
    items = (
        db.query(PhotoListItem, ImageMetadata)
        .join(
            ImageMetadata,
            and_(
                PhotoListItem.asset_id == ImageMetadata.asset_id,
                tenant_column_filter(ImageMetadata, tenant),
            ),
        )
        .filter(
            PhotoListItem.list_id == list_id
        )
        .order_by(PhotoListItem.added_at.asc())
        .all()
    )
    assets_by_id = load_assets_for_images(db, [img for _, img in items])
    image_ids = [img.id for _, img in items]
    asset_id_to_image_id = {img.asset_id: img.id for _, img in items if img.asset_id is not None}
    asset_ids = list(asset_id_to_image_id.keys())
    active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')
    tags = db.query(MachineTag).filter(
        MachineTag.asset_id.in_(asset_ids),
        tenant_column_filter(MachineTag, tenant),
        MachineTag.tag_type == active_tag_type
    ).all() if asset_ids else []
    permatags = db.query(Permatag).filter(
        Permatag.asset_id.in_(asset_ids),
        tenant_column_filter(Permatag, tenant)
    ).all() if asset_ids else []
    variant_count_by_asset = {
        asset_id: int(count or 0)
        for asset_id, count in (
            db.query(
                AssetDerivative.asset_id,
                func.count(AssetDerivative.id),
            ).filter(
                AssetDerivative.asset_id.in_(asset_ids),
                AssetDerivative.deleted_at.is_(None),
            ).group_by(AssetDerivative.asset_id).all() if asset_ids else []
        )
    }

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
        image_id = asset_id_to_image_id.get(tag.asset_id)
        if image_id is None:
            continue
        kw_info = keywords_map.get(tag.keyword_id, {"keyword": "unknown", "category": "unknown"})
        tags_by_image.setdefault(image_id, []).append({
            "keyword": kw_info["keyword"],
            "category": kw_info["category"],
            "confidence": round(tag.confidence, 2)
        })
    permatags_by_image = {}
    for permatag in permatags:
        image_id = asset_id_to_image_id.get(permatag.asset_id)
        if image_id is None:
            continue
        kw_info = keywords_map.get(permatag.keyword_id, {"keyword": "unknown", "category": "unknown"})
        permatags_by_image.setdefault(image_id, []).append({
            "id": permatag.id,
            "keyword": kw_info["keyword"],
            "category": kw_info["category"],
            "signum": permatag.signum
        })
    response_items = []
    for item, img in items:
        storage_info = _resolve_storage_or_409(
            image=img,
            tenant=tenant,
            db=db,
            assets_by_id=assets_by_id,
        )
        machine_tags = sorted(tags_by_image.get(img.id, []), key=lambda x: x['confidence'], reverse=True)
        image_permatags = permatags_by_image.get(img.id, [])
        calculated_tags = calculate_tags(machine_tags, image_permatags)
        response_items.append({
            "id": item.id,
            "photo_id": img.id,
            "asset_id": str(item.asset_id) if item.asset_id else storage_info.asset_id,
            "added_at": item.added_at,
            "image": {
                "id": img.id,
                "asset_id": storage_info.asset_id,
                "variant_count": int(variant_count_by_asset.get(img.asset_id, 0)),
                "has_variants": int(variant_count_by_asset.get(img.asset_id, 0)) > 0,
                "filename": img.filename,
                "width": img.width,
                "height": img.height,
                "format": img.format,
                "file_size": img.file_size,
                "dropbox_path": storage_info.source_key,
                "source_provider": storage_info.source_provider,
                "source_key": storage_info.source_key,
                "source_rev": storage_info.source_rev,
                "source_url": _build_source_url(storage_info, tenant, img),
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
                "thumbnail_path": storage_info.thumbnail_key,
                "thumbnail_url": storage_info.thumbnail_url,
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
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
):
    """Add a photo to a specific list."""
    photo_id = req.photo_id

    # Verify list belongs to tenant
    is_tenant_admin = is_tenant_admin_user(db, tenant, current_user)
    _get_accessible_list_or_404(
        db=db,
        tenant=tenant,
        list_id=list_id,
        current_user=current_user,
        is_tenant_admin=is_tenant_admin,
    )

    image = db.query(ImageMetadata.id, ImageMetadata.asset_id).filter(
        ImageMetadata.id == photo_id,
        tenant_column_filter(ImageMetadata, tenant)
    ).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    asset_id = image.asset_id
    if asset_id is None:
        raise HTTPException(status_code=409, detail="Image has no asset_id")

    # Prevent duplicate items in the list
    existing_item = db.query(PhotoListItem).filter(
        PhotoListItem.list_id == list_id,
        PhotoListItem.asset_id == asset_id
    ).first()
    if existing_item:
        # Silent no-op if already present
        return {
            "list_id": list_id,
            "item_id": existing_item.id,
            "photo_id": image.id,
            "asset_id": str(existing_item.asset_id) if existing_item.asset_id else None,
            "added_at": existing_item.added_at,
        }

    item = PhotoListItem(list_id=list_id, asset_id=asset_id)
    db.add(item)
    db.commit()
    db.refresh(item)
    return {
        "list_id": list_id,
        "item_id": item.id,
        "photo_id": image.id,
        "asset_id": str(item.asset_id) if item.asset_id else None,
        "added_at": item.added_at,
    }


@router.post("/add-photo", response_model=dict)
async def add_photo_to_list(
    req: AddPhotoRequest,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
):
    """Add a photo to the most recently created list. If no lists exist, create one and add the photo."""
    photo_id = req.photo_id
    image = db.query(ImageMetadata.id, ImageMetadata.asset_id).filter(
        ImageMetadata.id == photo_id,
        tenant_column_filter(ImageMetadata, tenant)
    ).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    asset_id = image.asset_id
    if asset_id is None:
        raise HTTPException(status_code=409, detail="Image has no asset_id")

    is_tenant_admin = is_tenant_admin_user(db, tenant, current_user)
    recent = get_most_recent_list(
        db,
        tenant,
        current_user=current_user,
        is_tenant_admin=is_tenant_admin,
    )
    if not recent:
        # Auto-create new list
        recent = assign_tenant_scope(PhotoList(
            title="Untitled List",
            visibility="shared",
            created_by_uid=current_user.supabase_uid if current_user else None,
        ), tenant)
        db.add(recent)
        db.commit()
        db.refresh(recent)
    # Prevent duplicate items in the list
    existing_item = db.query(PhotoListItem).filter(
        PhotoListItem.list_id == recent.id,
        PhotoListItem.asset_id == asset_id
    ).first()
    if existing_item:
        # Silent no-op if already present
        return {
            "list_id": recent.id,
            "item_id": existing_item.id,
            "photo_id": image.id,
            "asset_id": str(existing_item.asset_id) if existing_item.asset_id else None,
            "added_at": existing_item.added_at,
        }
    item = PhotoListItem(list_id=recent.id, asset_id=asset_id)
    db.add(item)
    db.commit()
    db.refresh(item)
    return {
        "list_id": recent.id,
        "item_id": item.id,
        "photo_id": image.id,
        "asset_id": str(item.asset_id) if item.asset_id else None,
        "added_at": item.added_at,
    }
