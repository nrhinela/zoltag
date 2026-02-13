"""Test tenant management."""

import pytest

from zoltag.tenant import Tenant, TenantContext


def test_tenant_creation():
    """Test creating a tenant."""
    tenant = Tenant(id="test123", name="Test Tenant")
    assert tenant.id == "test123"
    assert tenant.name == "Test Tenant"
    assert tenant.active is True


def test_tenant_validation():
    """Test tenant validation."""
    with pytest.raises(ValueError):
        Tenant(id="", name="Test")
    
    with pytest.raises(ValueError):
        Tenant(id="test", name="")


def test_tenant_context():
    """Test tenant context management."""
    tenant = Tenant(id="test", name="Test")
    
    # Initially no context
    assert TenantContext.get() is None
    
    # Set context
    TenantContext.set(tenant)
    assert TenantContext.get() == tenant
    assert TenantContext.require() == tenant
    
    # Clear context
    TenantContext.clear()
    assert TenantContext.get() is None
    
    # Require without context should raise
    with pytest.raises(RuntimeError):
        TenantContext.require()
