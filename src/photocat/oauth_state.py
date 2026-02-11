"""In-memory OAuth state store for CSRF protection.

Each authorize call generates a cryptographic nonce bound to a tenant ID.
The callback validates the nonce and retrieves the tenant ID, preventing
an attacker from forging the `state` parameter to redirect tokens to a
wrong tenant.

TTL is 10 minutes — enough for any real user flow. Entries are cleaned up
lazily on each generate/consume call.

Note: In-memory store is appropriate for single-instance Cloud Run.
If multiple instances are ever deployed, replace with a shared store
(e.g., Redis or a short-lived DB table).
"""

import secrets
import threading
from datetime import datetime, timedelta, timezone

_STATE_TTL = timedelta(minutes=10)
_store: dict[str, tuple[str, datetime]] = {}  # nonce -> (tenant_id, expires_at)
_lock = threading.Lock()


def _evict_expired() -> None:
    now = datetime.now(timezone.utc)
    expired = [k for k, (_, exp) in _store.items() if exp <= now]
    for k in expired:
        del _store[k]


def generate(tenant_id: str) -> str:
    """Generate a one-time nonce bound to tenant_id. Returns the nonce."""
    nonce = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + _STATE_TTL
    with _lock:
        _evict_expired()
        _store[nonce] = (tenant_id, expires_at)
    return nonce


def consume(nonce: str) -> str | None:
    """Validate and consume a nonce. Returns tenant_id on success, None on failure."""
    with _lock:
        _evict_expired()
        entry = _store.pop(nonce, None)
    if entry is None:
        return None
    tenant_id, expires_at = entry
    if datetime.now(timezone.utc) > expires_at:
        return None
    return tenant_id
