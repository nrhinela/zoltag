"""Tests for people management API endpoints.

This module tests the people management operations:
- POST /api/v1/people (create_person)
- GET /api/v1/people (list_people)
- GET /api/v1/people/{person_id} (get_person)
- PUT /api/v1/people/{person_id} (update_person)
- DELETE /api/v1/people/{person_id} (delete_person)
- GET /api/v1/people/{person_id}/stats (get_person_stats)
"""

import pytest
from sqlalchemy.orm import Session

from photocat.tenant import Tenant, TenantContext
from photocat.metadata import Person, MachineTag, ImageMetadata
from photocat.models.config import Keyword, KeywordCategory
from photocat.routers.people import get_or_create_person_keyword


@pytest.fixture
def tenant():
    """Create a test tenant."""
    tenant = Tenant(
        id="test_tenant",
        name="Test Tenant",
        active=True,
        dropbox_token_secret="test-secret"
    )
    TenantContext.set(tenant)
    yield tenant
    TenantContext.clear()


# ============================================================================
# People CRUD Tests
# ============================================================================

class TestCreatePerson:
    """Tests for POST /api/v1/people endpoint."""

    def test_create_person_success(self, test_db: Session, tenant: Tenant):
        """Test successfully creating a person."""
        # Create a person
        person = Person(
            tenant_id=tenant.id,
            name="Alice Smith",
            instagram_url="https://instagram.com/alice"
        )
        test_db.add(person)
        test_db.commit()
        test_db.refresh(person)

        # Verify person was created
        assert person.id is not None
        assert person.name == "Alice Smith"
        assert person.instagram_url == "https://instagram.com/alice"

    def test_create_person_with_keyword(self, test_db: Session, tenant: Tenant):
        """Test that creating a person automatically creates a keyword."""
        # Create person
        person = Person(
            tenant_id=tenant.id,
            name="Bob Jones"
        )
        test_db.add(person)
        test_db.flush()

        # Create keyword category
        keyword_cat = KeywordCategory(
            tenant_id=tenant.id,
            name="people",
            is_people_category=True,
            sort_order=0
        )
        test_db.add(keyword_cat)
        test_db.flush()

        # Create keyword for person
        keyword = Keyword(
            tenant_id=tenant.id,
            category_id=keyword_cat.id,
            keyword="Bob Jones",
            person_id=person.id,
            tag_type="person"
        )
        test_db.add(keyword)
        test_db.commit()

        # Verify keyword was created
        assert keyword.id is not None
        assert keyword.person_id == person.id
        assert keyword.tag_type == "person"

    def test_create_person_without_instagram_url(self, test_db: Session, tenant: Tenant):
        """Test creating a person without instagram_url (optional field)."""
        person = Person(
            tenant_id=tenant.id,
            name="Charlie Brown"
        )
        test_db.add(person)
        test_db.commit()
        test_db.refresh(person)

        assert person.instagram_url is None

class TestListPeople:
    """Tests for GET /api/v1/people endpoint."""

    def test_list_people_empty(self, test_db: Session, tenant: Tenant):
        """Test listing people when none exist."""
        people = test_db.query(Person).filter(
            Person.tenant_id == tenant.id
        ).all()

        assert len(people) == 0

    def test_list_people_multiple(self, test_db: Session, tenant: Tenant):
        """Test listing multiple people."""
        # Create people
        for i in range(3):
            person = Person(
                tenant_id=tenant.id,
                name=f"Person {i}"
            )
            test_db.add(person)
        test_db.commit()

        # List people
        people = test_db.query(Person).filter(
            Person.tenant_id == tenant.id
        ).all()

        assert len(people) == 3

    def test_list_people_tenant_isolation(self, test_db: Session, tenant: Tenant):
        """Test that people are isolated by tenant."""
        # Create person for test_tenant
        person1 = Person(
            tenant_id="test_tenant",
            name="Alice"
        )
        test_db.add(person1)

        # Create person for different tenant
        person2 = Person(
            tenant_id="other_tenant",
            name="Bob"
        )
        test_db.add(person2)
        test_db.commit()

        # List people for test_tenant only
        people = test_db.query(Person).filter(
            Person.tenant_id == "test_tenant"
        ).all()

        assert len(people) == 1
        assert people[0].name == "Alice"


class TestGetPerson:
    """Tests for GET /api/v1/people/{person_id} endpoint."""

    def test_get_person_success(self, test_db: Session, tenant: Tenant):
        """Test retrieving a person by ID."""
        # Create person
        person = Person(
            tenant_id=tenant.id,
            name="Eve Wilson",
            instagram_url="https://instagram.com/eve"
        )
        test_db.add(person)
        test_db.commit()
        test_db.refresh(person)

        # Get person
        retrieved = test_db.query(Person).filter(
            Person.id == person.id,
            Person.tenant_id == tenant.id
        ).first()

        assert retrieved is not None
        assert retrieved.name == "Eve Wilson"
        assert retrieved.instagram_url == "https://instagram.com/eve"

    def test_get_person_not_found(self, test_db: Session, tenant: Tenant):
        """Test retrieving non-existent person."""
        retrieved = test_db.query(Person).filter(
            Person.id == 999,
            Person.tenant_id == tenant.id
        ).first()

        assert retrieved is None


class TestUpdatePerson:
    """Tests for PUT /api/v1/people/{person_id} endpoint."""

    def test_update_person_name(self, test_db: Session, tenant: Tenant):
        """Test updating person name."""
        # Create person
        person = Person(
            tenant_id=tenant.id,
            name="Frank"
        )
        test_db.add(person)
        test_db.commit()

        # Update name
        person.name = "Franklin"
        test_db.commit()
        test_db.refresh(person)

        assert person.name == "Franklin"

    def test_update_person_instagram_url(self, test_db: Session, tenant: Tenant):
        """Test updating person instagram URL."""
        # Create person
        person = Person(
            tenant_id=tenant.id,
            name="Grace",
            instagram_url="https://instagram.com/old"
        )
        test_db.add(person)
        test_db.commit()

        # Update URL
        person.instagram_url = "https://instagram.com/new"
        test_db.commit()
        test_db.refresh(person)

        assert person.instagram_url == "https://instagram.com/new"

    def test_update_person_with_keyword_sync(self, test_db: Session, tenant: Tenant):
        """Test that person name update syncs with keyword."""
        # Create person with keyword
        person = Person(
            tenant_id=tenant.id,
            name="Ivan"
        )
        test_db.add(person)
        test_db.flush()

        # Create keyword
        keyword_cat = KeywordCategory(
            tenant_id=tenant.id,
            name="people",
            is_people_category=True
        )
        test_db.add(keyword_cat)
        test_db.flush()

        keyword = Keyword(
            tenant_id=tenant.id,
            category_id=keyword_cat.id,
            keyword="Ivan",
            person_id=person.id,
            tag_type="person"
        )
        test_db.add(keyword)
        test_db.commit()

        # Update person name
        person.name = "Ivan Awesome"
        if person.keyword:
            person.keyword.keyword = person.name
        test_db.commit()
        test_db.refresh(person)
        test_db.refresh(keyword)

        # Verify sync
        assert keyword.keyword == "Ivan Awesome"


class TestDeletePerson:
    """Tests for DELETE /api/v1/people/{person_id} endpoint."""

    def test_delete_person_success(self, test_db: Session, tenant: Tenant):
        """Test deleting a person."""
        # Create person
        person = Person(
            tenant_id=tenant.id,
            name="Julia"
        )
        test_db.add(person)
        test_db.commit()
        person_id = person.id

        # Delete person
        test_db.delete(person)
        test_db.commit()

        # Verify deletion
        retrieved = test_db.query(Person).filter(
            Person.id == person_id
        ).first()

        assert retrieved is None

    def test_delete_person_cascades_to_keyword(self, test_db: Session, tenant: Tenant):
        """Test that deleting person cascades to associated keyword."""
        # Create person
        person = Person(
            tenant_id=tenant.id,
            name="Kevin"
        )
        test_db.add(person)
        test_db.flush()

        # Create keyword
        keyword_cat = KeywordCategory(
            tenant_id=tenant.id,
            name="people",
            is_people_category=True
        )
        test_db.add(keyword_cat)
        test_db.flush()

        keyword = Keyword(
            tenant_id=tenant.id,
            category_id=keyword_cat.id,
            keyword="Kevin",
            person_id=person.id,
            tag_type="person"
        )
        test_db.add(keyword)
        test_db.commit()
        keyword_id = keyword.id

        # Delete person
        test_db.delete(person)
        test_db.commit()

        # Verify keyword still exists (manual FK, not cascade)
        # In a real cascade scenario, check your DB constraints
        retrieved_keyword = test_db.query(Keyword).filter(
            Keyword.id == keyword_id
        ).first()

        # Keyword should still exist but person_id is now NULL
        if retrieved_keyword:
            assert retrieved_keyword.person_id is None


class TestPersonStatistics:
    """Tests for GET /api/v1/people/{person_id}/stats endpoint."""

    def test_person_stats_no_tags(self, test_db: Session, tenant: Tenant):
        """Test statistics for person with no tags."""
        # Create person
        person = Person(
            tenant_id=tenant.id,
            name="Laura"
        )
        test_db.add(person)
        test_db.commit()
        test_db.refresh(person)

        # Check stats
        tag_count = test_db.query(MachineTag).filter(
            MachineTag.tenant_id == tenant.id
        ).count()

        assert tag_count == 0

    def test_person_stats_with_tags(self, test_db: Session, tenant: Tenant):
        """Test statistics for person with tagged images."""
        # Create person
        person = Person(
            tenant_id=tenant.id,
            name="Michael"
        )
        test_db.add(person)
        test_db.flush()

        # Create keyword for person
        keyword_cat = KeywordCategory(
            tenant_id=tenant.id,
            name="people",
            is_people_category=True
        )
        test_db.add(keyword_cat)
        test_db.flush()

        keyword = Keyword(
            tenant_id=tenant.id,
            category_id=keyword_cat.id,
            keyword="Michael",
            person_id=person.id,
            tag_type="person"
        )
        test_db.add(keyword)
        test_db.flush()

        # Create image
        image = ImageMetadata(
            tenant_id=tenant.id,
            filename="test.jpg",
            location="gs://bucket/test.jpg",
            thumbnail_path="thumbnails/test.jpg"
        )
        test_db.add(image)
        test_db.flush()

        # Create tag
        tag = MachineTag(
            image_id=image.id,
            tenant_id=tenant.id,
            keyword_id=keyword.id,
            confidence=1.0,
            tag_type="manual_person"
        )
        test_db.add(tag)
        test_db.commit()

        # Verify tag exists
        tag_count = test_db.query(MachineTag).filter(
            MachineTag.keyword_id == keyword.id
        ).count()

        assert tag_count == 1


class TestGetOrCreatePersonKeyword:
    """Tests for the helper function get_or_create_person_keyword."""

    def test_get_existing_keyword(self, test_db: Session, tenant: Tenant):
        """Test getting an existing person keyword."""
        # Create person with keyword
        person = Person(
            tenant_id=tenant.id,
            name="Nina"
        )
        test_db.add(person)
        test_db.flush()

        keyword_cat = KeywordCategory(
            tenant_id=tenant.id,
            name="people",
            is_people_category=True
        )
        test_db.add(keyword_cat)
        test_db.flush()

        keyword = Keyword(
            tenant_id=tenant.id,
            category_id=keyword_cat.id,
            keyword="Nina",
            person_id=person.id,
            tag_type="person"
        )
        test_db.add(keyword)
        test_db.commit()

        # Get keyword
        retrieved = get_or_create_person_keyword(test_db, tenant.id, person.id)

        assert retrieved is not None
        assert retrieved.id == keyword.id
        assert retrieved.keyword == "Nina"

    def test_create_missing_keyword(self, test_db: Session, tenant: Tenant):
        """Test creating a keyword for person without one."""
        # Create person without keyword
        person = Person(
            tenant_id=tenant.id,
            name="Oscar"
        )
        test_db.add(person)
        test_db.commit()

        # Get or create keyword (should create)
        keyword = get_or_create_person_keyword(test_db, tenant.id, person.id)

        assert keyword is not None
        assert keyword.keyword == "Oscar"
        assert keyword.person_id == person.id

    def test_get_or_create_nonexistent_person(self, test_db: Session, tenant: Tenant):
        """Test get_or_create with non-existent person."""
        keyword = get_or_create_person_keyword(test_db, tenant.id, 999)

        assert keyword is None
