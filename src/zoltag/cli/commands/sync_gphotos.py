"""Google Photos synchronization command."""

import click
from google.cloud import storage

from zoltag.cli.base import CliCommand
from zoltag.dependencies import get_secret
from zoltag.image import is_supported_media_file
from zoltag.integrations import (
    TenantIntegrationRepository,
    normalize_selection_mode,
    normalize_sync_items,
)
from zoltag.metadata import Asset
from zoltag.metadata import Tenant as TenantModel
from zoltag.settings import settings
from zoltag.storage.providers import GooglePhotosStorageProvider
from zoltag.sync_pipeline import process_storage_entry


@click.command(name='sync-gphotos')
@click.option('--tenant-id', default='demo', help='Tenant ID to sync from Google Photos')
@click.option('--count', default=500, type=int, help='Number of items to process (useful for incremental syncs)')
@click.option('--reprocess-existing/--no-reprocess-existing', default=False, help='Reprocess items even if already ingested')
@click.option('--provider-id', default=None, help='Specific provider integration UUID to sync from (omit to sync all active)')
def sync_gphotos_command(tenant_id: str, count: int, reprocess_existing: bool, provider_id: str | None):
    """Sync photos from Google Photos to Zoltag.

    This command:

    1. Connects to tenant's Google Photos account using OAuth credentials
    2. Lists new/changed items from configured albums (or entire library)
    3. Downloads images and creates thumbnails (stored in GCP Cloud Storage)
    4. Extracts image metadata (dimensions, format, embedded EXIF)
    5. Creates/updates Asset records and links ImageMetadata rows

    Artifacts stored: Thumbnails → GCP Cloud Storage (tenant bucket)
    Metadata stored: Database records → PostgreSQL"""
    cmd = SyncGphotosCommand(tenant_id, count, reprocess_existing, provider_id)
    cmd.run()


class SyncGphotosCommand(CliCommand):
    """Command to sync with Google Photos."""

    def __init__(self, tenant_id: str, count: int, reprocess_existing: bool, provider_id: str | None = None):
        super().__init__()
        self.tenant_id = tenant_id
        self.count = count
        self.reprocess_existing = reprocess_existing
        self.provider_id = provider_id

    def run(self):
        """Execute sync gphotos command."""
        self.setup_db()
        try:
            self._sync_gphotos()
        finally:
            self.cleanup_db()

    def _sync_gphotos(self):
        """Sync photos from Google Photos — all active providers or a specific one."""
        tenant_context = self.load_tenant(self.tenant_id)
        click.echo(f"Syncing from Google Photos for tenant: {tenant_context.name}")

        tenant_row = self.db.query(TenantModel).filter(TenantModel.id == tenant_context.id).first()
        if not tenant_row:
            raise click.ClickException(f"Tenant {tenant_context.id} not found in database")

        integration_repo = TenantIntegrationRepository(self.db)

        if self.provider_id:
            record = integration_repo.get_provider_record(tenant_row, "gphotos", provider_id=self.provider_id)
            if not bool(getattr(record, "is_active", False)):
                raise click.ClickException(
                    "Provider integration is inactive: Google Photos sync is disabled. "
                    "Activate this provider in Admin -> Providers before running sync."
                )
            records = [record]
        else:
            all_records = integration_repo.list_provider_records(tenant_row)
            records = [r for r in all_records if r.provider_type == "gphotos"]
            if not records:
                raise click.ClickException("No active Google Photos provider integrations found for this tenant.")

        client_id = str(settings.zoltag_gdrive_connector_client_id or "").strip()
        if not client_id:
            raise click.ClickException("Google Photos client ID not configured (uses ZOLTAG_GDRIVE_CONNECTOR_CLIENT_ID)")

        client_secret = str(settings.zoltag_gdrive_connector_secret or "").strip()
        if not client_secret:
            raise click.ClickException("Google Photos client secret not configured (uses ZOLTAG_GDRIVE_CONNECTOR_SECRET)")

        storage_client = storage.Client(project=settings.gcp_project_id)
        thumbnail_bucket = storage_client.bucket(tenant_context.get_thumbnail_bucket(settings))

        total_processed = 0
        for record in records:
            label = record.label or f"Google Photos ({record.id})"
            click.echo(f"\n--- Syncing provider: {label} ---")
            processed = self._sync_one_record(
                tenant_context, record, thumbnail_bucket,
                client_id=client_id, client_secret=client_secret,
                remaining=self.count - total_processed,
            )
            total_processed += processed
            if total_processed >= self.count:
                break

        click.echo(f"\n✓ Synced {total_processed} items from Google Photos")

    def _sync_one_record(self, tenant_context, gphotos_record, thumbnail_bucket, *, client_id: str, client_secret: str, remaining: int) -> int:
        """Sync photos for a single Google Photos provider record. Returns count processed."""
        record_provider_id = gphotos_record.id

        try:
            refresh_token = get_secret(gphotos_record.gphotos_token_secret_name) or ""
        except Exception as exc:
            click.echo(f"  ✗ No Google Photos refresh token found ({exc})", err=True)
            return 0
        if not refresh_token:
            click.echo("  ✗ Google Photos is not connected for this provider.", err=True)
            return 0

        provider = GooglePhotosStorageProvider(
            client_id=client_id,
            client_secret=client_secret,
            refresh_token=refresh_token,
        )

        config_json = dict(gphotos_record.config_json or {})
        selection_mode = normalize_selection_mode("gphotos", config_json.get("selection_mode"))
        sync_albums = list(config_json.get("sync_folders") or [])
        sync_items = normalize_sync_items(config_json.get("sync_items"))
        picker_session_id = str(config_json.get("picker_session_id") or "").strip()

        selected_item_ids = [str(item.get("id") or "").strip() for item in sync_items if str(item.get("id") or "").strip()]

        if selection_mode == "picker":
            click.echo(f"Selection mode: picker (session {picker_session_id or 'none'})")
            if not picker_session_id:
                click.echo(
                    "  ✗ Picker mode requires picker_session_id. Launch picker and save selections first.",
                    err=True,
                )
                return 0
            if selected_item_ids:
                click.echo(f"Syncing selected media items: {len(selected_item_ids)}")
            else:
                click.echo("No explicit picked media IDs saved; syncing all items visible to picker session.")
        else:
            click.echo("Selection mode: catalog")
            if sync_albums:
                click.echo(f"Sync albums (IDs): {sync_albums}")
            else:
                click.echo("No sync albums configured — listing entire Google Photos library")

        processed_keys: set[str] = set()
        if not self.reprocess_existing:
            q = self.db.query(Asset.source_key).filter(
                self.tenant_filter(Asset),
                Asset.source_provider == "gphotos",
            )
            processed_keys = {row[0] for row in q.all() if row[0]}

        click.echo("Listing items from Google Photos...")
        try:
            if selection_mode == "picker":
                all_entries = provider.list_picker_entries(
                    picker_session_id,
                    picked_media_item_ids=selected_item_ids or None,
                )
            else:
                all_entries = provider.list_image_entries(sync_folders=sync_albums or None)
        except Exception as exc:
            click.echo(f"  ✗ Failed to list Google Photos items: {exc}", err=True)
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

        click.echo(f"Found {len(unprocessed)} unprocessed items")

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
