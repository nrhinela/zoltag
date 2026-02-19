"""Provider abstractions for face detection and similarity scoring."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, Sequence

import numpy as np
import cv2

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


class OpenCVFallbackFaceRecognitionProvider:
    """Fallback provider that avoids dlib/face_recognition dependency."""

    model_name = "opencv_face_fallback"
    model_version = "haarcascade-v1"

    def __init__(self) -> None:
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        self._cascade = cv2.CascadeClassifier(cascade_path)
        if self._cascade.empty():
            raise RuntimeError(f"Failed to load OpenCV Haar cascade at {cascade_path}")

    def detect_faces(self, image_data: bytes) -> list[FaceDetectionResult]:
        image = _decode_image(image_data)
        if image is None:
            return []
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        faces = self._cascade.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(32, 32),
        )
        detections: list[FaceDetectionResult] = []
        for (x, y, w, h) in faces:
            crop = gray[max(y, 0):max(y, 0) + max(h, 1), max(x, 0):max(x, 0) + max(w, 1)]
            encoding = _fallback_face_encoding(crop)
            if not encoding:
                continue
            detections.append(
                FaceDetectionResult(
                    encoding=encoding,
                    top=int(y),
                    right=int(x + w),
                    bottom=int(y + h),
                    left=int(x),
                    confidence=0.5,
                )
            )
        return detections

    def similarity(self, face_encoding: Sequence[float], reference_encoding: Sequence[float]) -> float:
        face_arr = np.asarray(face_encoding, dtype=np.float32)
        ref_arr = np.asarray(reference_encoding, dtype=np.float32)
        if face_arr.size == 0 or ref_arr.size == 0 or face_arr.shape != ref_arr.shape:
            return 0.0
        face_norm = np.linalg.norm(face_arr)
        ref_norm = np.linalg.norm(ref_arr)
        if face_norm <= 0.0 or ref_norm <= 0.0:
            return 0.0
        cosine = float(np.dot(face_arr, ref_arr) / (face_norm * ref_norm))
        return max(0.0, min(1.0, 0.5 * (cosine + 1.0)))


def get_default_face_provider() -> FaceRecognitionProvider:
    """Return dlib-backed provider when available, else OpenCV fallback."""
    try:
        import face_recognition  # noqa: F401
        return DlibFaceRecognitionProvider()
    except Exception:
        return OpenCVFallbackFaceRecognitionProvider()


def _to_int_or_none(value) -> int | None:
    try:
        if value is None:
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _decode_image(image_data: bytes):
    if not image_data:
        return None
    arr = np.frombuffer(image_data, dtype=np.uint8)
    if arr.size == 0:
        return None
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def _fallback_face_encoding(gray_face_crop: np.ndarray) -> list[float]:
    if gray_face_crop is None or gray_face_crop.size == 0:
        return []
    resized = cv2.resize(gray_face_crop, (16, 16), interpolation=cv2.INTER_AREA)
    arr = resized.astype(np.float32).reshape(-1)
    norm = float(np.linalg.norm(arr))
    if norm > 0.0:
        arr = arr / norm
    return arr.tolist()
