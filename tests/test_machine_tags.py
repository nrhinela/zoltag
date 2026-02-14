"""Tests for machine_tags behavior on the current asset-based schema."""

import uuid

import pytest
from sqlalchemy import distinct, func, text
from sqlalchemy.orm import Session

from photocat.dependencies import get_tenant_setting
from photocat.metadata import Asset, ImageMetadata, MachineTag
from photocat.models.config import Keyword, KeywordCategory


TEST_TENANT_IDENTIFIER = "test_tenant"
TEST_TENANT_ID = uuid.uuid5(uuid.NAMESPACE_DNS, TEST_TENANT_IDENTIFIER)


def _create_asset_image(test_db: Session, tenant_id: uuid.UUID, image_id: int, filename: str) -> tuple[ImageMetadata, Asset]:
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
    )
    test_db.add(image)
    test_db.flush()
    return image, asset


def _create_keyword(test_db: Session, tenant_id: uuid.UUID, category_id: int, keyword_id: int, name: str, sort_order: int = 0) -> Keyword:
    keyword = Keyword(
        id=keyword_id,
        tenant_id=tenant_id,
        category_id=category_id,
        keyword=name,
        sort_order=sort_order,
    )
    test_db.add(keyword)
    test_db.flush()
    return keyword


@pytest.fixture
def sample_tags_data(test_db: Session):
    """Create baseline image + keywords for tag query tests."""
    tenant_id = TEST_TENANT_ID

    image, asset = _create_asset_image(test_db, tenant_id, image_id=1, filename="image.jpg")

    category = KeywordCategory(
        id=1,
        tenant_id=tenant_id,
        name="animals",
        sort_order=0,
    )
    test_db.add(category)
    test_db.flush()

    keyword1 = _create_keyword(test_db, tenant_id, category.id, 1, "dog")
    keyword2 = _create_keyword(test_db, tenant_id, category.id, 2, "outdoor", sort_order=1)
    test_db.commit()

    return {
        "image_id": image.id,
        "asset_id": asset.id,
        "tenant_id": tenant_id,
        "keyword_ids": [keyword1.id, keyword2.id],
        "category_id": category.id,
    }


class TestMachineTagModel:
    """Test MachineTag ORM model."""

    def test_machine_tag_creation(self, test_db: Session):
        """Test creating a MachineTag entry with FK relationship."""
        tenant_id = TEST_TENANT_ID
        _, asset = _create_asset_image(test_db, tenant_id, image_id=1, filename="image.jpg")

        category = KeywordCategory(id=1, tenant_id=tenant_id, name="animals", sort_order=0)
        test_db.add(category)
        test_db.flush()
        keyword = _create_keyword(test_db, tenant_id, category.id, 1, "dog")

        machine_tag = MachineTag(
            asset_id=asset.id,
            tenant_id=tenant_id,
            keyword_id=keyword.id,
            confidence=0.95,
            tag_type="siglip",
            model_name="google/siglip-so400m-patch14-384",
            model_version="1.0",
        )
        test_db.add(machine_tag)
        test_db.commit()

        retrieved = test_db.query(MachineTag).filter_by(
            asset_id=asset.id,
            keyword_id=keyword.id,
        ).first()

        assert retrieved is not None
        assert retrieved.tag_type == "siglip"
        assert retrieved.model_name == "google/siglip-so400m-patch14-384"
        assert retrieved.confidence == 0.95

    def test_machine_tag_unique_constraint(self, test_db: Session):
        """Test that unique constraint prevents duplicate tags."""
        tenant_id = TEST_TENANT_ID
        _, asset = _create_asset_image(test_db, tenant_id, image_id=1, filename="image.jpg")

        category = KeywordCategory(id=1, tenant_id=tenant_id, name="animals", sort_order=0)
        test_db.add(category)
        test_db.flush()
        keyword = _create_keyword(test_db, tenant_id, category.id, 1, "dog")

        tag1 = MachineTag(
            asset_id=asset.id,
            tenant_id=tenant_id,
            keyword_id=keyword.id,
            confidence=0.95,
            tag_type="siglip",
            model_name="google/siglip-so400m-patch14-384",
        )
        test_db.add(tag1)
        test_db.commit()

        tag2 = MachineTag(
            asset_id=asset.id,
            tenant_id=tenant_id,
            keyword_id=keyword.id,
            confidence=0.96,
            tag_type="siglip",
            model_name="google/siglip-so400m-patch14-384",
        )
        test_db.add(tag2)

        with pytest.raises(Exception):
            test_db.commit()


class TestMachineTagQueries:
    """Test querying MachineTag data."""

    def test_query_tags_by_image_and_type(self, test_db: Session, sample_tags_data):
        """Test querying tags for an image with specific tag_type."""
        tag = MachineTag(
            asset_id=sample_tags_data["asset_id"],
            tenant_id=sample_tags_data["tenant_id"],
            keyword_id=sample_tags_data["keyword_ids"][0],
            confidence=0.95,
            tag_type="siglip",
            model_name="google/siglip-so400m-patch14-384",
        )
        test_db.add(tag)
        test_db.commit()

        results = (
            test_db.query(MachineTag)
            .join(ImageMetadata, ImageMetadata.asset_id == MachineTag.asset_id)
            .filter(
                ImageMetadata.id == sample_tags_data["image_id"],
                MachineTag.tag_type == "siglip",
            )
            .all()
        )

        assert len(results) == 1
        assert results[0].keyword_id == sample_tags_data["keyword_ids"][0]
        assert results[0].confidence == 0.95

    def test_query_tags_by_type_and_keyword_id(self, test_db: Session):
        """Test querying tags by type and keyword_id for faceting."""
        tenant_id = TEST_TENANT_ID

        assets = []
        for i in range(1, 4):
            _, asset = _create_asset_image(test_db, tenant_id, image_id=i, filename=f"image{i}.jpg")
            assets.append(asset)

        category = KeywordCategory(id=1, tenant_id=tenant_id, name="animals", sort_order=0)
        test_db.add(category)
        test_db.flush()
        keyword = _create_keyword(test_db, tenant_id, category.id, 1, "dog")

        for i, asset in enumerate(assets, start=1):
            test_db.add(MachineTag(
                asset_id=asset.id,
                tenant_id=tenant_id,
                keyword_id=keyword.id,
                confidence=0.90 + (i * 0.01),
                tag_type="siglip",
                model_name="google/siglip-so400m-patch14-384",
            ))
        test_db.commit()

        count = test_db.query(func.count(distinct(MachineTag.asset_id))).filter(
            MachineTag.tenant_id == tenant_id,
            MachineTag.tag_type == "siglip",
            MachineTag.keyword_id == keyword.id,
        ).scalar()

        assert count == 3


class TestTenantSetting:
    """Test get_tenant_setting helper function."""

    def test_get_tenant_setting_default(self, test_db: Session):
        """Test fallback to default when setting not found."""
        result = get_tenant_setting(
            test_db,
            "nonexistent_tenant",
            "active_machine_tag_type",
            default="siglip",
        )
        assert result == "siglip"

    def test_get_tenant_setting_from_jsonb(self, test_db: Session):
        """Test retrieving setting from JSONB."""
        from photocat.metadata import Tenant as TenantModel

        tenant_id_uuid = uuid.uuid5(uuid.NAMESPACE_DNS, TEST_TENANT_IDENTIFIER)
        tenant = TenantModel(
            id=tenant_id_uuid,
            identifier=TEST_TENANT_IDENTIFIER,
            key_prefix=TEST_TENANT_IDENTIFIER,
            name="Test",
            active=True,
            settings={"active_machine_tag_type": "clip"},
        )
        test_db.add(tenant)
        test_db.commit()

        result = get_tenant_setting(
            test_db,
            TEST_TENANT_IDENTIFIER,
            "active_machine_tag_type",
            default="siglip",
        )
        assert result == "clip"


class TestMachineTagIndexes:
    """Test that indexes are created properly."""

    def test_per_image_index_exists(self, test_db: Session):
        """Verify per-asset query path works for efficient filtering."""
        test_db.execute(
            text("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_machine_tags_per_asset'")
        ).fetchall()

        tenant_id = TEST_TENANT_ID
        _, asset = _create_asset_image(test_db, tenant_id, image_id=1, filename="test.jpg")

        category = KeywordCategory(id=1, tenant_id=tenant_id, name="test", sort_order=0)
        test_db.add(category)
        test_db.flush()

        for i in range(10):
            _create_keyword(test_db, tenant_id, category.id, i + 1, f"keyword{i}", sort_order=i)

        for i in range(10):
            test_db.add(MachineTag(
                asset_id=asset.id,
                tenant_id=tenant_id,
                keyword_id=i + 1,
                confidence=0.5 + (i * 0.01),
                tag_type="siglip",
                model_name=f"model{i}",
            ))
        test_db.commit()

        results = test_db.query(MachineTag).filter(
            MachineTag.tenant_id == tenant_id,
            MachineTag.asset_id == asset.id,
            MachineTag.tag_type == "siglip",
        ).all()
        assert len(results) == 10

    def test_facets_index_for_counts(self, test_db: Session):
        """Verify facet queries by keyword_id count distinct assets."""
        tenant_id = TEST_TENANT_ID

        assets = []
        for i in range(1, 6):
            _, asset = _create_asset_image(test_db, tenant_id, image_id=i, filename=f"test{i}.jpg")
            assets.append(asset)

        category = KeywordCategory(id=1, tenant_id=tenant_id, name="animals", sort_order=0)
        test_db.add(category)
        test_db.flush()
        keyword = _create_keyword(test_db, tenant_id, category.id, 1, "dog")

        for asset in assets:
            test_db.add(MachineTag(
                asset_id=asset.id,
                tenant_id=tenant_id,
                keyword_id=keyword.id,
                confidence=0.90,
                tag_type="siglip",
                model_name="google/siglip-so400m-patch14-384",
            ))
        test_db.commit()

        count = test_db.query(func.count(distinct(MachineTag.asset_id))).filter(
            MachineTag.tenant_id == tenant_id,
            MachineTag.tag_type == "siglip",
            MachineTag.keyword_id == keyword.id,
        ).scalar()
        assert count == 5
