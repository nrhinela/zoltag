"""Router for Google Drive OAuth handlers."""

from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from zoltag import oauth_state
from zoltag.dependencies import get_db, get_secret, store_secret
from zoltag.metadata import Tenant as TenantModel
from zoltag.settings import settings

router = APIRouter(
    tags=["gdrive"],
)


@router.get("/oauth/gdrive/authorize")
async def gdrive_authorize(tenant: str, db: Session = Depends(get_db)):
    """Redirect user to Google OAuth consent for Drive access."""
    tenant_obj = db.query(TenantModel).filter(TenantModel.id == tenant).first()
    if not tenant_obj:
        raise HTTPException(status_code=400, detail="Tenant not found")

    tenant_settings = tenant_obj.settings or {}
    client_id = tenant_settings.get("gdrive_client_id")
    if not client_id:
        raise HTTPException(status_code=400, detail="Google Drive client ID not configured")

    redirect_uri = f"{settings.app_url}/oauth/gdrive/callback"
    state = oauth_state.generate(tenant)
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "https://www.googleapis.com/auth/drive.readonly",
        "access_type": "offline",
        "include_granted_scopes": "true",
        "prompt": "consent",
        "state": state,
    }
    oauth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"
    return RedirectResponse(oauth_url)


@router.get("/oauth/gdrive/callback")
async def gdrive_callback(code: str, state: str, db: Session = Depends(get_db)):
    """Handle Google OAuth callback and persist refresh token."""
    tenant_id = oauth_state.consume(state)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")

    tenant_obj = db.query(TenantModel).filter(TenantModel.id == tenant_id).first()
    if not tenant_obj:
        raise HTTPException(status_code=400, detail="Tenant not found")

    tenant_settings = tenant_obj.settings or {}
    client_id = tenant_settings.get("gdrive_client_id")
    client_secret_secret = tenant_settings.get("gdrive_client_secret") or f"gdrive-client-secret-{tenant_id}"
    token_secret = tenant_settings.get("gdrive_token_secret") or f"gdrive-token-{tenant_id}"

    if not client_id:
        raise HTTPException(status_code=400, detail="Google Drive client ID not configured")

    try:
        client_secret = get_secret(client_secret_secret)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Google Drive client secret missing: {exc}")

    redirect_uri = f"{settings.app_url}/oauth/gdrive/callback"

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

    return HTMLResponse(
        """
        <html>
            <body>
                <h1>Google Drive Connected</h1>
                <p>You can close this window and return to Zoltag.</p>
                <script>window.close();</script>
            </body>
        </html>
        """
    )
