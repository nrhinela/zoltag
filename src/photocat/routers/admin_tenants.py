"""Router for tenant management endpoints."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from photocat.dependencies import get_db
from photocat.metadata import Tenant as TenantModel

router = APIRouter(
    prefix="/api/v1/admin/tenants",
    tags=["admin-tenants"]
)


@router.get("", response_model=list)
async def list_tenants(
    db: Session = Depends(get_db),
    details: bool = False
):
    """List all tenants."""
    if details:
        tenants = db.query(TenantModel).all()
        return [{
            "id": t.id,
            "name": t.name,
            "active": t.active,
            "dropbox_app_key": t.dropbox_app_key,
            "dropbox_configured": bool(t.dropbox_app_key),  # Has app key configured
            "storage_bucket": t.storage_bucket,
            "thumbnail_bucket": t.thumbnail_bucket,
            "settings": t.settings,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "updated_at": t.updated_at.isoformat() if t.updated_at else None
        } for t in tenants]

    rows = db.query(
        TenantModel.id,
        TenantModel.name,
        TenantModel.active,
        TenantModel.dropbox_app_key,
        TenantModel.storage_bucket,
        TenantModel.thumbnail_bucket,
        TenantModel.created_at,
        TenantModel.updated_at
    ).all()

    return [{
        "id": row.id,
        "name": row.name,
        "active": row.active,
        "dropbox_configured": bool(row.dropbox_app_key),
        "storage_bucket": row.storage_bucket,
        "thumbnail_bucket": row.thumbnail_bucket,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None
    } for row in rows]


@router.get("/{tenant_id}", response_model=dict)
async def get_tenant(
    tenant_id: str,
    db: Session = Depends(get_db)
):
    """Get a single tenant (full details)."""
    tenant = db.query(TenantModel).filter(TenantModel.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    return {
        "id": tenant.id,
        "name": tenant.name,
        "active": tenant.active,
        "dropbox_app_key": tenant.dropbox_app_key,
        "dropbox_configured": bool(tenant.dropbox_app_key),
        "storage_bucket": tenant.storage_bucket,
        "thumbnail_bucket": tenant.thumbnail_bucket,
        "settings": tenant.settings,
        "created_at": tenant.created_at.isoformat() if tenant.created_at else None,
        "updated_at": tenant.updated_at.isoformat() if tenant.updated_at else None
    }


@router.post("", response_model=dict)
async def create_tenant(
    tenant_data: dict,
    db: Session = Depends(get_db)
):
    """Create a new tenant."""
    # Validate required fields
    if not tenant_data.get("id") or not tenant_data.get("name"):
        raise HTTPException(status_code=400, detail="id and name are required")

    # Check if tenant already exists
    existing = db.query(TenantModel).filter(TenantModel.id == tenant_data["id"]).first()
    if existing:
        raise HTTPException(status_code=409, detail="Tenant already exists")

    # Create tenant
    tenant = TenantModel(
        id=tenant_data["id"],
        name=tenant_data["name"],
        active=tenant_data.get("active", True),
        dropbox_app_key=tenant_data.get("dropbox_app_key"),
        settings=tenant_data.get("settings", {})
    )

    db.add(tenant)
    db.commit()
    db.refresh(tenant)

    return {
        "id": tenant.id,
        "name": tenant.name,
        "active": tenant.active,
        "created_at": tenant.created_at.isoformat()
    }


@router.put("/{tenant_id}", response_model=dict)
async def update_tenant(
    tenant_id: str,
    tenant_data: dict,
    db: Session = Depends(get_db)
):
    """Update an existing tenant."""
    tenant = db.query(TenantModel).filter(TenantModel.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    # Update fields
    if "name" in tenant_data:
        tenant.name = tenant_data["name"]
    if "active" in tenant_data:
        tenant.active = tenant_data["active"]
    if "dropbox_app_key" in tenant_data:
        tenant.dropbox_app_key = tenant_data["dropbox_app_key"]
    if "storage_bucket" in tenant_data:
        tenant.storage_bucket = tenant_data["storage_bucket"]
    if "thumbnail_bucket" in tenant_data:
        tenant.thumbnail_bucket = tenant_data["thumbnail_bucket"]
    if "settings" in tenant_data:
        tenant.settings = tenant_data["settings"]

    tenant.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(tenant)

    return {
        "id": tenant.id,
        "name": tenant.name,
        "active": tenant.active,
        "updated_at": tenant.updated_at.isoformat()
    }


@router.patch("/{tenant_id}/settings", response_model=dict)
async def update_tenant_settings(
    tenant_id: str,
    settings_update: dict,
    db: Session = Depends(get_db)
):
    """Partially update tenant settings (merge with existing settings)."""
    tenant = db.query(TenantModel).filter(TenantModel.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    # Get existing settings or initialize empty dict
    current_settings = tenant.settings or {}

    # Merge with new settings
    current_settings.update(settings_update)

    # Update tenant
    tenant.settings = current_settings
    tenant.updated_at = datetime.utcnow()

    # Mark settings as modified so SQLAlchemy detects the JSONB change
    flag_modified(tenant, "settings")

    db.commit()
    db.refresh(tenant)

    return {
        "id": tenant.id,
        "settings": tenant.settings,
        "updated_at": tenant.updated_at.isoformat()
    }


@router.delete("/{tenant_id}", response_model=dict)
async def delete_tenant(
    tenant_id: str,
    db: Session = Depends(get_db)
):
    """Delete a tenant and all associated data."""
    tenant = db.query(TenantModel).filter(TenantModel.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    db.delete(tenant)
    db.commit()

    return {"status": "deleted", "tenant_id": tenant_id}
