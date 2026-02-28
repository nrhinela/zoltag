"""Signed OAuth state token helpers for CSRF protection.

State is encoded as a short-lived signed token so it survives:
- multiple API workers/processes
- hot reload restarts
- stateless deployments
"""

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt

from zoltag.settings import settings

_STATE_TTL = timedelta(minutes=10)
_STATE_AUDIENCE = "zoltag-oauth-state"
_STATE_ALGORITHM = "HS256"

logger = logging.getLogger(__name__)

# Resolved once at import time. If OAUTH_STATE_SECRET is not configured we
# generate a random secret for this process. This is safe: state tokens are
# short-lived (10 min TTL) so the only consequence of a process restart is
# that any in-flight OAuth flow needs to be restarted by the user.
def _resolve_state_secret() -> str:
    explicit = str(settings.oauth_state_secret or "").strip()
    if explicit:
        return explicit
    generated = secrets.token_hex(32)
    logger.warning(
        "OAUTH_STATE_SECRET is not configured. A random secret has been generated "
        "for this process. Set OAUTH_STATE_SECRET in your environment to a stable "
        "random value to avoid breaking OAuth flows on restart."
    )
    return generated

_SIGNING_SECRET: str = _resolve_state_secret()


def _state_signing_secret() -> str:
    return _SIGNING_SECRET


def generate_with_context(tenant_id: str, context: dict[str, Any] | None = None) -> str:
    """Generate signed OAuth state bound to tenant_id + optional context."""
    now = datetime.now(timezone.utc)
    expires_at = now + _STATE_TTL
    payload: dict[str, Any] = {
        "tenant_id": tenant_id,
        "context": context or {},
        "nonce": secrets.token_urlsafe(16),
        "aud": _STATE_AUDIENCE,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    return jwt.encode(payload, _state_signing_secret(), algorithm=_STATE_ALGORITHM)


def consume_with_context(nonce: str) -> dict[str, Any] | None:
    """Validate signed state token. Returns payload on success, None on failure."""
    payload = None
    try:
        payload = jwt.decode(
            nonce,
            _state_signing_secret(),
            algorithms=[_STATE_ALGORITHM],
            audience=_STATE_AUDIENCE,
            options={
                "verify_signature": True,
                "verify_aud": True,
                "verify_exp": True,
            },
        )
    except JWTError:
        pass
    if payload is None:
        return None

    tenant_id = str(payload.get("tenant_id") or "").strip()
    if not tenant_id:
        return None
    context = payload.get("context") or {}
    if not isinstance(context, dict):
        context = {}
    return {
        "tenant_id": tenant_id,
        "context": context,
    }


def generate(tenant_id: str) -> str:
    """Generate a one-time nonce bound to tenant_id. Returns the nonce."""
    return generate_with_context(tenant_id, {})


def consume(nonce: str) -> str | None:
    """Validate and consume a nonce. Returns tenant_id on success, None on failure."""
    payload = consume_with_context(nonce)
    if not payload:
        return None
    return payload["tenant_id"]
