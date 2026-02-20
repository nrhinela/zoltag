"""Router for guest collaboration endpoints (Phase I)."""

from __future__ import annotations

import logging
import mimetypes
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import StreamingResponse
from jose import JWTError
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from zoltag.asset_helpers import bulk_preload_thumbnail_urls, load_assets_for_images
from zoltag.auth.models import UserProfile
from zoltag.auth.jwt import verify_supabase_jwt
from zoltag.dependencies import get_db, get_secret
from zoltag.integrations import TenantIntegrationRepository
from zoltag.models.config import PhotoList, PhotoListItem
from zoltag.models.sharing import ListShare, MemberComment, MemberRating
from zoltag.metadata import ImageMetadata
from zoltag.metadata import Tenant as TenantModel
from zoltag.routers.images._shared import _resolve_provider_ref, _resolve_storage_or_409
from zoltag.ratelimit import limiter
from zoltag.settings import settings
from zoltag.storage import create_storage_provider
from zoltag.tenant import Tenant

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/guest",
    tags=["guest"],
)


# ---------------------------------------------------------------------------
# Guest identity & auth dependency
# ---------------------------------------------------------------------------

@dataclass
class GuestIdentity:
    supabase_uid: uuid.UUID
    email: str
    tenant_id: uuid.UUID


async def _get_guest_identity(
    authorization: Optional[str] = Header(None),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
) -> GuestIdentity:
    """Validate the JWT for a guest user.

    - Verifies signature via Supabase JWKS.
    - Requires user_role == 'guest' in the JWT claims (set by Custom Access Token Hook).
    - Requires X-Tenant-ID to be present in the JWT's tenant_ids claim.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing authorization token.")

    token = authorization[7:]
    try:
        claims = await verify_supabase_jwt(token)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token.")

    if claims.get("user_role") != "guest":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Guest access only.")

    tenant_ids = claims.get("tenant_ids") or []
    if x_tenant_id not in tenant_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this tenant.")

    try:
        guest_uid = uuid.UUID(claims["sub"])
        tenant_id = uuid.UUID(x_tenant_id)
    except (KeyError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token claims.")

    email = claims.get("email") or ""
    return GuestIdentity(supabase_uid=guest_uid, email=email, tenant_id=tenant_id)


def _get_active_share(
    *,
    list_id: int,
    guest: GuestIdentity,
    db: Session,
) -> ListShare:
    """Return the active ListShare for (list_id, guest_uid), or raise 403."""
    now = datetime.now(tz=timezone.utc)
    email_normalized = (guest.email or "").strip().lower()
    identity_filter = [ListShare.guest_uid == guest.supabase_uid]
    if email_normalized:
        identity_filter.append(func.lower(ListShare.guest_email) == email_normalized)
    share = (
        db.query(ListShare)
        .filter(
            ListShare.list_id == list_id,
            or_(*identity_filter),
            ListShare.tenant_id == guest.tenant_id,
            ListShare.revoked_at.is_(None),
            (ListShare.expires_at.is_(None)) | (ListShare.expires_at > now),
        )
        .first()
    )
    if not share:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No active share found for this list. The link may have expired or been revoked.",
        )
    return share


def _assert_asset_in_list(asset_id: uuid.UUID, list_id: int, db: Session) -> None:
    """Verify that asset_id belongs to list_id, to prevent blind asset enumeration."""
    item = (
        db.query(PhotoListItem)
        .filter(PhotoListItem.list_id == list_id, PhotoListItem.asset_id == asset_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Asset not in this list.")


def _build_tenant_runtime(db: Session, tenant_id: uuid.UUID) -> Tenant:
    tenant_row = db.query(TenantModel).filter(TenantModel.id == tenant_id).first()
    if not tenant_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found.")

    integration_repo = TenantIntegrationRepository(db)
    runtime_context = integration_repo.build_runtime_context(tenant_row)
    tenant_settings = tenant_row.settings if isinstance(tenant_row.settings, dict) else {}
    dropbox_runtime = runtime_context.get("dropbox") or {}
    gdrive_runtime = runtime_context.get("gdrive") or {}
    key_prefix = (getattr(tenant_row, "key_prefix", None) or str(tenant_row.id)).strip()

    return Tenant(
        id=str(tenant_row.id),
        name=tenant_row.name,
        identifier=getattr(tenant_row, "identifier", None) or str(tenant_row.id),
        key_prefix=key_prefix,
        active=tenant_row.active,
        dropbox_token_secret=str(dropbox_runtime.get("token_secret_name") or f"dropbox-token-{key_prefix}").strip(),
        dropbox_app_key=str(dropbox_runtime.get("app_key") or "").strip() or None,
        dropbox_app_secret=str(dropbox_runtime.get("app_secret_name") or f"dropbox-app-secret-{key_prefix}").strip(),
        dropbox_oauth_mode=str(dropbox_runtime.get("oauth_mode") or "").strip().lower() or None,
        dropbox_sync_folders=list(dropbox_runtime.get("sync_folders") or []),
        gdrive_sync_folders=list(gdrive_runtime.get("sync_folders") or []),
        default_source_provider=str(runtime_context.get("default_source_provider") or "dropbox").strip().lower(),
        gdrive_client_id=str(gdrive_runtime.get("client_id") or "").strip() or None,
        gdrive_token_secret=str(gdrive_runtime.get("token_secret_name") or f"gdrive-token-{key_prefix}").strip(),
        gdrive_client_secret=str(gdrive_runtime.get("client_secret_name") or f"gdrive-client-secret-{key_prefix}").strip(),
        storage_bucket=tenant_row.storage_bucket,
        thumbnail_bucket=tenant_row.thumbnail_bucket,
        settings=tenant_settings,
    )


# ---------------------------------------------------------------------------
# request schemas
# ---------------------------------------------------------------------------

class CommentCreateRequest(BaseModel):
    asset_id: uuid.UUID
    comment_text: str


class RatingUpsertRequest(BaseModel):
    asset_id: uuid.UUID
    rating: int


# ---------------------------------------------------------------------------
# endpoints
# ---------------------------------------------------------------------------

@router.get("/lists")
async def get_guest_lists(
    guest: GuestIdentity = Depends(_get_guest_identity),
    db: Session = Depends(get_db),
):
    """Fetch all lists accessible to this guest."""
    # Find all active shares for this guest in this tenant
    email_normalized = (guest.email or "").strip().lower()
    identity_filter = [ListShare.guest_uid == guest.supabase_uid]
    if email_normalized:
        identity_filter.append(func.lower(ListShare.guest_email) == email_normalized)

    shares = (
        db.query(ListShare)
        .filter(
            or_(*identity_filter),
            ListShare.tenant_id == guest.tenant_id,
            ListShare.revoked_at.is_(None),
        )
        .all()
    )
    share_ids = [share.id for share in shares if share.id is not None]
    reviewed_assets_by_list: dict[int, set[str]] = {}
    if share_ids:
        rating_rows = (
            db.query(ListShare.list_id, MemberRating.asset_id)
            .join(ListShare, ListShare.id == MemberRating.share_id)
            .filter(
                MemberRating.share_id.in_(share_ids),
                MemberRating.user_uid == guest.supabase_uid,
                MemberRating.tenant_id == guest.tenant_id,
            )
            .all()
        )
        comment_rows = (
            db.query(ListShare.list_id, MemberComment.asset_id)
            .join(ListShare, ListShare.id == MemberComment.share_id)
            .filter(
                MemberComment.share_id.in_(share_ids),
                MemberComment.user_uid == guest.supabase_uid,
                MemberComment.tenant_id == guest.tenant_id,
            )
            .all()
        )
        for list_id, asset_id in [*rating_rows, *comment_rows]:
            if list_id is None or asset_id is None:
                continue
            reviewed_assets_by_list.setdefault(int(list_id), set()).add(str(asset_id))

    # Fetch list metadata and creator labels in batches.
    lists_by_id: dict[int, PhotoList] = {}
    created_by_uids: set[uuid.UUID] = set()
    for share in shares:
        photo_list = db.query(PhotoList).filter(PhotoList.id == share.list_id).first()
        if not photo_list:
            continue
        lists_by_id[share.list_id] = photo_list
        if photo_list.created_by_uid:
            try:
                created_by_uids.add(uuid.UUID(str(photo_list.created_by_uid)))
            except (TypeError, ValueError):
                pass

    creator_name_by_uid: dict[uuid.UUID, str] = {}
    if created_by_uids:
        creator_rows = (
            db.query(UserProfile.supabase_uid, UserProfile.display_name, UserProfile.email)
            .filter(UserProfile.supabase_uid.in_(list(created_by_uids)))
            .all()
        )
        for uid, display_name, email in creator_rows:
            creator_name_by_uid[uid] = str(display_name or "").strip() or str(email or "").strip() or "Unknown"

    result = []
    for share in shares:
        photo_list = lists_by_id.get(share.list_id)
        if photo_list:
            # Count items in the list
            item_count = db.query(PhotoListItem).filter(PhotoListItem.list_id == photo_list.id).count()
            shared_by = None
            if photo_list.created_by_uid:
                try:
                    shared_by = creator_name_by_uid.get(uuid.UUID(str(photo_list.created_by_uid)))
                except (TypeError, ValueError):
                    shared_by = None

            result.append({
                "list_id": photo_list.id,
                "title": photo_list.title,
                "item_count": item_count,
                "reviewed_count": len(reviewed_assets_by_list.get(photo_list.id, set())),
                "shared_by": shared_by,
                "shared_at": share.created_at.isoformat() if share.created_at else None,
                "expires_at": share.expires_at.isoformat() if share.expires_at else None,
            })

    return {"lists": result}


@router.get("/lists/{list_id}")
async def get_guest_list(
    list_id: int,
    guest: GuestIdentity = Depends(_get_guest_identity),
    db: Session = Depends(get_db),
):
    """Fetch list metadata and items for a guest."""
    share = _get_active_share(list_id=list_id, guest=guest, db=db)

    photo_list = db.query(PhotoList).filter(PhotoList.id == list_id).first()
    if not photo_list:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="List not found.")

    list_items = (
        db.query(PhotoListItem)
        .filter(PhotoListItem.list_id == list_id)
        .order_by(PhotoListItem.added_at)
        .all()
    )

    asset_ids = [item.asset_id for item in list_items if item.asset_id is not None]
    share_ids = [
        row[0]
        for row in (
            db.query(ListShare.id)
            .filter(
                ListShare.list_id == list_id,
                ListShare.tenant_id == guest.tenant_id,
            )
            .all()
        )
    ]
    image_rows = (
        db.query(ImageMetadata)
        .filter(
            ImageMetadata.asset_id.in_(asset_ids) if asset_ids else False,
            ImageMetadata.tenant_id == guest.tenant_id,
        )
        .all()
    )
    image_by_asset_id = {str(row.asset_id): row for row in image_rows if row.asset_id is not None}
    tenant = _build_tenant_runtime(db, guest.tenant_id)
    assets_by_id = load_assets_for_images(db, image_rows)
    preloaded_thumbnail_urls = bulk_preload_thumbnail_urls(image_rows, tenant, assets_by_id)
    rating_counts_by_asset = {}
    comment_counts_by_asset = {}
    if asset_ids and share_ids:
        rating_rows = (
            db.query(MemberRating.asset_id, MemberRating.rating, func.count(MemberRating.id))
            .filter(
                MemberRating.asset_id.in_(asset_ids),
                MemberRating.share_id.in_(share_ids),
                MemberRating.tenant_id == guest.tenant_id,
            )
            .group_by(MemberRating.asset_id, MemberRating.rating)
            .all()
        )
        comment_rows = (
            db.query(MemberComment.asset_id, func.count(MemberComment.id))
            .filter(
                MemberComment.asset_id.in_(asset_ids),
                MemberComment.share_id.in_(share_ids),
                MemberComment.tenant_id == guest.tenant_id,
            )
            .group_by(MemberComment.asset_id)
            .all()
        )
        for asset_id, rating_value, count in rating_rows:
            asset_key = str(asset_id)
            bucket = rating_counts_by_asset.setdefault(asset_key, {"0": 0, "1": 0, "2": 0, "3": 0})
            rating_key = str(int(rating_value)) if rating_value is not None else ""
            if rating_key in bucket:
                bucket[rating_key] = int(count or 0)
        comment_counts_by_asset = {str(asset_id): int(count or 0) for asset_id, count in comment_rows}

    return {
        "id": photo_list.id,
        "title": photo_list.title,
        "share_permissions": {
            "allow_download_thumbs": bool(share.allow_download_thumbs),
            "allow_download_originals": bool(share.allow_download_originals),
        },
        "items": [
            {
                "asset_id": str(item.asset_id),
                "image_id": image_by_asset_id.get(str(item.asset_id)).id if image_by_asset_id.get(str(item.asset_id)) else None,
                "filename": image_by_asset_id.get(str(item.asset_id)).filename if image_by_asset_id.get(str(item.asset_id)) else None,
                "date_taken": image_by_asset_id.get(str(item.asset_id)).capture_timestamp.isoformat()
                if image_by_asset_id.get(str(item.asset_id)) and image_by_asset_id.get(str(item.asset_id)).capture_timestamp
                else None,
                "thumbnail_url": preloaded_thumbnail_urls.get(image_by_asset_id.get(str(item.asset_id)).id)
                if image_by_asset_id.get(str(item.asset_id)) and image_by_asset_id.get(str(item.asset_id)).id is not None
                else None,
                "rating_counts": rating_counts_by_asset.get(str(item.asset_id), {"0": 0, "1": 0, "2": 0, "3": 0}),
                "comment_count": comment_counts_by_asset.get(str(item.asset_id), 0),
                "added_at": item.added_at.isoformat() if item.added_at else None,
            }
            for item in list_items
        ],
    }


@router.get("/lists/{list_id}/assets/{asset_id}/full")
async def get_guest_asset_full(
    list_id: int,
    asset_id: uuid.UUID,
    guest: GuestIdentity = Depends(_get_guest_identity),
    db: Session = Depends(get_db),
):
    """Stream full-size bytes for an asset in a guest-shared list."""
    _get_active_share(list_id=list_id, guest=guest, db=db)
    _assert_asset_in_list(asset_id, list_id, db)

    image = (
        db.query(ImageMetadata)
        .filter(
            ImageMetadata.asset_id == asset_id,
            ImageMetadata.tenant_id == guest.tenant_id,
        )
        .first()
    )
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found.")

    tenant = _build_tenant_runtime(db, guest.tenant_id)
    storage_info = _resolve_storage_or_409(
        image=image,
        tenant=tenant,
        db=db,
        require_source=True,
    )
    provider_name, source_ref = _resolve_provider_ref(storage_info, image)
    if not source_ref:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image source is unavailable.")

    try:
        provider = await run_in_threadpool(
            create_storage_provider,
            provider_name,
            tenant=tenant,
            get_secret=get_secret,
        )
        file_bytes = await run_in_threadpool(provider.download_file, source_ref)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Error fetching image: {exc}")

    filename = image.filename or "image"
    content_type, _ = mimetypes.guess_type(filename or source_ref)
    media_type = content_type or "application/octet-stream"
    return StreamingResponse(
        iter([file_bytes]),
        media_type=media_type,
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": f'inline; filename="{filename}"',
        },
    )


@router.post("/lists/{list_id}/comments", status_code=status.HTTP_201_CREATED)
async def create_comment(
    list_id: int,
    body: CommentCreateRequest,
    guest: GuestIdentity = Depends(_get_guest_identity),
    db: Session = Depends(get_db),
):
    """Submit a comment on an asset."""
    if not body.comment_text or not body.comment_text.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="comment_text cannot be empty.")

    share = _get_active_share(list_id=list_id, guest=guest, db=db)
    _assert_asset_in_list(body.asset_id, list_id, db)

    comment = MemberComment(
        tenant_id=guest.tenant_id,
        asset_id=body.asset_id,
        user_uid=guest.supabase_uid,
        comment_text=body.comment_text.strip(),
        source="guest",
        share_id=share.id,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)

    return {
        "id": str(comment.id),
        "asset_id": str(comment.asset_id),
        "comment_text": comment.comment_text,
        "author_name": (guest.email or "").split("@")[0] if guest.email else "Guest",
        "author_email": guest.email or None,
        "can_delete": True,
        "created_at": comment.created_at.isoformat() if comment.created_at else None,
    }


@router.delete("/lists/{list_id}/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    list_id: int,
    comment_id: uuid.UUID,
    guest: GuestIdentity = Depends(_get_guest_identity),
    db: Session = Depends(get_db),
):
    """Delete one of the guest's own comments."""
    _get_active_share(list_id=list_id, guest=guest, db=db)

    comment = (
        db.query(MemberComment)
        .filter(
            MemberComment.id == comment_id,
            MemberComment.user_uid == guest.supabase_uid,
            MemberComment.tenant_id == guest.tenant_id,
        )
        .first()
    )
    if not comment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found.")

    db.delete(comment)
    db.commit()


@router.post("/lists/{list_id}/reactions", status_code=status.HTTP_200_OK)
async def upsert_rating(
    list_id: int,
    body: RatingUpsertRequest,
    guest: GuestIdentity = Depends(_get_guest_identity),
    db: Session = Depends(get_db),
):
    """Submit or update a rating on an asset (0-3). One rating per user per asset."""
    if body.rating < 0 or body.rating > 3:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="rating must be between 0 and 3.")

    share = _get_active_share(list_id=list_id, guest=guest, db=db)
    _assert_asset_in_list(body.asset_id, list_id, db)

    existing = (
        db.query(MemberRating)
        .filter(
            MemberRating.asset_id == body.asset_id,
            MemberRating.user_uid == guest.supabase_uid,
            MemberRating.tenant_id == guest.tenant_id,
        )
        .first()
    )

    if existing:
        existing.rating = body.rating
        existing.share_id = share.id
        existing.updated_at = datetime.now(tz=timezone.utc)
        db.commit()
        db.refresh(existing)
        rating_row = existing
    else:
        rating_row = MemberRating(
            tenant_id=guest.tenant_id,
            asset_id=body.asset_id,
            user_uid=guest.supabase_uid,
            rating=body.rating,
            source="guest",
            share_id=share.id,
        )
        db.add(rating_row)
        db.commit()
        db.refresh(rating_row)

    return {
        "id": str(rating_row.id),
        "asset_id": str(rating_row.asset_id),
        "rating": rating_row.rating,
        "updated_at": rating_row.updated_at.isoformat() if rating_row.updated_at else None,
    }


@router.get("/lists/{list_id}/my-reactions")
async def get_my_reactions(
    list_id: int,
    guest: GuestIdentity = Depends(_get_guest_identity),
    db: Session = Depends(get_db),
):
    """Comments on this share + ratings submitted by current guest for this list."""
    share = _get_active_share(list_id=list_id, guest=guest, db=db)
    list_asset_ids = [
        row[0]
        for row in db.query(PhotoListItem.asset_id).filter(
            PhotoListItem.list_id == list_id,
            PhotoListItem.asset_id.isnot(None),
        ).all()
    ]

    comments_query = db.query(MemberComment).filter(
        MemberComment.tenant_id == guest.tenant_id,
    )
    if list_asset_ids:
        comments_query = comments_query.filter(MemberComment.asset_id.in_(list_asset_ids))
    comments = comments_query.filter(
        or_(
            MemberComment.share_id == share.id,
            (MemberComment.source == "user") & (MemberComment.share_id.is_(None)),
        )
    ).order_by(MemberComment.created_at).all()
    user_ids = {c.user_uid for c in comments if c.user_uid}
    profile_rows = []
    if user_ids:
        profile_rows = (
            db.query(UserProfile.supabase_uid, UserProfile.display_name, UserProfile.email)
            .filter(UserProfile.supabase_uid.in_(list(user_ids)))
            .all()
        )
    profile_map = {
        uid: {
            "display_name": (display_name or "").strip(),
            "email": (email or "").strip(),
        }
        for uid, display_name, email in profile_rows
    }
    ratings = (
        db.query(MemberRating)
        .filter(
            MemberRating.share_id == share.id,
            MemberRating.user_uid == guest.supabase_uid,
        )
        .all()
    )

    return {
        "comments": [
            {
                "id": str(c.id),
                "asset_id": str(c.asset_id),
                "comment_text": c.comment_text,
                "author_name": (
                    profile_map.get(c.user_uid, {}).get("display_name")
                    or profile_map.get(c.user_uid, {}).get("email")
                    or ("Guest" if c.source == "guest" else "User")
                ),
                "author_email": profile_map.get(c.user_uid, {}).get("email") or None,
                "can_delete": c.user_uid == guest.supabase_uid,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in comments
        ],
        "ratings": [
            {"id": str(r.id), "asset_id": str(r.asset_id), "rating": r.rating,
             "updated_at": r.updated_at.isoformat() if r.updated_at else None}
            for r in ratings
        ],
    }


@router.post("/lists/{list_id}/download/thumbs", status_code=status.HTTP_202_ACCEPTED)
async def download_thumbs(
    list_id: int,
    guest: GuestIdentity = Depends(_get_guest_identity),
    db: Session = Depends(get_db),
):
    """Trigger thumbnail zip download (if permitted by share)."""
    share = _get_active_share(list_id=list_id, guest=guest, db=db)
    if not share.allow_download_thumbs:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Thumbnail download not permitted for this share.")
    # TODO: enqueue async zip job
    return {"message": "Download job enqueued."}


@router.post("/lists/{list_id}/download/originals", status_code=status.HTTP_202_ACCEPTED)
async def download_originals(
    list_id: int,
    guest: GuestIdentity = Depends(_get_guest_identity),
    db: Session = Depends(get_db),
):
    """Trigger original-file zip download (if permitted by share)."""
    share = _get_active_share(list_id=list_id, guest=guest, db=db)
    if not share.allow_download_originals:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Original download not permitted for this share.")
    # TODO: enqueue async zip job
    return {"message": "Download job enqueued."}


class RequestLinkRequest(BaseModel):
    email: str
    tenant_id: Optional[str] = None


@router.post("/auth/request-link", status_code=status.HTTP_200_OK)
async def request_magic_link(
    body: RequestLinkRequest,
    db: Session = Depends(get_db),
):
    """Send a magic link to a guest email (public endpoint, rate-limited)."""
    email = body.email.strip().lower()
    if not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="email is required.")

    shares_query = db.query(ListShare).filter(
        ListShare.guest_email == email,
        ListShare.revoked_at.is_(None),
    )
    tenant_id_filter: Optional[uuid.UUID] = None
    if body.tenant_id:
        try:
            tenant_id_filter = uuid.UUID(body.tenant_id)
        except ValueError:
            return {
                "success": False,
                "message": "Invalid organization link. Please use the original invitation URL.",
            }
        shares_query = shares_query.filter(ListShare.tenant_id == tenant_id_filter)
    shares = shares_query.all()

    # If no shares found, return generic message with error flag
    if not shares:
        logger.info(f"No active shares found for {email}")
        return {
            "success": False,
            "message": "We couldn't find any shared collections for this email address.",
        }

    # Get unique tenant_ids from shares
    tenant_ids = list(set(share.tenant_id for share in shares))

    if len(tenant_ids) > 1 and tenant_id_filter is None:
        logger.info(f"Multiple tenants found for {email}: {tenant_ids}")
        return {
            "success": False,
            "message": "Your email is associated with multiple organizations. Please contact support.",
        }

    tenant_id = tenant_ids[0]
    logger.warning(f"📧 Found tenant {tenant_id} for {email}")

    try:
        app_url = getattr(settings, "app_url", "")
        redirect_to = f"{app_url}/guest?tenant_id={tenant_id}"

        from zoltag.supabase_admin import generate_magic_link
        link_data = await generate_magic_link(email, redirect_to)
        if not link_data or not link_data.get("action_link"):
            logger.warning(f"❌ Failed to generate magic link for {email}")
            return {
                "success": False,
                "message": "Could not generate a sign-in link right now. Please try again.",
            }

        magic_link = link_data.get("action_link")
        otp_code = link_data.get("email_otp") or None
        logger.warning(f"📧 About to send guest magic link email to {email}")
        logger.warning(f"📧 redirect_to: {redirect_to}")
        logger.warning(f"📧 action_link: {magic_link}")

        from zoltag.email import send_guest_magic_link_email
        result = await send_guest_magic_link_email(
            to_email=email,
            magic_link=magic_link,
            otp_code=otp_code,
        )
        logger.warning(f"📧 Email send result: {result}")

        if result:
            logger.warning(f"✅ Sent magic link email to {email}")
        else:
            if settings.is_development:
                logger.warning("⚠️ Resend unavailable or email send failed in dev; returning action_link directly")
                return {
                    "success": True,
                    "message": "Magic link generated (email delivery unavailable locally).",
                    "dev_magic_link": magic_link,
                }
            logger.warning(f"❌ Failed to send magic link email to {email}")
            return {
                "success": False,
                "message": "Could not send the sign-in email right now. Please try again.",
            }
    except Exception as exc:
        logger.error(f"❌ Exception sending magic link to {email}: {exc}")
        import traceback
        traceback.print_exc()
        if settings.is_development:
            return {
                "success": True,
                "message": "Magic link generated (email provider not installed in local env).",
                "dev_magic_link": magic_link if "magic_link" in locals() else None,
            }
        return {
            "success": False,
            "message": "Could not send the sign-in email right now. Please try again.",
        }

    return {
        "success": True,
        "message": "A sign-in link has been sent to your email.",
    }
