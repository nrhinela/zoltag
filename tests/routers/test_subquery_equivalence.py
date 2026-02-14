"""Equivalence tests for subquery vs materialized filter approaches."""

import uuid

import pytest
from sqlalchemy.orm import Session

from photocat.metadata import Asset, ImageMetadata, MachineTag, Permatag
from photocat.models.config import Keyword, KeywordCategory, PhotoList, PhotoListItem
from photocat.routers.filtering import (
    apply_hide_zero_rating_filter,
    apply_hide_zero_rating_filter_subquery,
    apply_list_filter,
    apply_list_filter_subquery,
    apply_permatag_filter,
    apply_permatag_filter_subquery,
    apply_rating_filter,
    apply_rating_filter_subquery,
    apply_reviewed_filter,
    apply_reviewed_filter_subquery,
    build_image_query_with_subqueries,
)
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
def sample_photo_list(test_db: Session, test_tenant: Tenant, sample_images):
    tenant_id = test_tenant.id

    photo_list = PhotoList(
        id=1,
        tenant_id=tenant_id,
        title="test-list",
        notebox="Test list",
    )
    test_db.add(photo_list)
    test_db.flush()

    for image in sample_images[:5]:
        test_db.add(PhotoListItem(list_id=photo_list.id, asset_id=image.asset_id))

    test_db.commit()
    return photo_list


@pytest.fixture
def sample_keywords(test_db: Session, test_tenant: Tenant):
    tenant_id = test_tenant.id

    cat1 = KeywordCategory(tenant_id=tenant_id, name="landscape")
    cat2 = KeywordCategory(tenant_id=tenant_id, name="people")
    test_db.add(cat1)
    test_db.add(cat2)
    test_db.flush()

    kw1 = Keyword(tenant_id=tenant_id, keyword="mountain", category_id=cat1.id)
    kw2 = Keyword(tenant_id=tenant_id, keyword="forest", category_id=cat1.id)
    kw3 = Keyword(tenant_id=tenant_id, keyword="face", category_id=cat2.id)
    test_db.add_all([kw1, kw2, kw3])
    test_db.commit()

    return {"landscape": [kw1, kw2], "people": [kw3]}


@pytest.fixture
def sample_tags(test_db: Session, test_tenant: Tenant, sample_images, sample_keywords):
    tenant_id = test_tenant.id

    for i in range(0, 5):
        test_db.add(MachineTag(
            asset_id=sample_images[i].asset_id,
            tenant_id=tenant_id,
            keyword_id=sample_keywords["landscape"][0].id,
            confidence=0.8 + (i * 0.02),
            tag_type="siglip",
            model_name="siglip-base",
            model_version="1.0",
        ))

    for i in range(2, 7):
        test_db.add(MachineTag(
            asset_id=sample_images[i].asset_id,
            tenant_id=tenant_id,
            keyword_id=sample_keywords["landscape"][1].id,
            confidence=0.7 + (i * 0.02),
            tag_type="siglip",
            model_name="siglip-base",
            model_version="1.0",
        ))

    test_db.commit()


@pytest.fixture
def sample_permatags(test_db: Session, test_tenant: Tenant, sample_images, sample_keywords):
    tenant_id = test_tenant.id

    for i in [0, 2, 4]:
        test_db.add(Permatag(
            asset_id=sample_images[i].asset_id,
            tenant_id=tenant_id,
            keyword_id=sample_keywords["landscape"][0].id,
            signum=1,
        ))

    test_db.commit()


class TestListFilterEquivalence:
    def test_list_filter_equivalence(self, test_db: Session, test_tenant: Tenant, sample_photo_list):
        old_ids = apply_list_filter(test_db, test_tenant, sample_photo_list.id)

        new_subquery = apply_list_filter_subquery(test_db, test_tenant, sample_photo_list.id)
        new_ids = {row[0] for row in test_db.query(new_subquery.c.id).all()}

        assert old_ids == new_ids
        assert len(old_ids) == 5


class TestRatingFilterEquivalence:
    @pytest.mark.parametrize("rating,operator", [(1, "eq"), (2, "gte"), (1, "gt")])
    def test_rating_filter_equivalence(self, test_db: Session, test_tenant: Tenant, sample_images, rating, operator):
        old_ids = apply_rating_filter(test_db, test_tenant, rating, operator)

        new_subquery = apply_rating_filter_subquery(test_db, test_tenant, rating, operator)
        new_ids = {row[0] for row in test_db.query(new_subquery.c.id).all()}

        assert old_ids == new_ids
        assert len(old_ids) > 0


class TestHideZeroRatingEquivalence:
    def test_hide_zero_rating_equivalence(self, test_db: Session, test_tenant: Tenant, sample_images):
        old_ids = apply_hide_zero_rating_filter(test_db, test_tenant)

        new_subquery = apply_hide_zero_rating_filter_subquery(test_db, test_tenant)
        new_ids = {row[0] for row in test_db.query(new_subquery.c.id).all()}

        assert old_ids == new_ids
        assert len(old_ids) == 8


class TestReviewedFilterEquivalence:
    @pytest.mark.parametrize("reviewed", [True, False])
    def test_reviewed_filter_equivalence(self, test_db: Session, test_tenant: Tenant, sample_images, sample_permatags, reviewed):
        old_ids = apply_reviewed_filter(test_db, test_tenant, reviewed)

        new_subquery = apply_reviewed_filter_subquery(test_db, test_tenant, reviewed)
        new_ids = {row[0] for row in test_db.query(new_subquery.c.id).all()}

        assert old_ids == new_ids


class TestPermatagFilterEquivalence:
    def test_permatag_filter_keyword_equivalence(self, test_db: Session, test_tenant: Tenant, sample_images, sample_keywords, sample_permatags):
        keyword = "mountain"

        old_ids = apply_permatag_filter(test_db, test_tenant, keyword, signum=1, missing=False)

        new_subquery = apply_permatag_filter_subquery(test_db, test_tenant, keyword, signum=1, missing=False)
        new_ids = {row[0] for row in test_db.query(new_subquery.c.id).all()}

        assert old_ids == new_ids
        assert len(old_ids) == 3


class TestCombinedFiltersEquivalence:
    def test_combined_filters_equivalence(self, test_db: Session, test_tenant: Tenant, sample_images, sample_photo_list, sample_tags, sample_permatags):
        base_query, subqueries_list, exclude_subqueries_list, has_empty = build_image_query_with_subqueries(
            test_db,
            test_tenant,
            list_id=sample_photo_list.id,
            rating=1,
            rating_operator="gte",
            hide_zero_rating=True,
            reviewed=True,
            permatag_keyword=None,
        )

        combined_query = base_query
        for subquery in subqueries_list:
            combined_query = combined_query.filter(ImageMetadata.id.in_(subquery))
        for subquery in exclude_subqueries_list:
            combined_query = combined_query.filter(~ImageMetadata.id.in_(subquery))

        result_ids = {img.id for img in combined_query.all()}
        assert result_ids == {1, 3, 5}

    def test_empty_filter_detection(self, test_db: Session, test_tenant: Tenant, sample_images):
        _, _, _, has_empty = build_image_query_with_subqueries(test_db, test_tenant, list_id=999)
        assert has_empty is True


class TestMemoryEfficiency:
    def test_subquery_not_materialized(self, test_db: Session, test_tenant: Tenant, sample_photo_list):
        subquery = apply_list_filter_subquery(test_db, test_tenant, sample_photo_list.id)

        from sqlalchemy.sql import Selectable

        assert isinstance(subquery, Selectable)

        query_with_subquery = test_db.query(ImageMetadata).filter(ImageMetadata.id.in_(subquery))
        results = query_with_subquery.all()
        assert len(results) == 5


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
