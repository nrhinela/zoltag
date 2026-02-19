"""Face recognition provider and scheduled-job helpers."""

from .providers import (
    DlibFaceRecognitionProvider,
    FaceDetectionResult,
    FaceRecognitionProvider,
)
from .service import (
    FACE_RECOGNITION_MODEL_NAME,
    FACE_RECOGNITION_TAG_TYPE,
    recompute_face_detections,
    recompute_face_recognition_tags,
)

__all__ = [
    "DlibFaceRecognitionProvider",
    "FaceDetectionResult",
    "FaceRecognitionProvider",
    "FACE_RECOGNITION_MODEL_NAME",
    "FACE_RECOGNITION_TAG_TYPE",
    "recompute_face_detections",
    "recompute_face_recognition_tags",
]
