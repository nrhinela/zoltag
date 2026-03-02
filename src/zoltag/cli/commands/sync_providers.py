"""Aggregate provider synchronization command."""

from __future__ import annotations

import click
from sqlalchemy import func

from zoltag.cli.base import CliCommand
from zoltag.cli.commands.embeddings import BuildEmbeddingsCommand
from zoltag.cli.commands.sync import SyncDropboxCommand
from zoltag.cli.commands.sync_flickr import SyncFlickrCommand
from zoltag.cli.commands.sync_gdrive import SyncGdriveCommand
from zoltag.cli.commands.sync_gphotos import SyncGphotosCommand
from zoltag.cli.commands.sync_youtube import SyncYoutubeCommand
from zoltag.cli.commands.text_index import RebuildAssetTextIndexCommand
from zoltag.integrations import TenantIntegrationRepository
from zoltag.metadata import Asset
from zoltag.metadata import Tenant as TenantModel


@click.command(name="sync-providers")
@click.option("--tenant-id", default="demo", help="Tenant ID to sync all active providers for")
@click.option(
    "--count",
    default=500,
    type=int,
    help="Maximum items to sync per provider integration",
)
@click.option(
    "--reprocess-existing/--no-reprocess-existing",
    default=False,
    help="Reprocess existing items instead of only syncing new items",
)
def sync_providers_command(tenant_id: str, count: int, reprocess_existing: bool):
    """Sync all active + connected providers for a tenant sequentially.

    If new assets are added, this command automatically runs:
    - build-embeddings
    - rebuild-asset-text-index
    """
    cmd = SyncProvidersCommand(tenant_id=tenant_id, count=count, reprocess_existing=reprocess_existing)
    cmd.run()


class SyncProvidersCommand(CliCommand):
    """Command to sync all tenant providers sequentially."""

    def __init__(self, tenant_id: str, count: int, reprocess_existing: bool):
        super().__init__()
        self.tenant_id = tenant_id
        self.count = int(count or 0)
        self.reprocess_existing = bool(reprocess_existing)

    def run(self):
        self.setup_db()
        try:
            self._sync_providers()
        finally:
            self.cleanup_db()

    def _sync_providers(self) -> None:
        tenant_context = self.load_tenant(self.tenant_id)
        click.echo(f"Syncing active providers for tenant: {tenant_context.name}")

        tenant_row = self.db.query(TenantModel).filter(TenantModel.id == tenant_context.id).first()
        if not tenant_row:
            raise click.ClickException(f"Tenant {tenant_context.id} not found in database")

        integration_repo = TenantIntegrationRepository(self.db)
        all_active_records = integration_repo.list_provider_records(
            tenant_row,
            include_inactive=False,
            include_placeholders=False,
        )

        connected_records = [record for record in all_active_records if self._provider_connected(record)]
        if not connected_records:
            click.echo("No active connected providers found. Nothing to sync.")
            return

        click.echo(f"Providers selected: {len(connected_records)}")
        total_added = 0
        failures: list[str] = []

        for record in connected_records:
            provider_type = str(record.provider_type or "").strip().lower()
            provider_id = str(record.id or "").strip()
            label = str(record.label or "").strip() or f"{provider_type} ({provider_id})"
            click.echo(f"\n--- Syncing provider: {label} [{provider_type}] ---")

            before_count = self._tenant_asset_count()
            try:
                self._run_provider_sync(provider_type=provider_type, provider_id=provider_id)
            except Exception as exc:  # noqa: BLE001
                failures.append(f"{label}: {exc}")
                click.echo(f"  ✗ Provider sync failed: {exc}", err=True)
                continue

            after_count = self._tenant_asset_count()
            added = max(0, after_count - before_count)
            total_added += added
            click.echo(f"  ✓ Provider complete: +{added} new asset(s)")

        click.echo(f"\nTotal new assets added across providers: {total_added}")

        if total_added > 0:
            self._run_post_sync_jobs()
        else:
            click.echo("Skipping embeddings/text index rebuild (no new assets detected).")

        if failures:
            preview = "; ".join(failures[:3])
            suffix = "" if len(failures) <= 3 else f"; +{len(failures) - 3} more"
            raise click.ClickException(f"sync-providers completed with failures: {preview}{suffix}")

        click.echo("✓ sync-providers completed successfully")

    def _tenant_asset_count(self) -> int:
        self.db.expire_all()
        count = (
            self.db.query(func.count(Asset.id))
            .filter(self.tenant_filter(Asset))
            .scalar()
        )
        return int(count or 0)

    @staticmethod
    def _provider_connected(record) -> bool:
        config_json = record.config_json if isinstance(record.config_json, dict) else {}
        return bool(config_json.get("token_stored"))

    def _run_provider_sync(self, *, provider_type: str, provider_id: str) -> None:
        if provider_type == "dropbox":
            SyncDropboxCommand(self.tenant_id, self.count, self.reprocess_existing, provider_id=provider_id).run()
            return
        if provider_type == "gdrive":
            SyncGdriveCommand(self.tenant_id, self.count, self.reprocess_existing, provider_id=provider_id).run()
            return
        if provider_type == "youtube":
            SyncYoutubeCommand(self.tenant_id, self.count, self.reprocess_existing, provider_id=provider_id).run()
            return
        if provider_type == "gphotos":
            SyncGphotosCommand(self.tenant_id, self.count, self.reprocess_existing, provider_id=provider_id).run()
            return
        if provider_type == "flickr":
            SyncFlickrCommand(self.tenant_id, self.count, self.reprocess_existing, provider_id=provider_id).run()
            return
        raise click.ClickException(f"Unsupported provider type: {provider_type}")

    def _run_post_sync_jobs(self) -> None:
        click.echo("Running post-sync jobs for newly added assets...")

        click.echo("\n--- build-embeddings ---")
        BuildEmbeddingsCommand(self.tenant_id, limit=None, force=False).run()

        click.echo("\n--- rebuild-asset-text-index ---")
        RebuildAssetTextIndexCommand(
            tenant_id=self.tenant_id,
            asset_id=None,
            limit=None,
            offset=0,
            refresh=False,
            include_embeddings=True,
        ).run()

        click.echo("✓ Post-sync jobs completed")
