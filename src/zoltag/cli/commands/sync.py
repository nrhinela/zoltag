"""Dropbox synchronization command."""

import click

from google.cloud import storage

from zoltag.settings import settings
from zoltag.dependencies import get_secret
from zoltag.metadata import Asset
from zoltag.dropbox import DropboxClient
from zoltag.dropbox_oauth import load_dropbox_oauth_credentials
from zoltag.image import is_supported_media_file
from zoltag.sync_pipeline import process_dropbox_entry
from zoltag.cli.base import CliCommand


@click.command(name='sync-dropbox')
@click.option('--tenant-id', default='demo', help='Tenant ID to sync from Dropbox')
@click.option('--count', default=500, type=int, help='Number of sync iterations to perform (useful for incremental syncs)')
@click.option('--reprocess-existing/--no-reprocess-existing', default=False, help='Reprocess images even if already ingested')
def sync_dropbox_command(tenant_id: str, count: int, reprocess_existing: bool):
    """Sync images from Dropbox to GCP Cloud Storage with ingestion-only processing.

    Equivalent to clicking the sync button in the web UI. This command:

    1. Connects to tenant's Dropbox account using OAuth credentials
    2. Lists new/changed files from configured sync folders
    3. Downloads images and creates thumbnails (stored in GCP Cloud Storage)
    4. Extracts image metadata (dimensions, format, embedded EXIF)
    5. Creates/updates Asset records and links ImageMetadata rows

    Artifacts stored: Thumbnails → GCP Cloud Storage (tenant bucket)
    Metadata stored: Database records → PostgreSQL"""
    cmd = SyncDropboxCommand(tenant_id, count, reprocess_existing)
    cmd.run()


class SyncDropboxCommand(CliCommand):
    """Command to sync with Dropbox."""

    def __init__(self, tenant_id: str, count: int, reprocess_existing: bool):
        super().__init__()
        self.tenant_id = tenant_id
        self.count = count
        self.reprocess_existing = reprocess_existing

    def run(self):
        """Execute sync dropbox command."""
        self.setup_db()
        try:
            self._sync_dropbox()
        finally:
            self.cleanup_db()

    def _sync_dropbox(self):
        """Sync images from Dropbox."""
        tenant_context = self.load_tenant(self.tenant_id)
        click.echo(f"Syncing from Dropbox for tenant: {tenant_context.name}")

        # Get Dropbox credentials
        try:
            dropbox_token = get_secret(
                str(tenant_context.dropbox_token_secret or f"dropbox-token-{tenant_context.secret_scope}")
            )
        except Exception as exc:
            click.echo(f"Error: No Dropbox refresh token configured ({exc})", err=True)
            return
        try:
            credentials = load_dropbox_oauth_credentials(
                tenant_id=tenant_context.secret_scope,
                tenant_app_key=tenant_context.dropbox_app_key,
                tenant_app_secret_name=tenant_context.dropbox_app_secret,
                get_secret=get_secret,
                selection_mode="managed_only",
            )
        except ValueError as exc:
            click.echo(f"Error: {exc}", err=True)
            return

        # Initialize Dropbox client
        dropbox_client = DropboxClient(
            refresh_token=dropbox_token,
            app_key=credentials["app_key"],
            app_secret=credentials["app_secret"],
        )

        # Get sync folders from tenant config or use root
        sync_folders = list(tenant_context.dropbox_sync_folders or [])

        if not sync_folders:
            sync_folders = ['']  # Root if no folders configured

        click.echo(f"Sync folders: {sync_folders}")

        processed_paths = set()
        if not self.reprocess_existing:
            processed_paths = set(
                row[0]
                for row in self.db.query(Asset.source_key)
                .filter(
                    self.tenant_filter(Asset),
                    Asset.source_provider == "dropbox",
                )
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

            unprocessed = []
            remaining = max(self.count - processed, 0)
            total_entries = len(entries)
            click.echo(f"Scanning {total_entries} entries for unprocessed images...")

            for index, entry in enumerate(entries, start=1):
                if index % 500 == 0:
                    click.echo(f"  Scanned {index}/{total_entries} entries...")
                if not is_supported_media_file(entry.name, None):
                    continue
                dropbox_path = entry.path_display
                if not dropbox_path:
                    continue
                if not self.reprocess_existing and dropbox_path in processed_paths:
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
                        reprocess_existing=self.reprocess_existing,
                        log=lambda message: click.echo(f"  {message}"),
                    )

                    if result.status == "processed":
                        if entry.path_display:
                            processed_paths.add(entry.path_display)
                        click.echo(f"  ✓ Metadata + asset recorded (ID: {result.image_id})")
                        processed += 1
                    elif result.status == "skipped":
                        click.echo("  ↪ Already synced, skipping")

                except Exception as e:
                    click.echo(f"  ✗ Error: {e}", err=True)
                    self.db.rollback()

        click.echo(f"\n✓ Synced {processed} images from Dropbox")
