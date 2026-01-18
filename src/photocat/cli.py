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
from photocat.exif import (
    get_exif_value,
    parse_exif_datetime,
    parse_exif_float,
    parse_exif_int,
    parse_exif_str,
)
from photocat.metadata import ImageMetadata, KeywordModel, MachineTag, Tenant as TenantModel
from photocat.learning import (
    build_keyword_models,
    ensure_image_embedding,
    recompute_trained_tags_for_image,
    load_keyword_models
)
from photocat.tagging import get_tagger
from photocat.config.db_config import ConfigManager
from photocat.dependencies import get_secret


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


@cli.command()
@click.option('--tenant-id', required=True, help='Tenant ID')
@click.option('--limit', default=None, type=int, help='Limit number of images to process')
@click.option('--offset', default=0, type=int, help='Offset into the image list')
@click.option('--batch-size', default=50, type=int, help='Commit every N updates')
@click.option('--download-exif/--no-download-exif', default=False, help='Download full image to read EXIF')
@click.option('--update-exif/--no-update-exif', default=True, help='Write merged EXIF to exif_data')
@click.option('--dry-run', is_flag=True, help='Report updates without writing')
def refresh_metadata(
    tenant_id: str,
    limit: Optional[int],
    offset: int,
    batch_size: int,
    download_exif: bool,
    update_exif: bool,
    dry_run: bool
):
    """Refresh missing EXIF-derived metadata from Dropbox."""
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
