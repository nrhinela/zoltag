"""Dropbox synchronization command."""

import click

from google.cloud import storage

from photocat.settings import settings
from photocat.dependencies import get_secret
from photocat.metadata import Tenant as TenantModel, ImageMetadata
from photocat.tenant import Tenant, TenantContext
from photocat.dropbox import DropboxClient
from photocat.config.db_config import ConfigManager
from photocat.image import ImageProcessor
from photocat.learning import load_keyword_models
from photocat.sync_pipeline import process_dropbox_entry
from photocat.tagging import get_tagger
from photocat.cli.base import CliCommand


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
        keyword_to_category = {}
        for kw in all_keywords:
            cat = kw['category']
            keyword_to_category[kw['keyword']] = cat
            if cat not in by_category:
                by_category[cat] = []
            by_category[cat].append(kw)

        click.echo(f"Keywords: {len(all_keywords)} in {len(by_category)} categories")

        # Get tagger
        tagger = get_tagger(model_type=self.model)
        model_name = getattr(tagger, "model_name", self.model)

        processed_ids = set(
            row[0]
            for row in self.db.query(ImageMetadata.dropbox_id)
            .filter(ImageMetadata.tenant_id == self.tenant_id)
            .all()
            if row[0]
        )

        storage_client = storage.Client(project=settings.gcp_project_id)
        thumbnail_bucket = storage_client.bucket(tenant_context.get_thumbnail_bucket(settings))
        keyword_models = None
        if settings.use_keyword_models:
            keyword_models = load_keyword_models(self.db, self.tenant_id, model_name)

        # Process images
        processed = 0
        for folder in sync_folders:
            if processed >= self.count:
                break

            click.echo(f"\nListing folder: {folder or '(root)'}")

            # Get list of files in folder
            entries = list(dropbox_client.list_folder(folder, recursive=True))

            click.echo(f"Found {len(entries)} entries")

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

                    result = process_dropbox_entry(
                        db=self.db,
                        tenant=tenant_context,
                        entry=entry,
                        dropbox_client=dropbox_client,
                        thumbnail_bucket=thumbnail_bucket,
                        keywords_by_category=by_category,
                        keyword_to_category=keyword_to_category,
                        keyword_models=keyword_models,
                        model_type=self.model,
                        log=lambda message: click.echo(f"  {message}"),
                    )

                    if result.status == "processed":
                        processed_ids.add(entry.id)
                        click.echo(f"  ✓ Metadata recorded (ID: {result.image_id})")
                        click.echo(f"  ✓ Complete: {result.tags_count} tags applied")
                        processed += 1
                    elif result.status == "skipped":
                        click.echo("  ↪ Already synced, skipping")

                except Exception as e:
                    click.echo(f"  ✗ Error: {e}", err=True)
                    self.db.rollback()

        click.echo(f"\n✓ Synced {processed} images from Dropbox")
