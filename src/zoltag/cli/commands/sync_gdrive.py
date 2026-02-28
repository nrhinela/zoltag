"""Google Drive synchronization command."""

import click

from google.cloud import storage

from zoltag.settings import settings
from zoltag.dependencies import get_secret
from zoltag.integrations import TenantIntegrationRepository
from zoltag.metadata import Asset, Tenant as TenantModel
from zoltag.image import is_supported_media_file
from zoltag.storage.providers import GoogleDriveStorageProvider
from zoltag.sync_pipeline import process_storage_entry
from zoltag.cli.base import CliCommand


@click.command(name='sync-gdrive')
@click.option('--tenant-id', default='demo', help='Tenant ID to sync from Google Drive')
@click.option('--count', default=500, type=int, help='Number of files to process (useful for incremental syncs)')
@click.option('--reprocess-existing/--no-reprocess-existing', default=False, help='Reprocess files even if already ingested')
@click.option('--provider-id', default=None, help='Specific provider integration UUID to sync from (omit to sync all active)')
def sync_gdrive_command(tenant_id: str, count: int, reprocess_existing: bool, provider_id: str | None):
    """Sync images from Google Drive to GCP Cloud Storage with ingestion-only processing.

    Equivalent to clicking the sync button in the web UI. This command:

    1. Connects to tenant's Google Drive account using OAuth credentials
    2. Lists new/changed files from configured sync folders
    3. Downloads images and creates thumbnails (stored in GCP Cloud Storage)
    4. Extracts image metadata (dimensions, format, embedded EXIF)
    5. Creates/updates Asset records and links ImageMetadata rows

    Artifacts stored: Thumbnails → GCP Cloud Storage (tenant bucket)
    Metadata stored: Database records → PostgreSQL"""
    cmd = SyncGdriveCommand(tenant_id, count, reprocess_existing, provider_id)
    cmd.run()


class SyncGdriveCommand(CliCommand):
    """Command to sync with Google Drive."""

    def __init__(self, tenant_id: str, count: int, reprocess_existing: bool, provider_id: str | None = None):
        super().__init__()
        self.tenant_id = tenant_id
        self.count = count
        self.reprocess_existing = reprocess_existing
        self.provider_id = provider_id

    def run(self):
        """Execute sync gdrive command."""
        self.setup_db()
        try:
            self._sync_gdrive()
        finally:
            self.cleanup_db()

    def _sync_gdrive(self):
        """Sync images from Google Drive — all active providers or a specific one."""
        tenant_context = self.load_tenant(self.tenant_id)
        click.echo(f"Syncing from Google Drive for tenant: {tenant_context.name}")

        tenant_row = self.db.query(TenantModel).filter(TenantModel.id == tenant_context.id).first()
        if not tenant_row:
            raise click.ClickException(f"Tenant {tenant_context.id} not found in database")

        integration_repo = TenantIntegrationRepository(self.db)

        if self.provider_id:
            record = integration_repo.get_provider_record(tenant_row, "gdrive", provider_id=self.provider_id)
            if not bool(getattr(record, "is_active", False)):
                raise click.ClickException(
                    "Provider integration is inactive: Google Drive sync is disabled. "
                    "Activate this provider in Admin -> Providers before running sync."
                )
            records = [record]
        else:
            all_records = integration_repo.list_provider_records(tenant_row)
            records = [r for r in all_records if r.provider_type == "gdrive"]
            if not records:
                raise click.ClickException("No active Google Drive provider integrations found for this tenant.")

        storage_client = storage.Client(project=settings.gcp_project_id)
        thumbnail_bucket = storage_client.bucket(tenant_context.get_thumbnail_bucket(settings))

        total_processed = 0
        for record in records:
            label = record.label or f"Google Drive ({record.id})"
            click.echo(f"\n--- Syncing provider: {label} ---")
            processed = self._sync_one_record(tenant_context, record, thumbnail_bucket, remaining=self.count - total_processed)
            total_processed += processed
            if total_processed >= self.count:
                break

        click.echo(f"\n✓ Synced {total_processed} files from Google Drive")

    def _sync_one_record(self, tenant_context, gdrive_record, thumbnail_bucket, remaining: int) -> int:
        """Sync images for a single Google Drive provider record. Returns count processed."""
        record_provider_id = gdrive_record.id

        client_id = str(settings.zoltag_gdrive_connector_client_id or "").strip() or str(
            (gdrive_record.config_json or {}).get("client_id") or ""
        ).strip()
        if not client_id:
            click.echo("  ✗ Google Drive client ID not configured", err=True)
            return 0

        env_secret = str(settings.zoltag_gdrive_connector_secret or "").strip()
        if env_secret:
            client_secret = env_secret
        else:
            try:
                client_secret = get_secret(gdrive_record.gdrive_client_secret_name) or ""
            except Exception as exc:
                click.echo(f"  ✗ Google Drive client secret not found ({exc})", err=True)
                return 0
        if not client_secret:
            click.echo("  ✗ Google Drive client secret not configured", err=True)
            return 0

        try:
            refresh_token = get_secret(gdrive_record.gdrive_token_secret_name) or ""
        except Exception as exc:
            click.echo(f"  ✗ No Google Drive refresh token found ({exc})", err=True)
            return 0
        if not refresh_token:
            click.echo("  ✗ Google Drive is not connected for this provider.", err=True)
            return 0

        provider = GoogleDriveStorageProvider(
            client_id=client_id,
            client_secret=client_secret,
            refresh_token=refresh_token,
        )

        sync_folders = list((gdrive_record.config_json or {}).get("sync_folders") or [])
        if sync_folders:
            click.echo(f"Sync folders (IDs): {sync_folders}")
        else:
            click.echo("No sync folders configured — listing entire Drive")

        processed_keys: set[str] = set()
        if not self.reprocess_existing:
            q = self.db.query(Asset.source_key).filter(
                self.tenant_filter(Asset),
                Asset.source_provider == "gdrive",
            )
            processed_keys = set(row[0] for row in q.all() if row[0])

        click.echo("Listing files from Google Drive...")
        try:
            all_entries = provider.list_image_entries(sync_folders=sync_folders or None)
        except Exception as exc:
            click.echo(f"  ✗ Failed to list Google Drive files: {exc}", err=True)
            return 0

        click.echo(f"Found {len(all_entries)} total entries")

        unprocessed = []
        for entry in all_entries:
            if not is_supported_media_file(entry.name, entry.mime_type):
                continue
            if not self.reprocess_existing and entry.source_key in processed_keys:
                continue
            unprocessed.append(entry)
            if len(unprocessed) >= remaining:
                break

        click.echo(f"Found {len(unprocessed)} unprocessed files")

        processed = 0
        for entry in unprocessed:
            if processed >= remaining:
                break

            try:
                click.echo(f"\nProcessing: {entry.display_path or entry.name} ({entry.source_key})")

                result = process_storage_entry(
                    db=self.db,
                    tenant=tenant_context,
                    entry=entry,
                    provider=provider,
                    thumbnail_bucket=thumbnail_bucket,
                    reprocess_existing=self.reprocess_existing,
                    provider_id=record_provider_id,
                    log=lambda message: click.echo(f"  {message}"),
                )

                if result.status == "processed":
                    processed_keys.add(entry.source_key)
                    click.echo(f"  ✓ Metadata + asset recorded (ID: {result.image_id})")
                    processed += 1
                elif result.status == "skipped":
                    click.echo("  ↪ Already synced, skipping")

            except Exception as e:
                click.echo(f"  ✗ Error: {e}", err=True)
                self.db.rollback()

        return processed
