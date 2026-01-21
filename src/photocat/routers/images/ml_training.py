"""ML training endpoints: list training images, get training stats."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, distinct
from sqlalchemy.orm import Session
from google.cloud import storage

from photocat.dependencies import get_db, get_tenant, get_tenant_setting
from photocat.tenant import Tenant
from photocat.metadata import ImageMetadata, MachineTag, Permatag, KeywordModel, ImageEmbedding
from photocat.models.config import Keyword, KeywordCategory
from photocat.settings import settings
from photocat.config.db_config import ConfigManager
from photocat.tagging import calculate_tags, get_tagger
from photocat.learning import (
    load_keyword_models,
    recompute_trained_tags_for_image,
)

# Sub-router with no prefix/tags (inherits from parent)
router = APIRouter()


@router.get("/ml-training/images", response_model=dict, operation_id="list_ml_training_images")
async def list_ml_training_images(
    tenant: Tenant = Depends(get_tenant),
    limit: int = 50,
    offset: int = 0,
    refresh: bool = False,
    db: Session = Depends(get_db)
):
    """List images with permatags, ML tags, and trained-ML tags for comparison."""
    images_query = db.query(ImageMetadata).filter_by(tenant_id=tenant.id)
    total = images_query.count()
    images = images_query.order_by(ImageMetadata.id.desc()).limit(limit).offset(offset).all()

    image_ids = [img.id for img in images]
    if not image_ids:
        return {"tenant_id": tenant.id, "images": [], "total": total, "limit": limit, "offset": offset}

    # Get active tag type from tenant settings
    active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')

    tags = db.query(MachineTag).filter(
        MachineTag.tenant_id == tenant.id,
        MachineTag.image_id.in_(image_ids),
        MachineTag.tag_type == active_tag_type
    ).all()

    permatags = db.query(Permatag).filter(
        Permatag.image_id.in_(image_ids)
    ).all()

    # Get latest keyword model name
    model_row = db.query(KeywordModel.model_name).filter(
        KeywordModel.tenant_id == tenant.id
    ).order_by(
        func.coalesce(KeywordModel.updated_at, KeywordModel.created_at).desc()
    ).first()

    cached_trained = []
    if model_row:
        cached_trained = db.query(MachineTag).filter(
            MachineTag.tenant_id == tenant.id,
            MachineTag.image_id.in_(image_ids),
            MachineTag.tag_type == 'trained',
            MachineTag.model_name == model_row.model_name
        ).all()

    # Load all keywords for serialization
    all_keyword_ids = set()
    for tag in tags:
        all_keyword_ids.add(tag.keyword_id)
    for permatag in permatags:
        all_keyword_ids.add(permatag.keyword_id)
    for tag in cached_trained:
        all_keyword_ids.add(tag.keyword_id)

    # Build keyword lookup map
    keywords_map = {}
    if all_keyword_ids:
        keywords_data = db.query(
            Keyword.id,
            Keyword.keyword,
            KeywordCategory.name
        ).join(
            KeywordCategory, Keyword.category_id == KeywordCategory.id
        ).filter(
            Keyword.id.in_(all_keyword_ids)
        ).all()
        for kw_id, kw_name, cat_name in keywords_data:
            keywords_map[kw_id] = {"keyword": kw_name, "category": cat_name}

    tags_by_image = {}
    for tag in tags:
        kw_info = keywords_map.get(tag.keyword_id, {"keyword": "unknown", "category": "unknown"})
        tags_by_image.setdefault(tag.image_id, []).append({
            "keyword": kw_info["keyword"],
            "category": kw_info["category"],
            "confidence": round(tag.confidence, 2)
        })

    permatags_by_image = {}
    for tag in permatags:
        permatags_by_image.setdefault(tag.image_id, []).append(tag)

    trained_by_image = {}
    for tag in cached_trained:
        kw_info = keywords_map.get(tag.keyword_id, {"keyword": "unknown", "category": "unknown"})
        trained_by_image.setdefault(tag.image_id, []).append({
            "keyword": kw_info["keyword"],
            "category": kw_info["category"],
            "confidence": round(tag.confidence or 0, 2)
        })

    config_mgr = ConfigManager(db, tenant.id)
    all_keywords = config_mgr.get_all_keywords()
    keyword_to_category = {kw['keyword']: kw['category'] for kw in all_keywords}
    by_category = {}
    for kw in all_keywords:
        by_category.setdefault(kw['category'], []).append(kw)

    tagger = get_tagger(model_type=settings.tagging_model)
    model_name = getattr(tagger, "model_name", settings.tagging_model)
    model_version = getattr(tagger, "model_version", model_name)
    keyword_models = load_keyword_models(db, tenant.id, model_name)

    storage_client = storage.Client(project=settings.gcp_project_id)
    thumbnail_bucket = storage_client.bucket(tenant.get_thumbnail_bucket(settings))
    trained_by_model = {
        tag.image_id
        for tag in cached_trained
        if tag.model_name == model_name
    }

    images_list = []
    for image in images:
        positive_permatags = sorted(
            [keywords_map.get(tag.keyword_id, {}).get("keyword", "unknown")
             for tag in permatags_by_image.get(image.id, []) if tag.signum == 1]
        )
        machine_tags = sorted(
            tags_by_image.get(image.id, []),
            key=lambda x: x["confidence"],
            reverse=True
        )

        trained_tags = trained_by_image.get(image.id, [])
        if refresh and keyword_models and image.thumbnail_path and image.id not in trained_by_model:
            blob = thumbnail_bucket.blob(image.thumbnail_path)
            if blob.exists():
                image_data = blob.download_as_bytes()
                trained_tags = recompute_trained_tags_for_image(
                    db=db,
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
                trained_by_image[image.id] = trained_tags

        images_list.append({
            "id": image.id,
            "filename": image.filename,
            "thumbnail_url": tenant.get_thumbnail_url(settings, image.thumbnail_path),
            "embedding_generated": bool(image.embedding_generated),
            "positive_permatags": positive_permatags,
            "ml_tags": machine_tags,
            "trained_tags": trained_tags
        })

    if refresh:
        db.commit()

    return {
        "tenant_id": tenant.id,
        "images": images_list,
        "total": total,
        "limit": limit,
        "offset": offset
    }


@router.get("/ml-training/stats", response_model=dict, operation_id="get_ml_training_stats")
async def get_ml_training_stats(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Return ML training summary stats for a tenant."""
    image_count = db.query(func.count(ImageMetadata.id)).filter(
        ImageMetadata.tenant_id == tenant.id
    ).scalar() or 0

    embedding_count = db.query(func.count(ImageEmbedding.id)).filter(
        ImageEmbedding.tenant_id == tenant.id
    ).scalar() or 0

    zero_shot_image_count = db.query(func.count(distinct(MachineTag.image_id))).filter(
        MachineTag.tenant_id == tenant.id,
        MachineTag.tag_type == 'siglip'
    ).scalar() or 0

    model_count = db.query(func.count(KeywordModel.id)).filter(
        KeywordModel.tenant_id == tenant.id
    ).scalar() or 0

    last_trained = db.query(func.max(func.coalesce(
        KeywordModel.updated_at,
        KeywordModel.created_at
    ))).filter(
        KeywordModel.tenant_id == tenant.id
    ).scalar()

    trained_count, trained_oldest, trained_newest = db.query(
        func.count(MachineTag.id),
        func.min(MachineTag.created_at),
        func.max(MachineTag.created_at)
    ).filter(
        MachineTag.tenant_id == tenant.id,
        MachineTag.tag_type == 'trained'
    ).one()

    trained_image_count = db.query(func.count(distinct(MachineTag.image_id))).filter(
        MachineTag.tenant_id == tenant.id,
        MachineTag.tag_type == 'trained'
    ).scalar() or 0

    return {
        "tenant_id": tenant.id,
        "image_count": int(image_count),
        "embedding_count": int(embedding_count),
        "zero_shot_image_count": int(zero_shot_image_count),
        "trained_image_count": int(trained_image_count),
        "keyword_model_count": int(model_count),
        "keyword_model_last_trained": last_trained.isoformat() if last_trained else None,
        "trained_tag_count": int(trained_count or 0),
        "trained_tag_oldest": trained_oldest.isoformat() if trained_oldest else None,
        "trained_tag_newest": trained_newest.isoformat() if trained_newest else None
    }


