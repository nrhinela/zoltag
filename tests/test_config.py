"""Test configuration loading."""

import pytest
from pathlib import Path

from zoltag.config import TenantConfig, KeywordCategory, Person


def test_load_config(test_config: TenantConfig):
    """Test loading tenant configuration."""
    assert len(test_config.keywords) > 0
    assert len(test_config.people) > 0


def test_keyword_structure(test_config: TenantConfig):
    """Test keyword hierarchical structure."""
    category = test_config.keywords[0]
    assert category.name == "Test Category"
    assert "test1" in category.keywords
    assert len(category.subcategories) == 1


    def test_get_all_keywords(test_config: TenantConfig):
        """Test flattening keyword hierarchy."""
        all_keywords = test_config.get_all_keywords()
        assert {"category": "Test Category", "keyword": "test1"} in all_keywords
        assert {"category": "Test Category", "keyword": "test2"} in all_keywords
        assert {"category": "Test Category/Subcategory", "keyword": "subtest1"} in all_keywords

def test_get_person_by_name(test_config: TenantConfig):
    """Test finding person by name or alias."""
    person = test_config.get_person_by_name("Test Person")
    assert person is not None
    assert person.name == "Test Person"
    
    # Test alias lookup
    person = test_config.get_person_by_name("TP")
    assert person is not None
    assert person.name == "Test Person"
    
    # Test case insensitive
    person = test_config.get_person_by_name("test person")
    assert person is not None


def test_config_not_found():
    """Test loading non-existent config."""
    with pytest.raises(FileNotFoundError):
        TenantConfig.load("nonexistent", Path("/tmp"))
