"""Test configuration and fixtures."""

import pytest
import uuid
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from photocat.metadata import Base
from photocat.tenant import Tenant, TenantContext
from photocat.config import TenantConfig


@pytest.fixture
def test_db():
    """Create test database."""
    from photocat.models.config import Base as ConfigBase

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    ConfigBase.metadata.create_all(engine)

    SessionLocal = sessionmaker(bind=engine)
    session = SessionLocal()

    yield session

    session.close()
    Base.metadata.drop_all(engine)
    ConfigBase.metadata.drop_all(engine)


@pytest.fixture
def test_tenant():
    """Create test tenant."""
    tenant_identifier = "test_tenant"
    tenant_id = uuid.uuid5(uuid.NAMESPACE_DNS, tenant_identifier)
    tenant = Tenant(
        id=str(tenant_id),
        name="Test Tenant",
        identifier=tenant_identifier,
        key_prefix=tenant_identifier,
        active=True,
        dropbox_token_secret="test-secret"
    )
    # SQLAlchemy UUID(as_uuid=True) bindings in tests require UUID objects.
    tenant.id = tenant_id
    TenantContext.set(tenant)
    
    yield tenant
    
    TenantContext.clear()


@pytest.fixture
def test_config(tmp_path: Path):
    """Create test configuration files."""
    config_dir = tmp_path / "config" / "test_tenant"
    config_dir.mkdir(parents=True)
    
    # Create keywords.yaml
    keywords = """
- name: Test Category
  keywords:
    - test1
    - test2
  subcategories:
    - name: Subcategory
      keywords:
        - subtest1
"""
    (config_dir / "keywords.yaml").write_text(keywords)
    
    # Create people.yaml
    people = """
- name: Test Person
  aliases:
    - TP
  face_embedding_ref: null
"""
    (config_dir / "people.yaml").write_text(people)
    
    return TenantConfig.load("test_tenant", tmp_path / "config")


@pytest.fixture
def sample_image_data():
    """Generate sample image data for testing."""
    from PIL import Image
    import io
    
    # Create a simple test image
    img = Image.new('RGB', (100, 100), color='red')
    buffer = io.BytesIO()
    img.save(buffer, format='JPEG')
    return buffer.getvalue()
