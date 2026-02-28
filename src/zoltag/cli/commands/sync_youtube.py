"""YouTube synchronization command."""

import click
from google.cloud import storage

from zoltag.settings import settings
from zoltag.dependencies import get_secret
from zoltag.integrations import TenantIntegrationRepository
from zoltag.metadata import Asset, Tenant as TenantModel
from zoltag.storage.providers import YouTubeStorageProvider
from zoltag.sync_pipeline import process_storage_entry
from zoltag.cli.base import CliCommand


@click.command(name='sync-youtube')
@click.option('--tenant-id', default='demo', help='Tenant ID to sync from YouTube')
@click.option('--count', default=500, type=int, help='Number of videos to process (useful for incremental syncs)')
@click.option('--reprocess-existing/--no-reprocess-existing', default=False, help='Reprocess videos even if already ingested')
@click.option('--provider-id', default=None, help='Specific provider integration UUID to sync from (omit to sync all active)')
def sync_youtube_command(tenant_id: str, count: int, reprocess_existing: bool, provider_id: str | None):
    """Sync videos from YouTube to Zoltag.

    This command:

    1. Connects to tenant's YouTube account using OAuth credentials
    2. Lists new/changed videos from configured playlists (or all uploads)
    3. Creates Asset + ImageMetadata records (no GCS upload — YouTube videos stream via IFrame)

    Metadata stored: Database records → PostgreSQL"""
    cmd = SyncYoutubeCommand(tenant_id, count, reprocess_existing, provider_id)
    cmd.run()


class SyncYoutubeCommand(CliCommand):
    """Command to sync with YouTube."""

    def __init__(self, tenant_id: str, count: int, reprocess_existing: bool, provider_id: str | None = None):
        super().__init__()
        self.tenant_id = tenant_id
        self.count = count
        self.reprocess_existing = reprocess_existing
        self.provider_id = provider_id

    def run(self):
        """Execute sync youtube command."""
        self.setup_db()
        try:
            self._sync_youtube()
        finally:
            self.cleanup_db()

    def _sync_youtube(self):
        """Sync videos from YouTube — all active providers or a specific one."""
        tenant_context = self.load_tenant(self.tenant_id)
        click.echo(f"Syncing from YouTube for tenant: {tenant_context.name}")

        tenant_row = self.db.query(TenantModel).filter(TenantModel.id == tenant_context.id).first()
        if not tenant_row:
            raise click.ClickException(f"Tenant {tenant_context.id} not found in database")

        integration_repo = TenantIntegrationRepository(self.db)

        if self.provider_id:
            record = integration_repo.get_provider_record(tenant_row, "youtube", provider_id=self.provider_id)
            if not bool(getattr(record, "is_active", False)):
                raise click.ClickException(
                    "Provider integration is inactive: YouTube sync is disabled. "
                    "Activate this provider in Admin -> Providers before running sync."
                )
            records = [record]
        else:
            all_records = integration_repo.list_provider_records(tenant_row)
            records = [r for r in all_records if r.provider_type == "youtube"]
            if not records:
                raise click.ClickException("No active YouTube provider integrations found for this tenant.")

        client_id = str(settings.zoltag_gdrive_connector_client_id or "").strip()
        if not client_id:
            raise click.ClickException("YouTube client ID not configured (uses ZOLTAG_GDRIVE_CONNECTOR_CLIENT_ID)")

        client_secret = str(settings.zoltag_gdrive_connector_secret or "").strip()
        if not client_secret:
            raise click.ClickException("YouTube client secret not configured (uses ZOLTAG_GDRIVE_CONNECTOR_SECRET)")

        storage_client = storage.Client(project=settings.gcp_project_id)
        thumbnail_bucket = storage_client.bucket(tenant_context.get_thumbnail_bucket(settings))

        total_processed = 0
        for record in records:
            label = record.label or f"YouTube ({record.id})"
            click.echo(f"\n--- Syncing provider: {label} ---")
            processed = self._sync_one_record(
                tenant_context, record, thumbnail_bucket,
                client_id=client_id, client_secret=client_secret,
                remaining=self.count - total_processed,
            )
            total_processed += processed
            if total_processed >= self.count:
                break

        click.echo(f"\n✓ Synced {total_processed} videos from YouTube")

    def _sync_one_record(self, tenant_context, youtube_record, thumbnail_bucket, *, client_id: str, client_secret: str, remaining: int) -> int:
        """Sync videos for a single YouTube provider record. Returns count processed."""
        record_provider_id = youtube_record.id

        try:
            refresh_token = get_secret(youtube_record.youtube_token_secret_name) or ""
        except Exception as exc:
            click.echo(f"  ✗ No YouTube refresh token found ({exc})", err=True)
            return 0
        if not refresh_token:
            click.echo("  ✗ YouTube is not connected for this provider.", err=True)
            return 0

        provider = YouTubeStorageProvider(
            client_id=client_id,
            client_secret=client_secret,
            refresh_token=refresh_token,
        )

        sync_playlists = list((youtube_record.config_json or {}).get("sync_folders") or [])
        if sync_playlists:
            click.echo(f"Sync playlists (IDs): {sync_playlists}")
        else:
            click.echo("No sync playlists configured — listing all uploads from channel")

        processed_keys: set[str] = set()
        if not self.reprocess_existing:
            q = self.db.query(Asset.source_key).filter(
                self.tenant_filter(Asset),
                Asset.source_provider == "youtube",
            )
            processed_keys = set(row[0] for row in q.all() if row[0])

        click.echo("Listing videos from YouTube...")
        try:
            all_entries = provider.list_image_entries(sync_folders=sync_playlists or None)
        except Exception as exc:
            click.echo(f"  ✗ Failed to list YouTube videos: {exc}", err=True)
            return 0

        click.echo(f"Found {len(all_entries)} total entries")

        unprocessed = []
        for entry in all_entries:
            if not self.reprocess_existing and entry.source_key in processed_keys:
                continue
            unprocessed.append(entry)
            if len(unprocessed) >= remaining:
                break

        click.echo(f"Found {len(unprocessed)} unprocessed videos")

        processed = 0
        for entry in unprocessed:
            if processed >= remaining:
                break

            try:
                click.echo(f"\nProcessing: {entry.name} ({entry.source_key})")

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
                    click.echo(f"  ✓ Metadata recorded (ID: {result.image_id})")
                    processed += 1
                elif result.status == "skipped":
                    click.echo("  ↪ Already synced, skipping")

            except Exception as e:
                click.echo(f"  ✗ Error: {e}", err=True)
                self.db.rollback()

        return processed
