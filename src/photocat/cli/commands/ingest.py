"""Image ingestion command."""

import click
from pathlib import Path
from google.cloud import storage

from photocat.settings import settings
from photocat.config.db_config import ConfigManager
from photocat.image import ImageProcessor
from photocat.exif import (
    get_exif_value,
    parse_exif_datetime,
    parse_exif_float,
    parse_exif_int,
    parse_exif_str,
)
from photocat.metadata import ImageMetadata
from photocat.cli.base import CliCommand


@click.command(name='ingest')
@click.argument('directory', type=click.Path(exists=True))
@click.option('--tenant-id', default='demo', help='Tenant ID to use')
@click.option('--recursive/--no-recursive', default=True, help='Process subdirectories')
def ingest_command(directory: str, tenant_id: str, recursive: bool):
    """Ingest images from a local directory."""
    cmd = IngestCommand(directory, tenant_id, recursive)
    cmd.run()


class IngestCommand(CliCommand):
    """Command to ingest images from a local directory."""

    def __init__(self, directory: str, tenant_id: str, recursive: bool):
        super().__init__()
        self.directory = directory
        self.tenant_id = tenant_id
        self.recursive = recursive
        self.storage_client = None
        self.bucket = None
        self.thumbnail_bucket = None
        self.processor = None

    def run(self):
        """Execute ingest command."""
        self.setup_db()
        try:
            self.tenant = self.load_tenant(self.tenant_id)
            self._setup_storage()
            self._process_images()
            self.db.commit()
            click.echo(f"\n✓ Successfully processed images from {self.directory}")
        except Exception as e:
            click.echo(f"\n✗ Error during ingestion: {e}", err=True)
            raise
        finally:
            self.cleanup_db()

    def _setup_storage(self):
        """Setup Google Cloud Storage client and buckets."""
        click.echo(f"Using tenant: {self.tenant.name}")
        click.echo(f"  Storage bucket: {self.tenant.get_storage_bucket(settings)}")
        click.echo(f"  Thumbnail bucket: {self.tenant.get_thumbnail_bucket(settings)}")

        # Load tenant config from DB
        config_mgr = ConfigManager(self.db, self.tenant_id)
        keywords = config_mgr.get_all_keywords()
        people = config_mgr.get_people()
        click.echo(f"  Keywords: {len(keywords)} total")
        click.echo(f"  People: {len(people)}")

        # Setup storage client
        self.storage_client = storage.Client(project=settings.gcp_project_id)
        self.bucket = self.storage_client.bucket(self.tenant.get_storage_bucket(settings))
        self.thumbnail_bucket = self.storage_client.bucket(self.tenant.get_thumbnail_bucket(settings))

        # Setup image processor
        self.processor = ImageProcessor(thumbnail_size=(settings.thumbnail_size, settings.thumbnail_size))

    def _process_images(self):
        """Find and process all images in directory."""
        # Find images
        dir_path = Path(self.directory)
        pattern = '**/*' if self.recursive else '*'

        image_files = []
        for ext in self.processor.SUPPORTED_FORMATS:
            image_files.extend(dir_path.glob(f"{pattern}{ext}"))
            image_files.extend(dir_path.glob(f"{pattern}{ext.upper()}"))

        click.echo(f"\nFound {len(image_files)} images in {self.directory}")

        if not image_files:
            click.echo("No images found!")
            return

        # Process each image
        with click.progressbar(image_files, label='Processing images') as bar:
            for image_path in bar:
                try:
                    self._process_single_image(image_path)
                except Exception as e:
                    click.echo(f"\nError processing {image_path.name}: {e}", err=True)

    def _process_single_image(self, image_path: Path):
        """Process a single image file."""
        # Read image data
        with open(image_path, 'rb') as f:
            image_data = f.read()

        # Extract features
        features = self.processor.extract_features(image_data)

        # Upload thumbnail to Cloud Storage
        thumbnail_path = f"{self.tenant.id}/thumbnails/{image_path.stem}_thumb.jpg"
        blob = self.thumbnail_bucket.blob(thumbnail_path)
        blob.upload_from_string(features['thumbnail'], content_type='image/jpeg')

        # Create metadata record
        exif = features['exif']
        capture_timestamp = parse_exif_datetime(get_exif_value(exif, "DateTimeOriginal", "DateTime"))
        gps_latitude = parse_exif_float(get_exif_value(exif, "GPSLatitude"))
        gps_longitude = parse_exif_float(get_exif_value(exif, "GPSLongitude"))
        iso = parse_exif_int(get_exif_value(exif, "ISOSpeedRatings", "ISOSpeed", "ISO"))
        aperture = parse_exif_float(get_exif_value(exif, "FNumber", "ApertureValue"))
        shutter_speed = parse_exif_str(get_exif_value(exif, "ExposureTime", "ShutterSpeedValue"))
        focal_length = parse_exif_float(get_exif_value(exif, "FocalLength"))

        metadata = ImageMetadata(
            tenant_id=self.tenant.id,
            dropbox_path=f"/local/{image_path.relative_to(image_path.parent.parent)}",
            dropbox_id=f"local_{image_path.stem}",
            filename=image_path.name,
            file_size=image_path.stat().st_size,
            content_hash=None,
            width=features['width'],
            height=features['height'],
            format=features['format'],
            perceptual_hash=features['perceptual_hash'],
            color_histogram=features['color_histogram'],
            exif_data=exif,
            camera_make=exif.get('Make'),
            camera_model=exif.get('Model'),
            lens_model=exif.get('LensModel'),
            capture_timestamp=capture_timestamp,
            gps_latitude=gps_latitude,
            gps_longitude=gps_longitude,
            iso=iso,
            aperture=aperture,
            shutter_speed=shutter_speed,
            focal_length=focal_length,
        )

        self.db.add(metadata)
