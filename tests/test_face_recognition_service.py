"""Tests for face-recognition service jobs."""

from __future__ import annotations

import json
import sqlite3
import uuid

from sqlalchemy.orm import Session

from zoltag.auth import models as _auth_models  # noqa: F401
from zoltag.face_recognition import (
    FACE_RECOGNITION_TAG_TYPE,
    FaceDetectionResult,
    recompute_face_detections,
    recompute_face_recognition_tags,
)
from zoltag.metadata import (
    Asset,
    DetectedFace,
    ImageMetadata,
    MachineTag,
    Permatag,
    Person,
    PersonReferenceImage,
)
from zoltag.models.config import Keyword, KeywordCategory


TEST_TENANT_ID = uuid.uuid5(uuid.NAMESPACE_DNS, "face-recognition-test-tenant")

# SQLite cannot bind Python lists by default; encode ARRAY payloads as JSON strings for tests.
sqlite3.register_adapter(list, lambda value: json.dumps(value))
sqlite3.register_adapter(tuple, lambda value: json.dumps(list(value)))


class FakeProvider:
    """Simple deterministic test provider."""

    model_name = "face_recognition"
    model_version = "fake-v1"

    def __init__(self, encoding_by_marker: dict[str, list[float]]):
        self.encoding_by_marker = encoding_by_marker

    def detect_faces(self, image_data: bytes) -> list[FaceDetectionResult]:
        marker = image_data.decode("utf-8")
        encoding = self.encoding_by_marker.get(marker)
        if not encoding:
            return []
        return [FaceDetectionResult(encoding=encoding, top=0, right=10, bottom=10, left=0, confidence=1.0)]

    def similarity(self, face_encoding, reference_encoding) -> float:
        if len(face_encoding) != len(reference_encoding):
            return 0.0
        distance = sum((float(a) - float(b)) ** 2 for a, b in zip(face_encoding, reference_encoding)) ** 0.5
        return max(0.0, 1.0 - distance)


def _create_asset_and_image(test_db: Session, *, name: str, rating: int | None) -> ImageMetadata:
    asset = Asset(
        tenant_id=TEST_TENANT_ID,
        filename=f"{name}.jpg",
        source_provider="test",
        source_key=f"/test/{name}.jpg",
        thumbnail_key=f"thumbnails/{name}.jpg",
    )
    test_db.add(asset)
    test_db.flush()

    image = ImageMetadata(
        tenant_id=TEST_TENANT_ID,
        asset_id=asset.id,
        filename=f"{name}.jpg",
        file_size=1024,
        width=100,
        height=100,
        format="JPEG",
        rating=rating,
    )
    test_db.add(image)
    test_db.flush()
    return image


def _create_person_with_keyword(test_db: Session, *, category_id: int, name: str) -> tuple[Person, Keyword]:
    person = Person(tenant_id=TEST_TENANT_ID, name=name)
    test_db.add(person)
    test_db.flush()

    keyword = Keyword(
        tenant_id=TEST_TENANT_ID,
        category_id=category_id,
        keyword=name.lower(),
        person_id=person.id,
        tag_type="person",
    )
    test_db.add(keyword)
    test_db.flush()
    return person, keyword


def test_recompute_face_detections_skips_rating_zero(test_db: Session):
    category = KeywordCategory(tenant_id=TEST_TENANT_ID, name="people", is_people_category=True)
    test_db.add(category)
    test_db.flush()

    image_ok = _create_asset_and_image(test_db, name="detect-ok", rating=2)
    image_zero = _create_asset_and_image(test_db, name="detect-zero", rating=0)
    test_db.commit()

    provider = FakeProvider(
        encoding_by_marker={
            "detect-ok": [0.1, 0.2, 0.3],
            "detect-zero": [0.9, 0.9, 0.9],
        }
    )

    def load_image_bytes(image: ImageMetadata) -> bytes | None:
        return image.filename.replace(".jpg", "").encode("utf-8")

    summary = recompute_face_detections(
        test_db,
        tenant_id=str(TEST_TENANT_ID),
        provider=provider,
        load_image_bytes=load_image_bytes,
        replace=True,
        batch_size=10,
    )

    assert summary["processed"] == 1
    assert summary["detected_faces"] == 1

    rows = test_db.query(DetectedFace).filter(DetectedFace.tenant_id == TEST_TENANT_ID).all()
    assert len(rows) == 1
    assert rows[0].image_id == image_ok.id

    refreshed_ok = test_db.query(ImageMetadata).filter(ImageMetadata.id == image_ok.id).first()
    refreshed_zero = test_db.query(ImageMetadata).filter(ImageMetadata.id == image_zero.id).first()
    assert refreshed_ok is not None and refreshed_ok.faces_detected is True
    assert refreshed_zero is not None and (refreshed_zero.faces_detected is None or refreshed_zero.faces_detected is False)


def test_recompute_face_recognition_tags_is_idempotent_and_min_ref_gated(test_db: Session):
    category = KeywordCategory(tenant_id=TEST_TENANT_ID, name="people", is_people_category=True)
    test_db.add(category)
    test_db.flush()

    person_a, keyword_a = _create_person_with_keyword(test_db, category_id=category.id, name="Alice")
    person_b, keyword_b = _create_person_with_keyword(test_db, category_id=category.id, name="Bob")

    refs = [
        PersonReferenceImage(tenant_id=TEST_TENANT_ID, person_id=person_a.id, source_type="upload", storage_key="a1", is_active=True),
        PersonReferenceImage(tenant_id=TEST_TENANT_ID, person_id=person_a.id, source_type="upload", storage_key="a2", is_active=True),
        PersonReferenceImage(tenant_id=TEST_TENANT_ID, person_id=person_a.id, source_type="upload", storage_key="a3", is_active=True),
        PersonReferenceImage(tenant_id=TEST_TENANT_ID, person_id=person_b.id, source_type="upload", storage_key="b1", is_active=True),
        PersonReferenceImage(tenant_id=TEST_TENANT_ID, person_id=person_b.id, source_type="upload", storage_key="b2", is_active=True),
    ]
    test_db.add_all(refs)
    test_db.flush()

    match_image = _create_asset_and_image(test_db, name="match-a", rating=3)
    tagged_image = _create_asset_and_image(test_db, name="already-tagged-a", rating=3)
    nonmatch_image = _create_asset_and_image(test_db, name="nonmatch", rating=3)
    bob_image = _create_asset_and_image(test_db, name="match-b", rating=3)

    test_db.add_all(
        [
                DetectedFace(
                    image_id=match_image.id,
                    tenant_id=TEST_TENANT_ID,
                    face_encoding=[0.11, 0.19, 0.29],
                    confidence=1.0,
                ),
                DetectedFace(
                    image_id=tagged_image.id,
                    tenant_id=TEST_TENANT_ID,
                    face_encoding=[0.12, 0.20, 0.30],
                    confidence=1.0,
                ),
                DetectedFace(
                    image_id=nonmatch_image.id,
                    tenant_id=TEST_TENANT_ID,
                    face_encoding=[0.9, 0.9, 0.9],
                    confidence=1.0,
                ),
                DetectedFace(
                    image_id=bob_image.id,
                    tenant_id=TEST_TENANT_ID,
                    face_encoding=[0.5, 0.5, 0.5],
                    confidence=1.0,
                ),
        ]
    )
    test_db.flush()

    # Exclude one candidate via positive permatag.
    test_db.add(
        Permatag(
            tenant_id=TEST_TENANT_ID,
            asset_id=tagged_image.asset_id,
            keyword_id=keyword_a.id,
            signum=1,
        )
    )
    test_db.commit()

    provider = FakeProvider(
        encoding_by_marker={
            "a1": [0.1, 0.2, 0.3],
            "a2": [0.1, 0.2, 0.31],
            "a3": [0.11, 0.2, 0.3],
            "b1": [0.5, 0.5, 0.5],
            "b2": [0.5, 0.49, 0.5],
        }
    )

    def load_reference_bytes(ref: PersonReferenceImage) -> bytes | None:
        return (ref.storage_key or "").encode("utf-8")

    summary_1 = recompute_face_recognition_tags(
        test_db,
        tenant_id=str(TEST_TENANT_ID),
        provider=provider,
        load_reference_image_bytes=load_reference_bytes,
        min_references=3,
        threshold=0.6,
        replace=True,
    )

    assert summary_1["keywords_considered"] == 2
    assert summary_1["keywords_skipped"] == 1  # Bob has only 2 refs
    assert summary_1["tags_written"] == 1

    tags_after_first_run = test_db.query(MachineTag).filter(
        MachineTag.tenant_id == TEST_TENANT_ID,
        MachineTag.tag_type == FACE_RECOGNITION_TAG_TYPE,
    ).all()
    assert len(tags_after_first_run) == 1
    assert tags_after_first_run[0].asset_id == match_image.asset_id
    assert tags_after_first_run[0].keyword_id == keyword_a.id
    first_confidence = tags_after_first_run[0].confidence

    summary_2 = recompute_face_recognition_tags(
        test_db,
        tenant_id=str(TEST_TENANT_ID),
        provider=provider,
        load_reference_image_bytes=load_reference_bytes,
        min_references=3,
        threshold=0.6,
        replace=True,
    )
    assert summary_2["tags_written"] == 1

    tags_after_second_run = test_db.query(MachineTag).filter(
        MachineTag.tenant_id == TEST_TENANT_ID,
        MachineTag.tag_type == FACE_RECOGNITION_TAG_TYPE,
    ).all()
    assert len(tags_after_second_run) == 1
    assert tags_after_second_run[0].confidence == first_confidence


def test_recompute_face_recognition_tags_scoped_to_person(test_db: Session):
    category = KeywordCategory(tenant_id=TEST_TENANT_ID, name="people", is_people_category=True)
    test_db.add(category)
    test_db.flush()

    person_a, keyword_a = _create_person_with_keyword(test_db, category_id=category.id, name="Alpha")
    person_b, keyword_b = _create_person_with_keyword(test_db, category_id=category.id, name="Beta")

    test_db.add_all(
        [
            PersonReferenceImage(tenant_id=TEST_TENANT_ID, person_id=person_a.id, source_type="upload", storage_key="alpha1", is_active=True),
            PersonReferenceImage(tenant_id=TEST_TENANT_ID, person_id=person_a.id, source_type="upload", storage_key="alpha2", is_active=True),
            PersonReferenceImage(tenant_id=TEST_TENANT_ID, person_id=person_a.id, source_type="upload", storage_key="alpha3", is_active=True),
            PersonReferenceImage(tenant_id=TEST_TENANT_ID, person_id=person_b.id, source_type="upload", storage_key="beta1", is_active=True),
            PersonReferenceImage(tenant_id=TEST_TENANT_ID, person_id=person_b.id, source_type="upload", storage_key="beta2", is_active=True),
            PersonReferenceImage(tenant_id=TEST_TENANT_ID, person_id=person_b.id, source_type="upload", storage_key="beta3", is_active=True),
        ]
    )
    test_db.flush()

    image_a = _create_asset_and_image(test_db, name="scope-a", rating=3)
    image_b = _create_asset_and_image(test_db, name="scope-b", rating=3)
    test_db.add_all(
        [
            DetectedFace(image_id=image_a.id, tenant_id=TEST_TENANT_ID, face_encoding=[0.2, 0.2, 0.2], confidence=1.0),
            DetectedFace(image_id=image_b.id, tenant_id=TEST_TENANT_ID, face_encoding=[0.8, 0.8, 0.8], confidence=1.0),
        ]
    )
    test_db.commit()

    provider = FakeProvider(
        encoding_by_marker={
            "alpha1": [0.2, 0.2, 0.2],
            "alpha2": [0.21, 0.19, 0.2],
            "alpha3": [0.2, 0.21, 0.19],
            "beta1": [0.8, 0.8, 0.8],
            "beta2": [0.79, 0.8, 0.81],
            "beta3": [0.8, 0.79, 0.81],
        }
    )

    def load_reference_bytes(ref: PersonReferenceImage) -> bytes | None:
        return (ref.storage_key or "").encode("utf-8")

    summary = recompute_face_recognition_tags(
        test_db,
        tenant_id=str(TEST_TENANT_ID),
        provider=provider,
        load_reference_image_bytes=load_reference_bytes,
        min_references=3,
        threshold=0.6,
        replace=True,
        person_id=person_a.id,
    )
    assert summary["keywords_considered"] == 1
    assert summary["tags_written"] == 1

    tags = test_db.query(MachineTag).filter(
        MachineTag.tenant_id == TEST_TENANT_ID,
        MachineTag.tag_type == FACE_RECOGNITION_TAG_TYPE,
    ).all()
    assert len(tags) == 1
    assert tags[0].keyword_id == keyword_a.id
    assert tags[0].keyword_id != keyword_b.id
