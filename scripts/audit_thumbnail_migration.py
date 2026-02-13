#!/usr/bin/env python3
"""Audit old vs new thumbnails and build a review queue.

This script compares:
- old thumbnail: image_metadata.thumbnail_path
- new thumbnail: assets.thumbnail_key (via image_metadata.asset_id)

It stores per-image audit results in thumbnail_migration_audit and can export
a CSV of review candidates prioritized by tagging volume.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
from pathlib import Path
from typing import Dict, Iterable, Optional, Set, Tuple

import imagehash
from google.api_core.exceptions import NotFound
from google.cloud import storage
from PIL import Image, UnidentifiedImageError
from sqlalchemy import func, literal, text
from sqlalchemy.orm import Session

from zoltag.database import SessionLocal
from zoltag.metadata import Asset, ImageMetadata, MachineTag, Permatag, Tenant
from zoltag.settings import settings


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit thumbnail migration differences.")
    parser.add_argument("--tenant-id", help="Only audit this tenant id.")
    parser.add_argument("--limit", type=int, help="Max image_metadata rows to process.")
    parser.add_argument("--batch-size", type=int, default=200)
    parser.add_argument(
        "--phash-threshold",
        type=int,
        default=10,
        help="Hamming distance threshold for visual-difference flagging.",
    )
    parser.add_argument(
        "--export-csv",
        help="Optional output path for review candidates CSV (e.g. /tmp/review.csv).",
    )
    parser.add_argument(
        "--only-needs-review",
        action="store_true",
        help="When exporting, include only rows where needs_review=true.",
    )
    parser.add_argument(
        "--export-limit",
        type=int,
        default=5000,
        help="Max rows to export to CSV.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Do not write audit rows.")
    return parser.parse_args()


def resolve_thumbnail_bucket_name(tenant_row: Optional[Tenant]) -> str:
    if tenant_row and tenant_row.thumbnail_bucket:
        return tenant_row.thumbnail_bucket
    if tenant_row and tenant_row.storage_bucket:
        return tenant_row.storage_bucket
    return settings.thumbnail_bucket


def compute_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def compute_phash_hex(data: bytes) -> str:
    with Image.open(io.BytesIO(data)) as image:
        return str(imagehash.phash(image.convert("RGB")))


def phash_distance(old_phash: Optional[str], new_phash: Optional[str]) -> Optional[int]:
    if not old_phash or not new_phash:
        return None
    try:
        return (int(old_phash, 16) ^ int(new_phash, 16)).bit_count()
    except ValueError:
        return None


def fetch_blob_bytes(
    storage_client: storage.Client, bucket_name: str, object_key: Optional[str]
) -> Tuple[bool, Optional[bytes], Optional[str]]:
    key = (object_key or "").strip()
    if not key:
        return False, None, None
    try:
        data = storage_client.bucket(bucket_name).blob(key).download_as_bytes()
        return True, data, None
    except NotFound:
        return False, None, None
    except Exception as exc:  # pragma: no cover - external service behavior
        return False, None, str(exc)


def load_tenant_bucket_map(session: Session, tenant_ids: Set[str]) -> Dict[str, str]:
    rows = session.query(Tenant).filter(Tenant.id.in_(list(tenant_ids))).all()
    by_id = {row.id: row for row in rows}
    return {tenant_id: resolve_thumbnail_bucket_name(by_id.get(tenant_id)) for tenant_id in tenant_ids}


def load_shared_old_key_counts(
    session: Session, tenant_ids: Set[str], old_keys: Set[str], include_legacy_columns: bool
) -> Dict[Tuple[str, str], int]:
    if not include_legacy_columns or not tenant_ids or not old_keys:
        return {}
    rows = (
        session.query(
            ImageMetadata.tenant_id,
            ImageMetadata.thumbnail_path,
            func.count(ImageMetadata.id),
        )
        .filter(
            ImageMetadata.tenant_id.in_(list(tenant_ids)),
            ImageMetadata.thumbnail_path.in_(list(old_keys)),
        )
        .group_by(ImageMetadata.tenant_id, ImageMetadata.thumbnail_path)
        .all()
    )
    return {(tenant_id, old_key): int(count) for tenant_id, old_key, count in rows}


def load_tag_counts(session: Session, image_ids: Iterable[int]) -> Tuple[Dict[int, int], Dict[int, int]]:
    ids = list(image_ids)
    if not ids:
        return {}, {}

    image_asset_rows = (
        session.query(ImageMetadata.id, ImageMetadata.asset_id)
        .filter(ImageMetadata.id.in_(ids))
        .all()
    )
    asset_id_to_image_id = {
        asset_id: image_id for image_id, asset_id in image_asset_rows if asset_id is not None
    }
    asset_ids = list(asset_id_to_image_id.keys())
    if not asset_ids:
        return {}, {}

    permatag_rows = (
        session.query(Permatag.asset_id, func.count(Permatag.id))
        .filter(Permatag.asset_id.in_(asset_ids))
        .group_by(Permatag.asset_id)
        .all()
    )
    machine_rows = (
        session.query(MachineTag.asset_id, func.count(MachineTag.id))
        .filter(MachineTag.asset_id.in_(asset_ids))
        .group_by(MachineTag.asset_id)
        .all()
    )
    permatag_counts = {
        asset_id_to_image_id[asset_id]: int(count)
        for asset_id, count in permatag_rows
        if asset_id in asset_id_to_image_id
    }
    machine_counts = {
        asset_id_to_image_id[asset_id]: int(count)
        for asset_id, count in machine_rows
        if asset_id in asset_id_to_image_id
    }
    return permatag_counts, machine_counts


def iter_rows(
    session: Session,
    tenant_id: Optional[str],
    batch_size: int,
    limit: Optional[int],
    include_legacy_columns: bool,
):
    processed = 0
    last_id: Optional[int] = None
    while True:
        remaining = None
        if limit is not None:
            remaining = max(limit - processed, 0)
            if remaining == 0:
                return
        current_batch_limit = batch_size if remaining is None else min(batch_size, remaining)
        query = (
            session.query(
                ImageMetadata.id,
                ImageMetadata.tenant_id,
                ImageMetadata.asset_id,
                ImageMetadata.thumbnail_path if include_legacy_columns else literal(None),
                ImageMetadata.filename,
                ImageMetadata.dropbox_path if include_legacy_columns else literal(None),
                Asset.thumbnail_key,
            )
            .outerjoin(Asset, Asset.id == ImageMetadata.asset_id)
        )
        if tenant_id:
            query = query.filter(ImageMetadata.tenant_id == tenant_id)
        if last_id is not None:
            query = query.filter(ImageMetadata.id > last_id)
        batch = query.order_by(ImageMetadata.id).limit(current_batch_limit).all()
        if not batch:
            return
        yield batch
        processed += len(batch)
        last_id = batch[-1][0]


def upsert_audit_row(session: Session, payload: dict) -> None:
    session.execute(
        text(
            """
            INSERT INTO thumbnail_migration_audit (
                image_id,
                tenant_id,
                asset_id,
                old_thumbnail_key,
                new_thumbnail_key,
                old_exists,
                new_exists,
                old_sha256,
                new_sha256,
                old_phash,
                new_phash,
                phash_distance,
                byte_hash_equal,
                phash_equal,
                visually_different,
                shared_old_key_count,
                permatag_count,
                machine_tag_count,
                needs_review,
                error,
                last_audited_at
            ) VALUES (
                :image_id,
                :tenant_id,
                :asset_id,
                :old_thumbnail_key,
                :new_thumbnail_key,
                :old_exists,
                :new_exists,
                :old_sha256,
                :new_sha256,
                :old_phash,
                :new_phash,
                :phash_distance,
                :byte_hash_equal,
                :phash_equal,
                :visually_different,
                :shared_old_key_count,
                :permatag_count,
                :machine_tag_count,
                :needs_review,
                :error,
                now()
            )
            ON CONFLICT (image_id) DO UPDATE SET
                tenant_id = EXCLUDED.tenant_id,
                asset_id = EXCLUDED.asset_id,
                old_thumbnail_key = EXCLUDED.old_thumbnail_key,
                new_thumbnail_key = EXCLUDED.new_thumbnail_key,
                old_exists = EXCLUDED.old_exists,
                new_exists = EXCLUDED.new_exists,
                old_sha256 = EXCLUDED.old_sha256,
                new_sha256 = EXCLUDED.new_sha256,
                old_phash = EXCLUDED.old_phash,
                new_phash = EXCLUDED.new_phash,
                phash_distance = EXCLUDED.phash_distance,
                byte_hash_equal = EXCLUDED.byte_hash_equal,
                phash_equal = EXCLUDED.phash_equal,
                visually_different = EXCLUDED.visually_different,
                shared_old_key_count = EXCLUDED.shared_old_key_count,
                permatag_count = EXCLUDED.permatag_count,
                machine_tag_count = EXCLUDED.machine_tag_count,
                needs_review = EXCLUDED.needs_review,
                error = EXCLUDED.error,
                last_audited_at = now()
            """
        ),
        payload,
    )


def build_payload(
    *,
    image_id: int,
    tenant_id: str,
    asset_id,
    old_key: Optional[str],
    new_key: Optional[str],
    old_exists: bool,
    new_exists: bool,
    old_sha: Optional[str],
    new_sha: Optional[str],
    old_phash: Optional[str],
    new_phash: Optional[str],
    phash_diff: Optional[int],
    shared_old_key_count: int,
    permatag_count: int,
    machine_tag_count: int,
    phash_threshold: int,
    error: Optional[str],
) -> dict:
    byte_hash_equal = None
    phash_equal = None
    if old_sha and new_sha:
        byte_hash_equal = old_sha == new_sha
    if old_phash and new_phash:
        phash_equal = old_phash == new_phash

    visually_different = False
    if old_exists != new_exists:
        visually_different = True
    elif old_exists and new_exists:
        if phash_diff is not None:
            visually_different = phash_diff > phash_threshold
        elif byte_hash_equal is not None:
            visually_different = not byte_hash_equal

    needs_review = bool(
        visually_different
        or shared_old_key_count > 1
        or not old_exists
        or not new_exists
        or error
    )

    return {
        "image_id": image_id,
        "tenant_id": tenant_id,
        "asset_id": asset_id,
        "old_thumbnail_key": old_key,
        "new_thumbnail_key": new_key,
        "old_exists": old_exists,
        "new_exists": new_exists,
        "old_sha256": old_sha,
        "new_sha256": new_sha,
        "old_phash": old_phash,
        "new_phash": new_phash,
        "phash_distance": phash_diff,
        "byte_hash_equal": byte_hash_equal,
        "phash_equal": phash_equal,
        "visually_different": visually_different,
        "shared_old_key_count": shared_old_key_count,
        "permatag_count": permatag_count,
        "machine_tag_count": machine_tag_count,
        "needs_review": needs_review,
        "error": (error or "")[:2000] or None,
    }


def run_audit(session: Session, args: argparse.Namespace) -> None:
    storage_client = storage.Client()
    include_legacy_columns = hasattr(ImageMetadata, "thumbnail_path")
    if not include_legacy_columns:
        print("Legacy image_metadata thumbnail/dropbox columns not present; running audit in new-key-only mode.")
    total = 0
    reviewed = 0
    needs_review = 0
    visual_diffs = 0
    duplicate_old_key = 0
    errors = 0

    for batch in iter_rows(
        session,
        args.tenant_id,
        args.batch_size,
        args.limit,
        include_legacy_columns=include_legacy_columns,
    ):
        tenant_ids = {row[1] for row in batch}
        bucket_map = load_tenant_bucket_map(session, tenant_ids)
        image_ids = [row[0] for row in batch]
        old_keys = {(row[1], (row[3] or "").strip()) for row in batch if (row[3] or "").strip()}
        shared_old_counts = load_shared_old_key_counts(
            session,
            tenant_ids=tenant_ids,
            old_keys={key for _, key in old_keys},
            include_legacy_columns=include_legacy_columns,
        )
        permatag_counts, machine_counts = load_tag_counts(session, image_ids)

        for (
            image_id,
            tenant_id,
            asset_id,
            old_key,
            _filename,
            _dropbox_path,
            new_key,
        ) in batch:
            total += 1
            old_key = (old_key or "").strip() or None
            new_key = (new_key or "").strip() or None
            bucket_name = bucket_map.get(tenant_id, settings.thumbnail_bucket)

            old_exists, old_bytes, old_error = fetch_blob_bytes(storage_client, bucket_name, old_key)
            new_exists, new_bytes, new_error = fetch_blob_bytes(storage_client, bucket_name, new_key)
            error_parts = []
            if old_error:
                error_parts.append(f"old:{old_error}")
            if new_error:
                error_parts.append(f"new:{new_error}")

            old_sha = None
            new_sha = None
            old_phash = None
            new_phash = None
            phash_diff = None

            try:
                if old_bytes is not None:
                    old_sha = compute_sha256(old_bytes)
                    old_phash = compute_phash_hex(old_bytes)
                if new_bytes is not None:
                    new_sha = compute_sha256(new_bytes)
                    new_phash = compute_phash_hex(new_bytes)
                phash_diff = phash_distance(old_phash, new_phash)
            except (UnidentifiedImageError, OSError, ValueError) as exc:
                error_parts.append(f"hash:{exc}")

            payload = build_payload(
                image_id=image_id,
                tenant_id=tenant_id,
                asset_id=asset_id,
                old_key=old_key,
                new_key=new_key,
                old_exists=old_exists,
                new_exists=new_exists,
                old_sha=old_sha,
                new_sha=new_sha,
                old_phash=old_phash,
                new_phash=new_phash,
                phash_diff=phash_diff,
                shared_old_key_count=shared_old_counts.get((tenant_id, old_key or ""), 0),
                permatag_count=permatag_counts.get(image_id, 0),
                machine_tag_count=machine_counts.get(image_id, 0),
                phash_threshold=args.phash_threshold,
                error="; ".join(error_parts) if error_parts else None,
            )

            reviewed += 1
            if payload["needs_review"]:
                needs_review += 1
            if payload["visually_different"]:
                visual_diffs += 1
            if payload["shared_old_key_count"] > 1:
                duplicate_old_key += 1
            if payload["error"]:
                errors += 1

            if not args.dry_run:
                upsert_audit_row(session, payload)

        if args.dry_run:
            session.rollback()
        else:
            session.commit()

        print(
            f"Processed={total} Reviewed={reviewed} NeedsReview={needs_review} "
            f"VisualDiffs={visual_diffs} SharedOldKey={duplicate_old_key} Errors={errors}"
        )

    print(
        f"Done. Processed={total} Reviewed={reviewed} NeedsReview={needs_review} "
        f"VisualDiffs={visual_diffs} SharedOldKey={duplicate_old_key} Errors={errors}"
    )


def export_csv(session: Session, args: argparse.Namespace) -> None:
    if not args.export_csv:
        return

    sql = """
        SELECT
            a.tenant_id,
            a.image_id,
            a.asset_id,
            im.filename,
            s.source_key,
            a.old_thumbnail_key,
            a.new_thumbnail_key,
            a.old_exists,
            a.new_exists,
            a.old_sha256,
            a.new_sha256,
            a.old_phash,
            a.new_phash,
            a.phash_distance,
            a.byte_hash_equal,
            a.phash_equal,
            a.visually_different,
            a.shared_old_key_count,
            a.permatag_count,
            a.machine_tag_count,
            (a.permatag_count + a.machine_tag_count) AS total_tag_count,
            a.needs_review,
            a.error,
            a.last_audited_at
        FROM thumbnail_migration_audit a
        JOIN image_metadata im ON im.id = a.image_id
        LEFT JOIN assets s ON s.id = im.asset_id
        WHERE (:tenant_id IS NULL OR a.tenant_id = :tenant_id)
          AND (:only_review IS FALSE OR a.needs_review IS TRUE)
        ORDER BY
            a.needs_review DESC,
            (a.permatag_count + a.machine_tag_count) DESC,
            a.shared_old_key_count DESC,
            a.visually_different DESC,
            a.image_id ASC
        LIMIT :export_limit
    """
    rows = session.execute(
        text(sql),
        {
            "tenant_id": args.tenant_id,
            "only_review": args.only_needs_review,
            "export_limit": args.export_limit,
        },
    ).mappings()

    output_path = Path(args.export_csv)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    rows_list = list(rows)
    if not rows_list:
        print(f"No rows to export. Output skipped: {output_path}")
        return

    fieldnames = list(rows_list[0].keys())
    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows_list)
    print(f"Exported {len(rows_list)} rows to {output_path}")


def main() -> None:
    args = parse_args()
    session = SessionLocal()
    try:
        run_audit(session, args)
        if not args.dry_run:
            export_csv(session, args)
    finally:
        session.close()


if __name__ == "__main__":
    main()
