"""Retagging command."""

import click
from google.cloud import storage

from photocat.settings import settings
from photocat.config import TenantConfig
from photocat.tagging import get_tagger
from photocat.metadata import ImageMetadata, MachineTag
from photocat.tenant import Tenant, TenantContext
from photocat.cli.base import CliCommand


@click.command(name='retag')
@click.option('--tenant-id', required=True, help='Tenant ID for which to recompute tags')
def retag_command(tenant_id: str):
    """Recompute ML-based keyword tags for all images in a tenant.

    This command reprocesses all images using the tenant's configured keyword models to:

    1. Load all images from database for the tenant
    2. Retrieve each image thumbnail from GCP Cloud Storage
    3. Score the image against all configured keywords using ML models
    4. Update MachineTag records in database with new keyword assignments

    Use this when: Keywords configuration changes, ML models are updated, or you want
    to recalculate keyword assignments with different model weights.

    Storage: Tag data is stored in PostgreSQL database, not GCP buckets."""
    cmd = RetagCommand(tenant_id)
    cmd.run()


class RetagCommand(CliCommand):
    """Command to retag images."""

    def __init__(self, tenant_id: str):
        super().__init__()
        self.tenant_id = tenant_id

    def run(self):
        """Execute retag command."""
        self.setup_db()
        try:
            self._retag_images()
        finally:
            self.cleanup_db()

    def _retag_images(self):
        """Reprocess all images to regenerate tags with current keywords."""
        # Set tenant context
        tenant = Tenant(id=self.tenant_id, name=self.tenant_id, active=True)
        TenantContext.set(tenant)

        # Load config
        config = TenantConfig.load(self.tenant_id)
        all_keywords = config.get_all_keywords()

        # Get all images
        images = self.db.query(ImageMetadata).filter(
            ImageMetadata.tenant_id == self.tenant_id
        ).all()

        click.echo(f"Reprocessing {len(images)} images for tenant {self.tenant_id}")

        # Setup tagger and storage
        tagger = get_tagger()
        model_name = getattr(tagger, "model_name", settings.tagging_model)
        model_version = getattr(tagger, "model_version", model_name)
        storage_client = storage.Client(project=settings.gcp_project_id)
        thumbnail_bucket = storage_client.bucket(settings.thumbnail_bucket)

        with click.progressbar(images, label='Retagging images') as bar:
            for image in bar:
                try:
                    # Delete existing SigLIP tags
                    self.db.query(MachineTag).filter(
                        MachineTag.image_id == image.id,
                        MachineTag.tag_type == 'siglip'
                    ).delete()

                    # Download thumbnail from Cloud Storage
                    blob = thumbnail_bucket.blob(image.thumbnail_path)
                    if not blob.exists():
                        click.echo(f"\n  Skipping {image.filename}: thumbnail not found")
                        continue

                    image_data = blob.download_as_bytes()

                    # Run CLIP tagging with category separation
                    all_tags = []

                    # Group keywords by category
                    by_category = {}
                    for kw in all_keywords:
                        cat = kw['category']
                        if cat not in by_category:
                            by_category[cat] = []
                        by_category[cat].append(kw)

                    # Run CLIP separately for each category to avoid softmax suppression
                    for category, keywords in by_category.items():
                        category_tags = tagger.tag_image(
                            image_data,
                            keywords,
                            threshold=0.15
                        )
                        all_tags.extend(category_tags)

                    tags_with_confidence = all_tags

                    # Debug: show top scores per category
                    click.echo(f"\n  Tags for {image.filename}:")
                    for category, keywords in by_category.items():
                        scores = tagger.tag_image(image_data, keywords, threshold=0.0)
                        top = sorted(scores, key=lambda x: x[1], reverse=True)[:2]
                        if top:
                            click.echo(f"    {category}: {top[0][0]} ({top[0][1]:.3f})")

                    # Create new tags
                    keyword_to_category = {kw['keyword']: kw['category'] for kw in all_keywords}

                    for keyword, confidence in tags_with_confidence:
                        tag = MachineTag(
                            image_id=image.id,
                            tenant_id=self.tenant_id,
                            keyword=keyword,
                            category=keyword_to_category[keyword],
                            confidence=confidence,
                            tag_type='siglip',
                            model_name=model_name,
                            model_version=model_version
                        )
                        self.db.add(tag)

                    # Update tags_applied flag
                    image.tags_applied = len(tags_with_confidence) > 0

                    self.db.commit()

                except Exception as e:
                    click.echo(f"\n  Error processing {image.filename}: {e}")
                    self.db.rollback()

        click.echo(f"\n✓ Retagging complete!")
