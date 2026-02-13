"""Thumbnail backfill command."""

from pathlib import Path
from typing import Optional

import click
from sqlalchemy import or_
from google.cloud import storage

from zoltag.settings import settings
from zoltag.dependencies import get_secret
from zoltag.metadata import Asset, ImageMetadata, Tenant as TenantModel
from zoltag.tenant import Tenant, TenantContext
from zoltag.dropbox import DropboxClient
from zoltag.image import ImageProcessor
from zoltag.cli.base import CliCommand


@click.command(name='backfill-thumbnails')
@click.option('--tenant-id', required=True, help='Tenant ID for which to backfill thumbnails')
@click.option('--limit', default=None, type=int, help='Maximum number of images to process (unlimited if not specified)')
@click.option('--offset', default=0, type=int, help='Skip first N images in the list (useful for resuming)')
@click.option('--batch-size', default=25, type=int, help='Number of images to batch before committing to database')
@click.option('--regenerate-all', is_flag=True, help='Regenerate ALL thumbnails (not just missing ones)')
@click.option('--dry-run', is_flag=True, help='Preview changes without writing to database or GCP buckets')
def backfill_thumbnails_command(
    tenant_id: str,
    limit: Optional[int],
    offset: int,
    batch_size: int,
    regenerate_all: bool,
    dry_run: bool
):
    """Generate and upload thumbnails from Dropbox images to GCP Cloud Storage.

    This command processes images for a tenant to:

    1. Query database for images (missing or all, based on --regenerate-all)
    2. Download each image from Dropbox
    3. Generate thumbnail file (configurable size, default 300x300px)
    4. Upload thumbnail to GCP Cloud Storage (tenant's thumbnail bucket)
    5. Update assets.thumbnail_key (and legacy image_metadata.thumbnail_path when enabled)

    By default, only regenerates missing thumbnails. Use --regenerate-all to regenerate all thumbnails
    (useful after fixing thumbnail path collision bug).

    Storage: Thumbnails uploaded to GCP Cloud Storage (tenant bucket), paths stored in PostgreSQL.
    Use --dry-run to preview changes first, useful for testing batch size and performance."""
    cmd = BackfillThumbnailsCommand(tenant_id, limit, offset, batch_size, regenerate_all, dry_run)
    cmd.run()


class BackfillThumbnailsCommand(CliCommand):
    """Command to backfill or regenerate thumbnails from Dropbox."""

    def __init__(
        self,
        tenant_id: str,
        limit: Optional[int],
        offset: int,
        batch_size: int,
        regenerate_all: bool,
        dry_run: bool
    ):
        super().__init__()
        self.tenant_id = tenant_id
        self.limit = limit
        self.offset = offset
        self.batch_size = batch_size
        self.regenerate_all = regenerate_all
        self.dry_run = dry_run

    def run(self):
        """Execute thumbnail backfill command."""
        self.setup_db()
        try:
            self._backfill_thumbnails()
        finally:
            self.cleanup_db()

    def _backfill_thumbnails(self):
        """Backfill missing thumbnails for images."""
        tenant_row = self.db.query(TenantModel).filter(TenantModel.id == self.tenant_id).first()
        if not tenant_row:
            raise click.ClickException(f"Tenant {self.tenant_id} not found in database")
        if not tenant_row.dropbox_app_key:
            raise click.ClickException("Dropbox app key not configured for tenant")

        try:
            refresh_token = get_secret(f"dropbox-token-{self.tenant_id}")
        except Exception as exc:
            raise click.ClickException(f"Dropbox token not found: {exc}")

        try:
            app_secret = get_secret(f"dropbox-app-secret-{self.tenant_id}")
        except Exception as exc:
            raise click.ClickException(f"Dropbox app secret not found: {exc}")

        dropbox_client = DropboxClient(
            refresh_token=refresh_token,
            app_key=tenant_row.dropbox_app_key,
            app_secret=app_secret,
        )

        tenant_context = Tenant(
            id=tenant_row.id,
            name=tenant_row.name,
            storage_bucket=tenant_row.storage_bucket,
            thumbnail_bucket=tenant_row.thumbnail_bucket,
        )
        TenantContext.set(tenant_context)

        storage_client = storage.Client(project=settings.gcp_project_id)
        thumbnail_bucket = storage_client.bucket(tenant_context.get_thumbnail_bucket(settings))

        query = (
            self.db.query(ImageMetadata, Asset)
            .join(Asset, Asset.id == ImageMetadata.asset_id)
            .filter(ImageMetadata.tenant_id == self.tenant_id)
            .order_by(ImageMetadata.id.asc())
        )
        if not self.regenerate_all:
            missing_filter = or_(
                Asset.thumbnail_key.is_(None),
                Asset.thumbnail_key == '',
                Asset.thumbnail_key.like('legacy:%'),
            )
            query = query.filter(missing_filter)

        if self.offset:
            query = query.offset(self.offset)
        if self.limit:
            query = query.limit(self.limit)

        images = query.all()
        total = len(images)
        if total == 0:
            click.echo("No images with missing thumbnails.")
            return

        click.echo(f"Backfilling thumbnails for {total} images...")
        processor = ImageProcessor()
        updated = 0
        skipped = 0
        failures = 0

        for index, (image, asset) in enumerate(images, start=1):
            filename = image.filename or f"image_{image.id}"
            if not processor.is_supported(filename):
                click.echo(f"[{index}/{total}] Skip unsupported: {filename}")
                skipped += 1
                continue

            dropbox_ref = None
            if asset.source_provider == "dropbox":
                source_key = (asset.source_key or "").strip()
                if source_key:
                    dropbox_ref = source_key
            if not dropbox_ref:
                legacy_dropbox_path = (getattr(image, "dropbox_path", None) or "").strip()
                if legacy_dropbox_path:
                    dropbox_ref = legacy_dropbox_path
            if not dropbox_ref:
                legacy_dropbox_id = (getattr(image, "dropbox_id", None) or "").strip()
                if legacy_dropbox_id and not legacy_dropbox_id.startswith("local_"):
                    dropbox_ref = legacy_dropbox_id if legacy_dropbox_id.startswith("id:") else f"id:{legacy_dropbox_id}"

            if not dropbox_ref or dropbox_ref.startswith("/local/"):
                click.echo(f"[{index}/{total}] Skip missing Dropbox path: {filename}")
                skipped += 1
                continue

            try:
                image_data = None
                if not filename.lower().endswith(('.heic', '.heif')):
                    image_data = dropbox_client.get_thumbnail(dropbox_ref, size='w640h480')
                if image_data is None:
                    image_data = dropbox_client.download_file(dropbox_ref)

                pil_image = processor.load_image(image_data)
                thumbnail_bytes = processor.create_thumbnail(pil_image)

                thumbnail_path = tenant_context.get_asset_thumbnail_key(str(asset.id), "default-256.jpg")

                if not self.dry_run:
                    blob = thumbnail_bucket.blob(thumbnail_path)
                    blob.cache_control = "public, max-age=31536000, immutable"
                    blob.upload_from_string(thumbnail_bytes, content_type='image/jpeg')
                    asset.thumbnail_key = thumbnail_path
                    if settings.asset_write_legacy_fields and hasattr(ImageMetadata, "thumbnail_path"):
                        setattr(image, "thumbnail_path", thumbnail_path)
                updated += 1

                if not self.dry_run and updated % self.batch_size == 0:
                    self.db.commit()

                if index % 25 == 0 or index == total:
                    click.echo(f"  Progress: {index}/{total} (updated {updated}, skipped {skipped}, failed {failures})")
            except Exception as exc:
                failures += 1
                click.echo(f"[{index}/{total}] Error for {filename}: {exc}", err=True)

        if not self.dry_run:
            self.db.commit()

        click.echo(f"Done. Updated {updated}, skipped {skipped}, failed {failures}.")
