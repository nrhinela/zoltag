"""Unit tests for QueryBuilder class."""

import uuid

import pytest
from sqlalchemy.orm import Session

from photocat.metadata import Asset, ImageMetadata, MachineTag
from photocat.models.config import Keyword, KeywordCategory
from photocat.routers.images.query_builder import QueryBuilder
from photocat.tenant import Tenant


def _create_asset_image(
    test_db: Session,
    *,
    tenant_id,
    image_id: int,
    filename: str,
    rating: int,
) -> ImageMetadata:
    asset = Asset(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        filename=filename,
        source_provider="test",
        source_key=f"/test/{filename}",
        thumbnail_key=f"thumbnails/{filename}",
    )
    test_db.add(asset)
    test_db.flush()

    image = ImageMetadata(
        id=image_id,
        asset_id=asset.id,
        tenant_id=tenant_id,
        filename=filename,
        file_size=1024 * image_id,
        width=100 + image_id,
        height=100 + image_id,
        rating=rating,
        format="JPEG",
    )
    test_db.add(image)
    test_db.flush()
    return image


@pytest.fixture
def sample_images(test_db: Session, test_tenant: Tenant):
    """Create 10 sample images with various ratings."""
    tenant_id = test_tenant.id
    images = []

    for i in range(1, 11):
        images.append(
            _create_asset_image(
                test_db,
                tenant_id=tenant_id,
                image_id=i,
                filename=f"image{i}.jpg",
                rating=i % 4,
            )
        )

    test_db.commit()
    return images


@pytest.fixture
def sample_keywords(test_db: Session, test_tenant: Tenant):
    tenant_id = test_tenant.id

    cat1 = KeywordCategory(tenant_id=tenant_id, name="landscape")
    test_db.add(cat1)
    test_db.flush()

    kw1 = Keyword(tenant_id=tenant_id, keyword="mountain", category_id=cat1.id)
    kw2 = Keyword(tenant_id=tenant_id, keyword="forest", category_id=cat1.id)
    test_db.add_all([kw1, kw2])
    test_db.commit()

    return {"mountain": kw1, "forest": kw2}


@pytest.fixture
def sample_tags(test_db: Session, test_tenant: Tenant, sample_images, sample_keywords):
    """Create sample machine tags on images."""
    tenant_id = test_tenant.id

    for i in range(0, 5):
        test_db.add(MachineTag(
            asset_id=sample_images[i].asset_id,
            tenant_id=tenant_id,
            keyword_id=sample_keywords["mountain"].id,
            confidence=0.8 + (i * 0.02),
            tag_type="siglip",
            model_name="siglip-base",
            model_version="1.0",
        ))

    test_db.commit()


class TestQueryBuilderInit:
    def test_init_defaults(self, test_db: Session, test_tenant: Tenant):
        builder = QueryBuilder(test_db, test_tenant)
        assert builder.db is test_db
        assert builder.tenant is test_tenant
        assert builder.date_order == "desc"
        assert builder.order_by is None

    def test_init_with_parameters(self, test_db: Session, test_tenant: Tenant):
        builder = QueryBuilder(test_db, test_tenant, "asc", "image_id")
        assert builder.date_order == "asc"
        assert builder.order_by == "image_id"

    def test_date_order_normalization(self, test_db: Session, test_tenant: Tenant):
        builder = QueryBuilder(test_db, test_tenant, "DESC", None)
        assert builder.date_order == "desc"

    def test_date_order_validation(self, test_db: Session, test_tenant: Tenant):
        builder = QueryBuilder(test_db, test_tenant, "invalid", None)
        assert builder.date_order == "desc"

    def test_order_by_normalization(self, test_db: Session, test_tenant: Tenant):
        builder = QueryBuilder(test_db, test_tenant, "desc", "IMAGE_ID")
        assert builder.order_by == "image_id"

    def test_order_by_validation(self, test_db: Session, test_tenant: Tenant):
        builder = QueryBuilder(test_db, test_tenant, "desc", "invalid_sort")
        assert builder.order_by is None


class TestApplySubqueries:
    def test_apply_single_subquery(self, test_db: Session, test_tenant: Tenant, sample_images):
        builder = QueryBuilder(test_db, test_tenant)

        rating_subquery = test_db.query(ImageMetadata.id).filter(
            ImageMetadata.tenant_id == test_tenant.id,
            ImageMetadata.rating > 1,
        ).subquery()

        query = test_db.query(ImageMetadata).filter(ImageMetadata.tenant_id == test_tenant.id)
        filtered_query = builder.apply_subqueries(query, [rating_subquery])

        result_ids = {img.id for img in filtered_query.all()}
        assert result_ids == {2, 3, 6, 7, 10}

    def test_apply_multiple_subqueries(self, test_db: Session, test_tenant: Tenant, sample_images):
        builder = QueryBuilder(test_db, test_tenant)

        subquery1 = test_db.query(ImageMetadata.id).filter(
            ImageMetadata.tenant_id == test_tenant.id,
            ImageMetadata.rating >= 2,
        ).subquery()
        subquery2 = test_db.query(ImageMetadata.id).filter(
            ImageMetadata.tenant_id == test_tenant.id,
            ImageMetadata.rating <= 2,
        ).subquery()

        query = test_db.query(ImageMetadata).filter(ImageMetadata.tenant_id == test_tenant.id)
        filtered_query = builder.apply_subqueries(query, [subquery1, subquery2])

        result_ids = {img.id for img in filtered_query.all()}
        assert result_ids == {2, 6, 10}

    def test_apply_empty_subqueries_list(self, test_db: Session, test_tenant: Tenant, sample_images):
        builder = QueryBuilder(test_db, test_tenant)
        query = test_db.query(ImageMetadata).filter(ImageMetadata.tenant_id == test_tenant.id)
        assert len(builder.apply_subqueries(query, []).all()) == 10


class TestBuildOrderClauses:
    def test_default_order_desc(self, test_db: Session, test_tenant: Tenant):
        builder = QueryBuilder(test_db, test_tenant, "desc", None)
        clauses = builder.build_order_clauses()

        assert len(clauses) == 2
        assert "image_metadata.id" in str(clauses[1])

    def test_default_order_asc(self, test_db: Session, test_tenant: Tenant):
        builder = QueryBuilder(test_db, test_tenant, "asc", None)
        assert len(builder.build_order_clauses()) == 2

    def test_image_id_order(self, test_db: Session, test_tenant: Tenant):
        builder = QueryBuilder(test_db, test_tenant, "desc", "image_id")
        assert len(builder.build_order_clauses()) == 1

    def test_photo_creation_order(self, test_db: Session, test_tenant: Tenant):
        builder = QueryBuilder(test_db, test_tenant, "desc", "photo_creation")
        assert len(builder.build_order_clauses()) == 2


class TestPagination:
    def test_apply_pagination_with_limit(self, test_db: Session, test_tenant: Tenant, sample_images):
        builder = QueryBuilder(test_db, test_tenant)
        query = test_db.query(ImageMetadata).filter(ImageMetadata.tenant_id == test_tenant.id).order_by(ImageMetadata.id)
        results = builder.apply_pagination(query, 0, 3)
        assert [img.id for img in results] == [1, 2, 3]

    def test_apply_pagination_with_offset(self, test_db: Session, test_tenant: Tenant, sample_images):
        builder = QueryBuilder(test_db, test_tenant)
        query = test_db.query(ImageMetadata).filter(ImageMetadata.tenant_id == test_tenant.id).order_by(ImageMetadata.id)
        results = builder.apply_pagination(query, 5, 3)
        assert [img.id for img in results] == [6, 7, 8]

    def test_apply_pagination_no_limit(self, test_db: Session, test_tenant: Tenant, sample_images):
        builder = QueryBuilder(test_db, test_tenant)
        query = test_db.query(ImageMetadata).filter(ImageMetadata.tenant_id == test_tenant.id).order_by(ImageMetadata.id)
        results = builder.apply_pagination(query, 8, None)
        assert [img.id for img in results] == [9, 10]

    def test_paginate_id_list(self, test_db: Session, test_tenant: Tenant):
        builder = QueryBuilder(test_db, test_tenant)
        image_ids = list(range(1, 11))
        assert builder.paginate_id_list(image_ids, 2, 3) == [3, 4, 5]
        assert builder.paginate_id_list(image_ids, 7, None) == [8, 9, 10]
        assert builder.paginate_id_list(image_ids, 10, 5) == []


class TestGetTotalCount:
    def test_count_from_query(self, test_db: Session, test_tenant: Tenant, sample_images):
        builder = QueryBuilder(test_db, test_tenant)
        query = test_db.query(ImageMetadata).filter(
            ImageMetadata.tenant_id == test_tenant.id,
            ImageMetadata.rating > 0,
        )
        assert builder.get_total_count(query) == 8

    def test_count_from_list(self, test_db: Session, test_tenant: Tenant):
        builder = QueryBuilder(test_db, test_tenant)
        assert builder.get_total_count([1, 2, 3, 5, 7, 9]) == 6


class TestApplyFiltersToIdSet:
    def test_filter_materialized_ids(self, test_db: Session, test_tenant: Tenant, sample_images):
        builder = QueryBuilder(test_db, test_tenant)
        image_ids = [1, 2, 3, 4, 5, 6, 7, 8]

        rating_subquery = test_db.query(ImageMetadata.id).filter(
            ImageMetadata.tenant_id == test_tenant.id,
            ImageMetadata.rating > 1,
        ).subquery()

        filtered_ids = builder.apply_filters_to_id_set(image_ids, [rating_subquery])
        assert sorted(filtered_ids) == [2, 3, 6, 7]


class TestIntegration:
    def test_full_query_pipeline(self, test_db: Session, test_tenant: Tenant, sample_images):
        builder = QueryBuilder(test_db, test_tenant, "asc", "photo_creation")

        query = test_db.query(ImageMetadata).filter(ImageMetadata.tenant_id == test_tenant.id)

        rating_subquery = test_db.query(ImageMetadata.id).filter(
            ImageMetadata.tenant_id == test_tenant.id,
            ImageMetadata.rating >= 2,
        ).subquery()

        query = builder.apply_subqueries(query, [rating_subquery])
        assert builder.get_total_count(query) == 5

        order_clauses = builder.build_order_clauses()
        query = query.order_by(*order_clauses)

        results = builder.apply_pagination(query, 0, 2)
        assert len(results) == 2
