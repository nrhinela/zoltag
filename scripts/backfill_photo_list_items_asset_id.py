#!/usr/bin/env python3
"""Backfill photo_list_items.asset_id from image_metadata.asset_id.

Usage:
  python scripts/backfill_photo_list_items_asset_id.py --tenant-id bcg --batch-size 500
  python scripts/backfill_photo_list_items_asset_id.py --dry-run --limit 1000
  python scripts/backfill_photo_list_items_asset_id.py --update-mismatched
"""

from __future__ import annotations

import argparse
from typing import Optional

from sqlalchemy.orm import Session

from photocat.database import SessionLocal
import photocat.auth.models  # noqa: F401  # Ensure user_profiles table is registered
from photocat.metadata import ImageMetadata
from photocat.models.config import PhotoList, PhotoListItem


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill photo_list_items.asset_id.")
    parser.add_argument("--tenant-id", help="Only process list items for this tenant id.")
    parser.add_argument("--list-id", type=int, help="Only process a single photo list.")
    parser.add_argument("--limit", type=int, help="Max number of list items to process.")
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--dry-run", action="store_true", help="Do not commit changes.")
    parser.add_argument(
        "--update-mismatched",
        action="store_true",
        help="Also update rows where asset_id is set but differs from image_metadata.asset_id.",
    )
    return parser.parse_args()


def batch_query(
    session: Session,
    args: argparse.Namespace,
    *,
    last_id: Optional[int],
    batch_limit: int,
):
    query = (
        session.query(
            PhotoListItem,
            ImageMetadata.id.label("image_id_ref"),
            ImageMetadata.asset_id.label("image_asset_id"),
        )
        .outerjoin(ImageMetadata, ImageMetadata.id == PhotoListItem.photo_id)
        .join(PhotoList, PhotoList.id == PhotoListItem.list_id)
    )

    if args.tenant_id:
        query = query.filter(PhotoList.tenant_id == args.tenant_id)
    if args.list_id:
        query = query.filter(PhotoListItem.list_id == args.list_id)
    if last_id is not None:
        query = query.filter(PhotoListItem.id > last_id)

    if not args.update_mismatched:
        query = query.filter(PhotoListItem.asset_id.is_(None))

    return query.order_by(PhotoListItem.id.asc()).limit(batch_limit).all()


def backfill(session: Session, args: argparse.Namespace) -> None:
    processed = 0
    updated = 0
    already_correct = 0
    mismatched_skipped = 0
    missing_image = 0
    missing_image_asset = 0
    last_id: Optional[int] = None

    while True:
        remaining = None
        if args.limit:
            remaining = max(args.limit - processed, 0)
            if remaining == 0:
                break
        batch_limit = args.batch_size if remaining is None else min(args.batch_size, remaining)
        batch = batch_query(session, args, last_id=last_id, batch_limit=batch_limit)
        if not batch:
            break

        for item, image_id_ref, image_asset_id in batch:
            processed += 1
            last_id = item.id

            if image_id_ref is None:
                missing_image += 1
                continue

            if image_asset_id is None:
                missing_image_asset += 1
                continue

            if item.asset_id == image_asset_id:
                already_correct += 1
                continue

            if item.asset_id is not None and not args.update_mismatched:
                mismatched_skipped += 1
                continue

            item.asset_id = image_asset_id
            updated += 1

        if args.dry_run:
            session.rollback()
        else:
            session.commit()
        session.expunge_all()
        print(
            f"Processed={processed} Updated={updated} AlreadyCorrect={already_correct} "
            f"MissingImage={missing_image} MissingImageAsset={missing_image_asset} "
            f"MismatchedSkipped={mismatched_skipped}"
        )

    if args.dry_run:
        session.rollback()
    else:
        session.commit()

    print(
        f"Done. Processed={processed} Updated={updated} AlreadyCorrect={already_correct} "
        f"MissingImage={missing_image} MissingImageAsset={missing_image_asset} "
        f"MismatchedSkipped={mismatched_skipped}"
    )


def main() -> None:
    args = parse_args()
    session = SessionLocal()
    try:
        if not hasattr(PhotoListItem, "photo_id"):
            print("photo_list_items.photo_id no longer exists; nothing to backfill.")
            return
        backfill(session, args)
    finally:
        session.close()


if __name__ == "__main__":
    main()
