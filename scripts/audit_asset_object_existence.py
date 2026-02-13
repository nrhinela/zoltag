#!/usr/bin/env python3
"""Audit asset object keys in DB against object existence in GCS.

Checks:
- assets.thumbnail_key objects in tenant thumbnail buckets
- (optional) assets.source_key objects for local/gcp providers in storage buckets
"""

from __future__ import annotations

import argparse
import csv
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Set, Tuple

from google.cloud import storage
from sqlalchemy.orm import Session

import zoltag.auth.models  # noqa: F401  # Ensure user_profiles table is registered
from zoltag.database import SessionLocal
from zoltag.metadata import Asset, Tenant as TenantModel
from zoltag.settings import settings
from zoltag.tenant import Tenant as TenantCtx


@dataclass
class TenantAuditState:
    assets_count: int = 0
    thumbnail_keys: Set[str] = None
    source_keys: Set[str] = None

    def __post_init__(self) -> None:
        if self.thumbnail_keys is None:
            self.thumbnail_keys = set()
        if self.source_keys is None:
            self.source_keys = set()


@dataclass
class BucketCheckResult:
    checked: int
    missing: int
    missing_keys: List[str]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit asset key existence in GCS.")
    parser.add_argument("--tenant-id", help="Only audit one tenant id.")
    parser.add_argument("--limit", type=int, help="Max assets to scan.")
    parser.add_argument("--batch-size", type=int, default=1000)
    parser.add_argument(
        "--check-sources",
        action="store_true",
        help="Also verify assets.source_key for source_provider in ('local', 'gcp').",
    )
    parser.add_argument(
        "--sample-missing",
        type=int,
        default=25,
        help="How many missing keys to print per category.",
    )
    parser.add_argument(
        "--export-missing-csv",
        help="Optional CSV path to export all missing keys.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit with status 1 if any missing keys are found.",
    )
    return parser.parse_args()


def build_tenant_ctx(row: Optional[TenantModel], tenant_id: str) -> TenantCtx:
    if row:
        return TenantCtx(
            id=row.id,
            name=row.name,
            active=row.active,
            storage_bucket=row.storage_bucket,
            thumbnail_bucket=row.thumbnail_bucket,
        )
    # Fallback for edge cases where tenant row is missing; still computes env-default bucket names.
    return TenantCtx(id=tenant_id, name=tenant_id, active=True)


def iter_assets(
    session: Session,
    tenant_id: Optional[str],
    batch_size: int,
    limit: Optional[int],
):
    processed = 0
    last_id = None
    while True:
        remaining = None
        if limit is not None:
            remaining = max(limit - processed, 0)
            if remaining == 0:
                return
        current_limit = batch_size if remaining is None else min(batch_size, remaining)

        query = session.query(
            Asset.id,
            Asset.tenant_id,
            Asset.thumbnail_key,
            Asset.source_provider,
            Asset.source_key,
        )
        if tenant_id:
            query = query.filter(Asset.tenant_id == tenant_id)
        if last_id is not None:
            query = query.filter(Asset.id > last_id)
        batch = query.order_by(Asset.id.asc()).limit(current_limit).all()
        if not batch:
            return
        yield batch
        processed += len(batch)
        last_id = batch[-1][0]


def load_tenant_contexts(session: Session, tenant_ids: Sequence[str]) -> Dict[str, TenantCtx]:
    rows = session.query(TenantModel).filter(TenantModel.id.in_(list(tenant_ids))).all()
    by_id = {row.id: row for row in rows}
    contexts: Dict[str, TenantCtx] = {}
    for tenant_id in tenant_ids:
        contexts[tenant_id] = build_tenant_ctx(by_id.get(tenant_id), tenant_id)
    return contexts


def key_exists(client: storage.Client, bucket_name: str, key: str) -> bool:
    return client.bucket(bucket_name).blob(key).exists()


def check_keys_for_bucket(
    *,
    client: storage.Client,
    bucket_name: str,
    tenant_id: str,
    keys: Set[str],
    sample_limit: int,
) -> BucketCheckResult:
    if not keys:
        return BucketCheckResult(checked=0, missing=0, missing_keys=[])

    tenant_prefix = f"tenants/{tenant_id}/"
    canonical_keys = {k for k in keys if k.startswith(tenant_prefix)}
    noncanonical_keys = keys - canonical_keys

    existing_canonical: Set[str] = set()
    if canonical_keys:
        for blob in client.list_blobs(bucket_name, prefix=tenant_prefix):
            existing_canonical.add(blob.name)

    missing_keys: List[str] = []
    for key in sorted(canonical_keys):
        if key not in existing_canonical:
            missing_keys.append(key)

    # Fallback existence checks for non-canonical keys.
    for key in sorted(noncanonical_keys):
        if not key_exists(client, bucket_name, key):
            missing_keys.append(key)

    return BucketCheckResult(
        checked=len(keys),
        missing=len(missing_keys),
        missing_keys=missing_keys[:sample_limit],
    )


def main() -> int:
    args = parse_args()
    session = SessionLocal()
    try:
        tenant_state: Dict[str, TenantAuditState] = {}
        scanned = 0
        for batch in iter_assets(session, args.tenant_id, args.batch_size, args.limit):
            for asset_id, tenant_id, thumbnail_key, source_provider, source_key in batch:
                _ = asset_id
                scanned += 1
                state = tenant_state.setdefault(tenant_id, TenantAuditState())
                state.assets_count += 1

                thumb = (thumbnail_key or "").strip()
                if thumb:
                    state.thumbnail_keys.add(thumb)

                if args.check_sources:
                    provider = (source_provider or "").strip().lower()
                    src = (source_key or "").strip()
                    if provider in {"local", "gcp"} and src:
                        state.source_keys.add(src)

        if not tenant_state:
            print("No assets found for requested scope.")
            return 0

        tenant_ids = sorted(tenant_state.keys())
        tenant_ctx_by_id = load_tenant_contexts(session, tenant_ids)
    finally:
        session.close()

    client = storage.Client(project=settings.gcp_project_id)

    total_thumb_checked = 0
    total_thumb_missing = 0
    total_source_checked = 0
    total_source_missing = 0
    missing_rows: List[Tuple[str, str, str, str]] = []

    print(f"Scanned assets: {scanned}")
    for tenant_id in tenant_ids:
        state = tenant_state[tenant_id]
        tenant_ctx = tenant_ctx_by_id[tenant_id]

        thumb_bucket = tenant_ctx.get_thumbnail_bucket(settings)
        thumb_result = check_keys_for_bucket(
            client=client,
            bucket_name=thumb_bucket,
            tenant_id=tenant_id,
            keys=state.thumbnail_keys,
            sample_limit=args.sample_missing,
        )
        total_thumb_checked += thumb_result.checked
        total_thumb_missing += thumb_result.missing

        source_bucket = tenant_ctx.get_storage_bucket(settings)
        source_result = BucketCheckResult(checked=0, missing=0, missing_keys=[])
        if args.check_sources:
            source_result = check_keys_for_bucket(
                client=client,
                bucket_name=source_bucket,
                tenant_id=tenant_id,
                keys=state.source_keys,
                sample_limit=args.sample_missing,
            )
            total_source_checked += source_result.checked
            total_source_missing += source_result.missing

        print(
            f"[tenant={tenant_id}] assets={state.assets_count} "
            f"thumb_checked={thumb_result.checked} thumb_missing={thumb_result.missing} "
            f"source_checked={source_result.checked} source_missing={source_result.missing}"
        )

        for key in thumb_result.missing_keys:
            missing_rows.append((tenant_id, "thumbnail", thumb_bucket, key))
        for key in source_result.missing_keys:
            missing_rows.append((tenant_id, "source", source_bucket, key))

        if thumb_result.missing_keys:
            print("  sample missing thumbnails:")
            for key in thumb_result.missing_keys:
                print(f"    {key}")
        if source_result.missing_keys:
            print("  sample missing sources:")
            for key in source_result.missing_keys:
                print(f"    {key}")

    print("=== Summary ===")
    print(f"thumbnail_checked={total_thumb_checked} thumbnail_missing={total_thumb_missing}")
    if args.check_sources:
        print(f"source_checked={total_source_checked} source_missing={total_source_missing}")

    if args.export_missing_csv and missing_rows:
        csv_path = Path(args.export_missing_csv)
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        with csv_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(["tenant_id", "kind", "bucket", "object_key"])
            writer.writerows(missing_rows)
        print(f"Exported {len(missing_rows)} sample missing rows to {csv_path}")

    missing_total = total_thumb_missing + (total_source_missing if args.check_sources else 0)
    if args.strict and missing_total > 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

