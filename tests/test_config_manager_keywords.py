"""Tests for ConfigManager keyword metadata fields."""

import uuid

from sqlalchemy.orm import Session

from zoltag.config.db_config import ConfigManager
from zoltag.metadata import Person
from zoltag.models.config import Keyword, KeywordCategory


TEST_TENANT_ID = uuid.uuid5(uuid.NAMESPACE_DNS, "config-manager-keyword-metadata-tenant")


def test_get_all_keywords_includes_person_metadata(test_db: Session):
    category = KeywordCategory(
        tenant_id=TEST_TENANT_ID,
        name="People",
        is_people_category=True,
    )
    test_db.add(category)
    test_db.flush()

    person = Person(tenant_id=TEST_TENANT_ID, name="Alice")
    test_db.add(person)
    test_db.flush()

    keyword_person = Keyword(
        tenant_id=TEST_TENANT_ID,
        category_id=category.id,
        keyword="alice",
        prompt="person",
        person_id=person.id,
        tag_type="person",
    )
    keyword_regular = Keyword(
        tenant_id=TEST_TENANT_ID,
        category_id=category.id,
        keyword="spotlight",
        prompt="lighting",
        tag_type="keyword",
    )
    test_db.add_all([keyword_person, keyword_regular])
    test_db.commit()

    cfg = ConfigManager(test_db, TEST_TENANT_ID)
    all_keywords = cfg.get_all_keywords(include_people=True)

    person_entry = next((kw for kw in all_keywords if kw.get("keyword") == "alice"), None)
    assert person_entry is not None
    assert int(person_entry["person_id"]) == int(person.id)
    assert person_entry["tag_type"] == "person"

    regular_entry = next((kw for kw in all_keywords if kw.get("keyword") == "spotlight"), None)
    assert regular_entry is not None
    assert regular_entry["person_id"] is None
    assert regular_entry["tag_type"] == "keyword"
