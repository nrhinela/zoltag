"""Dropbox synchronization command."""

import uuid as _uuid_mod

import click
from dropbox.exceptions import ApiError

from google.cloud import storage

from zoltag.settings import settings
from zoltag.dependencies import get_secret
from zoltag.integrations import TenantIntegrationRepository
from zoltag.metadata import Asset, Tenant as TenantModel
from zoltag.dropbox import DropboxClient
from zoltag.dropbox_oauth import load_dropbox_oauth_credentials
from zoltag.image import is_supported_media_file
from zoltag.sync_pipeline import process_dropbox_entry
from zoltag.cli.base import CliCommand


def _format_folder_listing_error(folder: str, exc: Exception) -> str:
    folder_label = folder or "/"
    if isinstance(exc, ApiError):
        error_obj = getattr(exc, "error", None)
        try:
            if error_obj and error_obj.is_path():
                lookup_error = error_obj.get_path()
                if lookup_error.is_not_found():
                    return f"Configured Dropbox folder not found: {folder_label}"
                if lookup_error.is_not_folder():
                    return f"Configured Dropbox path is not a folder: {folder_label}"
        except Exception:
            # Fall through to generic message when SDK error parsing changes.
            pass

    text = str(exc).strip()
    if "not_found" in text.lower():
        return f"Configured Dropbox folder not found: {folder_label}"
    return f"Failed to list Dropbox folder {folder_label}: {text or exc.__class__.__name__}"


@click.command(name='sync-dropbox')
@click.option('--tenant-id', default='demo', help='Tenant ID to sync from Dropbox')
@click.option('--count', default=500, type=int, help='Number of sync iterations to perform (useful for incremental syncs)')
@click.option('--reprocess-existing/--no-reprocess-existing', default=False, help='Reprocess images even if already ingested')
@click.option('--provider-id', default=None, help='Specific provider integration UUID to sync from (omit to sync all active)')
def sync_dropbox_command(tenant_id: str, count: int, reprocess_existing: bool, provider_id: str | None):
    """Sync images from Dropbox to GCP Cloud Storage with ingestion-only processing.

    Equivalent to clicking the sync button in the web UI. This command:

    1. Connects to tenant's Dropbox account using OAuth credentials
    2. Lists new/changed files from configured sync folders
    3. Downloads images and creates thumbnails (stored in GCP Cloud Storage)
    4. Extracts image metadata (dimensions, format, embedded EXIF)
    5. Creates/updates Asset records and links ImageMetadata rows

    Artifacts stored: Thumbnails → GCP Cloud Storage (tenant bucket)
    Metadata stored: Database records → PostgreSQL"""
    cmd = SyncDropboxCommand(tenant_id, count, reprocess_existing, provider_id)
    cmd.run()


class SyncDropboxCommand(CliCommand):
    """Command to sync with Dropbox."""

    def __init__(self, tenant_id: str, count: int, reprocess_existing: bool, provider_id: str | None = None):
        super().__init__()
        self.tenant_id = tenant_id
        self.count = count
        self.reprocess_existing = reprocess_existing
        self.provider_id = provider_id

    def run(self):
        """Execute sync dropbox command."""
        self.setup_db()
        try:
            self._sync_dropbox()
        finally:
            self.cleanup_db()

    def _sync_dropbox(self):
        """Sync images from Dropbox — all active providers or a specific one."""
        tenant_context = self.load_tenant(self.tenant_id)
        click.echo(f"Syncing from Dropbox for tenant: {tenant_context.name}")

        tenant_row = self.db.query(TenantModel).filter(TenantModel.id == tenant_context.id).first()
        if not tenant_row:
            raise click.ClickException(f"Tenant {tenant_context.id} not found in database")

        integration_repo = TenantIntegrationRepository(self.db)

        if self.provider_id:
            # Single specific provider
            record = integration_repo.get_provider_record(tenant_row, "dropbox", provider_id=self.provider_id)
            if not bool(getattr(record, "is_active", False)):
                raise click.ClickException(
                    "Provider integration is inactive: Dropbox sync is disabled. "
                    "Activate this provider in Admin -> Providers before running sync."
                )
            records = [record]
        else:
            # All active Dropbox providers
            all_records = integration_repo.list_provider_records(tenant_row)
            records = [r for r in all_records if r.provider_type == "dropbox"]
            if not records:
                raise click.ClickException("No active Dropbox provider integrations found for this tenant.")

        storage_client = storage.Client(project=settings.gcp_project_id)
        thumbnail_bucket = storage_client.bucket(tenant_context.get_thumbnail_bucket(settings))

        total_processed = 0
        for record in records:
            label = record.label or f"Dropbox ({record.id})"
            click.echo(f"\n--- Syncing provider: {label} ---")
            processed = self._sync_one_record(tenant_context, record, thumbnail_bucket, remaining=self.count - total_processed)
            total_processed += processed
            if total_processed >= self.count:
                break

        click.echo(f"\n✓ Synced {total_processed} images from Dropbox")

    def _sync_one_record(self, tenant_context, dropbox_record, thumbnail_bucket, remaining: int) -> int:
        """Sync images for a single Dropbox provider record. Returns count processed."""
        record_provider_id = dropbox_record.id

        try:
            dropbox_token = get_secret(dropbox_record.dropbox_token_secret_name)
        except Exception as exc:
            click.echo(f"  ✗ No Dropbox refresh token configured ({exc})", err=True)
            return 0
        try:
            credentials = load_dropbox_oauth_credentials(
                tenant_id=dropbox_record.secret_scope,
                tenant_app_key=str((dropbox_record.config_json or {}).get("app_key") or "").strip(),
                tenant_app_secret_name=dropbox_record.dropbox_app_secret_name,
                get_secret=get_secret,
                selection_mode="managed_only",
            )
        except ValueError as exc:
            click.echo(f"  ✗ Dropbox OAuth credentials error: {exc}", err=True)
            return 0

        dropbox_client = DropboxClient(
            refresh_token=dropbox_token,
            app_key=credentials["app_key"],
            app_secret=credentials["app_secret"],
        )

        sync_folders = list((dropbox_record.config_json or {}).get("sync_folders") or [])
        if not sync_folders:
            sync_folders = ['']  # Root if no folders configured

        click.echo(f"Sync folders: {sync_folders}")

        _pid = _uuid_mod.UUID(str(record_provider_id)) if record_provider_id else None

        processed_paths: set[str] = set()
        if not self.reprocess_existing:
            q = self.db.query(Asset.source_key).filter(
                self.tenant_filter(Asset),
                Asset.source_provider == "dropbox",
            )
            if _pid is not None:
                q = q.filter(Asset.provider_id == _pid)
            processed_paths = set(row[0] for row in q.all() if row[0])

        processed = 0
        for folder in sync_folders:
            if processed >= remaining:
                break

            click.echo(f"\nListing folder: {folder or '(root)'}")

            try:
                entries = list(dropbox_client.list_folder(folder, recursive=True))
            except Exception as exc:
                click.echo(f"  ✗ {_format_folder_listing_error(folder, exc)}", err=True)
                continue

            click.echo(f"Found {len(entries)} entries")

            unprocessed = []
            folder_remaining = max(remaining - processed, 0)
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
                if len(unprocessed) >= folder_remaining:
                    break

            click.echo(f"Found {len(unprocessed)} unprocessed images")

            for entry in unprocessed:
                if processed >= remaining:
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
                        provider_id=record_provider_id,
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

        return processed
