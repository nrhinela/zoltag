"""Router for YouTube OAuth handlers."""

from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from zoltag import oauth_state
from zoltag.dependencies import get_db, get_secret, store_secret
from zoltag.dropbox_oauth import append_query_params, sanitize_redirect_origin, sanitize_return_path
from zoltag.integrations import TenantIntegrationRepository
from zoltag.metadata import Tenant as TenantModel
from zoltag.settings import settings
from zoltag.tenant_scope import tenant_reference_filter

router = APIRouter(
    tags=["youtube"],
)


def _resolve_youtube_credentials() -> tuple[str, str]:
    """Return (client_id, client_secret) for the YouTube/Google OAuth app."""
    client_id = str(settings.zoltag_gdrive_connector_client_id or "").strip()
    client_secret = str(settings.zoltag_gdrive_connector_secret or "").strip()
    return client_id, client_secret


def _resolve_tenant(db: Session, tenant_ref: str):
    return db.query(TenantModel).filter(tenant_reference_filter(TenantModel, tenant_ref)).first()


def _resolve_redirect_origin(request: Request, explicit_origin: str | None = None) -> str:
    """Resolve callback origin, preferring explicit caller-provided origin."""
    candidates: list[str | None] = [
        explicit_origin,
        request.headers.get("x-forwarded-origin"),
        request.headers.get("origin"),
        settings.app_url,
    ]
    x_forwarded_host = request.headers.get("x-forwarded-host")
    x_forwarded_proto = request.headers.get("x-forwarded-proto")
    if x_forwarded_host:
        proto = (x_forwarded_proto or request.url.scheme or "https").split(",")[0].strip()
        host = x_forwarded_host.split(",")[0].strip()
        candidates.insert(1, f"{proto}://{host}")
    host_header = request.headers.get("host")
    if host_header:
        candidates.insert(2, f"{request.url.scheme}://{host_header}")

    for candidate in candidates:
        normalized = sanitize_redirect_origin(candidate)
        if normalized:
            return normalized
    raise HTTPException(status_code=500, detail="Unable to resolve OAuth redirect origin")


@router.get("/oauth/youtube/authorize")
async def youtube_authorize(
    request: Request,
    tenant: str,
    flow: str = "popup",
    provider_id: str | None = None,
    redirect_origin: str | None = None,
    return_to: str | None = None,
    db: Session = Depends(get_db),
):
    """Redirect user to Google OAuth consent for YouTube access."""
    flow = "redirect" if flow == "redirect" else "popup"
    resolved_return_to = sanitize_return_path(return_to)
    tenant_obj = _resolve_tenant(db, tenant)
    if not tenant_obj:
        raise HTTPException(status_code=400, detail="Tenant not found")

    repo = TenantIntegrationRepository(db)
    try:
        provider_record = repo.get_provider_record(tenant_obj, "youtube", provider_id=provider_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    client_id, _client_secret = _resolve_youtube_credentials()
    if not client_id:
        raise HTTPException(status_code=400, detail="YouTube client ID not configured")

    resolved_origin = _resolve_redirect_origin(request, redirect_origin)
    redirect_uri = f"{resolved_origin}/oauth/youtube/callback"
    state = oauth_state.generate_with_context(
        str(tenant_obj.id),
        {
            "flow": flow,
            "return_to": resolved_return_to,
            "redirect_origin": resolved_origin,
            "provider_id": provider_record.id,
        },
    )
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "https://www.googleapis.com/auth/youtube.readonly",
        "access_type": "offline",
        "include_granted_scopes": "true",
        "prompt": "consent",
        "state": state,
    }
    oauth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"
    return RedirectResponse(oauth_url)


@router.get("/oauth/youtube/callback")
async def youtube_callback(
    request: Request,
    code: str,
    state: str,
    db: Session = Depends(get_db),
):
    """Handle Google OAuth callback and persist YouTube refresh token."""
    state_payload = oauth_state.consume_with_context(state)
    state_context: dict = {}
    if state_payload:
        tenant_id = state_payload["tenant_id"]
        state_context = state_payload.get("context", {}) or {}
    else:
        tenant_id = oauth_state.consume(state)
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")

    tenant_obj = _resolve_tenant(db, tenant_id)
    if not tenant_obj:
        raise HTTPException(status_code=400, detail="Tenant not found")

    provider_id = str(state_context.get("provider_id") or "").strip() or None
    repo = TenantIntegrationRepository(db)
    try:
        provider_record = repo.get_provider_record(tenant_obj, "youtube", provider_id=provider_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    token_secret = provider_record.youtube_token_secret_name
    client_id, client_secret = _resolve_youtube_credentials()

    if not client_id:
        raise HTTPException(status_code=400, detail="YouTube client ID not configured")
    if not client_secret:
        raise HTTPException(status_code=400, detail="YouTube client secret not configured")

    resolved_origin = _resolve_redirect_origin(request, state_context.get("redirect_origin"))
    redirect_uri = f"{resolved_origin}/oauth/youtube/callback"

    with httpx.Client(timeout=30) as client:
        response = client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "grant_type": "authorization_code",
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
            },
        )

    if response.status_code != 200:
        raise HTTPException(status_code=400, detail=f"Failed to exchange code: {response.text}")

    payload = response.json()
    refresh_token = payload.get("refresh_token")
    if not refresh_token:
        raise HTTPException(
            status_code=400,
            detail="Google OAuth did not return a refresh token. Re-authorize with prompt=consent.",
        )

    store_secret(token_secret, refresh_token)

    repo.update_provider(
        tenant_obj,
        "youtube",
        provider_id=provider_record.id,
        token_secret_name=token_secret,
        config_json_patch={"token_stored": True},
    )
    db.commit()

    flow = str(state_context.get("flow") or "").strip().lower()
    if flow == "redirect":
        return_to = sanitize_return_path(state_context.get("return_to"))
        redirect_target = append_query_params(
            return_to,
            {
                "integration": "youtube",
                "result": "connected",
            },
        )
        return RedirectResponse(redirect_target)

    return HTMLResponse(
        """
        <html>
            <body>
                <h1>YouTube Connected</h1>
                <p>You can close this window and return to Zoltag.</p>
                <script>window.close();</script>
            </body>
        </html>
        """
    )
