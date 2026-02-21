"""Tenant-admin integrations endpoints."""

from urllib.parse import urlencode, urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from zoltag.auth.dependencies import require_tenant_permission_from_header
from zoltag.auth.models import UserProfile
from zoltag.database import get_db
from zoltag.dependencies import delete_secret, get_secret, get_tenant
from zoltag.dropbox_oauth import (
    inspect_dropbox_oauth_config,
    load_dropbox_oauth_credentials,
    sanitize_redirect_origin,
    sanitize_return_path,
)
from zoltag.integrations import (
    TenantIntegrationRepository,
    normalize_provider_type,
    normalize_sync_folders,
)
from zoltag.metadata import Tenant as TenantModel
from zoltag.tenant import Tenant

router = APIRouter(prefix="/api/v1/admin/integrations", tags=["admin-integrations"])
_PROVIDER_LABELS = {
    "dropbox": "Dropbox",
    "gdrive": "Google Drive",
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
    token_value = _read_secret_value(record.dropbox_token_secret_name)
    connected = bool(token_value)
    config_json = record.config_json or {}

    if connected:
        selected_mode = "managed"
        can_connect = True
        issues: list[str] = []
    else:
        oauth_config = inspect_dropbox_oauth_config(
            tenant_id=record.secret_scope,
            tenant_app_key=str(config_json.get("app_key") or "").strip(),
            tenant_app_secret_name=record.dropbox_app_secret_name,
            get_secret=get_secret,
            selection_mode="managed_only",
        )
        selected_mode = oauth_config["selected_mode"]
        can_connect = bool(oauth_config["can_connect"])
        issues = oauth_config["issues"]

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
        "source": record.source,
    }


def _build_gdrive_status(record) -> dict:
    config_json = record.config_json or {}
    client_id = str(config_json.get("client_id") or "").strip()
    token_secret_name = record.gdrive_token_secret_name
    client_secret_name = record.gdrive_client_secret_name
    connected = bool(_read_secret_value(token_secret_name))

    issues: list[str] = []
    if connected:
        can_connect = True
    else:
        if not client_id:
            issues.append("gdrive_client_id_not_configured")
        if not _read_secret_value(client_secret_name):
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
        "source": record.source,
    }


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


def _build_integrations_status(tenant_row: TenantModel, db: Session) -> dict:
    repo = TenantIntegrationRepository(db)
    primary_records = repo.get_primary_records_by_type(tenant_row)

    dropbox_status = _build_dropbox_status(primary_records["dropbox"])
    gdrive_status = _build_gdrive_status(primary_records["gdrive"])
    providers = [dropbox_status, gdrive_status]

    default_provider = repo.resolve_default_sync_provider(tenant_row)
    default_source_provider = default_provider.provider_type
    provider_configs = {provider["id"]: provider for provider in providers}

    active_provider = provider_configs.get(default_source_provider) or dropbox_status
    return {
        "tenant_id": str(tenant_row.id),
        "default_source_provider": default_source_provider,
        "providers": providers,
        "provider_configs": provider_configs,
        "source_provider_options": [
            {"id": "dropbox", "label": _PROVIDER_LABELS["dropbox"]},
            {"id": "gdrive", "label": _PROVIDER_LABELS["gdrive"]},
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
    return {
        "id": record.id,
        "tenant_id": record.tenant_id,
        "provider_type": record.provider_type,
        "label": record.label,
        "is_active": record.is_active,
        "is_default_sync_source": record.is_default_sync_source,
        "secret_scope": record.secret_scope,
        "config_json": record.config_json,
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
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("provider.view")),
    db: Session = Depends(get_db),
):
    """Live Dropbox folder browse/search for provider sync-folder selection."""
    tenant_row = db.query(TenantModel).filter(TenantModel.id == tenant.id).first()
    if not tenant_row:
        raise HTTPException(status_code=404, detail="Tenant not found")

    repo = TenantIntegrationRepository(db)
    dropbox_record = repo.get_provider_record(tenant_row, "dropbox")
    if not dropbox_record:
        raise HTTPException(status_code=404, detail="Dropbox provider not found")

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
        dropbox_status = _build_dropbox_status(record)
        if not dropbox_status["can_connect"]:
            raise HTTPException(status_code=400, detail="Dropbox OAuth is not configured for this provider")
        query_payload["credential_mode"] = "managed"
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
        delete_secret(record.dropbox_token_secret_name)
    elif record.provider_type == "gdrive":
        delete_secret(record.gdrive_token_secret_name)
    else:
        raise HTTPException(status_code=400, detail="Unsupported provider type")

    return {
        "tenant_id": tenant.id,
        "provider": record.provider_type,
        "provider_id": provider_id,
        "status": "disconnected",
    }


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


@router.post("/dropbox/connect")
async def start_dropbox_connect(
    request: Request,
    payload: dict | None = None,
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("provider.manage")),
    db: Session = Depends(get_db),
):
    """Generate Dropbox OAuth authorize URL for redirect-based flow."""
    tenant_row = db.query(TenantModel).filter(TenantModel.id == tenant.id).first()
    if not tenant_row:
        raise HTTPException(status_code=404, detail="Tenant not found")

    repo = TenantIntegrationRepository(db)
    dropbox_record = repo.get_provider_record(tenant_row, "dropbox")
    dropbox_status = _build_dropbox_status(dropbox_record)
    if not dropbox_status["can_connect"]:
        raise HTTPException(status_code=400, detail="Dropbox OAuth is not configured for this tenant")

    requested_return_to = (payload or {}).get("return_to")
    requested_redirect_origin = _resolve_redirect_origin_from_request(request, payload)
    return_to = sanitize_return_path(requested_return_to)
    query_payload = {
        "tenant": tenant.id,
        "flow": "redirect",
        "credential_mode": "managed",
        "return_to": return_to,
    }
    if dropbox_record.id:
        query_payload["provider_id"] = dropbox_record.id
    if requested_redirect_origin:
        query_payload["redirect_origin"] = requested_redirect_origin

    query = urlencode(query_payload)
    return {
        "tenant_id": tenant.id,
        "provider": "dropbox",
        "provider_id": dropbox_record.id,
        "authorize_url": f"/oauth/dropbox/authorize?{query}",
        "mode": dropbox_status["mode"],
    }


@router.post("/gdrive/connect")
async def start_gdrive_connect(
    request: Request,
    payload: dict | None = None,
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("provider.manage")),
    db: Session = Depends(get_db),
):
    """Generate Google Drive OAuth authorize URL for redirect-based flow."""
    tenant_row = db.query(TenantModel).filter(TenantModel.id == tenant.id).first()
    if not tenant_row:
        raise HTTPException(status_code=404, detail="Tenant not found")

    repo = TenantIntegrationRepository(db)
    gdrive_record = repo.get_provider_record(tenant_row, "gdrive")
    gdrive_status = _build_gdrive_status(gdrive_record)
    if not gdrive_status["can_connect"]:
        raise HTTPException(status_code=400, detail="Google Drive OAuth is not configured for this tenant")

    requested_return_to = (payload or {}).get("return_to")
    requested_redirect_origin = _resolve_redirect_origin_from_request(request, payload)
    return_to = sanitize_return_path(requested_return_to)
    query_payload = {
        "tenant": tenant.id,
        "flow": "redirect",
        "return_to": return_to,
    }
    if gdrive_record.id:
        query_payload["provider_id"] = gdrive_record.id
    if requested_redirect_origin:
        query_payload["redirect_origin"] = requested_redirect_origin
    query = urlencode(query_payload)

    return {
        "tenant_id": tenant.id,
        "provider": "gdrive",
        "provider_id": gdrive_record.id,
        "authorize_url": f"/oauth/gdrive/authorize?{query}",
        "mode": gdrive_status["mode"],
    }


@router.delete("/dropbox/connection")
async def disconnect_dropbox(
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("provider.manage")),
    db: Session = Depends(get_db),
):
    """Disconnect Dropbox by deleting tenant refresh token secret."""
    tenant_row = db.query(TenantModel).filter(TenantModel.id == tenant.id).first()
    if not tenant_row:
        raise HTTPException(status_code=404, detail="Tenant not found")

    repo = TenantIntegrationRepository(db)
    record = repo.get_provider_record(tenant_row, "dropbox")

    candidate_secret_names = {
        str(record.dropbox_token_secret_name).strip(),
        str(tenant.dropbox_token_secret or "").strip(),
        f"dropbox-token-{tenant.secret_scope}",
        f"dropbox-token-{tenant.id}",
    }
    for token_secret_name in candidate_secret_names:
        if token_secret_name:
            delete_secret(token_secret_name)

    return {
        "tenant_id": tenant.id,
        "provider": "dropbox",
        "provider_id": record.id,
        "status": "disconnected",
    }


@router.delete("/gdrive/connection")
async def disconnect_gdrive(
    tenant: Tenant = Depends(get_tenant),
    _admin: UserProfile = Depends(require_tenant_permission_from_header("provider.manage")),
    db: Session = Depends(get_db),
):
    """Disconnect Google Drive by deleting tenant refresh token secret."""
    tenant_row = db.query(TenantModel).filter(TenantModel.id == tenant.id).first()
    if not tenant_row:
        raise HTTPException(status_code=404, detail="Tenant not found")

    repo = TenantIntegrationRepository(db)
    record = repo.get_provider_record(tenant_row, "gdrive")

    candidate_secret_names = {
        str(record.gdrive_token_secret_name).strip(),
        str(tenant.gdrive_token_secret or "").strip(),
        f"gdrive-token-{tenant.secret_scope}",
        f"gdrive-token-{tenant.id}",
    }
    for token_secret_name in candidate_secret_names:
        if token_secret_name:
            delete_secret(token_secret_name)

    return {
        "tenant_id": tenant.id,
        "provider": "gdrive",
        "provider_id": record.id,
        "status": "disconnected",
    }
