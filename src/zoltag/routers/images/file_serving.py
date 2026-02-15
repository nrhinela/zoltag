"""Image file serving endpoints: thumbnail and full-size image."""

import io
import mimetypes
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from google.cloud import storage
from sqlalchemy.orm import Session

from zoltag.dependencies import get_db, get_secret, get_tenant
from zoltag.integrations import TenantIntegrationRepository
from zoltag.image import ImageProcessor
from zoltag.metadata import ImageMetadata, Tenant as TenantModel
from zoltag.routers.images._shared import _resolve_provider_ref, _resolve_storage_or_409
from zoltag.settings import settings
from zoltag.storage import create_storage_provider
from zoltag.tenant import Tenant
from zoltag.tenant_scope import tenant_column_filter

router = APIRouter()
PLAYBACK_URL_TTL_SECONDS = 300


def _resolve_tenant_for_image(db: Session, image: ImageMetadata):
    """Resolve tenant row for an image via canonical tenant_id."""
    image_tenant_id = getattr(image, "tenant_id", None)
    if image_tenant_id is None:
        return None
    return db.query(TenantModel).filter(TenantModel.id == image_tenant_id).first()


def _guess_content_type(*, filename: str = "", source_ref: str = "", fallback: str = "application/octet-stream"):
    content_type, _ = mimetypes.guess_type(filename or source_ref or "")
    return content_type or fallback


def _infer_media_type(image: ImageMetadata, storage_info) -> str:
    asset = getattr(storage_info, "asset", None)
    media_type = str(getattr(asset, "media_type", "") or "").strip().lower()
    if media_type in {"image", "video"}:
        return media_type
    mime_type = str(getattr(asset, "mime_type", "") or "").strip().lower()
    if mime_type.startswith("video/"):
        return "video"
    if mime_type.startswith("image/"):
        return "image"
    guessed = _guess_content_type(filename=image.filename or "", source_ref=storage_info.source_key or "")
    if guessed.startswith("video/"):
        return "video"
    return "image"


def _parse_single_range_header(range_header: str, total_size: int) -> tuple[int, int]:
    header = (range_header or "").strip()
    if not header or total_size < 1:
        raise ValueError("Invalid range header")
    if "=" not in header:
        raise ValueError("Invalid range header")

    unit, value = header.split("=", 1)
    if unit.strip().lower() != "bytes":
        raise ValueError("Unsupported range unit")
    if "," in value:
        raise ValueError("Multiple ranges are not supported")
    if "-" not in value:
        raise ValueError("Invalid range format")

    start_raw, end_raw = [part.strip() for part in value.split("-", 1)]
    if not start_raw:
        # Suffix byte range: bytes=-500
        suffix_len = int(end_raw)
        if suffix_len <= 0:
            raise ValueError("Invalid suffix length")
        start = max(total_size - suffix_len, 0)
        end = total_size - 1
        return start, end

    start = int(start_raw)
    end = total_size - 1 if not end_raw else int(end_raw)
    if start < 0 or end < 0 or start > end:
        raise ValueError("Invalid range bounds")
    if start >= total_size:
        raise ValueError("Range start is out of bounds")

    end = min(end, total_size - 1)
    return start, end


def _build_expiry_timestamp(ttl_seconds: int) -> str:
    expires = datetime.now(timezone.utc) + timedelta(seconds=max(60, int(ttl_seconds or 300)))
    return expires.isoformat().replace("+00:00", "Z")


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
    tenant_row = _resolve_tenant_for_image(db, image)
    if not tenant_row:
        raise HTTPException(status_code=404, detail="Tenant not found")
    integration_repo = TenantIntegrationRepository(db)
    runtime_context = integration_repo.build_runtime_context(tenant_row)
    tenant_settings = getattr(tenant_row, "settings", None) if isinstance(getattr(tenant_row, "settings", None), dict) else {}
    dropbox_runtime = runtime_context.get("dropbox") or {}
    gdrive_runtime = runtime_context.get("gdrive") or {}
    key_prefix = (getattr(tenant_row, "key_prefix", None) or str(tenant_row.id)).strip()

    tenant = Tenant(
        id=str(tenant_row.id),
        name=tenant_row.name,
        identifier=getattr(tenant_row, "identifier", None) or str(tenant_row.id),
        key_prefix=key_prefix,
        active=tenant_row.active,
        dropbox_token_secret=str(dropbox_runtime.get("token_secret_name") or f"dropbox-token-{key_prefix}").strip(),
        dropbox_app_key=str(dropbox_runtime.get("app_key") or "").strip() or None,
        dropbox_app_secret=str(dropbox_runtime.get("app_secret_name") or f"dropbox-app-secret-{key_prefix}").strip(),
        dropbox_oauth_mode=str(dropbox_runtime.get("oauth_mode") or "").strip().lower() or None,
        dropbox_sync_folders=list(dropbox_runtime.get("sync_folders") or []),
        gdrive_sync_folders=list(gdrive_runtime.get("sync_folders") or []),
        default_source_provider=str(runtime_context.get("default_source_provider") or "dropbox").strip().lower(),
        gdrive_client_id=str(gdrive_runtime.get("client_id") or "").strip() or None,
        gdrive_token_secret=str(gdrive_runtime.get("token_secret_name") or f"gdrive-token-{key_prefix}").strip(),
        gdrive_client_secret=str(gdrive_runtime.get("client_secret_name") or f"gdrive-client-secret-{key_prefix}").strip(),
        storage_bucket=tenant_row.storage_bucket,
        thumbnail_bucket=tenant_row.thumbnail_bucket,
        settings=tenant_settings,
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
    image = db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        tenant_column_filter(ImageMetadata, tenant),
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


@router.get("/images/{image_id}/playback", operation_id="get_image_playback")
async def get_image_playback(
    image_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    """Resolve a browser-playable source for video assets."""
    image = db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        tenant_column_filter(ImageMetadata, tenant),
    ).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    storage_info = _resolve_storage_or_409(
        image=image,
        tenant=tenant,
        db=db,
        require_source=True,
    )
    if _infer_media_type(image, storage_info) != "video":
        raise HTTPException(status_code=400, detail="Playback is only available for video assets")

    provider_name, source_ref = _resolve_provider_ref(storage_info, image)
    if not source_ref:
        raise HTTPException(status_code=404, detail=f"Video source is not available in {provider_name}")

    try:
        provider = create_storage_provider(provider_name, tenant=tenant, get_secret=get_secret)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to initialize {provider_name} provider: {exc}")

    playback_url = None
    try:
        playback_url = provider.get_playback_url(source_ref, expires_seconds=PLAYBACK_URL_TTL_SECONDS)
    except Exception:
        playback_url = None

    if playback_url:
        mode = "direct_url"
        expires_at = _build_expiry_timestamp(PLAYBACK_URL_TTL_SECONDS)
    else:
        mode = "proxy_stream"
        expires_at = None
        playback_url = f"/api/v1/images/{image_id}/playback/stream"

    asset = getattr(storage_info, "asset", None)
    mime_type = str(getattr(asset, "mime_type", "") or "").strip()
    if not mime_type:
        mime_type = _guess_content_type(filename=image.filename or "", source_ref=source_ref)

    return {
        "image_id": image.id,
        "asset_id": str(storage_info.asset_id) if storage_info.asset_id else None,
        "media_type": "video",
        "provider": provider_name,
        "mode": mode,
        "playback_url": playback_url,
        "expires_at": expires_at,
        "mime_type": mime_type,
    }


@router.get("/images/{image_id}/playback/stream", operation_id="stream_image_playback")
async def stream_image_playback(
    image_id: int,
    request: Request,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    """Proxy stream for video playback when provider direct links are unavailable."""
    image = db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        tenant_column_filter(ImageMetadata, tenant),
    ).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    storage_info = _resolve_storage_or_409(
        image=image,
        tenant=tenant,
        db=db,
        require_source=True,
    )
    if _infer_media_type(image, storage_info) != "video":
        raise HTTPException(status_code=400, detail="Playback is only available for video assets")

    provider_name, source_ref = _resolve_provider_ref(storage_info, image)
    if not source_ref:
        raise HTTPException(status_code=404, detail=f"Video source is not available in {provider_name}")

    try:
        provider = create_storage_provider(provider_name, tenant=tenant, get_secret=get_secret)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to initialize {provider_name} provider: {exc}")

    try:
        file_bytes = provider.download_file(source_ref)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error fetching {provider_name} video: {exc}")

    total_size = len(file_bytes)
    filename = image.filename or "video"
    content_type = str(getattr(getattr(storage_info, "asset", None), "mime_type", "") or "").strip()
    if not content_type:
        content_type = _guess_content_type(
            filename=filename,
            source_ref=source_ref,
            fallback="video/mp4",
        )

    status_code = 200
    payload = file_bytes
    headers = {
        "Cache-Control": "no-store",
        "Accept-Ranges": "bytes",
        "Content-Disposition": f'inline; filename="{filename}"',
        "Content-Length": str(total_size),
    }
    range_header = request.headers.get("range")
    if range_header and total_size > 0:
        try:
            start, end = _parse_single_range_header(range_header, total_size)
        except ValueError:
            raise HTTPException(
                status_code=416,
                detail="Requested range is not satisfiable",
                headers={"Content-Range": f"bytes */{total_size}"},
            )
        payload = file_bytes[start:end + 1]
        status_code = 206
        headers["Content-Range"] = f"bytes {start}-{end}/{total_size}"
        headers["Content-Length"] = str(len(payload))

    return StreamingResponse(
        iter([payload]),
        status_code=status_code,
        media_type=content_type,
        headers=headers,
    )
