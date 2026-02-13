"""Tests for filtering utilities in routers.filtering module."""

import pytest
import json
from sqlalchemy.orm import Session

from zoltag.metadata import ImageMetadata, MachineTag, Permatag
from zoltag.models.config import PhotoList, PhotoListItem
from zoltag.routers.filtering import (
    apply_list_filter,
    apply_rating_filter,
    apply_hide_zero_rating_filter,
    apply_reviewed_filter,
    compute_current_tags_for_images,
    apply_category_filters,
    calculate_relevance_scores
)
from zoltag.tenant import Tenant


@pytest.fixture
def sample_images(test_db: Session, test_tenant: Tenant):
    """Create sample images for testing."""
    tenant_id = test_tenant.id

    # Create 5 test images with various ratings
    images = []
    for i in range(1, 6):
        img = ImageMetadata(
            id=i,
            tenant_id=tenant_id,
            dropbox_path=f"/test/image{i}.jpg",
            filename=f"image{i}.jpg",
            file_size=1024,
            width=100,
            height=100,
            rating=i % 4  # Ratings: 1, 2, 3, 0, 1
        )
        test_db.add(img)
        images.append(img)

    test_db.commit()
    return images


@pytest.fixture
def sample_photo_list(test_db: Session, test_tenant: Tenant, sample_images):
    """Create a sample photo list."""
    tenant_id = test_tenant.id

    # Create a photo list
    photo_list = PhotoList(
        tenant_id=tenant_id,
        title="Test List",
        notebox="Test description"
    )
    test_db.add(photo_list)
    test_db.commit()

    # Add items 1, 2, 3 to the list
    for image_id in [1, 2, 3]:
        item = PhotoListItem(
            list_id=photo_list.id,
            photo_id=image_id
        )
        test_db.add(item)

    test_db.commit()
    return photo_list


@pytest.fixture
def sample_tags(test_db: Session, test_tenant: Tenant, sample_images):
    """Create sample machine tags."""
    tenant_id = test_tenant.id

    # Image 1: dog, outdoor
    tags = [
        MachineTag(
            image_id=1,
            tenant_id=tenant_id,
            keyword="dog",
            category="animals",
            confidence=0.95,
            tag_type="siglip",
            model_name="siglip-test",
            model_version="1.0"
        ),
        MachineTag(
            image_id=1,
            tenant_id=tenant_id,
            keyword="outdoor",
            category="setting",
            confidence=0.87,
            tag_type="siglip",
            model_name="siglip-test",
            model_version="1.0"
        ),
        # Image 2: cat, indoor
        MachineTag(
            image_id=2,
            tenant_id=tenant_id,
            keyword="cat",
            category="animals",
            confidence=0.92,
            tag_type="siglip",
            model_name="siglip-test",
            model_version="1.0"
        ),
        MachineTag(
            image_id=2,
            tenant_id=tenant_id,
            keyword="indoor",
            category="setting",
            confidence=0.88,
            tag_type="siglip",
            model_name="siglip-test",
            model_version="1.0"
        ),
        # Image 3: bird, outdoor
        MachineTag(
            image_id=3,
            tenant_id=tenant_id,
            keyword="bird",
            category="animals",
            confidence=0.89,
            tag_type="siglip",
            model_name="siglip-test",
            model_version="1.0"
        ),
        MachineTag(
            image_id=3,
            tenant_id=tenant_id,
            keyword="outdoor",
            category="setting",
            confidence=0.85,
            tag_type="siglip",
            model_name="siglip-test",
            model_version="1.0"
        ),
    ]

    for tag in tags:
        test_db.add(tag)

    test_db.commit()
    return tags


@pytest.fixture
def sample_permatags(test_db: Session, test_tenant: Tenant):
    """Create sample permatags."""
    tenant_id = test_tenant.id

    # Image 1: positive permatag for "happy", negative for "outdoor"
    permatags = [
        Permatag(
            image_id=1,
            tenant_id=tenant_id,
            keyword="happy",
            category="emotion",
            signum=1
        ),
        Permatag(
            image_id=1,
            tenant_id=tenant_id,
            keyword="outdoor",
            category="setting",
            signum=-1  # Negates the machine tag
        ),
        # Image 2: positive permatag for "cozy"
        Permatag(
            image_id=2,
            tenant_id=tenant_id,
            keyword="cozy",
            category="atmosphere",
            signum=1
        ),
    ]

    for pt in permatags:
        test_db.add(pt)

    test_db.commit()
    return permatags


class TestListFilter:
    """Test apply_list_filter function."""

    def test_list_filter_basic(self, test_db: Session, test_tenant: Tenant,
                               sample_images, sample_photo_list):
        """Test basic list filtering."""
        result = apply_list_filter(test_db, test_tenant, sample_photo_list.id)

        assert result == {1, 2, 3}
        assert len(result) == 3

    def test_list_filter_nonexistent(self, test_db: Session, test_tenant: Tenant,
                                    sample_images):
        """Test filtering with non-existent list raises HTTPException."""
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            apply_list_filter(test_db, test_tenant, 99999)

        assert exc_info.value.status_code == 404
        assert "List not found" == exc_info.value.detail


class TestRatingFilter:
    """Test apply_rating_filter function."""

    def test_rating_filter_eq(self, test_db: Session, test_tenant: Tenant, sample_images):
        """Test rating filter with equality operator."""
        result = apply_rating_filter(test_db, test_tenant, 1, "eq")

        # Images 1 and 5 have rating=1
        assert result == {1, 5}

    def test_rating_filter_gte(self, test_db: Session, test_tenant: Tenant, sample_images):
        """Test rating filter with greater-than-or-equal operator."""
        result = apply_rating_filter(test_db, test_tenant, 2, "gte")

        # Images 2 (rating=2) and 3 (rating=3)
        assert result == {2, 3}

    def test_rating_filter_gt(self, test_db: Session, test_tenant: Tenant, sample_images):
        """Test rating filter with greater-than operator."""
        result = apply_rating_filter(test_db, test_tenant, 1, "gt")

        # Images 2 (rating=2) and 3 (rating=3)
        assert result == {2, 3}

    def test_rating_filter_with_existing(self, test_db: Session, test_tenant: Tenant,
                                        sample_images):
        """Test rating filter with existing filter set."""
        existing = {1, 2, 3}
        result = apply_rating_filter(test_db, test_tenant, 2, "gte", existing)

        # Only image 2 and 3 from existing set have rating >= 2
        assert result == {2, 3}


class TestHideZeroRatingFilter:
    """Test apply_hide_zero_rating_filter function."""

    def test_hide_zero_rating_no_existing(self, test_db: Session, test_tenant: Tenant,
                                          sample_images):
        """Test hiding zero-rated images without existing filter."""
        result = apply_hide_zero_rating_filter(test_db, test_tenant)

        # Image 4 has rating=0, should be excluded
        assert 4 not in result
        assert {1, 2, 3, 5}.issubset(result)

    def test_hide_zero_rating_with_existing(self, test_db: Session, test_tenant: Tenant,
                                           sample_images):
        """Test hiding zero-rated images with existing filter."""
        existing = {2, 3, 4}
        result = apply_hide_zero_rating_filter(test_db, test_tenant, existing)

        # Image 4 has rating=0, should be excluded
        assert result == {2, 3}


class TestReviewedFilter:
    """Test apply_reviewed_filter function."""

    def test_reviewed_true(self, test_db: Session, test_tenant: Tenant,
                          sample_images, sample_permatags):
        """Test filtering for reviewed images."""
        result = apply_reviewed_filter(test_db, test_tenant, True)

        # Images 1 and 2 have permatags
        assert result == {1, 2}

    def test_reviewed_false(self, test_db: Session, test_tenant: Tenant,
                           sample_images, sample_permatags):
        """Test filtering for unreviewed images."""
        result = apply_reviewed_filter(test_db, test_tenant, False)

        # Images 3, 4, 5 have no permatags
        assert result == {3, 4, 5}

    def test_reviewed_with_existing(self, test_db: Session, test_tenant: Tenant,
                                   sample_images, sample_permatags):
        """Test reviewed filter with existing filter set."""
        existing = {1, 3, 4}
        result = apply_reviewed_filter(test_db, test_tenant, True, existing)

        # Only image 1 from existing set has permatags
        assert result == {1}


class TestComputeCurrentTags:
    """Test compute_current_tags_for_images function."""

    def test_compute_tags_machine_only(self, test_db: Session, test_tenant: Tenant,
                                       sample_images, sample_tags):
        """Test computing tags with only machine tags."""
        result = compute_current_tags_for_images(test_db, test_tenant, [1, 2, 3], "siglip")

        assert result[1] == ["dog", "outdoor"]
        assert result[2] == ["cat", "indoor"]
        assert result[3] == ["bird", "outdoor"]

    def test_compute_tags_with_permatags(self, test_db: Session, test_tenant: Tenant,
                                        sample_images, sample_tags, sample_permatags):
        """Test computing tags with machine tags and permatags."""
        result = compute_current_tags_for_images(test_db, test_tenant, [1, 2], "siglip")

        # Image 1: "dog" (machine), "happy" (positive permatag), "outdoor" excluded (negative permatag)
        assert "dog" in result[1]
        assert "happy" in result[1]
        assert "outdoor" not in result[1]

        # Image 2: "cat", "indoor" (machine), "cozy" (positive permatag)
        assert "cat" in result[2]
        assert "indoor" in result[2]
        assert "cozy" in result[2]

    def test_compute_tags_no_tags(self, test_db: Session, test_tenant: Tenant,
                                 sample_images):
        """Test computing tags for images with no tags."""
        result = compute_current_tags_for_images(test_db, test_tenant, [4, 5], "siglip")

        assert result[4] == []
        assert result[5] == []


class TestCategoryFilters:
    """Test apply_category_filters function."""

    def test_category_filters_or(self, test_db: Session, test_tenant: Tenant,
                                sample_images, sample_tags):
        """Test category filters with OR operator."""
        filters_json = json.dumps({
            "animals": {
                "keywords": ["dog", "cat"],
                "operator": "OR"
            }
        })

        result = apply_category_filters(test_db, test_tenant, filters_json)

        # Images 1 (dog) and 2 (cat) match
        assert result == {1, 2}

    def test_category_filters_and(self, test_db: Session, test_tenant: Tenant,
                                 sample_images, sample_tags):
        """Test category filters with AND operator."""
        filters_json = json.dumps({
            "animals": {
                "keywords": ["bird", "outdoor"],
                "operator": "AND"
            }
        })

        result = apply_category_filters(test_db, test_tenant, filters_json)

        # Only image 3 has both "bird" and "outdoor"
        assert result == {3}

    def test_category_filters_with_existing(self, test_db: Session, test_tenant: Tenant,
                                           sample_images, sample_tags):
        """Test category filters with existing filter set."""
        filters_json = json.dumps({
            "animals": {
                "keywords": ["dog", "cat", "bird"],
                "operator": "OR"
            }
        })

        existing = {1, 3}  # Exclude image 2
        result = apply_category_filters(test_db, test_tenant, filters_json, existing)

        # Only images 1 and 3 from existing set
        assert result == {1, 3}

    def test_category_filters_invalid_json(self, test_db: Session, test_tenant: Tenant,
                                          sample_images):
        """Test category filters with invalid JSON."""
        existing = {1, 2, 3}
        result = apply_category_filters(test_db, test_tenant, "invalid json", existing)

        # Should return existing filter unchanged
        assert result == existing

    def test_category_filters_no_matches(self, test_db: Session, test_tenant: Tenant,
                                        sample_images, sample_tags):
        """Test category filters with no matching images."""
        filters_json = json.dumps({
            "animals": {
                "keywords": ["elephant"],
                "operator": "OR"
            }
        })

        result = apply_category_filters(test_db, test_tenant, filters_json)

        # No images match
        assert result == set()


class TestRelevanceScores:
    """Test calculate_relevance_scores function."""

    def test_relevance_scores_basic(self, test_db: Session, test_tenant: Tenant,
                                    sample_images, sample_tags):
        """Test calculating relevance scores."""
        result = calculate_relevance_scores(
            test_db, test_tenant, [1, 2, 3], ["dog", "cat", "outdoor"], "siglip"
        )

        # Image 1: dog (0.95) + outdoor (0.87) = 1.82
        # Image 2: cat (0.92) = 0.92
        # Image 3: outdoor (0.85) = 0.85
        assert 1 in result
        assert 2 in result
        assert 3 in result
        assert result[1] > result[2] > result[3]

    def test_relevance_scores_no_matches(self, test_db: Session, test_tenant: Tenant,
                                        sample_images, sample_tags):
        """Test calculating relevance scores with no matching keywords."""
        result = calculate_relevance_scores(
            test_db, test_tenant, [1, 2, 3], ["elephant"], "siglip"
        )

        # No matches
        assert result == {}

    def test_relevance_scores_subset(self, test_db: Session, test_tenant: Tenant,
                                    sample_images, sample_tags):
        """Test calculating relevance scores for subset of images."""
        result = calculate_relevance_scores(
            test_db, test_tenant, [1], ["dog", "outdoor"], "siglip"
        )

        # Only image 1 in result
        assert len(result) == 1
        assert 1 in result
