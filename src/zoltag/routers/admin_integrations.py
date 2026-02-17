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
        "connected": connected,
        "can_connect": can_connect,
        "mode": "tenant_oauth",
        "issues": issues,
        "sync_folder_key": "gdrive_sync_folders",
        "sync_folders": normalize_sync_folders(config_json.get("sync_folders")),
        "source": record.source,
    }


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
        is_active=bool(payload.get("is_active", True)),
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
