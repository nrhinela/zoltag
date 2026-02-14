"""Tests for filtering utilities in routers.filtering module."""

import json
import uuid

import pytest
from sqlalchemy.orm import Session

from photocat.metadata import Asset, ImageMetadata, MachineTag, Permatag
from photocat.models.config import Keyword, KeywordCategory, PhotoList, PhotoListItem
from photocat.routers.filtering import (
    apply_category_filters,
    apply_hide_zero_rating_filter,
    apply_list_filter,
    apply_rating_filter,
    apply_reviewed_filter,
    calculate_relevance_scores,
    compute_current_tags_for_images,
)
from photocat.tenant import Tenant


def _create_asset_image(
    test_db: Session,
    *,
    tenant_id,
    image_id: int,
    filename: str,
    rating: int | None,
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
        file_size=1024,
        width=100,
        height=100,
        format="JPEG",
        rating=rating,
    )
    test_db.add(image)
    test_db.flush()
    return image


@pytest.fixture
def sample_images(test_db: Session, test_tenant: Tenant):
    """Create sample images for testing."""
    tenant_id = test_tenant.id

    images = []
    for i in range(1, 6):
        images.append(
            _create_asset_image(
                test_db,
                tenant_id=tenant_id,
                image_id=i,
                filename=f"image{i}.jpg",
                rating=i % 4,  # 1,2,3,0,1
            )
        )

    test_db.commit()
    return images


@pytest.fixture
def sample_keywords(test_db: Session, test_tenant: Tenant):
    """Create categories/keywords used by machine tags and permatags."""
    tenant_id = test_tenant.id

    cats = {
        "animals": KeywordCategory(tenant_id=tenant_id, name="animals"),
        "setting": KeywordCategory(tenant_id=tenant_id, name="setting"),
        "emotion": KeywordCategory(tenant_id=tenant_id, name="emotion"),
        "atmosphere": KeywordCategory(tenant_id=tenant_id, name="atmosphere"),
    }
    for cat in cats.values():
        test_db.add(cat)
    test_db.flush()

    def add_kw(name: str, cat_name: str, sort_order: int = 0) -> Keyword:
        kw = Keyword(
            tenant_id=tenant_id,
            category_id=cats[cat_name].id,
            keyword=name,
            sort_order=sort_order,
        )
        test_db.add(kw)
        test_db.flush()
        return kw

    keywords = {
        "dog": add_kw("dog", "animals"),
        "cat": add_kw("cat", "animals", 1),
        "bird": add_kw("bird", "animals", 2),
        "outdoor": add_kw("outdoor", "setting"),
        "indoor": add_kw("indoor", "setting", 1),
        "happy": add_kw("happy", "emotion"),
        "cozy": add_kw("cozy", "atmosphere"),
        "elephant": add_kw("elephant", "animals", 3),
    }

    test_db.commit()
    return keywords


@pytest.fixture
def sample_photo_list(test_db: Session, test_tenant: Tenant, sample_images):
    """Create a sample photo list."""
    tenant_id = test_tenant.id

    photo_list = PhotoList(
        tenant_id=tenant_id,
        title="Test List",
        notebox="Test description",
    )
    test_db.add(photo_list)
    test_db.flush()

    for image in sample_images[:3]:
        test_db.add(PhotoListItem(list_id=photo_list.id, asset_id=image.asset_id))

    test_db.commit()
    return photo_list


@pytest.fixture
def sample_tags(test_db: Session, test_tenant: Tenant, sample_images, sample_keywords):
    """Create sample machine tags."""
    tenant_id = test_tenant.id

    tags = [
        # Image 1: dog, outdoor
        MachineTag(asset_id=sample_images[0].asset_id, tenant_id=tenant_id, keyword_id=sample_keywords["dog"].id, confidence=0.95, tag_type="siglip", model_name="siglip-test", model_version="1.0"),
        MachineTag(asset_id=sample_images[0].asset_id, tenant_id=tenant_id, keyword_id=sample_keywords["outdoor"].id, confidence=0.87, tag_type="siglip", model_name="siglip-test", model_version="1.0"),
        # Image 2: cat, indoor
        MachineTag(asset_id=sample_images[1].asset_id, tenant_id=tenant_id, keyword_id=sample_keywords["cat"].id, confidence=0.92, tag_type="siglip", model_name="siglip-test", model_version="1.0"),
        MachineTag(asset_id=sample_images[1].asset_id, tenant_id=tenant_id, keyword_id=sample_keywords["indoor"].id, confidence=0.88, tag_type="siglip", model_name="siglip-test", model_version="1.0"),
        # Image 3: bird, outdoor
        MachineTag(asset_id=sample_images[2].asset_id, tenant_id=tenant_id, keyword_id=sample_keywords["bird"].id, confidence=0.89, tag_type="siglip", model_name="siglip-test", model_version="1.0"),
        MachineTag(asset_id=sample_images[2].asset_id, tenant_id=tenant_id, keyword_id=sample_keywords["outdoor"].id, confidence=0.85, tag_type="siglip", model_name="siglip-test", model_version="1.0"),
    ]

    for tag in tags:
        test_db.add(tag)

    test_db.commit()
    return tags


@pytest.fixture
def sample_permatags(test_db: Session, test_tenant: Tenant, sample_images, sample_keywords):
    """Create sample permatags."""
    tenant_id = test_tenant.id

    permatags = [
        # Image 1: +happy, -outdoor
        Permatag(asset_id=sample_images[0].asset_id, tenant_id=tenant_id, keyword_id=sample_keywords["happy"].id, signum=1),
        Permatag(asset_id=sample_images[0].asset_id, tenant_id=tenant_id, keyword_id=sample_keywords["outdoor"].id, signum=-1),
        # Image 2: +cozy
        Permatag(asset_id=sample_images[1].asset_id, tenant_id=tenant_id, keyword_id=sample_keywords["cozy"].id, signum=1),
    ]

    for pt in permatags:
        test_db.add(pt)

    test_db.commit()
    return permatags


class TestListFilter:
    """Test apply_list_filter function."""

    def test_list_filter_basic(self, test_db: Session, test_tenant: Tenant, sample_images, sample_photo_list):
        result = apply_list_filter(test_db, test_tenant, sample_photo_list.id)
        assert result == {1, 2, 3}

    def test_list_filter_nonexistent(self, test_db: Session, test_tenant: Tenant, sample_images):
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            apply_list_filter(test_db, test_tenant, 99999)

        assert exc_info.value.status_code == 404
        assert exc_info.value.detail == "List not found"


class TestRatingFilter:
    def test_rating_filter_eq(self, test_db: Session, test_tenant: Tenant, sample_images):
        assert apply_rating_filter(test_db, test_tenant, 1, "eq") == {1, 5}

    def test_rating_filter_gte(self, test_db: Session, test_tenant: Tenant, sample_images):
        assert apply_rating_filter(test_db, test_tenant, 2, "gte") == {2, 3}

    def test_rating_filter_gt(self, test_db: Session, test_tenant: Tenant, sample_images):
        assert apply_rating_filter(test_db, test_tenant, 1, "gt") == {2, 3}

    def test_rating_filter_with_existing(self, test_db: Session, test_tenant: Tenant, sample_images):
        assert apply_rating_filter(test_db, test_tenant, 2, "gte", {1, 2, 3}) == {2, 3}


class TestHideZeroRatingFilter:
    def test_hide_zero_rating_no_existing(self, test_db: Session, test_tenant: Tenant, sample_images):
        result = apply_hide_zero_rating_filter(test_db, test_tenant)
        assert 4 not in result
        assert {1, 2, 3, 5}.issubset(result)

    def test_hide_zero_rating_with_existing(self, test_db: Session, test_tenant: Tenant, sample_images):
        assert apply_hide_zero_rating_filter(test_db, test_tenant, {2, 3, 4}) == {2, 3}


class TestReviewedFilter:
    def test_reviewed_true(self, test_db: Session, test_tenant: Tenant, sample_images, sample_permatags):
        assert apply_reviewed_filter(test_db, test_tenant, True) == {1, 2}

    def test_reviewed_false(self, test_db: Session, test_tenant: Tenant, sample_images, sample_permatags):
        assert apply_reviewed_filter(test_db, test_tenant, False) == {3, 4, 5}

    def test_reviewed_with_existing(self, test_db: Session, test_tenant: Tenant, sample_images, sample_permatags):
        assert apply_reviewed_filter(test_db, test_tenant, True, {1, 3, 4}) == {1}


class TestComputeCurrentTags:
    def test_compute_tags_machine_only(self, test_db: Session, test_tenant: Tenant, sample_images, sample_tags):
        result = compute_current_tags_for_images(test_db, test_tenant, [1, 2, 3], "siglip")
        assert set(result[1]) == {"dog", "outdoor"}
        assert set(result[2]) == {"cat", "indoor"}
        assert set(result[3]) == {"bird", "outdoor"}

    def test_compute_tags_with_permatags(self, test_db: Session, test_tenant: Tenant, sample_images, sample_tags, sample_permatags):
        result = compute_current_tags_for_images(test_db, test_tenant, [1, 2], "siglip")

        assert "dog" in result[1]
        assert "happy" in result[1]
        assert "outdoor" not in result[1]

        assert "cat" in result[2]
        assert "indoor" in result[2]
        assert "cozy" in result[2]

    def test_compute_tags_no_tags(self, test_db: Session, test_tenant: Tenant, sample_images):
        result = compute_current_tags_for_images(test_db, test_tenant, [4, 5], "siglip")
        assert result[4] == []
        assert result[5] == []


class TestCategoryFilters:
    def test_category_filters_or(self, test_db: Session, test_tenant: Tenant, sample_images, sample_tags):
        filters_json = json.dumps({"animals": {"keywords": ["dog", "cat"], "operator": "OR"}})
        assert apply_category_filters(test_db, test_tenant, filters_json) == {1, 2}

    def test_category_filters_and(self, test_db: Session, test_tenant: Tenant, sample_images, sample_tags):
        filters_json = json.dumps({"animals": {"keywords": ["bird", "outdoor"], "operator": "AND"}})
        assert apply_category_filters(test_db, test_tenant, filters_json) == {3}

    def test_category_filters_with_existing(self, test_db: Session, test_tenant: Tenant, sample_images, sample_tags):
        filters_json = json.dumps({"animals": {"keywords": ["dog", "cat", "bird"], "operator": "OR"}})
        assert apply_category_filters(test_db, test_tenant, filters_json, {1, 3}) == {1, 3}

    def test_category_filters_invalid_json(self, test_db: Session, test_tenant: Tenant, sample_images):
        existing = {1, 2, 3}
        assert apply_category_filters(test_db, test_tenant, "invalid json", existing) == existing

    def test_category_filters_no_matches(self, test_db: Session, test_tenant: Tenant, sample_images, sample_tags):
        filters_json = json.dumps({"animals": {"keywords": ["elephant"], "operator": "OR"}})
        assert apply_category_filters(test_db, test_tenant, filters_json) == set()


class TestRelevanceScores:
    def test_relevance_scores_basic(self, test_db: Session, test_tenant: Tenant, sample_images, sample_tags):
        result = calculate_relevance_scores(
            test_db,
            test_tenant,
            [1, 2, 3],
            ["dog", "cat", "outdoor"],
            "siglip",
        )
        assert 1 in result and 2 in result and 3 in result
        assert result[1] > result[2] > result[3]

    def test_relevance_scores_no_matches(self, test_db: Session, test_tenant: Tenant, sample_images, sample_tags):
        assert calculate_relevance_scores(test_db, test_tenant, [1, 2, 3], ["elephant"], "siglip") == {}

    def test_relevance_scores_subset(self, test_db: Session, test_tenant: Tenant, sample_images, sample_tags):
        result = calculate_relevance_scores(test_db, test_tenant, [1], ["dog", "outdoor"], "siglip")
        assert len(result) == 1
        assert 1 in result
