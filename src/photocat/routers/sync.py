"""Router for Dropbox sync and image processing endpoints."""

import traceback
from pathlib import Path
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from google.cloud import storage

from photocat.dependencies import get_db, get_tenant, get_secret
from photocat.tenant import Tenant
from photocat.exif import (
    get_exif_value,
    parse_exif_datetime,
    parse_exif_float,
    parse_exif_int,
    parse_exif_str,
)
from photocat.metadata import Tenant as TenantModel, ImageMetadata, MachineTag
from photocat.settings import settings
from photocat.image import ImageProcessor
from photocat.config.db_config import ConfigManager
from photocat.tagging import get_tagger
from photocat.learning import (
    ensure_image_embedding,
    load_keyword_models,
    score_image_with_models,
    score_keywords_for_categories,
)

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

        # Setup image processor
        processor = ImageProcessor()
        storage_client = storage.Client(project=settings.gcp_project_id)
        thumbnail_bucket = storage_client.bucket(tenant.get_thumbnail_bucket(settings))

        # Load config for tagging
        config_mgr = ConfigManager(db, tenant.id)
        all_keywords = config_mgr.get_all_keywords()

        # Group keywords by category
        by_category = {}
        for kw in all_keywords:
            cat = kw['category']
            if cat not in by_category:
                by_category[cat] = []
            by_category[cat].append(kw)

        tagger = get_tagger(model_type=model)
        processed = 0
        max_per_sync = 1  # Process one at a time for real-time UI updates

        # Process new/changed images (limit to 1 per sync)
        from dropbox.files import FileMetadata
        for entry in changes['entries']:
            if processed >= max_per_sync:
                break

            if isinstance(entry, FileMetadata) and processor.is_supported(entry.name):
                try:
                    status_messages = []

                    # Fetch Dropbox metadata with media info and custom properties
                    # This is MUCH more efficient than downloading the full file
                    dropbox_props = {}
                    dropbox_exif = {}
                    try:
                        try:
                            from dropbox.files import IncludePropertyGroups
                            include_property_groups = IncludePropertyGroups.filter_some([])
                        except ImportError:
                            include_property_groups = None
                        metadata_kwargs = {
                            "include_media_info": True,
                        }
                        if include_property_groups is not None:
                            metadata_kwargs["include_property_groups"] = include_property_groups
                        metadata_result = dbx.files_get_metadata(entry.path_display, **metadata_kwargs)
                        print(f"[Sync] Fetched Dropbox metadata for {entry.name}")

                        # Extract media info (EXIF-like data from Dropbox without downloading)
                        if hasattr(metadata_result, 'media_info') and metadata_result.media_info:
                            media_info = metadata_result.media_info.get_metadata()
                            print(f"[Sync] Media info type: {type(media_info).__name__}")

                            # Photo metadata
                            if hasattr(media_info, 'dimensions') and media_info.dimensions:
                                dropbox_exif['ImageWidth'] = media_info.dimensions.width
                                dropbox_exif['ImageLength'] = media_info.dimensions.height
                                print(f"[Sync] Dimensions: {media_info.dimensions.width}x{media_info.dimensions.height}")

                            if hasattr(media_info, 'location') and media_info.location:
                                dropbox_exif['GPSLatitude'] = media_info.location.latitude
                                dropbox_exif['GPSLongitude'] = media_info.location.longitude
                                print(f"[Sync] GPS: {media_info.location.latitude}, {media_info.location.longitude}")

                            if hasattr(media_info, 'time_taken') and media_info.time_taken:
                                dropbox_exif['DateTimeOriginal'] = media_info.time_taken.isoformat()
                                dropbox_exif['DateTime'] = media_info.time_taken.isoformat()
                                print(f"[Sync] Time taken: {media_info.time_taken}")

                        # Extract custom properties
                        if hasattr(metadata_result, 'property_groups') and metadata_result.property_groups:
                            print(f"[Sync] Found {len(metadata_result.property_groups)} property groups")
                            for prop_group in metadata_result.property_groups:
                                template_name = prop_group.template_id
                                for field in prop_group.fields:
                                    key = f"{template_name}.{field.name}"
                                    dropbox_props[key] = field.value
                        else:
                            print(f"[Sync] No custom property groups")

                    except Exception as metadata_error:
                        print(f"Could not fetch Dropbox metadata for {entry.name}: {metadata_error}")
                        traceback.print_exc()

                    # Download thumbnail for fast processing (~50-100KB vs 3MB)
                    # Get metadata from Dropbox API (dimensions, GPS, date)
                    # Don't download full image - not worth the bandwidth/time
                    from dropbox.files import ThumbnailFormat, ThumbnailSize
                    image_data = None

                    # Try to get thumbnail
                    if not entry.name.lower().endswith(('.heic', '.heif')):
                        try:
                            status_messages.append(f"Downloading thumbnail: {entry.name}")
                            _, thumbnail_response = dbx.files_get_thumbnail(
                                path=entry.path_display,
                                format=ThumbnailFormat.jpeg,
                                size=ThumbnailSize.w640h480
                            )
                            image_data = thumbnail_response.content
                            print(f"[Sync] Downloaded thumbnail ({len(image_data)} bytes)")
                        except Exception as thumb_error:
                            print(f"Thumbnail download failed for {entry.name}: {thumb_error}")

                    # Fallback to full download only if thumbnail completely fails
                    # (e.g., for HEIC files or unsupported formats)
                    if image_data is None:
                        status_messages.append(f"Downloading image: {entry.name}")
                        _, response = dbx.files_download(entry.path_display)
                        image_data = response.content
                        print(f"[Sync] Downloaded full image ({len(image_data)} bytes)")

                    # Extract features
                    status_messages.append(f"Extracting visual features")
                    features = processor.extract_features(image_data)

                    # Merge EXIF: Dropbox API data (no download needed) + any data from image
                    # Dropbox API data takes precedence as it's more reliable
                    exif = features.get('exif', {})
                    exif.update(dropbox_exif)  # Dropbox media_info overwrites
                    print(f"[Sync] Combined EXIF data: {len(exif)} fields")
                    if exif:
                        print(f"[Sync] EXIF keys: {list(exif.keys())[:10]}")

                    capture_timestamp = parse_exif_datetime(
                        get_exif_value(exif, "DateTimeOriginal", "DateTime")
                    )
                    gps_latitude = parse_exif_float(get_exif_value(exif, "GPSLatitude"))
                    gps_longitude = parse_exif_float(get_exif_value(exif, "GPSLongitude"))
                    iso = parse_exif_int(get_exif_value(exif, "ISOSpeedRatings", "ISOSpeed", "ISO"))
                    aperture = parse_exif_float(get_exif_value(exif, "FNumber", "ApertureValue"))
                    shutter_speed = parse_exif_str(get_exif_value(exif, "ExposureTime", "ShutterSpeedValue"))
                    focal_length = parse_exif_float(get_exif_value(exif, "FocalLength"))

                    # Check if already exists
                    existing = db.query(ImageMetadata).filter(
                        ImageMetadata.tenant_id == tenant.id,
                        ImageMetadata.dropbox_id == entry.id
                    ).first()

                    if existing:
                        # Skip already processed, don't count toward limit
                        continue

                    # Upload thumbnail with cache headers
                    status_messages.append(f"Saving thumbnail and metadata")
                    thumbnail_filename = f"{Path(entry.name).stem}_thumb.jpg"
                    thumbnail_path = tenant.get_storage_path(thumbnail_filename, "thumbnails")
                    blob = thumbnail_bucket.blob(thumbnail_path)
                    blob.cache_control = "public, max-age=31536000, immutable"  # 1 year cache
                    blob.upload_from_string(features['thumbnail'], content_type='image/jpeg')
                    metadata = ImageMetadata(
                        tenant_id=tenant.id,
                        dropbox_path=entry.path_display,
                        dropbox_id=entry.id,
                        filename=entry.name,
                        file_size=entry.size,
                        content_hash=entry.content_hash if hasattr(entry, 'content_hash') else None,
                        modified_time=entry.server_modified,
                        width=features['width'],
                        height=features['height'],
                        format=features['format'],
                        perceptual_hash=features['perceptual_hash'],
                        color_histogram=features['color_histogram'],
                        exif_data=exif,
                        dropbox_properties=dropbox_props if dropbox_props else None,
                        camera_make=exif.get('Make'),
                        camera_model=exif.get('Model'),
                        lens_model=exif.get('LensModel'),
                        capture_timestamp=capture_timestamp,
                        gps_latitude=gps_latitude,
                        gps_longitude=gps_longitude,
                        iso=iso,
                        aperture=aperture,
                        shutter_speed=shutter_speed,
                        focal_length=focal_length,
                        thumbnail_path=thumbnail_path,
                        embedding_generated=False,
                        faces_detected=False,
                        tags_applied=False,
                    )
                    db.add(metadata)
                    db.commit()
                    db.refresh(metadata)

                    # Tag with model (per category)
                    status_messages.append(f"Running {model.upper()} inference for tagging")
                    # Delete existing tags for this image and tag type
                    db.query(MachineTag).filter(
                        MachineTag.image_id == metadata.id,
                        MachineTag.tag_type == 'siglip'
                    ).delete()

                    model_name = getattr(tagger, "model_name", model)
                    model_version = getattr(tagger, "model_version", model_name)
                    model_scores = None

                    if settings.use_keyword_models:
                        embedding_record = ensure_image_embedding(
                            db,
                            tenant.id,
                            metadata.id,
                            image_data,
                            model_name,
                            model_version
                        )
                        keyword_models = load_keyword_models(db, tenant.id, model_name)
                        model_scores = score_image_with_models(embedding_record.embedding, keyword_models)

                    all_tags = score_keywords_for_categories(
                        image_data=image_data,
                        keywords_by_category=by_category,
                        model_type=model,
                        threshold=0.15,
                        model_scores=model_scores,
                        model_weight=settings.keyword_model_weight
                    )

                    keyword_to_category = {kw['keyword']: kw['category'] for kw in all_keywords}

                    for keyword, confidence in all_tags:
                        tag = MachineTag(
                            image_id=metadata.id,
                            tenant_id=tenant.id,
                            keyword=keyword,
                            category=keyword_to_category[keyword],
                            confidence=confidence,
                            tag_type='siglip',
                            model_name=model_name,
                            model_version=model_version
                        )
                        db.add(tag)

                    metadata.tags_applied = len(all_tags) > 0
                    status_messages.append(f"Complete: {len(all_tags)} tags applied")
                    db.commit()
                    processed += 1

                except Exception as e:
                    error_msg = f"Error processing {entry.name}: {e}"
                    print(error_msg)
                    traceback.print_exc()

                    # Mark as processed (failed) so we don't retry it immediately
                    # Store minimal metadata to track the failure
                    try:
                        existing = db.query(ImageMetadata).filter(
                            ImageMetadata.tenant_id == tenant.id,
                            ImageMetadata.dropbox_id == entry.id
                        ).first()

                        if not existing:
                            metadata = ImageMetadata(
                                tenant_id=tenant.id,
                                dropbox_path=entry.path_display,
                                dropbox_id=entry.id,
                                filename=entry.name,
                                file_size=entry.size,
                                modified_time=entry.server_modified,
                                tags_applied=False,
                                embedding_generated=False,
                                faces_detected=False,
                            )
                            db.add(metadata)
                            db.commit()
                            print(f"Marked {entry.name} as failed (will skip in future syncs)")
                    except Exception as db_error:
                        print(f"Failed to mark {entry.name} as failed: {db_error}")
                        db.rollback()

                    # Continue to next file instead of stopping
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
