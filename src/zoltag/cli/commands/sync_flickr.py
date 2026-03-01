"""Flickr synchronization command."""

from __future__ import annotations

import json

import click
from google.cloud import storage

from zoltag.cli.base import CliCommand
from zoltag.dependencies import get_secret
from zoltag.image import is_supported_media_file
from zoltag.integrations import TenantIntegrationRepository
from zoltag.metadata import Asset
from zoltag.metadata import Tenant as TenantModel
from zoltag.settings import settings
from zoltag.storage.providers import FlickrStorageProvider
from zoltag.sync_pipeline import process_storage_entry


@click.command(name="sync-flickr")
@click.option("--tenant-id", default="demo", help="Tenant ID to sync from Flickr")
@click.option("--count", default=500, type=int, help="Number of items to process (useful for incremental syncs)")
@click.option(
    "--reprocess-existing/--no-reprocess-existing",
    default=False,
    help="Reprocess items even if already ingested",
)
@click.option(
    "--provider-id",
    default=None,
    help="Specific provider integration UUID to sync from (omit to sync all active)",
)
def sync_flickr_command(tenant_id: str, count: int, reprocess_existing: bool, provider_id: str | None):
    """Sync photos from Flickr to Zoltag."""
    cmd = SyncFlickrCommand(tenant_id, count, reprocess_existing, provider_id)
    cmd.run()


class SyncFlickrCommand(CliCommand):
    """Command to sync with Flickr."""

    def __init__(self, tenant_id: str, count: int, reprocess_existing: bool, provider_id: str | None = None):
        super().__init__()
        self.tenant_id = tenant_id
        self.count = count
        self.reprocess_existing = reprocess_existing
        self.provider_id = provider_id

    def run(self):
        """Execute sync flickr command."""
        self.setup_db()
        try:
            self._sync_flickr()
        finally:
            self.cleanup_db()

    def _sync_flickr(self):
        """Sync photos from Flickr — all active providers or a specific one."""
        tenant_context = self.load_tenant(self.tenant_id)
        click.echo(f"Syncing from Flickr for tenant: {tenant_context.name}")

        tenant_row = self.db.query(TenantModel).filter(TenantModel.id == tenant_context.id).first()
        if not tenant_row:
            raise click.ClickException(f"Tenant {tenant_context.id} not found in database")

        integration_repo = TenantIntegrationRepository(self.db)

        if self.provider_id:
            record = integration_repo.get_provider_record(tenant_row, "flickr", provider_id=self.provider_id)
            if not bool(getattr(record, "is_active", False)):
                raise click.ClickException(
                    "Provider integration is inactive: Flickr sync is disabled. "
                    "Activate this provider in Admin -> Providers before running sync."
                )
            records = [record]
        else:
            all_records = integration_repo.list_provider_records(tenant_row)
            records = [r for r in all_records if r.provider_type == "flickr"]
            if not records:
                raise click.ClickException("No active Flickr provider integrations found for this tenant.")

        api_key = str(settings.zoltag_flickr_connector_api_key or "").strip()
        if not api_key:
            raise click.ClickException("Flickr API key not configured (uses ZOLTAG_FLICKR_CONNECTOR_API_KEY)")
        api_secret = str(settings.zoltag_flickr_connector_api_secret or "").strip()
        if not api_secret:
            raise click.ClickException("Flickr API secret not configured (uses ZOLTAG_FLICKR_CONNECTOR_API_SECRET)")

        storage_client = storage.Client(project=settings.gcp_project_id)
        thumbnail_bucket = storage_client.bucket(tenant_context.get_thumbnail_bucket(settings))

        total_processed = 0
        for record in records:
            label = record.label or f"Flickr ({record.id})"
            click.echo(f"\n--- Syncing provider: {label} ---")
            processed = self._sync_one_record(
                tenant_context,
                record,
                thumbnail_bucket,
                api_key=api_key,
                api_secret=api_secret,
                remaining=self.count - total_processed,
            )
            total_processed += processed
            if total_processed >= self.count:
                break

        click.echo(f"\n✓ Synced {total_processed} items from Flickr")

    def _sync_one_record(
        self,
        tenant_context,
        flickr_record,
        thumbnail_bucket,
        *,
        api_key: str,
        api_secret: str,
        remaining: int,
    ) -> int:
        """Sync media for a single Flickr provider record. Returns count processed."""
        record_provider_id = flickr_record.id

        try:
            raw_token_payload = str(get_secret(flickr_record.flickr_token_secret_name) or "").strip()
        except Exception as exc:
            click.echo(f"  ✗ No Flickr token found ({exc})", err=True)
            return 0
        if not raw_token_payload:
            click.echo("  ✗ Flickr is not connected for this provider.", err=True)
            return 0

        try:
            token_payload = json.loads(raw_token_payload)
        except Exception:
            click.echo("  ✗ Flickr token payload is invalid JSON.", err=True)
            return 0
        if not isinstance(token_payload, dict):
            click.echo("  ✗ Flickr token payload is invalid.", err=True)
            return 0

        oauth_token = str(token_payload.get("oauth_token") or token_payload.get("token") or "").strip()
        oauth_token_secret = str(token_payload.get("oauth_token_secret") or "").strip()
        user_nsid = str(token_payload.get("user_nsid") or token_payload.get("user_id") or "").strip() or None
        if not oauth_token or not oauth_token_secret:
            click.echo("  ✗ Flickr token payload missing oauth_token / oauth_token_secret.", err=True)
            return 0

        provider = FlickrStorageProvider(
            api_key=api_key,
            api_secret=api_secret,
            oauth_token=oauth_token,
            oauth_token_secret=oauth_token_secret,
            user_nsid=user_nsid,
        )

        sync_albums = list((flickr_record.config_json or {}).get("sync_folders") or [])
        if sync_albums:
            click.echo(f"Sync albums (IDs): {sync_albums}")
        else:
            click.echo("No albums selected — syncing full Flickr photostream")

        processed_keys: set[str] = set()
        if not self.reprocess_existing:
            q = self.db.query(Asset.source_key).filter(
                self.tenant_filter(Asset),
                Asset.source_provider == "flickr",
            )
            processed_keys = {row[0] for row in q.all() if row[0]}

        click.echo("Listing items from Flickr...")
        try:
            all_entries = provider.list_image_entries(sync_folders=sync_albums or None)
        except Exception as exc:
            click.echo(f"  ✗ Failed to list Flickr items: {exc}", err=True)
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
            except Exception as exc:
                click.echo(f"  ✗ Error: {exc}", err=True)
                self.db.rollback()

        return processed
