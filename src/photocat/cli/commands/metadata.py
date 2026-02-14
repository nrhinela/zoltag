"""Metadata refresh command."""

import click
from typing import Optional
from sqlalchemy import or_
from dropbox import Dropbox

from photocat.settings import settings
from photocat.exif import (
    get_exif_value,
    parse_exif_datetime,
    parse_exif_float,
    parse_exif_int,
    parse_exif_str,
)
from photocat.image import ImageProcessor
from photocat.metadata import Asset, ImageMetadata
from photocat.dependencies import get_secret
from photocat.dropbox import DropboxClient
from photocat.cli.base import CliCommand


def _dropbox_refs_for_image(image: ImageMetadata, asset: Optional[Asset]) -> list[str]:
    """Build candidate Dropbox refs with asset-first priority."""
    refs: list[str] = []

    if asset and asset.source_provider == "dropbox":
        source_key = (asset.source_key or "").strip()
        if source_key and not source_key.startswith("/local/"):
            refs.append(source_key)

    legacy_dropbox_id = (getattr(image, "dropbox_id", None) or "").strip()
    if legacy_dropbox_id and not legacy_dropbox_id.startswith("local_"):
        refs.append(legacy_dropbox_id if legacy_dropbox_id.startswith("id:") else f"id:{legacy_dropbox_id}")

    legacy_dropbox_path = (getattr(image, "dropbox_path", None) or "").strip()
    if legacy_dropbox_path and not legacy_dropbox_path.startswith("/local/"):
        refs.append(legacy_dropbox_path)

    # Preserve order while removing duplicates.
    return list(dict.fromkeys(refs))


@click.command(name='refresh-metadata')
@click.option('--tenant-id', required=True, help='Tenant ID for which to refresh metadata')
@click.option('--limit', default=None, type=int, help='Maximum number of images to process (unlimited if not specified)')
@click.option('--offset', default=0, type=int, help='Skip first N images in the list (useful for resuming).')
@click.option('--batch-size', default=50, type=int, help='Number of images to batch before committing to database')
@click.option('--download-exif/--no-download-exif', default=False, help='Download full image files from Dropbox to extract embedded EXIF data (slow but thorough)')
@click.option('--update-exif/--no-update-exif', default=True, help='Store merged EXIF data in database exif_data column (not stored in GCP buckets)')
@click.option('--dry-run', is_flag=True, help='Preview changes without writing to database')
def refresh_metadata_command(
    tenant_id: str,
    limit: Optional[int],
    offset: int,
    batch_size: int,
    download_exif: bool,
    update_exif: bool,
    dry_run: bool
):
    """Refresh missing EXIF and camera metadata for images by querying Dropbox.

    Fills in missing metadata fields (capture time, GPS coordinates, ISO, aperture, shutter speed,
    focal length, camera/lens model, image dimensions, etc.) by:

    1. Using Dropbox's built-in media_info API (no download needed) - fastest method
    2. Optionally downloading full images to extract embedded EXIF data (--download-exif)
    3. Merging all sources and storing in database exif_data column

    Storage: Metadata is stored in PostgreSQL database, not in GCP buckets.
    Use --dry-run to preview changes first."""
    cmd = RefreshMetadataCommand(
        tenant_id, limit, offset, batch_size,
        download_exif, update_exif, dry_run
    )
    cmd.run()


@click.command(name='backfill-missing-media-info')
@click.option('--tenant-id', required=True, help='Tenant ID for which to backfill capture timestamps')
@click.option('--limit', default=None, type=int, help='Maximum number of images to process (unlimited if not specified)')
@click.option('--offset', default=0, type=int, help='Skip first N images in the list (useful for resuming).')
@click.option('--batch-size', default=100, type=int, help='Number of images to batch before committing to database')
@click.option('--dry-run', is_flag=True, help='Preview changes without writing to database')
def backfill_capture_timestamp_command(
    tenant_id: str,
    limit: Optional[int],
    offset: int,
    batch_size: int,
    dry_run: bool
):
    """Backfill missing capture timestamps using Dropbox media_info (no downloads)."""
    cmd = BackfillCaptureTimestampCommand(tenant_id, limit, offset, batch_size, dry_run)
    cmd.run()


class RefreshMetadataCommand(CliCommand):
    """Command to refresh metadata from Dropbox."""

    def __init__(
        self,
        tenant_id: str,
        limit: Optional[int],
        offset: int,
        batch_size: int,
        download_exif: bool,
        update_exif: bool,
        dry_run: bool
    ):
        super().__init__()
        self.tenant_id = tenant_id
        self.limit = limit
        self.offset = offset
        self.batch_size = batch_size
        self.download_exif = download_exif
        self.update_exif = update_exif
        self.dry_run = dry_run

    def run(self):
        """Execute metadata refresh command."""
        self.setup_db()
        try:
            self._refresh_metadata()
        finally:
            self.cleanup_db()

    def _refresh_metadata(self):
        """Refresh missing EXIF-derived metadata from Dropbox."""
        self.tenant = self.load_tenant(self.tenant_id)
        if not self.tenant.dropbox_app_key:
            raise click.ClickException("Dropbox app key not configured for tenant")

        try:
            refresh_token = get_secret(f"dropbox-token-{self.tenant.secret_scope}")
        except Exception as exc:
            raise click.ClickException(f"Dropbox token not found: {exc}")

        try:
            app_secret = get_secret(f"dropbox-app-secret-{self.tenant.secret_scope}")
        except Exception as exc:
            raise click.ClickException(f"Dropbox app secret not found: {exc}")

        dbx = Dropbox(
            oauth2_refresh_token=refresh_token,
            app_key=self.tenant.dropbox_app_key,
            app_secret=app_secret
        )

        # Query for images with missing metadata
        missing_filter = or_(
            ImageMetadata.capture_timestamp.is_(None),
            ImageMetadata.gps_latitude.is_(None),
            ImageMetadata.gps_longitude.is_(None),
            ImageMetadata.iso.is_(None),
            ImageMetadata.aperture.is_(None),
            ImageMetadata.shutter_speed.is_(None),
            ImageMetadata.focal_length.is_(None),
            ImageMetadata.camera_make.is_(None),
            ImageMetadata.camera_model.is_(None),
            ImageMetadata.lens_model.is_(None),
            ImageMetadata.modified_time.is_(None),
            ImageMetadata.exif_data.is_(None),
        )

        base_query = self.db.query(ImageMetadata).filter(
            self.tenant_filter(ImageMetadata),
            missing_filter
        ).order_by(ImageMetadata.id.desc())

        if self.offset:
            base_query = base_query.offset(self.offset)

        total_count = base_query.count()
        if not total_count:
            click.echo("No images with missing metadata.")
            return

        processor = ImageProcessor() if self.download_exif else None
        updated = 0
        skipped = 0
        failed = 0

        click.echo(f"Refreshing metadata for {total_count} images...")
        processed = 0
        last_id = None
        while True:
            query = base_query
            if last_id is not None:
                query = query.filter(ImageMetadata.id < last_id)
            batch = query.limit(self.batch_size).all()
            if not batch:
                break
            asset_ids = [img.asset_id for img in batch if img.asset_id is not None]
            assets_by_id = {}
            if asset_ids:
                assets = self.db.query(Asset).filter(
                    self.tenant_filter(Asset),
                    Asset.id.in_(asset_ids)
                ).all()
                assets_by_id = {str(asset.id): asset for asset in assets}
            for image in batch:
                processed += 1
                last_id = image.id
                asset = assets_by_id.get(str(image.asset_id)) if image.asset_id is not None else None
                dropbox_refs = _dropbox_refs_for_image(image, asset)

                if not dropbox_refs:
                    skipped += 1
                    continue

                try:
                    try:
                        from dropbox.files import IncludePropertyGroups
                        include_property_groups = IncludePropertyGroups.filter_some([])
                    except ImportError:
                        include_property_groups = None
                    metadata_kwargs = {
                        "include_media_info": True,
                    }
                    if include_property_groups is not None:
                        metadata_kwargs["include_property_groups"] = include_property_groups
                except Exception as exc:
                    failed += 1
                    click.echo(f"\nFailed to prepare Dropbox metadata for {image.id}: {exc}")
                    continue

                metadata_result = None
                last_exc = None
                for ref in dropbox_refs:
                    try:
                        metadata_result = dbx.files_get_metadata(ref, **metadata_kwargs)
                        break
                    except Exception as exc:
                        last_exc = exc
                        continue

                if metadata_result is None:
                    failed += 1
                    click.echo(f"\nFailed to load Dropbox metadata for {image.id}: {last_exc}")
                    continue

                dropbox_exif = {}
                if hasattr(metadata_result, 'media_info') and metadata_result.media_info:
                    media_info = metadata_result.media_info.get_metadata()
                    if hasattr(media_info, 'dimensions') and media_info.dimensions:
                        dropbox_exif['ImageWidth'] = media_info.dimensions.width
                        dropbox_exif['ImageLength'] = media_info.dimensions.height
                    if hasattr(media_info, 'location') and media_info.location:
                        dropbox_exif['GPSLatitude'] = media_info.location.latitude
                        dropbox_exif['GPSLongitude'] = media_info.location.longitude
                    if hasattr(media_info, 'time_taken') and media_info.time_taken:
                        dropbox_exif['DateTimeOriginal'] = media_info.time_taken.isoformat()
                        dropbox_exif['DateTime'] = media_info.time_taken.isoformat()

                extracted_exif = {}
                if self.download_exif:
                    try:
                        _, response = dbx.files_download(dropbox_refs[0])
                        img = processor.load_image(response.content)
                        extracted_exif = processor.extract_exif(img)
                    except Exception as exc:
                        click.echo(f"\nEXIF download failed for {image.id}: {exc}")

                merged_exif = {}
                if self.update_exif:
                    if image.exif_data:
                        merged_exif.update(image.exif_data)
                    if extracted_exif:
                        merged_exif.update(extracted_exif)
                    if dropbox_exif:
                        merged_exif.update(dropbox_exif)

                exif_source = merged_exif or image.exif_data or dropbox_exif
                updates = {}

                if image.capture_timestamp is None:
                    capture_timestamp = parse_exif_datetime(
                        get_exif_value(exif_source, "DateTimeOriginal", "DateTime")
                    )
                    if capture_timestamp:
                        updates["capture_timestamp"] = capture_timestamp

                if image.modified_time is None and hasattr(metadata_result, "server_modified"):
                    updates["modified_time"] = metadata_result.server_modified

                if image.gps_latitude is None:
                    gps_latitude = parse_exif_float(get_exif_value(exif_source, "GPSLatitude"))
                    if gps_latitude is not None:
                        updates["gps_latitude"] = gps_latitude

                if image.gps_longitude is None:
                    gps_longitude = parse_exif_float(get_exif_value(exif_source, "GPSLongitude"))
                    if gps_longitude is not None:
                        updates["gps_longitude"] = gps_longitude

                if image.iso is None:
                    iso = parse_exif_int(get_exif_value(exif_source, "ISOSpeedRatings", "ISOSpeed", "ISO"))
                    if iso is not None:
                        updates["iso"] = iso

                if image.aperture is None:
                    aperture = parse_exif_float(get_exif_value(exif_source, "FNumber", "ApertureValue"))
                    if aperture is not None:
                        updates["aperture"] = aperture

                if image.shutter_speed is None:
                    shutter_speed = parse_exif_str(get_exif_value(exif_source, "ExposureTime", "ShutterSpeedValue"))
                    if shutter_speed:
                        updates["shutter_speed"] = shutter_speed

                if image.focal_length is None:
                    focal_length = parse_exif_float(get_exif_value(exif_source, "FocalLength"))
                    if focal_length is not None:
                        updates["focal_length"] = focal_length

                if image.camera_make is None:
                    camera_make = parse_exif_str(get_exif_value(exif_source, "Make"))
                    if camera_make:
                        updates["camera_make"] = camera_make

                if image.camera_model is None:
                    camera_model = parse_exif_str(get_exif_value(exif_source, "Model"))
                    if camera_model:
                        updates["camera_model"] = camera_model

                if image.lens_model is None:
                    lens_model = parse_exif_str(get_exif_value(exif_source, "LensModel"))
                    if lens_model:
                        updates["lens_model"] = lens_model

                if self.update_exif and merged_exif and merged_exif != (image.exif_data or {}):
                    updates["exif_data"] = merged_exif

                if updates:
                    updated += 1
                    if not self.dry_run:
                        for key, value in updates.items():
                            setattr(image, key, value)

            if not self.dry_run:
                self.db.commit()
            self.db.expire_all()

            if self.limit and processed >= self.limit:
                break

            percent = (processed / total_count) * 100 if total_count else 0
            status = (
                f"Refreshing metadata  [{('=' * int(percent // 3)).ljust(36, '-')}]"
                f"  {percent:5.1f}%  Updated: {updated} · Skipped: {skipped} · Failed: {failed}"
            )
            click.echo(status, nl=False, err=True)
            click.echo("\r", nl=False, err=True)

        click.echo()
        click.echo(f"✓ Metadata refresh complete. Updated: {updated} · Skipped: {skipped} · Failed: {failed}")


class BackfillCaptureTimestampCommand(CliCommand):
    """Command to backfill capture timestamps from Dropbox media_info."""

    def __init__(
        self,
        tenant_id: str,
        limit: Optional[int],
        offset: int,
        batch_size: int,
        dry_run: bool
    ):
        super().__init__()
        self.tenant_id = tenant_id
        self.limit = limit
        self.offset = offset
        self.batch_size = batch_size
        self.dry_run = dry_run

    def run(self):
        """Execute backfill capture timestamp command."""
        self.setup_db()
        try:
            self._backfill_capture_timestamp()
        finally:
            self.cleanup_db()

    def _backfill_capture_timestamp(self):
        """Backfill capture_timestamp using Dropbox media_info only."""
        self.tenant = self.load_tenant(self.tenant_id)
        if not self.tenant.dropbox_app_key:
            raise click.ClickException("Dropbox app key not configured for tenant")

        try:
            refresh_token = get_secret(f"dropbox-token-{self.tenant.secret_scope}")
        except Exception as exc:
            raise click.ClickException(f"Dropbox token not found: {exc}")

        try:
            app_secret = get_secret(f"dropbox-app-secret-{self.tenant.secret_scope}")
        except Exception as exc:
            raise click.ClickException(f"Dropbox app secret not found: {exc}")

        dropbox_client = DropboxClient(
            refresh_token=refresh_token,
            app_key=self.tenant.dropbox_app_key,
            app_secret=app_secret,
        )

        base_query = self.db.query(ImageMetadata).filter(
            self.tenant_filter(ImageMetadata),
            ImageMetadata.capture_timestamp.is_(None),
        ).order_by(ImageMetadata.id.desc())

        if self.offset:
            base_query = base_query.offset(self.offset)

        total_count = base_query.count()
        if not total_count:
            click.echo("No images with missing capture timestamps.")
            return

        total_target = min(total_count, self.limit) if self.limit else total_count
        click.echo(f"Backfilling missing media info for {total_target} images...")

        updated = 0
        skipped = 0
        failed = 0
        processed = 0
        last_id = None

        while True:
            query = base_query
            if last_id is not None:
                query = query.filter(ImageMetadata.id < last_id)
            remaining = self.limit - processed if self.limit else None
            if remaining is not None and remaining <= 0:
                break
            batch_size = min(self.batch_size, remaining) if remaining is not None else self.batch_size
            batch = query.limit(batch_size).all()
            if not batch:
                break
            asset_ids = [img.asset_id for img in batch if img.asset_id is not None]
            assets_by_id = {}
            if asset_ids:
                assets = self.db.query(Asset).filter(
                    self.tenant_filter(Asset),
                    Asset.id.in_(asset_ids)
                ).all()
                assets_by_id = {str(asset.id): asset for asset in assets}

            for image in batch:
                processed += 1
                last_id = image.id
                asset = assets_by_id.get(str(image.asset_id)) if image.asset_id is not None else None
                dropbox_refs = _dropbox_refs_for_image(image, asset)

                if not dropbox_refs:
                    skipped += 1
                    continue

                metadata_result = None
                last_exc = None
                for ref in dropbox_refs:
                    try:
                        metadata_result = dropbox_client.get_metadata_with_media_info(ref)
                        break
                    except Exception as exc:
                        last_exc = exc
                        continue

                if metadata_result is None:
                    failed += 1
                    click.echo(f"\nFailed to load Dropbox metadata for {image.id}: {last_exc}")
                    continue

                dropbox_exif = {}
                if hasattr(metadata_result, "media_info") and metadata_result.media_info:
                    media_info = metadata_result.media_info.get_metadata()
                    if hasattr(media_info, "dimensions") and media_info.dimensions:
                        dropbox_exif["ImageWidth"] = media_info.dimensions.width
                        dropbox_exif["ImageLength"] = media_info.dimensions.height
                    if hasattr(media_info, "location") and media_info.location:
                        dropbox_exif["GPSLatitude"] = media_info.location.latitude
                        dropbox_exif["GPSLongitude"] = media_info.location.longitude
                    if hasattr(media_info, "time_taken") and media_info.time_taken:
                        dropbox_exif["DateTimeOriginal"] = media_info.time_taken.isoformat()
                        dropbox_exif["DateTime"] = media_info.time_taken.isoformat()

                dropbox_props = {}
                if hasattr(metadata_result, "property_groups") and metadata_result.property_groups:
                    for prop_group in metadata_result.property_groups:
                        template_name = prop_group.template_id
                        for field in prop_group.fields:
                            dropbox_props[f"{template_name}.{field.name}"] = field.value

                updates = {}
                exif_source = dropbox_exif or (image.exif_data or {})

                if image.capture_timestamp is None:
                    capture_timestamp = parse_exif_datetime(
                        get_exif_value(exif_source, "DateTimeOriginal", "DateTime")
                    )
                    if capture_timestamp:
                        updates["capture_timestamp"] = capture_timestamp

                if image.modified_time is None and hasattr(metadata_result, "server_modified"):
                    updates["modified_time"] = metadata_result.server_modified

                if image.file_size is None and hasattr(metadata_result, "size"):
                    updates["file_size"] = metadata_result.size

                if image.width is None:
                    width = parse_exif_int(get_exif_value(exif_source, "ImageWidth"))
                    if width is not None:
                        updates["width"] = width

                if image.height is None:
                    height = parse_exif_int(get_exif_value(exif_source, "ImageLength"))
                    if height is not None:
                        updates["height"] = height

                if image.gps_latitude is None:
                    gps_latitude = parse_exif_float(get_exif_value(exif_source, "GPSLatitude"))
                    if gps_latitude is not None:
                        updates["gps_latitude"] = gps_latitude

                if image.gps_longitude is None:
                    gps_longitude = parse_exif_float(get_exif_value(exif_source, "GPSLongitude"))
                    if gps_longitude is not None:
                        updates["gps_longitude"] = gps_longitude

                if dropbox_props and not image.dropbox_properties:
                    updates["dropbox_properties"] = dropbox_props

                if dropbox_exif and not image.exif_data:
                    updates["exif_data"] = dropbox_exif

                if not updates:
                    skipped += 1
                    continue

                updated += 1
                if not self.dry_run:
                    for key, value in updates.items():
                        setattr(image, key, value)
                filename = image.filename or "unknown"
                click.echo(f"\nUpdated {image.id} ({filename}): {', '.join(sorted(updates.keys()))}")

            if not self.dry_run:
                self.db.commit()
            self.db.expire_all()

            percent = (processed / total_count) * 100 if total_count else 0
            status = (
                f"Backfilling missing media info  [{('=' * int(percent // 3)).ljust(36, '-')}]"
                f"  {percent:5.1f}%  Updated: {updated} · Skipped: {skipped} · Failed: {failed}"
            )
            click.echo(status, nl=False, err=True)
            click.echo("\r", nl=False, err=True)

        click.echo()
        click.echo(f"✓ Backfill complete. Updated: {updated} · Skipped: {skipped} · Failed: {failed}")
