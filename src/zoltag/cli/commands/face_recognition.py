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


@click.command(name='recompute-face-detections')
@click.option('--tenant-id', required=True, help='Tenant ID for which to recompute detected faces')
@click.option('--batch-size', default=25, type=int, help='Process images in batches')
@click.option('--limit', default=None, type=int, help='Limit number of images to process')
@click.option('--offset', default=0, type=int, help='Offset into image list')
@click.option('--replace', is_flag=True, default=False, help='Replace existing detected_faces for processed images')
def recompute_face_detections_command(
    tenant_id: str,
    batch_size: int,
    limit: Optional[int],
    offset: int,
    replace: bool,
):
    """Recompute detected faces for tenant images."""
    cmd = RecomputeFaceDetectionsCommand(
        tenant_id=tenant_id,
        batch_size=batch_size,
        limit=limit,
        offset=offset,
        replace=replace,
    )
    cmd.run()


@click.command(name='recompute-face-recognition-tags')
@click.option('--tenant-id', required=True, help='Tenant ID for which to recompute face-recognition suggestions')
@click.option('--batch-size', default=200, type=int, help='Process candidate images in batches')
@click.option('--limit', default=None, type=int, help='Limit number of candidate images considered')
@click.option('--offset', default=0, type=int, help='Offset into candidate image list')
@click.option('--replace', is_flag=True, default=False, help='Replace existing face-recognition suggestions for scoped keywords')
@click.option('--person-id', default=None, type=int, help='Scope recompute to one person ID')
@click.option('--keyword-id', default=None, type=int, help='Scope recompute to one person keyword ID')
@click.option('--min-references', default=None, type=int, help='Minimum active references required (defaults to app setting)')
@click.option('--threshold', default=None, type=float, help='Suggestion threshold [0-1] (defaults to app setting)')
def recompute_face_recognition_tags_command(
    tenant_id: str,
    batch_size: int,
    limit: Optional[int],
    offset: int,
    replace: bool,
    person_id: Optional[int],
    keyword_id: Optional[int],
    min_references: Optional[int],
    threshold: Optional[float],
):
    """Recompute person tag suggestions using face-recognition similarity."""
    cmd = RecomputeFaceRecognitionTagsCommand(
        tenant_id=tenant_id,
        batch_size=batch_size,
        limit=limit,
        offset=offset,
        replace=replace,
        person_id=person_id,
        keyword_id=keyword_id,
        min_references=max(1, int(min_references or settings.face_recognition_min_references)),
        threshold=float(threshold if threshold is not None else settings.face_recognition_suggest_threshold),
    )
    cmd.run()


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
