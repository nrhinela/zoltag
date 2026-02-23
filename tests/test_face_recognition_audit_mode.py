"""Tests for face-recognition audit empty-state helpers."""

import uuid

from sqlalchemy.orm import Session

from zoltag.metadata import Person, PersonReferenceImage
from zoltag.models.config import Keyword, KeywordCategory
from zoltag.routers.images.core import _build_face_recognition_audit_empty_state
from zoltag.tenant import Tenant


TEST_TENANT_ID = uuid.uuid5(uuid.NAMESPACE_DNS, "face-recognition-audit-test-tenant")


def _make_tenant() -> Tenant:
    tenant = Tenant(
        id=str(TEST_TENANT_ID),
        name="Test Tenant",
        identifier="test_tenant",
        key_prefix="test_tenant",
        active=True,
        dropbox_token_secret="test-secret",
    )
    tenant.id = TEST_TENANT_ID
    return tenant


def test_face_audit_empty_state_no_linked_person(test_db: Session):
    tenant = _make_tenant()
    category = KeywordCategory(tenant_id=tenant.id, name="People")
    test_db.add(category)
    test_db.flush()

    keyword = Keyword(
        tenant_id=tenant.id,
        category_id=category.id,
        keyword="alice",
        tag_type="keyword",
        person_id=None,
    )
    test_db.add(keyword)
    test_db.commit()

    empty_state = _build_face_recognition_audit_empty_state(
        db=test_db,
        tenant=tenant,
        keyword_id=keyword.id,
    )
    assert empty_state is not None
    assert empty_state["code"] == "face_recognition_no_linked_person"


def test_face_audit_empty_state_insufficient_references(test_db: Session):
    tenant = _make_tenant()
    category = KeywordCategory(tenant_id=tenant.id, name="People")
    test_db.add(category)
    test_db.flush()

    person = Person(tenant_id=tenant.id, name="Alice")
    test_db.add(person)
    test_db.flush()

    keyword = Keyword(
        tenant_id=tenant.id,
        category_id=category.id,
        keyword="alice",
        tag_type="person",
        person_id=person.id,
    )
    test_db.add(keyword)
    test_db.add(
        PersonReferenceImage(
            tenant_id=tenant.id,
            person_id=person.id,
            source_type="upload",
            storage_key="people/alice/ref-1.jpg",
            is_active=True,
        )
    )
    test_db.commit()

    empty_state = _build_face_recognition_audit_empty_state(
        db=test_db,
        tenant=tenant,
        keyword_id=keyword.id,
    )
    assert empty_state is not None
    assert empty_state["code"] == "face_recognition_insufficient_references"
    assert int(empty_state["active_references"]) == 1


def test_face_audit_empty_state_no_matches_after_reference_threshold(test_db: Session):
    tenant = _make_tenant()
    category = KeywordCategory(tenant_id=tenant.id, name="People")
    test_db.add(category)
    test_db.flush()

    person = Person(tenant_id=tenant.id, name="Alice")
    test_db.add(person)
    test_db.flush()

    keyword = Keyword(
        tenant_id=tenant.id,
        category_id=category.id,
        keyword="alice",
        tag_type="person",
        person_id=person.id,
    )
    test_db.add(keyword)
    test_db.flush()

    test_db.add_all(
        [
            PersonReferenceImage(
                tenant_id=tenant.id,
                person_id=person.id,
                source_type="upload",
                storage_key="people/alice/ref-1.jpg",
                is_active=True,
            ),
            PersonReferenceImage(
                tenant_id=tenant.id,
                person_id=person.id,
                source_type="upload",
                storage_key="people/alice/ref-2.jpg",
                is_active=True,
            ),
            PersonReferenceImage(
                tenant_id=tenant.id,
                person_id=person.id,
                source_type="upload",
                storage_key="people/alice/ref-3.jpg",
                is_active=True,
            ),
        ]
    )
    test_db.commit()

    empty_state = _build_face_recognition_audit_empty_state(
        db=test_db,
        tenant=tenant,
        keyword_id=keyword.id,
    )
    assert empty_state is not None
    assert empty_state["code"] == "face_recognition_no_matches"
