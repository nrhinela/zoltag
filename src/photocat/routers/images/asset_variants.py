"""Asset variant (derivative) CRUD endpoints."""

import io
import mimetypes
from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, HTTPException, Body, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from google.cloud import storage
from google.api_core.exceptions import NotFound

from photocat.dependencies import get_db, get_tenant
from photocat.auth.dependencies import require_tenant_role_from_header
from photocat.auth.models import UserProfile
from photocat.tenant import Tenant
from photocat.metadata import Asset, AssetDerivative, ImageMetadata
from photocat.settings import settings
from photocat.routers.images._shared import (
    _serialize_asset_variant,
    _user_display_name_from_fields,
    _build_user_name_map,
    _get_image_and_asset_or_409,
)

router = APIRouter()


@router.get("/images/{image_id}/asset-variants", response_model=dict, operation_id="list_asset_variants")
async def list_asset_variants(
    image_id: int,
    include_object_metadata: bool = False,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    """List derivative variants for an image asset."""
    _image, asset = _get_image_and_asset_or_409(db, tenant, image_id)
    variants = db.query(AssetDerivative).filter(
        AssetDerivative.asset_id == asset.id,
        AssetDerivative.deleted_at.is_(None),
    ).order_by(AssetDerivative.created_at.desc(), AssetDerivative.id.desc()).all()
    user_ids = {row.created_by for row in variants if row.created_by is not None}
    user_name_map = _build_user_name_map(db, user_ids)

    # Fast path: avoid per-object storage metadata lookups unless explicitly requested.
    variant_sizes: dict[str, Optional[int]] = {str(row.id): None for row in variants}
    if include_object_metadata and variants:
        try:
            storage_client = storage.Client(project=settings.gcp_project_id)
            bucket = storage_client.bucket(tenant.get_storage_bucket(settings))
            for row in variants:
                size_value: Optional[int] = None
                try:
                    blob = bucket.blob(row.storage_key)
                    blob.reload()
                    size_value = int(blob.size) if blob.size is not None else None
                except NotFound:
                    size_value = None
                except Exception:
                    size_value = None
                variant_sizes[str(row.id)] = size_value
        except Exception:
            # Keep null sizes if storage metadata fetch fails.
            pass

    return {
        "image_id": image_id,
        "asset_id": str(asset.id),
        "variants": [
            _serialize_asset_variant(
                image_id,
                variant,
                tenant,
                file_size_bytes=variant_sizes.get(str(variant.id)),
                created_by_name=user_name_map.get(str(variant.created_by)),
            )
            for variant in variants
        ],
    }


@router.post("/images/{image_id}/asset-variants", response_model=dict, operation_id="upload_asset_variant")
async def upload_asset_variant(
    image_id: int,
    file: UploadFile = File(...),
    variant: Optional[str] = Form(default=None),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(require_tenant_role_from_header("editor")),
):
    """Upload and create a derivative variant record for an image asset."""
    _image, asset = _get_image_and_asset_or_409(db, tenant, image_id)

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    filename = (file.filename or "").strip() or "variant-file"
    derivative_id = uuid4()
    storage_key = tenant.get_asset_derivative_key(str(derivative_id), filename)

    derivative = AssetDerivative(
        id=derivative_id,
        asset_id=asset.id,
        storage_key=storage_key,
        filename=filename,
        variant=(variant or "").strip() or None,
        created_by=current_user.supabase_uid,
    )

    try:
        storage_client = storage.Client(project=settings.gcp_project_id)
        bucket = storage_client.bucket(tenant.get_storage_bucket(settings))
        blob = bucket.blob(storage_key)
        blob.cache_control = "public, max-age=31536000, immutable"
        content_type = file.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
        blob.upload_from_string(file_bytes, content_type=content_type)

        db.add(derivative)
        db.commit()
        db.refresh(derivative)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to upload variant: {exc}")

    return _serialize_asset_variant(
        image_id,
        derivative,
        tenant,
        file_size_bytes=len(file_bytes),
        created_by_name=_user_display_name_from_fields(
            getattr(current_user, "display_name", None),
            getattr(current_user, "email", None),
        ),
    )


@router.patch("/images/{image_id}/asset-variants/{variant_id}", response_model=dict, operation_id="update_asset_variant")
async def update_asset_variant(
    image_id: int,
    variant_id: UUID,
    payload: dict = Body(...),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(require_tenant_role_from_header("editor")),
):
    """Update derivative variant metadata and optionally rename backing object."""
    _ = current_user
    _image, asset = _get_image_and_asset_or_409(db, tenant, image_id)
    row = db.query(AssetDerivative).filter(
        AssetDerivative.id == variant_id,
        AssetDerivative.asset_id == asset.id,
        AssetDerivative.deleted_at.is_(None),
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Asset variant not found")

    new_variant = payload.get("variant")
    if new_variant is not None:
        new_variant = str(new_variant).strip()
        row.variant = new_variant or None

    new_filename_raw = payload.get("filename")
    if new_filename_raw is not None:
        new_filename = str(new_filename_raw).strip()
        if not new_filename:
            raise HTTPException(status_code=400, detail="filename cannot be empty")
        new_storage_key = tenant.get_asset_derivative_key(str(row.id), new_filename)
        if new_storage_key != row.storage_key:
            try:
                storage_client = storage.Client(project=settings.gcp_project_id)
                bucket = storage_client.bucket(tenant.get_storage_bucket(settings))
                src_blob = bucket.blob(row.storage_key)
                if src_blob.exists():
                    bucket.copy_blob(src_blob, bucket, new_storage_key)
                    src_blob.delete()
                row.storage_key = new_storage_key
            except Exception as exc:
                db.rollback()
                raise HTTPException(status_code=500, detail=f"Failed to rename variant object: {exc}")
        row.filename = new_filename

    db.add(row)
    db.commit()
    db.refresh(row)
    user_name_map = _build_user_name_map(db, {row.created_by} if row.created_by else set())
    return _serialize_asset_variant(
        image_id,
        row,
        tenant,
        created_by_name=user_name_map.get(str(row.created_by)),
    )


@router.delete("/images/{image_id}/asset-variants/{variant_id}", response_model=dict, operation_id="delete_asset_variant")
async def delete_asset_variant(
    image_id: int,
    variant_id: UUID,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(require_tenant_role_from_header("editor")),
):
    """Delete a derivative variant and remove its backing object from storage."""
    _ = current_user
    _image, asset = _get_image_and_asset_or_409(db, tenant, image_id)
    row = db.query(AssetDerivative).filter(
        AssetDerivative.id == variant_id,
        AssetDerivative.asset_id == asset.id,
        AssetDerivative.deleted_at.is_(None),
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Asset variant not found")

    try:
        storage_client = storage.Client(project=settings.gcp_project_id)
        bucket = storage_client.bucket(tenant.get_storage_bucket(settings))
        blob = bucket.blob(row.storage_key)
        try:
            blob.delete()
        except NotFound:
            pass
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete variant object: {exc}")

    db.delete(row)
    db.commit()
    return {"status": "ok", "id": str(variant_id)}


@router.get("/images/{image_id}/asset-variants/{variant_id}/inspect", response_model=dict, operation_id="inspect_asset_variant")
async def inspect_asset_variant(
    image_id: int,
    variant_id: UUID,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    """Inspect object metadata for a variant (on-demand)."""
    _image, asset = _get_image_and_asset_or_409(db, tenant, image_id)
    row = db.query(AssetDerivative).filter(
        AssetDerivative.id == variant_id,
        AssetDerivative.asset_id == asset.id,
        AssetDerivative.deleted_at.is_(None),
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Asset variant not found")

    try:
        storage_client = storage.Client(project=settings.gcp_project_id)
        bucket = storage_client.bucket(tenant.get_storage_bucket(settings))
        blob = bucket.blob(row.storage_key)
        if not blob.exists():
            raise HTTPException(status_code=404, detail="Variant object not found in storage")
        blob.reload()
        file_size_bytes = int(blob.size) if blob.size is not None else None
        content_type = blob.content_type or mimetypes.guess_type(row.filename or "")[0] or "application/octet-stream"

        width = None
        height = None
        if content_type.startswith("image/"):
            try:
                from PIL import Image

                image_data = blob.download_as_bytes()
                with Image.open(io.BytesIO(image_data)) as img:
                    width, height = img.size
            except Exception:
                width = None
                height = None

        return {
            "id": str(row.id),
            "asset_id": str(row.asset_id),
            "storage_key": row.storage_key,
            "file_size_bytes": file_size_bytes,
            "content_type": content_type,
            "width": width,
            "height": height,
            "inspected_at": datetime.utcnow().isoformat(),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to inspect variant: {exc}")


@router.get("/images/{image_id}/asset-variants/{variant_id}/content", operation_id="get_asset_variant_content")
async def get_asset_variant_content(
    image_id: int,
    variant_id: UUID,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    """Stream an asset-derivative object for preview/download."""
    _image, asset = _get_image_and_asset_or_409(db, tenant, image_id)
    row = db.query(AssetDerivative).filter(
        AssetDerivative.id == variant_id,
        AssetDerivative.asset_id == asset.id,
        AssetDerivative.deleted_at.is_(None),
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Asset variant not found")

    try:
        storage_client = storage.Client(project=settings.gcp_project_id)
        bucket = storage_client.bucket(tenant.get_storage_bucket(settings))
        blob = bucket.blob(row.storage_key)
        if not blob.exists():
            raise HTTPException(status_code=404, detail="Variant object not found in storage")
        content = blob.download_as_bytes()
        content_type = blob.content_type or mimetypes.guess_type(row.filename or "")[0] or "application/octet-stream"
        return StreamingResponse(
            iter([content]),
            media_type=content_type,
            headers={
                "Cache-Control": "public, max-age=3600",
                "Content-Disposition": f'inline; filename="{row.filename or "variant"}"',
            },
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error fetching variant content: {exc}")
