"""Per-image member comments for authenticated app users."""

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from zoltag.auth.dependencies import require_tenant_permission_from_header
from zoltag.auth.models import UserProfile
from zoltag.dependencies import get_db, get_tenant
from zoltag.tenant import Tenant
from zoltag.metadata import ImageMetadata
from zoltag.models.sharing import ListShare, MemberComment, MemberRating
from zoltag.tenant_scope import tenant_column_filter

router = APIRouter()


class ImageCommentBody(BaseModel):
    comment_text: str


def _resolve_image_asset(image_id: int, tenant: Tenant, db: Session):
    image = db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        tenant_column_filter(ImageMetadata, tenant),
    ).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    if not image.asset_id:
        raise HTTPException(status_code=409, detail=f"Image {image_id} is not linked to an asset.")
    return image.asset_id


@router.get("/images/{image_id}/comments", response_model=dict, operation_id="list_image_comments")
async def list_image_comments(
    image_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(require_tenant_permission_from_header("image.rate")),
):
    """List all comments for one image asset in this tenant (newest first)."""
    asset_id = _resolve_image_asset(image_id, tenant, db)

    comments = (
        db.query(MemberComment)
        .filter(
            tenant_column_filter(MemberComment, tenant),
            MemberComment.asset_id == asset_id,
        )
        .order_by(MemberComment.created_at.desc())
        .all()
    )
    ratings = (
        db.query(MemberRating)
        .filter(
            tenant_column_filter(MemberRating, tenant),
            MemberRating.asset_id == asset_id,
        )
        .order_by(MemberRating.updated_at.desc())
        .all()
    )

    user_ids = {comment.user_uid for comment in comments if comment.user_uid}
    user_ids.update({rating.user_uid for rating in ratings if rating.user_uid})
    share_ids = {comment.share_id for comment in comments if comment.share_id is not None}
    share_ids.update({rating.share_id for rating in ratings if rating.share_id is not None})
    profile_map = {}
    share_email_map = {}
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
    if share_ids:
        share_rows = (
            db.query(ListShare.id, ListShare.guest_email)
            .filter(
                ListShare.id.in_(list(share_ids)),
                tenant_column_filter(ListShare, tenant),
            )
            .all()
        )
        share_email_map = {
            share_id: (guest_email or "").strip() or None
            for share_id, guest_email in share_rows
        }

    def _resolve_author(user_uid, share_id, source):
        source_value = str(source or "user").lower()
        profile = profile_map.get(user_uid, {})
        author_email = (
            profile.get("email")
            or share_email_map.get(share_id)
            or None
        )
        author_name = (
            profile.get("display_name")
            or profile.get("email")
            or ("Guest" if source_value == "guest" else "User")
        )
        return author_name, author_email

    comment_rows = []
    for comment in comments:
        source_value = str(comment.source or "user").lower()
        author_name, author_email = _resolve_author(comment.user_uid, comment.share_id, source_value)
        comment_rows.append({
            "id": str(comment.id),
            "asset_id": str(comment.asset_id),
            "comment_text": comment.comment_text,
            "author_name": author_name,
            "author_email": author_email,
            "can_delete": comment.user_uid == current_user.supabase_uid,
            "source": source_value,
            "created_at": comment.created_at.isoformat() if comment.created_at else None,
        })

    rating_rows = []
    for rating in ratings:
        source_value = str(rating.source or "user").lower()
        author_name, author_email = _resolve_author(rating.user_uid, rating.share_id, source_value)
        rating_rows.append({
            "id": str(rating.id),
            "asset_id": str(rating.asset_id),
            "rating": int(rating.rating) if rating.rating is not None else None,
            "author_name": author_name,
            "author_email": author_email,
            "source": source_value,
            "created_at": rating.created_at.isoformat() if rating.created_at else None,
            "updated_at": rating.updated_at.isoformat() if rating.updated_at else None,
        })

    return {
        "comments": comment_rows,
        "ratings": rating_rows,
    }


@router.post("/images/{image_id}/comments", response_model=dict, status_code=status.HTTP_201_CREATED, operation_id="create_image_comment")
async def create_image_comment(
    image_id: int,
    body: ImageCommentBody,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(require_tenant_permission_from_header("image.rate")),
):
    """Create a comment for one image asset."""
    comment_text = (body.comment_text or "").strip()
    if not comment_text:
        raise HTTPException(status_code=400, detail="comment_text cannot be empty.")

    asset_id = _resolve_image_asset(image_id, tenant, db)
    comment = MemberComment(
        tenant_id=tenant.id,
        asset_id=asset_id,
        user_uid=current_user.supabase_uid,
        comment_text=comment_text,
        source="user",
        share_id=None,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)

    author_name = (current_user.display_name or "").strip() or (current_user.email or "").strip() or "User"
    author_email = (current_user.email or "").strip() or None

    return {
        "id": str(comment.id),
        "asset_id": str(comment.asset_id),
        "comment_text": comment.comment_text,
        "author_name": author_name,
        "author_email": author_email,
        "can_delete": True,
        "created_at": comment.created_at.isoformat() if comment.created_at else None,
    }


@router.delete(
    "/images/{image_id}/comments/{comment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="delete_image_comment",
)
async def delete_image_comment(
    image_id: int,
    comment_id: str,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(require_tenant_permission_from_header("image.rate")),
):
    """Delete a comment for one image asset (author only)."""
    asset_id = _resolve_image_asset(image_id, tenant, db)
    comment = (
        db.query(MemberComment)
        .filter(
            tenant_column_filter(MemberComment, tenant),
            MemberComment.id == comment_id,
            MemberComment.asset_id == asset_id,
        )
        .first()
    )
    if not comment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found.")

    if comment.user_uid != current_user.supabase_uid:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only delete your own comments.")

    db.delete(comment)
    db.commit()
