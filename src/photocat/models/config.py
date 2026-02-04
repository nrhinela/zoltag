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
    slug = Column(String(60), nullable=True)
    parent_id = Column(Integer, ForeignKey('keyword_categories.id', ondelete='CASCADE'), nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)

    # NEW: Mark if this is a people category
    is_people_category = Column(sa.Boolean, nullable=False, server_default=sa.text('false'))
    # NEW: Mark if this category is used for attribution keywords
    is_attribution = Column(sa.Boolean, nullable=False, server_default=sa.text('false'))

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    # Relationships
    parent = relationship("KeywordCategory", remote_side=[id], back_populates="subcategories")
    subcategories = relationship("KeywordCategory", back_populates="parent", cascade="all, delete-orphan")
    keywords = relationship("Keyword", back_populates="category", cascade="all, delete-orphan")
    __table_args__ = (
        Index("idx_keyword_categories_tenant_name", "tenant_id", "name"),
    )

class Keyword(Base):
    """Individual keyword within a category."""

    __tablename__ = "keywords"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(50), nullable=False, index=True)  # For tenant isolation and direct queries
    category_id = Column(Integer, ForeignKey('keyword_categories.id', ondelete='CASCADE'), nullable=False, index=True)
    keyword = Column(String(100), nullable=False)
    prompt = Column(Text, nullable=True)  # Optional custom prompt for tagging
    sort_order = Column(Integer, nullable=False, default=0)

    # NEW: Person linking (NULL for regular keywords)
    person_id = Column(Integer, nullable=True, unique=True)
    # Foreign key to people.id (in metadata/__init__.py with different Base)
    # Database enforces FK constraint; use db.query(Person).filter(Person.keyword_id == keyword.id)

    # NEW: Tag type ('keyword' for regular keywords, 'person' for people tags)
    tag_type = Column(String(20), nullable=False, server_default='keyword', index=True)

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    # Relationships
    category = relationship("KeywordCategory", back_populates="keywords")
    # NOTE: person relationship NOT defined here - Person is in different declarative base (metadata/__init__.py)
    # Use db.query(Person).filter(Person.keyword) to access the relationship at query time
    # The foreign key constraint is still enforced at the database level

    __table_args__ = (
        Index("idx_keywords_tenant_keyword_category", "tenant_id", "keyword", "category_id", unique=True),
        Index("idx_keywords_tenant_lower_keyword_category", "tenant_id", func.lower(keyword), "category_id"),
        Index("idx_keywords_person_id", "person_id"),
        Index("idx_keywords_tag_type", "tag_type"),
    )



# ...existing code...

class PhotoList(Base):
    """A list of photos for a tenant."""
    __tablename__ = "photo_lists"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(50), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    notebox = Column(Text, nullable=True)
    created_by_uid = Column(sa.UUID, nullable=True, index=True)  # Foreign key to user_profiles.supabase_uid
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

    __table_args__ = (
        Index("idx_photo_list_items_list_photo", "list_id", "photo_id"),
    )
    
    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "aliases": self.aliases or [],
            "face_embedding_ref": self.face_embedding_ref
        }
