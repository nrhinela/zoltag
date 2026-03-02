"""Internal sentinel endpoints for queue maintenance + worker dispatch."""

from __future__ import annotations

import hmac
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException

from zoltag.sentinel import run_sentinel_tick
from zoltag.settings import settings

router = APIRouter(prefix="/api/v1/internal/sentinel", tags=["internal-sentinel"])


def _extract_bearer_token(authorization: Optional[str]) -> str:
    raw = str(authorization or "").strip()
    if not raw.lower().startswith("bearer "):
        return ""
    return raw[7:].strip()


def require_sentinel_token(
    x_sentinel_token: Optional[str] = Header(default=None, alias="X-Sentinel-Token"),
    authorization: Optional[str] = Header(default=None),
):
    expected = str(settings.sentinel_auth_token or "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="Sentinel auth token is not configured")

    candidate = str(x_sentinel_token or "").strip() or _extract_bearer_token(authorization)
    if not candidate or not hmac.compare_digest(candidate, expected):
        raise HTTPException(status_code=401, detail="Invalid sentinel token")


@router.post("/tick")
async def sentinel_tick(
    body: dict | None = None,
    _token_ok: None = Depends(require_sentinel_token),
):
    payload = body or {}
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="payload must be an object")
    dry_run = bool(payload.get("dry_run"))
    return run_sentinel_tick(dry_run=dry_run)
