#!/usr/bin/env python3
"""Backfill image_embeddings.asset_id from image_metadata.asset_id.

Uses set-based SQL UPDATEs for speed.

Usage:
  python scripts/backfill_image_embeddings_asset_id.py --tenant-id bcg --batch-size 5000
  python scripts/backfill_image_embeddings_asset_id.py --dry-run
  python scripts/backfill_image_embeddings_asset_id.py --update-mismatched
  python scripts/backfill_image_embeddings_asset_id.py --validate-fk
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from photocat.database import SessionLocal


@dataclass
class BackfillStats:
    processed: int = 0
    updated: int = 0
    already_correct: int = 0
    mismatched_skipped: int = 0
    missing_image: int = 0
    missing_image_asset: int = 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill image_embeddings.asset_id.")
    parser.add_argument("--tenant-id", help="Only process rows for this tenant id.")
    parser.add_argument("--limit", type=int, help="Max rows to process.")
    parser.add_argument("--batch-size", type=int, default=5000)
    parser.add_argument("--dry-run", action="store_true", help="Do not commit changes.")
    parser.add_argument(
        "--update-mismatched",
        action="store_true",
        help="Also update rows where asset_id is set but differs from image_metadata.asset_id.",
    )
    parser.add_argument(
        "--validate-fk",
        action="store_true",
        help="Validate fk_image_embeddings_asset_id_assets after successful run.",
    )
    return parser.parse_args()


def _scalar(session: Session, sql: str, params: dict) -> int:
    value = session.execute(text(sql), params).scalar()
    return int(value or 0)


def _collect_stats(
    session: Session,
    *,
    tenant_id: Optional[str],
    update_mismatched: bool,
    limit: Optional[int],
) -> BackfillStats:
    tenant_clause = "AND ie.tenant_id = :tenant_id" if tenant_id else ""
    params = {"tenant_id": tenant_id} if tenant_id else {}

    stats = BackfillStats()

    stats.missing_image = _scalar(
        session,
        f"""
        SELECT count(*)
        FROM image_embeddings ie
        LEFT JOIN image_metadata im ON im.id = ie.image_id
        WHERE im.id IS NULL
        {tenant_clause}
        """,
        params,
    )

    stats.missing_image_asset = _scalar(
        session,
        f"""
        SELECT count(*)
        FROM image_embeddings ie
        JOIN image_metadata im ON im.id = ie.image_id
        WHERE im.asset_id IS NULL
        {tenant_clause}
        """,
        params,
    )

    stats.already_correct = _scalar(
        session,
        f"""
        SELECT count(*)
        FROM image_embeddings ie
        JOIN image_metadata im ON im.id = ie.image_id
        WHERE im.asset_id IS NOT NULL
          AND ie.asset_id = im.asset_id
        {tenant_clause}
        """,
        params,
    )

    mismatched = _scalar(
        session,
        f"""
        SELECT count(*)
        FROM image_embeddings ie
        JOIN image_metadata im ON im.id = ie.image_id
        WHERE im.asset_id IS NOT NULL
          AND ie.asset_id IS NOT NULL
          AND ie.asset_id IS DISTINCT FROM im.asset_id
        {tenant_clause}
        """,
        params,
    )
    stats.mismatched_skipped = 0 if update_mismatched else mismatched

    eligible_clause = "ie.asset_id IS DISTINCT FROM im.asset_id" if update_mismatched else "ie.asset_id IS NULL"
    stats.processed = _scalar(
        session,
        f"""
        SELECT count(*)
        FROM image_embeddings ie
        JOIN image_metadata im ON im.id = ie.image_id
        WHERE im.asset_id IS NOT NULL
          AND {eligible_clause}
        {tenant_clause}
        """,
        params,
    )
    if limit is not None:
        stats.processed = min(stats.processed, max(limit, 0))

    return stats


def _run_backfill(
    session: Session,
    *,
    tenant_id: Optional[str],
    limit: Optional[int],
    batch_size: int,
    dry_run: bool,
    update_mismatched: bool,
) -> BackfillStats:
    stats = _collect_stats(
        session,
        tenant_id=tenant_id,
        update_mismatched=update_mismatched,
        limit=limit,
    )
    if stats.processed == 0:
        return stats

    eligible_clause = "ie.asset_id IS DISTINCT FROM im.asset_id" if update_mismatched else "ie.asset_id IS NULL"
    tenant_clause = "AND ie.tenant_id = :tenant_id" if tenant_id else ""
    remaining = stats.processed
    last_id: Optional[int] = None

    while remaining > 0:
        current_limit = min(batch_size, remaining)
        last_id_clause = "AND ie.id > :last_id" if last_id is not None else ""
        sql = f"""
        WITH candidate AS (
            SELECT ie.id, im.asset_id
            FROM image_embeddings ie
            JOIN image_metadata im ON im.id = ie.image_id
            WHERE im.asset_id IS NOT NULL
              AND {eligible_clause}
              {tenant_clause}
              {last_id_clause}
            ORDER BY ie.id ASC
            LIMIT :batch_limit
        ),
        updated AS (
            UPDATE image_embeddings ie
            SET asset_id = c.asset_id
            FROM candidate c
            WHERE ie.id = c.id
            RETURNING ie.id
        )
        SELECT id FROM updated ORDER BY id ASC
        """

        params = {"batch_limit": current_limit}
        if tenant_id:
            params["tenant_id"] = tenant_id
        if last_id is not None:
            params["last_id"] = last_id

        updated_ids = [row[0] for row in session.execute(text(sql), params).all()]
        if not updated_ids:
            if dry_run:
                session.rollback()
            else:
                session.commit()
            break

        stats.updated += len(updated_ids)
        last_id = int(updated_ids[-1])
        remaining -= len(updated_ids)

        if dry_run:
            session.rollback()
        else:
            session.commit()

        print(
            f"Processed={stats.processed - remaining} Updated={stats.updated} "
            f"AlreadyCorrect={stats.already_correct} MissingImage={stats.missing_image} "
            f"MissingImageAsset={stats.missing_image_asset} "
            f"MismatchedSkipped={stats.mismatched_skipped}"
        )

    return stats


def _validate_fk(session: Session) -> None:
    session.execute(text("SET LOCAL statement_timeout = 0"))
    session.execute(text("SET LOCAL lock_timeout = '5s'"))
    session.execute(
        text("ALTER TABLE image_embeddings VALIDATE CONSTRAINT fk_image_embeddings_asset_id_assets")
    )
    session.commit()


def main() -> None:
    args = parse_args()
    session = SessionLocal()
    try:
        stats = _run_backfill(
            session,
            tenant_id=args.tenant_id,
            limit=args.limit,
            batch_size=args.batch_size,
            dry_run=args.dry_run,
            update_mismatched=args.update_mismatched,
        )
        if args.validate_fk and not args.dry_run:
            _validate_fk(session)
            print("Validated constraint: fk_image_embeddings_asset_id_assets")

        print(
            f"Done. Processed={stats.processed} Updated={stats.updated} "
            f"AlreadyCorrect={stats.already_correct} MissingImage={stats.missing_image} "
            f"MissingImageAsset={stats.missing_image_asset} "
            f"MismatchedSkipped={stats.mismatched_skipped}"
        )
    finally:
        session.close()


if __name__ == "__main__":
    main()
