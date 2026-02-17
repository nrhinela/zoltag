"""Asset notes endpoints (keyed to assets, accessed via image_id)."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session

from zoltag.dependencies import get_db, get_tenant
from zoltag.tenant import Tenant
from zoltag.metadata import AssetNote, ImageMetadata
from zoltag.tenant_scope import tenant_column_filter
from zoltag.auth.dependencies import require_tenant_permission_from_header
from zoltag.auth.models import UserProfile
from zoltag.text_index import rebuild_asset_text_index

router = APIRouter()
logger = logging.getLogger(__name__)


def _resolve_asset_id(image_id: int, tenant: Tenant, db: Session):
    """Look up asset_id from image_metadata, enforcing tenant scope."""
    image = db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        tenant_column_filter(ImageMetadata, tenant),
    ).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    return image.asset_id


@router.get("/images/{image_id}/notes/{note_type}", response_model=dict, operation_id="get_asset_note")
async def get_asset_note(
    image_id: int,
    note_type: str,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    """Return a single note of the given type for an asset, or null body if none exists."""
    asset_id = _resolve_asset_id(image_id, tenant, db)
    note = db.query(AssetNote).filter(
        AssetNote.asset_id == asset_id,
        AssetNote.note_type == note_type,
    ).first()
    if not note:
        return {"asset_id": str(asset_id), "note_type": note_type, "body": None}
    return {"id": str(note.id), "asset_id": str(asset_id), "note_type": note.note_type, "body": note.body}


@router.put("/images/{image_id}/notes/{note_type}", response_model=dict, operation_id="upsert_asset_note")
async def upsert_asset_note(
    image_id: int,
    note_type: str,
    body: str = Body(..., embed=True),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(require_tenant_permission_from_header("image.note.edit")),
):
    """Create or replace a note of the given type for an asset."""
    asset_id = _resolve_asset_id(image_id, tenant, db)
    note = db.query(AssetNote).filter(
        AssetNote.asset_id == asset_id,
        AssetNote.note_type == note_type,
    ).first()
    if note:
        note.body = body
    else:
        note = AssetNote(
            asset_id=asset_id,
            tenant_id=tenant.id,
            note_type=note_type,
            body=body,
            created_by=current_user.supabase_uid if current_user else None,
        )
        db.add(note)
    db.commit()
    db.refresh(note)
    try:
        rebuild_asset_text_index(
            db,
            tenant_id=tenant.id,
            asset_id=asset_id,
            include_embeddings=False,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to refresh asset_text_index for asset %s: %s", asset_id, exc)
    return {"id": str(note.id), "asset_id": str(asset_id), "note_type": note.note_type, "body": note.body}
