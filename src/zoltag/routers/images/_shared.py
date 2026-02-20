"""Shared utilities for image router modules."""

from typing import Optional
from urllib.parse import quote
from fastapi import HTTPException
from sqlalchemy.orm import Session

from zoltag.auth.models import UserProfile
from zoltag.asset_helpers import AssetReadinessError, resolve_image_storage
from zoltag.tenant import Tenant
from zoltag.metadata import Asset, AssetDerivative, ImageMetadata
from zoltag.models.config import Keyword
from zoltag.settings import settings
from zoltag.tenant_scope import tenant_column_filter


def _serialize_asset_variant(
    image_id: int,
    variant: AssetDerivative,
    tenant: Tenant,
    file_size_bytes: Optional[int] = None,
    created_by_name: Optional[str] = None,
) -> dict:
    bucket = tenant.get_storage_bucket(settings)
    public_url = None
    if variant.storage_key:
        encoded_key = quote(variant.storage_key, safe="/")
        public_url = f"https://storage.googleapis.com/{bucket}/{encoded_key}"
    return {
        "id": str(variant.id),
        "asset_id": str(variant.asset_id),
        "storage_key": variant.storage_key,
        "public_url": public_url,
        "filename": variant.filename,
        "variant": variant.variant,
        "created_by": str(variant.created_by) if variant.created_by else None,
        "created_by_name": created_by_name,
        "file_size_bytes": file_size_bytes,
        "created_at": variant.created_at.isoformat() if variant.created_at else None,
        "updated_at": variant.updated_at.isoformat() if variant.updated_at else None,
        "deleted_at": variant.deleted_at.isoformat() if variant.deleted_at else None,
        "content_url": f"/api/v1/images/{image_id}/asset-variants/{variant.id}/content",
    }


def _user_display_name_from_fields(display_name: Optional[str], email: Optional[str]) -> Optional[str]:
    name = (display_name or "").strip()
    if name:
        return name
    email_value = (email or "").strip()
    if not email_value:
        return None
    return email_value.split("@")[0] if "@" in email_value else email_value


def _build_user_name_map(db: Session, user_ids: set) -> dict:
    if not user_ids:
        return {}
    rows = db.query(
        UserProfile.supabase_uid,
        UserProfile.display_name,
        UserProfile.email,
    ).filter(UserProfile.supabase_uid.in_(list(user_ids))).all()
    mapping = {}
    for supabase_uid, display_name, email in rows:
        mapping[str(supabase_uid)] = _user_display_name_from_fields(display_name, email)
    return mapping


def _get_image_and_asset_or_409(db: Session, tenant: Tenant, image_id: int):
    image = db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        tenant_column_filter(ImageMetadata, tenant),
    ).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    if image.asset_id is None:
        raise HTTPException(status_code=409, detail=f"Image {image_id} is not linked to an asset.")

    asset = db.query(Asset).filter(
        Asset.id == image.asset_id,
        tenant_column_filter(Asset, tenant),
    ).first()
    if not asset:
        raise HTTPException(
            status_code=409,
            detail=f"Asset {image.asset_id} for image {image_id} is missing.",
        )
    return image, asset


def _resolve_storage_or_409(
    *,
    image: ImageMetadata,
    tenant: Tenant,
    db: Session,
    require_thumbnail: bool = False,
    require_source: bool = False,
    assets_by_id: Optional[dict] = None,
    preloaded_urls: Optional[dict] = None,
):
    try:
        return resolve_image_storage(
            image=image,
            tenant=tenant,
            db=None if assets_by_id is not None else db,
            assets_by_id=assets_by_id,
            strict=settings.asset_strict_reads,
            require_thumbnail=require_thumbnail,
            require_source=require_source,
            preloaded_thumbnail_url=preloaded_urls.get(image.id) if preloaded_urls else None,
        )
    except AssetReadinessError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


def _resolve_dropbox_ref(storage_info, image: ImageMetadata) -> Optional[str]:
    """Resolve Dropbox reference from asset storage info, with legacy fallback."""
    dropbox_ref = None
    if storage_info.source_provider in (None, "dropbox"):
        source_key = (storage_info.source_key or "").strip()
        if source_key:
            dropbox_ref = source_key

    legacy_dropbox_path = (getattr(image, "dropbox_path", None) or "").strip()
    legacy_dropbox_id = (getattr(image, "dropbox_id", None) or "").strip()
    if not dropbox_ref and legacy_dropbox_path:
        dropbox_ref = legacy_dropbox_path
    if not dropbox_ref and legacy_dropbox_id and not legacy_dropbox_id.startswith("local_"):
        dropbox_ref = legacy_dropbox_id if legacy_dropbox_id.startswith("id:") else f"id:{legacy_dropbox_id}"

    if not dropbox_ref:
        return None
    if dropbox_ref.startswith("/local/"):
        return None
    if legacy_dropbox_id.startswith("local_"):
        return None
    return dropbox_ref


def _resolve_provider_ref(storage_info, image: ImageMetadata) -> tuple[str, Optional[str]]:
    """Resolve source reference for the active provider with legacy Dropbox fallback."""
    provider_name = (storage_info.source_provider or "dropbox").strip().lower()
    source_key = (storage_info.source_key or "").strip()

    if provider_name == "dropbox":
        return provider_name, _resolve_dropbox_ref(storage_info, image)

    if source_key and not source_key.startswith("/local/"):
        return provider_name, source_key

    return provider_name, None


def _build_source_url(storage_info, tenant: Tenant, image: Optional[ImageMetadata] = None) -> Optional[str]:
    """Build a best-effort browser URL for the original source object."""
    provider_name, source_ref = _resolve_provider_ref(storage_info, image)
    if not source_ref:
        return None

    if provider_name == "dropbox":
        # Dropbox home links require path-based refs; file IDs do not map cleanly.
        if source_ref.startswith("id:"):
            return None
        normalized_path = source_ref if source_ref.startswith("/") else f"/{source_ref}"
        return f"https://www.dropbox.com/home{quote(normalized_path, safe='/')}"

    if provider_name in {"managed", "local"}:
        bucket = tenant.get_storage_bucket(settings)
        return f"https://storage.googleapis.com/{bucket}/{quote(source_ref, safe='/')}"

    if provider_name in {"gdrive", "google-drive", "google_drive", "drive"}:
        if source_ref.startswith(("http://", "https://")):
            return source_ref
        return f"https://drive.google.com/file/d/{quote(source_ref, safe='')}/view"

    if source_ref.startswith(("http://", "https://")):
        return source_ref

    return None


def _extract_dropbox_tag_text(tag_obj) -> Optional[str]:
    """Best-effort extraction of a Dropbox tag string from SDK objects."""
    if tag_obj is None:
        return None

    # Dropbox SDK union shape: Tag.user_generated_tag(UserGeneratedTag)
    try:
        if hasattr(tag_obj, "is_user_generated_tag") and tag_obj.is_user_generated_tag():
            user_tag = tag_obj.get_user_generated_tag()
            tag_text = (getattr(user_tag, "tag_text", None) or "").strip()
            if tag_text:
                return tag_text
    except Exception:
        pass

    # Defensive fallbacks for alternate object shapes.
    nested = getattr(tag_obj, "tag", None)
    if nested is not None:
        nested_text = (getattr(nested, "tag_text", None) or "").strip()
        if nested_text:
            return nested_text

    direct_text = (getattr(tag_obj, "tag_text", None) or "").strip()
    if direct_text:
        return direct_text
    return None


def get_keyword_name(db: Session, keyword_id: int) -> Optional[str]:
    """Get keyword name from keyword_id."""
    keyword = db.query(Keyword.keyword).filter(Keyword.id == keyword_id).first()
    return keyword[0] if keyword else None


def get_keyword_category_name(db: Session, keyword_id: int) -> Optional[str]:
    """Get category name from keyword_id via the keyword's category_id."""
    from zoltag.models.config import KeywordCategory
    result = db.query(KeywordCategory.name).join(
        Keyword, Keyword.category_id == KeywordCategory.id
    ).filter(Keyword.id == keyword_id).first()
    return result[0] if result else None
