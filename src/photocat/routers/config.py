"""Router for system configuration endpoints."""

from fastapi import APIRouter

router = APIRouter(
    prefix="/api/v1/config",
    tags=["config"]
)


@router.get("/system")
async def get_system_config():
    """Get system configuration (environment, version, etc.)."""
    import os
    from photocat.settings import settings
    
    return {
        "environment": os.getenv("ENVIRONMENT", "development"),
        "version": "0.1.0",
        "api_url": settings.api_url if hasattr(settings, 'api_url') else "/api",
        "debug": settings.debug
    }
