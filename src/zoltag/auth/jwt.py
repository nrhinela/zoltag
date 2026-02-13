"""JWT token verification using Supabase JWKS endpoint."""

import asyncio
import httpx
from typing import Dict, Any
from datetime import datetime, timedelta
from jose import jwt, JWTError

from zoltag.auth.config import get_auth_settings


# Cache JWKS for performance - keys are refreshed every 24h (Supabase keys rarely rotate)
_jwks_cache: Dict[str, Any] = {}
_jwks_cache_time: datetime = datetime.min
_jwks_inflight: Any = None  # shared asyncio.Task to deduplicate concurrent fetches
_JWKS_TTL = timedelta(hours=24)


def _fetch_jwks_sync() -> Dict:
    """Synchronous JWKS fetch - only called via run_in_executor to avoid blocking."""
    settings = get_auth_settings()
    try:
        response = httpx.get(settings.jwks_url, timeout=10.0)
        response.raise_for_status()
        return response.json()
    except httpx.HTTPError as e:
        raise JWTError(f"Failed to fetch JWKS from {settings.jwks_url}: {str(e)}")


async def get_jwks() -> Dict:
    """Fetch and cache JWKS from Supabase. Concurrent callers share a single fetch."""
    global _jwks_cache, _jwks_cache_time, _jwks_inflight

    if _jwks_cache and datetime.utcnow() - _jwks_cache_time < _JWKS_TTL:
        return _jwks_cache

    # If a fetch is already in flight, wait for it rather than launching another
    if _jwks_inflight is not None:
        return await _jwks_inflight

    loop = asyncio.get_event_loop()
    _jwks_inflight = asyncio.ensure_future(
        loop.run_in_executor(None, _fetch_jwks_sync)
    )
    try:
        _jwks_cache = await _jwks_inflight
        _jwks_cache_time = datetime.utcnow()
        return _jwks_cache
    finally:
        _jwks_inflight = None


async def verify_supabase_jwt(token: str) -> Dict[str, Any]:
    """Verify Supabase JWT token using JWKS endpoint.

    Verification checks:
    - JWT signature is valid (using public keys from JWKS)
    - Token is not expired (exp claim)
    - Token audience is 'authenticated' (aud claim)

    The Supabase JWT structure includes:
    - sub: Supabase UID (UUID from auth.users.id)
    - aud: Audience (always 'authenticated')
    - exp: Expiration time
    - iat: Issued at time
    - email: User's email address
    - email_confirmed_at: Email verification timestamp (optional)

    Args:
        token: JWT access token from Supabase Auth

    Returns:
        dict: Decoded token claims, including 'sub' (supabase_uid)

    Raises:
        JWTError: If token is invalid, expired, or verification fails
    """
    settings = get_auth_settings()

    try:
        # Fetch JWKS (cached)
        jwks = await get_jwks()

        # Decode and verify JWT
        # The python-jose library automatically selects the correct key from JWKS
        # based on the 'kid' (key ID) header in the JWT
        decoded = jwt.decode(
            token,
            jwks,
            algorithms=[settings.jwt_algorithm],
            audience=settings.jwt_audience,
            options={
                "verify_signature": True,  # Cryptographic signature verification
                "verify_exp": True,  # Ensure token hasn't expired
                "verify_aud": True,  # Ensure audience matches expected
            }
        )
        return decoded

    except JWTError as e:
        raise JWTError(f"JWT verification failed: {str(e)}")


async def get_supabase_uid_from_token(token: str) -> str:
    """Extract Supabase UID from JWT token.

    The 'sub' (subject) claim in Supabase JWT tokens contains the user's UUID
    (auth.users.id). This function extracts and returns it after verifying
    the token signature.

    Args:
        token: JWT access token from Supabase Auth

    Returns:
        str: Supabase UID (UUID) from the 'sub' claim

    Raises:
        JWTError: If token is invalid or verification fails
    """
    decoded = await verify_supabase_jwt(token)
    return decoded["sub"]  # 'sub' claim contains the UUID


def clear_jwks_cache() -> None:
    """Clear the JWKS cache.

    Useful for testing or forcing a refresh of public keys.
    """
    global _jwks_cache, _jwks_cache_time
    _jwks_cache = {}
    _jwks_cache_time = datetime.min
