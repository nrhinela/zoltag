"""API endpoints for configuration management."""

import os
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
    """Migrate configuration from YAML files to database."""
    from photocat.config.db_config import ConfigManager
    manager = ConfigManager(db, tenant.id)
    success = manager.migrate_from_yaml()
    
    if success:
        return {"status": "success", "message": "Configuration migrated from YAML"}
    else:
        raise HTTPException(
            status_code=404,
            detail=f"No YAML configuration found for tenant {tenant.id}"
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
