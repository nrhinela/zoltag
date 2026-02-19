"""Face detection + face-recognition recompute service helpers."""

from __future__ import annotations

from datetime import datetime
import json
from time import monotonic
from typing import Callable, Optional

from sqlalchemy import exists, or_
from sqlalchemy.orm import Session

from zoltag.face_recognition.providers import FaceDetectionResult, FaceRecognitionProvider
from zoltag.metadata import (
    DetectedFace,
    ImageMetadata,
    MachineTag,
    Permatag,
    PersonReferenceImage,
)
from zoltag.models.config import Keyword
from zoltag.tenant_scope import parse_tenant_id, tenant_column_filter_for_values


FACE_RECOGNITION_TAG_TYPE = "face_recognition"
FACE_RECOGNITION_MODEL_NAME = "face_recognition"


def recompute_face_detections(
    db: Session,
    *,
    tenant_id: str,
    provider: FaceRecognitionProvider,
    load_image_bytes: Callable[[ImageMetadata], Optional[bytes]],
    replace: bool = False,
    batch_size: int = 50,
    limit: Optional[int] = None,
    offset: int = 0,
    progress_callback: Optional[Callable[[dict], None]] = None,
) -> dict[str, int]:
    """Detect faces for tenant images and refresh `detected_faces` rows."""
    tenant_value = parse_tenant_id(tenant_id) or tenant_id

    query = db.query(ImageMetadata).filter(
        tenant_column_filter_for_values(ImageMetadata, tenant_id),
        ImageMetadata.asset_id.is_not(None),
        _not_zero_rating(ImageMetadata.rating),
    )
    if not replace:
        query = query.filter(
            or_(ImageMetadata.faces_detected.is_(False), ImageMetadata.faces_detected.is_(None))
        )
    query = query.order_by(ImageMetadata.id.desc()).offset(max(offset, 0))
    total_candidates = query.count()
    started_at = monotonic()
    if progress_callback:
        progress_callback(
            {
                "stage": "start",
                "total_candidates": int(total_candidates or 0),
                "batch_size": int(batch_size),
                "offset": int(max(offset, 0)),
                "limit": int(limit) if limit is not None else None,
                "replace": bool(replace),
            }
        )

    processed = 0
    skipped = 0
    detected_faces_total = 0
    batch_offset = 0

    while True:
        if limit is not None and processed >= limit:
            break
        batch_limit = batch_size
        if limit is not None:
            batch_limit = max(0, min(batch_size, limit - processed))
            if batch_limit <= 0:
                break

        images = query.offset(batch_offset).limit(batch_limit).all()
        if not images:
            break

        for image in images:
            image_bytes = load_image_bytes(image)
            if not image_bytes:
                skipped += 1
                continue

            detections = provider.detect_faces(image_bytes)

            db.query(DetectedFace).filter(
                tenant_column_filter_for_values(DetectedFace, tenant_id),
                DetectedFace.image_id == image.id,
            ).delete(synchronize_session=False)

            for detection in detections:
                db.add(
                    DetectedFace(
                        image_id=image.id,
                        tenant_id=tenant_value,
                        person_id=None,
                        person_name=None,
                        confidence=detection.confidence or 1.0,
                        bbox_top=detection.top,
                        bbox_right=detection.right,
                        bbox_bottom=detection.bottom,
                        bbox_left=detection.left,
                        face_encoding=_encode_face_encoding_for_db(db, detection.encoding),
                    )
                )
            image.faces_detected = len(detections) > 0
            processed += 1
            detected_faces_total += len(detections)

        db.commit()
        if progress_callback:
            progress_callback(
                {
                    "stage": "batch",
                    "processed": int(processed),
                    "skipped": int(skipped),
                    "detected_faces": int(detected_faces_total),
                    "batch_images": int(len(images)),
                    "elapsed_seconds": float(monotonic() - started_at),
                }
            )
        batch_offset += len(images)

    if progress_callback:
        progress_callback(
            {
                "stage": "done",
                "processed": int(processed),
                "skipped": int(skipped),
                "detected_faces": int(detected_faces_total),
                "elapsed_seconds": float(monotonic() - started_at),
            }
        )
    return {
        "processed": processed,
        "skipped": skipped,
        "detected_faces": detected_faces_total,
    }


def recompute_face_recognition_tags(
    db: Session,
    *,
    tenant_id: str,
    provider: FaceRecognitionProvider,
    load_reference_image_bytes: Callable[[PersonReferenceImage], Optional[bytes]],
    min_references: int,
    threshold: float,
    replace: bool = False,
    person_id: Optional[int] = None,
    keyword_id: Optional[int] = None,
    limit: Optional[int] = None,
    offset: int = 0,
    batch_size: int = 200,
) -> dict[str, int]:
    """Refresh machine-tag suggestions for person-linked keywords."""
    tenant_value = parse_tenant_id(tenant_id) or tenant_id
    model_name = getattr(provider, "model_name", FACE_RECOGNITION_MODEL_NAME) or FACE_RECOGNITION_MODEL_NAME
    model_version = getattr(provider, "model_version", model_name) or model_name

    keyword_query = db.query(Keyword).filter(
        tenant_column_filter_for_values(Keyword, tenant_id),
        Keyword.person_id.is_not(None),
    ).order_by(Keyword.id.asc())
    if keyword_id is not None:
        keyword_query = keyword_query.filter(Keyword.id == keyword_id)
    if person_id is not None:
        keyword_query = keyword_query.filter(Keyword.person_id == person_id)

    keywords = keyword_query.all()

    keywords_considered = 0
    keywords_skipped = 0
    images_considered = 0
    tags_written = 0

    for keyword in keywords:
        if keyword.person_id is None:
            continue
        keywords_considered += 1

        refs = db.query(PersonReferenceImage).filter(
            tenant_column_filter_for_values(PersonReferenceImage, tenant_id),
            PersonReferenceImage.person_id == keyword.person_id,
            PersonReferenceImage.is_active.is_(True),
        ).order_by(
            PersonReferenceImage.created_at.desc(),
            PersonReferenceImage.id.desc(),
        ).all()

        reference_encodings: list[list[float]] = []
        for ref in refs:
            image_bytes = load_reference_image_bytes(ref)
            if not image_bytes:
                continue
            detections = provider.detect_faces(image_bytes)
            ref.face_count = len(detections)
            ref.quality_score = 1.0 if detections else 0.0
            dominant_face = _pick_dominant_face(detections)
            if dominant_face is None:
                continue
            reference_encodings.append(dominant_face.encoding)
        db.flush()

        if len(reference_encodings) < int(min_references):
            keywords_skipped += 1
            if replace:
                db.query(MachineTag).filter(
                    tenant_column_filter_for_values(MachineTag, tenant_id),
                    MachineTag.keyword_id == keyword.id,
                    MachineTag.tag_type == FACE_RECOGNITION_TAG_TYPE,
                    MachineTag.model_name == model_name,
                ).delete(synchronize_session=False)
                db.flush()
            continue

        if replace:
            db.query(MachineTag).filter(
                tenant_column_filter_for_values(MachineTag, tenant_id),
                MachineTag.keyword_id == keyword.id,
                MachineTag.tag_type == FACE_RECOGNITION_TAG_TYPE,
                MachineTag.model_name == model_name,
            ).delete(synchronize_session=False)
            db.flush()

        image_query = db.query(ImageMetadata).filter(
            tenant_column_filter_for_values(ImageMetadata, tenant_id),
            ImageMetadata.asset_id.is_not(None),
            _not_zero_rating(ImageMetadata.rating),
            ~exists().where(
                tenant_column_filter_for_values(Permatag, tenant_id)
                & (Permatag.asset_id == ImageMetadata.asset_id)
                & (Permatag.keyword_id == keyword.id)
                & (Permatag.signum == 1)
            ),
            exists().where(
                tenant_column_filter_for_values(DetectedFace, tenant_id)
                & (DetectedFace.image_id == ImageMetadata.id)
                & DetectedFace.face_encoding.is_not(None)
            ),
        ).order_by(ImageMetadata.id.desc())

        scoped_query = image_query.offset(max(offset, 0))
        batch_offset = 0

        while True:
            if limit is not None and images_considered >= limit:
                break
            batch_limit = batch_size
            if limit is not None:
                batch_limit = max(0, min(batch_size, limit - images_considered))
                if batch_limit <= 0:
                    break

            images = scoped_query.offset(batch_offset).limit(batch_limit).all()
            if not images:
                break

            for image in images:
                faces = db.query(DetectedFace.face_encoding).filter(
                    tenant_column_filter_for_values(DetectedFace, tenant_id),
                    DetectedFace.image_id == image.id,
                    DetectedFace.face_encoding.is_not(None),
                ).all()
                if not faces:
                    continue

                images_considered += 1
                best_score = 0.0
                for (face_encoding,) in faces:
                    face_encoding_values = _decode_face_encoding(face_encoding)
                    if not face_encoding_values:
                        continue
                    for ref_encoding in reference_encodings:
                        score = float(provider.similarity(face_encoding_values, ref_encoding))
                        if score > best_score:
                            best_score = score
                if best_score < threshold:
                    continue

                existing = db.query(MachineTag).filter(
                    tenant_column_filter_for_values(MachineTag, tenant_id),
                    MachineTag.asset_id == image.asset_id,
                    MachineTag.keyword_id == keyword.id,
                    MachineTag.tag_type == FACE_RECOGNITION_TAG_TYPE,
                    MachineTag.model_name == model_name,
                ).first()

                if existing:
                    existing.confidence = best_score
                    existing.model_version = model_version
                    existing.updated_at = datetime.utcnow()
                else:
                    db.add(
                        MachineTag(
                            tenant_id=tenant_value,
                            asset_id=image.asset_id,
                            keyword_id=keyword.id,
                            confidence=best_score,
                            tag_type=FACE_RECOGNITION_TAG_TYPE,
                            model_name=model_name,
                            model_version=model_version,
                        )
                    )
                tags_written += 1

            db.commit()
            batch_offset += len(images)

        if limit is not None and images_considered >= limit:
            break

    return {
        "keywords_considered": keywords_considered,
        "keywords_skipped": keywords_skipped,
        "images_considered": images_considered,
        "tags_written": tags_written,
        "model_name": model_name,
    }


def _pick_dominant_face(detections: list[FaceDetectionResult]) -> Optional[FaceDetectionResult]:
    if not detections:
        return None

    def _area(face: FaceDetectionResult) -> int:
        if None in (face.top, face.right, face.bottom, face.left):
            return 0
        width = max(0, int(face.right) - int(face.left))
        height = max(0, int(face.bottom) - int(face.top))
        return width * height

    return sorted(detections, key=_area, reverse=True)[0]


def _not_zero_rating(rating_col):
    return or_(rating_col.is_(None), rating_col != 0)


def _encode_face_encoding_for_db(db: Session, encoding: list[float]):
    _ = db
    return [float(v) for v in encoding]


def _decode_face_encoding(value) -> list[float]:
    if value is None:
        return []
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except Exception:
            return []
        if isinstance(parsed, list):
            return [float(v) for v in parsed]
        return []
    if isinstance(value, (list, tuple)):
        if value and all(isinstance(v, str) for v in value):
            joined = "".join(value).strip()
            if joined.startswith("[") and joined.endswith("]"):
                try:
                    parsed = json.loads(joined)
                except Exception:
                    parsed = None
                if isinstance(parsed, list):
                    return [float(v) for v in parsed]
        return [float(v) for v in value]
    return []
