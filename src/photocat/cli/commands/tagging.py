"""SigLIP tag recompute command."""

import click
from datetime import datetime, timedelta
from typing import Optional
from google.cloud import storage
from sqlalchemy import func

from photocat.settings import settings
from photocat.config.db_config import ConfigManager
from photocat.tagging import get_tagger
from photocat.metadata import ImageMetadata, MachineTag, ImageEmbedding
from photocat.learning import ensure_image_embedding
from photocat.config.db_utils import load_keyword_info_by_name
from photocat.tenant import Tenant, TenantContext
from photocat.cli.base import CliCommand


@click.command(name='recompute-siglip-tags')
@click.option('--tenant-id', required=True, help='Tenant ID for which to recompute tags')
@click.option('--batch-size', default=50, type=int, help='Process images in batches')
@click.option('--limit', default=None, type=int, help='Limit number of images to process')
@click.option('--offset', default=0, type=int, help='Offset into image list')
@click.option('--replace', is_flag=True, default=False, help='Replace existing SigLIP tags')
@click.option('--older-than-days', default=None, type=float, help='Only process images with SigLIP tags older than this many days')
def recompute_siglip_tags_command(
    tenant_id: str,
    batch_size: int,
    limit: Optional[int],
    offset: int,
    replace: bool,
    older_than_days: Optional[float]
):
    """Recompute SigLIP-based keyword tags for all images in a tenant.

    This command reprocesses all images using the tenant's configured keyword models to:

    1. Load all images from database for the tenant
    2. Retrieve each image thumbnail from GCP Cloud Storage
    3. Score the image against all configured keywords using ML models
    4. Update MachineTag records in database with new keyword assignments

    Use this when: Keywords configuration changes, ML models are updated, or you want
    to recalculate keyword assignments with different model weights.

    Storage: Tag data is stored in PostgreSQL database, not GCP buckets."""
    cmd = RecomputeSiglipTagsCommand(tenant_id, batch_size, limit, offset, replace, older_than_days)
    cmd.run()


class RecomputeSiglipTagsCommand(CliCommand):
    """Command to recompute SigLIP tags."""

    def __init__(
        self,
        tenant_id: str,
        batch_size: int,
        limit: Optional[int],
        offset: int,
        replace: bool,
        older_than_days: Optional[float]
    ):
        super().__init__()
        self.tenant_id = tenant_id
        self.batch_size = batch_size
        self.limit = limit
        self.offset = offset
        self.replace = replace
        self.older_than_days = older_than_days

    def run(self):
        """Execute recompute SigLIP tags command."""
        self.setup_db()
        try:
            self._retag_images()
        finally:
            self.cleanup_db()

    def _retag_images(self):
        """Reprocess all images to regenerate SigLIP tags with current keywords."""
        # Set tenant context
        tenant = Tenant(id=self.tenant_id, name=self.tenant_id, active=True)
        TenantContext.set(tenant)

        # Load config
        config_mgr = ConfigManager(self.db, self.tenant_id)
        all_keywords = config_mgr.get_all_keywords()
        if not all_keywords:
            click.echo("No keywords configured for this tenant.")
            return
        by_category = {}
        for kw in all_keywords:
            cat = kw['category']
            if cat not in by_category:
                by_category[cat] = []
            by_category[cat].append(kw)
        keyword_names = [kw['keyword'] for kw in all_keywords]
        keyword_info_by_name = load_keyword_info_by_name(self.db, self.tenant_id, keyword_names)

        # Setup tagger and storage
        tagger = get_tagger()
        model_name = getattr(tagger, "model_name", settings.tagging_model)
        model_version = getattr(tagger, "model_version", model_name)
        text_embeddings_by_category = {}
        for category, keywords in by_category.items():
            keywords_list, text_embeddings = tagger.build_text_embeddings(keywords)
            if keywords_list:
                text_embeddings_by_category[category] = (keywords_list, text_embeddings)
        storage_client = storage.Client(project=settings.gcp_project_id)
        thumbnail_bucket = storage_client.bucket(settings.thumbnail_bucket)

        base_query = self.db.query(ImageMetadata).filter(
            ImageMetadata.tenant_id == self.tenant_id
        )
        if self.older_than_days is not None:
            cutoff = datetime.utcnow() - timedelta(days=self.older_than_days)
            last_tagged_subquery = self.db.query(
                MachineTag.image_id.label('image_id'),
                func.max(MachineTag.created_at).label('last_tagged_at')
            ).filter(
                MachineTag.tenant_id == self.tenant_id,
                MachineTag.tag_type == 'siglip',
                MachineTag.model_name == model_name
            ).group_by(
                MachineTag.image_id
            ).subquery()
            base_query = base_query.outerjoin(
                last_tagged_subquery,
                ImageMetadata.id == last_tagged_subquery.c.image_id
            ).filter(
                (last_tagged_subquery.c.last_tagged_at.is_(None)) |
                (last_tagged_subquery.c.last_tagged_at < cutoff)
            )
        base_query = base_query.order_by(ImageMetadata.id.desc())
        total = base_query.count()
        total_remaining = max(total - self.offset, 0)

        processed = 0
        skipped = 0
        current_offset = self.offset
        if total_remaining == 0:
            click.echo("No images available for processing.")
            return

        click.echo(
            f"Processing {total_remaining} images "
            f"(batch {self.batch_size}, offset {self.offset}"
            f"{', limit ' + str(self.limit) if self.limit is not None else ''})"
        )

        with click.progressbar(
            length=total_remaining,
            label='Recomputing SigLIP tags',
            show_eta=True,
            show_pos=True
        ) as bar:
            while True:
                batch = base_query.offset(current_offset).limit(self.batch_size).all()
                if not batch:
                    break
                reached_limit = False
                for image in batch:
                    if self.limit is not None and processed >= self.limit:
                        reached_limit = True
                        break
                    try:
                        if not image.thumbnail_path:
                            skipped += 1
                            bar.update(1)
                            continue
                        if not self.replace:
                            existing = self.db.query(MachineTag.id).filter(
                                MachineTag.tenant_id == self.tenant_id,
                                MachineTag.image_id == image.id,
                                MachineTag.tag_type == 'siglip',
                                MachineTag.model_name == model_name
                            ).first()
                            if existing:
                                skipped += 1
                                bar.update(1)
                                continue
                        # Delete existing SigLIP tags
                        self.db.query(MachineTag).filter(
                            MachineTag.image_id == image.id,
                            MachineTag.tag_type == 'siglip',
                            MachineTag.model_name == model_name
                        ).delete()

                        embedding_row = self.db.query(ImageEmbedding).filter(
                            ImageEmbedding.tenant_id == self.tenant_id,
                            ImageEmbedding.image_id == image.id
                        ).first()
                        if embedding_row:
                            image_embedding = embedding_row.embedding
                        else:
                            # Download thumbnail from Cloud Storage only if needed for embedding
                            blob = thumbnail_bucket.blob(image.thumbnail_path)
                            if not blob.exists():
                                skipped += 1
                                bar.update(1)
                                continue

                            image_data = blob.download_as_bytes()
                            embedding_record = ensure_image_embedding(
                                self.db,
                                self.tenant_id,
                                image.id,
                                image_data,
                                model_name,
                                model_version
                            )
                            image_embedding = embedding_record.embedding

                        # Score with precomputed text embeddings per category
                        all_tags = []
                        for category, payload in text_embeddings_by_category.items():
                            keywords, text_embeddings = payload
                            category_tags = tagger.score_with_embedding(
                                image_embedding,
                                keywords,
                                text_embeddings,
                                threshold=settings.keyword_model_threshold
                            )
                            all_tags.extend(category_tags)

                        tags_with_confidence = all_tags

                        # Create new tags
                        for keyword, confidence in tags_with_confidence:
                            keyword_info = keyword_info_by_name.get(keyword)
                            if not keyword_info:
                                click.echo(f"\n  Skipping tag '{keyword}': keyword not found in DB")
                                continue
                            tag = MachineTag(
                                image_id=image.id,
                                tenant_id=self.tenant_id,
                                keyword_id=keyword_info["id"],
                                confidence=confidence,
                                tag_type='siglip',
                                model_name=model_name,
                                model_version=model_version
                            )
                            self.db.add(tag)

                        # Update tags_applied flag
                        image.tags_applied = len(tags_with_confidence) > 0

                        self.db.commit()
                        processed += 1
                        bar.update(1)
                        if self.limit is not None and processed >= self.limit:
                            reached_limit = True
                            break

                    except Exception as e:
                        click.echo(f"\n  Error processing {image.filename}: {e}")
                        self.db.rollback()
                        skipped += 1
                        bar.update(1)

                    if reached_limit:
                        break

                current_offset += len(batch)

                if reached_limit:
                    break

        click.echo(f"\n✓ SigLIP tag recompute complete: {processed} · Skipped: {skipped} · Total: {total}")
