"""Router for shared list management (regular-user endpoints)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, and_
from sqlalchemy.orm import Session

from zoltag.auth.dependencies import get_current_user
from zoltag.auth.models import UserProfile
from zoltag.dependencies import get_db, get_tenant
from zoltag.list_visibility import can_edit_list, is_tenant_admin_user
from zoltag.models.config import PhotoList, PhotoListItem
from zoltag.models.sharing import GuestIdentity, ListShare, MemberComment, MemberRating
from zoltag.metadata import ImageMetadata
from zoltag.settings import settings
from zoltag.tenant import Tenant
from zoltag.tenant_scope import tenant_column_filter

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/lists",
    tags=["sharing"],
)

_VALID_EXPIRES_IN_DAYS = {7, 30, 90}


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _active_share_filter():
    """SQLAlchemy filter expression for an active (non-revoked, non-expired) share."""
    now = datetime.now(tz=timezone.utc)
    return and_(
        ListShare.revoked_at.is_(None),
        (ListShare.expires_at.is_(None)) | (ListShare.expires_at > now),
    )


def _expires_at_from_days(expires_in_days: Optional[int]) -> Optional[datetime]:
    if expires_in_days is None:
        return None
    return datetime.now(tz=timezone.utc) + timedelta(days=expires_in_days)


def _normalize_guest_email(email: str) -> str:
    return str(email or "").strip().lower()


def _upsert_guest_identity(db: Session, email_normalized: str, supabase_uid: uuid.UUID) -> None:
    email_identity = (
        db.query(GuestIdentity)
        .filter(GuestIdentity.email_normalized == email_normalized)
        .first()
    )
    uid_identity = (
        db.query(GuestIdentity)
        .filter(GuestIdentity.supabase_uid == supabase_uid)
        .first()
    )

    if email_identity is None and uid_identity is None:
        db.add(GuestIdentity(email_normalized=email_normalized, supabase_uid=supabase_uid))
        return

    if email_identity is not None and uid_identity is None:
        if email_identity.supabase_uid == supabase_uid:
            return
        # Canonicalize historical share rows to the latest known Supabase UID for this email.
        db.query(ListShare).filter(func.lower(ListShare.guest_email) == email_normalized).update(
            {ListShare.guest_uid: supabase_uid},
            synchronize_session=False,
        )
        email_identity.supabase_uid = supabase_uid
        return

    if email_identity is None and uid_identity is not None:
        # Preserve one row per uid: move canonical email for this uid.
        uid_identity.email_normalized = email_normalized
        return

    # Both rows exist.
    if email_identity.email_normalized == uid_identity.email_normalized:
        # Same row found via both lookups.
        if email_identity.supabase_uid != supabase_uid:
            email_identity.supabase_uid = supabase_uid
        return

    # Merge conflict:
    # - email already mapped to another uid row
    # - requested uid already mapped to another email row
    # Keep the uid row, move it to this email, and remove stale email row.
    stale_uid = email_identity.supabase_uid
    db.query(ListShare).filter(func.lower(ListShare.guest_email) == email_normalized).update(
        {ListShare.guest_uid: supabase_uid},
        synchronize_session=False,
    )
    if stale_uid and stale_uid != supabase_uid:
        db.query(ListShare).filter(
            ListShare.guest_uid == stale_uid,
            func.lower(ListShare.guest_email) == email_normalized,
        ).update(
            {ListShare.guest_uid: supabase_uid},
            synchronize_session=False,
        )
    db.delete(email_identity)
    db.flush()
    uid_identity.email_normalized = email_normalized


def _get_editable_list(list_id: int, tenant: Tenant, current_user: UserProfile, db: Session) -> PhotoList:
    photo_list = (
        db.query(PhotoList)
        .filter(tenant_column_filter(PhotoList, tenant), PhotoList.id == list_id)
        .first()
    )
    if not photo_list:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="List not found.")
    is_admin = is_tenant_admin_user(db, tenant, current_user)
    if not can_edit_list(photo_list, user=current_user, is_tenant_admin=is_admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot edit this list.")
    return photo_list


def _share_to_dict(share: ListShare) -> dict:
    return {
        "id": str(share.id),
        "list_id": share.list_id,
        "guest_uid": str(share.guest_uid),
        "guest_email": share.guest_email,
        "allow_download_thumbs": share.allow_download_thumbs,
        "allow_download_originals": share.allow_download_originals,
        "expires_at": share.expires_at.isoformat() if share.expires_at else None,
        "created_at": share.created_at.isoformat() if share.created_at else None,
        "revoked_at": share.revoked_at.isoformat() if share.revoked_at else None,
    }


# ---------------------------------------------------------------------------
# request/response schemas
# ---------------------------------------------------------------------------

class ShareCreateRequest(BaseModel):
    emails: List[str]
    allow_download_thumbs: bool = False
    allow_download_originals: bool = False
    expires_in_days: Optional[int] = Field(default=30, description="7, 30, 90, or null (never)")


class SharePatchRequest(BaseModel):
    allow_download_thumbs: Optional[bool] = None
    allow_download_originals: Optional[bool] = None
    expires_in_days: Optional[int] = Field(default=..., description="7, 30, 90, or null (never)")


class ShareBulkHardDeleteRequest(BaseModel):
    share_ids: List[uuid.UUID] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# endpoints
# ---------------------------------------------------------------------------

@router.post("/{list_id}/shares", status_code=status.HTTP_201_CREATED)
async def create_shares(
    list_id: int,
    body: ShareCreateRequest,
    tenant: Tenant = Depends(get_tenant),
    current_user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Share a list with one or more guest email addresses."""
    logger.info(f"create_shares called for list {list_id}, emails: {body.emails}")

    if body.expires_in_days is not None and body.expires_in_days not in _VALID_EXPIRES_IN_DAYS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"expires_in_days must be one of {sorted(_VALID_EXPIRES_IN_DAYS)} or null.",
        )

    _get_editable_list(list_id, tenant, current_user, db)

    expires_at = _expires_at_from_days(body.expires_in_days)

    # DEBUG: Print all possible settings sources
    import os
    logger.warning(f"🔍 ENV APP_URL: {os.getenv('APP_URL')}")
    logger.warning(f"🔍 ENV ENVIRONMENT: {os.getenv('ENVIRONMENT')}")
    logger.warning(f"🔍 settings.app_url: {settings.app_url}")
    logger.warning(f"🔍 settings.environment: {settings.environment}")

    app_url = settings.app_url

    logger.warning(f"🔍 FINAL app_url: {app_url}")

    results = []
    invite_links = {}  # Store invite links by email

    for email in body.emails:
        email_str = _normalize_guest_email(email)
        if not email_str:
            continue
        logger.warning(f"🚀 Processing invite for {email_str}")

        # Create Supabase guest user (but don't use their invite link)
        try:
            from zoltag.supabase_admin import create_guest_user
            logger.warning(f"🚀 Calling create_guest_user for {email_str}")
            user_data = await create_guest_user(email_str, str(tenant.id))
            guest_uid = uuid.UUID(user_data["id"])
            logger.warning(f"🚀 Guest user created: {guest_uid}")
        except Exception as exc:
            logger.error(f"❌ Supabase user creation failed for {email_str}: {exc}")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Failed to create guest user {email_str}: {exc}",
            )

        # Build guest landing URL with context. Supabase redirects here after magic-link verification.
        guest_redirect_to = f"{app_url}/guest?{urlencode({'tenant_id': str(tenant.id), 'list_id': str(list_id), 'email': email_str})}"
        invite_link = guest_redirect_to

        # Generate one-time magic link now so invite is a single email flow.
        try:
            from zoltag.supabase_admin import generate_magic_link
            link_data = await generate_magic_link(email_str, guest_redirect_to)
            action_link = (link_data or {}).get("action_link")
            if action_link:
                invite_link = str(action_link)
                logger.warning(f"✅ Generated one-time invite magic link for {email_str}")
            else:
                logger.warning(f"⚠️ Missing action_link for {email_str}; falling back to guest landing URL")
        except Exception as magic_exc:
            logger.error(f"❌ Failed to generate invite magic link for {email_str}: {magic_exc}")
            # Keep fallback behavior so shares can still be created.
            invite_link = guest_redirect_to

        invite_links[email_str] = invite_link

        _upsert_guest_identity(db, email_str, guest_uid)

        # Send invite email via Resend
        try:
            logger.warning(f"📧 About to send email to {email_str}")
            from zoltag.email import send_guest_invite_email
            photo_list = db.query(PhotoList).filter(PhotoList.id == list_id).first()
            list_name = photo_list.title if photo_list else None
            inviter_name = current_user.display_name or current_user.email

            logger.warning(f"📧 Sending invite email to {email_str}")
            email_sent = send_guest_invite_email(
                to_email=email_str,
                invite_link=invite_link,
                list_name=list_name,
                inviter_name=inviter_name,
                tenant_name=tenant.name,
            )
            if email_sent:
                logger.warning(f"✅ Email sent successfully to {email_str}")
            else:
                logger.warning(f"❌ Failed to send email to {email_str}, but guest user was created")
        except Exception as email_exc:
            logger.error(f"❌ Exception sending email to {email_str}: {email_exc}")
            import traceback
            traceback.print_exc()

        # Upsert list_shares row
        share = (
            db.query(ListShare)
            .filter(ListShare.list_id == list_id, func.lower(ListShare.guest_email) == email_str)
            .first()
        )
        if share is None:
            share = ListShare(
                tenant_id=uuid.UUID(str(tenant.id)),
                list_id=list_id,
                guest_uid=guest_uid,
                guest_email=email_str,
                created_by_uid=current_user.supabase_uid,
                allow_download_thumbs=body.allow_download_thumbs,
                allow_download_originals=body.allow_download_originals,
                expires_at=expires_at,
            )
            db.add(share)
        else:
            # Reactivate a previously revoked share
            share.revoked_at = None
            share.allow_download_thumbs = body.allow_download_thumbs
            share.allow_download_originals = body.allow_download_originals
            share.expires_at = expires_at
            share.guest_email = email_str

        results.append(share)

    db.commit()
    for share in results:
        db.refresh(share)

    # Add invite links to response
    shares_response = [_share_to_dict(s) for s in results]
    for share_dict in shares_response:
        email = share_dict.get("guest_email")
        if email in invite_links:
            share_dict["invite_link"] = invite_links[email]

    return shares_response


@router.get("/{list_id}/shares")
async def list_shares(
    list_id: int,
    tenant: Tenant = Depends(get_tenant),
    current_user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all active shares for a list."""
    _get_editable_list(list_id, tenant, current_user, db)

    shares = (
        db.query(ListShare)
        .filter(
            ListShare.list_id == list_id,
            tenant_column_filter(ListShare, tenant),
            _active_share_filter(),
        )
        .order_by(ListShare.created_at)
        .all()
    )
    return [_share_to_dict(s) for s in shares]


@router.patch("/{list_id}/shares/{share_id}")
async def update_share(
    list_id: int,
    share_id: uuid.UUID,
    body: SharePatchRequest,
    tenant: Tenant = Depends(get_tenant),
    current_user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update download permissions or expiry for a share."""
    if body.expires_in_days is not None and body.expires_in_days not in _VALID_EXPIRES_IN_DAYS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"expires_in_days must be one of {sorted(_VALID_EXPIRES_IN_DAYS)} or null.",
        )

    _get_editable_list(list_id, tenant, current_user, db)

    share = (
        db.query(ListShare)
        .filter(
            ListShare.id == share_id,
            ListShare.list_id == list_id,
            tenant_column_filter(ListShare, tenant),
        )
        .first()
    )
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share not found.")

    if body.allow_download_thumbs is not None:
        share.allow_download_thumbs = body.allow_download_thumbs
    if body.allow_download_originals is not None:
        share.allow_download_originals = body.allow_download_originals
    # expires_in_days=None means "never" (explicit null); use sentinel to distinguish "not provided"
    # Pydantic default=... makes the field required — always update when present
    share.expires_at = _expires_at_from_days(body.expires_in_days)

    db.commit()
    db.refresh(share)
    return _share_to_dict(share)


@router.delete("/{list_id}/shares/{share_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_share(
    list_id: int,
    share_id: uuid.UUID,
    tenant: Tenant = Depends(get_tenant),
    current_user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Revoke a share (soft delete). Guest annotations are preserved."""
    _get_editable_list(list_id, tenant, current_user, db)

    share = (
        db.query(ListShare)
        .filter(
            ListShare.id == share_id,
            ListShare.list_id == list_id,
            tenant_column_filter(ListShare, tenant),
        )
        .first()
    )
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share not found.")

    share.revoked_at = datetime.now(tz=timezone.utc)
    db.commit()


@router.get("/{list_id}/shares/{share_id}/annotations")
async def get_share_annotations(
    list_id: int,
    share_id: uuid.UUID,
    tenant: Tenant = Depends(get_tenant),
    current_user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """All guest comments and ratings for a specific share, grouped by asset."""
    _get_editable_list(list_id, tenant, current_user, db)

    share = (
        db.query(ListShare)
        .filter(
            ListShare.id == share_id,
            ListShare.list_id == list_id,
            tenant_column_filter(ListShare, tenant),
        )
        .first()
    )
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share not found.")

    comments = (
        db.query(MemberComment)
        .filter(MemberComment.share_id == share_id, tenant_column_filter(MemberComment, tenant))
        .order_by(MemberComment.created_at)
        .all()
    )
    ratings = (
        db.query(MemberRating)
        .filter(MemberRating.share_id == share_id, tenant_column_filter(MemberRating, tenant))
        .all()
    )

    # Group by asset_id
    by_asset: dict = {}

    for r in ratings:
        aid = str(r.asset_id)
        by_asset.setdefault(aid, {"asset_id": aid, "rating": None, "comments": []})
        by_asset[aid]["rating"] = {"rating": r.rating, "updated_at": r.updated_at.isoformat() if r.updated_at else None}

    for c in comments:
        aid = str(c.asset_id)
        by_asset.setdefault(aid, {"asset_id": aid, "rating": None, "comments": []})
        by_asset[aid]["comments"].append({
            "id": str(c.id),
            "comment_text": c.comment_text,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        })

    return {
        "share_id": str(share.id),
        "guest_email": share.guest_email,
        "annotations": list(by_asset.values()),
    }


@router.get("/shares/summary")
async def shares_summary(
    tenant: Tenant = Depends(get_tenant),
    current_user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Admin overview: all lists with shares and annotation counts."""
    is_admin = is_tenant_admin_user(db, tenant, current_user)
    if not is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required.")

    shares = (
        db.query(ListShare)
        .filter(tenant_column_filter(ListShare, tenant))
        .order_by(ListShare.list_id, ListShare.created_at)
        .all()
    )

    # Annotation counts per share
    comment_counts = {
        str(row[0]): row[1]
        for row in db.query(MemberComment.share_id, func.count())
        .filter(tenant_column_filter(MemberComment, tenant), MemberComment.share_id.isnot(None))
        .group_by(MemberComment.share_id)
        .all()
    }
    rating_counts = {
        str(row[0]): row[1]
        for row in db.query(MemberRating.share_id, func.count())
        .filter(tenant_column_filter(MemberRating, tenant), MemberRating.share_id.isnot(None))
        .group_by(MemberRating.share_id)
        .all()
    }

    # Fetch list titles
    list_ids = list({s.list_id for s in shares})
    lists_by_id = {}
    if list_ids:
        for pl in db.query(PhotoList).filter(PhotoList.id.in_(list_ids)):
            lists_by_id[pl.id] = pl.title

    # Fetch creator display names for created_by_uid values.
    creator_uids = [s.created_by_uid for s in shares if s.created_by_uid]
    creator_map: dict[uuid.UUID, str] = {}
    if creator_uids:
        creator_rows = (
            db.query(UserProfile.supabase_uid, UserProfile.display_name, UserProfile.email)
            .filter(UserProfile.supabase_uid.in_(creator_uids))
            .all()
        )
        for uid, display_name, email in creator_rows:
            label = str(display_name or "").strip() or str(email or "").strip() or str(uid)
            creator_map[uid] = label

    # Group shares by list
    lists_map: dict = {}
    for share in shares:
        sid = str(share.id)
        annotation_count = comment_counts.get(sid, 0) + rating_counts.get(sid, 0)
        lists_map.setdefault(share.list_id, {
            "list_id": share.list_id,
            "list_title": lists_by_id.get(share.list_id, ""),
            "shares": [],
        })
        lists_map[share.list_id]["shares"].append({
            "share_id": sid,
            "list_id": share.list_id,
            "list_title": lists_by_id.get(share.list_id, ""),
            "guest_email": share.guest_email,
            "guest_uid": str(share.guest_uid),
            "created_by_uid": str(share.created_by_uid) if share.created_by_uid else None,
            "created_by_name": creator_map.get(share.created_by_uid) if share.created_by_uid else None,
            "allow_download_thumbs": bool(share.allow_download_thumbs),
            "allow_download_originals": bool(share.allow_download_originals),
            "created_at": share.created_at.isoformat() if share.created_at else None,
            "expires_at": share.expires_at.isoformat() if share.expires_at else None,
            "revoked_at": share.revoked_at.isoformat() if share.revoked_at else None,
            "annotation_count": annotation_count,
        })

    return list(lists_map.values())


@router.delete("/shares/{share_id}/hard", status_code=status.HTTP_204_NO_CONTENT)
async def hard_delete_share(
    share_id: uuid.UUID,
    tenant: Tenant = Depends(get_tenant),
    current_user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Hard-delete a share row (admin only)."""
    is_admin = is_tenant_admin_user(db, tenant, current_user)
    if not is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required.")

    share = (
        db.query(ListShare)
        .filter(
            ListShare.id == share_id,
            tenant_column_filter(ListShare, tenant),
        )
        .first()
    )
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share not found.")

    db.delete(share)
    db.commit()


@router.post("/shares/hard-delete", status_code=status.HTTP_204_NO_CONTENT)
async def hard_delete_shares_bulk(
    body: ShareBulkHardDeleteRequest,
    tenant: Tenant = Depends(get_tenant),
    current_user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Hard-delete multiple share rows (admin only)."""
    is_admin = is_tenant_admin_user(db, tenant, current_user)
    if not is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required.")

    share_ids = [sid for sid in body.share_ids if sid]
    if not share_ids:
        return

    (
        db.query(ListShare)
        .filter(
            ListShare.id.in_(share_ids),
            tenant_column_filter(ListShare, tenant),
        )
        .delete(synchronize_session=False)
    )
    db.commit()


@router.get("/shares/feedback-log")
async def guest_feedback_log(
    tenant: Tenant = Depends(get_tenant),
    _current_user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db),
    limit: int = 200,
):
    """Tenant-wide guest feedback events (comments + ratings), newest first."""
    safe_limit = max(1, min(int(limit or 200), 1000))
    tenant_id = uuid.UUID(str(tenant.id))

    comment_rows = (
        db.query(
            MemberComment.id.label("event_id"),
            MemberComment.asset_id.label("asset_id"),
            MemberComment.created_at.label("event_at"),
            MemberComment.user_uid.label("user_uid"),
            MemberComment.comment_text.label("comment_text"),
            ImageMetadata.id.label("image_id"),
            ImageMetadata.filename.label("filename"),
            UserProfile.display_name.label("display_name"),
            UserProfile.email.label("profile_email"),
            ListShare.guest_email.label("share_guest_email"),
        )
        .outerjoin(
            ImageMetadata,
            and_(
                ImageMetadata.asset_id == MemberComment.asset_id,
                ImageMetadata.tenant_id == MemberComment.tenant_id,
            ),
        )
        .outerjoin(UserProfile, UserProfile.supabase_uid == MemberComment.user_uid)
        .outerjoin(ListShare, ListShare.id == MemberComment.share_id)
        .filter(
            tenant_column_filter(MemberComment, tenant),
            MemberComment.source == "guest",
        )
        .order_by(MemberComment.created_at.desc())
        .limit(safe_limit)
        .all()
    )

    rating_rows = (
        db.query(
            MemberRating.id.label("event_id"),
            MemberRating.asset_id.label("asset_id"),
            MemberRating.updated_at.label("event_at"),
            MemberRating.user_uid.label("user_uid"),
            MemberRating.rating.label("rating"),
            ImageMetadata.id.label("image_id"),
            ImageMetadata.filename.label("filename"),
            UserProfile.display_name.label("display_name"),
            UserProfile.email.label("profile_email"),
            ListShare.guest_email.label("share_guest_email"),
        )
        .outerjoin(
            ImageMetadata,
            and_(
                ImageMetadata.asset_id == MemberRating.asset_id,
                ImageMetadata.tenant_id == MemberRating.tenant_id,
            ),
        )
        .outerjoin(UserProfile, UserProfile.supabase_uid == MemberRating.user_uid)
        .outerjoin(ListShare, ListShare.id == MemberRating.share_id)
        .filter(
            tenant_column_filter(MemberRating, tenant),
            MemberRating.source == "guest",
        )
        .order_by(MemberRating.updated_at.desc())
        .limit(safe_limit)
        .all()
    )

    events = []
    for row in comment_rows:
        author_email = str(row.share_guest_email or row.profile_email or "").strip() or None
        author_name = str(row.display_name or "").strip() or (author_email.split("@")[0] if author_email else "Guest")
        events.append({
            "event_id": str(row.event_id),
            "event_type": "commented",
            "event_at": row.event_at.isoformat() if row.event_at else None,
            "asset_id": str(row.asset_id),
            "image_id": int(row.image_id) if row.image_id is not None else None,
            "filename": row.filename,
            "author_name": author_name,
            "author_email": author_email,
            "comment_text": row.comment_text,
        })

    for row in rating_rows:
        author_email = str(row.share_guest_email or row.profile_email or "").strip() or None
        author_name = str(row.display_name or "").strip() or (author_email.split("@")[0] if author_email else "Guest")
        events.append({
            "event_id": str(row.event_id),
            "event_type": "rated",
            "event_at": row.event_at.isoformat() if row.event_at else None,
            "asset_id": str(row.asset_id),
            "image_id": int(row.image_id) if row.image_id is not None else None,
            "filename": row.filename,
            "author_name": author_name,
            "author_email": author_email,
            "rating": int(row.rating) if row.rating is not None else None,
        })

    events.sort(key=lambda item: item.get("event_at") or "", reverse=True)
    return {
        "events": events[:safe_limit],
        "count": len(events[:safe_limit]),
        "tenant_id": str(tenant_id),
    }


@router.get("/shares/alerts")
async def guest_rating_alerts(
    tenant: Tenant = Depends(get_tenant),
    _current_user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db),
    limit: int = 200,
):
    """Tenant-wide alerts for member 0-ratings that differ from official image rating."""
    safe_limit = max(1, min(int(limit or 200), 1000))

    rows = (
        db.query(
            MemberRating.id.label("event_id"),
            MemberRating.asset_id.label("asset_id"),
            MemberRating.updated_at.label("event_at"),
            MemberRating.user_uid.label("user_uid"),
            MemberRating.rating.label("member_rating"),
            MemberRating.source.label("source"),
            ImageMetadata.id.label("image_id"),
            ImageMetadata.filename.label("filename"),
            ImageMetadata.rating.label("official_rating"),
            UserProfile.display_name.label("display_name"),
            UserProfile.email.label("profile_email"),
            ListShare.guest_email.label("share_guest_email"),
        )
        .outerjoin(
            ImageMetadata,
            and_(
                ImageMetadata.asset_id == MemberRating.asset_id,
                ImageMetadata.tenant_id == MemberRating.tenant_id,
            ),
        )
        .outerjoin(UserProfile, UserProfile.supabase_uid == MemberRating.user_uid)
        .outerjoin(ListShare, ListShare.id == MemberRating.share_id)
        .filter(
            tenant_column_filter(MemberRating, tenant),
            MemberRating.rating == 0,
            (ImageMetadata.rating.is_(None)) | (ImageMetadata.rating != 0),
        )
        .order_by(MemberRating.updated_at.desc())
        .limit(safe_limit)
        .all()
    )

    alerts = []
    for row in rows:
        author_email = str(row.share_guest_email or row.profile_email or "").strip() or None
        author_name = str(row.display_name or "").strip() or (author_email.split("@")[0] if author_email else "User")
        alerts.append({
            "event_id": str(row.event_id),
            "event_at": row.event_at.isoformat() if row.event_at else None,
            "asset_id": str(row.asset_id),
            "image_id": int(row.image_id) if row.image_id is not None else None,
            "filename": row.filename,
            "author_name": author_name,
            "author_email": author_email,
            "member_rating": int(row.member_rating) if row.member_rating is not None else None,
            "official_rating": int(row.official_rating) if row.official_rating is not None else None,
            "source": row.source,
            "action": "rated 0",
        })

    return {
        "alerts": alerts,
        "count": len(alerts),
    }
