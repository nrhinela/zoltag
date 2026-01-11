"""Application settings and environment configuration."""

from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False
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
    
    # API
    api_host: str = "0.0.0.0"
    api_port: int = 8080
    api_workers: int = 4
    
    # Application URL (for OAuth redirects)
    app_url: str = "http://localhost:8080"  # Update for production
    
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
