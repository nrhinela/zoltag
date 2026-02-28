"""Router for storage-provider sync and image ingestion endpoints."""

import traceback

from fastapi import APIRouter, Depends, HTTPException, Query
from google.cloud import storage
from sqlalchemy.orm import Session

from zoltag.dependencies import get_db, get_secret, get_tenant
from zoltag.image import is_supported_media_file
from zoltag.integrations import (
    TenantIntegrationRepository,
    normalize_picker_session_id,
    normalize_selection_mode,
    normalize_sync_folders,
    normalize_sync_items,
)
from zoltag.metadata import Asset, Tenant as TenantModel
from zoltag.settings import settings
from zoltag.storage import ProviderEntry, create_storage_provider
from zoltag.sync_pipeline import GLOBAL_SOURCE_KEY_DEDUPE_PROVIDERS, process_storage_entry
from zoltag.tenant import Tenant
from zoltag.tenant_scope import tenant_column_filter

router = APIRouter(
    prefix="/api/v1",
    tags=["sync"]
)


def _normalize_provider(provider: str) -> str:
    value = (provider or "dropbox").strip().lower()
    if value in {"dbx", "dropbox"}:
        return "dropbox"
    if value in {"gdrive", "google-drive", "google_drive", "drive"}:
        return "gdrive"
    if value in {"yt"}:
        return "youtube"
    if value in {"gphotos", "google-photos", "google_photos"}:
        return "gphotos"
    return value


def _patch_tenant_from_record(tenant: Tenant, provider_name: str, record) -> None:
    """Patch tenant OAuth token secret attrs from a specific provider integration record."""
    if provider_name == "dropbox":
        tenant.dropbox_token_secret = record.dropbox_token_secret_name
    elif provider_name == "gdrive":
        tenant.gdrive_token_secret = record.gdrive_token_secret_name
        tenant.gdrive_client_secret = record.gdrive_client_secret_name
        sync_folders = list((record.config_json or {}).get("sync_folders") or [])
        tenant.gdrive_sync_folders = sync_folders
    elif provider_name == "youtube":
        tenant.youtube_token_secret = record.youtube_token_secret_name
        sync_folders = list((record.config_json or {}).get("sync_folders") or [])
        tenant.youtube_sync_folders = sync_folders
    elif provider_name == "gphotos":
        tenant.gphotos_token_secret = record.gphotos_token_secret_name
        sync_folders = list((record.config_json or {}).get("sync_folders") or [])
        tenant.gphotos_sync_folders = sync_folders


@router.post("/sync", response_model=dict)
async def trigger_sync(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    model: str = Query("siglip", description="'clip' or 'siglip'"),
    reprocess_existing: bool = Query(False, description="Reprocess entries even if already ingested"),
    provider: str | None = Query(None, description="Storage provider: dropbox, gdrive, youtube, or gphotos"),
    provider_id: str | None = Query(None, description="Specific provider integration UUID (omit for primary)"),
):
    """Trigger one-item sync for the requested storage provider."""
    try:
        _ = model  # Legacy query param retained for backward compatibility.
        tenant_row = db.query(TenantModel).filter(TenantModel.id == tenant.id).first()
        if not tenant_row:
            raise HTTPException(status_code=404, detail="Tenant not found")

        repo = TenantIntegrationRepository(db)

        # When provider_id is given, resolve the specific integration record directly.
        # Otherwise fall back to the primary record via build_runtime_context.
        record_provider_id: str | None = None
        selected_record = None
        if provider_id:
            try:
                specific_record = repo.get_provider_record_by_id(tenant_row, provider_id)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc))
            if specific_record is None:
                raise HTTPException(status_code=404, detail="Provider integration not found")
            if not specific_record.is_active:
                raise HTTPException(
                    status_code=409,
                    detail="Provider integration is inactive. Activate this provider in Admin -> Providers before syncing.",
                )
            provider_name = _normalize_provider(specific_record.provider_type)
            sync_folders = normalize_sync_folders(list((specific_record.config_json or {}).get("sync_folders") or []))
            record_provider_id = str(specific_record.id)
            selected_record = specific_record
            # Patch tenant with this record's token secret so create_storage_provider can find it
            _patch_tenant_from_record(tenant, provider_name, specific_record)
        else:
            runtime_context = repo.build_runtime_context(tenant_row)
            configured_provider = str(runtime_context.get("default_source_provider") or "dropbox").strip().lower()
            provider_name = _normalize_provider(provider or configured_provider)
            if provider_name == "dropbox":
                dropbox_runtime = runtime_context.get("dropbox") or {}
                if not bool(dropbox_runtime.get("is_active")):
                    raise HTTPException(
                        status_code=409,
                        detail="Dropbox integration is inactive. Activate this provider in Admin -> Providers before syncing.",
                    )
                sync_folders = normalize_sync_folders(dropbox_runtime.get("sync_folders"))
                tenant.dropbox_oauth_mode = str(dropbox_runtime.get("oauth_mode") or "").strip().lower() or None
                tenant.dropbox_sync_folders = list(sync_folders)
            elif provider_name == "youtube":
                youtube_runtime = runtime_context.get("youtube") or {}
                if not bool(youtube_runtime.get("is_active")):
                    raise HTTPException(
                        status_code=409,
                        detail="YouTube integration is inactive. Activate this provider in Admin -> Providers before syncing.",
                    )
                sync_folders = normalize_sync_folders(youtube_runtime.get("sync_folders"))
                tenant.youtube_sync_folders = list(sync_folders)
            elif provider_name == "gphotos":
                gphotos_runtime = runtime_context.get("gphotos") or {}
                if not bool(gphotos_runtime.get("is_active")):
                    raise HTTPException(
                        status_code=409,
                        detail="Google Photos integration is inactive. Activate this provider in Admin -> Providers before syncing.",
                    )
                sync_folders = normalize_sync_folders(gphotos_runtime.get("sync_folders"))
                tenant.gphotos_sync_folders = list(sync_folders)
            else:
                gdrive_runtime = runtime_context.get("gdrive") or {}
                if not bool(gdrive_runtime.get("is_active")):
                    raise HTTPException(
                        status_code=409,
                        detail="Google Drive integration is inactive. Activate this provider in Admin -> Providers before syncing.",
                    )
                sync_folders = normalize_sync_folders(gdrive_runtime.get("sync_folders"))
                tenant.gdrive_sync_folders = list(sync_folders)
            tenant.default_source_provider = configured_provider
            # Capture record_provider_id for the primary record
            try:
                primary_record = repo.get_provider_record(tenant_row, provider_name)
                record_provider_id = str(primary_record.id) if primary_record.id else None
                selected_record = primary_record
                _patch_tenant_from_record(tenant, provider_name, primary_record)
            except Exception:
                record_provider_id = None

        try:
            storage_provider = create_storage_provider(provider_name, tenant=tenant, get_secret=get_secret)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Unable to initialize {provider_name} provider: {exc}")

        import uuid as _uuid_mod
        _pid_uuid = _uuid_mod.UUID(record_provider_id) if record_provider_id else None

        processed_paths = set()
        if not reprocess_existing:
            q = (
                db.query(Asset.source_key)
                .filter(
                    tenant_column_filter(Asset, tenant),
                    Asset.source_provider == storage_provider.provider_name,
                )
            )
            if _pid_uuid is not None and storage_provider.provider_name not in GLOBAL_SOURCE_KEY_DEDUPE_PROVIDERS:
                q = q.filter(Asset.provider_id == _pid_uuid)
            processed_paths = set(row[0] for row in q.all() if row[0])

        try:
            if provider_name == "gphotos" and selected_record is not None:
                config_json = dict(selected_record.config_json or {})
                selection_mode = normalize_selection_mode("gphotos", config_json.get("selection_mode"))
                if selection_mode == "picker":
                    picker_session_id = normalize_picker_session_id(config_json.get("picker_session_id"))
                    if not picker_session_id:
                        raise HTTPException(
                            status_code=409,
                            detail="Google Photos picker sync requires a saved picker session. Launch picker, refresh selected media items, then save.",
                        )
                    sync_items = normalize_sync_items(config_json.get("sync_items"))
                    selected_item_ids = [
                        str(item.get("id") or "").strip()
                        for item in sync_items
                        if str(item.get("id") or "").strip()
                    ]
                    if not hasattr(storage_provider, "list_picker_entries"):
                        raise HTTPException(status_code=400, detail="Google Photos picker sync is not supported by storage provider")
                    file_entries = storage_provider.list_picker_entries(
                        picker_session_id,
                        picked_media_item_ids=selected_item_ids or None,
                    )
                else:
                    file_entries = storage_provider.list_image_entries(sync_folders=sync_folders)
            else:
                file_entries = storage_provider.list_image_entries(sync_folders=sync_folders)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to list {storage_provider.provider_name} files: {exc}")

        candidate: ProviderEntry | None = None
        for entry in file_entries:
            if not is_supported_media_file(entry.name, entry.mime_type):
                continue
            if reprocess_existing or entry.source_key not in processed_paths:
                candidate = entry
                break

        if candidate is None:
            return {
                "tenant_id": tenant.id,
                "provider": storage_provider.provider_name,
                "status": "sync_complete",
                "processed": 0,
                "has_more": False,
            }

        storage_client = storage.Client(project=settings.gcp_project_id)
        thumbnail_bucket = storage_client.bucket(tenant.get_thumbnail_bucket(settings))

        try:
            result = process_storage_entry(
                db=db,
                tenant=tenant,
                entry=candidate,
                provider=storage_provider,
                thumbnail_bucket=thumbnail_bucket,
                reprocess_existing=reprocess_existing,
                provider_id=record_provider_id,
                log=print,
            )
        except Exception as exc:
            print(f"[Sync] Error processing {candidate.name}: {exc}")
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=f"Failed to process {candidate.name}: {exc}")

        processed = 1 if result.status == "processed" else 0
        message = f"{candidate.name}: metadata + thumbnail stored" if processed else f"{candidate.name}: already synced"

        has_more = any(
            is_supported_media_file(entry.name, entry.mime_type)
            and (reprocess_existing or entry.source_key not in processed_paths)
            and entry.source_key != candidate.source_key
            for entry in file_entries
        )

        return {
            "tenant_id": tenant.id,
            "provider": storage_provider.provider_name,
            "status": "sync_complete",
            "processed": processed,
            "has_more": bool(has_more),
            "status_message": message,
            "filename": candidate.name,
        }

    except HTTPException:
        raise
    except Exception as exc:
        error_detail = f"Sync failed: {str(exc)}\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(exc)}")
