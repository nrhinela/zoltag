"""Image file serving endpoints: thumbnail and full-size image."""

import io
import mimetypes
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from google.cloud import storage

from photocat.dependencies import get_db, get_tenant, get_secret
from photocat.tenant import Tenant
from photocat.metadata import ImageMetadata, Tenant as TenantModel
from photocat.settings import settings
from photocat.storage import create_storage_provider
from photocat.image import ImageProcessor
from photocat.routers.images._shared import _resolve_storage_or_409, _resolve_provider_ref

router = APIRouter()


@router.get("/images/{image_id}/thumbnail", operation_id="get_thumbnail")
async def get_thumbnail(
    image_id: int,
    db: Session = Depends(get_db)
):
    """Get image thumbnail from Cloud Storage with aggressive caching."""
    image = db.query(ImageMetadata).filter_by(
        id=image_id
    ).first()

    if not image:
        raise HTTPException(status_code=404, detail="Thumbnail not found")

    # Get tenant to determine correct bucket
    tenant_row = db.query(TenantModel).filter(TenantModel.id == image.tenant_id).first()
    if not tenant_row:
        raise HTTPException(status_code=404, detail=f"Tenant {image.tenant_id} not found")

    tenant = Tenant(
        id=tenant_row.id,
        name=tenant_row.name,
        active=tenant_row.active,
        dropbox_token_secret=f"dropbox-token-{tenant_row.id}",
        dropbox_app_key=f"dropbox-app-key-{tenant_row.id}",
        dropbox_app_secret=f"dropbox-app-secret-{tenant_row.id}",
        storage_bucket=tenant_row.storage_bucket,
        thumbnail_bucket=tenant_row.thumbnail_bucket
    )
    storage_info = _resolve_storage_or_409(
        image=image,
        tenant=tenant,
        db=db,
        require_thumbnail=True,
    )
    if not storage_info.thumbnail_key:
        raise HTTPException(status_code=404, detail="Thumbnail not found")

    try:
        storage_client = storage.Client(project=settings.gcp_project_id)
        bucket = storage_client.bucket(tenant.get_thumbnail_bucket(settings))
        blob = bucket.blob(storage_info.thumbnail_key)

        if not blob.exists():
            raise HTTPException(status_code=404, detail="Thumbnail not found in storage")

        thumbnail_data = blob.download_as_bytes()

        return StreamingResponse(
            iter([thumbnail_data]),
            media_type="image/jpeg",
            headers={
                "Cache-Control": "public, max-age=3600",  # Cache for 1 hour
                "ETag": f'"{image.id}-{image.modified_time.timestamp() if image.modified_time else 0}"'
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching thumbnail: {str(e)}")


@router.get("/images/{image_id}/full", operation_id="get_full_image")
async def get_full_image(
    image_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Stream full-size image from configured storage provider without persisting it."""
    image = db.query(ImageMetadata).filter_by(
        id=image_id,
        tenant_id=tenant.id
    ).first()

    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    storage_info = _resolve_storage_or_409(
        image=image,
        tenant=tenant,
        db=db,
        require_source=True,
    )
    provider_name, source_ref = _resolve_provider_ref(storage_info, image)
    if not source_ref:
        if provider_name == "dropbox":
            raise HTTPException(status_code=404, detail="Image not available in Dropbox")
        raise HTTPException(status_code=404, detail=f"Image not available in {provider_name}")

    try:
        provider = create_storage_provider(provider_name, tenant=tenant, get_secret=get_secret)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to initialize {provider_name} provider: {exc}")

    try:
        file_bytes = provider.download_file(source_ref)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error fetching {provider_name} image: {exc}")

    filename = image.filename or "image"
    content_type, _ = mimetypes.guess_type(filename or source_ref)
    content_type = content_type or "application/octet-stream"

    # Convert HEIC to JPEG for browser compatibility
    if filename.lower().endswith((".heic", ".heif")):
        try:
            processor = ImageProcessor()
            pil_image = processor.load_image(file_bytes)
            pil_image_rgb = pil_image.convert("RGB") if pil_image.mode != "RGB" else pil_image
            buffer = io.BytesIO()
            pil_image_rgb.save(buffer, format="JPEG", quality=95, optimize=False)
            file_bytes = buffer.getvalue()
            filename = filename.rsplit(".", 1)[0] + ".jpg"
            content_type = "image/jpeg"
        except Exception as exc:
            print(f"HEIC conversion failed for {image.filename}: {exc}")

    return StreamingResponse(
        iter([file_bytes]),
        media_type=content_type,
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": f'inline; filename="{filename}"'
        }
    )
