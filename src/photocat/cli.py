"""CLI tool for local image ingestion and testing."""

import sys
import io
from pathlib import Path
from typing import Optional
from datetime import datetime, timedelta
import click
from sqlalchemy import create_engine, func, or_
from sqlalchemy.orm import sessionmaker
from google.cloud import storage
from PIL import Image

from photocat.settings import settings
from photocat.tenant import Tenant, TenantContext
from photocat.config.db_config import ConfigManager
from photocat.image import ImageProcessor
from photocat.exif import (
    get_exif_value,
    parse_exif_datetime,
    parse_exif_float,
    parse_exif_int,
    parse_exif_str,
)
from photocat.metadata import ImageMetadata, KeywordModel, MachineTag, Tenant as TenantModel
from photocat.models.config import Keyword
from photocat.learning import (
    build_keyword_models,
    ensure_image_embedding,
    recompute_trained_tags_for_image,
    load_keyword_models,
    score_keywords_for_categories,
    score_image_with_models
)
from photocat.tagging import get_tagger
from photocat.config.db_config import ConfigManager
from photocat.dependencies import get_secret
from photocat.dropbox import DropboxClient


@click.group()
def cli():
    """PhotoCat CLI for local development and testing."""
    pass


@cli.command()
@click.argument('directory', type=click.Path(exists=True))
@click.option('--tenant-id', default='demo', help='Tenant ID to associate with ingested images')
@click.option('--recursive/--no-recursive', default=True, help='Process subdirectories recursively')
def ingest(directory: str, tenant_id: str, recursive: bool):
    """Ingest local images into database with full processing pipeline.

    This command imports images from a local directory (e.g., camera exports, downloads) and:

    1. Discovers image files in the directory (optionally recursive)
    2. Creates image records in database with local file references
    3. Extracts metadata (dimensions, format, embedded EXIF data)
    4. Generates thumbnails (stored in GCP Cloud Storage)
    5. Computes image embeddings using ML models for visual search
    6. Applies configured keywords to images based on ML tagging models

    Storage: Images remain local, thumbnails uploaded to GCP Cloud Storage.
    Metadata and tags stored in PostgreSQL database.
    Use for testing locally before syncing with Dropbox."""

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

    # Load tenant config from DB
    config_mgr = ConfigManager(session, tenant_id)
    keywords = config_mgr.get_all_keywords()
    people = config_mgr.get_people()
    click.echo(f"  Keywords: {len(keywords)} total")
    click.echo(f"  People: {len(people)}")

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


@cli.command()
@click.option('--tenant-id', required=True, help='Tenant ID for which to refresh metadata')
@click.option('--limit', default=None, type=int, help='Maximum number of images to process (unlimited if not specified)')
@click.option('--offset', default=0, type=int, help='Skip first N images in the list (useful for resuming)')
@click.option('--batch-size', default=50, type=int, help='Number of images to batch before committing to database')
@click.option('--download-exif/--no-download-exif', default=False, help='Download full image files to extract embedded EXIF (slow but thorough)')
@click.option('--update-exif/--no-update-exif', default=True, help='Store merged EXIF data in database (not stored in GCP buckets)')
@click.option('--dry-run', is_flag=True, help='Preview changes without writing to database')
def refresh_metadata(
    tenant_id: str,
    limit: Optional[int],
    offset: int,
    batch_size: int,
    download_exif: bool,
    update_exif: bool,
    dry_run: bool
):
    """Refresh missing EXIF and camera metadata for images by querying Dropbox.

    Fills in missing metadata fields (capture time, GPS, ISO, aperture, shutter speed,
    focal length, camera/lens model, image dimensions, etc.) by:

    1. Using Dropbox's built-in media_info API (no download needed) - fastest method
    2. Optionally downloading full images to extract embedded EXIF data (--download-exif)
    3. Merging all sources and storing in database exif_data column

    Storage: Metadata is stored in PostgreSQL database, not in GCP buckets.
    Use --dry-run to preview changes first."""
    engine = create_engine(settings.database_url)
    Session = sessionmaker(bind=engine)
    session = Session()

    tenant_row = session.query(TenantModel).filter(TenantModel.id == tenant_id).first()
    if not tenant_row:
        raise click.ClickException(f"Tenant {tenant_id} not found in database")
    if not tenant_row.dropbox_app_key:
        raise click.ClickException("Dropbox app key not configured for tenant")

    try:
        refresh_token = get_secret(f"dropbox-token-{tenant_id}")
    except Exception as exc:
        raise click.ClickException(f"Dropbox token not found: {exc}")

    try:
        app_secret = get_secret(f"dropbox-app-secret-{tenant_id}")
    except Exception as exc:
        raise click.ClickException(f"Dropbox app secret not found: {exc}")

    from dropbox import Dropbox

    dbx = Dropbox(
        oauth2_refresh_token=refresh_token,
        app_key=tenant_row.dropbox_app_key,
        app_secret=app_secret
    )

    missing_filter = or_(
        ImageMetadata.capture_timestamp.is_(None),
        ImageMetadata.gps_latitude.is_(None),
        ImageMetadata.gps_longitude.is_(None),
        ImageMetadata.iso.is_(None),
        ImageMetadata.aperture.is_(None),
        ImageMetadata.shutter_speed.is_(None),
        ImageMetadata.focal_length.is_(None),
        ImageMetadata.camera_make.is_(None),
        ImageMetadata.camera_model.is_(None),
        ImageMetadata.lens_model.is_(None),
        ImageMetadata.modified_time.is_(None),
        ImageMetadata.exif_data.is_(None),
    )

    base_query = session.query(ImageMetadata).filter(
        ImageMetadata.tenant_id == tenant_id,
        missing_filter
    ).order_by(ImageMetadata.id.desc())

    if offset:
        base_query = base_query.offset(offset)

    total_count = base_query.count()
    if not total_count:
        click.echo("No images with missing metadata.")
        return

    processor = ImageProcessor() if download_exif else None
    updated = 0
    skipped = 0
    failed = 0

    click.echo(f"Refreshing metadata for {total_count} images...")
    processed = 0
    last_id = None
    while True:
        query = base_query
        if last_id is not None:
            query = query.filter(ImageMetadata.id < last_id)
        batch = query.limit(batch_size).all()
        if not batch:
            break
        for image in batch:
            processed += 1
            last_id = image.id
            dropbox_refs = []
            if image.dropbox_id and not image.dropbox_id.startswith("local_"):
                dropbox_refs.append(
                    image.dropbox_id if image.dropbox_id.startswith("id:") else f"id:{image.dropbox_id}"
                )
            if image.dropbox_path and not image.dropbox_path.startswith("/local/"):
                dropbox_refs.append(image.dropbox_path)

            if not dropbox_refs:
                skipped += 1
                continue

            try:
                try:
                    from dropbox.files import IncludePropertyGroups
                    include_property_groups = IncludePropertyGroups.filter_some([])
                except ImportError:
                    include_property_groups = None
                metadata_kwargs = {
                    "include_media_info": True,
                }
                if include_property_groups is not None:
                    metadata_kwargs["include_property_groups"] = include_property_groups
            except Exception as exc:
                failed += 1
                click.echo(f"\nFailed to prepare Dropbox metadata for {image.id}: {exc}")
                continue

            metadata_result = None
            last_exc = None
            for ref in dropbox_refs:
                try:
                    metadata_result = dbx.files_get_metadata(ref, **metadata_kwargs)
                    break
                except Exception as exc:
                    last_exc = exc
                    continue

            if metadata_result is None:
                failed += 1
                click.echo(f"\nFailed to load Dropbox metadata for {image.id}: {last_exc}")
                continue

            dropbox_exif = {}
            if hasattr(metadata_result, 'media_info') and metadata_result.media_info:
                media_info = metadata_result.media_info.get_metadata()
                if hasattr(media_info, 'dimensions') and media_info.dimensions:
                    dropbox_exif['ImageWidth'] = media_info.dimensions.width
                    dropbox_exif['ImageLength'] = media_info.dimensions.height
                if hasattr(media_info, 'location') and media_info.location:
                    dropbox_exif['GPSLatitude'] = media_info.location.latitude
                    dropbox_exif['GPSLongitude'] = media_info.location.longitude
                if hasattr(media_info, 'time_taken') and media_info.time_taken:
                    dropbox_exif['DateTimeOriginal'] = media_info.time_taken.isoformat()
                    dropbox_exif['DateTime'] = media_info.time_taken.isoformat()

            extracted_exif = {}
            if download_exif:
                try:
                    _, response = dbx.files_download(dropbox_path)
                    img = processor.load_image(response.content)
                    extracted_exif = processor.extract_exif(img)
                except Exception as exc:
                    click.echo(f"\nEXIF download failed for {image.id}: {exc}")

            merged_exif = {}
            if update_exif:
                if image.exif_data:
                    merged_exif.update(image.exif_data)
                if extracted_exif:
                    merged_exif.update(extracted_exif)
                if dropbox_exif:
                    merged_exif.update(dropbox_exif)

            exif_source = merged_exif or image.exif_data or dropbox_exif
            updates = {}

            if image.capture_timestamp is None:
                capture_timestamp = parse_exif_datetime(
                    get_exif_value(exif_source, "DateTimeOriginal", "DateTime")
                )
                if capture_timestamp:
                    updates["capture_timestamp"] = capture_timestamp

            if image.modified_time is None and hasattr(metadata_result, "server_modified"):
                updates["modified_time"] = metadata_result.server_modified

            if image.gps_latitude is None:
                gps_latitude = parse_exif_float(get_exif_value(exif_source, "GPSLatitude"))
                if gps_latitude is not None:
                    updates["gps_latitude"] = gps_latitude

            if image.gps_longitude is None:
                gps_longitude = parse_exif_float(get_exif_value(exif_source, "GPSLongitude"))
                if gps_longitude is not None:
                    updates["gps_longitude"] = gps_longitude

            if image.iso is None:
                iso = parse_exif_int(get_exif_value(exif_source, "ISOSpeedRatings", "ISOSpeed", "ISO"))
                if iso is not None:
                    updates["iso"] = iso

            if image.aperture is None:
                aperture = parse_exif_float(get_exif_value(exif_source, "FNumber", "ApertureValue"))
                if aperture is not None:
                    updates["aperture"] = aperture

            if image.shutter_speed is None:
                shutter_speed = parse_exif_str(get_exif_value(exif_source, "ExposureTime", "ShutterSpeedValue"))
                if shutter_speed:
                    updates["shutter_speed"] = shutter_speed

            if image.focal_length is None:
                focal_length = parse_exif_float(get_exif_value(exif_source, "FocalLength"))
                if focal_length is not None:
                    updates["focal_length"] = focal_length

            if image.camera_make is None:
                camera_make = parse_exif_str(get_exif_value(exif_source, "Make"))
                if camera_make:
                    updates["camera_make"] = camera_make

            if image.camera_model is None:
                camera_model = parse_exif_str(get_exif_value(exif_source, "Model"))
                if camera_model:
                    updates["camera_model"] = camera_model

            if image.lens_model is None:
                lens_model = parse_exif_str(get_exif_value(exif_source, "LensModel"))
                if lens_model:
                    updates["lens_model"] = lens_model

            if update_exif and merged_exif and merged_exif != (image.exif_data or {}):
                updates["exif_data"] = merged_exif

            if updates:
                updated += 1
                if not dry_run:
                    for key, value in updates.items():
                        setattr(image, key, value)

        if not dry_run:
            session.commit()
        session.expire_all()

        if limit and processed >= limit:
            break

        percent = (processed / total_count) * 100 if total_count else 0
        status = (
            f"Refreshing metadata  [{('=' * int(percent // 3)).ljust(36, '-')}]"
            f"  {percent:5.1f}%  Updated: {updated} · Skipped: {skipped} · Failed: {failed}"
        )
        click.echo(status, nl=False, err=True)
        click.echo("\r", nl=False, err=True)

    click.echo()
    click.echo(f"✓ Metadata refresh complete. Updated: {updated} · Skipped: {skipped} · Failed: {failed}")


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
    capture_timestamp = parse_exif_datetime(get_exif_value(exif, "DateTimeOriginal", "DateTime"))
    gps_latitude = parse_exif_float(get_exif_value(exif, "GPSLatitude"))
    gps_longitude = parse_exif_float(get_exif_value(exif, "GPSLongitude"))
    iso = parse_exif_int(get_exif_value(exif, "ISOSpeedRatings", "ISOSpeed", "ISO"))
    aperture = parse_exif_float(get_exif_value(exif, "FNumber", "ApertureValue"))
    shutter_speed = parse_exif_str(get_exif_value(exif, "ExposureTime", "ShutterSpeedValue"))
    focal_length = parse_exif_float(get_exif_value(exif, "FocalLength"))
    
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
        capture_timestamp=capture_timestamp,
        gps_latitude=gps_latitude,
        gps_longitude=gps_longitude,
        iso=iso,
        aperture=aperture,
        shutter_speed=shutter_speed,
        focal_length=focal_length,
        thumbnail_path=thumbnail_path,
        embedding_generated=False,
        faces_detected=False,
        tags_applied=False,
    )
    
    session.add(metadata)


@cli.command()
@click.option('--tenant-id', required=True, help='Tenant ID for which to compute embeddings')
@click.option('--limit', default=None, type=int, help='Maximum number of images to process (unlimited if not specified)')
@click.option('--force/--no-force', default=False, help='Recompute embeddings even if already generated (--force flag)')
def build_embeddings(tenant_id: str, limit: Optional[int], force: bool):
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
    Use --force to recompute embeddings with different model or model weights."""
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
@click.option('--tenant-id', required=True, help='Tenant ID for which to train models')
@click.option('--min-positive', default=None, type=int, help='Minimum positive examples required for a keyword to be trained')
@click.option('--min-negative', default=None, type=int, help='Minimum negative examples required for a keyword to be trained')
def train_keyword_models(tenant_id: str, min_positive: Optional[int], min_negative: Optional[int]):
    """Train custom ML keyword models from user-verified image tags.

    This command builds tenant-specific keyword classifier models by:

    1. Querying database for images tagged with each keyword (user-verified tags)
    2. Filtering out images without enough positive/negative examples
    3. Computing centroid embeddings for each keyword class
    4. Storing trained models for use in image classification

    Use this to improve keyword assignment accuracy based on your specific image library
    and tagging patterns. Requires user-verified tags to learn from.

    Storage: Trained models stored in database, embedding vectors in PostgreSQL.
    Run this after manually tagging/rating a good sample of images."""
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
@click.option('--tenant-id', required=True, help='Tenant ID for which to recompute tags')
@click.option('--batch-size', default=50, type=int, help='Number of images to batch before committing to database')
@click.option('--limit', default=None, type=int, help='Maximum number of images to process (unlimited if not specified)')
@click.option('--offset', default=0, type=int, help='Skip first N images in the list (useful for resuming)')
@click.option('--replace', is_flag=True, default=False, help='Replace all existing tags (--replace flag), otherwise only backfill missing ones')
@click.option('--older-than-days', default=None, type=float, help='Only process images with trained tags older than this many days')
def recompute_trained_tags(tenant_id: str, batch_size: int, limit: Optional[int], offset: int, replace: bool, older_than_days: Optional[float]):
    """Recompute ML keyword tags using tenant-trained models.

    This command applies trained keyword models to all images to:

    1. Load tenant-specific trained keyword models from database
    2. Retrieve each image embedding from database
    3. Score image against all keyword models
    4. Update MachineTag records with new keyword assignments

    Modes:
    - Default: Only fill in missing tags (skip images that already have tags)
    - --replace: Recalculate all tags (overwrites existing ones)

    Use this after training keyword models to apply them, or to refresh tags
    when model weights or keyword definitions change.

    Storage: Tag data is stored in PostgreSQL database, not GCP buckets."""
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

    base_query = session.query(ImageMetadata).filter_by(tenant_id=tenant.id)
    if older_than_days is not None:
        cutoff = datetime.utcnow() - timedelta(days=older_than_days)
        last_tagged_subquery = session.query(
            MachineTag.image_id.label('image_id'),
            func.max(MachineTag.created_at).label('last_tagged_at')
        ).filter(
            MachineTag.tenant_id == tenant.id,
            MachineTag.tag_type == 'trained',
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
                    threshold=settings.keyword_model_threshold,
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
@click.option('--tenant-id', default='demo', help='Tenant ID for which to list images')
@click.option('--limit', default=10, help='Maximum number of images to display')
def list_images(tenant_id: str, limit: int):
    """Display recently processed images for a tenant with metadata.

    This command shows:
    - Image ID and file path
    - Upload/capture date
    - Image dimensions and file size
    - Keywords assigned to each image
    - Rating and other metadata

    Useful for verifying that images were processed correctly and for debugging
    metadata extraction or keyword assignment issues."""
    
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
    """Display tenant configuration including keywords and people.

    This command displays:
    - All keyword categories configured for the tenant
    - Keywords within each category (first 5 listed, total count shown)
    - All people (face recognition) entries configured for tenant
    - Number of face embeddings per person

    Useful for reviewing what keywords and people are available for tagging,
    and for verifying configuration was loaded correctly."""
    
    engine = create_engine(settings.database_url)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        config_mgr = ConfigManager(session, tenant_id)
        keywords = config_mgr.get_all_keywords()
        people = config_mgr.get_people()

        click.echo(f"\nConfiguration for tenant: {tenant_id}")
        click.echo("=" * 80)

        categories = {}
        for kw in keywords:
            categories.setdefault(kw['category'], []).append(kw['keyword'])

        click.echo(f"\nKeywords ({len(categories)} categories):")
        for category, category_keywords in categories.items():
            click.echo(f"  • {category}: {', '.join(category_keywords[:5])}")
            if len(category_keywords) > 5:
                click.echo(f"    ... and {len(category_keywords) - 5} more")

        click.echo(f"\nPeople ({len(people)}):")
        for person in people:
            aliases = f" (aka {', '.join(person.get('aliases', []))})" if person.get('aliases') else ""
            click.echo(f"  • {person.get('name')}{aliases}")
    finally:
        session.close()


@cli.command(name='recompute-siglip-tags')
@click.option('--tenant-id', required=True, help='Tenant ID for which to recompute SigLIP tags')
@click.option('--batch-size', default=50, type=int, help='Process images in batches')
@click.option('--limit', default=None, type=int, help='Limit number of images to process')
@click.option('--offset', default=0, type=int, help='Offset into image list')
@click.option('--replace', is_flag=True, default=False, help='Replace existing SigLIP tags')
@click.option('--older-than-days', default=None, type=float, help='Only process images with SigLIP tags older than this many days')
def recompute_siglip_tags(
    tenant_id: str,
    batch_size: int,
    limit: Optional[int],
    offset: int,
    replace: bool,
    older_than_days: Optional[float]
):
    """Recompute SigLIP-based keyword tags for all images in a tenant."""
    from photocat.cli.commands.tagging import RecomputeSiglipTagsCommand

    cmd = RecomputeSiglipTagsCommand(
        tenant_id,
        batch_size,
        limit,
        offset,
        replace,
        older_than_days
    )
    cmd.run()


@cli.command(name='sync-dropbox')
@click.option('--tenant-id', default='demo', help='Tenant ID to sync')
@click.option('--count', default=1, help='Number of images to sync (default: 1)')
def sync_dropbox(tenant_id: str, count: int):
    """Sync images from Dropbox (same as pressing sync button on web)."""

    # Setup database
    engine = create_engine(settings.database_url)
    Session = sessionmaker(bind=engine)
    db = Session()

    try:
        # Load tenant
        tenant = db.query(TenantModel).filter(TenantModel.id == tenant_id).first()
        if not tenant:
            click.echo(f"Error: Tenant {tenant_id} not found", err=True)
            return

        TenantContext.set(Tenant(
            id=tenant.id,
            name=tenant.name,
            storage_bucket=tenant.storage_bucket,
            thumbnail_bucket=tenant.thumbnail_bucket
        ))

        click.echo(f"Syncing from Dropbox for tenant: {tenant.name}")

        # Get Dropbox credentials
        try:
            dropbox_token = get_secret(f"dropbox-token-{tenant_id}")
        except Exception as exc:
            click.echo(f"Error: No Dropbox refresh token configured ({exc})", err=True)
            return

        if not tenant.dropbox_app_key:
            click.echo("Error: Dropbox app key not configured", err=True)
            return
        try:
            dropbox_app_secret = get_secret(f"dropbox-app-secret-{tenant_id}")
        except Exception as exc:
            click.echo(f"Error: Dropbox app secret not configured ({exc})", err=True)
            return

        # Initialize Dropbox client
        dropbox_client = DropboxClient(
            refresh_token=dropbox_token,
            app_key=tenant.dropbox_app_key,
            app_secret=dropbox_app_secret,
        )

        # Get sync folders from tenant config or use root
        config_mgr = ConfigManager(db, tenant_id)
        tenant_config = db.query(TenantModel).filter(TenantModel.id == tenant_id).first()
        sync_folders = []
        if tenant_config.config_data and 'sync_folders' in tenant_config.config_data:
            sync_folders = tenant_config.config_data['sync_folders']

        if not sync_folders:
            sync_folders = ['']  # Root if no folders configured

        click.echo(f"Sync folders: {sync_folders}")

        # Get all keywords
        all_keywords = config_mgr.get_all_keywords()
        if not all_keywords:
            click.echo("Error: No keywords configured", err=True)
            return

        # Group keywords by category
        by_category = {}
        for kw in all_keywords:
            cat = kw['category']
            if cat not in by_category:
                by_category[cat] = []
            by_category[cat].append(kw)

        click.echo(f"Keywords: {len(all_keywords)} in {len(by_category)} categories")

        # Get tagger
        tagger = get_tagger(model_type=settings.tagging_model)
        model_name = getattr(tagger, "model_name", settings.tagging_model)
        model_version = getattr(tagger, "model_version", model_name)

        # Process images
        processed = 0
        for folder in sync_folders:
            if processed >= count:
                break

            click.echo(f"\nListing folder: {folder or '(root)'}")

            # Get list of files in folder
            result = dropbox_client.list_folder(folder, recursive=True)
            entries = result.get('entries', [])

            click.echo(f"Found {len(entries)} entries")

            # Filter to image files
            processor = ImageProcessor()
            unprocessed = []

            for entry in entries:
                if entry.get('tag') == 'file' and processor.is_supported(entry.get('name', '')):
                    # Check if already processed
                    dropbox_id = entry.get('id')
                    existing = db.query(ImageMetadata).filter(
                        ImageMetadata.tenant_id == tenant_id,
                        ImageMetadata.dropbox_id == dropbox_id
                    ).first()

                    if not existing:
                        unprocessed.append(entry)

            click.echo(f"Found {len(unprocessed)} unprocessed images")

            # Process images one by one
            for entry in unprocessed:
                if processed >= count:
                    break

                try:
                    dropbox_path = entry['path_display']
                    click.echo(f"\nProcessing: {dropbox_path}")

                    # Download thumbnail
                    thumbnail_data = dropbox_client.get_thumbnail(entry['id'], size='w640h480')
                    if not thumbnail_data:
                        click.echo(f"  ✗ Failed to download thumbnail", err=True)
                        continue

                    # Extract features
                    processor = ImageProcessor()
                    image = Image.open(io.BytesIO(thumbnail_data))
                    if image.mode != "RGB":
                        image = image.convert("RGB")

                    features = processor.extract_visual_features(image)

                    # Get metadata from Dropbox
                    dropbox_meta = dropbox_client.get_metadata(entry['id'])
                    media_info = dropbox_meta.get('media_info', {})

                    click.echo(f"  Dimensions: {features['width']}x{features['height']}")

                    # Extract EXIF and other metadata
                    exif = {}
                    try:
                        img_pil = Image.open(io.BytesIO(thumbnail_data))
                        exif_data = img_pil._getexif() if hasattr(img_pil, '_getexif') else None
                        if exif_data:
                            from PIL.ExifTags import TAGS
                            exif = {TAGS.get(k, k): v for k, v in exif_data.items()}
                    except Exception:
                        pass

                    # Create metadata record
                    metadata = ImageMetadata(
                        tenant_id=tenant_id,
                        filename=entry.get('name', ''),
                        dropbox_id=entry.get('id'),
                        dropbox_path=dropbox_path,
                        width=features['width'],
                        height=features['height'],
                        format=features['format'],
                        perceptual_hash=features['perceptual_hash'],
                        color_histogram=features['color_histogram'],
                        exif_data=exif,
                        thumbnail_path='',
                        embedding_generated=False,
                        faces_detected=False,
                        tags_applied=False,
                    )
                    db.add(metadata)
                    db.commit()
                    db.refresh(metadata)

                    click.echo(f"  ✓ Metadata recorded (ID: {metadata.id})")

                    try:
                        ensure_image_embedding(
                            db,
                            tenant_id,
                            metadata.id,
                            thumbnail_data,
                            model_name,
                            model_version
                        )
                        db.commit()
                    except Exception as embed_error:
                        click.echo(f"  ✗ Embedding error: {embed_error}", err=True)

                    # Tag with model
                    click.echo(f"  Running {settings.tagging_model} inference...")

                    # Delete existing tags
                    db.query(MachineTag).filter(
                        MachineTag.image_id == metadata.id,
                        MachineTag.tag_type == 'siglip'
                    ).delete()

                    # Score keywords
                    all_tags = score_keywords_for_categories(
                        image_data=thumbnail_data,
                        keywords_by_category=by_category,
                        model_type=settings.tagging_model,
                        threshold=settings.keyword_model_threshold
                    )

                    click.echo(f"  Found {len(all_tags)} tags")

                    # Create tag records
                    for keyword_str, confidence in all_tags:
                        keyword_record = db.query(Keyword).filter(
                            Keyword.tenant_id == tenant_id,
                            Keyword.keyword == keyword_str
                        ).first()

                        if not keyword_record:
                            continue

                        tag = MachineTag(
                            image_id=metadata.id,
                            tenant_id=tenant_id,
                            keyword_id=keyword_record.id,
                            confidence=confidence,
                            tag_type='siglip',
                            model_name=model_name,
                            model_version=model_version
                        )
                        db.add(tag)

                    metadata.tags_applied = len(all_tags) > 0
                    db.commit()

                    click.echo(f"  ✓ Complete: {len(all_tags)} tags applied")
                    processed += 1

                except Exception as e:
                    click.echo(f"  ✗ Error: {e}", err=True)
                    db.rollback()

        click.echo(f"\n✓ Synced {processed} images from Dropbox")

    finally:
        db.close()


if __name__ == '__main__':
    cli()
