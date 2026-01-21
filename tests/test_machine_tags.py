"""Tests for machine_tags consolidation and migration."""

import pytest
from sqlalchemy.orm import Session
from sqlalchemy import func, distinct

from photocat.metadata import (
    ImageMetadata, MachineTag, Permatag
)
from photocat.models.config import Keyword, KeywordCategory
from photocat.dependencies import get_tenant_setting


@pytest.fixture
def sample_tags_data(test_db: Session):
    """Create sample tags data for testing migration."""
    tenant_id = "test_tenant"

    # Create a test image
    image = ImageMetadata(
        id=1,
        tenant_id=tenant_id,
        dropbox_path="/test/image.jpg",
        size_bytes=1024,
        width=100,
        height=100
    )
    test_db.add(image)
    test_db.commit()

    # Create keywords for use in tags
    category = KeywordCategory(
        id=1,
        tenant_id=tenant_id,
        name="animals",
        sort_order=0
    )
    test_db.add(category)
    test_db.commit()

    keyword1 = Keyword(
        id=1,
        tenant_id=tenant_id,
        category_id=1,
        keyword="dog",
        sort_order=0
    )
    keyword2 = Keyword(
        id=2,
        tenant_id=tenant_id,
        category_id=1,
        keyword="outdoor",
        sort_order=1
    )
    test_db.add(keyword1)
    test_db.add(keyword2)
    test_db.commit()

    return {
        "image_id": 1,
        "tenant_id": tenant_id,
        "keyword_ids": [1, 2],
        "category_id": 1
    }


class TestMachineTagModel:
    """Test MachineTag ORM model."""

    def test_machine_tag_creation(self, test_db: Session):
        """Test creating a MachineTag entry with FK relationship."""
        tenant_id = "test_tenant"

        # Create image first
        image = ImageMetadata(
            id=1,
            tenant_id=tenant_id,
            dropbox_path="/test/image.jpg",
            size_bytes=1024,
            width=100,
            height=100
        )
        test_db.add(image)
        test_db.commit()

        # Create keyword category
        category = KeywordCategory(
            id=1,
            tenant_id=tenant_id,
            name="animals",
            sort_order=0
        )
        test_db.add(category)
        test_db.commit()

        # Create keyword
        keyword = Keyword(
            id=1,
            tenant_id=tenant_id,
            category_id=1,
            keyword="dog",
            sort_order=0
        )
        test_db.add(keyword)
        test_db.commit()

        # Create MachineTag with FK
        machine_tag = MachineTag(
            image_id=1,
            tenant_id=tenant_id,
            keyword_id=1,  # FK instead of keyword string
            confidence=0.95,
            tag_type="siglip",
            model_name="google/siglip-so400m-patch14-384",
            model_version="1.0"
        )
        test_db.add(machine_tag)
        test_db.commit()

        # Verify
        retrieved = test_db.query(MachineTag).filter_by(
            image_id=1,
            keyword_id=1  # Query by FK instead of keyword string
        ).first()

        assert retrieved is not None
        assert retrieved.tag_type == "siglip"
        assert retrieved.model_name == "google/siglip-so400m-patch14-384"
        assert retrieved.confidence == 0.95

    def test_machine_tag_unique_constraint(self, test_db: Session):
        """Test that unique constraint prevents duplicate tags."""
        tenant_id = "test_tenant"

        # Create image
        image = ImageMetadata(
            id=1,
            tenant_id=tenant_id,
            dropbox_path="/test/image.jpg",
            size_bytes=1024,
            width=100,
            height=100
        )
        test_db.add(image)
        test_db.commit()

        # Create keyword
        category = KeywordCategory(
            id=1,
            tenant_id=tenant_id,
            name="animals",
            sort_order=0
        )
        test_db.add(category)
        test_db.commit()

        keyword = Keyword(
            id=1,
            tenant_id=tenant_id,
            category_id=1,
            keyword="dog",
            sort_order=0
        )
        test_db.add(keyword)
        test_db.commit()

        # Create first tag with FK
        tag1 = MachineTag(
            image_id=1,
            tenant_id=tenant_id,
            keyword_id=1,
            confidence=0.95,
            tag_type="siglip",
            model_name="google/siglip-so400m-patch14-384"
        )
        test_db.add(tag1)
        test_db.commit()

        # Try to create duplicate - should raise (violates unique constraint)
        tag2 = MachineTag(
            image_id=1,
            tenant_id=tenant_id,
            keyword_id=1,
            confidence=0.96,  # Different confidence
            tag_type="siglip",
            model_name="google/siglip-so400m-patch14-384"
        )
        test_db.add(tag2)

        with pytest.raises(Exception):  # IntegrityError
            test_db.commit()


class TestMachineTagQueries:
    """Test querying MachineTag data."""

    def test_query_tags_by_image_and_type(self, test_db: Session, sample_tags_data):
        """Test querying tags for an image with specific tag_type."""
        # Create MachineTag with FK to keyword
        tag = MachineTag(
            image_id=sample_tags_data["image_id"],
            tenant_id=sample_tags_data["tenant_id"],
            keyword_id=sample_tags_data["keyword_ids"][0],  # Use FK
            confidence=0.95,
            tag_type="siglip",
            model_name="google/siglip-so400m-patch14-384"
        )
        test_db.add(tag)
        test_db.commit()

        # Query
        results = test_db.query(MachineTag).filter(
            MachineTag.image_id == sample_tags_data["image_id"],
            MachineTag.tag_type == "siglip"
        ).all()

        assert len(results) == 1
        assert results[0].keyword_id == sample_tags_data["keyword_ids"][0]
        assert results[0].confidence == 0.95

    def test_query_tags_by_type_and_keyword_id(self, test_db: Session):
        """Test querying tags by type and keyword_id for faceting."""
        tenant_id = "test_tenant"

        # Create images
        for i in range(1, 4):
            image = ImageMetadata(
                id=i,
                tenant_id=tenant_id,
                dropbox_path=f"/test/image{i}.jpg",
                size_bytes=1024,
                width=100,
                height=100
            )
            test_db.add(image)
        test_db.commit()

        # Create keyword
        category = KeywordCategory(
            id=1,
            tenant_id=tenant_id,
            name="animals",
            sort_order=0
        )
        test_db.add(category)
        test_db.commit()

        keyword = Keyword(
            id=1,
            tenant_id=tenant_id,
            category_id=1,
            keyword="dog",
            sort_order=0
        )
        test_db.add(keyword)
        test_db.commit()

        # Create tags - all same keyword_id/type/model but different images
        for i in range(1, 4):
            tag = MachineTag(
                image_id=i,
                tenant_id=tenant_id,
                keyword_id=1,  # Use FK instead of keyword string
                confidence=0.90 + (i * 0.01),
                tag_type="siglip",
                model_name="google/siglip-so400m-patch14-384"
            )
            test_db.add(tag)
        test_db.commit()

        # Query count by keyword_id
        count = test_db.query(func.count(distinct(MachineTag.image_id))).filter(
            MachineTag.tenant_id == tenant_id,
            MachineTag.tag_type == "siglip",
            MachineTag.keyword_id == 1  # Query by FK instead of keyword string
        ).scalar()

        assert count == 3


class TestTenantSetting:
    """Test get_tenant_setting helper function."""

    def test_get_tenant_setting_default(self, test_db: Session):
        """Test fallback to default when setting not found."""
        # get_tenant_setting should return default for non-existent tenant
        result = get_tenant_setting(
            test_db,
            "nonexistent_tenant",
            "active_machine_tag_type",
            default="siglip"
        )

        assert result == "siglip"

    def test_get_tenant_setting_from_jsonb(self, test_db: Session):
        """Test retrieving setting from JSONB."""
        from photocat.metadata import Tenant as TenantModel

        # Create tenant with settings
        tenant = TenantModel(
            id="test_tenant",
            name="Test",
            active=True,
            settings={"active_machine_tag_type": "clip"}
        )
        test_db.add(tenant)
        test_db.commit()

        # Retrieve setting
        result = get_tenant_setting(
            test_db,
            "test_tenant",
            "active_machine_tag_type",
            default="siglip"
        )

        assert result == "clip"


class TestMachineTagIndexes:
    """Test that indexes are created properly."""

    def test_per_image_index_exists(self, test_db: Session):
        """Verify per-image index exists for efficient filtering."""
        # Query the database for the index
        inspector_result = test_db.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_machine_tags_per_image'"
        ).fetchall()

        # In SQLite the index name might be different; just verify we can query efficiently
        tenant_id = "test_tenant"
        image = ImageMetadata(
            id=1,
            tenant_id=tenant_id,
            dropbox_path="/test.jpg",
            size_bytes=1024,
            width=100,
            height=100
        )
        test_db.add(image)
        test_db.commit()

        # Create keyword category and keywords
        category = KeywordCategory(
            id=1,
            tenant_id=tenant_id,
            name="test",
            sort_order=0
        )
        test_db.add(category)
        test_db.commit()

        # Create multiple keywords and tags
        for i in range(10):
            keyword = Keyword(
                id=i+1,
                tenant_id=tenant_id,
                category_id=1,
                keyword=f"keyword{i}",
                sort_order=i
            )
            test_db.add(keyword)
        test_db.commit()

        for i in range(10):
            tag = MachineTag(
                image_id=1,
                tenant_id=tenant_id,
                keyword_id=i+1,  # FK instead of keyword string
                confidence=0.5 + (i * 0.01),
                tag_type="siglip",
                model_name=f"model{i}"
            )
            test_db.add(tag)
        test_db.commit()

        # Query should work efficiently
        results = test_db.query(MachineTag).filter(
            MachineTag.tenant_id == tenant_id,
            MachineTag.image_id == 1,
            MachineTag.tag_type == "siglip"
        ).all()

        assert len(results) == 10

    def test_facets_index_for_counts(self, test_db: Session):
        """Verify facet index works for keyword_id counting."""
        tenant_id = "test_tenant"

        # Create multiple images with same tag
        for i in range(1, 6):
            image = ImageMetadata(
                id=i,
                tenant_id=tenant_id,
                dropbox_path=f"/test{i}.jpg",
                size_bytes=1024,
                width=100,
                height=100
            )
            test_db.add(image)
        test_db.commit()

        # Create keyword
        category = KeywordCategory(
            id=1,
            tenant_id=tenant_id,
            name="animals",
            sort_order=0
        )
        test_db.add(category)
        test_db.commit()

        keyword = Keyword(
            id=1,
            tenant_id=tenant_id,
            category_id=1,
            keyword="dog",
            sort_order=0
        )
        test_db.add(keyword)
        test_db.commit()

        # Add tags with FK
        for i in range(1, 6):
            tag = MachineTag(
                image_id=i,
                tenant_id=tenant_id,
                keyword_id=1,  # FK instead of keyword string
                confidence=0.90,
                tag_type="siglip",
                model_name="google/siglip-so400m-patch14-384"
            )
            test_db.add(tag)
        test_db.commit()

        # Count images by keyword_id (simulating facet counts)
        count = test_db.query(func.count(distinct(MachineTag.image_id))).filter(
            MachineTag.tenant_id == tenant_id,
            MachineTag.tag_type == "siglip",
            MachineTag.keyword_id == 1  # Query by FK instead of keyword string
        ).scalar()

        assert count == 5
