"""Helpers for normalizing machine-tag type identifiers."""

from typing import Optional

ML_TAG_TYPE_SIMILARITY = "ml-similarity"
ML_TAG_TYPE_FACE_RECOGNITION_API = "face-recognition"
ML_TAG_TYPE_FACE_RECOGNITION_DB = "face_recognition"


def normalize_ml_tag_type(tag_type: Optional[str]) -> Optional[str]:
    """Normalize incoming ML tag type values to canonical DB values."""
    raw = str(tag_type or "").strip().lower()
    if not raw:
        return None
    if raw == ML_TAG_TYPE_FACE_RECOGNITION_API:
        return ML_TAG_TYPE_FACE_RECOGNITION_DB
    return raw


def is_similarity_ml_tag_type(tag_type: Optional[str]) -> bool:
    """Return True when tag type represents audit-only similarity mode."""
    return normalize_ml_tag_type(tag_type) == ML_TAG_TYPE_SIMILARITY


def is_face_recognition_ml_tag_type(tag_type: Optional[str]) -> bool:
    """Return True when tag type maps to face-recognition machine tags."""
    return normalize_ml_tag_type(tag_type) == ML_TAG_TYPE_FACE_RECOGNITION_DB
