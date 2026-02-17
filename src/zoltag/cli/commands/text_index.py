"""Asset text index rebuild command."""

from __future__ import annotations

from typing import Optional

import click

from zoltag.cli.base import CliCommand
from zoltag.text_index import rebuild_asset_text_index


@click.command(name="rebuild-asset-text-index")
@click.option("--tenant-id", required=True, help="Tenant ID for which to rebuild text index documents")
@click.option("--asset-id", default=None, help="Optional single asset UUID to rebuild")
@click.option("--limit", default=None, type=int, help="Maximum number of assets to rebuild")
@click.option("--offset", default=0, type=int, help="Offset into tenant asset set")
@click.option(
    "--refresh/--no-refresh",
    default=False,
    help="When true, rebuild all tenant assets; default mode only rebuilds assets with new positive keywords",
)
@click.option(
    "--include-embeddings/--no-include-embeddings",
    default=True,
    help="Compute/update search embeddings for each text document",
)
def rebuild_asset_text_index_command(
    tenant_id: str,
    asset_id: Optional[str],
    limit: Optional[int],
    offset: int,
    refresh: bool,
    include_embeddings: bool,
):
    """Rebuild per-asset denormalized text-search documents."""
    cmd = RebuildAssetTextIndexCommand(
        tenant_id=tenant_id,
        asset_id=asset_id,
        limit=limit,
        offset=offset,
        refresh=refresh,
        include_embeddings=include_embeddings,
    )
    cmd.run()


class RebuildAssetTextIndexCommand(CliCommand):
    """Command to rebuild text index records for one tenant."""

    def __init__(
        self,
        *,
        tenant_id: str,
        asset_id: Optional[str],
        limit: Optional[int],
        offset: int,
        refresh: bool,
        include_embeddings: bool,
    ):
        super().__init__()
        self.tenant_id = tenant_id
        self.asset_id = asset_id
        self.limit = limit
        self.offset = offset
        self.refresh = refresh
        self.include_embeddings = include_embeddings

    def run(self):
        self.setup_db()
        try:
            self.load_tenant(self.tenant_id)
            click.echo(
                "Rebuilding asset text index "
                f"(tenant={self.tenant.id}, asset_id={self.asset_id or '-'}, "
                f"offset={self.offset}, limit={self.limit or '-'}, "
                f"refresh={bool(self.refresh)}, "
                f"include_embeddings={bool(self.include_embeddings)})"
            )
            result = rebuild_asset_text_index(
                self.db,
                tenant_id=self.tenant.id,
                asset_id=self.asset_id,
                limit=self.limit,
                offset=self.offset,
                refresh=self.refresh,
                include_embeddings=self.include_embeddings,
            )
            click.echo(
                "✓ Asset text index rebuild complete: "
                f"processed={result['processed']} failed={result['failed']}"
            )
            if result.get("errors"):
                click.echo("Errors:")
                for err in result["errors"][:20]:
                    click.echo(f"  - {err}")
                if len(result["errors"]) > 20:
                    click.echo(f"  ...and {len(result['errors']) - 20} more")
        finally:
            self.cleanup_db()
