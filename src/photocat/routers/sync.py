"""Router for Dropbox sync and image processing endpoints."""

import traceback

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from google.cloud import storage

from photocat.dependencies import get_db, get_tenant, get_secret
from photocat.tenant import Tenant
from photocat.metadata import Tenant as TenantModel, ImageMetadata
from photocat.settings import settings
from photocat.image import ImageProcessor
from photocat.config.db_config import ConfigManager
from photocat.learning import (
    load_keyword_models,
)
from photocat.sync_pipeline import process_dropbox_entry
from photocat.tagging import get_tagger

router = APIRouter(
    prefix="/api/v1",
    tags=["sync"]
)


@router.post("/sync", response_model=dict)
async def trigger_sync(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    model: str = Query("siglip", description="'clip' or 'siglip'")
):
    """Trigger Dropbox sync for tenant."""
    try:
        # Check if Dropbox credentials are configured
        if not tenant.dropbox_app_key:
            raise HTTPException(
                status_code=400,
                detail="Dropbox app key not configured. Please set it in the admin interface."
            )

        # Get tenant's Dropbox credentials
        try:
            refresh_token = get_secret(f"dropbox-token-{tenant.id}")
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail="Dropbox not connected. Please click 'Connect Dropbox Account' first."
            )

        app_key = tenant.dropbox_app_key

        try:
            app_secret = get_secret(f"dropbox-app-secret-{tenant.id}")
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Dropbox app secret not found in Secret Manager. Please create secret: dropbox-app-secret-{tenant.id}"
            )

        # Use Dropbox SDK directly with refresh token
        from dropbox import Dropbox
        dbx = Dropbox(
            oauth2_refresh_token=refresh_token,
            app_key=app_key,
            app_secret=app_secret
        )

        # Get tenant settings from database to access sync folders
        tenant_row = db.query(TenantModel).filter(TenantModel.id == tenant.id).first()
        sync_folders = tenant_row.settings.get('dropbox_sync_folders', []) if tenant_row.settings else []

        print(f"[Sync] Tenant {tenant.id} sync folders: {sync_folders}")

        # Only fetch unprocessed files by checking what's already in DB
        from dropbox.files import FileMetadata

        # Get already processed dropbox IDs
        processed_ids = set(
            row[0] for row in db.query(ImageMetadata.dropbox_id)
            .filter(ImageMetadata.tenant_id == tenant.id)
            .all()
        )

        # Find next unprocessed image
        file_entry = None

        if sync_folders:
            # Sync only configured folders
            for folder_path in sync_folders:
                try:
                    print(f"[Sync] Listing folder: {folder_path}")
                    result = dbx.files_list_folder(folder_path, recursive=True)
                    entries = list(result.entries)
                    print(f"[Sync] Got {len(entries)} entries from {folder_path}")

                    # Handle pagination
                    page_count = 1
                    while result.has_more:
                        print(f"[Sync] Fetching page {page_count + 1} for {folder_path}")
                        result = dbx.files_list_folder_continue(result.cursor)
                        entries.extend(result.entries)
                        page_count += 1

                    print(f"[Sync] Total entries after pagination: {len(entries)}")

                    # Filter to images, sort by date, find first unprocessed
                    file_entries = [e for e in entries if isinstance(e, FileMetadata)]
                    print(f"[Sync] Found {len(file_entries)} files (filtering images)")
                    file_entries.sort(key=lambda e: e.server_modified, reverse=True)

                    for entry in file_entries:
                        if entry.id not in processed_ids:
                            processor = ImageProcessor()
                            if processor.is_supported(entry.name):
                                file_entry = entry
                                print(f"[Sync] Found unprocessed image: {entry.name}")
                                break

                    if file_entry:
                        break  # Found one, stop searching
                    else:
                        print(f"[Sync] No unprocessed images in {folder_path}")

                except Exception as e:
                    print(f"[Sync] Error listing folder {folder_path}: {e}")
                    traceback.print_exc()
        else:
            # No folder constraint - sync entire Dropbox (limit to first batch to avoid hanging)
            try:
                print(f"[Sync] Listing entire Dropbox for tenant {tenant.id} (limited to first batch)")
                result = dbx.files_list_folder("", recursive=True)
                entries = list(result.entries)

                # Don't paginate through everything - just check first batch
                # This prevents hanging on large Dropboxes
                print(f"[Sync] Found {len(entries)} entries in first batch")

                # Filter to images, sort by date, find first unprocessed
                file_entries = [e for e in entries if isinstance(e, FileMetadata)]
                print(f"[Sync] Found {len(file_entries)} image files")
                file_entries.sort(key=lambda e: e.server_modified, reverse=True)

                for entry in file_entries:
                    if entry.id not in processed_ids:
                        processor = ImageProcessor()
                        if processor.is_supported(entry.name):
                            file_entry = entry
                            print(f"[Sync] Found unprocessed image: {entry.name}")
                            break

            except Exception as e:
                print(f"Error listing Dropbox root: {e}")
                traceback.print_exc()

        if not file_entry:
            return {
                "tenant_id": tenant.id,
                "status": "sync_complete",
                "processed": 0,
                "has_more": False
            }

        changes = {
            "entries": [file_entry],
            "cursor": None,
            "has_more": True  # Assume more until we check all folders
        }

        storage_client = storage.Client(project=settings.gcp_project_id)
        thumbnail_bucket = storage_client.bucket(tenant.get_thumbnail_bucket(settings))

        # Load config for tagging
        config_mgr = ConfigManager(db, tenant.id)
        all_keywords = config_mgr.get_all_keywords()

        # Group keywords by category
        by_category = {}
        keyword_to_category = {}
        for kw in all_keywords:
            cat = kw['category']
            keyword_to_category[kw['keyword']] = cat
            if cat not in by_category:
                by_category[cat] = []
            by_category[cat].append(kw)

        tagger = get_tagger(model_type=model)
        model_name = getattr(tagger, "model_name", model)
        keyword_models = None
        if settings.use_keyword_models:
            keyword_models = load_keyword_models(db, tenant.id, model_name)

        processed = 0
        max_per_sync = 1  # Process one at a time for real-time UI updates
        status_messages = []

        from dropbox.files import FileMetadata
        for entry in changes['entries']:
            if processed >= max_per_sync:
                break

            if not isinstance(entry, FileMetadata):
                continue

            try:
                result = process_dropbox_entry(
                    db=db,
                    tenant=tenant,
                    entry=entry,
                    dropbox_client=dbx,
                    thumbnail_bucket=thumbnail_bucket,
                    keywords_by_category=by_category,
                    keyword_to_category=keyword_to_category,
                    keyword_models=keyword_models,
                    model_type=model,
                    log=print,
                )
                if result.status == "processed":
                    processed += 1
                    status_messages.append(f"{entry.name}: {result.tags_count} tags")
                elif result.status == "skipped":
                    status_messages.append(f"{entry.name}: already synced")
            except Exception as e:
                print(f"[Sync] Error processing {entry.name}: {e}")
                traceback.print_exc()
                continue

        return {
            "tenant_id": tenant.id,
            "status": "sync_complete",
            "processed": processed,
            "has_more": len(file_entries) > processed if 'file_entries' in locals() else False,
            "status_message": " → ".join(status_messages) if 'status_messages' in locals() else None,
            "filename": file_entry.name if file_entry else None
        }

    except Exception as e:
        error_detail = f"Sync failed: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(e)}")
