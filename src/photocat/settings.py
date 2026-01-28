"""Application settings and environment configuration."""

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
    app_name: str = "PhotoCat"
    debug: bool = False
    worker_mode: bool = False
    environment: str = "dev"  # 'dev' or 'prod'
    
    # Database
    database_url: str = "postgresql://localhost/photocat"
    db_pool_size: int = 10
    db_max_overflow: int = 20
    
    # Google Cloud
    gcp_project_id: str = "photocat-483622"
    gcp_region: str = "us-central1"
    
    # Cloud Storage
    storage_bucket_name: str = "photocat-483622-images"
    thumbnail_bucket_name: Optional[str] = None
    thumbnail_cdn_base_url: str = ""
    
    # Secret Manager
    secret_manager_prefix: str = "photocat"
    dropbox_app_key_secret: str = "dropbox-app-key"
    dropbox_app_secret_secret: str = "dropbox-app-secret"
    
    # Cloud Tasks
    task_queue_name: str = "image-processing"
    task_location: str = "us-central1"
    
    # Processing
    thumbnail_size: int = 256
    batch_size: int = 10
    max_workers: int = 4
    
    # Models
    face_detection_model: str = "hog"  # 'hog' or 'cnn'
    embedding_model: str = "clip-vit-base-patch32"
    tagging_model: str = "siglip"  # Currently only 'siglip' is active (clip and siglip2 are commented out)
    use_keyword_models: bool = False
    keyword_model_weight: float = 0.6
    keyword_model_threshold: float = 0.5
    keyword_model_min_positive: int = 2
    keyword_model_min_negative: int = 2
    
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


settings = Settings()
