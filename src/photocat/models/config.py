"""Database models for tenant configuration."""

from datetime import datetime
from typing import List

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON, Index
from sqlalchemy.orm import relationship, DeclarativeBase

import sqlalchemy as sa
from sqlalchemy.sql import func


class Base(DeclarativeBase):
    pass


class KeywordCategory(Base):
    """Keyword category for organizing tags hierarchically."""
    
    __tablename__ = "keyword_categories"
    
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(50), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    parent_id = Column(Integer, ForeignKey('keyword_categories.id', ondelete='CASCADE'), nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())
    
    # Relationships
    parent = relationship("KeywordCategory", remote_side=[id], back_populates="subcategories")
    subcategories = relationship("KeywordCategory", back_populates="parent", cascade="all, delete-orphan")
    keywords = relationship("Keyword", back_populates="category", cascade="all, delete-orphan")


class Keyword(Base):
    """Individual keyword within a category."""

    __tablename__ = "keywords"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(50), nullable=False, index=True)  # NEW: For tenant isolation and direct queries
    category_id = Column(Integer, ForeignKey('keyword_categories.id', ondelete='CASCADE'), nullable=False, index=True)
    keyword = Column(String(100), nullable=False)
    prompt = Column(Text, nullable=True)  # Optional custom prompt for tagging
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    # Relationships
    category = relationship("KeywordCategory", back_populates="keywords")

    # Note: Tag relationships (ImageTag, MachineTag, etc.) are defined in metadata/__init__.py
    # since those models use a different declarative base. Relationships are handled through
    # the database foreign keys; use db.query(ImageTag).filter(ImageTag.keyword_id == keyword.id)
    # to retrieve related tags at query time.

    __table_args__ = (
        Index("idx_keywords_tenant_keyword_category", "tenant_id", "keyword", "category_id", unique=True),
    )



# ...existing code...

class PhotoList(Base):
    """A list of photos for a tenant. Only one active per tenant."""
    __tablename__ = "photo_lists"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(50), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    notebox = Column(Text, nullable=True)
    is_active = Column(sa.Boolean, nullable=False, default=False, server_default=sa.text('false'))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    # Relationships
    items = relationship("PhotoListItem", back_populates="list", cascade="all, delete-orphan")


class PhotoListItem(Base):
    """A photo added to a list."""
    __tablename__ = "photo_list_items"

    id = Column(Integer, primary_key=True)
    list_id = Column(Integer, ForeignKey('photo_lists.id', ondelete='CASCADE'), nullable=False, index=True)
    photo_id = Column(Integer, nullable=False, index=True)
    added_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    # Relationships
    list = relationship("PhotoList", back_populates="items")
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())
    
    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "aliases": self.aliases or [],
            "face_embedding_ref": self.face_embedding_ref
        }
