"""Metadata storage and management."""

from datetime import datetime
from typing import Optional

from sqlalchemy import Column, String, Integer, Float, DateTime, Boolean, Text, ForeignKey, Index
from sqlalchemy.dialects.postgresql import JSONB, ARRAY
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship

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
    
    # Relationship
    tenant = relationship("Tenant", back_populates="people")


class ImageMetadata(Base):
    """Image metadata and processing state."""
    
    __tablename__ = "image_metadata"
    
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(255), nullable=False, index=True)
    
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
    
    # Processing state
    last_processed = Column(DateTime, default=datetime.utcnow)
    processing_version = Column(String(50))  # Model version for reprocessing
    thumbnail_path = Column(String(1024))  # Cloud Storage path
    embedding_generated = Column(Boolean, default=False)
    faces_detected = Column(Boolean, default=False)
    tags_applied = Column(Boolean, default=False)
    
    # Relationships
    tags = relationship("ImageTag", back_populates="image", cascade="all, delete-orphan")
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
    tenant_id = Column(String(255), nullable=False, index=True)
    
    keyword = Column(String(255), nullable=False, index=True)
    category = Column(String(255))  # Parent category from hierarchy
    confidence = Column(Float)  # If auto-tagged
    manual = Column(Boolean, default=False)  # User-applied vs AI
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationship
    image = relationship("ImageMetadata", back_populates="tags")
    
    __table_args__ = (
        Index("idx_tenant_keyword", "tenant_id", "keyword"),
    )


class Permatag(Base):
    """Permanent human-verified tags with positive/negative polarity."""
    
    __tablename__ = "permatags"
    
    id = Column(Integer, primary_key=True)
    image_id = Column(Integer, ForeignKey("image_metadata.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(String(255), nullable=False, index=True)
    
    keyword = Column(String(255), nullable=False, index=True)
    category = Column(String(255))  # Parent category from hierarchy
    signum = Column(Integer, nullable=False)  # -1 = rejected, 1 = approved
    
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(String(255))  # Optional: track who approved/rejected
    
    # Relationship
    image = relationship("ImageMetadata", back_populates="permatags")
    
    __table_args__ = (
        Index("idx_permatag_tenant_image", "tenant_id", "image_id"),
        Index("idx_permatag_keyword", "keyword"),
    )


class DetectedFace(Base):
    """Faces detected and recognized in images."""
    
    __tablename__ = "detected_faces"
    
    id = Column(Integer, primary_key=True)
    image_id = Column(Integer, ForeignKey("image_metadata.id"), nullable=False)
    tenant_id = Column(String(255), nullable=False, index=True)
    
    person_name = Column(String(255), index=True)  # From people.yaml
    confidence = Column(Float)
    
    # Bounding box
    bbox_top = Column(Integer)
    bbox_right = Column(Integer)
    bbox_bottom = Column(Integer)
    bbox_left = Column(Integer)
    
    # Face encoding (for matching)
    face_encoding = Column(ARRAY(Float))
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationship
    image = relationship("ImageMetadata", back_populates="faces")
    
    __table_args__ = (
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
