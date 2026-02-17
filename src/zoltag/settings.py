"""Application settings and environment configuration."""

import os
from typing import Optional
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parents[2]
ENV_FILE = BASE_DIR / ".env"


class Settings(BaseSettings):
    """Application settings loaded from environment."""

    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore"
    )

    # Application
    app_name: str = "Zoltag"
    debug: bool = False
    worker_mode: bool = False
    environment: str = "dev"  # 'dev' or 'prod'
    
    # Database
    database_url: str = "postgresql://localhost/zoltag"
    db_pool_size: int = 10
    db_max_overflow: int = 20
    db_pool_timeout: int = 30
    db_pool_recycle: int = 1800
    db_pool_pre_ping: bool = True
    db_connect_timeout: int = 10
    
    # Google Cloud
    gcp_project_id: str = "photocat-483622"
    gcp_region: str = "us-central1"
    
    # Cloud Storage
    storage_bucket_name: str = "photocat-483622-images"
    thumbnail_bucket_name: Optional[str] = None
    thumbnail_cdn_base_url: str = ""
    
    # Secret Manager
    secret_manager_prefix: str = "zoltag"
    dropbox_app_key_secret: str = "dropbox-app-key"
    dropbox_app_secret_secret: str = "dropbox-app-secret"
    
    # Cloud Tasks
    task_queue_name: str = "image-processing"
    task_location: str = "us-central1"
    
    # Processing
    thumbnail_size: int = 256
    batch_size: int = 10
    max_workers: int = 4
    asset_strict_reads: bool = False
    asset_write_legacy_fields: bool = False
    
    # Models
    # Primary active model selector for zero-shot tagging and embedding generation.
    # Current supported active value in code paths is 'siglip'.
    tagging_model: str = "siglip"
    # Minimum confidence required to persist zero-shot tags.
    # Higher values reduce recall; lower values increase tag volume.
    zeroshot_tag_threshold: float = 0.25
    # Minimum confidence required to persist trained-model tags.
    trained_tag_threshold: float = 0.25
    # Minimum positive permatag examples required before training a keyword model.
    keyword_model_min_positive: int = 2
    # If true, generate embeddings during upload/ingest. If false, embeddings are generated later by batch jobs.
    upload_generate_embeddings: bool = True
    
    # API
    api_host: str = "0.0.0.0"
    api_port: int = 8080
    api_workers: int = 4
    
    # Application URL (for OAuth redirects)
    app_url: str = "http://localhost:8080"  # Update for production

    # Supabase Authentication
    supabase_url: Optional[str] = None
    supabase_anon_key: Optional[str] = None
    supabase_service_role_key: Optional[str] = None
    oauth_state_secret: Optional[str] = None

    # Gemini API (Natural language search)
    gemini_api_key: Optional[str] = None
    gemini_model: str = "gemini-2.5-flash"
    gemini_api_mode: str = "generativelanguage"  # "generativelanguage" or "vertex"

    @property
    def thumbnail_bucket(self) -> str:
        """Get thumbnail bucket name (defaults to main bucket)."""
        return self.thumbnail_bucket_name or self.storage_bucket_name

    @property
    def is_production(self) -> bool:
        """Check if running in production environment."""
        return self.environment.lower() == "prod"

    @property
    def is_development(self) -> bool:
        """Check if running in development environment."""
        return self.environment.lower() == "dev"

    def model_config_audit(self) -> dict:
        """Return startup model-config audit metadata for logging."""
        deprecated_env_vars = [
            "FACE_DETECTION_MODEL",
            "EMBEDDING_MODEL",
            "USE_KEYWORD_MODELS",
            "KEYWORD_MODEL_WEIGHT",
            "KEYWORD_MODEL_THRESHOLD",
            "KEYWORD_MODEL_MIN_NEGATIVE",
        ]
        present_deprecated = [key for key in deprecated_env_vars if os.getenv(key) is not None]
        return {
            "tagging_model": self.tagging_model,
            "zeroshot_tag_threshold": self.zeroshot_tag_threshold,
            "trained_tag_threshold": self.trained_tag_threshold,
            "keyword_model_min_positive": self.keyword_model_min_positive,
            "upload_generate_embeddings": self.upload_generate_embeddings,
            "deprecated_env_vars_present": present_deprecated,
        }


settings = Settings()
