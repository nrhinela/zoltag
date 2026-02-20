"""Helpers for gradual migration from image_metadata storage fields to assets."""

from __future__ import annotations

from datetime import datetime, timezone
import mimetypes
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional

from sqlalchemy.orm import Session

from zoltag.metadata import Asset, ImageMetadata
from zoltag.settings import settings
from zoltag.tenant import Tenant
from zoltag.tenant_scope import assign_tenant_scope, tenant_column_filter


class AssetReadinessError(RuntimeError):
    """Raised when strict asset read requirements are not met."""


def _cache_bust_token(value: Optional[datetime]) -> Optional[str]:
    """Build a stable unix-milliseconds token for cache-busting query params."""
    if value is None:
        return None
    dt = value
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return str(int(dt.timestamp() * 1000))


def _append_cache_bust(url: Optional[str], token: Optional[str]) -> Optional[str]:
    if not url or not token:
        return url
    # Signed URLs (GCS V4) already include an expiry — appending extra params breaks the signature
    if "X-Goog-Signature" in url:
        return url
    separator = "&" if "?" in url else "?"
    return f"{url}{separator}v={token}"


@dataclass
class ResolvedImageStorage:
    """Resolved storage info for an image, preferring Asset fields when available."""

    asset: Optional[Asset]
    asset_id: Optional[str]
    thumbnail_key: Optional[str]
    thumbnail_url: Optional[str]
    source_provider: Optional[str]
    source_key: Optional[str]
    source_rev: Optional[str]


def load_assets_for_images(db: Session, images: Iterable[ImageMetadata]) -> Dict[str, Asset]:
    """Bulk load assets referenced by a collection of ImageMetadata rows."""
    asset_ids = []
    for image in images:
        if image.asset_id is not None:
            asset_ids.append(image.asset_id)
    if not asset_ids:
        return {}
    assets = db.query(Asset).filter(Asset.id.in_(asset_ids)).all()
    return {str(asset.id): asset for asset in assets}


def bulk_preload_thumbnail_urls(
    images: List[ImageMetadata],
    tenant: Tenant,
    assets_by_id: Dict[str, "Asset"],
) -> Dict[int, Optional[str]]:
    """Pre-sign thumbnail URLs for a batch of images in parallel.

    Returns a dict of image.id -> thumbnail_url. Pass the result to
    resolve_image_storage via the preloaded_urls parameter to skip
    per-image signing.
    """
    # Collect thumbnail keys per image
    keys_by_image_id: Dict[int, Optional[str]] = {}
    for image in images:
        asset = assets_by_id.get(str(image.asset_id)) if image.asset_id is not None else None
        legacy_thumbnail = getattr(image, "thumbnail_path", None)
        thumbnail_key = (asset.thumbnail_key if asset else None) or legacy_thumbnail
        keys_by_image_id[image.id] = thumbnail_key

    unique_keys = [k for k in set(keys_by_image_id.values()) if k]
    signed = tenant.bulk_sign_thumbnail_urls(settings, unique_keys)

    result: Dict[int, Optional[str]] = {}
    for image in images:
        key = keys_by_image_id.get(image.id)
        url = signed.get(key) if key else None
        # Apply cache busting for non-signed URLs
        if url and "X-Goog-Signature" not in url:
            asset = assets_by_id.get(str(image.asset_id)) if image.asset_id is not None else None
            token = (
                _cache_bust_token(getattr(image, "last_processed", None))
                or _cache_bust_token(getattr(asset, "updated_at", None) if asset else None)
                or _cache_bust_token(getattr(image, "modified_time", None))
            )
            url = _append_cache_bust(url, token)
        result[image.id] = url
    return result


def resolve_image_storage(
    *,
    image: ImageMetadata,
    tenant: Tenant,
    db: Optional[Session] = None,
    assets_by_id: Optional[Dict[str, Asset]] = None,
    strict: Optional[bool] = None,
    require_thumbnail: bool = False,
    require_source: bool = False,
    preloaded_thumbnail_url: Optional[str] = None,
) -> ResolvedImageStorage:
    """Resolve image storage fields with Asset-first fallback behavior."""
    strict_mode = settings.asset_strict_reads if strict is None else strict

    asset = None
    asset_id_str = str(image.asset_id) if image.asset_id is not None else None
    if asset_id_str and assets_by_id is not None:
        asset = assets_by_id.get(asset_id_str)
    elif asset_id_str and db is not None:
        asset = db.query(Asset).filter(Asset.id == image.asset_id).first()

    if strict_mode and asset is None:
        raise AssetReadinessError(
            f"Image {image.id} is not fully migrated to assets (missing asset row for asset_id={asset_id_str})."
        )

    legacy_thumbnail = getattr(image, "thumbnail_path", None)
    legacy_source_key = getattr(image, "dropbox_path", None)

    if strict_mode:
        thumbnail_key = (asset.thumbnail_key if asset else None)
        source_provider = asset.source_provider if asset else None
        source_key = asset.source_key if asset else None
        source_rev = asset.source_rev if asset else None
    else:
        thumbnail_key = (asset.thumbnail_key if asset else None) or legacy_thumbnail
        source_provider = asset.source_provider if asset else None
        source_key = asset.source_key if asset else legacy_source_key
        source_rev = asset.source_rev if asset else None

    if strict_mode and require_thumbnail and not (thumbnail_key or "").strip():
        raise AssetReadinessError(f"Image {image.id} asset has no thumbnail_key.")
    if strict_mode and require_source:
        if not (source_provider or "").strip() or not (source_key or "").strip():
            raise AssetReadinessError(f"Image {image.id} asset has no source provider/key.")

    if preloaded_thumbnail_url is not None:
        thumbnail_url = preloaded_thumbnail_url
    else:
        thumbnail_url = tenant.get_thumbnail_url(settings, thumbnail_key)
        cache_token = (
            _cache_bust_token(getattr(image, "last_processed", None))
            or _cache_bust_token(getattr(asset, "updated_at", None) if asset is not None else None)
            or _cache_bust_token(getattr(image, "modified_time", None))
        )
        thumbnail_url = _append_cache_bust(thumbnail_url, cache_token)

    return ResolvedImageStorage(
        asset=asset,
        asset_id=str(asset.id) if asset else asset_id_str,
        thumbnail_key=thumbnail_key,
        thumbnail_url=thumbnail_url,
        source_provider=source_provider,
        source_key=source_key,
        source_rev=source_rev,
    )


def ensure_asset_for_image(
    *,
    db: Session,
    image: ImageMetadata,
    tenant: Tenant,
    source_provider: str = "dropbox",
    source_key: Optional[str] = None,
    source_rev: Optional[str] = None,
) -> Asset:
    """Create or update an Asset row from image metadata and link image.asset_id."""
    legacy_source_key = getattr(image, "dropbox_path", None)
    legacy_thumbnail_key = getattr(image, "thumbnail_path", None)

    source_key_value = (source_key or legacy_source_key or "").strip()
    if not source_key_value:
        source_key_value = f"legacy:image_metadata:{image.id}"

    asset = None
    if image.asset_id is not None:
        asset = db.query(Asset).filter(Asset.id == image.asset_id).first()

    if asset is None:
        asset = (
            db.query(Asset)
            .filter(
                tenant_column_filter(Asset, tenant),
                Asset.source_provider == source_provider,
                Asset.source_key == source_key_value,
            )
            .order_by(Asset.created_at.asc(), Asset.id.asc())
            .first()
        )

    guessed_mime = mimetypes.guess_type(image.filename or "")[0]
    mime_type = guessed_mime
    if not mime_type and image.format:
        mime_type = f"image/{str(image.format).lower()}"

    if asset is None:
        thumbnail_key = legacy_thumbnail_key or f"legacy:{tenant.secret_scope}:{image.id}:thumbnail"
        asset = assign_tenant_scope(Asset(
            filename=image.filename or f"image_{image.id}",
            source_provider=source_provider,
            source_key=source_key_value,
            source_rev=source_rev,
            thumbnail_key=thumbnail_key,
            mime_type=mime_type,
            width=image.width,
            height=image.height,
            duration_ms=None,
        ), tenant)
        db.add(asset)
        db.flush()
    else:
        if image.filename and (not asset.filename or asset.filename.startswith("image_")):
            asset.filename = image.filename
        if source_rev:
            asset.source_rev = source_rev
        if legacy_thumbnail_key:
            asset.thumbnail_key = legacy_thumbnail_key
        if asset.mime_type is None:
            asset.mime_type = mime_type
        if asset.width is None and image.width is not None:
            asset.width = image.width
        if asset.height is None and image.height is not None:
            asset.height = image.height

    if image.asset_id != asset.id:
        image.asset_id = asset.id

    return asset
