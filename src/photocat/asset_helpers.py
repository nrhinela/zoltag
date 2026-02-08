"""Helpers for gradual migration from image_metadata storage fields to assets."""

from __future__ import annotations

import mimetypes
from dataclasses import dataclass
from typing import Dict, Iterable, Optional

from sqlalchemy.orm import Session

from photocat.metadata import Asset, ImageMetadata
from photocat.settings import settings
from photocat.tenant import Tenant


class AssetReadinessError(RuntimeError):
    """Raised when strict asset read requirements are not met."""


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


def resolve_image_storage(
    *,
    image: ImageMetadata,
    tenant: Tenant,
    db: Optional[Session] = None,
    assets_by_id: Optional[Dict[str, Asset]] = None,
    strict: Optional[bool] = None,
    require_thumbnail: bool = False,
    require_source: bool = False,
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

    thumbnail_url = tenant.get_thumbnail_url(settings, thumbnail_key)

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
                Asset.tenant_id == tenant.id,
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
        thumbnail_key = legacy_thumbnail_key or f"legacy:{tenant.id}:{image.id}:thumbnail"
        asset = Asset(
            tenant_id=tenant.id,
            filename=image.filename or f"image_{image.id}",
            source_provider=source_provider,
            source_key=source_key_value,
            source_rev=source_rev,
            thumbnail_key=thumbnail_key,
            mime_type=mime_type,
            width=image.width,
            height=image.height,
            duration_ms=None,
        )
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
