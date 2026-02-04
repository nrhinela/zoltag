"""API endpoints for configuration management."""

from typing import List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from photocat.tenant import Tenant
from photocat.settings import settings


router = APIRouter(prefix="/api/v1/config", tags=["configuration"])


# Import dependencies from main API module
from photocat.api import get_tenant, get_db


class KeywordCategoryInput(BaseModel):
    """Input model for keyword category."""
    name: str
    keywords: List[str | dict]
    subcategories: List["KeywordCategoryInput"] = []
    sort_order: int = 0
    is_attribution: bool = False


class PersonInput(BaseModel):
    """Input model for person."""
    name: str
    aliases: List[str] = []
    face_embedding_ref: str | None = None


class ConfigResponse(BaseModel):
    """Response model for configuration."""
    keywords: List[dict]
    people: List[dict]


@router.get("/keywords")
async def get_keywords(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
) -> List[dict]:
    """Get all keywords for tenant."""
    from photocat.config.db_config import ConfigManager
    manager = ConfigManager(db, tenant.id)
    return manager.get_all_keywords()


@router.post("/keywords")
async def save_keywords(
    categories: List[dict],
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Save keyword configuration."""
    from photocat.config.db_config import ConfigManager
    manager = ConfigManager(db, tenant.id)
    manager.save_keywords(categories)
    return {"status": "success", "message": "Keywords saved"}


@router.get("/people")
async def get_people(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
) -> List[dict]:
    """Get all people for tenant."""
    from photocat.config.db_config import ConfigManager
    manager = ConfigManager(db, tenant.id)
    return manager.get_people()


@router.post("/people")
async def save_people(
    people: List[dict],
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Save people configuration."""
    from photocat.config.db_config import ConfigManager
    manager = ConfigManager(db, tenant.id)
    manager.save_people(people)
    return {"status": "success", "message": "People saved"}


@router.post("/migrate-from-yaml")
async def migrate_from_yaml(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Legacy YAML migration removed (DB-only config)."""
    raise HTTPException(
        status_code=410,
        detail="YAML config migration has been removed; configuration is stored in the database."
    )


@router.get("")
async def get_full_config(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
) -> ConfigResponse:
    """Get complete configuration for tenant."""
    from photocat.config.db_config import ConfigManager
    manager = ConfigManager(db, tenant.id)
    return ConfigResponse(
        keywords=manager.get_all_keywords(),
        people=manager.get_people()
    )


class TaggingModelInput(BaseModel):
    """Input model for tagging model selection."""
    model: str


@router.get("/tagging-model")
async def get_tagging_model():
    """Get default tagging model configuration."""
    return {
        "default_model": "siglip",
        "available_models": ["siglip"]
    }


@router.get("/system")
async def get_system_settings():
    """Get system-level settings (read-only)."""
    # Compute the shared bucket name using environment convention (lowercase for GCS)
    env = settings.environment.lower()
    shared_bucket = f"{settings.gcp_project_id}-{env}-shared"

    return {
        "environment": settings.environment,
        "gcp_project_id": settings.gcp_project_id,
        "gcp_region": settings.gcp_region,
        "storage_bucket_name": shared_bucket,  # Show computed shared bucket
        "thumbnail_bucket_name": settings.thumbnail_bucket_name,
        "app_name": settings.app_name,
        "debug": settings.debug
    }
