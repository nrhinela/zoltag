"""Router for Dropbox OAuth and webhook handlers."""

import json
import requests
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse, HTMLResponse
from sqlalchemy.orm import Session

from zoltag import oauth_state
from zoltag.dependencies import get_db, get_secret, store_secret
from zoltag.integrations import TenantIntegrationRepository
from zoltag.metadata import Tenant as TenantModel
from zoltag.settings import settings
from zoltag.dropbox import DropboxWebhookValidator
from zoltag.tenant_scope import tenant_reference_filter
from zoltag.dropbox_oauth import (
    append_query_params,
    load_dropbox_oauth_credentials,
    sanitize_redirect_origin,
    sanitize_return_path,
)

router = APIRouter(
    tags=["dropbox"]
)


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


@router.get("/oauth/dropbox/authorize")
async def dropbox_authorize(
    request: Request,
    tenant: str,
    flow: str = "popup",
    credential_mode: str = "auto",
    provider_id: str | None = None,
    redirect_origin: str | None = None,
    return_to: str | None = None,
    db: Session = Depends(get_db),
):
    """Redirect user to Dropbox OAuth."""
    flow = "redirect" if flow == "redirect" else "popup"
    credential_mode = str(credential_mode or "").strip().lower()
    resolved_return_to = sanitize_return_path(return_to)
    if credential_mode not in {"", "auto", "managed"}:
        raise HTTPException(status_code=400, detail="Only managed Dropbox OAuth mode is supported")
    selection_mode = "managed_only"

    tenant_obj = _resolve_tenant(db, tenant)
    if not tenant_obj:
        raise HTTPException(status_code=400, detail="Tenant not found")

    repo = TenantIntegrationRepository(db)
    try:
        provider_record = repo.get_provider_record(tenant_obj, "dropbox", provider_id=provider_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        credentials = load_dropbox_oauth_credentials(
            tenant_id=provider_record.secret_scope,
            tenant_app_key=str(provider_record.config_json.get("app_key") or "").strip(),
            tenant_app_secret_name=provider_record.dropbox_app_secret_name,
            get_secret=get_secret,
            selection_mode=selection_mode,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    app_key = credentials["app_key"]
    resolved_origin = _resolve_redirect_origin(request, redirect_origin)
    redirect_uri = f"{resolved_origin}/oauth/dropbox/callback"
    state_context = {
        "flow": flow,
        "return_to": resolved_return_to,
        "oauth_mode": "managed",
        "redirect_origin": resolved_origin,
        "provider_id": provider_record.id,
    }
    state = oauth_state.generate_with_context(str(tenant_obj.id), state_context)
    oauth_url = (
        f"https://www.dropbox.com/oauth2/authorize"
        f"?client_id={app_key}"
        f"&response_type=code"
        f"&token_access_type=offline"
        f"&redirect_uri={redirect_uri}"
        f"&state={state}"
    )

    return RedirectResponse(oauth_url)


@router.get("/oauth/dropbox/callback")
async def dropbox_callback(
    request: Request,
    code: str,
    state: str,
    db: Session = Depends(get_db),
):
    """Handle Dropbox OAuth callback."""
    state_payload = oauth_state.consume_with_context(state)
    if not state_payload:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")

    tenant_id = state_payload["tenant_id"]
    state_context = state_payload.get("context", {}) or {}
    flow = str(state_context.get("flow") or "").strip().lower()
    provider_id = str(state_context.get("provider_id") or "").strip() or None
    selection_mode = "managed_only"

    tenant_obj = _resolve_tenant(db, tenant_id)
    if not tenant_obj:
        raise HTTPException(status_code=400, detail="Tenant not found")

    repo = TenantIntegrationRepository(db)
    try:
        provider_record = repo.get_provider_record(tenant_obj, "dropbox", provider_id=provider_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        credentials = load_dropbox_oauth_credentials(
            tenant_id=provider_record.secret_scope,
            tenant_app_key=str(provider_record.config_json.get("app_key") or "").strip(),
            tenant_app_secret_name=provider_record.dropbox_app_secret_name,
            get_secret=get_secret,
            selection_mode=selection_mode,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    app_key = credentials["app_key"]
    app_secret = credentials["app_secret"]
    resolved_origin = _resolve_redirect_origin(request, state_context.get("redirect_origin"))
    redirect_uri = f"{resolved_origin}/oauth/dropbox/callback"

    response = requests.post(
        "https://api.dropboxapi.com/oauth2/token",
        data={
            "code": code,
            "grant_type": "authorization_code",
            "client_id": app_key,
            "client_secret": app_secret,
            "redirect_uri": redirect_uri,
        }
    )

    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to exchange code")

    tokens = response.json()
    refresh_token = str(tokens.get("refresh_token") or "").strip()
    if not refresh_token:
        raise HTTPException(status_code=400, detail="Dropbox OAuth did not return a refresh token")

    store_secret(provider_record.dropbox_token_secret_name, refresh_token)

    repo.update_provider(
        tenant_obj,
        "dropbox",
        provider_id=provider_record.id,
        oauth_mode="managed",
        token_secret_name=provider_record.dropbox_token_secret_name,
        config_json_patch={
            "app_secret_name": credentials.get("app_secret_name"),
        },
    )
    db.commit()

    if flow == "redirect":
        return_to = sanitize_return_path(state_context.get("return_to"))
        redirect_target = append_query_params(
            return_to,
            {
                "integration": "dropbox",
                "result": "connected",
            },
        )
        return RedirectResponse(redirect_target)

    return HTMLResponse("""
        <html>
            <body>
                <h1>✓ Dropbox Connected!</h1>
                <p>You can close this window and return to Zoltag.</p>
                <script>window.close();</script>
            </body>
        </html>
    """)


@router.post("/webhooks/dropbox")
async def dropbox_webhook(request: Request):
    """Handle Dropbox webhook notifications."""
    # Verify webhook challenge on setup
    if request.method == "GET":
        challenge = request.query_params.get("challenge")
        if challenge:
            return {"challenge": challenge}

    # Verify webhook signature
    signature = request.headers.get("X-Dropbox-Signature", "")
    body = await request.body()

    app_secret = get_secret("dropbox-app-secret")
    validator = DropboxWebhookValidator(app_secret)

    if not validator.validate_signature(body, signature):
        raise HTTPException(status_code=401, detail="Invalid signature")

    # Parse notification
    data = json.loads(body)

    # Queue sync jobs for affected tenants
    # TODO: Trigger async sync via Cloud Tasks
    print(f"Webhook received: {data}")

    return {"status": "ok"}
