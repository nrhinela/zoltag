"""Supabase Authentication module for Zoltag.

This module handles:
- JWT verification via Supabase JWKS endpoint
- User profile and tenant membership management
- Role-based access control
- Invitation system for onboarding
"""

from zoltag.auth.config import get_auth_settings
from zoltag.auth.jwt import verify_supabase_jwt, get_supabase_uid_from_token
from zoltag.auth.models import UserProfile, UserTenant, Invitation

__all__ = [
    "get_auth_settings",
    "verify_supabase_jwt",
    "get_supabase_uid_from_token",
    "UserProfile",
    "UserTenant",
    "Invitation",
]
