#!/usr/bin/env python3
"""Backfill image_metadata.asset_id by linking rows to assets.

Usage:
  python scripts/backfill_image_metadata_asset_id.py --tenant-id bcg --batch-size 500
  python scripts/backfill_image_metadata_asset_id.py --dry-run --limit 1000
  python scripts/backfill_image_metadata_asset_id.py --no-create-missing-assets
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from typing import Dict, Iterable, Optional, Set, Tuple

from sqlalchemy import text, tuple_
from sqlalchemy.orm import Session

from photocat.database import SessionLocal
import photocat.auth.models  # noqa: F401
from photocat.metadata import Asset, ImageMetadata


AssetLookup = Dict[Tuple[str, str, str], Asset]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill image_metadata.asset_id links.")
    parser.add_argument("--tenant-id", help="Only process this tenant id.")
    parser.add_argument("--limit", type=int, help="Max image_metadata rows to process.")
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--dry-run", action="store_true", help="Do not commit changes.")
    parser.add_argument(
        "--no-create-missing-assets",
        action="store_true",
        help="Do not create Asset rows for unmatched image_metadata rows.",
    )
    parser.add_argument(
        "--validate-fk",
        action="store_true",
        help="Validate fk_image_metadata_asset_id_assets after successful run.",
    )
    return parser.parse_args()


def resolve_storage_source(image: ImageMetadata) -> Tuple[str, str]:
    dropbox_path = (getattr(image, "dropbox_path", None) or "").strip()
    if dropbox_path:
        provider = "local" if dropbox_path.startswith("/local/") else "dropbox"
        return provider, dropbox_path
    if image.asset_id is not None:
        return "unknown", f"linked-asset:{image.asset_id}"
    return "unknown", f"legacy:{image.tenant_id}:{image.id}"


def resolve_thumbnail_key(image: ImageMetadata) -> str:
    thumbnail_path = (getattr(image, "thumbnail_path", None) or "").strip()
    if thumbnail_path:
        return thumbnail_path
    if image.asset_id is not None:
        return f"linked-asset:{image.asset_id}:thumbnail"
    return f"legacy:{image.tenant_id}:{image.id}:thumbnail"


def batch_query(session: Session, args: argparse.Namespace, last_id: Optional[int], batch_limit: int):
    query = session.query(ImageMetadata).filter(ImageMetadata.asset_id.is_(None))
    if args.tenant_id:
        query = query.filter(ImageMetadata.tenant_id == args.tenant_id)
    if last_id is not None:
        query = query.filter(ImageMetadata.id > last_id)
    return query.order_by(ImageMetadata.id).limit(batch_limit).all()


def load_asset_lookup(session: Session, images: Iterable[ImageMetadata]) -> AssetLookup:
    by_tenant: Dict[str, Set[Tuple[str, str]]] = defaultdict(set)
    for image in images:
        provider, source_key = resolve_storage_source(image)
        by_tenant[image.tenant_id].add((provider, source_key))

    lookup: AssetLookup = {}
    for tenant_id, pairs in by_tenant.items():
        if not pairs:
            continue
        rows = (
            session.query(Asset)
            .filter(
                Asset.tenant_id == tenant_id,
                tuple_(Asset.source_provider, Asset.source_key).in_(list(pairs)),
            )
            .order_by(Asset.created_at.asc(), Asset.id.asc())
            .all()
        )
        for row in rows:
            lookup.setdefault((tenant_id, row.source_provider, row.source_key), row)
    return lookup


def create_asset_for_image(session: Session, image: ImageMetadata, provider: str, source_key: str) -> Asset:
    asset = Asset(
        tenant_id=image.tenant_id,
        filename=(image.filename or "").strip() or f"image-{image.id}",
        source_provider=provider,
        source_key=source_key,
        source_rev=None,
        thumbnail_key=resolve_thumbnail_key(image),
        mime_type=image.format,
        width=image.width,
        height=image.height,
        duration_ms=None,
    )
    session.add(asset)
    session.flush()
    return asset


def backfill(session: Session, args: argparse.Namespace) -> None:
    processed = 0
    linked = 0
    created_assets = 0
    missing_assets = 0
    last_id: Optional[int] = None
    allow_create = not args.no_create_missing_assets

    while True:
        remaining = None
        if args.limit:
            remaining = max(args.limit - processed, 0)
            if remaining == 0:
                break
        batch_limit = args.batch_size if remaining is None else min(args.batch_size, remaining)
        batch = batch_query(session, args, last_id, batch_limit)
        if not batch:
            break

        lookup = load_asset_lookup(session, batch)

        for image in batch:
            provider, source_key = resolve_storage_source(image)
            lookup_key = (image.tenant_id, provider, source_key)
            asset = lookup.get(lookup_key)
            if asset is None and allow_create:
                asset = create_asset_for_image(session, image, provider, source_key)
                lookup[lookup_key] = asset
                created_assets += 1
            if asset is None:
                missing_assets += 1
            else:
                image.asset_id = asset.id
                linked += 1

            processed += 1
            last_id = image.id

        if args.dry_run:
            session.rollback()
        else:
            session.commit()
        session.expunge_all()
        print(
            f"Processed={processed} Linked={linked} "
            f"CreatedAssets={created_assets} MissingAssets={missing_assets}"
        )

    if args.dry_run:
        session.rollback()
    else:
        session.commit()
        if args.validate_fk:
            session.execute(
                text("ALTER TABLE image_metadata VALIDATE CONSTRAINT fk_image_metadata_asset_id_assets")
            )
            session.commit()

    print(
        f"Done. Processed={processed} Linked={linked} "
        f"CreatedAssets={created_assets} MissingAssets={missing_assets}"
    )


def main() -> None:
    args = parse_args()
    session = SessionLocal()
    try:
        backfill(session, args)
    finally:
        session.close()


if __name__ == "__main__":
    main()
