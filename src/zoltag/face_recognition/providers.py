"""Provider abstractions for face detection and similarity scoring."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, Sequence

import numpy as np

from zoltag.image import FaceDetector


@dataclass
class FaceDetectionResult:
    """Single detected face encoding + optional bounding box."""

    encoding: list[float]
    top: int | None = None
    right: int | None = None
    bottom: int | None = None
    left: int | None = None
    confidence: float | None = None


class FaceRecognitionProvider(Protocol):
    """Abstract face recognition provider interface."""

    model_name: str
    model_version: str

    def detect_faces(self, image_data: bytes) -> list[FaceDetectionResult]:
        """Detect faces and return encodings."""

    def similarity(self, face_encoding: Sequence[float], reference_encoding: Sequence[float]) -> float:
        """Return a normalized similarity score in [0, 1]."""


class DlibFaceRecognitionProvider:
    """V1 provider backed by the existing face_recognition/dlib pipeline."""

    model_name = "face_recognition"
    model_version = "dlib-v1"

    def __init__(self) -> None:
        self._detector = FaceDetector()

    def detect_faces(self, image_data: bytes) -> list[FaceDetectionResult]:
        rows = self._detector.detect_faces(image_data)
        detections: list[FaceDetectionResult] = []
        for row in rows:
            bbox = row.get("bounding_box") or {}
            encoding = row.get("encoding") or []
            if not isinstance(encoding, list) or not encoding:
                continue
            detections.append(
                FaceDetectionResult(
                    encoding=[float(v) for v in encoding],
                    top=_to_int_or_none(bbox.get("top")),
                    right=_to_int_or_none(bbox.get("right")),
                    bottom=_to_int_or_none(bbox.get("bottom")),
                    left=_to_int_or_none(bbox.get("left")),
                    confidence=1.0,
                )
            )
        return detections

    def similarity(self, face_encoding: Sequence[float], reference_encoding: Sequence[float]) -> float:
        face_arr = np.asarray(face_encoding, dtype=np.float32)
        ref_arr = np.asarray(reference_encoding, dtype=np.float32)
        if face_arr.size == 0 or ref_arr.size == 0 or face_arr.shape != ref_arr.shape:
            return 0.0
        distance = float(np.linalg.norm(face_arr - ref_arr))
        return max(0.0, 1.0 - distance)


def _to_int_or_none(value) -> int | None:
    try:
        if value is None:
            return None
        return int(value)
    except (TypeError, ValueError):
        return None
