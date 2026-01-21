"""Metadata storage and management."""

from datetime import datetime
from typing import Optional

from sqlalchemy import Column, String, Integer, Float, DateTime, Boolean, Text, ForeignKey, Index
from sqlalchemy.dialects.postgresql import JSONB, ARRAY
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
    
    id = Column(String(255), primary_key=True)  # Tenant identifier (e.g., "demo")
    name = Column(String(255), nullable=False)  # Display name
    active = Column(Boolean, default=True, nullable=False, index=True)
    
    # Dropbox integration
    dropbox_app_key = Column(String(255))
    # Secret Manager paths constructed from tenant_id:
    # - dropbox-app-secret-{tenant_id}
    # - dropbox-token-{tenant_id}

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
    """Known people for facial recognition."""

    __tablename__ = "people"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(255), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)

    name = Column(String(255), nullable=False, index=True)
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
    tenant_id = Column(String(255), nullable=False, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    
    # File information
    dropbox_path = Column(String(1024), nullable=False)
    dropbox_id = Column(String(255), unique=True, index=True)
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
    thumbnail_path = Column(String(1024))  # Cloud Storage path
    embedding_generated = Column(Boolean, default=False)
    faces_detected = Column(Boolean, default=False)
    tags_applied = Column(Boolean, default=False)

    # User rating (0-3, optional)
    rating = Column(Integer, nullable=True)
    
    # Relationships
    tags = relationship("ImageTag", back_populates="image", cascade="all, delete-orphan")
    machine_tags = relationship("MachineTag", back_populates="image", cascade="all, delete-orphan")
    trained_tags = relationship("TrainedImageTag", back_populates="image", cascade="all, delete-orphan")
    permatags = relationship("Permatag", back_populates="image", cascade="all, delete-orphan")
    faces = relationship("DetectedFace", back_populates="image", cascade="all, delete-orphan")
    
    # Indexes for common queries
    __table_args__ = (
        Index("idx_tenant_modified", "tenant_id", "modified_time"),
        Index("idx_tenant_capture", "tenant_id", "capture_timestamp"),
        Index("idx_tenant_location", "tenant_id", "gps_latitude", "gps_longitude"),
    )


class ImageTag(Base):
    """Tags applied to images from controlled vocabulary."""

    __tablename__ = "image_tags"

    id = Column(Integer, primary_key=True)
    image_id = Column(Integer, ForeignKey("image_metadata.id"), nullable=False)
    # Note: keyword_id FK not declared here (keywords table is in different declarative base)
    keyword_id = Column(Integer, nullable=False, index=True)

    confidence = Column(Float)  # If auto-tagged
    manual = Column(Boolean, default=False)  # User-applied vs AI

    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    image = relationship("ImageMetadata", back_populates="tags")
    # Note: keyword relationship not defined to avoid cross-module coupling
    # Use: db.query(Keyword).filter(Keyword.id == image_tag.keyword_id)

    __table_args__ = (
        Index("idx_image_tags_keyword_id", "keyword_id"),
    )


class Permatag(Base):
    """Permanent human-verified tags with positive/negative polarity."""

    __tablename__ = "permatags"

    id = Column(Integer, primary_key=True)
    image_id = Column(Integer, ForeignKey("image_metadata.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(String(255), nullable=False, index=True)
    # Note: keyword_id FK not declared here (keywords table is in different declarative base)
    # Database enforces FK constraint; use db.query(Keyword).filter(Keyword.id == permatag.keyword_id)
    keyword_id = Column(Integer, nullable=False, index=True)

    signum = Column(Integer, nullable=False)  # -1 = rejected, 1 = approved

    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(String(255))  # Optional: track who approved/rejected

    # Relationships
    image = relationship("ImageMetadata", back_populates="permatags")
    # Note: keyword relationship not defined to avoid cross-module coupling
    # Use: db.query(Keyword).filter(Keyword.id == permatag.keyword_id)

    __table_args__ = (
        Index("idx_permatag_image_id", "image_id"),
        Index("idx_permatag_keyword_id", "keyword_id"),
    )


class DetectedFace(Base):
    """Faces detected and recognized in images."""

    __tablename__ = "detected_faces"

    id = Column(Integer, primary_key=True)
    image_id = Column(Integer, ForeignKey("image_metadata.id"), nullable=False)
    tenant_id = Column(String(255), nullable=False, index=True)

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
    
    tenant_id = Column(String(255), primary_key=True)
    cursor = Column(Text, nullable=False)
    last_sync = Column(DateTime, default=datetime.utcnow)


class ImageEmbedding(Base):
    """Store ML embeddings for visual similarity search."""
    
    __tablename__ = "image_embeddings"
    
    id = Column(Integer, primary_key=True)
    image_id = Column(Integer, ForeignKey("image_metadata.id"), nullable=False, unique=True)
    tenant_id = Column(String(255), nullable=False, index=True)
    
    embedding = Column(ARRAY(Float), nullable=False)  # Vector embedding
    model_name = Column(String(100))  # e.g., "clip-vit-base"
    model_version = Column(String(50))
    
    created_at = Column(DateTime, default=datetime.utcnow)


class KeywordModel(Base):
    """Store lightweight keyword models based on verified tags."""

    __tablename__ = "keyword_models"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(255), nullable=False, index=True)
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


class TrainedImageTag(Base):
    """Cache trained-ML tag outputs per image."""

    __tablename__ = "trained_image_tags"

    id = Column(Integer, primary_key=True)
    image_id = Column(Integer, ForeignKey("image_metadata.id", ondelete="CASCADE"), nullable=False)
    # Note: keyword_id FK not declared here (keywords table is in different declarative base)
    keyword_id = Column(Integer, nullable=False, index=True)

    confidence = Column(Float)
    model_name = Column(String(100))
    model_version = Column(String(50))

    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    image = relationship("ImageMetadata", back_populates="trained_tags")
    # Note: keyword relationship not defined to avoid cross-module coupling
    # Use: db.query(Keyword).filter(Keyword.id == trained_tag.keyword_id)

    __table_args__ = (
        Index("idx_trained_tags_image_keyword_model", "image_id", "keyword_id", "model_name", unique=True),
    )


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
    for the same image/keyword/model combination.
    """

    __tablename__ = "machine_tags"

    id = Column(Integer, primary_key=True)
    image_id = Column(Integer, ForeignKey("image_metadata.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(String(255), nullable=False, index=True)

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

    # Relationships
    image = relationship("ImageMetadata", back_populates="machine_tags")
    # Note: keyword relationship not defined to avoid cross-module coupling
    # Use: db.query(Keyword).filter(Keyword.id == machine_tag.keyword_id)

    __table_args__ = (
        # Per-image lookup with algorithm filter
        Index("idx_machine_tags_per_image", "tenant_id", "image_id", "tag_type"),

        # Prevent duplicate outputs from same algorithm for same image/keyword/model
        Index("idx_machine_tags_unique",
              "image_id", "keyword_id", "tag_type", "model_name",
              unique=True),
    )
