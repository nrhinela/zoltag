"""Dropbox OAuth configuration helpers."""

from __future__ import annotations

from typing import Any, Callable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from zoltag.settings import settings

DEFAULT_RETURN_PATH = "/app?tab=library&subTab=providers"


def _normalize_selection_mode(selection_mode: str | None) -> str:
    normalized = str(selection_mode or "").strip().lower()
    if normalized == "managed_only":
        return normalized
    return "managed_only"


def _read_secret(secret_name: str | None, get_secret: Callable[[str], str]) -> str:
    if not secret_name:
        return ""
    try:
        value = get_secret(secret_name)
    except Exception:
        return ""
    return str(value or "").strip()


def inspect_dropbox_oauth_config(
    *,
    tenant_id: str,
    tenant_app_key: str | None,
    get_secret: Callable[[str], str],
    tenant_app_secret_name: str | None = None,
    selection_mode: str | None = None,
) -> dict[str, Any]:
    """Inspect managed Dropbox OAuth credential availability for a tenant."""
    selection_mode = _normalize_selection_mode(selection_mode)
    _ = tenant_id
    _ = tenant_app_key
    _ = tenant_app_secret_name

    managed_app_key = _read_secret(settings.dropbox_app_key_secret, get_secret)
    managed_app_secret = _read_secret(settings.dropbox_app_secret_secret, get_secret)
    managed_ready = bool(managed_app_key and managed_app_secret)
    can_connect = managed_ready

    selected_mode = "unconfigured"
    selected_app_key = ""
    selected_app_secret_name = ""
    issues: list[str] = []

    if managed_ready:
        selected_mode = "managed"
        selected_app_key = managed_app_key
        selected_app_secret_name = settings.dropbox_app_secret_secret
    else:
        issues.append("managed_dropbox_oauth_not_configured")

    return {
        "tenant_ready": False,
        "managed_ready": managed_ready,
        "can_connect": can_connect,
        "selected_mode": selected_mode,
        "selection_mode": selection_mode,
        "selected_app_key": selected_app_key,
        "selected_app_secret_name": selected_app_secret_name,
        "issues": issues,
    }


def load_dropbox_oauth_credentials(
    *,
    tenant_id: str,
    tenant_app_key: str | None,
    get_secret: Callable[[str], str],
    tenant_app_secret_name: str | None = None,
    selection_mode: str | None = None,
) -> dict[str, str]:
    """Load the selected Dropbox OAuth app key + app secret value."""
    config = inspect_dropbox_oauth_config(
        tenant_id=tenant_id,
        tenant_app_key=tenant_app_key,
        tenant_app_secret_name=tenant_app_secret_name,
        get_secret=get_secret,
        selection_mode=selection_mode,
    )
    app_key = config["selected_app_key"]
    app_secret_name = config["selected_app_secret_name"]
    app_secret = _read_secret(app_secret_name, get_secret)
    if not app_key or not app_secret:
        issue = ", ".join(config["issues"]) if config["issues"] else "dropbox_oauth_not_configured"
        raise ValueError(f"Dropbox OAuth is not configured: {issue}")
    return {
        "mode": config["selected_mode"],
        "app_key": app_key,
        "app_secret_name": app_secret_name,
        "app_secret": app_secret,
    }


def sanitize_return_path(path: str | None) -> str:
    """Restrict return path to same-origin absolute paths."""
    candidate = str(path or "").strip()
    if not candidate:
        return DEFAULT_RETURN_PATH
    parsed = urlsplit(candidate)
    if parsed.scheme or parsed.netloc:
        return DEFAULT_RETURN_PATH
    if not parsed.path.startswith("/") or parsed.path.startswith("//"):
        return DEFAULT_RETURN_PATH
    return urlunsplit(("", "", parsed.path, parsed.query, parsed.fragment))


def sanitize_redirect_origin(origin: str | None) -> str | None:
    """Normalize an absolute origin (scheme + host)."""
    candidate = str(origin or "").strip()
    if not candidate:
        return None
    parsed = urlsplit(candidate)
    if parsed.scheme not in {"http", "https"}:
        return None
    if not parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


def append_query_params(url_path: str, params: dict[str, str]) -> str:
    """Append query params to a same-origin path."""
    parsed = urlsplit(url_path)
    existing = dict(parse_qsl(parsed.query, keep_blank_values=True))
    for key, value in params.items():
        existing[str(key)] = str(value)
    query = urlencode(existing)
    return urlunsplit(("", "", parsed.path, query, parsed.fragment))
