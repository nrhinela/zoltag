#!/usr/bin/env python3
"""Copy existing objects into asset-based key conventions incrementally.

Default behavior:
- Copies thumbnail objects to:
  tenants/{tenant_id}/assets/{asset_id}/thumbnails/default-256.jpg
- Updates assets.thumbnail_key to destination when destination exists
  (or copy succeeds).

Optional behavior:
- --copy-sources: copy local/gcp source objects to:
  tenants/{tenant_id}/assets/{asset_id}/{filename}
  and update assets.source_key.
- --only-missing-thumbnails: process only missing/legacy thumbnail keys.
- --generate-missing-thumbnails: generate thumbnails from local/gcp source objects
  when no legacy thumbnail object is available.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from typing import Dict, Iterable, Optional, Tuple

from google.api_core.exceptions import NotFound, PreconditionFailed
from google.cloud import storage
from sqlalchemy import or_
from sqlalchemy.orm import Session

import zoltag.auth.models  # noqa: F401  # Ensure user_profiles table is registered
from zoltag.database import SessionLocal
from zoltag.image import ImageProcessor
from zoltag.metadata import Asset, Tenant as TenantModel
from zoltag.settings import settings
from zoltag.tenant import Tenant as TenantCtx


@dataclass
class CopyStats:
    processed: int = 0
    already_canonical: int = 0
    canonical_exists_adopted: int = 0
    copied: int = 0
    generated: int = 0
    destination_exists: int = 0
    source_missing: int = 0
    skipped_no_source: int = 0
    skipped_unsupported_provider: int = 0
    skipped_no_asset: int = 0
    updated_rows: int = 0
    errors: int = 0


def log(message: str) -> None:
    print(message, flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Copy asset objects to new key conventions.")
    parser.add_argument("--tenant-id", help="Only process one tenant id.")
    parser.add_argument("--limit", type=int, help="Max rows/assets to process.")
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--dry-run", action="store_true", help="Do not write changes to DB/GCS.")
    parser.add_argument(
        "--copy-sources",
        action="store_true",
        help="Also copy local/gcp source objects to canonical asset source keys.",
    )
    parser.add_argument(
        "--overwrite-destination",
        action="store_true",
        help="Overwrite existing destination objects (default uses no-overwrite precondition).",
    )
    parser.add_argument(
        "--no-update-db",
        action="store_true",
        help="Copy objects but do not update database keys.",
    )
    parser.add_argument(
        "--thumbnail-source-bucket",
        help="Optional source bucket for legacy thumbnails (defaults to tenant thumbnail bucket).",
    )
    parser.add_argument(
        "--only-missing-thumbnails",
        action="store_true",
        help="Only process assets with missing/legacy thumbnail_key values.",
    )
    parser.add_argument(
        "--generate-missing-thumbnails",
        action="store_true",
        help="Generate thumbnails from source objects for missing/legacy thumbnail keys (local/gcp only).",
    )
    parser.add_argument(
        "--storage-source-bucket",
        help="Optional source bucket for legacy source objects (defaults to tenant storage bucket).",
    )
    return parser.parse_args()


def is_canonical_thumbnail_key(tenant_id: str, asset_id: str, key: Optional[str]) -> bool:
    key_norm = (key or "").strip()
    expected_prefix = f"tenants/{tenant_id}/assets/{asset_id}/thumbnails/"
    return key_norm.startswith(expected_prefix)


def is_canonical_source_key(tenant_id: str, asset_id: str, key: Optional[str]) -> bool:
    key_norm = (key or "").strip()
    expected_prefix = f"tenants/{tenant_id}/assets/{asset_id}/"
    return key_norm.startswith(expected_prefix) and "/thumbnails/" not in key_norm


def choose_thumbnail_source_key(asset: Asset, dest_key: str) -> Optional[str]:
    asset_key = (asset.thumbnail_key or "").strip()
    for candidate in (asset_key,):
        if candidate and candidate != dest_key and not candidate.startswith("legacy:"):
            return candidate
    return None


def has_missing_or_legacy_thumbnail_key(key: Optional[str]) -> bool:
    key_norm = (key or "").strip()
    return (not key_norm) or key_norm.startswith("legacy:")


def copy_object(
    *,
    source_bucket: storage.Bucket,
    destination_bucket: storage.Bucket,
    source_key: str,
    destination_key: str,
    dry_run: bool,
    overwrite_destination: bool,
) -> Tuple[str, Optional[str]]:
    """Return status in {'copied','destination_exists','source_missing','error'}."""
    try:
        source_blob = source_bucket.blob(source_key)

        if dry_run:
            # Dry-run avoids write attempts, so we can only verify source existence.
            if not source_blob.exists():
                return "source_missing", None
            return "copied", None

        copy_kwargs = {}
        if not overwrite_destination:
            # Fast+safe path: create-only copy. Existing destinations fail precondition.
            copy_kwargs["if_generation_match"] = 0

        source_bucket.copy_blob(
            source_blob,
            destination_bucket,
            destination_key,
            **copy_kwargs,
        )
        return "copied", None
    except PreconditionFailed:
        return "destination_exists", None
    except NotFound:
        return "source_missing", None
    except Exception as exc:  # pragma: no cover - remote API behavior
        return "error", str(exc)


def object_exists(bucket: storage.Bucket, key: str) -> bool:
    try:
        return bucket.blob(key).exists()
    except Exception:
        return False


def generate_thumbnail_from_source_object(
    *,
    source_bucket: storage.Bucket,
    destination_bucket: storage.Bucket,
    source_key: str,
    destination_key: str,
    dry_run: bool,
) -> Tuple[str, Optional[str]]:
    """Return status in {'generated','source_missing','error'}."""
    try:
        source_blob = source_bucket.blob(source_key)
        if not source_blob.exists():
            return "source_missing", None

        if dry_run:
            return "generated", None

        image_bytes = source_blob.download_as_bytes()
        processor = ImageProcessor(thumbnail_size=(settings.thumbnail_size, settings.thumbnail_size))
        image = processor.load_image(image_bytes)
        thumbnail_bytes = processor.create_thumbnail(image)

        destination_blob = destination_bucket.blob(destination_key)
        destination_blob.cache_control = "public, max-age=31536000, immutable"
        destination_blob.upload_from_string(thumbnail_bytes, content_type="image/jpeg")
        return "generated", None
    except NotFound:
        return "source_missing", None
    except Exception as exc:  # pragma: no cover - remote API behavior
        return "error", str(exc)


def load_tenant_ctx(session: Session, tenant_id: str) -> TenantCtx:
    row = session.query(TenantModel).filter(TenantModel.id == tenant_id).first()
    if not row:
        raise RuntimeError(f"Tenant not found: {tenant_id}")
    return TenantCtx(
        id=row.id,
        name=row.name,
        active=row.active,
        storage_bucket=row.storage_bucket,
        thumbnail_bucket=row.thumbnail_bucket,
    )


def iter_thumbnail_assets(
    session: Session,
    tenant_id: Optional[str],
    batch_size: int,
    limit: Optional[int],
    only_missing_thumbnails: bool,
):
    processed = 0
    last_id: Optional[str] = None
    while True:
        remaining = None
        if limit is not None:
            remaining = max(limit - processed, 0)
            if remaining == 0:
                return
        current_limit = batch_size if remaining is None else min(batch_size, remaining)

        query = session.query(Asset)
        if only_missing_thumbnails:
            query = query.filter(
                or_(
                    Asset.thumbnail_key.is_(None),
                    Asset.thumbnail_key == "",
                    Asset.thumbnail_key.like("legacy:%"),
                )
            )
        if tenant_id:
            query = query.filter(Asset.tenant_id == tenant_id)
        if last_id is not None:
            query = query.filter(Asset.id > last_id)

        batch = query.order_by(Asset.id.asc()).limit(current_limit).all()
        if not batch:
            return
        # Capture pagination cursor before yielding; caller commits/expunges ORM rows.
        next_last_id = str(batch[-1].id)
        yield batch
        processed += len(batch)
        last_id = next_last_id


def iter_source_assets(session: Session, tenant_id: Optional[str], batch_size: int, limit: Optional[int]):
    processed = 0
    last_id: Optional[str] = None
    while True:
        remaining = None
        if limit is not None:
            remaining = max(limit - processed, 0)
            if remaining == 0:
                return
        current_limit = batch_size if remaining is None else min(batch_size, remaining)

        query = session.query(Asset).filter(Asset.source_provider.in_(["local", "gcp"]))
        if tenant_id:
            query = query.filter(Asset.tenant_id == tenant_id)
        if last_id is not None:
            query = query.filter(Asset.id > last_id)

        batch = query.order_by(Asset.id.asc()).limit(current_limit).all()
        if not batch:
            return
        # Capture pagination cursor before yielding; caller commits/expunges ORM rows.
        next_last_id = batch[-1].id
        yield batch
        processed += len(batch)
        last_id = next_last_id


def run_thumbnail_copy(session: Session, args: argparse.Namespace, storage_client: storage.Client) -> CopyStats:
    stats = CopyStats()
    tenant_cache: Dict[str, TenantCtx] = {}
    update_db = not args.no_update_db

    for batch in iter_thumbnail_assets(
        session,
        args.tenant_id,
        args.batch_size,
        args.limit,
        args.only_missing_thumbnails,
    ):
        for asset in batch:
            stats.processed += 1

            tenant_id = asset.tenant_id
            tenant_ctx = tenant_cache.get(tenant_id)
            if tenant_ctx is None:
                tenant_ctx = load_tenant_ctx(session, tenant_id)
                tenant_cache[tenant_id] = tenant_ctx

            asset_id = str(asset.id)
            destination_key = tenant_ctx.get_asset_thumbnail_key(asset_id, "default-256.jpg")
            destination_bucket_name = tenant_ctx.get_thumbnail_bucket(settings)
            source_bucket_name = args.thumbnail_source_bucket or destination_bucket_name
            source_bucket = storage_client.bucket(source_bucket_name)
            destination_bucket = storage_client.bucket(destination_bucket_name)

            if is_canonical_thumbnail_key(tenant_id, asset_id, asset.thumbnail_key):
                stats.already_canonical += 1
                continue

            if has_missing_or_legacy_thumbnail_key(asset.thumbnail_key):
                if object_exists(destination_bucket, destination_key):
                    stats.canonical_exists_adopted += 1
                    if update_db:
                        asset.thumbnail_key = destination_key
                        stats.updated_rows += 1
                    continue

            source_key = choose_thumbnail_source_key(asset, destination_key)
            if source_key:
                status, err = copy_object(
                    source_bucket=source_bucket,
                    destination_bucket=destination_bucket,
                    source_key=source_key,
                    destination_key=destination_key,
                    dry_run=args.dry_run,
                    overwrite_destination=args.overwrite_destination,
                )
                if status == "copied":
                    stats.copied += 1
                elif status == "destination_exists":
                    stats.destination_exists += 1
                elif status == "source_missing":
                    stats.source_missing += 1
                    continue
                else:
                    stats.errors += 1
                    log(
                        f"[thumb] ERROR tenant={tenant_id} asset_id={asset_id} "
                        f"src={source_key} dst={destination_key}: {err}"
                    )
                    continue
            elif args.generate_missing_thumbnails:
                source_provider = (asset.source_provider or "").strip().lower()
                source_object_key = (asset.source_key or "").strip()
                if source_provider not in {"local", "gcp"}:
                    if not source_provider and not source_object_key:
                        stats.skipped_no_source += 1
                    else:
                        stats.skipped_unsupported_provider += 1
                    continue
                if not source_object_key or source_object_key.startswith("legacy:"):
                    stats.skipped_no_source += 1
                    continue

                storage_bucket_name = args.storage_source_bucket or tenant_ctx.get_storage_bucket(settings)
                storage_bucket = storage_client.bucket(storage_bucket_name)
                status, err = generate_thumbnail_from_source_object(
                    source_bucket=storage_bucket,
                    destination_bucket=destination_bucket,
                    source_key=source_object_key,
                    destination_key=destination_key,
                    dry_run=args.dry_run,
                )
                if status == "generated":
                    stats.generated += 1
                elif status == "source_missing":
                    stats.source_missing += 1
                    continue
                else:
                    stats.errors += 1
                    log(
                        f"[thumb] ERROR generating tenant={tenant_id} asset_id={asset_id} "
                        f"src={source_object_key} dst={destination_key}: {err}"
                    )
                    continue
            else:
                stats.skipped_no_source += 1
                continue

            if update_db:
                asset.thumbnail_key = destination_key
                stats.updated_rows += 1

            if stats.processed % 25 == 0:
                log(
                    f"[thumb] Progress processed={stats.processed} copied={stats.copied} "
                    f"generated={stats.generated} canonical={stats.already_canonical} "
                    f"adopted={stats.canonical_exists_adopted} source_missing={stats.source_missing} "
                    f"errors={stats.errors}"
                )

        if args.dry_run:
            session.rollback()
        else:
            session.commit()
        session.expunge_all()
        log(
            f"[thumb] Processed={stats.processed} Canonical={stats.already_canonical} "
            f"Adopted={stats.canonical_exists_adopted} Copied={stats.copied} "
            f"Generated={stats.generated} DestExists={stats.destination_exists} "
            f"SourceMissing={stats.source_missing} Updated={stats.updated_rows} Errors={stats.errors}"
        )

    return stats


def run_source_copy(session: Session, args: argparse.Namespace, storage_client: storage.Client) -> CopyStats:
    stats = CopyStats()
    tenant_cache: Dict[str, TenantCtx] = {}
    update_db = not args.no_update_db

    for batch in iter_source_assets(session, args.tenant_id, args.batch_size, args.limit):
        for asset in batch:
            stats.processed += 1
            tenant_id = asset.tenant_id
            tenant_ctx = tenant_cache.get(tenant_id)
            if tenant_ctx is None:
                tenant_ctx = load_tenant_ctx(session, tenant_id)
                tenant_cache[tenant_id] = tenant_ctx

            asset_id = str(asset.id)
            destination_key = tenant_ctx.get_asset_source_key(asset_id, asset.filename or "file")
            source_key = (asset.source_key or "").strip()
            if not source_key or source_key.startswith("legacy:"):
                stats.skipped_no_source += 1
                continue

            if is_canonical_source_key(tenant_id, asset_id, source_key):
                stats.already_canonical += 1
                continue

            bucket_name = tenant_ctx.get_storage_bucket(settings)
            source_bucket_name = args.storage_source_bucket or bucket_name
            source_bucket = storage_client.bucket(source_bucket_name)
            destination_bucket = storage_client.bucket(bucket_name)
            status, err = copy_object(
                source_bucket=source_bucket,
                destination_bucket=destination_bucket,
                source_key=source_key,
                destination_key=destination_key,
                dry_run=args.dry_run,
                overwrite_destination=args.overwrite_destination,
            )
            if status == "copied":
                stats.copied += 1
            elif status == "destination_exists":
                stats.destination_exists += 1
            elif status == "source_missing":
                stats.source_missing += 1
                continue
            else:
                stats.errors += 1
                log(f"[source] ERROR tenant={tenant_id} asset_id={asset_id} src={source_key} dst={destination_key}: {err}")
                continue

            if update_db:
                asset.source_key = destination_key
                stats.updated_rows += 1

            if stats.processed % 25 == 0:
                log(
                    f"[source] Progress processed={stats.processed} copied={stats.copied} "
                    f"canonical={stats.already_canonical} source_missing={stats.source_missing} "
                    f"errors={stats.errors}"
                )

        if args.dry_run:
            session.rollback()
        else:
            session.commit()
        session.expunge_all()
        log(
            f"[source] Processed={stats.processed} Canonical={stats.already_canonical} "
            f"Copied={stats.copied} DestExists={stats.destination_exists} "
            f"SourceMissing={stats.source_missing} Updated={stats.updated_rows} Errors={stats.errors}"
        )

    return stats


def main() -> None:
    args = parse_args()
    log(
        f"Starting copy_assets_to_new_key_conventions "
        f"(tenant_id={args.tenant_id or 'ALL'}, limit={args.limit}, batch_size={args.batch_size}, "
        f"dry_run={args.dry_run}, copy_sources={args.copy_sources}, "
        f"only_missing_thumbnails={args.only_missing_thumbnails}, "
        f"generate_missing_thumbnails={args.generate_missing_thumbnails})"
    )
    session = SessionLocal()
    log("Initialized database session")
    storage_client = storage.Client(project=settings.gcp_project_id)
    log("Initialized GCS client")
    try:
        thumb_stats = run_thumbnail_copy(session, args, storage_client)
        source_stats = CopyStats()
        if args.copy_sources:
            source_stats = run_source_copy(session, args, storage_client)

        log("=== Summary ===")
        log(
            f"[thumb] Processed={thumb_stats.processed} Canonical={thumb_stats.already_canonical} "
            f"Adopted={thumb_stats.canonical_exists_adopted} Copied={thumb_stats.copied} "
            f"Generated={thumb_stats.generated} DestExists={thumb_stats.destination_exists} "
            f"SourceMissing={thumb_stats.source_missing} "
            f"SkippedNoSource={thumb_stats.skipped_no_source} "
            f"SkippedUnsupportedProvider={thumb_stats.skipped_unsupported_provider} "
            f"Updated={thumb_stats.updated_rows} Errors={thumb_stats.errors}"
        )
        if args.copy_sources:
            log(
                f"[source] Processed={source_stats.processed} Canonical={source_stats.already_canonical} "
                f"Copied={source_stats.copied} DestExists={source_stats.destination_exists} "
                f"SourceMissing={source_stats.source_missing} SkippedNoSource={source_stats.skipped_no_source} "
                f"Updated={source_stats.updated_rows} Errors={source_stats.errors}"
            )
    finally:
        session.close()


if __name__ == "__main__":
    main()
