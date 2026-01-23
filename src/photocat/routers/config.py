"""Router for system configuration endpoints."""

from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
import click

from photocat.dependencies import get_db, get_tenant
from photocat.tenant import Tenant
from photocat.models.config import PersonCategory

router = APIRouter(
    prefix="/api/v1/config",
    tags=["config"]
)


# ============================================================================
# Request/Response Models
# ============================================================================

class PersonCategoryResponse(BaseModel):
    """Response model for a person category."""
    id: int
    name: str
    display_name: str
    created_at: str = ""

    class Config:
        from_attributes = True


@router.get("/system")
async def get_system_config():
    """Get system configuration (environment, version, GCP settings, etc.)."""
    from photocat.settings import settings

    return {
        "environment": settings.environment,
        "version": "0.1.0",
        "api_url": settings.api_url if hasattr(settings, 'api_url') else "/api",
        "debug": settings.debug,
        "use_keyword_models": settings.use_keyword_models,
        "keyword_model_weight": settings.keyword_model_weight,
        "gcp_project_id": settings.gcp_project_id,
        "gcp_region": settings.gcp_region,
        "storage_bucket_name": settings.storage_bucket_name
    }


@router.get("/cli-commands")
async def get_cli_commands():
    """Return CLI command metadata for the UI."""
    from photocat.cli import cli as cli_group

    commands = []
    for name, command in sorted(cli_group.commands.items()):
        ctx = click.Context(command, info_name=f"photocat {name}")
        params = []
        for param in command.params:
            default = getattr(param, "default", None)
            if default is object:
                default = None
            elif not isinstance(default, (str, int, float, bool, type(None), list, dict)):
                default = str(default)
            entry = {
                "name": param.name,
                "param_type": "option" if isinstance(param, click.Option) else "argument",
                "opts": list(getattr(param, "opts", [])),
                "help": getattr(param, "help", "") or "",
                "default": default,
                "required": bool(getattr(param, "required", False)),
                "nargs": getattr(param, "nargs", None),
            }
            params.append(entry)
        commands.append({
            "name": name,
            "help": command.help or "",
            "usage": command.get_usage(ctx).replace("Usage:", "").strip(),
            "params": params,
        })

    return {"commands": commands}


# ============================================================================
# People Categories Configuration
# ============================================================================

@router.get("/people/categories", response_model=List[PersonCategoryResponse])
async def get_people_categories(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Get all person categories for a tenant."""
    categories = db.query(PersonCategory).filter(
        PersonCategory.tenant_id == tenant.id
    ).order_by(PersonCategory.name).all()

    return [
        PersonCategoryResponse(
            id=cat.id,
            name=cat.name,
            display_name=cat.display_name,
            created_at=cat.created_at.isoformat() if cat.created_at else ""
        )
        for cat in categories
    ]


@router.post("/people/categories/initialize", response_model=dict)
async def initialize_default_people_categories(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Initialize default person categories for a tenant.

    Creates standard categories:
    - photo_author: Person who took the photo
    - people_in_scene: People appearing in the photo

    Safely handles tenants that already have categories (no-op).
    """
    # Check if categories already exist
    existing = db.query(PersonCategory).filter(
        PersonCategory.tenant_id == tenant.id
    ).count()

    if existing > 0:
        return {
            "status": "already_initialized",
            "message": f"Tenant already has {existing} person categories",
            "categories_count": existing
        }

    try:
        # Default categories
        default_categories = [
            {
                "name": "photo_author",
                "display_name": "Photo Author"
            },
            {
                "name": "people_in_scene",
                "display_name": "People in Scene"
            }
        ]

        created_categories = []
        for cat_def in default_categories:
            category = PersonCategory(
                tenant_id=tenant.id,
                name=cat_def["name"],
                display_name=cat_def["display_name"]
            )
            db.add(category)
            db.flush()
            created_categories.append({
                "id": category.id,
                "name": category.name,
                "display_name": category.display_name
            })

        db.commit()

        return {
            "status": "initialized",
            "message": "Default person categories created",
            "categories": created_categories
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to initialize categories: {str(e)}"
        )
