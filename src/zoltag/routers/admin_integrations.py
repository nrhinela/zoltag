"""Tenant-admin integrations endpoints."""

from datetime import datetime
from urllib.parse import urlencode, urlsplit
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from zoltag.auth.dependencies import require_tenant_permission_from_header
from zoltag.auth.models import UserProfile
from zoltag.database import get_db
from zoltag.dependencies import delete_secret, get_secret, get_tenant, store_secret
from zoltag.dropbox_oauth import (
    load_dropbox_oauth_credentials,
    sanitize_redirect_origin,
    sanitize_return_path,
)
from zoltag.integrations import (
    TenantIntegrationRepository,
    normalize_picker_session_id,
    normalize_provider_type,
    normalize_selection_mode,
    normalize_sync_folders,
    normalize_sync_items,
)
from zoltag.metadata import Job, JobDefinition, Tenant as TenantModel
from zoltag.settings import settings as _settings
from zoltag.tenant import Tenant

router = APIRouter(prefix="/api/v1/admin/integrations", tags=["admin-integrations"])
_PROVIDER_LABELS = {
    "dropbox": "Dropbox",
    "gdrive": "Google Drive",
    "youtube": "YouTube",
    "gphotos": "Google Photos",
}
_PROVIDER_SYNC_DEFINITION_KEYS = {
    "dropbox": "sync-dropbox",
    "gdrive": "sync-gdrive",
    "youtube": "sync-youtube",
    "gphotos": "sync-gphotos",
}


def _normalize_provider_or_400(value: str | None) -> str:
    try:
        return normalize_provider_type(value)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid source provider")


def _read_secret_value(secret_id: str) -> str:
    try:
        return str(get_secret(secret_id) or "").strip()
    except Exception:
        return ""


def _selection_capabilities(provider_type: str) -> dict:
    normalized = normalize_provider_type(provider_type)
    if normalized == "gphotos":
        return {
            "supports_catalog": False,
            "supports_picker": True,
            "catalog_load_label": "",
            "picker_start_label": "Launch Picker",
            "resource_label_plural": "media items",
        }
    if normalized == "youtube":
        return {
            "supports_catalog": True,
            "supports_picker": False,
            "catalog_load_label": "Load Playlists",
            "picker_start_label": "",
            "resource_label_plural": "playlists",
        }
    if normalized == "gdrive":
        return {
            "supports_catalog": True,
            "supports_picker": False,
            "catalog_load_label": "Browse Folders",
            "picker_start_label": "",
            "resource_label_plural": "folders",
        }
    return {
        "supports_catalog": True,
        "supports_picker": False,
        "catalog_load_label": "Load Folders",
        "picker_start_label": "",
        "resource_label_plural": "folders",
    }


def _selection_state(provider_type: str, config_json: dict) -> dict:
    normalized = normalize_provider_type(provider_type)
    mode = normalize_selection_mode(normalized, config_json.get("selection_mode"))
    return {
        "selection_mode": mode,
        "sync_items": normalize_sync_items(config_json.get("sync_items")),
        "picker_session_id": normalize_picker_session_id(config_json.get("picker_session_id")),
        "selection_capabilities": _selection_capabilities(normalized),
    }


def _resolve_redirect_origin_from_request(request: Request, payload: dict | None = None) -> str:
    requested_redirect_origin = sanitize_redirect_origin((payload or {}).get("redirect_origin"))
    if not requested_redirect_origin:
        requested_redirect_origin = sanitize_redirect_origin(request.headers.get("origin"))
    if not requested_redirect_origin:
        referer = str(request.headers.get("referer") or "").strip()
        if referer:
            parts = urlsplit(referer)
            requested_redirect_origin = sanitize_redirect_origin(f"{parts.scheme}://{parts.netloc}")
    if not requested_redirect_origin:
        host = str(request.headers.get("host") or "").strip()
        if host:
            requested_redirect_origin = sanitize_redirect_origin(f"{request.url.scheme}://{host}")
    return requested_redirect_origin


def _build_dropbox_status(record) -> dict:
    config_json = record.config_json or {}
    connected = bool(config_json.get("token_stored"))
    issues: list[str] = []

    if connected:
        selected_mode = "managed"
        can_connect = True
    else:
        app_key = str(config_json.get("app_key") or "").strip()
        selected_mode = "managed" if app_key else "managed"
        can_connect = True  # managed OAuth is always available

    return {
        "id": "dropbox",  # Backward-compatible provider id used by existing UI/API callers.
        "provider_id": record.id,
        "provider_type": "dropbox",
        "label": _PROVIDER_LABELS["dropbox"],
        "integration_label": record.label,
        "is_active": bool(record.is_active),
        "connected": connected,
        "can_connect": can_connect,
        "mode": selected_mode,
        "issues": issues,
        "sync_folder_key": "dropbox_sync_folders",
        "sync_folders": normalize_sync_folders(config_json.get("sync_folders")),
        **_selection_state("dropbox", config_json),
        "source": record.source,
    }


def _gdrive_env_client_id() -> str:
    return str(_settings.zoltag_gdrive_connector_client_id or "").strip()


def _gdrive_env_client_secret() -> str:
    return str(_settings.zoltag_gdrive_connector_secret or "").strip()


def _resolve_gdrive_credentials(record) -> tuple[str, str]:
    """Return (client_id, client_secret), preferring env vars over per-record config."""
    config_json = record.config_json or {}
    client_id = _gdrive_env_client_id() or str(config_json.get("client_id") or "").strip()
    client_secret = _gdrive_env_client_secret() or _read_secret_value(record.gdrive_client_secret_name) or ""
    return client_id, client_secret


def _build_gdrive_status(record) -> dict:
    config_json = record.config_json or {}
    connected = bool(config_json.get("token_stored"))
    client_id = _gdrive_env_client_id() or str(config_json.get("client_id") or "").strip()

    issues: list[str] = []
    if not connected:
        if not client_id:
            issues.append("gdrive_client_id_not_configured")
        if not _gdrive_env_client_secret() and not config_json.get("client_secret_name"):
            issues.append("gdrive_client_secret_not_configured")
    can_connect = bool(client_id and not issues)

    return {
        "id": "gdrive",  # Backward-compatible provider id used by existing UI/API callers.
        "provider_id": record.id,
        "provider_type": "gdrive",
        "label": _PROVIDER_LABELS["gdrive"],
        "integration_label": record.label,
        "is_active": bool(record.is_active),
        "connected": connected,
        "can_connect": can_connect,
        "mode": "tenant_oauth",
        "issues": issues,
        "sync_folder_key": "gdrive_sync_folders",
        "sync_folders": normalize_sync_folders(config_json.get("sync_folders")),
        **_selection_state("gdrive", config_json),
        "source": record.source,
    }


def _build_gphotos_status(record) -> dict:
    config_json = record.config_json or {}
    connected = bool(config_json.get("token_stored"))
    client_id = str(_settings.zoltag_gdrive_connector_client_id or "").strip()
    can_connect = bool(client_id)
    return {
        "id": "gphotos",
        "provider_id": record.id,
        "provider_type": "gphotos",
        "label": _PROVIDER_LABELS["gphotos"],
        "integration_label": record.label,
        "is_active": bool(record.is_active),
        "connected": connected,
        "can_connect": can_connect,
        "mode": "tenant_oauth",
        "issues": [],
        "sync_folder_key": "gphotos_sync_folders",
        "sync_folders": normalize_sync_folders(config_json.get("sync_folders")),
        **_selection_state("gphotos", config_json),
        "source": record.source,
    }


def _build_youtube_status(record) -> dict:
    config_json = record.config_json or {}
    connected = bool(config_json.get("token_stored"))
    client_id = str(_settings.zoltag_gdrive_connector_client_id or "").strip()
    can_connect = bool(client_id)
    config_json = record.config_json or {}
    return {
        "id": "youtube",
        "provider_id": record.id,
        "provider_type": "youtube",
        "label": _PROVIDER_LABELS["youtube"],
        "integration_label": record.label,
        "is_active": bool(record.is_active),
        "connected": connected,
        "can_connect": can_connect,
        "mode": "tenant_oauth",
        "issues": [],
        "sync_folder_key": "youtube_sync_folders",
        "sync_folders": normalize_sync_folders(config_json.get("sync_folders")),
        **_selection_state("youtube", config_json),
        "source": record.source,
    }


def _provider_sync_definition_key(provider_type: str) -> str:
    normalized = normalize_provider_type(provider_type)
    definition_key = _PROVIDER_SYNC_DEFINITION_KEYS.get(normalized)
    if not definition_key:
        raise HTTPException(status_code=400, detail="Unsupported provider type")
    return definition_key


def _provider_connected(record) -> bool:
    config_json = record.config_json or {}
    return bool(config_json.get("token_stored"))


def _allowed_secret_scopes_for_tenant(tenant_row: TenantModel) -> set[str]:
    allowed: set[str] = set()
    for candidate in (
        getattr(tenant_row, "id", None),
        getattr(tenant_row, "key_prefix", None),
        getattr(tenant_row, "identifier", None),
    ):
        value = str(candidate or "").strip()
        if value:
            allowed.add(value)
    return allowed


def _assert_dropbox_provider_scope_safe(tenant_row: TenantModel, record) -> None:
    """Reject Dropbox provider rows that appear bound to a different tenant scope."""
    if str(getattr(record, "provider_type", "") or "").strip().lower() != "dropbox":
        return

    allowed_scopes = _allowed_secret_scopes_for_tenant(tenant_row)
    record_scope = str(getattr(record, "secret_scope", "") or "").strip()
    if record_scope and record_scope not in allowed_scopes:
        raise HTTPException(
            status_code=409,
            detail=(
                "Dropbox connection scope does not match this tenant. "
                "Disconnect and reconnect this provider from the current tenant."
            ),
        )

    token_secret_name = str(getattr(record, "dropbox_token_secret_name", "") or "").strip()
    if token_secret_name.startswith("dropbox-token-"):
        allowed_token_secret_names = {f"dropbox-token-{scope}" for scope in allowed_scopes}
        if token_secret_name not in allowed_token_secret_names:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Dropbox token secret appears bound to another tenant. "
                    "Disconnect and reconnect this provider from the current tenant."
                ),
            )


def _normalize_dropbox_path(path: str | None) -> str:
    value = str(path or "").strip()
    if not value or value == "/":
        return ""
    if not value.startswith("/"):
        value = f"/{value}"
    value = value.rstrip("/")
    return value or ""


def _extract_search_match_folder_path(match) -> str:
    metadata_union = getattr(match, "metadata", None)
    metadata = metadata_union
    if metadata_union is not None and hasattr(metadata_union, "get_metadata"):
        try:
            metadata = metadata_union.get_metadata()
        except Exception:
            metadata = metadata_union

    path_display = str(getattr(metadata, "path_display", "") or getattr(metadata, "path_lower", "") or "").strip()
    if not path_display:
        path_display = str(getattr(metadata_union, "path_display", "") or "").strip()
    if not path_display:
        return ""

    tag = str(getattr(metadata, "_tag", "") or "").strip().lower()
    if tag == "folder":
        return path_display

    # File match: use parent folder
    if "/" in path_display:
        parent = path_display.rsplit("/", 1)[0]
        return parent or "/"
    return "/"


def _is_dropbox_folder_entry(entry, folder_metadata_cls=None) -> bool:
    if folder_metadata_cls is not None:
        try:
            if isinstance(entry, folder_metadata_cls):
                return True
        except Exception:
            pass
    tag = str(getattr(entry, "_tag", "") or getattr(entry, "tag", "") or "").strip().lower()
    if tag.startswith("."):
        tag = tag[1:]
    if tag == "folder":
        return True
    if tag in {"file", "deleted"}:
        return False
    class_name = str(entry.__class__.__name__ or "").strip().lower()
    if class_name == "foldermetadata" or "foldermetadata" in class_name:
        return True
    if class_name == "filemetadata" or "filemetadata" in class_name or "deletedmetadata" in class_name:
        return False
    # Conservative fallback: file-like metadata almost always includes size.
    if getattr(entry, "size", None) is not None:
        return False
    return False


def _is_dropbox_file_entry(entry) -> bool:
    tag = str(getattr(entry, "_tag", "") or getattr(entry, "tag", "") or "").strip().lower()
    if tag.startswith("."):
        tag = tag[1:]
    if tag == "file":
        return True
    if tag in {"folder", "deleted"}:
        return False
    class_name = str(entry.__class__.__name__ or "").strip().lower()
    if class_name == "filemetadata" or "filemetadata" in class_name:
        return True
    if class_name == "foldermetadata" or "foldermetadata" in class_name or "deletedmetadata" in class_name:
        return False
    if getattr(entry, "size", None) is not None:
        return True
    return False


def _path_display_from_entry(entry) -> str:
    return str(getattr(entry, "path_display", "") or getattr(entry, "path_lower", "") or "").strip()


def _add_parent_folder_paths(path_display: str, ordered_paths: dict[str, bool]) -> None:
    path_value = str(path_display or "").strip()
    if not path_value or "/" not in path_value:
        return
    parent = path_value.rsplit("/", 1)[0]
    while parent and parent != "/":
        ordered_paths.setdefault(parent, True)
        if "/" not in parent:
            break
        parent = parent.rsplit("/", 1)[0]


def _add_folder_path_with_ancestors(path_display: str, ordered_paths: dict[str, bool]) -> None:
    path_value = str(path_display or "").strip()
    if not path_value:
        return
    if not path_value.startswith("/"):
        path_value = f"/{path_value}"
    if path_value != "/":
        path_value = path_value.rstrip("/")
    ordered_paths.setdefault(path_value or "/", True)
    _add_parent_folder_paths(path_value, ordered_paths)


def _dropbox_path_depth(path_display: str) -> int:
    value = str(path_display or "").strip().strip("/")
    if not value:
        return 0
    return len([segment for segment in value.split("/") if segment])


def _dropbox_relative_depth(path_display: str, root_path: str) -> int:
    return max(0, _dropbox_path_depth(path_display) - _dropbox_path_depth(root_path))


def _backfill_token_stored(all_records, repo, tenant_row, db: Session) -> None:
    """One-time migration: for records missing token_stored in config_json, probe Secret Manager
    and persist the flag so future requests are fast."""
    _secret_fn = {"dropbox": lambda r: r.dropbox_token_secret_name,
                  "gdrive": lambda r: r.gdrive_token_secret_name,
                  "youtube": lambda r: r.youtube_token_secret_name,
                  "gphotos": lambda r: r.gphotos_token_secret_name}
    dirty = False
    for rec in all_records:
        if "token_stored" in (rec.config_json or {}):
            continue
        fn = _secret_fn.get(rec.provider_type)
        if not fn:
            continue
        has_token = bool(_read_secret_value(fn(rec)))
        repo.update_provider(tenant_row, rec.provider_type, provider_id=rec.id,
                             config_json_patch={"token_stored": has_token})
        dirty = True
    if dirty:
        db.commit()


def _build_integrations_status(tenant_row: TenantModel, db: Session) -> dict:
    repo = TenantIntegrationRepository(db)
    # Fetch all records once; backfill token_stored flag if absent (one-time migration cost).
    all_records = repo.list_provider_records(tenant_row, include_inactive=True, include_placeholders=False)
    _backfill_token_stored(all_records, repo, tenant_row, db)
    # Re-fetch after potential commit so config_json reflects updated flags.
    all_records = repo.list_provider_records(tenant_row, include_inactive=True, include_placeholders=False)
    primary_records = repo.get_primary_records_by_type(tenant_row)

    dropbox_status = _build_dropbox_status(primary_records["dropbox"])
    gdrive_status = _build_gdrive_status(primary_records["gdrive"])
    youtube_status = _build_youtube_status(primary_records["youtube"])
    gphotos_status = _build_gphotos_status(primary_records["gphotos"])
    providers = [dropbox_status, gdrive_status, youtube_status, gphotos_status]

    default_provider = repo.resolve_default_sync_provider(tenant_row)
    default_source_provider = default_provider.provider_type
    provider_configs = {provider["id"]: provider for provider in providers}

    # Build status for every instance (all rows, not just primary).
    _build_fn = {
        "dropbox": _build_dropbox_status,
        "gdrive": _build_gdrive_status,
        "youtube": _build_youtube_status,
        "gphotos": _build_gphotos_status,
    }
    all_providers_status = []
    for rec in all_records:
        fn = _build_fn.get(rec.provider_type)
        if fn:
            all_providers_status.append(fn(rec))

    active_provider = provider_configs.get(default_source_provider) or dropbox_status
    return {
        "tenant_id": str(tenant_row.id),
        "default_source_provider": default_source_provider,
        "providers": all_providers_status,
        "provider_configs": provider_configs,
        "source_provider_options": [
            {"id": "dropbox", "label": _PROVIDER_LABELS["dropbox"]},
            {"id": "gdrive", "label": _PROVIDER_LABELS["gdrive"]},
            {"id": "youtube", "label": _PROVIDER_LABELS["youtube"]},
            {"id": "gphotos", "label": _PROVIDER_LABELS["gphotos"]},
        ],
        # Backward-compatible fields for existing UI callers.
        "source_provider": default_source_provider,
        "sync_folder_key": active_provider["sync_folder_key"],
        "sync_folders": active_provider["sync_folders"],
        "connected": dropbox_status["connected"],
        "can_connect": dropbox_status["can_connect"],
        "mode": dropbox_status["mode"],
        "issues": dropbox_status["issues"],
    }


def _serialize_provider_record(record) -> dict:
    config_json = dict(record.config_json or {})
    config_json["sync_folders"] = normalize_sync_folders(config_json.get("sync_folders"))
    config_json["sync_items"] = normalize_sync_items(config_json.get("sync_items"))
    config_json["selection_mode"] = normalize_selection_mode(record.provider_type, config_json.get("selection_mode"))
    config_json["picker_session_id"] = normalize_picker_session_id(config_json.get("picker_session_id"))
    return {
        "id": record.id,
        "tenant_id": record.tenant_id,
        "provider_type": record.provider_type,
        "label": record.label,
        "is_active": record.is_active,
        "is_default_sync_source": record.is_default_sync_source,
        "secret_scope": record.secret_scope,
        "config_json": config_json,
        "source": record.source,
    }


@router.get("/status")
async def get_integrations_status(
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("provider.view")),
    db: Session = Depends(get_db),
):
    """Get integration connection/config status for current tenant."""
    tenant_row = db.query(TenantModel).filter(TenantModel.id == tenant.id).first()
    if not tenant_row:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return _build_integrations_status(tenant_row, db)


@router.get("/dropbox/folders")
async def list_live_dropbox_folders(
    q: str | None = None,
    path: str | None = None,
    limit: int = 100,
    depth: int | None = None,
    mode: str | None = None,
    provider_id: str | None = None,
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("provider.view")),
    db: Session = Depends(get_db),
):
    """Live Dropbox folder browse/search for provider sync-folder selection."""
    tenant_row = db.query(TenantModel).filter(TenantModel.id == tenant.id).first()
    if not tenant_row:
        raise HTTPException(status_code=404, detail="Tenant not found")

    repo = TenantIntegrationRepository(db)
    try:
        dropbox_record = repo.get_provider_record(tenant_row, "dropbox", provider_id=provider_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    _assert_dropbox_provider_scope_safe(tenant_row, dropbox_record)

    refresh_token = _read_secret_value(dropbox_record.dropbox_token_secret_name)
    if not refresh_token:
        raise HTTPException(status_code=400, detail="Dropbox is not connected for this tenant")

    try:
        credentials = load_dropbox_oauth_credentials(
            tenant_id=dropbox_record.secret_scope,
            tenant_app_key=str(dropbox_record.config_json.get("app_key") or "").strip(),
            tenant_app_secret_name=dropbox_record.dropbox_app_secret_name,
            get_secret=get_secret,
            selection_mode="managed_only",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        from dropbox import Dropbox
        from dropbox.files import FolderMetadata, SearchOptions

        client = Dropbox(
            oauth2_refresh_token=refresh_token,
            app_key=credentials["app_key"],
            app_secret=credentials["app_secret"],
        )

        query = str(q or "").strip()
        mode_value = str(mode or "").strip().lower()
        browse_path = _normalize_dropbox_path(path)
        max_results = max(1, min(int(limit or 100), 2000))
        max_depth = max(0, min(int(depth if depth is not None else 5), 5))
        ordered_paths: dict[str, bool] = {}
        has_more = False
        truncated = False

        if mode_value in {"roots", "root"}:
            # Pass 1: fast top-level folder fetch only.
            result = client.files_list_folder("", recursive=False, limit=max_results)
            while True:
                for entry in (getattr(result, "entries", None) or []):
                    folder_path = _path_display_from_entry(entry)
                    if _is_dropbox_folder_entry(entry, FolderMetadata):
                        _add_folder_path_with_ancestors(folder_path, ordered_paths)
                    elif folder_path and not _is_dropbox_file_entry(entry):
                        _add_folder_path_with_ancestors(folder_path, ordered_paths)
                if len(ordered_paths) >= max_results:
                    truncated = True
                    has_more = True
                    break
                if not getattr(result, "has_more", False):
                    break
                result = client.files_list_folder_continue(result.cursor)
            if query:
                query_lower = query.lower()
                ordered_paths = {
                    folder: True
                    for folder in ordered_paths.keys()
                    if query_lower in folder.lower()
                }
            has_more = has_more or bool(getattr(result, "has_more", False))
        elif mode_value == "branch":
            # Pass 2: enumerate one root branch recursively and cap by relative depth.
            result = client.files_list_folder(browse_path, recursive=True, limit=max_results)
            if browse_path:
                ordered_paths.setdefault(browse_path, True)
            while True:
                for entry in (getattr(result, "entries", None) or []):
                    folder_path = _path_display_from_entry(entry)
                    candidate_path = ""
                    if _is_dropbox_folder_entry(entry, FolderMetadata):
                        candidate_path = folder_path
                    elif folder_path:
                        if _is_dropbox_file_entry(entry):
                            if "/" in folder_path:
                                candidate_path = folder_path.rsplit("/", 1)[0]
                            else:
                                candidate_path = "/"
                        else:
                            candidate_path = folder_path
                    normalized_candidate = _normalize_dropbox_path(candidate_path)
                    if candidate_path == "/":
                        normalized_candidate = ""
                    if browse_path:
                        if normalized_candidate != browse_path and not normalized_candidate.startswith(f"{browse_path}/"):
                            continue
                    if _dropbox_relative_depth(normalized_candidate, browse_path) > max_depth:
                        continue
                    if normalized_candidate:
                        ordered_paths.setdefault(normalized_candidate, True)
                if len(ordered_paths) >= max_results:
                    truncated = True
                    has_more = True
                    break
                if not getattr(result, "has_more", False):
                    break
                result = client.files_list_folder_continue(result.cursor)
            if query:
                query_lower = query.lower()
                ordered_paths = {
                    folder: True
                    for folder in ordered_paths.keys()
                    if query_lower in folder.lower()
                }
            has_more = has_more or bool(getattr(result, "has_more", False))
        elif mode_value == "full":
            # Full recursive folder catalog (explicit user action only).
            result = client.files_list_folder(browse_path, recursive=True, limit=max_results)
            while True:
                for entry in (getattr(result, "entries", None) or []):
                    folder_path = _path_display_from_entry(entry)
                    if _is_dropbox_folder_entry(entry, FolderMetadata):
                        _add_folder_path_with_ancestors(folder_path, ordered_paths)
                    elif folder_path:
                        # Defensive fallback: derive folder paths from file paths or unknown entries.
                        if _is_dropbox_file_entry(entry):
                            _add_parent_folder_paths(folder_path, ordered_paths)
                        else:
                            _add_folder_path_with_ancestors(folder_path, ordered_paths)
                if len(ordered_paths) >= max_results:
                    truncated = True
                    has_more = True
                    break
                if not getattr(result, "has_more", False):
                    break
                result = client.files_list_folder_continue(result.cursor)
            if query:
                query_lower = query.lower()
                ordered_paths = {
                    folder: True
                    for folder in ordered_paths.keys()
                    if query_lower in folder.lower()
                }
            has_more = has_more or bool(getattr(result, "has_more", False))
            if not ordered_paths:
                # Last-resort fallback to already configured sync folders.
                configured = normalize_sync_folders((dropbox_record.config_json or {}).get("sync_folders"))
                for configured_path in configured:
                    _add_folder_path_with_ancestors(configured_path, ordered_paths)
        elif query:
            options = SearchOptions(path=browse_path, max_results=max_results)
            result = client.files_search_v2(query=query, options=options)
            for match in (getattr(result, "matches", None) or []):
                folder_path = _extract_search_match_folder_path(match)
                if folder_path:
                    ordered_paths.setdefault(folder_path, True)
            has_more = bool(getattr(result, "has_more", False))
        else:
            result = client.files_list_folder(browse_path, recursive=False, limit=max_results)
            for entry in (getattr(result, "entries", None) or []):
                folder_path = _path_display_from_entry(entry)
                if _is_dropbox_folder_entry(entry, FolderMetadata):
                    ordered_paths.setdefault(folder_path, True)
            has_more = bool(getattr(result, "has_more", False))

        return {
            "tenant_id": str(tenant_row.id),
            "provider": "dropbox",
            "provider_id": str(dropbox_record.id or ""),
            "query": query,
            "path": browse_path or "/",
            "folders": list(ordered_paths.keys()),
            "has_more": has_more,
            "truncated": truncated,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Dropbox folder lookup failed: {exc}")


@router.get("/gdrive/folders")
async def list_live_gdrive_folders(
    parent_id: str | None = None,
    q: str | None = None,
    limit: int = 200,
    ids: str | None = None,
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("provider.view")),
    db: Session = Depends(get_db),
):
    """Live Google Drive folder browser for provider sync-folder selection.

    Pass ``ids`` as a comma-separated list of folder IDs to resolve their names
    instead of listing children of a parent.
    """
    from zoltag.storage.providers import GoogleDriveStorageProvider

    tenant_row = db.query(TenantModel).filter(TenantModel.id == tenant.id).first()
    if not tenant_row:
        raise HTTPException(status_code=404, detail="Tenant not found")

    repo = TenantIntegrationRepository(db)
    record = repo.get_provider_record(tenant_row, "gdrive")
    if not record:
        raise HTTPException(status_code=404, detail="Google Drive provider not found")

    refresh_token = _read_secret_value(record.gdrive_token_secret_name)
    if not refresh_token:
        raise HTTPException(status_code=400, detail="Google Drive is not connected for this tenant")

    client_id, client_secret = _resolve_gdrive_credentials(record)
    if not client_id or not client_secret:
        raise HTTPException(status_code=400, detail="Google Drive client credentials are not configured for this tenant")

    try:
        provider = GoogleDriveStorageProvider(
            client_id=client_id,
            client_secret=client_secret,
            refresh_token=refresh_token,
        )

        # Resolve specific folder IDs to names (used to label configured sync folders).
        if ids:
            folder_ids = [fid.strip() for fid in ids.split(",") if fid.strip()]
            folders = []
            for fid in folder_ids:
                try:
                    meta = provider._get_file(fid)
                    folders.append({"id": fid, "name": meta.get("name") or fid})
                except Exception:
                    folders.append({"id": fid, "name": fid})
            return {"folders": folders, "has_more": False, "parent_id": None}

        folders, has_more = provider.list_folders(parent_id=parent_id or None, limit=max(1, min(int(limit), 1000)))
        if q:
            q_lower = q.strip().lower()
            folders = [f for f in folders if q_lower in f["name"].lower()]
        return {"folders": folders, "has_more": has_more, "parent_id": parent_id}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Google Drive folder lookup failed: {exc}")


@router.get("/dropbox/status")
async def get_dropbox_status(
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("provider.view")),
    db: Session = Depends(get_db),
):
    """Backward-compatible Dropbox status endpoint for current tenant."""
    tenant_row = db.query(TenantModel).filter(TenantModel.id == tenant.id).first()
    if not tenant_row:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return _build_integrations_status(tenant_row, db)


@router.get("/providers")
async def list_integration_providers(
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("provider.view")),
    db: Session = Depends(get_db),
):
    """List provider rows for the current tenant (v2 table + fallback projection)."""
    tenant_row = db.query(TenantModel).filter(TenantModel.id == tenant.id).first()
    if not tenant_row:
        raise HTTPException(status_code=404, detail="Tenant not found")

    repo = TenantIntegrationRepository(db)
    records = repo.list_provider_records(tenant_row, include_inactive=True, include_placeholders=False)
    return {
        "tenant_id": str(tenant_row.id),
        "providers": [_serialize_provider_record(record) for record in records],
    }


@router.post("/providers")
async def create_integration_provider(
    payload: dict,
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("provider.manage")),
    db: Session = Depends(get_db),
):
    """Create a provider row for the current tenant."""
    tenant_row = db.query(TenantModel).filter(TenantModel.id == tenant.id).first()
    if not tenant_row:
        raise HTTPException(status_code=404, detail="Tenant not found")

    provider_type = _normalize_provider_or_400(payload.get("provider_type"))
    repo = TenantIntegrationRepository(db)
    record = repo.create_provider(
        tenant_row,
        provider_type,
        label=str(payload.get("label") or "").strip() or None,
        is_active=bool(payload.get("is_active", False)),
        is_default_sync_source=bool(payload.get("is_default_sync_source", False)),
        secret_scope=str(payload.get("secret_scope") or "").strip() or None,
        config_json=payload.get("config_json") if isinstance(payload.get("config_json"), dict) else None,
    )
    db.commit()
    return {"status": "created", "provider": _serialize_provider_record(record)}


@router.patch("/providers/{provider_id}")
async def update_integration_provider(
    provider_id: str,
    payload: dict,
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("provider.manage")),
    db: Session = Depends(get_db),
):
    """Update one provider row for the current tenant."""
    tenant_row = db.query(TenantModel).filter(TenantModel.id == tenant.id).first()
    if not tenant_row:
        raise HTTPException(status_code=404, detail="Tenant not found")

    repo = TenantIntegrationRepository(db)
    existing = repo.get_provider_record_by_id(tenant_row, provider_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Provider not found")

    update_kwargs: dict = {}
    if "label" in payload:
        update_kwargs["label"] = str(payload.get("label") or "").strip()
    if "is_active" in payload:
        update_kwargs["is_active"] = bool(payload.get("is_active"))
    if "is_default_sync_source" in payload:
        update_kwargs["is_default_sync_source"] = bool(payload.get("is_default_sync_source"))
    if "sync_folders" in payload:
        update_kwargs["sync_folders"] = normalize_sync_folders(payload.get("sync_folders"))
    if "sync_items" in payload:
        update_kwargs["sync_items"] = normalize_sync_items(payload.get("sync_items"))
    if "selection_mode" in payload:
        update_kwargs["selection_mode"] = normalize_selection_mode(existing.provider_type, payload.get("selection_mode"))
    if "picker_session_id" in payload:
        update_kwargs["picker_session_id"] = normalize_picker_session_id(payload.get("picker_session_id"))
    if "oauth_mode" in payload:
        requested_mode = str(payload.get("oauth_mode") or "").strip().lower()
        if requested_mode not in {"", "managed"}:
            raise HTTPException(status_code=400, detail="Only managed oauth_mode is supported")
        update_kwargs["oauth_mode"] = "managed"
    if "app_key" in payload:
        update_kwargs["app_key"] = payload.get("app_key")
    if "client_id" in payload:
        update_kwargs["client_id"] = payload.get("client_id")
    if "client_secret_name" in payload:
        update_kwargs["client_secret_name"] = payload.get("client_secret_name")
    if "token_secret_name" in payload:
        update_kwargs["token_secret_name"] = payload.get("token_secret_name")
    if isinstance(payload.get("config_json"), dict):
        update_kwargs["config_json_patch"] = payload.get("config_json")

    record = repo.update_provider(
        tenant_row,
        existing.provider_type,
        provider_id=provider_id,
        **update_kwargs,
    )
    db.commit()
    return {"status": "updated", "provider": _serialize_provider_record(record)}


@router.delete("/providers/{provider_id}")
async def delete_integration_provider(
    provider_id: str,
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("provider.manage")),
    db: Session = Depends(get_db),
):
    """Delete one provider row for the current tenant."""
    tenant_row = db.query(TenantModel).filter(TenantModel.id == tenant.id).first()
    if not tenant_row:
        raise HTTPException(status_code=404, detail="Tenant not found")

    repo = TenantIntegrationRepository(db)
    deleted = repo.delete_provider(tenant_row, provider_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Provider not found")
    db.commit()
    return {"status": "deleted", "provider_id": provider_id}


@router.post("/providers/{provider_id}/connect")
async def start_provider_connect(
    provider_id: str,
    request: Request,
    payload: dict | None = None,
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("provider.manage")),
    db: Session = Depends(get_db),
):
    """Generate provider OAuth authorize URL for one explicit provider row."""
    tenant_row = db.query(TenantModel).filter(TenantModel.id == tenant.id).first()
    if not tenant_row:
        raise HTTPException(status_code=404, detail="Tenant not found")

    repo = TenantIntegrationRepository(db)
    record = repo.get_provider_record_by_id(tenant_row, provider_id)
    if not record:
        raise HTTPException(status_code=404, detail="Provider not found")

    requested_return_to = (payload or {}).get("return_to")
    requested_redirect_origin = _resolve_redirect_origin_from_request(request, payload)
    return_to = sanitize_return_path(requested_return_to)
    query_payload = {
        "tenant": tenant.id,
        "flow": "redirect",
        "return_to": return_to,
        "provider_id": provider_id,
    }
    if requested_redirect_origin:
        query_payload["redirect_origin"] = requested_redirect_origin

    if record.provider_type == "dropbox":
        _assert_dropbox_provider_scope_safe(tenant_row, record)
        dropbox_status = _build_dropbox_status(record)
        if not dropbox_status["can_connect"]:
            raise HTTPException(status_code=400, detail="Dropbox OAuth is not configured for this provider")
        query_payload["credential_mode"] = "managed"
        query_payload["force_reauthentication"] = "true"
        query_payload["force_reapprove"] = "true"
        return {
            "tenant_id": tenant.id,
            "provider": "dropbox",
            "provider_id": provider_id,
            "authorize_url": f"/oauth/dropbox/authorize?{urlencode(query_payload)}",
            "mode": dropbox_status["mode"],
        }

    if record.provider_type == "gdrive":
        gdrive_status = _build_gdrive_status(record)
        if not gdrive_status["can_connect"]:
            raise HTTPException(status_code=400, detail="Google Drive OAuth is not configured for this provider")
        return {
            "tenant_id": tenant.id,
            "provider": "gdrive",
            "provider_id": provider_id,
            "authorize_url": f"/oauth/gdrive/authorize?{urlencode(query_payload)}",
            "mode": gdrive_status["mode"],
        }

    if record.provider_type == "youtube":
        youtube_status = _build_youtube_status(record)
        if not youtube_status["can_connect"]:
            raise HTTPException(status_code=400, detail="YouTube OAuth is not configured for this provider")
        return {
            "tenant_id": tenant.id,
            "provider": "youtube",
            "provider_id": provider_id,
            "authorize_url": f"/oauth/youtube/authorize?{urlencode(query_payload)}",
            "mode": youtube_status["mode"],
        }

    if record.provider_type == "gphotos":
        gphotos_status = _build_gphotos_status(record)
        if not gphotos_status["can_connect"]:
            raise HTTPException(status_code=400, detail="Google Photos OAuth is not configured for this provider")
        return {
            "tenant_id": tenant.id,
            "provider": "gphotos",
            "provider_id": provider_id,
            "authorize_url": f"/oauth/gphotos/authorize?{urlencode(query_payload)}",
            "mode": gphotos_status["mode"],
        }

    raise HTTPException(status_code=400, detail="Unsupported provider type")


@router.delete("/providers/{provider_id}/connection")
async def disconnect_provider_connection(
    provider_id: str,
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("provider.manage")),
    db: Session = Depends(get_db),
):
    """Disconnect one provider row by deleting its token secret."""
    tenant_row = db.query(TenantModel).filter(TenantModel.id == tenant.id).first()
    if not tenant_row:
        raise HTTPException(status_code=404, detail="Tenant not found")

    repo = TenantIntegrationRepository(db)
    record = repo.get_provider_record_by_id(tenant_row, provider_id)
    if not record:
        raise HTTPException(status_code=404, detail="Provider not found")

    if record.provider_type == "dropbox":
        _assert_dropbox_provider_scope_safe(tenant_row, record)
        delete_secret(record.dropbox_token_secret_name)
    elif record.provider_type == "gdrive":
        delete_secret(record.gdrive_token_secret_name)
    elif record.provider_type == "youtube":
        delete_secret(record.youtube_token_secret_name)
    elif record.provider_type == "gphotos":
        delete_secret(record.gphotos_token_secret_name)
    else:
        raise HTTPException(status_code=400, detail="Unsupported provider type")

    repo.update_provider(
        tenant_row,
        record.provider_type,
        provider_id=provider_id,
        config_json_patch={"token_stored": False},
    )
    db.commit()

    return {
        "tenant_id": tenant.id,
        "provider": record.provider_type,
        "provider_id": provider_id,
        "status": "disconnected",
    }


@router.post("/providers/{provider_id}/sync")
async def enqueue_provider_sync(
    provider_id: str,
    payload: dict | None = None,
    tenant: Tenant = Depends(get_tenant),
    admin: UserProfile = Depends(require_tenant_permission_from_header("provider.manage")),
    db: Session = Depends(get_db),
):
    """Queue a provider-scoped sync job for one integration row."""
    tenant_row = db.query(TenantModel).filter(TenantModel.id == tenant.id).first()
    if not tenant_row:
        raise HTTPException(status_code=404, detail="Tenant not found")

    repo = TenantIntegrationRepository(db)
    record = repo.get_provider_record_by_id(tenant_row, provider_id)
    if not record:
        raise HTTPException(status_code=404, detail="Provider not found")
    if record.provider_type == "dropbox":
        _assert_dropbox_provider_scope_safe(tenant_row, record)
    if not bool(record.is_active):
        raise HTTPException(
            status_code=409,
            detail="Provider integration is inactive. Activate this provider before syncing.",
        )
    if not _provider_connected(record):
        raise HTTPException(status_code=409, detail="Provider is not connected. Connect this provider before syncing.")

    definition_key = _provider_sync_definition_key(record.provider_type)
    definition = db.query(JobDefinition).filter(
        JobDefinition.key == definition_key,
        JobDefinition.is_active.is_(True),
    ).first()
    if not definition:
        raise HTTPException(status_code=409, detail=f"Sync job definition is missing or inactive: {definition_key}")

    requested_payload = payload or {}
    if not isinstance(requested_payload, dict):
        raise HTTPException(status_code=400, detail="payload must be an object")

    job_payload = {"provider_id": str(record.id)}
    count_raw = requested_payload.get("count")
    if count_raw not in (None, ""):
        try:
            count = int(count_raw)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="count must be an integer")
        if count < 1 or count > 10000:
            raise HTTPException(status_code=400, detail="count must be between 1 and 10000")
        job_payload["count"] = count
    if bool(requested_payload.get("reprocess_existing")):
        job_payload["reprocess_existing"] = True

    tenant_uuid = UUID(str(tenant.id))
    dedupe_key = f"provider-sync:{record.id}"
    existing = db.query(Job).filter(
        Job.tenant_id == tenant_uuid,
        Job.dedupe_key == dedupe_key,
        Job.status.in_(("queued", "running")),
    ).order_by(Job.queued_at.desc()).first()
    if existing:
        return {
            "tenant_id": str(tenant.id),
            "provider_id": str(record.id),
            "provider_type": record.provider_type,
            "definition_key": definition_key,
            "job_id": str(existing.id),
            "status": "already_queued",
        }

    now = datetime.utcnow()
    job = Job(
        tenant_id=tenant_uuid,
        definition_id=definition.id,
        source="manual",
        status="queued",
        priority=100,
        payload=job_payload,
        dedupe_key=dedupe_key,
        scheduled_for=now,
        queued_at=now,
        max_attempts=int(definition.max_attempts or 3),
        created_by=admin.supabase_uid,
    )
    db.add(job)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.query(Job).filter(
            Job.tenant_id == tenant_uuid,
            Job.dedupe_key == dedupe_key,
            Job.status.in_(("queued", "running")),
        ).order_by(Job.queued_at.desc()).first()
        if existing:
            return {
                "tenant_id": str(tenant.id),
                "provider_id": str(record.id),
                "provider_type": record.provider_type,
                "definition_key": definition_key,
                "job_id": str(existing.id),
                "status": "already_queued",
            }
        raise HTTPException(status_code=409, detail="Sync job enqueue conflict")

    db.refresh(job)
    return {
        "tenant_id": str(tenant.id),
        "provider_id": str(record.id),
        "provider_type": record.provider_type,
        "definition_key": definition_key,
        "job_id": str(job.id),
        "status": "queued",
    }


def _build_gphotos_provider_or_400(record):
    from zoltag.storage.providers import GooglePhotosStorageProvider

    refresh_token = _read_secret_value(record.gphotos_token_secret_name)
    if not refresh_token:
        raise HTTPException(status_code=400, detail="Google Photos is not connected for this provider")

    client_id = str(_settings.zoltag_gdrive_connector_client_id or "").strip()
    client_secret = str(_settings.zoltag_gdrive_connector_secret or "").strip()
    if not client_id or not client_secret:
        raise HTTPException(status_code=400, detail="Google Photos client credentials are not configured")

    return GooglePhotosStorageProvider(
        client_id=client_id,
        client_secret=client_secret,
        refresh_token=refresh_token,
    )


@router.post("/providers/{provider_id}/picker/session")
async def start_provider_picker_session(
    provider_id: str,
    payload: dict | None = None,
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("provider.manage")),
    db: Session = Depends(get_db),
):
    """Start picker flow for provider rows that support picker selection."""
    tenant_row = db.query(TenantModel).filter(TenantModel.id == tenant.id).first()
    if not tenant_row:
        raise HTTPException(status_code=404, detail="Tenant not found")

    repo = TenantIntegrationRepository(db)
    record = repo.get_provider_record_by_id(tenant_row, provider_id)
    if not record:
        raise HTTPException(status_code=404, detail="Provider not found")
    if record.provider_type != "gphotos":
        raise HTTPException(status_code=400, detail="Picker mode is not supported for this provider")

    max_item_count = int((payload or {}).get("max_item_count") or 2000)
    max_item_count = max(1, min(max_item_count, 10000))

    try:
        provider = _build_gphotos_provider_or_400(record)
        session_payload = provider.create_picker_session(max_item_count=max_item_count)
        return {"provider_id": provider_id, "provider_type": record.provider_type, **session_payload}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Provider picker session creation failed: {exc}")


@router.get("/providers/{provider_id}/picker/session")
async def get_provider_picker_session(
    provider_id: str,
    session_id: str,
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("provider.view")),
    db: Session = Depends(get_db),
):
    """Read picker session details for provider rows that support picker selection."""
    tenant_row = db.query(TenantModel).filter(TenantModel.id == tenant.id).first()
    if not tenant_row:
        raise HTTPException(status_code=404, detail="Tenant not found")

    repo = TenantIntegrationRepository(db)
    record = repo.get_provider_record_by_id(tenant_row, provider_id)
    if not record:
        raise HTTPException(status_code=404, detail="Provider not found")
    if record.provider_type != "gphotos":
        raise HTTPException(status_code=400, detail="Picker mode is not supported for this provider")

    normalized_session_id = str(session_id or "").strip()
    if not normalized_session_id:
        raise HTTPException(status_code=400, detail="session_id is required")

    try:
        provider = _build_gphotos_provider_or_400(record)
        session_payload = provider.get_picker_session(normalized_session_id)
        return {"provider_id": provider_id, "provider_type": record.provider_type, **session_payload}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Provider picker session lookup failed: {exc}")


@router.get("/providers/{provider_id}/picker/items")
async def list_provider_picker_items(
    provider_id: str,
    session_id: str,
    limit: int = 1000,
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("provider.view")),
    db: Session = Depends(get_db),
):
    """List picker-selected media items for provider rows that support picker selection."""
    tenant_row = db.query(TenantModel).filter(TenantModel.id == tenant.id).first()
    if not tenant_row:
        raise HTTPException(status_code=404, detail="Tenant not found")

    repo = TenantIntegrationRepository(db)
    record = repo.get_provider_record_by_id(tenant_row, provider_id)
    if not record:
        raise HTTPException(status_code=404, detail="Provider not found")
    if record.provider_type != "gphotos":
        raise HTTPException(status_code=400, detail="Picker mode is not supported for this provider")

    normalized_session_id = str(session_id or "").strip()
    if not normalized_session_id:
        raise HTTPException(status_code=400, detail="session_id is required")
    bounded_limit = max(1, min(int(limit or 1000), 5000))

    try:
        provider = _build_gphotos_provider_or_400(record)
        items = provider.list_picker_media_items(normalized_session_id, limit=bounded_limit)
        return {
            "provider_id": provider_id,
            "provider_type": record.provider_type,
            "session_id": normalized_session_id,
            "items": items,
            "count": len(items),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Provider picker items lookup failed: {exc}")


@router.patch("/dropbox/config")
async def update_dropbox_config(
    payload: dict,
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("provider.manage")),
    db: Session = Depends(get_db),
):
    """Update tenant integration sync source and provider sync folders."""
    tenant_row = db.query(TenantModel).filter(TenantModel.id == tenant.id).first()
    if not tenant_row:
        raise HTTPException(status_code=404, detail="Tenant not found")

    repo = TenantIntegrationRepository(db)

    target_provider: str | None = None
    if "default_source_provider" in payload:
        provider = _normalize_provider_or_400(payload.get("default_source_provider"))
        repo.set_default_sync_provider(tenant_row, provider)

    if "provider" in payload:
        target_provider = _normalize_provider_or_400(payload.get("provider"))

    # Backward compatibility for older payload shape.
    if "source_provider" in payload:
        source_provider = _normalize_provider_or_400(payload.get("source_provider"))
        repo.set_default_sync_provider(tenant_row, source_provider)
        if target_provider is None:
            target_provider = source_provider

    if "sync_folders" in payload:
        if target_provider is None:
            target_provider = repo.resolve_default_sync_provider(tenant_row).provider_type
        repo.update_provider(
            tenant_row,
            target_provider,
            sync_folders=normalize_sync_folders(payload.get("sync_folders")),
        )

    if "is_active" in payload:
        if target_provider is None:
            target_provider = repo.resolve_default_sync_provider(tenant_row).provider_type
        repo.update_provider(
            tenant_row,
            target_provider,
            is_active=bool(payload.get("is_active")),
        )

    db.commit()

    refreshed = db.query(TenantModel).filter(TenantModel.id == tenant.id).first()
    status = _build_integrations_status(refreshed, db)
    status["status"] = "updated"
    return status


@router.patch("/gdrive/credentials")
async def update_gdrive_credentials(
    payload: dict,
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("provider.manage")),
    db: Session = Depends(get_db),
):
    """Save Google Drive OAuth client_id and client_secret for a tenant."""
    tenant_row = db.query(TenantModel).filter(TenantModel.id == tenant.id).first()
    if not tenant_row:
        raise HTTPException(status_code=404, detail="Tenant not found")

    client_id = str(payload.get("client_id") or "").strip()
    client_secret = str(payload.get("client_secret") or "").strip()
    if not client_id or not client_secret:
        raise HTTPException(status_code=400, detail="client_id and client_secret are required")

    repo = TenantIntegrationRepository(db)
    record = repo.get_provider_record(tenant_row, "gdrive")

    # Persist client_id in config_json; write client_secret to Secret Manager.
    repo.update_provider(tenant_row, "gdrive", client_id=client_id)
    db.commit()

    # Re-fetch to get updated record with correct secret name.
    record = repo.get_provider_record(tenant_row, "gdrive")
    store_secret(record.gdrive_client_secret_name, client_secret)

    refreshed = db.query(TenantModel).filter(TenantModel.id == tenant.id).first()
    status = _build_integrations_status(refreshed, db)
    status["status"] = "updated"
    return status


@router.patch("/gdrive/config")
async def update_gdrive_config(
    payload: dict,
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("provider.manage")),
    db: Session = Depends(get_db),
):
    """Update Google Drive integration sync source and provider sync folders."""
    # Ensure provider is always set to gdrive so the shared handler routes correctly.
    merged = dict(payload)
    merged.setdefault("provider", "gdrive")
    return await update_dropbox_config(merged, tenant=tenant, _admin=_admin, db=db)


@router.get("/gphotos/albums")
async def list_live_gphotos_albums(
    provider_id: str | None = None,
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("provider.view")),
    db: Session = Depends(get_db),
):
    """List the authenticated user's Google Photos albums."""
    tenant_row = db.query(TenantModel).filter(TenantModel.id == tenant.id).first()
    if not tenant_row:
        raise HTTPException(status_code=404, detail="Tenant not found")

    repo = TenantIntegrationRepository(db)
    try:
        record = repo.get_provider_record(tenant_row, "gphotos", provider_id=provider_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    try:
        provider = _build_gphotos_provider_or_400(record)
        albums = provider.list_albums()
        return {"albums": albums}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Google Photos album lookup failed: {exc}")


@router.get("/youtube/playlists")
async def list_live_youtube_playlists(
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("provider.view")),
    db: Session = Depends(get_db),
):
    """List the authenticated YouTube channel's playlists."""
    from zoltag.storage.providers import YouTubeStorageProvider

    tenant_row = db.query(TenantModel).filter(TenantModel.id == tenant.id).first()
    if not tenant_row:
        raise HTTPException(status_code=404, detail="Tenant not found")

    repo = TenantIntegrationRepository(db)
    record = repo.get_provider_record(tenant_row, "youtube")

    refresh_token = _read_secret_value(record.youtube_token_secret_name)
    if not refresh_token:
        raise HTTPException(status_code=400, detail="YouTube is not connected for this tenant")

    client_id = str(_settings.zoltag_gdrive_connector_client_id or "").strip()
    client_secret = str(_settings.zoltag_gdrive_connector_secret or "").strip()
    if not client_id or not client_secret:
        raise HTTPException(status_code=400, detail="YouTube client credentials are not configured")

    try:
        provider = YouTubeStorageProvider(
            client_id=client_id,
            client_secret=client_secret,
            refresh_token=refresh_token,
        )
        playlists = provider.list_folders()
        return {"playlists": playlists}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"YouTube playlist lookup failed: {exc}")
