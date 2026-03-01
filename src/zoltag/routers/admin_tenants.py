"""Router for tenant management endpoints."""

import re
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from google.cloud import storage
from sqlalchemy import text
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from zoltag.auth.dependencies import get_current_user, get_effective_membership_permissions
from zoltag.auth.models import (
    PermissionCatalog,
    TenantRole,
    TenantRolePermission,
    UserProfile,
    UserTenant,
)
from zoltag.dependencies import delete_secret, get_db, get_secret
from zoltag.integrations import TenantIntegrationRepository
from zoltag.metadata import Asset
from zoltag.metadata import Tenant as TenantModel
from zoltag.settings import settings
from zoltag.tenant import Tenant as RuntimeTenant
from zoltag.tenant_scope import tenant_column_filter_for_values, tenant_reference_filter

router = APIRouter(
    prefix="/api/v1/admin/tenants",
    tags=["admin-tenants"],
)


IDENTIFIER_PATTERN = re.compile(r"^[a-z0-9-]+$")
TABLE_NAME_PATTERN = re.compile(r"^[a-z_][a-z0-9_]*$")
LEGACY_PROVIDER_SETTINGS_KEYS = frozenset({
    "dropbox_app_key",
    "dropbox_oauth_mode",
    "dropbox_sync_folders",
    "gdrive_client_id",
    "gdrive_client_secret",
    "gdrive_token_secret",
    "gdrive_sync_folders",
    "default_source_provider",
})

# Deletion order is intentionally conservative so dependent rows are removed
# before parent rows that would otherwise hit NOT NULL + ON DELETE SET NULL FKs.
TENANT_PURGE_PRIORITY_TABLES = (
    "detected_faces",
    "image_embeddings",
    "machine_tags",
    "permatags",
    "member_comments",
    "member_ratings",
    "list_shares",
    "photo_lists",
    "image_metadata",
    "asset_derivatives",
    "asset_notes",
    "asset_text_index",
    "presentation_templates",
    "person_reference_images",
    "people",
    "keyword_models",
    "keywords",
    "keyword_categories",
    "dropbox_cursors",
    "workflow_runs",
    "jobs",
    "job_triggers",
    "tenant_provider_integrations",
    "invitations",
    "user_tenants",
    "tenant_roles",
    "activity_events",
    "assets",
)

LEGACY_SECRET_ID_PATTERNS = (
    "dropbox-app-secret-{scope}",
    "dropbox-token-{scope}",
    "gdrive-token-{scope}",
    "gdrive-client-secret-{scope}",
    "youtube-token-{scope}",
    "gphotos-token-{scope}",
    "flickr-token-{scope}",
)

PROVIDER_SECRET_ATTRS = (
    "dropbox_token_secret_name",
    "dropbox_app_secret_name",
    "gdrive_token_secret_name",
    "gdrive_client_secret_name",
    "youtube_token_secret_name",
    "gphotos_token_secret_name",
    "flickr_token_secret_name",
)

SYSTEM_ROLE_TEMPLATES = {
    "user": {
        "label": "User",
        "description": "Default end-user access",
    },
    "editor": {
        "label": "Editor",
        "description": "Can edit ratings, tags, notes, and curate content",
    },
    "admin": {
        "label": "Admin",
        "description": "Full tenant administration access",
    },
}

SYSTEM_ROLE_PERMISSIONS = {
    "user": (
        "image.view",
        "search.use",
        "list.view",
        "list.create",
        "list.edit.own",
        "assets.read",
        "keywords.read",
    ),
    "editor": (
        "image.view",
        "image.rate",
        "image.tag",
        "image.note.edit",
        "image.variant.manage",
        "search.use",
        "curate.use",
        "list.view",
        "list.create",
        "list.edit.own",
        "list.edit.shared",
        "provider.view",
        "tenant.jobs.view",
        "tenant.jobs.enqueue",
        "assets.read",
        "assets.write",
        "keywords.read",
        "keywords.write",
    ),
    "admin": (
        "image.view",
        "image.rate",
        "image.tag",
        "image.note.edit",
        "image.variant.manage",
        "search.use",
        "curate.use",
        "list.view",
        "list.create",
        "list.edit.own",
        "list.edit.shared",
        "provider.view",
        "provider.manage",
        "tenant.users.view",
        "tenant.users.manage",
        "tenant.audit.view",
        "tenant.jobs.view",
        "tenant.jobs.enqueue",
        "tenant.jobs.manage",
        "tenant.settings.manage",
        "assets.read",
        "assets.write",
        "keywords.read",
        "keywords.write",
    ),
}


def _normalize_identifier(value: str) -> str:
    normalized = (value or "").strip().lower()
    if not normalized:
        raise HTTPException(status_code=400, detail="identifier is required")
    if not IDENTIFIER_PATTERN.match(normalized):
        raise HTTPException(
            status_code=400,
            detail="identifier must contain only lowercase letters, numbers, and hyphens",
        )
    return normalized


def _normalize_tenant_id(value: str) -> str:
    normalized = (value or "").strip()
    if not normalized:
        return ""
    try:
        return str(uuid.UUID(normalized))
    except (ValueError, TypeError, AttributeError):
        return ""


def _resolve_tenant(db: Session, tenant_ref: str):
    return db.query(TenantModel).filter(tenant_reference_filter(TenantModel, tenant_ref)).first()


def _normalize_table_name(raw: Any) -> str:
    name = str(raw or "").strip()
    if not TABLE_NAME_PATTERN.match(name):
        return ""
    return name


def _table_exists(db: Session, table_name: str) -> bool:
    safe_table = _normalize_table_name(table_name)
    if not safe_table:
        return False
    exists = db.execute(
        text("SELECT to_regclass(:qualified_name) IS NOT NULL"),
        {"qualified_name": f"public.{safe_table}"},
    ).scalar()
    return bool(exists)


def _list_public_tenant_tables(db: Session) -> list[str]:
    rows = db.execute(
        text(
            """
            SELECT DISTINCT table_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND column_name = 'tenant_id'
            """
        )
    ).fetchall()
    names = [_normalize_table_name(row[0]) for row in rows]
    return sorted({name for name in names if name and name != "tenants"})


def _ordered_tenant_tables(tables: list[str]) -> list[str]:
    table_set = set(tables)
    ordered = [table for table in TENANT_PURGE_PRIORITY_TABLES if table in table_set]
    ordered.extend(sorted(table_set - set(ordered)))
    return ordered


def _count_tenant_table_rows(db: Session, table_name: str, tenant_id: str) -> int:
    safe_table = _normalize_table_name(table_name)
    if not safe_table:
        return 0
    result = db.execute(
        text(f'SELECT count(*)::bigint FROM "{safe_table}" WHERE tenant_id = :tenant_id'),
        {"tenant_id": tenant_id},
    ).scalar()
    return int(result or 0)


def _delete_tenant_table_rows(db: Session, table_name: str, tenant_id: str) -> int:
    safe_table = _normalize_table_name(table_name)
    if not safe_table:
        return 0
    result = db.execute(
        text(f'DELETE FROM "{safe_table}" WHERE tenant_id = :tenant_id'),
        {"tenant_id": tenant_id},
    )
    return int(result.rowcount or 0)


def _count_photo_list_items_for_tenant(db: Session, tenant_id: str) -> int:
    if not (_table_exists(db, "photo_list_items") and _table_exists(db, "photo_lists") and _table_exists(db, "assets")):
        return 0
    result = db.execute(
        text(
            """
            SELECT count(*)::bigint
            FROM photo_list_items pli
            WHERE EXISTS (
                SELECT 1
                FROM photo_lists pl
                WHERE pl.id = pli.list_id
                  AND pl.tenant_id = :tenant_id
            )
               OR EXISTS (
                SELECT 1
                FROM assets a
                WHERE a.id = pli.asset_id
                  AND a.tenant_id = :tenant_id
            )
            """
        ),
        {"tenant_id": tenant_id},
    ).scalar()
    return int(result or 0)


def _delete_photo_list_items_for_tenant(db: Session, tenant_id: str) -> int:
    if not (_table_exists(db, "photo_list_items") and _table_exists(db, "photo_lists") and _table_exists(db, "assets")):
        return 0
    # Remove list-items linked to the tenant's lists.
    first = db.execute(
        text(
            """
            DELETE FROM photo_list_items pli
            USING photo_lists pl
            WHERE pli.list_id = pl.id
              AND pl.tenant_id = :tenant_id
            """
        ),
        {"tenant_id": tenant_id},
    )
    # Remove any remaining cross-tenant anomalies linked by asset_id.
    second = db.execute(
        text(
            """
            DELETE FROM photo_list_items pli
            USING assets a
            WHERE pli.asset_id = a.id
              AND a.tenant_id = :tenant_id
            """
        ),
        {"tenant_id": tenant_id},
    )
    return int(first.rowcount or 0) + int(second.rowcount or 0)


def _count_asset_derivatives_for_tenant(db: Session, tenant_id: str) -> int:
    if not (_table_exists(db, "asset_derivatives") and _table_exists(db, "assets")):
        return 0
    result = db.execute(
        text(
            """
            SELECT count(*)::bigint
            FROM asset_derivatives ad
            JOIN assets a ON a.id = ad.asset_id
            WHERE a.tenant_id = :tenant_id
            """
        ),
        {"tenant_id": tenant_id},
    ).scalar()
    return int(result or 0)


def _delete_asset_derivatives_for_tenant(db: Session, tenant_id: str) -> int:
    if not (_table_exists(db, "asset_derivatives") and _table_exists(db, "assets")):
        return 0
    result = db.execute(
        text(
            """
            DELETE FROM asset_derivatives ad
            USING assets a
            WHERE ad.asset_id = a.id
              AND a.tenant_id = :tenant_id
            """
        ),
        {"tenant_id": tenant_id},
    )
    return int(result.rowcount or 0)


def _count_workflow_step_runs_for_tenant(db: Session, tenant_id: str) -> int:
    if not (_table_exists(db, "workflow_step_runs") and _table_exists(db, "workflow_runs")):
        return 0
    result = db.execute(
        text(
            """
            SELECT count(*)::bigint
            FROM workflow_step_runs ws
            JOIN workflow_runs wr ON wr.id = ws.workflow_run_id
            WHERE wr.tenant_id = :tenant_id
            """
        ),
        {"tenant_id": tenant_id},
    ).scalar()
    return int(result or 0)


def _count_job_attempts_for_tenant(db: Session, tenant_id: str) -> int:
    if not (_table_exists(db, "job_attempts") and _table_exists(db, "jobs")):
        return 0
    result = db.execute(
        text(
            """
            SELECT count(*)::bigint
            FROM job_attempts ja
            JOIN jobs j ON j.id = ja.job_id
            WHERE j.tenant_id = :tenant_id
            """
        ),
        {"tenant_id": tenant_id},
    ).scalar()
    return int(result or 0)


def _to_runtime_tenant(tenant_row: TenantModel) -> RuntimeTenant:
    return RuntimeTenant(
        id=str(tenant_row.id),
        name=str(tenant_row.name or str(tenant_row.id)),
        identifier=getattr(tenant_row, "identifier", None) or str(tenant_row.id),
        key_prefix=getattr(tenant_row, "key_prefix", None) or str(tenant_row.id),
        storage_bucket=getattr(tenant_row, "storage_bucket", None),
        thumbnail_bucket=getattr(tenant_row, "thumbnail_bucket", None),
    )


def _collect_secret_ids(db: Session, tenant_row: TenantModel) -> list[str]:
    runtime_tenant = _to_runtime_tenant(tenant_row)
    secret_scope = runtime_tenant.secret_scope
    secret_ids: set[str] = set()

    for pattern in LEGACY_SECRET_ID_PATTERNS:
        candidate = pattern.format(scope=secret_scope).strip()
        if candidate:
            secret_ids.add(candidate)

    repo = TenantIntegrationRepository(db)
    try:
        records = repo.list_provider_records(tenant_row)
    except Exception:
        records = []

    for record in records:
        for attr_name in PROVIDER_SECRET_ATTRS:
            value = str(getattr(record, attr_name, "") or "").strip()
            if value:
                secret_ids.add(value)
        config_json = getattr(record, "config_json", None) or {}
        if isinstance(config_json, dict):
            for key, value in config_json.items():
                if not str(key).endswith("_secret_name"):
                    continue
                normalized_value = str(value or "").strip()
                if normalized_value:
                    secret_ids.add(normalized_value)

    return sorted(secret_ids)


def _build_gcs_cleanup_pairs(tenant_row: TenantModel) -> list[tuple[str, str]]:
    runtime_tenant = _to_runtime_tenant(tenant_row)
    secret_scope = runtime_tenant.secret_scope.strip()
    if not secret_scope:
        return []

    storage_bucket_name = runtime_tenant.get_storage_bucket(settings)
    thumbnail_bucket_name = runtime_tenant.get_thumbnail_bucket(settings)
    person_reference_bucket_name = runtime_tenant.get_person_reference_bucket(settings)
    bucket_names = {
        str(storage_bucket_name or "").strip(),
        str(thumbnail_bucket_name or "").strip(),
        str(person_reference_bucket_name or "").strip(),
    }
    prefixes = (
        f"tenants/{secret_scope}/",
        f"{secret_scope}/",
    )

    pairs: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for bucket_name in sorted(name for name in bucket_names if name):
        for prefix in prefixes:
            normalized = (bucket_name, prefix)
            if normalized in seen:
                continue
            seen.add(normalized)
            pairs.append(normalized)
    return pairs


def _scan_or_delete_gcs_pairs(
    *,
    pairs: list[tuple[str, str]],
    delete_mode: bool,
    max_objects_per_prefix: int,
) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "enabled": bool(pairs),
        "delete_mode": bool(delete_mode),
        "max_objects_per_prefix": int(max_objects_per_prefix),
        "pairs": [],
        "total_objects": 0,
        "deleted_objects": 0,
        "truncated": False,
        "errors": [],
    }
    if not pairs:
        return summary

    try:
        storage_client = storage.Client(project=settings.gcp_project_id)
    except Exception as exc:
        summary["errors"].append(f"GCS client init failed: {exc}")
        return summary

    safe_limit = max(1, min(int(max_objects_per_prefix or 1), 1_000_000))
    for bucket_name, prefix in pairs:
        pair_summary: dict[str, Any] = {
            "bucket": bucket_name,
            "prefix": prefix,
            "objects": 0,
            "deleted": 0,
            "truncated": False,
            "error": None,
        }
        try:
            for blob in storage_client.list_blobs(bucket_name, prefix=prefix):
                pair_summary["objects"] += 1
                if delete_mode:
                    try:
                        blob.delete()
                        pair_summary["deleted"] += 1
                    except Exception as exc:
                        summary["errors"].append(f"{bucket_name}/{blob.name}: {exc}")
                if pair_summary["objects"] >= safe_limit:
                    pair_summary["truncated"] = True
                    summary["truncated"] = True
                    break
        except Exception as exc:
            pair_summary["error"] = str(exc)
            summary["errors"].append(f"{bucket_name}/{prefix}: {exc}")

        summary["total_objects"] += int(pair_summary["objects"] or 0)
        summary["deleted_objects"] += int(pair_summary["deleted"] or 0)
        summary["pairs"].append(pair_summary)

    return summary


def _build_tenant_purge_preview(
    *,
    db: Session,
    tenant_row: TenantModel,
    include_gcs_counts: bool,
    gcs_max_objects_per_prefix: int,
) -> dict[str, Any]:
    tenant_id = str(tenant_row.id)
    tenant_tables = _list_public_tenant_tables(db)
    ordered_tables = _ordered_tenant_tables(tenant_tables)
    table_counts = {
        table_name: _count_tenant_table_rows(db, table_name, tenant_id)
        for table_name in ordered_tables
    }

    derived_counts = {
        "photo_list_items": _count_photo_list_items_for_tenant(db, tenant_id),
        "asset_derivatives": _count_asset_derivatives_for_tenant(db, tenant_id),
        "workflow_step_runs": _count_workflow_step_runs_for_tenant(db, tenant_id),
        "job_attempts": _count_job_attempts_for_tenant(db, tenant_id),
    }

    gcs_pairs = _build_gcs_cleanup_pairs(tenant_row)
    gcs_summary = {
        "enabled": bool(gcs_pairs),
        "delete_mode": False,
        "max_objects_per_prefix": int(gcs_max_objects_per_prefix),
        "pairs": [{"bucket": bucket, "prefix": prefix} for bucket, prefix in gcs_pairs],
        "total_objects": None,
        "deleted_objects": None,
        "truncated": False,
        "errors": [],
    }
    if include_gcs_counts:
        gcs_summary = _scan_or_delete_gcs_pairs(
            pairs=gcs_pairs,
            delete_mode=False,
            max_objects_per_prefix=gcs_max_objects_per_prefix,
        )

    secret_ids = _collect_secret_ids(db, tenant_row)
    total_db_rows = int(sum(table_counts.values()) + sum(derived_counts.values()))

    return {
        "tenant_id": tenant_id,
        "tenant_name": str(tenant_row.name or ""),
        "tenant_identifier": str(getattr(tenant_row, "identifier", "") or tenant_id),
        "tenant_key_prefix": str(getattr(tenant_row, "key_prefix", "") or tenant_id),
        "db_table_counts": table_counts,
        "derived_counts": derived_counts,
        "db_total_rows_estimate": total_db_rows,
        "gcs": gcs_summary,
        "secret_ids": secret_ids,
        "secret_count": len(secret_ids),
    }


def _execute_tenant_purge(
    *,
    db: Session,
    tenant_row: TenantModel,
    purge_gcs: bool,
    purge_secrets: bool,
    gcs_max_objects_per_prefix: int,
) -> dict[str, Any]:
    tenant_id = str(tenant_row.id)
    tenant_tables = _list_public_tenant_tables(db)
    ordered_tables = _ordered_tenant_tables(tenant_tables)
    gcs_pairs = _build_gcs_cleanup_pairs(tenant_row)
    secret_ids = _collect_secret_ids(db, tenant_row)

    deleted_rows: dict[str, int] = {}
    try:
        deleted_rows["photo_list_items"] = _delete_photo_list_items_for_tenant(db, tenant_id)
        deleted_rows["asset_derivatives"] = _delete_asset_derivatives_for_tenant(db, tenant_id)
        for table_name in ordered_tables:
            deleted_rows[table_name] = _delete_tenant_table_rows(db, table_name, tenant_id)

        tenant_deleted = db.execute(
            text("DELETE FROM tenants WHERE id = :tenant_id"),
            {"tenant_id": tenant_id},
        )
        deleted_rows["tenants"] = int(tenant_deleted.rowcount or 0)
        if deleted_rows["tenants"] != 1:
            raise RuntimeError(f"Expected to delete 1 tenant row, deleted {deleted_rows['tenants']}")

        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Failed to purge tenant: {exc}") from exc

    gcs_summary = {
        "enabled": bool(gcs_pairs),
        "delete_mode": bool(purge_gcs),
        "max_objects_per_prefix": int(gcs_max_objects_per_prefix),
        "pairs": [{"bucket": bucket, "prefix": prefix} for bucket, prefix in gcs_pairs],
        "total_objects": 0,
        "deleted_objects": 0,
        "truncated": False,
        "errors": [],
    }
    if purge_gcs:
        gcs_summary = _scan_or_delete_gcs_pairs(
            pairs=gcs_pairs,
            delete_mode=True,
            max_objects_per_prefix=gcs_max_objects_per_prefix,
        )

    deleted_secret_ids: list[str] = []
    secret_errors: list[str] = []
    if purge_secrets:
        for secret_id in secret_ids:
            try:
                delete_secret(secret_id)
                deleted_secret_ids.append(secret_id)
            except Exception as exc:
                secret_errors.append(f"{secret_id}: {exc}")

    return {
        "tenant_id": tenant_id,
        "deleted_rows": deleted_rows,
        "gcs": gcs_summary,
        "purged_secret_ids": deleted_secret_ids,
        "secret_errors": secret_errors,
        "requested_secret_ids": secret_ids,
    }


def _resolved_dropbox_app_key(db: Session, tenant: TenantModel) -> str:
    repo = TenantIntegrationRepository(db)
    record = repo.get_provider_record(tenant, "dropbox")
    return str(record.config_json.get("app_key") or "").strip()


def _dropbox_connected(db: Session, tenant: TenantModel) -> bool:
    repo = TenantIntegrationRepository(db)
    record = repo.get_provider_record(tenant, "dropbox")
    token_secret_name = str(record.dropbox_token_secret_name or "").strip()
    if not token_secret_name:
        return False
    try:
        token = str(get_secret(token_secret_name) or "").strip()
    except Exception:
        return False
    return bool(token)


def _require_super_admin(user: UserProfile) -> None:
    if not user.is_super_admin:
        raise HTTPException(status_code=403, detail="Super admin role required")


def _user_has_tenant_permission(
    db: Session,
    user: UserProfile,
    tenant: TenantModel,
    permission_key: str,
) -> bool:
    membership = db.query(UserTenant).filter(
        UserTenant.supabase_uid == user.supabase_uid,
        tenant_column_filter_for_values(UserTenant, str(tenant.id)),
        UserTenant.accepted_at.isnot(None),
    ).first()
    if membership is None:
        return False
    return permission_key in get_effective_membership_permissions(db, membership)


def _require_tenant_admin_or_super_admin(db: Session, user: UserProfile, tenant: TenantModel) -> None:
    if user.is_super_admin:
        return
    if _user_has_tenant_permission(db, user, tenant, "tenant.settings.manage"):
        return
    raise HTTPException(status_code=403, detail="Admin role required for this tenant")


def _seed_default_tenant_roles(db: Session, tenant_id: str) -> None:
    existing_roles = {
        role.role_key: role
        for role in db.query(TenantRole).filter(TenantRole.tenant_id == tenant_id).all()
    }
    active_permissions = {
        str(row[0])
        for row in db.query(PermissionCatalog.key).filter(PermissionCatalog.is_active.is_(True)).all()
    }

    for role_key, template in SYSTEM_ROLE_TEMPLATES.items():
        role = existing_roles.get(role_key)
        if role is None:
            role = TenantRole(
                tenant_id=tenant_id,
                role_key=role_key,
                label=template["label"],
                description=template["description"],
                is_system=True,
                is_active=True,
            )
            db.add(role)
            db.flush()
            existing_roles[role_key] = role
        else:
            role.label = template["label"]
            role.description = template["description"]
            role.is_system = True
            role.is_active = True

        desired_permissions = {
            permission_key
            for permission_key in SYSTEM_ROLE_PERMISSIONS.get(role_key, ())
            if permission_key in active_permissions
        }
        existing_mappings = {
            str(row[0]): str(row[1] or "allow")
            for row in db.query(
                TenantRolePermission.permission_key,
                TenantRolePermission.effect,
            ).filter(
                TenantRolePermission.role_id == role.id
            ).all()
        }
        for permission_key in desired_permissions:
            if permission_key in existing_mappings:
                if existing_mappings[permission_key] != "allow":
                    db.query(TenantRolePermission).filter(
                        TenantRolePermission.role_id == role.id,
                        TenantRolePermission.permission_key == permission_key,
                    ).update({"effect": "allow"}, synchronize_session=False)
                continue
            db.add(TenantRolePermission(
                role_id=role.id,
                permission_key=permission_key,
                effect="allow",
            ))


@router.get("", response_model=list)
async def list_tenants(
    db: Session = Depends(get_db),
    details: bool = False,
    user: UserProfile = Depends(get_current_user),
):
    """List all tenants."""
    if user.is_super_admin:
        tenant_filter_ids = None
    else:
        memberships = db.query(UserTenant).filter(
                UserTenant.supabase_uid == user.supabase_uid,
                UserTenant.accepted_at.isnot(None),
            ).all()
        tenant_filter_ids = [
            membership.tenant_id
            for membership in memberships
            if "tenant.settings.manage" in get_effective_membership_permissions(db, membership)
        ]
        if not tenant_filter_ids:
            return []

    if details:
        tenant_query = db.query(TenantModel)
        if tenant_filter_ids is not None:
            tenant_query = tenant_query.filter(TenantModel.id.in_(tenant_filter_ids))
        tenants = tenant_query.all()
        return [{
            "dropbox_app_key": _resolved_dropbox_app_key(db, t),
            "id": str(t.id),
            "identifier": getattr(t, "identifier", None) or str(t.id),
            "key_prefix": getattr(t, "key_prefix", None) or str(t.id),
            "name": t.name,
            "active": t.active,
            "dropbox_configured": _dropbox_connected(db, t),
            "storage_bucket": t.storage_bucket,
            "thumbnail_bucket": t.thumbnail_bucket,
            "settings": t.settings,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "updated_at": t.updated_at.isoformat() if t.updated_at else None
        } for t in tenants]

    row_query = db.query(
        TenantModel.id,
        TenantModel.identifier,
        TenantModel.key_prefix,
        TenantModel.name,
        TenantModel.active,
        TenantModel.storage_bucket,
        TenantModel.thumbnail_bucket,
        TenantModel.created_at,
        TenantModel.updated_at,
    )
    if tenant_filter_ids is not None:
        row_query = row_query.filter(TenantModel.id.in_(tenant_filter_ids))
    rows = row_query.all()

    tenants_by_id = {str(t.id): t for t in db.query(TenantModel).filter(TenantModel.id.in_([r.id for r in rows])).all()}
    response = []
    for row in rows:
        tenant_row = tenants_by_id.get(str(row.id))
        dropbox_app_key = _resolved_dropbox_app_key(db, tenant_row) if tenant_row else ""
        dropbox_connected = _dropbox_connected(db, tenant_row) if tenant_row else False
        response.append({
            "dropbox_app_key": dropbox_app_key,
            "id": str(row.id),
            "identifier": getattr(row, "identifier", None) or str(row.id),
            "key_prefix": getattr(row, "key_prefix", None) or str(row.id),
            "name": row.name,
            "active": row.active,
            "dropbox_configured": dropbox_connected,
            "storage_bucket": row.storage_bucket,
            "thumbnail_bucket": row.thumbnail_bucket,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        })
    return response


@router.get("/{tenant_id}", response_model=dict)
async def get_tenant(
    tenant_id: str,
    db: Session = Depends(get_db),
    user: UserProfile = Depends(get_current_user),
):
    """Get a single tenant (full details)."""
    tenant = _resolve_tenant(db, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    _require_tenant_admin_or_super_admin(db, user, tenant)

    dropbox_app_key = _resolved_dropbox_app_key(db, tenant)
    return {
        "dropbox_app_key": dropbox_app_key,
        "id": str(tenant.id),
        "identifier": getattr(tenant, "identifier", None) or str(tenant.id),
        "key_prefix": getattr(tenant, "key_prefix", None) or str(tenant.id),
        "name": tenant.name,
        "active": tenant.active,
        "dropbox_configured": _dropbox_connected(db, tenant),
        "storage_bucket": tenant.storage_bucket,
        "thumbnail_bucket": tenant.thumbnail_bucket,
        "settings": tenant.settings,
        "created_at": tenant.created_at.isoformat() if tenant.created_at else None,
        "updated_at": tenant.updated_at.isoformat() if tenant.updated_at else None
    }


@router.post("", response_model=dict)
async def create_tenant(
    tenant_data: dict,
    db: Session = Depends(get_db),
    user: UserProfile = Depends(get_current_user),
):
    """Create a new tenant."""
    _require_super_admin(user)
    # Validate required fields
    if not tenant_data.get("name"):
        raise HTTPException(status_code=400, detail="name is required")
    requested_id_raw = (tenant_data.get("id") or "").strip()
    requested_id_uuid = _normalize_tenant_id(requested_id_raw)
    identifier_seed = tenant_data.get("identifier") or requested_id_raw
    identifier = _normalize_identifier(identifier_seed or "")
    key_prefix = _normalize_identifier(tenant_data.get("key_prefix") or identifier)
    tenant_id = requested_id_uuid or str(uuid.uuid4())

    # Check if tenant already exists
    existing = db.query(TenantModel).filter(TenantModel.id == tenant_id).first()
    if existing:
        raise HTTPException(status_code=409, detail="Tenant already exists")
    existing_identifier = db.query(TenantModel).filter(TenantModel.identifier == identifier).first()
    if existing_identifier:
        raise HTTPException(status_code=409, detail="Tenant identifier already exists")
    existing_key_prefix = db.query(TenantModel).filter(TenantModel.key_prefix == key_prefix).first()
    if existing_key_prefix:
        raise HTTPException(status_code=409, detail="Tenant key_prefix already exists")

    # Create tenant
    tenant = TenantModel(
        id=tenant_id,
        identifier=identifier,
        key_prefix=key_prefix,
        name=tenant_data["name"],
        active=tenant_data.get("active", True),
        settings=tenant_data.get("settings", {})
    )

    db.add(tenant)
    db.flush()
    _seed_default_tenant_roles(db, tenant.id)
    repo = TenantIntegrationRepository(db)
    repo.backfill_tenant(tenant)

    if "dropbox_app_key" in tenant_data:
        repo.update_provider(
            tenant,
            "dropbox",
            app_key=str(tenant_data.get("dropbox_app_key") or "").strip() or None,
        )

    db.commit()
    db.refresh(tenant)

    return {
        "id": str(tenant.id),
        "identifier": getattr(tenant, "identifier", None) or str(tenant.id),
        "key_prefix": getattr(tenant, "key_prefix", None) or str(tenant.id),
        "name": tenant.name,
        "active": tenant.active,
        "created_at": tenant.created_at.isoformat()
    }


@router.put("/{tenant_id}", response_model=dict)
async def update_tenant(
    tenant_id: str,
    tenant_data: dict,
    db: Session = Depends(get_db),
    user: UserProfile = Depends(get_current_user),
):
    """Update an existing tenant."""
    tenant = _resolve_tenant(db, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    _require_tenant_admin_or_super_admin(db, user, tenant)

    if not user.is_super_admin:
        restricted_fields = {"id", "identifier", "key_prefix", "name", "active"}
        attempted_restricted_fields = sorted(set(tenant_data.keys()) & restricted_fields)
        if attempted_restricted_fields:
            raise HTTPException(
                status_code=403,
                detail=(
                    "Only super admins can update these fields: "
                    + ", ".join(attempted_restricted_fields)
                ),
            )

    if "id" in tenant_data:
        requested_id = _normalize_tenant_id(tenant_data.get("id") or "") or (tenant_data.get("id") or "").strip()
        if requested_id != str(tenant.id):
            raise HTTPException(status_code=400, detail="tenant id is immutable")
    if "key_prefix" in tenant_data:
        requested_key_prefix = _normalize_identifier(tenant_data.get("key_prefix") or "")
        if requested_key_prefix != (getattr(tenant, "key_prefix", None) or str(tenant.id)):
            raise HTTPException(status_code=400, detail="key_prefix is immutable")
    if "identifier" in tenant_data:
        updated_identifier = _normalize_identifier(tenant_data.get("identifier") or "")
        existing_identifier = db.query(TenantModel).filter(
            TenantModel.identifier == updated_identifier,
            TenantModel.id != tenant.id,
        ).first()
        if existing_identifier:
            raise HTTPException(status_code=409, detail="Tenant identifier already exists")
        tenant.identifier = updated_identifier

    # Update fields
    if "name" in tenant_data:
        tenant.name = tenant_data["name"]
    if "active" in tenant_data:
        tenant.active = tenant_data["active"]
    if "dropbox_app_key" in tenant_data:
        repo = TenantIntegrationRepository(db)
        repo.update_provider(
            tenant,
            "dropbox",
            app_key=str(tenant_data.get("dropbox_app_key") or "").strip() or None,
        )
    if "storage_bucket" in tenant_data:
        tenant.storage_bucket = tenant_data["storage_bucket"]
    if "thumbnail_bucket" in tenant_data:
        tenant.thumbnail_bucket = tenant_data["thumbnail_bucket"]
    if "settings" in tenant_data:
        incoming_settings = tenant_data["settings"] or {}
        blocked_keys = sorted(set(incoming_settings.keys()) & LEGACY_PROVIDER_SETTINGS_KEYS)
        if blocked_keys:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Provider configuration is managed by /api/v1/admin/integrations; "
                    f"remove legacy settings keys: {', '.join(blocked_keys)}"
                ),
            )
        tenant.settings = incoming_settings

    tenant.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(tenant)

    return {
        "id": str(tenant.id),
        "identifier": getattr(tenant, "identifier", None) or str(tenant.id),
        "key_prefix": getattr(tenant, "key_prefix", None) or str(tenant.id),
        "name": tenant.name,
        "active": tenant.active,
        "updated_at": tenant.updated_at.isoformat()
    }


@router.patch("/{tenant_id}/settings", response_model=dict)
async def update_tenant_settings(
    tenant_id: str,
    settings_update: dict,
    db: Session = Depends(get_db),
    user: UserProfile = Depends(get_current_user),
):
    """Partially update tenant settings (merge with existing settings)."""
    tenant = _resolve_tenant(db, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    _require_tenant_admin_or_super_admin(db, user, tenant)
    blocked_keys = sorted(set((settings_update or {}).keys()) & LEGACY_PROVIDER_SETTINGS_KEYS)
    if blocked_keys:
        raise HTTPException(
            status_code=400,
            detail=(
                "Provider configuration is managed by /api/v1/admin/integrations; "
                f"remove legacy settings keys: {', '.join(blocked_keys)}"
            ),
        )

    # Get existing settings or initialize empty dict
    current_settings = tenant.settings or {}

    # Merge with new settings
    current_settings.update(settings_update)

    # Update tenant
    tenant.settings = current_settings
    tenant.updated_at = datetime.utcnow()

    # Mark settings as modified so SQLAlchemy detects the JSONB change
    flag_modified(tenant, "settings")

    db.commit()
    db.refresh(tenant)

    return {
        "id": str(tenant.id),
        "identifier": getattr(tenant, "identifier", None) or str(tenant.id),
        "settings": tenant.settings,
        "updated_at": tenant.updated_at.isoformat()
    }


@router.get("/{tenant_id}/photo_count", response_model=dict)
async def get_tenant_photo_count(
    tenant_id: str,
    db: Session = Depends(get_db),
    user: UserProfile = Depends(get_current_user),
):
    tenant = _resolve_tenant(db, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    _require_tenant_admin_or_super_admin(db, user, tenant)

    count = db.query(Asset.id).filter(Asset.tenant_id == tenant.id).count()
    return {
        "tenant_id": str(tenant.id),
        "count": int(count or 0),
    }


@router.get("/{tenant_id}/purge_preview", response_model=dict)
async def tenant_purge_preview(
    tenant_id: str,
    include_gcs_counts: bool = True,
    gcs_max_objects_per_prefix: int = 200_000,
    db: Session = Depends(get_db),
    user: UserProfile = Depends(get_current_user),
):
    _require_super_admin(user)
    tenant = _resolve_tenant(db, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    safe_limit = max(1, min(int(gcs_max_objects_per_prefix or 1), 1_000_000))
    preview = _build_tenant_purge_preview(
        db=db,
        tenant_row=tenant,
        include_gcs_counts=bool(include_gcs_counts),
        gcs_max_objects_per_prefix=safe_limit,
    )
    return {
        "status": "preview",
        **preview,
    }


@router.delete("/{tenant_id}", response_model=dict)
async def delete_tenant(
    tenant_id: str,
    dry_run: bool = False,
    purge_gcs: bool = True,
    purge_secrets: bool = True,
    include_gcs_counts: bool = False,
    gcs_max_objects_per_prefix: int = 200_000,
    db: Session = Depends(get_db),
    user: UserProfile = Depends(get_current_user),
):
    """Delete a tenant and all associated data (DB + optional GCS/secrets cleanup)."""
    _require_super_admin(user)
    tenant = _resolve_tenant(db, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    safe_limit = max(1, min(int(gcs_max_objects_per_prefix or 1), 1_000_000))
    if dry_run:
        preview = _build_tenant_purge_preview(
            db=db,
            tenant_row=tenant,
            include_gcs_counts=bool(include_gcs_counts),
            gcs_max_objects_per_prefix=safe_limit,
        )
        return {
            "status": "dry_run",
            **preview,
        }

    result = _execute_tenant_purge(
        db=db,
        tenant_row=tenant,
        purge_gcs=bool(purge_gcs),
        purge_secrets=bool(purge_secrets),
        gcs_max_objects_per_prefix=safe_limit,
    )
    return {
        "status": "deleted",
        **result,
    }
