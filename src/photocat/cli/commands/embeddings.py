"""Embeddings generation command."""

import click
from typing import Optional
from sqlalchemy import or_
from google.cloud import storage

from photocat.settings import settings
from photocat.tagging import get_tagger
from photocat.learning import ensure_image_embedding
from photocat.asset_helpers import load_assets_for_images, resolve_image_storage
from photocat.metadata import ImageMetadata
from photocat.cli.base import CliCommand


@click.command(name='build-embeddings')
@click.option('--tenant-id', required=True, help='Tenant ID for which to compute embeddings')
@click.option('--limit', default=None, type=int, help='Maximum number of images to process (unlimited if not specified)')
@click.option('--force/--no-force', default=False, help='Recompute embeddings even if already generated (--force flag)')
def build_embeddings_command(tenant_id: str, limit: Optional[int], force: bool):
    """Generate image embeddings using ML models for visual similarity search.

    This command computes embeddings (vector representations) for images to enable:
    - Visual similarity search (find visually similar images)
    - Image clustering
    - Content-based recommendations

    Process:
    1. Query database for images needing embeddings (or all if --force)
    2. Skip images with rating = 0 (assumed to be unimportant)
    3. Retrieve image thumbnail from GCP Cloud Storage
    4. Pass through configured ML model (default: clip or siglip)
    5. Store embedding vector in database (embedding_generated flag set to true)

    Storage: Embedding vectors stored in PostgreSQL database, not GCP buckets.
    Use --force to recompute embeddings with a different model or different model weights."""
    cmd = BuildEmbeddingsCommand(tenant_id, limit, force)
    cmd.run()


class BuildEmbeddingsCommand(CliCommand):
    """Command to build image embeddings."""

    def __init__(self, tenant_id: str, limit: Optional[int], force: bool):
        super().__init__()
        self.tenant_id = tenant_id
        self.limit = limit
        self.force = force

    def run(self):
        """Execute build embeddings command."""
        self.setup_db()
        try:
            self.tenant = self.load_tenant(self.tenant_id)
            self._build_embeddings()
        finally:
            self.cleanup_db()

    def _build_embeddings(self):
        """Build embeddings for images."""
        # Setup storage client
        storage_client = storage.Client(project=settings.gcp_project_id)
        thumbnail_bucket = storage_client.bucket(self.tenant.get_thumbnail_bucket(settings))

        # Setup tagger to get model info
        tagger = get_tagger(model_type=settings.tagging_model)
        model_name = getattr(tagger, "model_name", settings.tagging_model)
        model_version = getattr(tagger, "model_version", model_name)

        # Query for images needing embeddings
        query = self.db.query(ImageMetadata).filter_by(tenant_id=self.tenant.id)
        query = query.filter(or_(ImageMetadata.rating.is_(None), ImageMetadata.rating != 0))
        if not self.force:
            query = query.filter(ImageMetadata.embedding_generated.is_(False))
        if self.limit:
            query = query.limit(self.limit)

        images = query.all()
        if not images:
            click.echo("No images need embeddings.")
            return
        assets_by_id = load_assets_for_images(self.db, images)

        click.echo(f"Computing embeddings for {len(images)} images...")
        with click.progressbar(images, label='Embedding images') as bar:
            for image in bar:
                storage_info = resolve_image_storage(
                    image=image,
                    tenant=self.tenant,
                    db=None,
                    assets_by_id=assets_by_id,
                    strict=False,
                )
                thumbnail_key = storage_info.thumbnail_key
                if not thumbnail_key:
                    continue
                blob = thumbnail_bucket.blob(thumbnail_key)
                if not blob.exists():
                    continue
                image_data = blob.download_as_bytes()
                ensure_image_embedding(
                    self.db, self.tenant.id, image.id, image_data,
                    model_name, model_version, asset_id=image.asset_id
                )

        self.db.commit()
        click.echo("✓ Embeddings stored")
