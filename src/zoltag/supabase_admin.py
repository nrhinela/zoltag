"""Lazy Supabase admin client (service-role key, server-side only)."""

from __future__ import annotations

from typing import Optional
import httpx

from zoltag.settings import settings


def _base_url() -> str:
    url = (settings.supabase_url or "").rstrip("/")
    return url


def _headers() -> dict:
    return {
        "apikey": settings.supabase_service_role_key or "",
        "Authorization": f"Bearer {settings.supabase_service_role_key or ''}",
        "Content-Type": "application/json",
    }


async def create_guest_user(email: str, tenant_id: str) -> dict:
    """Create a guest user in Supabase (or update if exists).

    For new users, sets app_metadata.role = 'guest'.
    For existing users, returns the existing user unchanged.
    Returns user data dict with 'id' field.
    """
    import logging
    logger = logging.getLogger(__name__)

    # Create user with admin API
    url = f"{_base_url()}/auth/v1/admin/users"
    payload = {
        "email": email,
        "email_confirm": True,  # Auto-confirm - they'll use magic link to sign in
        "app_metadata": {
            "role": "guest",
        },
    }

    logger.info(f"Creating guest user {email} for tenant {tenant_id}")

    async with httpx.AsyncClient() as client:
        resp = await client.post(url, json=payload, headers=_headers())

    if resp.status_code == 422:
        # User already exists - do not mutate existing metadata/role.
        logger.info(f"Guest user {email} already exists, returning existing user")
        user_data = await _get_user_by_email(email)
        return user_data

    if resp.status_code not in (200, 201):
        logger.error(f"Failed to create guest user: {resp.text}")
        resp.raise_for_status()

    response_data = resp.json()
    logger.info(f"Guest user created: {response_data.get('id')}")
    return response_data


async def invite_user_by_email(email: str, redirect_to: str, tenant_id: str) -> dict:
    """Invite a guest user via Supabase Admin API.

    Creates the user if they don't exist, sends a magic-link invite email.
    Existing users are returned unchanged (no role mutation).
    Returns dict with user data and invite_link.
    """
    import logging
    logger = logging.getLogger(__name__)

    # First create the user with admin API
    url = f"{_base_url()}/auth/v1/admin/users"
    payload = {
        "email": email,
        "email_confirm": False,  # Don't auto-confirm so invite email is sent
        "app_metadata": {
            "role": "guest",
        },
    }

    logger.info(f"Creating user {email} for tenant {tenant_id}, URL: {url}")

    async with httpx.AsyncClient() as client:
        resp = await client.post(url, json=payload, headers=_headers())

    logger.info(f"Supabase create user response status: {resp.status_code}")
    logger.info(f"Supabase create user response body: {resp.text}")

    if resp.status_code == 422:
        # User already exists — look up user without mutating metadata.
        logger.info(f"User {email} already exists, resending invite")
        user_data = await _get_user_by_email(email)
        # Send invite email to existing user
        invite_link = await _send_invite_email(email, redirect_to)
        user_data['invite_link'] = invite_link
        return user_data

    if resp.status_code != 200 and resp.status_code != 201:
        logger.error(f"Supabase create user error: {resp.text}")
        resp.raise_for_status()

    response_data = resp.json()
    user_id = response_data.get('id')
    logger.info(f"Supabase user created with ID: {user_id}")

    # Now send the invite email using admin/users/{id}/invite
    invite_link = await _send_invite_email_by_id(user_id, redirect_to)

    # Add invite link to response
    response_data['invite_link'] = invite_link
    return response_data


async def _send_invite_email_by_id(user_id: str, redirect_to: str) -> str:
    """Send invite email to a user by their ID using generate_link API.

    Returns the action_link for manual sharing if needed.
    """
    import logging
    logger = logging.getLogger(__name__)

    # Use generate_link with type=invite to get the magic link AND send email
    url = f"{_base_url()}/auth/v1/admin/generate_link"
    payload = {
        "type": "invite",
        "email": "", # Will be populated from user_id lookup
        "redirect_to": redirect_to,
    }

    # First, get the user's email from their ID
    user_url = f"{_base_url()}/auth/v1/admin/users/{user_id}"
    async with httpx.AsyncClient() as client:
        user_resp = await client.get(user_url, headers=_headers())

    if user_resp.status_code != 200:
        logger.error(f"Failed to fetch user {user_id}: {user_resp.text}")
        return

    user_data = user_resp.json()
    user_email = user_data.get("email")
    if not user_email:
        logger.error(f"User {user_id} has no email address")
        return

    payload["email"] = user_email

    logger.warning(f"🚀 ABOUT TO CALL SUPABASE generate_link:")
    logger.warning(f"   Email: {user_email}")
    logger.warning(f"   redirect_to param: {redirect_to}")
    logger.warning(f"   Full payload: {payload}")

    async with httpx.AsyncClient() as client:
        resp = await client.post(url, json=payload, headers=_headers())

    logger.info(f"Generate link response status: {resp.status_code}")
    logger.info(f"Generate link response: {resp.text}")

    if resp.status_code not in (200, 201):
        logger.error(f"Failed to generate invite link: {resp.text}")
        return None

    response_data = resp.json()
    action_link = response_data.get("action_link")

    if action_link:
        logger.warning(f"⚠️  INVITE LINK FOR {user_email}:")
        logger.warning(f"⚠️  {action_link}")
        logger.warning(f"⚠️  (Email sending not yet implemented - use this link to test)")
    else:
        logger.error(f"No action_link in response: {response_data}")

    logger.info(f"Invite link generated successfully for {user_email}")
    return action_link


async def _send_invite_email(email: str, redirect_to: str) -> str:
    """Send invite email to a user by email using generate_link API.

    Returns the action_link for manual sharing if needed.
    """
    import logging
    logger = logging.getLogger(__name__)

    # Use generate_link with type=invite to send the email
    url = f"{_base_url()}/auth/v1/admin/generate_link"
    payload = {
        "type": "invite",
        "email": email,
        "redirect_to": redirect_to,
    }

    logger.info(f"Generating invite link for existing user {email}, redirect: {redirect_to}")

    async with httpx.AsyncClient() as client:
        resp = await client.post(url, json=payload, headers=_headers())

    logger.info(f"Generate link response status: {resp.status_code}")
    logger.info(f"Generate link response: {resp.text}")

    if resp.status_code not in (200, 201):
        logger.error(f"Failed to generate invite link: {resp.text}")
        return None

    response_data = resp.json()
    action_link = response_data.get("action_link")

    if action_link:
        logger.warning(f"⚠️  INVITE LINK FOR {email}:")
        logger.warning(f"⚠️  {action_link}")
        logger.warning(f"⚠️  (Email sending not yet implemented - use this link to test)")
    else:
        logger.error(f"No action_link in response: {response_data}")

    logger.info(f"Invite link generated successfully for {email}")
    return action_link


async def _get_user_by_email(email: str) -> dict:
    """Fetch an existing Supabase user by email."""
    # List users filtered by email
    url = f"{_base_url()}/auth/v1/admin/users"
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, params={"email": email}, headers=_headers())
    resp.raise_for_status()
    data = resp.json()
    users = data.get("users") or []
    if not users:
        raise ValueError(f"Could not find Supabase user for email {email!r}")
    return users[0]


async def _upsert_guest_metadata(email: str, tenant_id: str) -> dict:
    """Backward-compatible alias: no-op metadata upsert, returns existing user."""
    return await _get_user_by_email(email)


async def generate_magic_link(email: str, redirect_to: str) -> Optional[dict]:
    """Send a magic-link + OTP email to an existing guest.

    Returns dict with 'action_link' and 'hashed_token' if successful, None otherwise.
    The hashed_token can be used as the OTP code for verification.
    """
    import logging
    logger = logging.getLogger(__name__)

    url = f"{_base_url()}/auth/v1/admin/generate_link"
    payload = {
        "type": "magiclink",
        "email": email,
        "redirect_to": redirect_to,
    }

    logger.warning(f"🔗 Generating magic link for {email}")
    logger.warning(f"🔗 redirect_to parameter: {redirect_to}")
    logger.warning(f"🔗 Full payload: {payload}")

    async with httpx.AsyncClient() as client:
        resp = await client.post(url, json=payload, headers=_headers())

    if resp.status_code not in (200, 201):
        logger.warning(f"Failed to generate magic link for {email}: {resp.status_code} {resp.text}")
        return None

    response_data = resp.json()
    logger.warning(f"🔗 Supabase response: {response_data}")
    logger.warning(f"🔗 action_link: {response_data.get('action_link')}")

    # Return the link and OTP data
    # Note: Supabase generates a 6-digit OTP code, but we'll use the URL token for now
    # since we're sending our own emails
    return response_data
