"""Router for system configuration endpoints."""

from fastapi import APIRouter

from zoltag.cli.introspection import list_cli_commands_metadata

router = APIRouter(
    prefix="/api/v1/config",
    tags=["config"]
)


# ============================================================================
# Request/Response Models
# ============================================================================

@router.get("/system")
async def get_system_config():
    """Get system configuration (environment, version, GCP settings, etc.)."""
    from zoltag.settings import settings

    return {
        "environment": settings.environment,
        "version": "0.1.0",
        "api_url": settings.api_url if hasattr(settings, 'api_url') else "/api",
        "debug": settings.debug,
        "zeroshot_tag_threshold": settings.zeroshot_tag_threshold,
        "trained_tag_threshold": settings.trained_tag_threshold,
        "gcp_project_id": settings.gcp_project_id,
        "gcp_region": settings.gcp_region,
        "storage_bucket_name": settings.storage_bucket_name
    }


@router.get("/cli-commands")
async def get_cli_commands():
    """Return CLI command metadata for the UI."""
    return {"commands": list_cli_commands_metadata()}
