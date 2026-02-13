"""ML training commands."""

import click
from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy import func
from google.cloud import storage

from zoltag.settings import settings
from zoltag.tagging import get_tagger
from zoltag.learning import (
    build_keyword_models,
    load_keyword_models,
    recompute_trained_tags_for_image,
)
from zoltag.asset_helpers import load_assets_for_images, resolve_image_storage
from zoltag.metadata import ImageMetadata, KeywordModel, MachineTag, ImageEmbedding
from zoltag.models.config import Keyword
from zoltag.config.db_config import ConfigManager
from zoltag.cli.base import CliCommand


@click.command(name='train-keyword-models')
@click.option('--tenant-id', required=True, help='Tenant ID')
@click.option('--min-positive', default=None, type=int, help='Minimum positive examples per keyword')
@click.option('--min-negative', default=None, type=int, help='Minimum negative examples per keyword')
def train_keyword_models_command(
    tenant_id: str,
    min_positive: Optional[int],
    min_negative: Optional[int]
):
    """Train keyword classification models for a tenant."""
    cmd = TrainKeywordModelsCommand(tenant_id, min_positive, min_negative)
    cmd.run()


@click.command(name='recompute-trained-tags')
@click.option('--tenant-id', required=True, help='Tenant ID')
@click.option('--batch-size', default=50, type=int, help='Process images in batches')
@click.option('--limit', default=None, type=int, help='Limit number of images to process')
@click.option('--offset', default=0, type=int, help='Offset into image list')
@click.option('--replace', is_flag=True, default=False, help='Replace existing trained tags')
@click.option('--older-than-days', default=None, type=float, help='Only process images with trained tags older than this many days')
def recompute_trained_tags_command(
    tenant_id: str,
    batch_size: int,
    limit: Optional[int],
    offset: int,
    replace: bool,
    older_than_days: Optional[float]
):
    """Recompute ML trained tags for images."""
    cmd = RecomputeTrainedTagsCommand(tenant_id, batch_size, limit, offset, replace, older_than_days)
    cmd.run()


class TrainKeywordModelsCommand(CliCommand):
    """Command to train keyword models."""

    def __init__(
        self,
        tenant_id: str,
        min_positive: Optional[int],
        min_negative: Optional[int]
    ):
        super().__init__()
        self.tenant_id = tenant_id
        self.min_positive = min_positive
        self.min_negative = min_negative

    def run(self):
        """Execute train keyword models command."""
        self.setup_db()
        try:
            self.load_tenant(self.tenant_id)
            self._train_models()
        finally:
            self.cleanup_db()

    def _train_models(self):
        """Train keyword centroid models from verified tags."""
        tagger = get_tagger(model_type=settings.tagging_model)
        model_name = getattr(tagger, "model_name", settings.tagging_model)
        model_version = getattr(tagger, "model_version", model_name)

        result = build_keyword_models(
            self.db,
            tenant_id=self.tenant_id,
            model_name=model_name,
            model_version=model_version,
            min_positive=self.min_positive or settings.keyword_model_min_positive,
            min_negative=self.min_negative or settings.keyword_model_min_negative
        )
        self.db.commit()
        click.echo(f"✓ Trained: {result['trained']} · Skipped: {result['skipped']}")


class RecomputeTrainedTagsCommand(CliCommand):
    """Command to recompute trained tags."""

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
        """Execute recompute trained tags command."""
        self.setup_db()
        try:
            self.tenant = self.load_tenant(self.tenant_id)
            self._recompute_tags()
        finally:
            self.cleanup_db()

    def _recompute_tags(self):
        """Recompute trained-ML tags for all images in batches."""
        # Load configuration
        config_mgr = ConfigManager(self.db, self.tenant.id)
        all_keywords = config_mgr.get_all_keywords()
        keyword_to_category = {kw['keyword']: kw['category'] for kw in all_keywords}
        by_category = {}
        for kw in all_keywords:
            by_category.setdefault(kw['category'], []).append(kw)
        keyword_id_map = dict(self.db.query(Keyword.keyword, Keyword.id).filter(
            Keyword.tenant_id == self.tenant.id
        ).all())

        # Get latest trained model
        model_row = self.db.query(
            KeywordModel.model_name,
            KeywordModel.model_version
        ).filter(
            KeywordModel.tenant_id == self.tenant.id
        ).order_by(
            func.coalesce(KeywordModel.updated_at, KeywordModel.created_at).desc()
        ).first()

        if not model_row:
            click.echo("No keyword models found. Train models before recomputing.")
            return

        model_name, model_version = model_row

        keyword_models = load_keyword_models(self.db, self.tenant.id, model_name)
        if not keyword_models:
            click.echo("No keyword models found. Train models before recomputing.")
            return

        # Setup storage client
        storage_client = storage.Client(project=settings.gcp_project_id)
        thumbnail_bucket = storage_client.bucket(self.tenant.get_thumbnail_bucket(settings))

        # Process images in batches
        base_query = self.db.query(ImageMetadata).filter_by(tenant_id=self.tenant.id)
        if self.older_than_days is not None:
            cutoff = datetime.utcnow() - timedelta(days=self.older_than_days)
            last_tagged_subquery = self.db.query(
                MachineTag.asset_id.label('asset_id'),
                func.max(MachineTag.created_at).label('last_tagged_at')
            ).filter(
                MachineTag.tenant_id == self.tenant.id,
                MachineTag.tag_type == 'trained',
                MachineTag.model_name == model_name,
                MachineTag.asset_id.is_not(None),
            ).group_by(
                MachineTag.asset_id
            ).subquery()
            base_query = base_query.outerjoin(
                last_tagged_subquery,
                ImageMetadata.asset_id == last_tagged_subquery.c.asset_id
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
            label="Recomputing trained tags",
            show_eta=True,
            show_pos=True
        ) as bar:
            while True:
                batch = base_query.offset(current_offset).limit(self.batch_size).all()
                if not batch:
                    break
                assets_by_id = load_assets_for_images(self.db, batch)

                reached_limit = False
                for image in batch:
                    if self.limit is not None and processed >= self.limit:
                        reached_limit = True
                        break
                    storage_info = resolve_image_storage(
                        image=image,
                        tenant=self.tenant,
                        db=None,
                        assets_by_id=assets_by_id,
                        strict=False,
                    )
                    thumbnail_key = storage_info.thumbnail_key
                    if not thumbnail_key:
                        skipped += 1
                        continue
                    if not self.replace:
                        existing = self.db.query(MachineTag.id).filter(
                            MachineTag.tenant_id == self.tenant.id,
                            MachineTag.asset_id == image.asset_id,
                            MachineTag.tag_type == 'trained',
                            MachineTag.model_name == model_name
                        ).first()
                        if existing:
                            skipped += 1
                            continue
                    embedding_row = self.db.query(ImageEmbedding).filter(
                        ImageEmbedding.tenant_id == self.tenant.id,
                        ImageEmbedding.asset_id == image.asset_id
                    ).first()
                    if embedding_row:
                        recompute_trained_tags_for_image(
                            db=self.db,
                            tenant_id=self.tenant.id,
                            image_id=image.id,
                            asset_id=image.asset_id,
                            image_data=None,
                            keywords_by_category=by_category,
                            keyword_models=keyword_models,
                            keyword_to_category=keyword_to_category,
                            model_name=model_name,
                            model_version=model_version,
                            model_type=settings.tagging_model,
                            threshold=settings.keyword_model_threshold,
                            model_weight=settings.keyword_model_weight,
                            embedding=embedding_row.embedding,
                            keyword_id_map=keyword_id_map
                        )
                    else:
                        blob = thumbnail_bucket.blob(thumbnail_key)
                        if not blob.exists():
                            skipped += 1
                            continue
                        image_data = blob.download_as_bytes()
                        recompute_trained_tags_for_image(
                            db=self.db,
                            tenant_id=self.tenant.id,
                            image_id=image.id,
                            asset_id=image.asset_id,
                            image_data=image_data,
                            keywords_by_category=by_category,
                            keyword_models=keyword_models,
                            keyword_to_category=keyword_to_category,
                            model_name=model_name,
                            model_version=model_version,
                            model_type=settings.tagging_model,
                            threshold=settings.keyword_model_threshold,
                            model_weight=settings.keyword_model_weight,
                            keyword_id_map=keyword_id_map
                        )
                    processed += 1
                    bar.update(1)
                    if self.limit is not None and processed >= self.limit:
                        reached_limit = True
                        break

                self.db.commit()

                if reached_limit:
                    break

                current_offset += len(batch)

        click.echo(f"✓ Trained tags recomputed: {processed} · Skipped: {skipped} · Total: {total}")
