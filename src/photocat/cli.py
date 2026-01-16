"""CLI tool for local image ingestion and testing."""

import sys
from pathlib import Path
from typing import Optional
import click
from sqlalchemy import create_engine, func, or_
from sqlalchemy.orm import sessionmaker
from google.cloud import storage

from photocat.settings import settings
from photocat.tenant import Tenant, TenantContext
from photocat.config import TenantConfig
from photocat.image import ImageProcessor
from photocat.metadata import ImageMetadata, KeywordModel, MachineTag
from photocat.learning import (
    build_keyword_models,
    ensure_image_embedding,
    recompute_trained_tags_for_image,
    load_keyword_models
)
from photocat.tagging import get_tagger
from photocat.config.db_config import ConfigManager


@click.group()
def cli():
    """PhotoCat CLI for local development and testing."""
    pass


@cli.command()
@click.argument('directory', type=click.Path(exists=True))
@click.option('--tenant-id', default='demo', help='Tenant ID to use')
@click.option('--recursive/--no-recursive', default=True, help='Process subdirectories')
def ingest(directory: str, tenant_id: str, recursive: bool):
    """Ingest images from a local directory."""

    # Setup database
    engine = create_engine(settings.database_url)
    Session = sessionmaker(bind=engine)
    session = Session()

    # Load tenant from database
    from sqlalchemy import text
    result = session.execute(
        text("SELECT id, name, storage_bucket, thumbnail_bucket FROM tenants WHERE id = :tenant_id"),
        {"tenant_id": tenant_id}
    ).first()

    if not result:
        click.echo(f"Error: Tenant {tenant_id} not found in database", err=True)
        return

    tenant = Tenant(
        id=result[0],
        name=result[1],
        storage_bucket=result[2],
        thumbnail_bucket=result[3]
    )
    TenantContext.set(tenant)

    click.echo(f"Using tenant: {tenant.name}")
    click.echo(f"  Storage bucket: {tenant.get_storage_bucket(settings)}")
    click.echo(f"  Thumbnail bucket: {tenant.get_thumbnail_bucket(settings)}")

    # Load tenant config
    try:
        config = TenantConfig.load(tenant_id)
        click.echo(f"  Keywords: {len(config.get_all_keywords())} total")
        click.echo(f"  People: {len(config.people)}")
    except FileNotFoundError:
        click.echo(f"Warning: No config found for tenant {tenant_id}", err=True)
        config = None

    # Setup storage client
    storage_client = storage.Client(project=settings.gcp_project_id)
    bucket = storage_client.bucket(tenant.get_storage_bucket(settings))
    thumbnail_bucket = storage_client.bucket(tenant.get_thumbnail_bucket(settings))
    
    # Setup image processor
    processor = ImageProcessor(thumbnail_size=(settings.thumbnail_size, settings.thumbnail_size))
    
    # Find images
    dir_path = Path(directory)
    pattern = '**/*' if recursive else '*'
    
    image_files = []
    for ext in processor.SUPPORTED_FORMATS:
        image_files.extend(dir_path.glob(f"{pattern}{ext}"))
        image_files.extend(dir_path.glob(f"{pattern}{ext.upper()}"))
    
    click.echo(f"\nFound {len(image_files)} images in {directory}")
    
    if not image_files:
        click.echo("No images found!")
        return
    
    # Process each image
    with click.progressbar(image_files, label='Processing images') as bar:
        for image_path in bar:
            try:
                process_image(
                    image_path=image_path,
                    tenant=tenant,
                    processor=processor,
                    session=session,
                    bucket=bucket,
                    thumbnail_bucket=thumbnail_bucket
                )
            except Exception as e:
                click.echo(f"\nError processing {image_path.name}: {e}", err=True)
    
    session.commit()
    click.echo(f"\n✓ Successfully processed {len(image_files)} images")


def _load_tenant(session, tenant_id: str) -> Tenant:
    from sqlalchemy import text
    result = session.execute(
        text("SELECT id, name, storage_bucket, thumbnail_bucket FROM tenants WHERE id = :tenant_id"),
        {"tenant_id": tenant_id}
    ).first()

    if not result:
        raise click.ClickException(f"Tenant {tenant_id} not found in database")

    return Tenant(
        id=result[0],
        name=result[1],
        storage_bucket=result[2],
        thumbnail_bucket=result[3]
    )


def process_image(
    image_path: Path,
    tenant: Tenant,
    processor: ImageProcessor,
    session,
    bucket,
    thumbnail_bucket
):
    """Process a single image file."""
    
    # Read image data
    with open(image_path, 'rb') as f:
        image_data = f.read()
    
    # Extract features
    features = processor.extract_features(image_data)
    
    # Upload thumbnail to Cloud Storage
    thumbnail_path = f"{tenant.id}/thumbnails/{image_path.stem}_thumb.jpg"
    blob = thumbnail_bucket.blob(thumbnail_path)
    blob.upload_from_string(features['thumbnail'], content_type='image/jpeg')
    
    # Create metadata record
    exif = features['exif']
    
    metadata = ImageMetadata(
        tenant_id=tenant.id,
        dropbox_path=f"/local/{image_path.relative_to(image_path.parent.parent)}",
        dropbox_id=f"local_{image_path.stem}",
        filename=image_path.name,
        file_size=image_path.stat().st_size,
        content_hash=None,  # Could add hash computation
        width=features['width'],
        height=features['height'],
        format=features['format'],
        perceptual_hash=features['perceptual_hash'],
        color_histogram=features['color_histogram'],
        exif_data=exif,
        camera_make=exif.get('Make'),
        camera_model=exif.get('Model'),
        lens_model=exif.get('LensModel'),
        thumbnail_path=thumbnail_path,
        embedding_generated=False,
        faces_detected=False,
        tags_applied=False,
    )
    
    session.add(metadata)


@cli.command()
@click.option('--tenant-id', required=True, help='Tenant ID')
@click.option('--limit', default=None, type=int, help='Limit number of images to process')
@click.option('--force/--no-force', default=False, help='Recompute embeddings even if present')
def build_embeddings(tenant_id: str, limit: Optional[int], force: bool):
    """Compute and store image embeddings for a tenant."""
    engine = create_engine(settings.database_url)
    Session = sessionmaker(bind=engine)
    session = Session()

    tenant = _load_tenant(session, tenant_id)
    TenantContext.set(tenant)

    storage_client = storage.Client(project=settings.gcp_project_id)
    thumbnail_bucket = storage_client.bucket(tenant.get_thumbnail_bucket(settings))

    tagger = get_tagger(model_type=settings.tagging_model)
    model_name = getattr(tagger, "model_name", settings.tagging_model)
    model_version = getattr(tagger, "model_version", model_name)

    query = session.query(ImageMetadata).filter_by(tenant_id=tenant.id)
    query = query.filter(or_(ImageMetadata.rating.is_(None), ImageMetadata.rating != 0))
    if not force:
        query = query.filter(ImageMetadata.embedding_generated.is_(False))
    if limit:
        query = query.limit(limit)

    images = query.all()
    if not images:
        click.echo("No images need embeddings.")
        return

    click.echo(f"Computing embeddings for {len(images)} images...")
    with click.progressbar(images, label='Embedding images') as bar:
        for image in bar:
            if not image.thumbnail_path:
                continue
            blob = thumbnail_bucket.blob(image.thumbnail_path)
            if not blob.exists():
                continue
            image_data = blob.download_as_bytes()
            ensure_image_embedding(session, tenant.id, image.id, image_data, model_name, model_version)

    session.commit()
    click.echo("✓ Embeddings stored")


@cli.command()
@click.option('--tenant-id', required=True, help='Tenant ID')
@click.option('--min-positive', default=None, type=int, help='Minimum positive examples')
@click.option('--min-negative', default=None, type=int, help='Minimum negative examples')
def train_keyword_models(tenant_id: str, min_positive: Optional[int], min_negative: Optional[int]):
    """Train keyword centroid models from verified tags."""
    engine = create_engine(settings.database_url)
    Session = sessionmaker(bind=engine)
    session = Session()

    _ = _load_tenant(session, tenant_id)
    tagger = get_tagger(model_type=settings.tagging_model)
    model_name = getattr(tagger, "model_name", settings.tagging_model)
    model_version = getattr(tagger, "model_version", model_name)

    result = build_keyword_models(
        session,
        tenant_id=tenant_id,
        model_name=model_name,
        model_version=model_version,
        min_positive=min_positive or settings.keyword_model_min_positive,
        min_negative=min_negative or settings.keyword_model_min_negative
    )
    session.commit()
    click.echo(f"✓ Trained: {result['trained']} · Skipped: {result['skipped']}")


@cli.command()
@click.option('--tenant-id', required=True, help='Tenant ID')
@click.option('--batch-size', default=50, type=int, help='Batch size for processing')
@click.option('--limit', default=None, type=int, help='Limit number of images')
@click.option('--offset', default=0, type=int, help='Offset into image list')
@click.option('--replace', is_flag=True, default=False, help='Replace existing keyword-model tags instead of backfilling missing ones.')
def recompute_trained_tags(tenant_id: str, batch_size: int, limit: Optional[int], offset: int, replace: bool):
    """Recompute trained-ML tags for all images in batches."""
    engine = create_engine(settings.database_url)
    Session = sessionmaker(bind=engine)
    session = Session()

    tenant = _load_tenant(session, tenant_id)
    TenantContext.set(tenant)

    config_mgr = ConfigManager(session, tenant.id)
    all_keywords = config_mgr.get_all_keywords()
    keyword_to_category = {kw['keyword']: kw['category'] for kw in all_keywords}
    by_category = {}
    for kw in all_keywords:
        by_category.setdefault(kw['category'], []).append(kw)

    model_row = session.query(
        KeywordModel.model_name,
        KeywordModel.model_version
    ).filter(
        KeywordModel.tenant_id == tenant.id
    ).order_by(
        func.coalesce(KeywordModel.updated_at, KeywordModel.created_at).desc()
    ).first()

    if not model_row:
        click.echo("No keyword models found. Train models before recomputing.")
        return

    model_name, model_version = model_row

    keyword_models = load_keyword_models(session, tenant.id, model_name)
    if not keyword_models:
        click.echo("No keyword models found. Train models before recomputing.")
        return

    storage_client = storage.Client(project=settings.gcp_project_id)
    thumbnail_bucket = storage_client.bucket(tenant.get_thumbnail_bucket(settings))

    base_query = session.query(ImageMetadata).filter_by(tenant_id=tenant.id).order_by(ImageMetadata.id.desc())
    total = base_query.count()

    processed = 0
    skipped = 0
    current_offset = offset
    while True:
        batch = base_query.offset(current_offset).limit(batch_size).all()
        if not batch:
            break

        reached_limit = False
        for image in batch:
            if limit is not None and processed >= limit:
                reached_limit = True
                break
            if not image.thumbnail_path:
                skipped += 1
                continue
            if not replace:
                existing = session.query(MachineTag.id).filter(
                    MachineTag.tenant_id == tenant.id,
                    MachineTag.image_id == image.id,
                    MachineTag.tag_type == 'trained',
                    MachineTag.model_name == model_name
                ).first()
                if existing:
                    skipped += 1
                    continue
            blob = thumbnail_bucket.blob(image.thumbnail_path)
            if not blob.exists():
                skipped += 1
                continue
            image_data = blob.download_as_bytes()
            recompute_trained_tags_for_image(
                db=session,
                tenant_id=tenant.id,
                image_id=image.id,
                image_data=image_data,
                keywords_by_category=by_category,
                keyword_models=keyword_models,
                keyword_to_category=keyword_to_category,
                model_name=model_name,
                model_version=model_version,
                model_type=settings.tagging_model,
                threshold=0.15,
                model_weight=settings.keyword_model_weight
            )
            processed += 1
            if limit is not None and processed >= limit:
                reached_limit = True
                break

        session.commit()

        if reached_limit:
            break

        current_offset += len(batch)

    click.echo(f"✓ Trained tags recomputed: {processed} · Skipped: {skipped} · Total: {total}")


@cli.command()
@click.option('--tenant-id', default='demo', help='Tenant ID')
@click.option('--limit', default=10, help='Number of images to show')
def list_images(tenant_id: str, limit: int):
    """List processed images."""
    
    engine = create_engine(settings.database_url)
    Session = sessionmaker(bind=engine)
    session = Session()
    
    images = session.query(ImageMetadata).filter_by(
        tenant_id=tenant_id
    ).limit(limit).all()
    
    click.echo(f"\nImages for tenant {tenant_id}:")
    click.echo("-" * 80)
    
    for img in images:
        click.echo(f"ID: {img.id}")
        click.echo(f"  File: {img.filename}")
        click.echo(f"  Size: {img.width}x{img.height} ({img.format})")
        click.echo(f"  Camera: {img.camera_make} {img.camera_model}")
        click.echo(f"  Hash: {img.perceptual_hash[:16]}...")
        click.echo()
    
    total = session.query(ImageMetadata).filter_by(tenant_id=tenant_id).count()
    click.echo(f"Total: {total} images")


@cli.command()
@click.argument('tenant-id')
def show_config(tenant_id: str):
    """Show tenant configuration."""
    
    try:
        config = TenantConfig.load(tenant_id)
        
        click.echo(f"\nConfiguration for tenant: {tenant_id}")
        click.echo("=" * 80)
        
        click.echo(f"\nKeywords ({len(config.keywords)} categories):")
        for category in config.keywords:
            click.echo(f"  • {category.name}: {', '.join(category.keywords[:5])}")
            if len(category.keywords) > 5:
                click.echo(f"    ... and {len(category.keywords) - 5} more")
        
        click.echo(f"\nPeople ({len(config.people)}):")
        for person in config.people:
            aliases = f" (aka {', '.join(person.aliases)})" if person.aliases else ""
            click.echo(f"  • {person.name}{aliases}")
    
    except FileNotFoundError:
        click.echo(f"No configuration found for tenant: {tenant_id}", err=True)
        sys.exit(1)


@cli.command()
@click.option('--tenant-id', required=True, help='Tenant ID')
def retag(tenant_id: str):
    """Reprocess all images to regenerate tags with current keywords."""
    from photocat.tenant import Tenant, TenantContext
    from photocat.metadata import ImageMetadata, MachineTag
    from photocat.config import TenantConfig
    from photocat.tagging import get_tagger
    from photocat.settings import settings
    from google.cloud import storage
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    
    # Set tenant context
    tenant = Tenant(id=tenant_id, name=tenant_id, active=True)
    TenantContext.set(tenant)
    
    # Load config
    config = TenantConfig.load(tenant_id)
    all_keywords = config.get_all_keywords()
    
    # Setup database
    engine = create_engine(settings.database_url)
    Session = sessionmaker(bind=engine)
    db = Session()
    
    # Get all images
    images = db.query(ImageMetadata).filter(
        ImageMetadata.tenant_id == tenant_id
    ).all()
    
    click.echo(f"Reprocessing {len(images)} images for tenant {tenant_id}")
    
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
                db.query(MachineTag).filter(
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
                        tenant_id=tenant_id,
                        keyword=keyword,
                        category=keyword_to_category[keyword],
                        confidence=confidence,
                        tag_type='siglip',
                        model_name=model_name,
                        model_version=model_version
                    )
                    db.add(tag)
                
                # Update tags_applied flag
                image.tags_applied = len(tags_with_confidence) > 0
                
                db.commit()
                
            except Exception as e:
                click.echo(f"\n  Error processing {image.filename}: {e}")
                db.rollback()
    
    db.close()
    click.echo(f"\n✓ Retagging complete!")


if __name__ == '__main__':
    cli()
