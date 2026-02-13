"""Supabase Auth configuration."""

from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parents[3]
ENV_FILE = BASE_DIR / ".env"


class AuthSettings(BaseSettings):
    """Supabase Auth settings from environment variables."""

    supabase_url: str
    """Supabase project URL (e.g., https://xxx.supabase.co)"""

    supabase_anon_key: str
    """Supabase public (anonymous) API key - used by frontend"""

    supabase_service_role_key: str
    """Supabase service role key - server-only, bypasses RLS"""

    jwt_algorithm: str = "ES256"
    """JWT algorithm used by Supabase (always ES256)"""

    jwt_audience: str = "authenticated"
    """JWT audience claim expected by Supabase"""

    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore"
    )

    @property
    def jwks_url(self) -> str:
        """JWKS endpoint URL for fetching public keys."""
        return f"{self.supabase_url}/auth/v1/.well-known/jwks.json"


@lru_cache(maxsize=1)
def get_auth_settings() -> AuthSettings:
    """Get cached auth settings.

    Settings are loaded from environment variables with SUPABASE_ prefix:
    - SUPABASE_URL: Supabase project URL
    - SUPABASE_ANON_KEY: Public API key
    - SUPABASE_SERVICE_ROLE_KEY: Server-only service role key

    Returns:
        AuthSettings: Cached settings instance

    Raises:
        ValidationError: If required environment variables are missing
    """
    # Pydantic Settings loads from env vars and .env file
    # The .env file is loaded by the main app (usually in FastAPI startup)
    # Here we rely on env vars being set (either from .env or system)
    return AuthSettings()
