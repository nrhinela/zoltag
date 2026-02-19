"""Face detection and recognition recompute commands."""

from __future__ import annotations

from typing import Optional

import click
from google.cloud import storage

from zoltag.asset_helpers import resolve_image_storage
from zoltag.cli.base import CliCommand
from zoltag.face_recognition import (
    DlibFaceRecognitionProvider,
    recompute_face_detections,
    recompute_face_recognition_tags,
)
from zoltag.metadata import Asset, ImageMetadata, PersonReferenceImage
from zoltag.settings import settings


class RecomputeFaceDetectionsCommand(CliCommand):
    """Batch face detection command."""

    def __init__(
        self,
        tenant_id: str,
        batch_size: int,
        limit: Optional[int],
        offset: int,
        replace: bool,
    ) -> None:
        super().__init__()
        self.tenant_id = tenant_id
        self.batch_size = batch_size
        self.limit = limit
        self.offset = offset
        self.replace = replace

    def run(self):
        """Execute face detection refresh."""
        self.setup_db()
        try:
            self.tenant = self.load_tenant(self.tenant_id)
            provider = DlibFaceRecognitionProvider()
            storage_client = storage.Client(project=settings.gcp_project_id)
            thumbnail_bucket = storage_client.bucket(self.tenant.get_thumbnail_bucket(settings))

            def _load_image_bytes(image: ImageMetadata) -> bytes | None:
                storage_info = resolve_image_storage(
                    image=image,
                    tenant=self.tenant,
                    db=self.db,
                    strict=False,
                )
                thumbnail_key = (storage_info.thumbnail_key or "").strip()
                if not thumbnail_key:
                    return None
                blob = thumbnail_bucket.blob(thumbnail_key)
                if not blob.exists():
                    return None
                return blob.download_as_bytes()

            summary = recompute_face_detections(
                self.db,
                tenant_id=self.tenant.id,
                provider=provider,
                load_image_bytes=_load_image_bytes,
                replace=self.replace,
                batch_size=self.batch_size,
                limit=self.limit,
                offset=self.offset,
            )
            click.echo(
                "✓ Face detections refreshed: "
                f"{summary['processed']} processed · "
                f"{summary['skipped']} skipped · "
                f"{summary['detected_faces']} faces"
            )
        finally:
            self.cleanup_db()


class RecomputeFaceRecognitionTagsCommand(CliCommand):
    """Batch face-recognition suggestion command."""

    def __init__(
        self,
        tenant_id: str,
        batch_size: int,
        limit: Optional[int],
        offset: int,
        replace: bool,
        person_id: Optional[int],
        keyword_id: Optional[int],
        min_references: int,
        threshold: float,
    ) -> None:
        super().__init__()
        self.tenant_id = tenant_id
        self.batch_size = batch_size
        self.limit = limit
        self.offset = offset
        self.replace = replace
        self.person_id = person_id
        self.keyword_id = keyword_id
        self.min_references = min_references
        self.threshold = threshold

    def run(self):
        """Execute face-recognition tag recompute."""
        self.setup_db()
        try:
            self.tenant = self.load_tenant(self.tenant_id)
            provider = DlibFaceRecognitionProvider()
            storage_client = storage.Client(project=settings.gcp_project_id)
            image_bucket = storage_client.bucket(self.tenant.get_storage_bucket(settings))
            thumbnail_bucket = storage_client.bucket(self.tenant.get_thumbnail_bucket(settings))

            def _load_reference_image_bytes(reference: PersonReferenceImage) -> bytes | None:
                if reference.source_type == "asset" and reference.source_asset_id:
                    asset = self.db.query(Asset).filter(
                        self.tenant_filter(Asset),
                        Asset.id == reference.source_asset_id,
                    ).first()
                    if not asset:
                        return None
                    thumbnail_key = (asset.thumbnail_key or "").strip()
                    if thumbnail_key:
                        thumb_blob = thumbnail_bucket.blob(thumbnail_key)
                        if thumb_blob.exists():
                            return thumb_blob.download_as_bytes()
                    source_key = (asset.source_key or "").strip()
                    if source_key:
                        source_blob = image_bucket.blob(source_key)
                        if source_blob.exists():
                            return source_blob.download_as_bytes()
                    return None

                storage_key = (reference.storage_key or "").strip()
                if not storage_key:
                    return None

                storage_blob = image_bucket.blob(storage_key)
                if storage_blob.exists():
                    return storage_blob.download_as_bytes()
                thumb_blob = thumbnail_bucket.blob(storage_key)
                if thumb_blob.exists():
                    return thumb_blob.download_as_bytes()
                return None

            summary = recompute_face_recognition_tags(
                self.db,
                tenant_id=self.tenant.id,
                provider=provider,
                load_reference_image_bytes=_load_reference_image_bytes,
                min_references=self.min_references,
                threshold=self.threshold,
                replace=self.replace,
                person_id=self.person_id,
                keyword_id=self.keyword_id,
                limit=self.limit,
                offset=self.offset,
                batch_size=self.batch_size,
            )

            click.echo(
                "✓ Face-recognition tags refreshed: "
                f"{summary['tags_written']} tags · "
                f"{summary['images_considered']} images · "
                f"{summary['keywords_considered']} keywords "
                f"({summary['keywords_skipped']} skipped, min refs)"
            )
        finally:
            self.cleanup_db()
