"""Router for system configuration endpoints."""

from fastapi import APIRouter
import click

router = APIRouter(
    prefix="/api/v1/config",
    tags=["config"]
)


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
            entry = {
                "name": param.name,
                "param_type": "option" if isinstance(param, click.Option) else "argument",
                "opts": list(getattr(param, "opts", [])),
                "help": getattr(param, "help", "") or "",
                "default": getattr(param, "default", None),
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
