"""Router for storage-provider sync and image ingestion endpoints."""

import traceback

from fastapi import APIRouter, Depends, HTTPException, Query
from google.cloud import storage
from sqlalchemy.orm import Session

from photocat.dependencies import get_db, get_secret, get_tenant
from photocat.image import ImageProcessor
from photocat.metadata import Asset
from photocat.settings import settings
from photocat.storage import ProviderEntry, create_storage_provider
from photocat.sync_pipeline import process_storage_entry
from photocat.tenant import Tenant
from photocat.tenant_scope import tenant_column_filter

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
    return value


@router.post("/sync", response_model=dict)
async def trigger_sync(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    model: str = Query("siglip", description="'clip' or 'siglip'"),
    reprocess_existing: bool = Query(False, description="Reprocess entries even if already ingested"),
    provider: str = Query("dropbox", description="Storage provider: dropbox or gdrive"),
):
    """Trigger one-item sync for the requested storage provider."""
    try:
        _ = model  # Legacy query param retained for backward compatibility.
        provider_name = _normalize_provider(provider)

        try:
            storage_provider = create_storage_provider(provider_name, tenant=tenant, get_secret=get_secret)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Unable to initialize {provider_name} provider: {exc}")

        tenant_settings = tenant.settings or {}

        sync_folder_key = "dropbox_sync_folders" if storage_provider.provider_name == "dropbox" else "gdrive_sync_folders"
        sync_folders = tenant_settings.get(sync_folder_key, [])

        processed_paths = set()
        if not reprocess_existing:
            processed_paths = set(
                row[0]
                for row in db.query(Asset.source_key)
                .filter(
                    tenant_column_filter(Asset, tenant),
                    Asset.source_provider == storage_provider.provider_name,
                )
                .all()
                if row[0]
            )

        try:
            file_entries = storage_provider.list_image_entries(sync_folders=sync_folders)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to list {storage_provider.provider_name} files: {exc}")

        processor = ImageProcessor()
        candidate: ProviderEntry | None = None
        for entry in file_entries:
            if not processor.is_supported(entry.name):
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
                log=print,
            )
        except Exception as exc:
            print(f"[Sync] Error processing {candidate.name}: {exc}")
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=f"Failed to process {candidate.name}: {exc}")

        processed = 1 if result.status == "processed" else 0
        message = f"{candidate.name}: metadata + thumbnail stored" if processed else f"{candidate.name}: already synced"

        has_more = any(
            processor.is_supported(entry.name)
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
