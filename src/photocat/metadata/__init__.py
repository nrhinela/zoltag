"""Metadata storage and management."""

from datetime import datetime
import uuid
from typing import Optional

from sqlalchemy import Column, String, Integer, Float, DateTime, Boolean, Text, ForeignKey, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, ARRAY, UUID
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.types import JSON

@compiles(JSONB, "sqlite")
def compile_jsonb_for_sqlite(element, compiler, **kw):
    return compiler.visit_JSON(element, **kw)

@compiles(ARRAY, "sqlite")
def compile_array_for_sqlite(element, compiler, **kw):
    return compiler.visit_JSON(element, **kw)


Base = declarative_base()


class Tenant(Base):
    """Tenant configuration and settings."""
    
    __tablename__ = "tenants"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)  # Internal tenant key
    identifier = Column(
        String(255),
        nullable=False,
        unique=True,
        default=lambda ctx: str(ctx.get_current_parameters().get("id") or ""),
    )  # Editable human-facing tenant label
    key_prefix = Column(
        String(255),
        nullable=False,
        unique=True,
        default=lambda ctx: str(ctx.get_current_parameters().get("id") or ""),
    )  # Immutable secret/object-key prefix
    name = Column(String(255), nullable=False)  # Display name
    active = Column(Boolean, default=True, nullable=False, index=True)
    
    # Dropbox integration
    dropbox_app_key = Column(String(255))
    # Secret Manager paths constructed from tenants.key_prefix:
    # - dropbox-app-secret-{key_prefix}
    # - dropbox-token-{key_prefix}

    # Storage buckets
    storage_bucket = Column(String(255), nullable=True)  # GCS bucket for full-size images
    thumbnail_bucket = Column(String(255), nullable=True)  # GCS bucket for thumbnails

    # Flexible settings (JSON)
    settings = Column(JSONB, default=dict)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    people = relationship("Person", back_populates="tenant", cascade="all, delete-orphan")


class Person(Base):
    """Known people for tagging and facial recognition."""

    __tablename__ = "people"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)

    # Core attributes
    name = Column(String(255), nullable=False, index=True)
    instagram_url = Column(String(512), nullable=True)

    # Legacy face recognition (kept for backward compatibility)
    aliases = Column(JSONB, default=list)  # List of alternative names
    face_embedding_ref = Column(String(255))  # Cloud Storage reference to face encodings

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    tenant = relationship("Tenant", back_populates="people")
    detected_faces = relationship("DetectedFace", back_populates="person")




class ImageMetadata(Base):
    """Image metadata and processing state."""
    
    __tablename__ = "image_metadata"
    
    id = Column(Integer, primary_key=True)
    asset_id = Column(UUID(as_uuid=True), ForeignKey("assets.id", ondelete="SET NULL"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    
    # File information
    filename = Column(String(512), nullable=False)
    file_size = Column(Integer)
    content_hash = Column(String(64), index=True)  # For change detection
    modified_time = Column(DateTime)
    
    # Image properties
    width = Column(Integer)
    height = Column(Integer)
    format = Column(String(50))
    
    # Visual features
    perceptual_hash = Column(String(64), index=True)  # For deduplication
    color_histogram = Column(ARRAY(Float))
    
    # EXIF data
    exif_data = Column(JSONB)  # Stored as JSON for flexibility
    camera_make = Column(String(255))
    camera_model = Column(String(255))
    lens_model = Column(String(255))
    iso = Column(Integer)
    aperture = Column(Float)
    shutter_speed = Column(String(50))
    focal_length = Column(Float)
    capture_timestamp = Column(DateTime, index=True)
    gps_latitude = Column(Float)
    gps_longitude = Column(Float)

    # Dropbox custom properties
    dropbox_properties = Column(JSONB)  # Dropbox file properties and tags
    
    # Processing state
    last_processed = Column(DateTime, default=datetime.utcnow)
    processing_version = Column(String(50))  # Model version for reprocessing
    embedding_generated = Column(Boolean, default=False)
    faces_detected = Column(Boolean, default=False)
    tags_applied = Column(Boolean, default=False)

    # User rating (0-3, optional)
    rating = Column(Integer, nullable=True)
    
    # Relationships
    faces = relationship("DetectedFace", back_populates="image", cascade="all, delete-orphan")
    
    # Indexes for common queries
    __table_args__ = (
        Index("idx_tenant_modified", "tenant_id", "modified_time"),
        Index("idx_tenant_capture", "tenant_id", "capture_timestamp"),
        Index("idx_tenant_location", "tenant_id", "gps_latitude", "gps_longitude"),
        Index("idx_image_metadata_tenant_rating", "tenant_id", "rating"),
        Index("uq_image_metadata_asset_id", "asset_id", unique=True),
    )


class Permatag(Base):
    """Permanent human-verified tags with positive/negative polarity."""

    __tablename__ = "permatags"

    id = Column(Integer, primary_key=True)
    asset_id = Column(UUID(as_uuid=True), ForeignKey("assets.id", ondelete="SET NULL"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    # Note: keyword_id FK not declared here (keywords table is in different declarative base)
    # Database enforces FK constraint; use db.query(Keyword).filter(Keyword.id == permatag.keyword_id)
    keyword_id = Column(Integer, nullable=False, index=True)

    signum = Column(Integer, nullable=False)  # -1 = rejected, 1 = approved

    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(UUID(as_uuid=True), ForeignKey("user_profiles.supabase_uid", ondelete="SET NULL"), nullable=True)

    # Note: keyword relationship not defined to avoid cross-module coupling
    # Use: db.query(Keyword).filter(Keyword.id == permatag.keyword_id)

    __table_args__ = (
        Index("idx_permatag_asset_id", "asset_id"),
        Index("idx_permatag_keyword_id", "keyword_id"),
        Index("idx_permatag_asset_keyword_signum", "asset_id", "keyword_id", "signum"),
        Index("idx_permatag_tenant_keyword_signum_asset", "tenant_id", "keyword_id", "signum", "asset_id"),
        Index("idx_permatag_created_by", "created_by"),
        UniqueConstraint("asset_id", "keyword_id", name="uq_permatags_asset_keyword"),
    )


class DetectedFace(Base):
    """Faces detected and recognized in images."""

    __tablename__ = "detected_faces"

    id = Column(Integer, primary_key=True)
    image_id = Column(Integer, ForeignKey("image_metadata.id"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)

    person_id = Column(Integer, ForeignKey("people.id", ondelete="SET NULL"), nullable=True)
    person_name = Column(String(255), index=True)  # Fallback for unmatched faces
    confidence = Column(Float)

    # Bounding box
    bbox_top = Column(Integer)
    bbox_right = Column(Integer)
    bbox_bottom = Column(Integer)
    bbox_left = Column(Integer)

    # Face encoding (for matching)
    face_encoding = Column(ARRAY(Float))

    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    image = relationship("ImageMetadata", back_populates="faces")
    person = relationship("Person", back_populates="detected_faces")

    __table_args__ = (
        Index("idx_detected_faces_person_id", "person_id"),
        Index("idx_tenant_person", "tenant_id", "person_name"),
    )


class DropboxCursor(Base):
    """Store Dropbox delta sync cursors per tenant."""
    
    __tablename__ = "dropbox_cursors"
    
    tenant_id = Column(UUID(as_uuid=True), primary_key=True)
    cursor = Column(Text, nullable=False)
    last_sync = Column(DateTime, default=datetime.utcnow)


class ImageEmbedding(Base):
    """Store ML embeddings for visual similarity search."""
    
    __tablename__ = "image_embeddings"
    
    id = Column(Integer, primary_key=True)
    asset_id = Column(UUID(as_uuid=True), ForeignKey("assets.id", ondelete="SET NULL"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    
    embedding = Column(ARRAY(Float), nullable=False)  # Vector embedding
    model_name = Column(String(100))  # e.g., "clip-vit-base"
    model_version = Column(String(50))
    
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("uq_image_embeddings_asset_id", "asset_id", unique=True),
        Index("idx_image_embeddings_tenant_asset_model", "tenant_id", "asset_id", "model_name"),
    )


class KeywordModel(Base):
    """Store lightweight keyword models based on verified tags."""

    __tablename__ = "keyword_models"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    # Note: keyword_id FK not declared here (keywords table is in different declarative base)
    # Database enforces FK constraint; use db.query(Keyword).filter(Keyword.id == model.keyword_id)
    keyword_id = Column(Integer, nullable=False, index=True)
    model_name = Column(String(100), nullable=False)
    model_version = Column(String(50))

    positive_centroid = Column(ARRAY(Float), nullable=False)
    negative_centroid = Column(ARRAY(Float), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Note: keyword relationship not defined to avoid cross-module coupling
    # Use: db.query(Keyword).filter(Keyword.id == keyword_model.keyword_id)

    __table_args__ = (
        Index("idx_keyword_models_tenant_model", "tenant_id", "model_name", unique=False),
    )


# Note: Keyword and KeywordCategory are defined in models/config.py but are used here
# for relationships. The models/config.py definitions should inherit from Base
# defined in this module. This is a forward reference that gets resolved at runtime.
# The foreign key relationship is automatically created via the migration layer.


class MachineTag(Base):
    """Consolidated machine-generated tags supporting multiple algorithms.

    Stores output from all tagging algorithms (SigLIP, CLIP, trained models, etc.)
    in a single table, identified by tag_type.

    Design:
    - tag_type: Algorithm identifier ('siglip', 'clip', 'trained', etc.)
    - model_name: Specific model used (e.g., 'google/siglip-so400m-patch14-384')
    - model_version: Version of the model for reprocessing decisions
    - confidence: Algorithm's confidence score [0-1]

    The unique constraint prevents duplicate outputs from the same algorithm
    for the same asset/keyword/model combination.
    """

    __tablename__ = "machine_tags"

    id = Column(Integer, primary_key=True)
    asset_id = Column(UUID(as_uuid=True), ForeignKey("assets.id", ondelete="SET NULL"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)

    # Tag content (normalized via keyword_id)
    # Note: keyword_id FK not declared here (keywords table is in different declarative base)
    # Database enforces FK constraint; use db.query(Keyword).filter(Keyword.id == tag.keyword_id)
    keyword_id = Column(Integer, nullable=False, index=True)

    # Algorithm output
    confidence = Column(Float, nullable=False)  # Confidence/relevance score [0-1]

    # Algorithm identification
    tag_type = Column(String(50), nullable=False, index=True)
    # Examples: 'siglip', 'clip', 'trained', 'visual_similarity', 'facial_recognition'

    model_name = Column(String(100), nullable=False)
    # e.g., 'google/siglip-so400m-patch14-384' (matches SigLIPTagger in tagging.py:112),
    # 'openai/clip-vit-large' (hypothetical CLIP), 'trained' (keyword models)
    # Must match the model_name set by the tagger at insertion time to ensure
    # filtering/uniqueness/upserts work correctly across all code paths.
    # Non-null to ensure uniqueness constraint is not bypassed by NULLs

    model_version = Column(String(50))  # Version of the model that generated this tag

    # Audit trail
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    # updated_at tracks when tags are refreshed (used with ON CONFLICT upsert)

    # Note: keyword relationship not defined to avoid cross-module coupling
    # Use: db.query(Keyword).filter(Keyword.id == machine_tag.keyword_id)

    __table_args__ = (
        # Per-asset lookup with algorithm filter
        Index("idx_machine_tags_per_asset", "tenant_id", "asset_id", "tag_type"),
        Index("idx_machine_tags_asset_id", "asset_id"),
        Index("idx_machine_tags_tenant_type_keyword_asset", "tenant_id", "tag_type", "keyword_id", "asset_id"),
        Index("idx_machine_tags_tenant_type_keyword_model_asset", "tenant_id", "tag_type", "keyword_id", "model_name", "asset_id"),
        # Stats queries: COUNT(DISTINCT asset_id) WHERE tenant_id=X AND tag_type=Y
        Index("idx_machine_tags_tenant_type_asset", "tenant_id", "tag_type", "asset_id"),

        # Prevent duplicate outputs from same algorithm for same asset/keyword/model
        Index("idx_machine_tags_unique",
              "asset_id", "keyword_id", "tag_type", "model_name",
              unique=True),
    )


class Asset(Base):
    """Canonical asset representing a photo/video and its primary thumbnail."""

    __tablename__ = "assets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(String(1024), nullable=False)

    source_provider = Column(String(64), nullable=False)
    source_key = Column(String(1024), nullable=False)
    source_rev = Column(String(255))

    thumbnail_key = Column(String(1024), nullable=False)

    mime_type = Column(String(255))
    width = Column(Integer)
    height = Column(Integer)
    duration_ms = Column(Integer)

    created_by = Column(UUID(as_uuid=True), ForeignKey("user_profiles.supabase_uid", ondelete="SET NULL"))
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_assets_source_key", "source_provider", "source_key"),
    )


class AssetDerivative(Base):
    """Derivative file (crop/resize/export) stored in local/GCP."""

    __tablename__ = "asset_derivatives"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id = Column(UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True)
    storage_key = Column(String(1024), nullable=False)
    filename = Column(String(1024), nullable=False)
    variant = Column(String(128))
    created_by = Column(UUID(as_uuid=True), ForeignKey("user_profiles.supabase_uid", ondelete="SET NULL"))
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    deleted_at = Column(DateTime)

    __table_args__ = (
        Index("idx_asset_derivatives_variant", "variant"),
    )
