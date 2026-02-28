#!/usr/bin/env python3
"""Delete duplicate provider assets for a tenant while preserving one canonical record per key.

Duplicate key = (tenant_id, source_provider, source_key).
Canonical record = oldest asset (created_at, id).
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import sqlalchemy as sa
from sqlalchemy import create_engine, func
from sqlalchemy.orm import Session, sessionmaker

import zoltag.auth.models  # noqa: F401  # Ensure auth tables (e.g. user_profiles) are registered
from zoltag.database import get_engine_kwargs
from zoltag.metadata import (
    Asset,
    AssetDerivative,
    AssetNote,
    AssetTextIndex,
    DetectedFace,
    ImageEmbedding,
    ImageMetadata,
    MachineTag,
    Permatag,
    PersonReferenceImage,
    Tenant as TenantModel,
)
from zoltag.models.config import PhotoListItem
from zoltag.models.sharing import MemberComment, MemberRating
from zoltag.settings import settings
from zoltag.tenant import Tenant as TenantRuntime
from zoltag.tenant_scope import tenant_reference_filter


@dataclass
class Counters:
    groups_total: int = 0
    groups_done: int = 0
    groups_failed: int = 0
    assets_deleted: int = 0
    image_metadata_deleted: int = 0
    image_metadata_relinked: int = 0
    detected_faces_deleted: int = 0
    list_items_moved: int = 0
    member_comments_moved: int = 0
    member_ratings_moved: int = 0
    member_ratings_deleted: int = 0
    permatags_moved: int = 0
    permatags_deleted: int = 0
    machine_tags_moved: int = 0
    machine_tags_deleted: int = 0
    embeddings_moved: int = 0
    embeddings_deleted: int = 0
    asset_notes_moved: int = 0
    asset_notes_deleted: int = 0
    text_index_moved: int = 0
    text_index_deleted: int = 0
    derivatives_moved: int = 0
    person_refs_moved: int = 0
    thumbnail_objects_deleted: int = 0
    thumbnail_objects_missing: int = 0
    thumbnail_object_delete_errors: int = 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--tenant",
        required=True,
        help="Tenant reference (UUID or identifier).",
    )
    parser.add_argument(
        "--provider",
        action="append",
        default=[],
        help=(
            "Provider to include (repeatable). "
            "Defaults to dropbox when omitted. "
            "Use --provider all to include all providers."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run without committing changes.",
    )
    parser.add_argument(
        "--progress-every",
        type=int,
        default=25,
        help="Emit progress every N duplicate groups.",
    )
    parser.add_argument(
        "--commit-every",
        type=int,
        default=100,
        help="Commit every N processed groups (ignored in dry-run).",
    )
    parser.add_argument(
        "--keep-thumbnail-objects",
        action="store_true",
        help="Do not delete thumbnail storage objects for deleted duplicate assets.",
    )
    return parser.parse_args()


def _normalize_provider_filter(values: Iterable[str]) -> set[str]:
    normalized: set[str] = set()
    for value in values:
        token = str(value or "").strip().lower()
        if not token:
            continue
        if token in {"all", "*"}:
            return set()
        if token in {"dbx"}:
            token = "dropbox"
        if token in {"google-drive", "google_drive", "drive"}:
            token = "gdrive"
        if token in {"google-photos", "google_photos"}:
            token = "gphotos"
        if token in {"yt"}:
            token = "youtube"
        normalized.add(token)
    if not normalized:
        return {"dropbox"}
    return normalized


def _delete_or_move_conflict_rows(
    db: Session,
    *,
    row_class,
    duplicate_asset_id,
    canonical_asset_id,
    conflict_predicate,
    counters_attr_moved: str,
    counters_attr_deleted: str,
    counters: Counters,
) -> None:
    rows = db.query(row_class).filter(row_class.asset_id == duplicate_asset_id).all()
    for row in rows:
        conflict = db.query(row_class).filter(
            row_class.asset_id == canonical_asset_id,
            conflict_predicate(row),
        ).first()
        if conflict:
            db.delete(row)
            setattr(counters, counters_attr_deleted, getattr(counters, counters_attr_deleted) + 1)
        else:
            row.asset_id = canonical_asset_id
            setattr(counters, counters_attr_moved, getattr(counters, counters_attr_moved) + 1)


def _dedupe_one_asset(
    db: Session,
    *,
    canonical_asset: Asset,
    duplicate_asset: Asset,
    table_enabled: dict[str, bool],
    pending_thumbnail_keys: set[str],
    counters: Counters,
) -> None:
    canonical_asset_id = canonical_asset.id
    duplicate_asset_id = duplicate_asset.id

    if table_enabled["photo_list_items"]:
        moved = db.query(PhotoListItem).filter(PhotoListItem.asset_id == duplicate_asset_id).update(
            {PhotoListItem.asset_id: canonical_asset_id},
            synchronize_session=False,
        )
        counters.list_items_moved += int(moved or 0)

    if table_enabled["member_comments"]:
        moved = db.query(MemberComment).filter(MemberComment.asset_id == duplicate_asset_id).update(
            {MemberComment.asset_id: canonical_asset_id},
            synchronize_session=False,
        )
        counters.member_comments_moved += int(moved or 0)

    if table_enabled["member_ratings"]:
        _delete_or_move_conflict_rows(
            db,
            row_class=MemberRating,
            duplicate_asset_id=duplicate_asset_id,
            canonical_asset_id=canonical_asset_id,
            conflict_predicate=lambda row: MemberRating.user_uid == row.user_uid,
            counters_attr_moved="member_ratings_moved",
            counters_attr_deleted="member_ratings_deleted",
            counters=counters,
        )

    if table_enabled["permatags"]:
        _delete_or_move_conflict_rows(
            db,
            row_class=Permatag,
            duplicate_asset_id=duplicate_asset_id,
            canonical_asset_id=canonical_asset_id,
            conflict_predicate=lambda row: Permatag.keyword_id == row.keyword_id,
            counters_attr_moved="permatags_moved",
            counters_attr_deleted="permatags_deleted",
            counters=counters,
        )

    if table_enabled["machine_tags"]:
        _delete_or_move_conflict_rows(
            db,
            row_class=MachineTag,
            duplicate_asset_id=duplicate_asset_id,
            canonical_asset_id=canonical_asset_id,
            conflict_predicate=lambda row: sa.and_(
                MachineTag.keyword_id == row.keyword_id,
                MachineTag.tag_type == row.tag_type,
                MachineTag.model_name == row.model_name,
            ),
            counters_attr_moved="machine_tags_moved",
            counters_attr_deleted="machine_tags_deleted",
            counters=counters,
        )

    if table_enabled["image_embeddings"]:
        canonical_embedding = db.query(ImageEmbedding).filter(ImageEmbedding.asset_id == canonical_asset_id).first()
        duplicate_embeddings = db.query(ImageEmbedding).filter(ImageEmbedding.asset_id == duplicate_asset_id).all()
        for row in duplicate_embeddings:
            if canonical_embedding:
                db.delete(row)
                counters.embeddings_deleted += 1
            else:
                row.asset_id = canonical_asset_id
                canonical_embedding = row
                counters.embeddings_moved += 1

    if table_enabled["asset_notes"]:
        _delete_or_move_conflict_rows(
            db,
            row_class=AssetNote,
            duplicate_asset_id=duplicate_asset_id,
            canonical_asset_id=canonical_asset_id,
            conflict_predicate=lambda row: AssetNote.note_type == row.note_type,
            counters_attr_moved="asset_notes_moved",
            counters_attr_deleted="asset_notes_deleted",
            counters=counters,
        )

    if table_enabled["asset_text_index"]:
        canonical_idx = db.query(AssetTextIndex).filter(AssetTextIndex.asset_id == canonical_asset_id).first()
        duplicate_idx_rows = db.query(AssetTextIndex).filter(AssetTextIndex.asset_id == duplicate_asset_id).all()
        for row in duplicate_idx_rows:
            if canonical_idx:
                db.delete(row)
                counters.text_index_deleted += 1
            else:
                row.asset_id = canonical_asset_id
                canonical_idx = row
                counters.text_index_moved += 1

    if table_enabled["asset_derivatives"]:
        moved = db.query(AssetDerivative).filter(AssetDerivative.asset_id == duplicate_asset_id).update(
            {AssetDerivative.asset_id: canonical_asset_id},
            synchronize_session=False,
        )
        counters.derivatives_moved += int(moved or 0)

    if table_enabled["person_reference_images"]:
        moved = db.query(PersonReferenceImage).filter(PersonReferenceImage.source_asset_id == duplicate_asset_id).update(
            {PersonReferenceImage.source_asset_id: canonical_asset_id},
            synchronize_session=False,
        )
        counters.person_refs_moved += int(moved or 0)

    canonical_meta = (
        db.query(ImageMetadata)
        .filter(ImageMetadata.asset_id == canonical_asset_id)
        .order_by(ImageMetadata.id.asc())
        .first()
    )
    duplicate_meta = (
        db.query(ImageMetadata)
        .filter(ImageMetadata.asset_id == duplicate_asset_id)
        .order_by(ImageMetadata.id.asc())
        .all()
    )

    if duplicate_meta and canonical_meta is None:
        keep_meta = duplicate_meta[0]
        keep_meta.asset_id = canonical_asset_id
        counters.image_metadata_relinked += 1
        duplicate_meta = duplicate_meta[1:]

    for meta in duplicate_meta:
        if table_enabled["detected_faces"]:
            removed_faces = db.query(DetectedFace).filter(DetectedFace.image_id == meta.id).delete(
                synchronize_session=False,
            )
            counters.detected_faces_deleted += int(removed_faces or 0)
        db.delete(meta)
        counters.image_metadata_deleted += 1

    # Hard guard for schemas where image_metadata.asset_id is NOT NULL while the FK is ON DELETE SET NULL:
    # ensure no residual rows reference the duplicate asset before deleting the asset row.
    residual_meta_deleted = (
        db.query(ImageMetadata)
        .filter(ImageMetadata.asset_id == duplicate_asset_id)
        .delete(synchronize_session=False)
    )
    if residual_meta_deleted:
        counters.image_metadata_deleted += int(residual_meta_deleted)

    # Flush child-row updates/deletes now so parent delete cannot trigger SET NULL on residual metadata.
    db.flush()

    db.delete(duplicate_asset)
    counters.assets_deleted += 1
    duplicate_thumbnail_key = (duplicate_asset.thumbnail_key or "").strip()
    if duplicate_thumbnail_key:
        pending_thumbnail_keys.add(duplicate_thumbnail_key)


def _build_runtime_tenant(tenant_row: TenantModel) -> TenantRuntime:
    tenant_id = str(tenant_row.id)
    return TenantRuntime(
        id=tenant_id,
        name=tenant_row.name,
        identifier=getattr(tenant_row, "identifier", None) or tenant_id,
        key_prefix=getattr(tenant_row, "key_prefix", None) or tenant_id,
        active=bool(getattr(tenant_row, "active", True)),
        storage_bucket=getattr(tenant_row, "storage_bucket", None),
        thumbnail_bucket=getattr(tenant_row, "thumbnail_bucket", None),
        settings=tenant_row.settings if isinstance(tenant_row.settings, dict) else {},
    )


def _delete_thumbnail_object(
    *,
    key: str,
    bucket_name: str | None,
    local_mode: bool,
    local_thumb_dir: Path | None,
    storage_client,
    counters: Counters,
) -> None:
    if local_mode:
        if local_thumb_dir is None:
            counters.thumbnail_object_delete_errors += 1
            return
        # In local mode thumbnails are served from ~/.zoltag/thumbnails/<basename>.
        local_path = local_thumb_dir / Path(key).name
        if not local_path.exists():
            counters.thumbnail_objects_missing += 1
            return
        try:
            local_path.unlink()
            counters.thumbnail_objects_deleted += 1
        except Exception:
            counters.thumbnail_object_delete_errors += 1
        return

    if storage_client is None or not bucket_name:
        counters.thumbnail_object_delete_errors += 1
        return
    try:
        storage_client.bucket(bucket_name).blob(key).delete()
        counters.thumbnail_objects_deleted += 1
    except Exception as exc:
        # Best effort: treat not-found as non-fatal "already gone".
        if exc.__class__.__name__ == "NotFound":
            counters.thumbnail_objects_missing += 1
            return
        counters.thumbnail_object_delete_errors += 1


def _flush_orphan_thumbnail_deletes(
    db: Session,
    *,
    tenant_id,
    pending_thumbnail_keys: set[str],
    delete_thumbnail_objects: bool,
    bucket_name: str | None,
    local_mode: bool,
    local_thumb_dir: Path | None,
    storage_client,
    counters: Counters,
) -> None:
    if not delete_thumbnail_objects or not pending_thumbnail_keys:
        return

    for key in list(pending_thumbnail_keys):
        refs = (
            db.query(func.count(Asset.id))
            .filter(
                Asset.tenant_id == tenant_id,
                Asset.thumbnail_key == key,
            )
            .scalar()
            or 0
        )
        if refs > 0:
            # Still referenced by at least one surviving asset.
            continue
        _delete_thumbnail_object(
            key=key,
            bucket_name=bucket_name,
            local_mode=local_mode,
            local_thumb_dir=local_thumb_dir,
            storage_client=storage_client,
            counters=counters,
        )
        pending_thumbnail_keys.discard(key)


def _utc_now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _asset_canonical_sort_key(asset: Asset) -> tuple[int, float, str]:
    """Order assets so the canonical row is the earliest created, then lowest id."""
    created_at = getattr(asset, "created_at", None)
    if created_at is None:
        # Missing timestamps should never win canonical selection.
        return (1, float("inf"), str(asset.id))
    try:
        ts = float(created_at.timestamp())
    except Exception:
        ts = float("inf")
    return (0, ts, str(asset.id))


def main() -> int:
    args = parse_args()
    providers = _normalize_provider_filter(args.provider)
    progress_every = max(1, int(args.progress_every or 25))
    commit_every = max(1, int(args.commit_every or 100))
    delete_thumbnail_objects = not bool(args.keep_thumbnail_objects)

    engine = create_engine(settings.database_url, **get_engine_kwargs())
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()
    started = _utc_now()

    try:
        inspector = sa.inspect(engine)
        table_names = set(inspector.get_table_names())
        table_enabled = {
            "photo_list_items": "photo_list_items" in table_names,
            "member_comments": "member_comments" in table_names,
            "member_ratings": "member_ratings" in table_names,
            "permatags": "permatags" in table_names,
            "machine_tags": "machine_tags" in table_names,
            "image_embeddings": "image_embeddings" in table_names,
            "asset_notes": "asset_notes" in table_names,
            "asset_text_index": "asset_text_index" in table_names,
            "asset_derivatives": "asset_derivatives" in table_names,
            "person_reference_images": "person_reference_images" in table_names,
            "detected_faces": "detected_faces" in table_names,
        }

        tenant = (
            db.query(TenantModel)
            .filter(tenant_reference_filter(TenantModel, str(args.tenant).strip()))
            .first()
        )
        if not tenant:
            print("Tenant not found.", flush=True)
            return 1

        tenant_runtime = _build_runtime_tenant(tenant)
        thumbnail_bucket_name = tenant_runtime.get_thumbnail_bucket(settings)
        local_mode = bool(getattr(settings, "local_mode", False))
        local_thumb_dir = (
            (Path(getattr(settings, "local_data_dir", "")).expanduser() / "thumbnails")
            if local_mode
            else None
        )
        storage_client = None
        if delete_thumbnail_objects and not args.dry_run and not local_mode:
            try:
                from google.cloud import storage  # type: ignore

                storage_client = storage.Client(project=settings.gcp_project_id)
            except Exception as exc:  # noqa: BLE001
                print(
                    f"[warn] Thumbnail object deletion disabled: storage client init failed ({exc}).",
                    flush=True,
                )
                delete_thumbnail_objects = False

        duplicate_groups_query = (
            db.query(
                Asset.source_provider.label("provider"),
                Asset.source_key.label("source_key"),
                func.count(Asset.id).label("asset_count"),
            )
            .filter(Asset.tenant_id == tenant.id)
            .group_by(Asset.source_provider, Asset.source_key)
            .having(func.count(Asset.id) > 1)
            .order_by(func.count(Asset.id).desc(), Asset.source_provider.asc(), Asset.source_key.asc())
        )
        if providers:
            duplicate_groups_query = duplicate_groups_query.filter(
                func.lower(Asset.source_provider).in_(sorted(providers))
            )
        duplicate_groups = duplicate_groups_query.all()

        counters = Counters(groups_total=len(duplicate_groups))
        if not duplicate_groups:
            provider_label = ", ".join(sorted(providers)) if providers else "all"
            print(
                f"No duplicate groups found for tenant={tenant.id} providers={provider_label}.",
                flush=True,
            )
            return 0

        provider_label = ", ".join(sorted(providers)) if providers else "all"
        print(
            (
                f"Found {len(duplicate_groups)} duplicate groups for tenant={tenant.id} "
                f"(providers={provider_label})."
            ),
            flush=True,
        )
        if delete_thumbnail_objects and not args.dry_run:
            location = str(local_thumb_dir) if local_mode else f"gs://{thumbnail_bucket_name}"
            print(f"Thumbnail object cleanup enabled ({location}).", flush=True)
        elif args.dry_run:
            print("Thumbnail object cleanup skipped in dry-run mode.", flush=True)
        else:
            print("Thumbnail object cleanup disabled (--keep-thumbnail-objects).", flush=True)

        pending_thumbnail_keys: set[str] = set()
        for index, group in enumerate(duplicate_groups, start=1):
            provider = str(group.provider or "")
            source_key = str(group.source_key or "")
            group_pending_thumbnail_keys: set[str] = set()
            try:
                with db.begin_nested():
                    assets = (
                        db.query(Asset)
                        .filter(
                            Asset.tenant_id == tenant.id,
                            Asset.source_provider == provider,
                            Asset.source_key == source_key,
                        )
                        .all()
                    )
                    assets.sort(key=_asset_canonical_sort_key)
                    if len(assets) <= 1:
                        counters.groups_done += 1
                    else:
                        canonical = assets[0]
                        for duplicate in assets[1:]:
                            _dedupe_one_asset(
                                db,
                                canonical_asset=canonical,
                                duplicate_asset=duplicate,
                                table_enabled=table_enabled,
                                pending_thumbnail_keys=group_pending_thumbnail_keys,
                                counters=counters,
                            )
                        counters.groups_done += 1
                pending_thumbnail_keys.update(group_pending_thumbnail_keys)
            except Exception as exc:  # noqa: BLE001
                counters.groups_failed += 1
                print(
                    (
                        f"[warn] Failed group {index}/{len(duplicate_groups)} "
                        f"provider={provider} source_key={source_key}: {exc}"
                    ),
                    flush=True,
                )

            if index % progress_every == 0 or index == len(duplicate_groups):
                elapsed = (_utc_now() - started).total_seconds()
                rate = (index / elapsed) if elapsed > 0 else 0.0
                remaining = len(duplicate_groups) - index
                eta_s = int(remaining / rate) if rate > 0 else 0
                print(
                    (
                        f"Progress {index}/{len(duplicate_groups)} "
                        f"({(index / len(duplicate_groups)) * 100:.1f}%) | "
                        f"deleted_assets={counters.assets_deleted} | "
                        f"failed_groups={counters.groups_failed} | "
                        f"rate={rate:.2f} groups/s | eta={eta_s}s"
                    ),
                    flush=True,
                )

            if not args.dry_run and index % commit_every == 0:
                db.commit()
                _flush_orphan_thumbnail_deletes(
                    db,
                    tenant_id=tenant.id,
                    pending_thumbnail_keys=pending_thumbnail_keys,
                    delete_thumbnail_objects=delete_thumbnail_objects,
                    bucket_name=thumbnail_bucket_name,
                    local_mode=local_mode,
                    local_thumb_dir=local_thumb_dir,
                    storage_client=storage_client,
                    counters=counters,
                )

        if args.dry_run:
            db.rollback()
            print("DRY RUN complete (rolled back).", flush=True)
        else:
            db.commit()
            _flush_orphan_thumbnail_deletes(
                db,
                tenant_id=tenant.id,
                pending_thumbnail_keys=pending_thumbnail_keys,
                delete_thumbnail_objects=delete_thumbnail_objects,
                bucket_name=thumbnail_bucket_name,
                local_mode=local_mode,
                local_thumb_dir=local_thumb_dir,
                storage_client=storage_client,
                counters=counters,
            )
            print("Dedup complete (committed).", flush=True)

        print(
            (
                "Summary: "
                f"groups_total={counters.groups_total}, "
                f"groups_done={counters.groups_done}, "
                f"groups_failed={counters.groups_failed}, "
                f"assets_deleted={counters.assets_deleted}, "
                f"image_metadata_deleted={counters.image_metadata_deleted}, "
                f"image_metadata_relinked={counters.image_metadata_relinked}, "
                f"detected_faces_deleted={counters.detected_faces_deleted}, "
                f"list_items_moved={counters.list_items_moved}, "
                f"member_comments_moved={counters.member_comments_moved}, "
                f"member_ratings_moved={counters.member_ratings_moved}, "
                f"member_ratings_deleted={counters.member_ratings_deleted}, "
                f"permatags_moved={counters.permatags_moved}, "
                f"permatags_deleted={counters.permatags_deleted}, "
                f"machine_tags_moved={counters.machine_tags_moved}, "
                f"machine_tags_deleted={counters.machine_tags_deleted}, "
                f"embeddings_moved={counters.embeddings_moved}, "
                f"embeddings_deleted={counters.embeddings_deleted}, "
                f"asset_notes_moved={counters.asset_notes_moved}, "
                f"asset_notes_deleted={counters.asset_notes_deleted}, "
                f"text_index_moved={counters.text_index_moved}, "
                f"text_index_deleted={counters.text_index_deleted}, "
                f"derivatives_moved={counters.derivatives_moved}, "
                f"person_refs_moved={counters.person_refs_moved}, "
                f"thumbnail_objects_deleted={counters.thumbnail_objects_deleted}, "
                f"thumbnail_objects_missing={counters.thumbnail_objects_missing}, "
                f"thumbnail_object_delete_errors={counters.thumbnail_object_delete_errors}, "
                f"thumbnail_objects_pending={len(pending_thumbnail_keys)}"
            ),
            flush=True,
        )
        return 0
    finally:
        db.close()
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
