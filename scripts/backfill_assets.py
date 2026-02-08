#!/usr/bin/env python3
"""Backfill assets from existing image_metadata.

Usage:
  python scripts/backfill_assets.py --tenant-id bcg --batch-size 500
  python scripts/backfill_assets.py --limit 1000 --dry-run
"""

from __future__ import annotations

import argparse
from typing import Optional, Tuple

from sqlalchemy.orm import Session

from photocat.database import SessionLocal
# Ensure auth models (user_profiles) are registered with SQLAlchemy metadata
import photocat.auth.models  # noqa: F401
from photocat.metadata import ImageMetadata, Asset


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill asset storage tables.")
    parser.add_argument("--tenant-id", help="Only backfill this tenant id.")
    parser.add_argument("--limit", type=int, help="Max number of images to process.")
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--dry-run", action="store_true", help="Do not commit changes.")
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


def already_backfilled(session: Session, tenant_id: str, provider: str, storage_key: str) -> bool:
    return (
        session.query(Asset)
        .filter(
            Asset.tenant_id == tenant_id,
            Asset.source_provider == provider,
            Asset.source_key == storage_key,
        )
        .count()
        > 0
    )


def backfill(session: Session, args: argparse.Namespace) -> None:
    processed = 0
    created = 0
    last_id: Optional[int] = None

    def build_batch_query():
        base_query = session.query(ImageMetadata)
        if args.tenant_id:
            base_query = base_query.filter(ImageMetadata.tenant_id == args.tenant_id)
        if last_id is not None:
            base_query = base_query.filter(ImageMetadata.id > last_id)
        return base_query.order_by(ImageMetadata.id)

    while True:
        remaining = None
        if args.limit:
            remaining = max(args.limit - processed, 0)
            if remaining == 0:
                break
        batch_limit = args.batch_size if remaining is None else min(args.batch_size, remaining)
        batch = build_batch_query().limit(batch_limit).all()
        if not batch:
            break

        for image in batch:
            provider, storage_key = resolve_storage_source(image)
            if already_backfilled(session, image.tenant_id, provider, storage_key):
                processed += 1
                last_id = image.id
                continue

            asset = Asset(
                tenant_id=image.tenant_id,
                filename=image.filename,
                source_provider=provider,
                source_key=storage_key,
                source_rev=None,
                thumbnail_key=resolve_thumbnail_key(image),
                mime_type=image.format,
                width=image.width,
                height=image.height,
                duration_ms=None,
            )
            session.add(asset)

            processed += 1
            created += 1
            last_id = image.id

        if args.dry_run:
            session.rollback()
        else:
            session.commit()
        session.expunge_all()
        print(f"Processed {processed}, created {created}")

    if args.dry_run:
        session.rollback()
    else:
        session.commit()
    print(f"Done. Processed {processed}, created {created}.")


def main() -> None:
    args = parse_args()
    session = SessionLocal()
    try:
        backfill(session, args)
    finally:
        session.close()


if __name__ == "__main__":
    main()
