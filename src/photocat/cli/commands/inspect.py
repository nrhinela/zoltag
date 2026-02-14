"""Inspection commands (list and show)."""

import click

from photocat.config.db_config import ConfigManager
from photocat.metadata import ImageMetadata
from photocat.cli.base import CliCommand


@click.command(name='list-images')
@click.option('--tenant-id', default='demo', help='Tenant ID')
@click.option('--limit', default=10, type=int, help='Number of images to list')
def list_images_command(tenant_id: str, limit: int):
    """List images in tenant's database."""
    cmd = ListImagesCommand(tenant_id, limit)
    cmd.run()


@click.command(name='show-config')
@click.argument('tenant_id')
def show_config_command(tenant_id: str):
    """Show tenant configuration."""
    cmd = ShowConfigCommand(tenant_id)
    cmd.run()


class ListImagesCommand(CliCommand):
    """Command to list images."""

    def __init__(self, tenant_id: str, limit: int):
        super().__init__()
        self.tenant_id = tenant_id
        self.limit = limit

    def run(self):
        """Execute list images command."""
        self.setup_db()
        try:
            self.load_tenant(self.tenant_id)
            self._list_images()
        finally:
            self.cleanup_db()

    def _list_images(self):
        """List processed images."""
        images = (
            self.db.query(ImageMetadata)
            .filter(self.tenant_filter(ImageMetadata))
            .limit(self.limit)
            .all()
        )

        click.echo(f"\nImages for tenant {self.tenant.id}:")
        click.echo("-" * 80)

        for img in images:
            click.echo(f"ID: {img.id}")
            click.echo(f"  File: {img.filename}")
            click.echo(f"  Size: {img.width}x{img.height} ({img.format})")
            click.echo(f"  Camera: {img.camera_make} {img.camera_model}")
            click.echo(f"  Hash: {img.perceptual_hash[:16]}...")
            click.echo()

        total = self.db.query(ImageMetadata).filter(self.tenant_filter(ImageMetadata)).count()
        click.echo(f"Total: {total} images")


class ShowConfigCommand(CliCommand):
    """Command to show configuration."""

    def __init__(self, tenant_id: str):
        super().__init__()
        self.tenant_id = tenant_id

    def run(self):
        """Execute show config command."""
        self.setup_db()
        try:
            self.load_tenant(self.tenant_id)
            self._show_config()
        finally:
            self.cleanup_db()

    def _show_config(self):
        """Show tenant configuration."""
        manager = ConfigManager(self.db, self.tenant.id)
        keywords = manager.get_all_keywords()
        people = manager.get_people()

        click.echo(f"\nConfiguration for tenant: {self.tenant.id}")
        click.echo("=" * 80)

        categories = {}
        for kw in keywords:
            categories.setdefault(kw['category'], []).append(kw['keyword'])

        click.echo(f"\nKeywords ({len(categories)} categories):")
        for category, category_keywords in categories.items():
            sample = ", ".join(category_keywords[:5])
            click.echo(f"  • {category}: {sample}")
            if len(category_keywords) > 5:
                click.echo(f"    ... and {len(category_keywords) - 5} more")

        click.echo(f"\nPeople ({len(people)}):")
        for person in people:
            aliases = f" (aka {', '.join(person.get('aliases', []))})" if person.get('aliases') else ""
            click.echo(f"  • {person.get('name')}{aliases}")
