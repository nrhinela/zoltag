"""Tests for machine-tag type normalization helpers."""

from zoltag.machine_tag_types import (
    is_face_recognition_ml_tag_type,
    is_similarity_ml_tag_type,
    normalize_ml_tag_type,
)


def test_normalize_face_recognition_api_alias():
    assert normalize_ml_tag_type("face-recognition") == "face_recognition"
    assert normalize_ml_tag_type("FACE-RECOGNITION") == "face_recognition"


def test_normalize_standard_types():
    assert normalize_ml_tag_type("trained") == "trained"
    assert normalize_ml_tag_type("ml-similarity") == "ml-similarity"
    assert normalize_ml_tag_type("") is None
    assert normalize_ml_tag_type(None) is None


def test_tag_type_predicates():
    assert is_face_recognition_ml_tag_type("face-recognition") is True
    assert is_face_recognition_ml_tag_type("face_recognition") is True
    assert is_face_recognition_ml_tag_type("siglip") is False
    assert is_similarity_ml_tag_type("ml-similarity") is True
    assert is_similarity_ml_tag_type("trained") is False
