"""Unit tests for QueryBuilder class.

Tests verify that QueryBuilder methods correctly encapsulate query construction patterns
and produce equivalent results to the original inline code.
"""

import pytest
from sqlalchemy.orm import Session
from sqlalchemy import func

from zoltag.metadata import ImageMetadata, MachineTag, Permatag
from zoltag.models.config import Keyword, KeywordCategory
from zoltag.routers.images.query_builder import QueryBuilder
from zoltag.tenant import Tenant


@pytest.fixture
def sample_images(test_db: Session, test_tenant: Tenant):
    """Create 10 sample images with various ratings."""
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
def sample_keywords(test_db: Session, test_tenant: Tenant):
    """Create sample keywords for testing."""
    tenant_id = test_tenant.id

    # Create categories
    cat1 = KeywordCategory(tenant_id=tenant_id, name="landscape")
    test_db.add(cat1)
    test_db.flush()

    # Create keywords
    kw1 = Keyword(tenant_id=tenant_id, keyword="mountain", category_id=cat1.id)
    kw2 = Keyword(tenant_id=tenant_id, keyword="forest", category_id=cat1.id)
    test_db.add_all([kw1, kw2])
    test_db.commit()

    return {"mountain": kw1, "forest": kw2}


@pytest.fixture
def sample_tags(test_db: Session, test_tenant: Tenant, sample_images, sample_keywords):
    """Create sample machine tags on images."""
    tenant_id = test_tenant.id

    # Tag first 5 images with "mountain"
    for i in range(0, 5):
        tag = MachineTag(
            image_id=sample_images[i].id,
            tenant_id=tenant_id,
            keyword_id=sample_keywords["mountain"].id,
            confidence=0.8 + (i * 0.02),
            tag_type='siglip',
            model_name='siglip-base',
            model_version='1.0'
        )
        test_db.add(tag)

    test_db.commit()


class TestQueryBuilderInit:
    """Test QueryBuilder initialization and parameter validation."""

    def test_init_defaults(self, test_db: Session, test_tenant: Tenant):
        """Verify default initialization."""
        builder = QueryBuilder(test_db, test_tenant)
        assert builder.db is test_db
        assert builder.tenant is test_tenant
        assert builder.date_order == "desc"
        assert builder.order_by is None

    def test_init_with_parameters(self, test_db: Session, test_tenant: Tenant):
        """Verify initialization with custom parameters."""
        builder = QueryBuilder(test_db, test_tenant, "asc", "image_id")
        assert builder.date_order == "asc"
        assert builder.order_by == "image_id"

    def test_date_order_normalization(self, test_db: Session, test_tenant: Tenant):
        """Verify date_order is normalized to lowercase."""
        builder = QueryBuilder(test_db, test_tenant, "DESC", None)
        assert builder.date_order == "desc"

    def test_date_order_validation(self, test_db: Session, test_tenant: Tenant):
        """Verify invalid date_order defaults to 'desc'."""
        builder = QueryBuilder(test_db, test_tenant, "invalid", None)
        assert builder.date_order == "desc"

    def test_order_by_normalization(self, test_db: Session, test_tenant: Tenant):
        """Verify order_by is normalized to lowercase."""
        builder = QueryBuilder(test_db, test_tenant, "desc", "IMAGE_ID")
        assert builder.order_by == "image_id"

    def test_order_by_validation(self, test_db: Session, test_tenant: Tenant):
        """Verify invalid order_by is set to None."""
        builder = QueryBuilder(test_db, test_tenant, "desc", "invalid_sort")
        assert builder.order_by is None


class TestApplySubqueries:
    """Test apply_subqueries method."""

    def test_apply_single_subquery(
        self, test_db: Session, test_tenant: Tenant, sample_images
    ):
        """Verify single subquery application."""
        builder = QueryBuilder(test_db, test_tenant)

        # Create subquery for images with rating > 1
        rating_subquery = test_db.query(ImageMetadata.id).filter(
            ImageMetadata.tenant_id == test_tenant.id,
            ImageMetadata.rating > 1
        ).subquery()

        # Start with all images query
        query = test_db.query(ImageMetadata).filter(
            ImageMetadata.tenant_id == test_tenant.id
        )

        # Apply subquery
        filtered_query = builder.apply_subqueries(query, [rating_subquery])

        # Should return images with rating > 1
        results = filtered_query.all()
        result_ids = {img.id for img in results}

        # Verify: images with rating > 1 are 2,3,5,6,8,9 (ratings: 2,3,2,3,2,3)
        expected = {2, 3, 5, 6, 8, 9}
        assert result_ids == expected

    def test_apply_multiple_subqueries(
        self, test_db: Session, test_tenant: Tenant, sample_images
    ):
        """Verify multiple subqueries are combined with AND (intersection)."""
        builder = QueryBuilder(test_db, test_tenant)

        # Subquery 1: images with rating >= 2
        subquery1 = test_db.query(ImageMetadata.id).filter(
            ImageMetadata.tenant_id == test_tenant.id,
            ImageMetadata.rating >= 2
        ).subquery()

        # Subquery 2: images with rating <= 2
        subquery2 = test_db.query(ImageMetadata.id).filter(
            ImageMetadata.tenant_id == test_tenant.id,
            ImageMetadata.rating <= 2
        ).subquery()

        query = test_db.query(ImageMetadata).filter(
            ImageMetadata.tenant_id == test_tenant.id
        )

        # Apply both subqueries
        filtered_query = builder.apply_subqueries(query, [subquery1, subquery2])
        results = filtered_query.all()
        result_ids = {img.id for img in results}

        # Should return images with rating == 2 (only)
        expected = {2, 6}  # rating = 2: images 2, 6
        assert result_ids == expected

    def test_apply_empty_subqueries_list(
        self, test_db: Session, test_tenant: Tenant, sample_images
    ):
        """Verify empty subqueries list doesn't modify query."""
        builder = QueryBuilder(test_db, test_tenant)

        query = test_db.query(ImageMetadata).filter(
            ImageMetadata.tenant_id == test_tenant.id
        )

        # Apply empty list
        filtered_query = builder.apply_subqueries(query, [])

        # Should return all tenant images
        results = filtered_query.all()
        assert len(results) == 10


class TestBuildOrderClauses:
    """Test build_order_clauses method."""

    def test_default_order_desc(self, test_db: Session, test_tenant: Tenant):
        """Verify default ordering (date DESC, id DESC)."""
        builder = QueryBuilder(test_db, test_tenant, "desc", None)
        clauses = builder.build_order_clauses()

        # Should return 2-tuple: (date, id)
        assert len(clauses) == 2
        # First clause involves capture_timestamp/modified_time
        # Second clause involves id
        assert str(clauses[1]).count("image_metadata_1.id") > 0

    def test_default_order_asc(self, test_db: Session, test_tenant: Tenant):
        """Verify ascending order (date ASC, id ASC)."""
        builder = QueryBuilder(test_db, test_tenant, "asc", None)
        clauses = builder.build_order_clauses()

        assert len(clauses) == 2

    def test_image_id_order(self, test_db: Session, test_tenant: Tenant):
        """Verify image_id ordering returns only id clause."""
        builder = QueryBuilder(test_db, test_tenant, "desc", "image_id")
        clauses = builder.build_order_clauses()

        # Should return 1-tuple with only id
        assert len(clauses) == 1

    def test_photo_creation_order(self, test_db: Session, test_tenant: Tenant):
        """Verify photo_creation ordering (default)."""
        builder = QueryBuilder(test_db, test_tenant, "desc", "photo_creation")
        clauses = builder.build_order_clauses()

        # Should return 2-tuple
        assert len(clauses) == 2


class TestPagination:
    """Test pagination methods."""

    def test_apply_pagination_with_limit(self, test_db: Session, test_tenant: Tenant, sample_images):
        """Verify SQL pagination with limit and offset."""
        builder = QueryBuilder(test_db, test_tenant)

        query = test_db.query(ImageMetadata).filter(
            ImageMetadata.tenant_id == test_tenant.id
        ).order_by(ImageMetadata.id)

        # Get first 3 images
        results = builder.apply_pagination(query, 0, 3)

        assert len(results) == 3
        assert [img.id for img in results] == [1, 2, 3]

    def test_apply_pagination_with_offset(self, test_db: Session, test_tenant: Tenant, sample_images):
        """Verify SQL pagination with offset."""
        builder = QueryBuilder(test_db, test_tenant)

        query = test_db.query(ImageMetadata).filter(
            ImageMetadata.tenant_id == test_tenant.id
        ).order_by(ImageMetadata.id)

        # Skip first 5, get next 3
        results = builder.apply_pagination(query, 5, 3)

        assert len(results) == 3
        assert [img.id for img in results] == [6, 7, 8]

    def test_apply_pagination_no_limit(self, test_db: Session, test_tenant: Tenant, sample_images):
        """Verify SQL pagination without limit returns all after offset."""
        builder = QueryBuilder(test_db, test_tenant)

        query = test_db.query(ImageMetadata).filter(
            ImageMetadata.tenant_id == test_tenant.id
        ).order_by(ImageMetadata.id)

        # Skip first 8, get all remaining
        results = builder.apply_pagination(query, 8, None)

        assert len(results) == 2
        assert [img.id for img in results] == [9, 10]

    def test_paginate_id_list(self, test_db: Session, test_tenant: Tenant):
        """Verify Python list pagination."""
        builder = QueryBuilder(test_db, test_tenant)

        image_ids = list(range(1, 11))  # [1,2,3,...,10]

        # Test with limit
        result = builder.paginate_id_list(image_ids, 2, 3)
        assert result == [3, 4, 5]

        # Test without limit
        result = builder.paginate_id_list(image_ids, 7, None)
        assert result == [8, 9, 10]

        # Test offset beyond list
        result = builder.paginate_id_list(image_ids, 10, 5)
        assert result == []


class TestGetTotalCount:
    """Test get_total_count method."""

    def test_count_from_query(self, test_db: Session, test_tenant: Tenant, sample_images):
        """Verify count from SQLAlchemy query."""
        builder = QueryBuilder(test_db, test_tenant)

        query = test_db.query(ImageMetadata).filter(
            ImageMetadata.tenant_id == test_tenant.id,
            ImageMetadata.rating > 0
        )

        count = builder.get_total_count(query)
        assert count == 8  # Images with rating 1,2,3,1,2,3,1,2

    def test_count_from_list(self, test_db: Session, test_tenant: Tenant):
        """Verify count from Python list."""
        builder = QueryBuilder(test_db, test_tenant)

        image_ids = [1, 2, 3, 5, 7, 9]
        count = builder.get_total_count(image_ids)
        assert count == 6


class TestApplyFiltersToIdSet:
    """Test apply_filters_to_id_set method (Path 1 special case)."""

    def test_filter_materialized_ids(
        self, test_db: Session, test_tenant: Tenant, sample_images
    ):
        """Verify filtering of materialized ID set with subqueries."""
        builder = QueryBuilder(test_db, test_tenant)

        # Start with images 1-8
        image_ids = [1, 2, 3, 4, 5, 6, 7, 8]

        # Create subquery for images with rating > 1
        rating_subquery = test_db.query(ImageMetadata.id).filter(
            ImageMetadata.tenant_id == test_tenant.id,
            ImageMetadata.rating > 1
        ).subquery()

        # Apply filter
        filtered_ids = builder.apply_filters_to_id_set(image_ids, [rating_subquery])

        # Should return only images from input list with rating > 1
        # From input list: [1,2,3,4,5,6,7,8]
        # Ratings: [1,2,3,0,1,2,3,0]
        # With rating > 1: [2,3,6,7]
        assert sorted(filtered_ids) == [2, 3, 6, 7]


class TestIntegration:
    """Integration tests combining multiple QueryBuilder methods."""

    def test_full_query_pipeline(
        self, test_db: Session, test_tenant: Tenant, sample_images
    ):
        """Test complete query pipeline with multiple operations."""
        builder = QueryBuilder(test_db, test_tenant, "asc", "photo_creation")

        # Start with all tenant images
        query = test_db.query(ImageMetadata).filter(
            ImageMetadata.tenant_id == test_tenant.id
        )

        # Apply rating filter subquery
        rating_subquery = test_db.query(ImageMetadata.id).filter(
            ImageMetadata.tenant_id == test_tenant.id,
            ImageMetadata.rating >= 2
        ).subquery()

        query = builder.apply_subqueries(query, [rating_subquery])

        # Count total matching
        total = builder.get_total_count(query)
        assert total == 5  # Images with rating >= 2

        # Build order clauses
        order_clauses = builder.build_order_clauses()
        query = query.order_by(*order_clauses)

        # Apply pagination
        results = builder.apply_pagination(query, 0, 2)
        assert len(results) == 2
