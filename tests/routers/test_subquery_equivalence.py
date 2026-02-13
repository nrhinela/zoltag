"""Equivalence tests for subquery vs materialized filter approaches (Phase 2.2).

This module verifies that the non-materialized subquery implementations
produce identical results to the original materialized set implementations.

Tests ensure backward compatibility and correctness of the Phase 2.2
query performance optimization refactoring.
"""

import pytest
from sqlalchemy.orm import Session

from zoltag.metadata import ImageMetadata, MachineTag, Permatag
from zoltag.models.config import PhotoList, PhotoListItem, Keyword, KeywordCategory
from zoltag.routers.filtering import (
    # Old materialized functions
    apply_list_filter,
    apply_rating_filter,
    apply_hide_zero_rating_filter,
    apply_reviewed_filter,
    apply_permatag_filter,
    # New subquery functions
    apply_list_filter_subquery,
    apply_rating_filter_subquery,
    apply_hide_zero_rating_filter_subquery,
    apply_reviewed_filter_subquery,
    apply_permatag_filter_subquery,
    build_image_query_with_subqueries,
)
from zoltag.tenant import Tenant


@pytest.fixture
def sample_images(test_db: Session, test_tenant: Tenant):
    """Create sample images for equivalence testing."""
    tenant_id = test_tenant.id
    images = []

    for i in range(1, 11):  # 10 images
        img = ImageMetadata(
            id=i,
            tenant_id=tenant_id,
            dropbox_path=f"/test/image{i}.jpg",
            filename=f"image{i}.jpg",
            file_size=1024 * i,
            width=100 + i,
            height=100 + i,
            rating=i % 4,  # Ratings: 1,2,3,0,1,2,3,0,1,2
            format="JPEG"
        )
        test_db.add(img)
        images.append(img)

    test_db.commit()
    return images


@pytest.fixture
def sample_photo_list(test_db: Session, test_tenant: Tenant, sample_images):
    """Create a sample photo list with some images."""
    tenant_id = test_tenant.id

    photo_list = PhotoList(
        id=1,
        tenant_id=tenant_id,
        title="test-list",
        notebox="Test list"
    )
    test_db.add(photo_list)
    test_db.flush()

    # Add first 5 images to list
    for i in range(1, 6):
        item = PhotoListItem(
            list_id=photo_list.id,
            photo_id=sample_images[i - 1].id
        )
        test_db.add(item)

    test_db.commit()
    return photo_list


@pytest.fixture
def sample_keywords(test_db: Session, test_tenant: Tenant):
    """Create sample keywords and categories."""
    tenant_id = test_tenant.id

    # Create categories
    cat1 = KeywordCategory(tenant_id=tenant_id, name="landscape")
    cat2 = KeywordCategory(tenant_id=tenant_id, name="people")
    test_db.add(cat1)
    test_db.add(cat2)
    test_db.flush()

    # Create keywords
    kw1 = Keyword(tenant_id=tenant_id, keyword="mountain", category_id=cat1.id)
    kw2 = Keyword(tenant_id=tenant_id, keyword="forest", category_id=cat1.id)
    kw3 = Keyword(tenant_id=tenant_id, keyword="face", category_id=cat2.id)
    test_db.add_all([kw1, kw2, kw3])
    test_db.commit()

    return {"landscape": [kw1, kw2], "people": [kw3]}


@pytest.fixture
def sample_tags(test_db: Session, test_tenant: Tenant, sample_images, sample_keywords):
    """Create sample machine tags."""
    tenant_id = test_tenant.id

    # Tag first 5 images with "mountain"
    for i in range(0, 5):
        tag = MachineTag(
            image_id=sample_images[i].id,
            tenant_id=tenant_id,
            keyword_id=sample_keywords["landscape"][0].id,  # mountain
            confidence=0.8 + (i * 0.02),
            tag_type='siglip',
            model_name='siglip-base',
            model_version='1.0'
        )
        test_db.add(tag)

    # Tag images 3-7 with "forest"
    for i in range(2, 7):
        tag = MachineTag(
            image_id=sample_images[i].id,
            tenant_id=tenant_id,
            keyword_id=sample_keywords["landscape"][1].id,  # forest
            confidence=0.7 + (i * 0.02),
            tag_type='siglip',
            model_name='siglip-base',
            model_version='1.0'
        )
        test_db.add(tag)

    test_db.commit()


@pytest.fixture
def sample_permatags(test_db: Session, test_tenant: Tenant, sample_images, sample_keywords):
    """Create sample permatags (reviewed tags)."""
    tenant_id = test_tenant.id

    # Mark images 1, 3, 5 as reviewed
    for i in [0, 2, 4]:  # Indices for images 1, 3, 5
        tag = Permatag(
            image_id=sample_images[i].id,
            tenant_id=tenant_id,
            keyword_id=sample_keywords["landscape"][0].id,  # mountain
            signum=1
        )
        test_db.add(tag)

    test_db.commit()


class TestListFilterEquivalence:
    """Test list filter: materialized vs subquery."""

    def test_list_filter_equivalence(self, test_db: Session, test_tenant: Tenant, sample_photo_list):
        """Verify list filter subquery produces same IDs as materialized."""
        # Old way (materialized set)
        old_ids = apply_list_filter(test_db, test_tenant, sample_photo_list.id)

        # New way (subquery)
        new_subquery = apply_list_filter_subquery(test_db, test_tenant, sample_photo_list.id)
        new_ids = {row[0] for row in test_db.query(new_subquery.c.id).all()}

        # Should be identical
        assert old_ids == new_ids, f"Mismatch: old={old_ids}, new={new_ids}"
        assert len(old_ids) == 5, "Should have 5 images in list"


class TestRatingFilterEquivalence:
    """Test rating filter: materialized vs subquery."""

    @pytest.mark.parametrize("rating,operator", [
        (1, "eq"),   # Exactly 1
        (2, "gte"),  # >= 2
        (1, "gt"),   # > 1
    ])
    def test_rating_filter_equivalence(
        self, test_db: Session, test_tenant: Tenant,
        sample_images, rating, operator
    ):
        """Verify rating filter subquery produces same IDs as materialized."""
        # Old way (materialized set)
        old_ids = apply_rating_filter(test_db, test_tenant, rating, operator)

        # New way (subquery)
        new_subquery = apply_rating_filter_subquery(test_db, test_tenant, rating, operator)
        new_ids = {row[0] for row in test_db.query(new_subquery.c.id).all()}

        # Should be identical
        assert old_ids == new_ids, (
            f"Mismatch for rating={rating}, op={operator}: "
            f"old={sorted(old_ids)}, new={sorted(new_ids)}"
        )
        assert len(old_ids) > 0, "Should have matching images"


class TestHideZeroRatingEquivalence:
    """Test hide zero rating filter: materialized vs subquery."""

    def test_hide_zero_rating_equivalence(self, test_db: Session, test_tenant: Tenant, sample_images):
        """Verify hide zero rating subquery produces same IDs as materialized."""
        # Old way (materialized set)
        old_ids = apply_hide_zero_rating_filter(test_db, test_tenant)

        # New way (subquery)
        new_subquery = apply_hide_zero_rating_filter_subquery(test_db, test_tenant)
        new_ids = {row[0] for row in test_db.query(new_subquery.c.id).all()}

        # Should be identical
        assert old_ids == new_ids, f"Mismatch: old={old_ids}, new={new_ids}"
        # With 10 images and ratings 1,2,3,0,... we expect 8 non-zero
        assert len(old_ids) == 8, "Should have 8 images with non-zero rating"


class TestReviewedFilterEquivalence:
    """Test reviewed filter: materialized vs subquery."""

    @pytest.mark.parametrize("reviewed", [True, False])
    def test_reviewed_filter_equivalence(
        self, test_db: Session, test_tenant: Tenant,
        sample_images, sample_permatags, reviewed
    ):
        """Verify reviewed filter subquery produces same IDs as materialized."""
        # Old way (materialized set)
        old_ids = apply_reviewed_filter(test_db, test_tenant, reviewed)

        # New way (subquery)
        new_subquery = apply_reviewed_filter_subquery(test_db, test_tenant, reviewed)
        new_ids = {row[0] for row in test_db.query(new_subquery.c.id).all()}

        # Should be identical
        assert old_ids == new_ids, (
            f"Mismatch for reviewed={reviewed}: "
            f"old={sorted(old_ids)}, new={sorted(new_ids)}"
        )


class TestPermatagFilterEquivalence:
    """Test permatag filter: materialized vs subquery."""

    def test_permatag_filter_keyword_equivalence(
        self, test_db: Session, test_tenant: Tenant,
        sample_images, sample_keywords, sample_permatags
    ):
        """Verify permatag filter subquery produces same IDs as materialized."""
        keyword = "mountain"

        # Old way (materialized set)
        old_ids = apply_permatag_filter(
            test_db, test_tenant, keyword,
            signum=1, missing=False
        )

        # New way (subquery)
        new_subquery = apply_permatag_filter_subquery(
            test_db, test_tenant, keyword,
            signum=1, missing=False
        )
        new_ids = {row[0] for row in test_db.query(new_subquery.c.id).all()}

        # Should be identical
        assert old_ids == new_ids, (
            f"Mismatch for keyword={keyword}: "
            f"old={sorted(old_ids)}, new={sorted(new_ids)}"
        )
        assert len(old_ids) == 3, "Should have 3 images with mountain permatag"


class TestCombinedFiltersEquivalence:
    """Test combined filters using query builder."""

    def test_combined_filters_equivalence(
        self, test_db: Session, test_tenant: Tenant,
        sample_images, sample_photo_list, sample_tags, sample_permatags
    ):
        """Verify combined filters work correctly together."""
        # Build query with multiple filters
        base_query, subqueries_list, has_empty = build_image_query_with_subqueries(
            test_db,
            test_tenant,
            list_id=sample_photo_list.id,
            rating=1,
            rating_operator="gte",
            hide_zero_rating=True,
            reviewed=True,
            permatag_keyword=None,
        )

        # Apply all subqueries
        combined_query = base_query
        for subquery in subqueries_list:
            combined_query = combined_query.filter(ImageMetadata.id.in_(subquery))

        result_ids = {img.id for img in combined_query.all()}

        # Should have images that:
        # 1. Are in list (1-5)
        # 2. Have rating >= 1
        # 3. Are reviewed (1, 3, 5)
        # 4. Are not zero-rated
        # Result: images 1, 3, 5 (in list and reviewed and rating >= 1)
        expected = {1, 3, 5}
        assert result_ids == expected, (
            f"Combined filter mismatch: expected={expected}, got={result_ids}"
        )

    def test_empty_filter_detection(
        self, test_db: Session, test_tenant: Tenant, sample_images
    ):
        """Verify empty filter detection works."""
        # Create a list that doesn't exist
        base_query, subqueries_list, has_empty = build_image_query_with_subqueries(
            test_db,
            test_tenant,
            list_id=999,  # Non-existent list
        )

        # Should detect empty result
        assert has_empty is True, "Should detect non-existent list as empty"


class TestMemoryEfficiency:
    """Verify subqueries use less memory than materialized sets."""

    def test_subquery_not_materialized(self, test_db: Session, test_tenant: Tenant, sample_photo_list):
        """Verify subquery is not executed/materialized."""
        # Get subquery
        subquery = apply_list_filter_subquery(test_db, test_tenant, sample_photo_list.id)

        # Subquery should be a Selectable, not a list/set
        from sqlalchemy.sql import Selectable
        assert isinstance(subquery, Selectable), "Subquery should be Selectable type"

        # The key benefit: subquery can be embedded in other queries without
        # materializing intermediate results into Python memory
        query_with_subquery = (
            test_db.query(ImageMetadata)
            .filter(ImageMetadata.id.in_(subquery))
        )

        # This should execute as a single database query, not two sequential queries
        results = query_with_subquery.all()
        assert len(results) == 5, "Should retrieve 5 images from list"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
