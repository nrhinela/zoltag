"""Dropbox synchronization command."""

import click

import io
from pathlib import Path
from google.cloud import storage
from photocat.settings import settings
from photocat.dependencies import get_secret
from photocat.metadata import Tenant as TenantModel, ImageMetadata, MachineTag
from photocat.tenant import Tenant, TenantContext
from photocat.dropbox import DropboxClient
from photocat.config.db_config import ConfigManager
from photocat.image import ImageProcessor
from photocat.learning import ensure_image_embedding, score_keywords_for_categories
from photocat.models.config import Keyword
from photocat.tagging import get_tagger
from photocat.cli.base import CliCommand
from PIL import Image


@click.command(name='sync-dropbox')
@click.option('--tenant-id', default='demo', help='Tenant ID to sync from Dropbox')
@click.option('--count', default=1, type=int, help='Number of sync iterations to perform (useful for incremental syncs)')
def sync_dropbox_command(tenant_id: str, count: int):
    """Sync images from Dropbox to GCP Cloud Storage with full processing pipeline.

    Equivalent to clicking the sync button in the web UI. This command:

    1. Connects to tenant's Dropbox account using OAuth credentials
    2. Lists new/changed files from configured sync folders
    3. Downloads images and creates thumbnails (stored in GCP Cloud Storage)
    4. Extracts image metadata (dimensions, format, embedded EXIF)
    5. Computes image embeddings using ML models for visual search
    6. Applies configured keywords to images based on ML tagging models
    7. Stores all metadata and tags in PostgreSQL database

    Artifacts stored: Image files and thumbnails → GCP Cloud Storage (tenant bucket)
    Metadata stored: Database records → PostgreSQL"""
    cmd = SyncDropboxCommand(tenant_id, count)
    cmd.run()


class SyncDropboxCommand(CliCommand):
    """Command to sync with Dropbox."""

    def __init__(self, tenant_id: str, count: int):
        super().__init__()
        self.tenant_id = tenant_id
        self.count = count
        self.model = settings.tagging_model

    def run(self):
        """Execute sync dropbox command."""
        self.setup_db()
        try:
            self._sync_dropbox()
        finally:
            self.cleanup_db()

    def _sync_dropbox(self):
        """Sync images from Dropbox."""
        # Load tenant
        tenant = self.db.query(TenantModel).filter(TenantModel.id == self.tenant_id).first()
        if not tenant:
            click.echo(f"Error: Tenant {self.tenant_id} not found", err=True)
            return

        tenant_context = Tenant(
            id=tenant.id,
            name=tenant.name,
            storage_bucket=tenant.storage_bucket,
            thumbnail_bucket=tenant.thumbnail_bucket
        )
        TenantContext.set(tenant_context)

        click.echo(f"Syncing from Dropbox for tenant: {tenant.name}")

        # Get Dropbox credentials
        try:
            dropbox_token = get_secret(f"dropbox-token-{self.tenant_id}")
        except Exception as exc:
            click.echo(f"Error: No Dropbox refresh token configured ({exc})", err=True)
            return
        if not tenant.dropbox_app_key:
            click.echo("Error: Dropbox app key not configured", err=True)
            return
        try:
            dropbox_app_secret = get_secret(f"dropbox-app-secret-{self.tenant_id}")
        except Exception as exc:
            click.echo(f"Error: Dropbox app secret not configured ({exc})", err=True)
            return

        # Initialize Dropbox client
        dropbox_client = DropboxClient(
            refresh_token=dropbox_token,
            app_key=tenant.dropbox_app_key,
            app_secret=dropbox_app_secret,
        )

        # Get sync folders from tenant config or use root
        config_mgr = ConfigManager(self.db, self.tenant_id)
        sync_folders = (tenant.settings or {}).get('dropbox_sync_folders', [])

        if not sync_folders:
            sync_folders = ['']  # Root if no folders configured

        click.echo(f"Sync folders: {sync_folders}")

        # Get all keywords
        all_keywords = config_mgr.get_all_keywords()
        if not all_keywords:
            click.echo("Error: No keywords configured", err=True)
            return

        # Group keywords by category
        by_category = {}
        for kw in all_keywords:
            cat = kw['category']
            if cat not in by_category:
                by_category[cat] = []
            by_category[cat].append(kw)

        click.echo(f"Keywords: {len(all_keywords)} in {len(by_category)} categories")

        # Get tagger
        tagger = get_tagger(model_type=self.model)
        model_name = getattr(tagger, "model_name", self.model)
        model_version = getattr(tagger, "model_version", model_name)

        processed_ids = set(
            row[0]
            for row in self.db.query(ImageMetadata.dropbox_id)
            .filter(ImageMetadata.tenant_id == self.tenant_id)
            .all()
            if row[0]
        )

        storage_client = storage.Client(project=settings.gcp_project_id)
        thumbnail_bucket = storage_client.bucket(tenant_context.get_thumbnail_bucket(settings))

        # Process images
        processed = 0
        for folder in sync_folders:
            if processed >= self.count:
                break

            click.echo(f"\nListing folder: {folder or '(root)'}")

            # Get list of files in folder
            entries = list(dropbox_client.list_folder(folder, recursive=True))

            click.echo(f"Found {len(entries)} entries")

            # Filter to image files
            processor = ImageProcessor()
            unprocessed = []
            remaining = max(self.count - processed, 0)
            total_entries = len(entries)
            click.echo(f"Scanning {total_entries} entries for unprocessed images...")

            for index, entry in enumerate(entries, start=1):
                if index % 500 == 0:
                    click.echo(f"  Scanned {index}/{total_entries} entries...")
                if not processor.is_supported(entry.name):
                    continue
                dropbox_id = entry.id
                if not dropbox_id or dropbox_id in processed_ids:
                    continue
                unprocessed.append(entry)
                if len(unprocessed) >= remaining:
                    break

            click.echo(f"Found {len(unprocessed)} unprocessed images")

            # Process images one by one
            for entry in unprocessed:
                if processed >= self.count:
                    break

                try:
                    dropbox_path = entry.path_display
                    click.echo(f"\nProcessing: {dropbox_path}")

                    # Download thumbnail
                    thumbnail_data = dropbox_client.get_thumbnail(dropbox_path, size='w640h480')
                    if not thumbnail_data:
                        click.echo(f"  ✗ Failed to download thumbnail", err=True)
                        continue

                    # Extract features
                    processor = ImageProcessor()
                    features = processor.extract_features(thumbnail_data)

                    click.echo(f"  Dimensions: {features['width']}x{features['height']}")

                    # Extract EXIF and other metadata
                    exif = {}
                    try:
                        img_pil = Image.open(io.BytesIO(thumbnail_data))
                        exif_data = img_pil._getexif() if hasattr(img_pil, '_getexif') else None
                        if exif_data:
                            from PIL.ExifTags import TAGS
                            exif = {TAGS.get(k, k): v for k, v in exif_data.items()}
                    except Exception:
                        pass

                    # Create metadata record
                    thumbnail_filename = f"{Path(entry.name).stem}_thumb.jpg"
                    thumbnail_path = tenant_context.get_storage_path(thumbnail_filename, "thumbnails")
                    blob = thumbnail_bucket.blob(thumbnail_path)
                    blob.cache_control = "public, max-age=31536000, immutable"
                    blob.upload_from_string(features['thumbnail'], content_type='image/jpeg')

                    metadata = ImageMetadata(
                        tenant_id=self.tenant_id,
                        filename=entry.name,
                        dropbox_id=entry.id,
                        dropbox_path=dropbox_path,
                        file_size=entry.size,
                        modified_time=entry.server_modified,
                        width=features['width'],
                        height=features['height'],
                        format=features['format'],
                        perceptual_hash=features['perceptual_hash'],
                        color_histogram=features['color_histogram'],
                        exif_data=exif,
                        thumbnail_path=thumbnail_path,
                        embedding_generated=False,
                        faces_detected=False,
                        tags_applied=False,
                    )
                    self.db.add(metadata)
                    self.db.commit()
                    self.db.refresh(metadata)
                    processed_ids.add(entry.id)

                    click.echo(f"  ✓ Metadata recorded (ID: {metadata.id})")

                    try:
                        ensure_image_embedding(
                            self.db,
                            self.tenant_id,
                            metadata.id,
                            thumbnail_data,
                            model_name,
                            model_version
                        )
                        self.db.commit()
                    except Exception as embed_error:
                        click.echo(f"  ✗ Embedding error: {embed_error}", err=True)

                    # Tag with model
                    click.echo(f"  Running {self.model} inference...")

                    # Delete existing tags
                    self.db.query(MachineTag).filter(
                        MachineTag.image_id == metadata.id,
                        MachineTag.tag_type == 'siglip'
                    ).delete()

                    # Score keywords
                    all_tags = score_keywords_for_categories(
                        image_data=thumbnail_data,
                        keywords_by_category=by_category,
                        model_type=self.model,
                        threshold=0.15
                    )

                    click.echo(f"  Found {len(all_tags)} tags")

                    # Create tag records
                    for keyword_str, confidence in all_tags:
                        keyword_record = self.db.query(Keyword).filter(
                            Keyword.tenant_id == self.tenant_id,
                            Keyword.keyword == keyword_str
                        ).first()

                        if not keyword_record:
                            continue

                        tag = MachineTag(
                            image_id=metadata.id,
                            tenant_id=self.tenant_id,
                            keyword_id=keyword_record.id,
                            confidence=confidence,
                            tag_type='siglip',
                            model_name=model_name,
                            model_version=model_version
                        )
                        self.db.add(tag)

                    metadata.tags_applied = len(all_tags) > 0
                    self.db.commit()

                    click.echo(f"  ✓ Complete: {len(all_tags)} tags applied")
                    processed += 1

                except Exception as e:
                    click.echo(f"  ✗ Error: {e}", err=True)
                    self.db.rollback()

        click.echo(f"\n✓ Synced {processed} images from Dropbox")
