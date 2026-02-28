#!/usr/bin/env python3
"""Backfill Dropbox asset source keys from path-based refs to stable file IDs."""

from __future__ import annotations

import argparse
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional

from sqlalchemy import create_engine, func
from sqlalchemy.orm import sessionmaker

from zoltag.database import get_engine_kwargs
from zoltag.dependencies import get_secret
from zoltag.dropbox import DropboxClient
from zoltag.dropbox_oauth import load_dropbox_oauth_credentials
from zoltag.integrations import TenantIntegrationRepository
from zoltag.metadata import Asset, Tenant
from zoltag.settings import settings
from zoltag.tenant_scope import tenant_reference_filter


@dataclass
class ProviderClient:
    provider_id: str
    client: DropboxClient


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--tenant",
        default="",
        help="Optional tenant reference (UUID or identifier). If omitted, processes all tenants.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run without committing changes.",
    )
    parser.add_argument(
        "--max-keys",
        type=int,
        default=0,
        help="Optional cap of distinct Dropbox source keys to process per tenant (0 = no cap).",
    )
    parser.add_argument(
        "--progress-every",
        type=int,
        default=100,
        help="Emit progress every N resolved keys per tenant.",
    )
    parser.add_argument(
        "--commit-every-keys",
        type=int,
        default=500,
        help="Commit every N processed source keys in non-dry-run mode (0 disables mid-run commits).",
    )
    return parser.parse_args()


def _load_dropbox_clients(db, tenant_row: Tenant) -> tuple[list[ProviderClient], list[str]]:
    repo = TenantIntegrationRepository(db)
    records = [
        record
        for record in repo.list_provider_records(tenant_row, include_inactive=True)
        if record.provider_type == "dropbox" and record.id
    ]
    clients: list[ProviderClient] = []
    errors: list[str] = []

    for record in records:
        try:
            token = get_secret(record.dropbox_token_secret_name)
            if not token:
                errors.append(f"{record.id}: missing Dropbox refresh token")
                continue
            credentials = load_dropbox_oauth_credentials(
                tenant_id=record.secret_scope,
                tenant_app_key=str((record.config_json or {}).get("app_key") or "").strip(),
                tenant_app_secret_name=record.dropbox_app_secret_name,
                get_secret=get_secret,
                selection_mode="managed_only",
            )
            clients.append(
                ProviderClient(
                    provider_id=str(record.id),
                    client=DropboxClient(
                        refresh_token=token,
                        app_key=credentials["app_key"],
                        app_secret=credentials["app_secret"],
                    ),
                )
            )
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{record.id}: {exc}")

    return clients, errors


def _is_legacy_dropbox_key(source_key: str) -> bool:
    value = str(source_key or "").strip()
    if not value:
        return False
    if value.startswith("id:"):
        return False
    if value.startswith("/local/"):
        return False
    return True


def _provider_order(
    all_clients: list[ProviderClient],
    provider_hints: Iterable[str],
) -> list[ProviderClient]:
    hint_set = {str(value).strip() for value in provider_hints if str(value).strip()}
    preferred = [pc for pc in all_clients if pc.provider_id in hint_set]
    fallback = [pc for pc in all_clients if pc.provider_id not in hint_set]
    return [*preferred, *fallback]


def main() -> int:
    args = parse_args()

    engine = create_engine(settings.database_url, **get_engine_kwargs())
    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        query = db.query(Tenant)
        tenant_ref = str(args.tenant or "").strip()
        if tenant_ref:
            query = query.filter(tenant_reference_filter(Tenant, tenant_ref))
        tenant_rows = query.order_by(Tenant.created_at.asc()).all()
        if not tenant_rows:
            print("No tenants found.")
            return 1

        total_tenants = 0
        total_assets_examined = 0
        total_assets_updated = 0
        total_keys_unresolved = 0

        for tenant_row in tenant_rows:
            tenant_id = str(tenant_row.id)
            total_tenants += 1
            print(f"\nTenant {tenant_id}", flush=True)

            provider_clients, provider_errors = _load_dropbox_clients(db, tenant_row)
            if provider_errors:
                print("  Provider warnings:", flush=True)
                for message in provider_errors:
                    print(f"    - {message}", flush=True)
            if not provider_clients:
                print("  No usable Dropbox provider clients; skipping tenant.", flush=True)
                continue

            asset_rows = (
                db.query(Asset)
                .filter(
                    Asset.tenant_id == tenant_row.id,
                    func.lower(Asset.source_provider) == "dropbox",
                )
                .all()
            )

            legacy_assets = [row for row in asset_rows if _is_legacy_dropbox_key(str(row.source_key or ""))]
            total_assets_examined += len(legacy_assets)
            if not legacy_assets:
                print("  No path-based Dropbox source keys found.", flush=True)
                continue

            assets_by_key: Dict[str, List[Asset]] = defaultdict(list)
            provider_hints_by_key: Dict[str, set[str]] = defaultdict(set)
            for asset in legacy_assets:
                key = str(asset.source_key or "").strip()
                assets_by_key[key].append(asset)
                if asset.provider_id:
                    provider_hints_by_key[key].add(str(asset.provider_id))

            ordered_keys = sorted(assets_by_key.keys())
            if args.max_keys > 0:
                ordered_keys = ordered_keys[: args.max_keys]
            total_keys = len(ordered_keys)
            progress_every = max(1, int(args.progress_every or 100))
            commit_every_keys = max(0, int(args.commit_every_keys or 0))
            started_at = time.monotonic()
            print(f"  Resolving {total_keys} distinct Dropbox source keys...", flush=True)
            if not args.dry_run and commit_every_keys > 0:
                print(f"  Batch commit enabled: every {commit_every_keys} keys.", flush=True)

            tenant_updated = 0
            unresolved_keys: list[str] = []
            keys_since_commit = 0
            for idx, source_key in enumerate(ordered_keys, start=1):
                resolved_id: Optional[str] = None
                resolved_path: Optional[str] = None
                resolved_rev: Optional[str] = None
                resolved_provider_id: Optional[str] = None

                for provider_client in _provider_order(provider_clients, provider_hints_by_key[source_key]):
                    try:
                        metadata = provider_client.client.get_metadata(source_key)
                        file_id = str(getattr(metadata, "id", "") or "").strip()
                        if not file_id:
                            continue
                        resolved_id = file_id
                        resolved_path = str(getattr(metadata, "path_display", "") or "").strip() or None
                        resolved_rev = str(getattr(metadata, "rev", "") or "").strip() or None
                        resolved_provider_id = provider_client.provider_id
                        break
                    except Exception:
                        continue

                if not resolved_id:
                    unresolved_keys.append(source_key)
                else:
                    provider_uuid = uuid.UUID(resolved_provider_id) if resolved_provider_id else None
                    for asset in assets_by_key[source_key]:
                        asset.source_key = resolved_id
                        if resolved_path:
                            asset.source_display_path = resolved_path
                        if resolved_rev:
                            asset.source_rev = resolved_rev
                        if provider_uuid and asset.provider_id is None:
                            asset.provider_id = provider_uuid
                        tenant_updated += 1

                keys_since_commit += 1
                if (
                    not args.dry_run
                    and commit_every_keys > 0
                    and keys_since_commit >= commit_every_keys
                ):
                    db.commit()
                    print(
                        f"  Committed batch at key {idx}/{total_keys} (updated assets={tenant_updated}).",
                        flush=True,
                    )
                    keys_since_commit = 0

                if idx % progress_every == 0 or idx == total_keys:
                    elapsed = max(time.monotonic() - started_at, 0.001)
                    rate = idx / elapsed
                    remaining = total_keys - idx
                    eta_seconds = int(remaining / rate) if rate > 0 else 0
                    print(
                        (
                            f"  Progress {idx}/{total_keys} keys "
                            f"({(idx / total_keys) * 100:.1f}%) | "
                            f"updated assets={tenant_updated} | "
                            f"unresolved keys={len(unresolved_keys)} | "
                            f"rate={rate:.1f} keys/s | eta={eta_seconds}s"
                        ),
                        flush=True,
                    )

            total_assets_updated += tenant_updated
            total_keys_unresolved += len(unresolved_keys)

            print(f"  Updated assets: {tenant_updated}", flush=True)
            if unresolved_keys:
                preview = unresolved_keys[:10]
                print(f"  Unresolved keys: {len(unresolved_keys)}", flush=True)
                for key in preview:
                    print(f"    - {key}", flush=True)
                if len(unresolved_keys) > len(preview):
                    print(f"    ... and {len(unresolved_keys) - len(preview)} more", flush=True)

        if args.dry_run:
            db.rollback()
            print(
                f"\nDRY RUN complete. tenants={total_tenants} "
                f"legacy_assets={total_assets_examined} updated={total_assets_updated} "
                f"unresolved_keys={total_keys_unresolved}"
            , flush=True)
        else:
            db.commit()
            print(
                f"\nBackfill complete. tenants={total_tenants} "
                f"legacy_assets={total_assets_examined} updated={total_assets_updated} "
                f"unresolved_keys={total_keys_unresolved}"
            , flush=True)
        return 0
    finally:
        db.close()
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
