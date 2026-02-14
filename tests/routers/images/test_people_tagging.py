"""Tests for image people tagging endpoints.

This module tests people tagging on images:
- POST /api/v1/images/{image_id}/people (tag_person_on_image)
- DELETE /api/v1/images/{image_id}/people/{person_id} (remove_person_tag)
- GET /api/v1/images/{image_id}/people (get_image_people_tags)
- PUT /api/v1/images/{image_id}/people/{person_id} (update_person_tag_confidence)
"""

import pytest
import uuid
from sqlalchemy.orm import Session

from photocat.tenant import Tenant, TenantContext
from photocat.metadata import Asset, Person, ImageMetadata, MachineTag
from photocat.models.config import Keyword, KeywordCategory


TEST_TENANT_IDENTIFIER = "test_tenant"
TEST_TENANT_ID = uuid.uuid5(uuid.NAMESPACE_DNS, TEST_TENANT_IDENTIFIER)


@pytest.fixture
def tenant():
    """Create a test tenant."""
    tenant = Tenant(
        id=str(TEST_TENANT_ID),
        name="Test Tenant",
        identifier=TEST_TENANT_IDENTIFIER,
        key_prefix=TEST_TENANT_IDENTIFIER,
        active=True,
        dropbox_token_secret="test-secret"
    )
    tenant.id = TEST_TENANT_ID
    TenantContext.set(tenant)
    yield tenant
    TenantContext.clear()


@pytest.fixture
def setup_people_and_images(test_db: Session, tenant: Tenant):
    """Setup test people, keywords, and images."""
    # Create keyword category
    keyword_cat = KeywordCategory(
        tenant_id=tenant.id,
        name="people",
        is_people_category=True
    )
    test_db.add(keyword_cat)
    test_db.flush()

    # Create people
    alice = Person(
        tenant_id=tenant.id,
        name="Alice",
        instagram_url="https://instagram.com/alice"
    )
    bob = Person(
        tenant_id=tenant.id,
        name="Bob"
    )
    test_db.add(alice)
    test_db.add(bob)
    test_db.flush()

    # Create keywords for people
    alice_keyword = Keyword(
        tenant_id=tenant.id,
        category_id=keyword_cat.id,
        keyword="Alice",
        person_id=alice.id,
        tag_type="person"
    )
    bob_keyword = Keyword(
        tenant_id=tenant.id,
        category_id=keyword_cat.id,
        keyword="Bob",
        person_id=bob.id,
        tag_type="person"
    )
    test_db.add(alice_keyword)
    test_db.add(bob_keyword)
    test_db.flush()

    # Create assets and images
    asset1 = Asset(
        tenant_id=tenant.id,
        filename="photo1.jpg",
        source_provider="test",
        source_key="/test/photo1.jpg",
        thumbnail_key="thumbnails/photo1.jpg",
    )
    asset2 = Asset(
        tenant_id=tenant.id,
        filename="photo2.jpg",
        source_provider="test",
        source_key="/test/photo2.jpg",
        thumbnail_key="thumbnails/photo2.jpg",
    )
    test_db.add(asset1)
    test_db.add(asset2)
    test_db.flush()

    image1 = ImageMetadata(
        tenant_id=tenant.id,
        asset_id=asset1.id,
        filename="photo1.jpg",
        file_size=1024,
        width=100,
        height=100,
        format="JPEG",
    )
    image2 = ImageMetadata(
        tenant_id=tenant.id,
        asset_id=asset2.id,
        filename="photo2.jpg",
        file_size=1024,
        width=100,
        height=100,
        format="JPEG",
    )
    test_db.add(image1)
    test_db.add(image2)
    test_db.commit()

    return {
        "people": {"alice": alice, "bob": bob},
        "keywords": {"alice": alice_keyword, "bob": bob_keyword},
        "images": {"image1": image1, "image2": image2},
        "keyword_cat": keyword_cat
    }


# ============================================================================
# Tag Person on Image Tests
# ============================================================================

class TestTagPersonOnImage:
    """Tests for POST /api/v1/images/{image_id}/people endpoint."""

    def test_tag_person_success(self, test_db: Session, tenant: Tenant, setup_people_and_images):
        """Test successfully tagging a person on an image."""
        data = setup_people_and_images
        image = data["images"]["image1"]
        person = data["people"]["alice"]
        keyword = data["keywords"]["alice"]

        # Tag person on image
        tag = MachineTag(
            asset_id=image.asset_id,
            tenant_id=tenant.id,
            keyword_id=keyword.id,
            confidence=1.0,
            tag_type="manual_person",
            model_name="manual",
            model_version="1.0"
        )
        test_db.add(tag)
        test_db.commit()
        test_db.refresh(tag)

        # Verify tag was created
        assert tag.id is not None
        assert tag.asset_id == image.asset_id
        assert tag.keyword_id == keyword.id
        assert tag.tag_type == "manual_person"
        assert tag.confidence == 1.0

    def test_tag_person_duplicate_handling(self, test_db: Session, tenant: Tenant, setup_people_and_images):
        """Test updating confidence when tagging same person again."""
        data = setup_people_and_images
        image = data["images"]["image1"]
        person = data["people"]["alice"]
        keyword = data["keywords"]["alice"]

        # Create first tag
        tag1 = MachineTag(
            asset_id=image.asset_id,
            tenant_id=tenant.id,
            keyword_id=keyword.id,
            confidence=0.8,
            tag_type="manual_person",
            model_name="manual",
            model_version="1.0",
        )
        test_db.add(tag1)
        test_db.commit()

        # Update confidence
        tag1.confidence = 1.0
        test_db.commit()
        test_db.refresh(tag1)

        # Verify only one tag exists
        tags = test_db.query(MachineTag).filter(
            MachineTag.asset_id == image.asset_id,
            MachineTag.keyword_id == keyword.id,
            MachineTag.tag_type == "manual_person"
        ).all()

        assert len(tags) == 1
        assert tags[0].confidence == 1.0

    def test_tag_multiple_people_same_image(self, test_db: Session, tenant: Tenant, setup_people_and_images):
        """Test tagging multiple people on the same image."""
        data = setup_people_and_images
        image = data["images"]["image1"]
        alice_keyword = data["keywords"]["alice"]
        bob_keyword = data["keywords"]["bob"]

        # Tag both people
        tag_alice = MachineTag(
            asset_id=image.asset_id,
            tenant_id=tenant.id,
            keyword_id=alice_keyword.id,
            confidence=1.0,
            tag_type="manual_person",
            model_name="manual",
            model_version="1.0",
        )
        tag_bob = MachineTag(
            asset_id=image.asset_id,
            tenant_id=tenant.id,
            keyword_id=bob_keyword.id,
            confidence=0.9,
            tag_type="manual_person",
            model_name="manual",
            model_version="1.0",
        )
        test_db.add(tag_alice)
        test_db.add(tag_bob)
        test_db.commit()

        # Verify both tags exist
        tags = test_db.query(MachineTag).filter(
            MachineTag.asset_id == image.asset_id,
            MachineTag.tag_type == "manual_person"
        ).all()

        assert len(tags) == 2

    def test_tag_person_with_confidence(self, test_db: Session, tenant: Tenant, setup_people_and_images):
        """Test tagging with custom confidence score."""
        data = setup_people_and_images
        image = data["images"]["image1"]
        keyword = data["keywords"]["alice"]

        # Tag with custom confidence
        tag = MachineTag(
            asset_id=image.asset_id,
            tenant_id=tenant.id,
            keyword_id=keyword.id,
            confidence=0.75,
            tag_type="manual_person",
            model_name="manual",
            model_version="1.0",
        )
        test_db.add(tag)
        test_db.commit()
        test_db.refresh(tag)

        assert tag.confidence == 0.75


# ============================================================================
# Remove Person Tag Tests
# ============================================================================

class TestRemovePersonTag:
    """Tests for DELETE /api/v1/images/{image_id}/people/{person_id} endpoint."""

    def test_remove_person_tag_success(self, test_db: Session, tenant: Tenant, setup_people_and_images):
        """Test successfully removing a person tag."""
        data = setup_people_and_images
        image = data["images"]["image1"]
        keyword = data["keywords"]["alice"]

        # Create tag
        tag = MachineTag(
            asset_id=image.asset_id,
            tenant_id=tenant.id,
            keyword_id=keyword.id,
            confidence=1.0,
            tag_type="manual_person",
            model_name="manual",
            model_version="1.0",
        )
        test_db.add(tag)
        test_db.commit()
        tag_id = tag.id

        # Remove tag
        deleted = test_db.query(MachineTag).filter(
            MachineTag.id == tag_id
        ).delete()
        test_db.commit()

        assert deleted == 1

        # Verify deletion
        remaining = test_db.query(MachineTag).filter(
            MachineTag.id == tag_id
        ).first()

        assert remaining is None

    def test_remove_person_tag_not_found(self, test_db: Session, tenant: Tenant, setup_people_and_images):
        """Test removing tag that doesn't exist."""
        data = setup_people_and_images
        image = data["images"]["image1"]
        keyword = data["keywords"]["alice"]

        # Try to remove non-existent tag
        deleted = test_db.query(MachineTag).filter(
            MachineTag.asset_id == image.asset_id,
            MachineTag.keyword_id == keyword.id,
            MachineTag.tag_type == "manual_person"
        ).delete()

        assert deleted == 0

    def test_remove_one_tag_keeps_others(self, test_db: Session, tenant: Tenant, setup_people_and_images):
        """Test removing one tag doesn't affect other tags."""
        data = setup_people_and_images
        image = data["images"]["image1"]
        alice_keyword = data["keywords"]["alice"]
        bob_keyword = data["keywords"]["bob"]

        # Create both tags
        tag_alice = MachineTag(
            asset_id=image.asset_id,
            tenant_id=tenant.id,
            keyword_id=alice_keyword.id,
            confidence=1.0,
            tag_type="manual_person",
            model_name="manual",
            model_version="1.0",
        )
        tag_bob = MachineTag(
            asset_id=image.asset_id,
            tenant_id=tenant.id,
            keyword_id=bob_keyword.id,
            confidence=1.0,
            tag_type="manual_person",
            model_name="manual",
            model_version="1.0",
        )
        test_db.add(tag_alice)
        test_db.add(tag_bob)
        test_db.commit()

        # Remove Alice tag
        deleted = test_db.query(MachineTag).filter(
            MachineTag.asset_id == image.asset_id,
            MachineTag.keyword_id == alice_keyword.id,
            MachineTag.tag_type == "manual_person"
        ).delete()
        test_db.commit()

        assert deleted == 1

        # Verify Bob tag still exists
        remaining = test_db.query(MachineTag).filter(
            MachineTag.asset_id == image.asset_id,
            MachineTag.tag_type == "manual_person"
        ).all()

        assert len(remaining) == 1
        assert remaining[0].keyword_id == bob_keyword.id


# ============================================================================
# Get Image People Tags Tests
# ============================================================================

class TestGetImagePeopleTags:
    """Tests for GET /api/v1/images/{image_id}/people endpoint."""

    def test_get_people_tags_empty(self, test_db: Session, tenant: Tenant, setup_people_and_images):
        """Test getting people tags when none exist."""
        data = setup_people_and_images
        image = data["images"]["image1"]

        tags = test_db.query(MachineTag).filter(
            MachineTag.asset_id == image.asset_id,
            MachineTag.tag_type == "manual_person"
        ).all()

        assert len(tags) == 0

    def test_get_people_tags_single(self, test_db: Session, tenant: Tenant, setup_people_and_images):
        """Test getting a single person tag."""
        data = setup_people_and_images
        image = data["images"]["image1"]
        keyword = data["keywords"]["alice"]

        # Create tag
        tag = MachineTag(
            asset_id=image.asset_id,
            tenant_id=tenant.id,
            keyword_id=keyword.id,
            confidence=1.0,
            tag_type="manual_person",
            model_name="manual",
            model_version="1.0",
        )
        test_db.add(tag)
        test_db.commit()

        # Get tags
        tags = test_db.query(MachineTag).filter(
            MachineTag.asset_id == image.asset_id,
            MachineTag.tag_type == "manual_person"
        ).all()

        assert len(tags) == 1
        assert tags[0].keyword_id == keyword.id

    def test_get_people_tags_multiple(self, test_db: Session, tenant: Tenant, setup_people_and_images):
        """Test getting multiple people tags."""
        data = setup_people_and_images
        image = data["images"]["image1"]
        alice_keyword = data["keywords"]["alice"]
        bob_keyword = data["keywords"]["bob"]

        # Create both tags
        tag_alice = MachineTag(
            asset_id=image.asset_id,
            tenant_id=tenant.id,
            keyword_id=alice_keyword.id,
            confidence=1.0,
            tag_type="manual_person",
            model_name="manual",
            model_version="1.0",
        )
        tag_bob = MachineTag(
            asset_id=image.asset_id,
            tenant_id=tenant.id,
            keyword_id=bob_keyword.id,
            confidence=0.9,
            tag_type="manual_person",
            model_name="manual",
            model_version="1.0",
        )
        test_db.add(tag_alice)
        test_db.add(tag_bob)
        test_db.commit()

        # Get tags
        tags = test_db.query(MachineTag).filter(
            MachineTag.asset_id == image.asset_id,
            MachineTag.tag_type == "manual_person"
        ).all()

        assert len(tags) == 2


# ============================================================================
# Update Person Tag Confidence Tests
# ============================================================================

class TestUpdatePersonTagConfidence:
    """Tests for PUT /api/v1/images/{image_id}/people/{person_id} endpoint."""

    def test_update_tag_confidence_success(self, test_db: Session, tenant: Tenant, setup_people_and_images):
        """Test updating tag confidence score."""
        data = setup_people_and_images
        image = data["images"]["image1"]
        keyword = data["keywords"]["alice"]

        # Create tag
        tag = MachineTag(
            asset_id=image.asset_id,
            tenant_id=tenant.id,
            keyword_id=keyword.id,
            confidence=0.5,
            tag_type="manual_person",
            model_name="manual",
            model_version="1.0",
        )
        test_db.add(tag)
        test_db.commit()

        # Update confidence
        tag.confidence = 0.95
        test_db.commit()
        test_db.refresh(tag)

        assert tag.confidence == 0.95

    def test_update_tag_confidence_boundary_values(self, test_db: Session, tenant: Tenant, setup_people_and_images):
        """Test updating confidence with boundary values (0 and 1)."""
        data = setup_people_and_images
        image = data["images"]["image1"]
        keyword = data["keywords"]["alice"]

        # Create tag
        tag = MachineTag(
            asset_id=image.asset_id,
            tenant_id=tenant.id,
            keyword_id=keyword.id,
            confidence=0.5,
            tag_type="manual_person",
            model_name="manual",
            model_version="1.0",
        )
        test_db.add(tag)
        test_db.commit()

        # Update to 0
        tag.confidence = 0.0
        test_db.commit()
        test_db.refresh(tag)
        assert tag.confidence == 0.0

        # Update to 1
        tag.confidence = 1.0
        test_db.commit()
        test_db.refresh(tag)
        assert tag.confidence == 1.0

    def test_update_tag_confidence_multiple_tags(self, test_db: Session, tenant: Tenant, setup_people_and_images):
        """Test updating one tag doesn't affect others."""
        data = setup_people_and_images
        image = data["images"]["image1"]
        alice_keyword = data["keywords"]["alice"]
        bob_keyword = data["keywords"]["bob"]

        # Create both tags
        tag_alice = MachineTag(
            asset_id=image.asset_id,
            tenant_id=tenant.id,
            keyword_id=alice_keyword.id,
            confidence=0.5,
            tag_type="manual_person",
            model_name="manual",
            model_version="1.0",
        )
        tag_bob = MachineTag(
            asset_id=image.asset_id,
            tenant_id=tenant.id,
            keyword_id=bob_keyword.id,
            confidence=0.6,
            tag_type="manual_person",
            model_name="manual",
            model_version="1.0",
        )
        test_db.add(tag_alice)
        test_db.add(tag_bob)
        test_db.commit()

        # Update Alice tag
        tag_alice.confidence = 0.99
        test_db.commit()
        test_db.refresh(tag_alice)
        test_db.refresh(tag_bob)

        # Verify only Alice tag was updated
        assert tag_alice.confidence == 0.99
        assert tag_bob.confidence == 0.6
