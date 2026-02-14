"""Router for Dropbox OAuth and webhook handlers."""

import json
import requests
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse, HTMLResponse
from sqlalchemy.orm import Session

from photocat import oauth_state
from photocat.dependencies import get_db, get_secret, store_secret
from photocat.metadata import Tenant as TenantModel
from photocat.settings import settings
from photocat.dropbox import DropboxWebhookValidator
from photocat.tenant_scope import tenant_reference_filter

router = APIRouter(
    tags=["dropbox"]
)


def _resolve_tenant(db: Session, tenant_ref: str):
    return db.query(TenantModel).filter(tenant_reference_filter(TenantModel, tenant_ref)).first()


@router.get("/oauth/dropbox/authorize")
async def dropbox_authorize(tenant: str, db: Session = Depends(get_db)):
    """Redirect user to Dropbox OAuth."""
    # Get tenant's app key from database
    tenant_obj = _resolve_tenant(db, tenant)
    if not tenant_obj or not tenant_obj.dropbox_app_key:
        raise HTTPException(status_code=400, detail="Tenant not found or app key not configured")

    app_key = tenant_obj.dropbox_app_key
    redirect_uri = f"{settings.app_url}/oauth/dropbox/callback"

    # Persist canonical tenant ID so callback resolution is stable.
    state = oauth_state.generate(tenant_obj.id)
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
async def dropbox_callback(code: str, state: str, db: Session = Depends(get_db)):
    """Handle Dropbox OAuth callback."""
    tenant_ref = oauth_state.consume(state)
    if not tenant_ref:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")

    # Get tenant's app key from database
    tenant_obj = _resolve_tenant(db, tenant_ref)
    if not tenant_obj or not tenant_obj.dropbox_app_key:
        raise HTTPException(status_code=400, detail="Tenant not found or app key not configured")

    # Exchange code for tokens
    key_prefix = (getattr(tenant_obj, "key_prefix", None) or tenant_obj.id).strip()
    app_key = tenant_obj.dropbox_app_key
    app_secret = get_secret(f"dropbox-app-secret-{key_prefix}")
    redirect_uri = f"{settings.app_url}/oauth/dropbox/callback"

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

    # Store refresh token in Secret Manager
    store_secret(f"dropbox-token-{key_prefix}", tokens['refresh_token'])

    return HTMLResponse("""
        <html>
            <body>
                <h1>✓ Dropbox Connected!</h1>
                <p>You can close this window and return to PhotoCat.</p>
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
