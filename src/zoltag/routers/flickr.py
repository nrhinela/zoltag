"""Router for Flickr OAuth handlers."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from zoltag import oauth_state
from zoltag.dependencies import delete_secret, get_db, get_secret, store_secret
from zoltag.dropbox_oauth import (
    append_query_params,
    is_allowed_redirect_origin,
    sanitize_redirect_origin,
    sanitize_return_path,
)
from zoltag.integrations import TenantIntegrationRepository
from zoltag.metadata import Tenant as TenantModel
from zoltag.settings import settings
from zoltag.tenant_scope import tenant_reference_filter

router = APIRouter(
    tags=["flickr"],
)

_FLICKR_REQUEST_TOKEN_URL = "https://www.flickr.com/services/oauth/request_token"
_FLICKR_AUTHORIZE_URL = "https://www.flickr.com/services/oauth/authorize"
_FLICKR_ACCESS_TOKEN_URL = "https://www.flickr.com/services/oauth/access_token"


def _resolve_flickr_credentials() -> tuple[str, str]:
    """Return (api_key, api_secret) for shared Flickr OAuth app."""
    api_key = str(settings.zoltag_flickr_connector_api_key or "").strip()
    api_secret = str(settings.zoltag_flickr_connector_api_secret or "").strip()
    return api_key, api_secret


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
        if normalized and is_allowed_redirect_origin(normalized):
            return normalized
    raise HTTPException(status_code=400, detail="OAuth redirect origin is not permitted")


def _pending_oauth_secret_name(provider_id: str) -> str:
    compact_provider_id = "".join(
        ch for ch in str(provider_id or "").strip().lower() if ch.isalnum()
    )[:32]
    if not compact_provider_id:
        compact_provider_id = "unknown"
    return f"flickr-oauth-request-{compact_provider_id}"


@router.get("/oauth/flickr/authorize")
async def flickr_authorize(
    request: Request,
    tenant: str,
    flow: str = "popup",
    provider_id: str | None = None,
    redirect_origin: str | None = None,
    return_to: str | None = None,
    db: Session = Depends(get_db),
):
    """Redirect user to Flickr OAuth consent."""
    from requests_oauthlib import OAuth1Session

    flow = "redirect" if flow == "redirect" else "popup"
    resolved_return_to = sanitize_return_path(return_to)
    tenant_obj = _resolve_tenant(db, tenant)
    if not tenant_obj:
        raise HTTPException(status_code=400, detail="Tenant not found")

    repo = TenantIntegrationRepository(db)
    try:
        provider_record = repo.get_provider_record(tenant_obj, "flickr", provider_id=provider_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    api_key, api_secret = _resolve_flickr_credentials()
    if not api_key:
        raise HTTPException(status_code=400, detail="Flickr API key not configured")
    if not api_secret:
        raise HTTPException(status_code=400, detail="Flickr API secret not configured")

    resolved_origin = _resolve_redirect_origin(request, redirect_origin)
    state = oauth_state.generate_with_context(
        str(tenant_obj.id),
        {
            "flow": flow,
            "return_to": resolved_return_to,
            "redirect_origin": resolved_origin,
            "provider_id": provider_record.id,
            "pending_secret_name": _pending_oauth_secret_name(provider_record.id),
        },
    )
    callback_uri = append_query_params(
        f"{resolved_origin}/oauth/flickr/callback",
        {"state": state},
    )

    oauth = OAuth1Session(
        client_key=api_key,
        client_secret=api_secret,
        callback_uri=callback_uri,
    )
    try:
        request_token_payload = oauth.fetch_request_token(_FLICKR_REQUEST_TOKEN_URL)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to start Flickr OAuth: {exc}")

    oauth_token = str(request_token_payload.get("oauth_token") or "").strip()
    oauth_token_secret = str(request_token_payload.get("oauth_token_secret") or "").strip()
    if not oauth_token or not oauth_token_secret:
        raise HTTPException(status_code=400, detail="Flickr OAuth request token response was incomplete")

    pending_secret_name = _pending_oauth_secret_name(provider_record.id)
    store_secret(
        pending_secret_name,
        json.dumps(
            {
                "oauth_token": oauth_token,
                "oauth_token_secret": oauth_token_secret,
                "state": state,
            }
        ),
    )

    authorize_url = oauth.authorization_url(_FLICKR_AUTHORIZE_URL, perms="read")
    return RedirectResponse(authorize_url)


@router.get("/oauth/flickr/callback")
async def flickr_callback(
    request: Request,
    oauth_token: str,
    oauth_verifier: str,
    state: str,
    db: Session = Depends(get_db),
):
    """Handle Flickr OAuth callback and persist OAuth token pair."""
    from requests_oauthlib import OAuth1Session

    state_payload = oauth_state.consume_with_context(state)
    if not state_payload:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")

    tenant_id = state_payload["tenant_id"]
    state_context = state_payload.get("context", {}) or {}
    flow = str(state_context.get("flow") or "").strip().lower()
    provider_id = str(state_context.get("provider_id") or "").strip() or None

    tenant_obj = _resolve_tenant(db, tenant_id)
    if not tenant_obj:
        raise HTTPException(status_code=400, detail="Tenant not found")

    repo = TenantIntegrationRepository(db)
    try:
        provider_record = repo.get_provider_record(tenant_obj, "flickr", provider_id=provider_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    api_key, api_secret = _resolve_flickr_credentials()
    if not api_key:
        raise HTTPException(status_code=400, detail="Flickr API key not configured")
    if not api_secret:
        raise HTTPException(status_code=400, detail="Flickr API secret not configured")

    pending_secret_name = str(state_context.get("pending_secret_name") or "").strip()
    if not pending_secret_name:
        pending_secret_name = _pending_oauth_secret_name(provider_record.id)
    pending_payload_raw = str(get_secret(pending_secret_name) or "").strip()
    if not pending_payload_raw:
        raise HTTPException(status_code=400, detail="Flickr OAuth request token not found or expired")
    try:
        pending_payload = json.loads(pending_payload_raw)
    except Exception:
        pending_payload = None
    if not isinstance(pending_payload, dict):
        raise HTTPException(status_code=400, detail="Flickr OAuth request token payload is invalid")

    pending_oauth_token = str(pending_payload.get("oauth_token") or "").strip()
    pending_state = str(pending_payload.get("state") or "").strip()
    request_token_secret = str(pending_payload.get("oauth_token_secret") or "").strip()
    if not request_token_secret:
        raise HTTPException(status_code=400, detail="Flickr OAuth request token secret missing")
    if pending_state and pending_state != state:
        raise HTTPException(status_code=400, detail="Flickr OAuth state mismatch")
    if pending_oauth_token and pending_oauth_token != str(oauth_token or "").strip():
        raise HTTPException(status_code=400, detail="Flickr OAuth request token mismatch")

    oauth = OAuth1Session(
        client_key=api_key,
        client_secret=api_secret,
        resource_owner_key=str(oauth_token or "").strip(),
        resource_owner_secret=request_token_secret,
        verifier=str(oauth_verifier or "").strip(),
    )
    try:
        access_token_payload = oauth.fetch_access_token(_FLICKR_ACCESS_TOKEN_URL)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to complete Flickr OAuth: {exc}")

    user_oauth_token = str(access_token_payload.get("oauth_token") or "").strip()
    user_oauth_token_secret = str(access_token_payload.get("oauth_token_secret") or "").strip()
    user_nsid = str(access_token_payload.get("user_nsid") or "").strip()
    username = str(access_token_payload.get("username") or "").strip()
    fullname = str(access_token_payload.get("fullname") or "").strip()

    if not user_oauth_token or not user_oauth_token_secret:
        raise HTTPException(status_code=400, detail="Flickr OAuth did not return a valid token pair")

    token_payload = {
        "oauth_token": user_oauth_token,
        "oauth_token_secret": user_oauth_token_secret,
        "user_nsid": user_nsid,
        "username": username,
        "fullname": fullname,
    }
    store_secret(provider_record.flickr_token_secret_name, json.dumps(token_payload))
    try:
        delete_secret(pending_secret_name)
    except Exception:
        pass

    repo.update_provider(
        tenant_obj,
        "flickr",
        provider_id=provider_record.id,
        token_secret_name=provider_record.flickr_token_secret_name,
        config_json_patch={"token_stored": True},
    )
    db.commit()

    if flow == "redirect":
        return_to = sanitize_return_path(state_context.get("return_to"))
        redirect_target = append_query_params(
            return_to,
            {
                "integration": "flickr",
                "result": "connected",
                "provider_id": str(provider_record.id),
                "configure_step": "2",
            },
        )
        return RedirectResponse(redirect_target)

    return HTMLResponse(
        """
        <html>
            <body>
                <h1>Flickr Connected</h1>
                <p>You can close this window and return to Zoltag.</p>
                <script>window.close();</script>
            </body>
        </html>
        """
    )
