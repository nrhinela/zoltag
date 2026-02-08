"""Utilities for embedding storage and lightweight keyword models."""

from __future__ import annotations

from datetime import datetime
from typing import Dict, Iterable, List, Optional, Tuple

import numpy as np
from sqlalchemy.orm import Session

from photocat.metadata import ImageEmbedding, ImageMetadata, KeywordModel, Permatag, MachineTag
from photocat.models.config import Keyword
from photocat.settings import settings
from photocat.tagging import get_image_embedding, get_tagger


def ensure_image_embedding(
    db: Session,
    tenant_id: str,
    image_id: int,
    image_data: bytes,
    model_name: str,
    model_version: str,
    asset_id=None,
) -> ImageEmbedding:
    """Persist an image embedding if missing and return it.

    Handles concurrent inserts gracefully by catching unique constraint violations
    and re-querying for the existing record.
    """
    image = db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        ImageMetadata.tenant_id == tenant_id
    ).first()
    resolved_asset_id = asset_id if asset_id is not None else (image.asset_id if image else None)
    if resolved_asset_id is None:
        raise ValueError(
            f"Image {image_id} for tenant {tenant_id} has no asset_id; "
            "run asset bridge backfills before generating embeddings."
        )

    # Try to fetch existing embedding first
    existing = db.query(ImageEmbedding).filter(
        ImageEmbedding.tenant_id == tenant_id,
        ImageEmbedding.asset_id == resolved_asset_id
    ).first()
    if existing:
        if existing.asset_id is None and resolved_asset_id is not None:
            existing.asset_id = resolved_asset_id
        if image:
            image.embedding_generated = True
        return existing

    embedding = get_image_embedding(image_data, model_type=settings.tagging_model)
    record = ImageEmbedding(
        asset_id=resolved_asset_id,
        tenant_id=tenant_id,
        embedding=embedding,
        model_name=model_name,
        model_version=model_version
    )
    db.add(record)

    try:
        db.flush()
    except Exception as e:
        # If we get a unique constraint violation, another process inserted it
        # Roll back and re-fetch the existing record
        if "duplicate key" in str(e).lower() or "unique" in str(e).lower():
            db.rollback()
            existing = db.query(ImageEmbedding).filter(
                ImageEmbedding.tenant_id == tenant_id,
                ImageEmbedding.asset_id == resolved_asset_id
            ).first()
            if existing:
                if existing.asset_id is None and resolved_asset_id is not None:
                    existing.asset_id = resolved_asset_id
                return existing
        # Re-raise if it's a different error
        raise

    if image:
        image.embedding_generated = True

    return record


def load_keyword_models(
    db: Session,
    tenant_id: str,
    model_name: str
) -> Dict[str, KeywordModel]:
    """Load keyword models for a tenant."""
    rows = db.query(KeywordModel).filter(
        KeywordModel.tenant_id == tenant_id,
        KeywordModel.model_name == model_name
    ).all()
    # Map keyword name to KeywordModel using the FK relationship
    keyword_models = {}
    for row in rows:
        keyword = db.query(Keyword).filter(Keyword.id == row.keyword_id).first()
        if keyword:
            keyword_models[keyword.keyword] = row
    return keyword_models


def score_image_with_models(
    image_embedding: List[float],
    keyword_models: Dict[str, KeywordModel]
) -> Dict[str, float]:
    """Compute keyword scores using stored centroids."""
    if not keyword_models:
        return {}

    embedding = np.array(image_embedding, dtype=np.float32)
    scores = {}

    for keyword, model in keyword_models.items():
        pos = np.array(model.positive_centroid, dtype=np.float32)
        pos_sim = _cosine_similarity(embedding, pos)

        if model.negative_centroid:
            neg = np.array(model.negative_centroid, dtype=np.float32)
            neg_sim = _cosine_similarity(embedding, neg)
            score = (pos_sim - neg_sim + 1.0) / 2.0
        else:
            score = (pos_sim + 1.0) / 2.0

        scores[keyword] = float(max(0.0, min(1.0, score)))

    return scores


def compute_combined_scores(
    prompt_scores: Iterable[Tuple[str, float]],
    model_scores: Dict[str, float],
    model_weight: float
) -> Dict[str, float]:
    """Blend prompt scores with model scores."""
    combined = {}
    for keyword, prompt_score in prompt_scores:
        if keyword in model_scores:
            combined_score = model_weight * model_scores[keyword] + (1.0 - model_weight) * prompt_score
        else:
            combined_score = prompt_score
        combined[keyword] = float(combined_score)
    return combined


def recompute_trained_tags_for_image(
    db: Session,
    tenant_id: str,
    image_id: int,
    image_data: Optional[bytes],
    keywords_by_category: Dict[str, List[dict]],
    keyword_models: Dict[str, KeywordModel],
    keyword_to_category: Dict[str, str],
    model_name: str,
    model_version: str,
    model_type: str,
    threshold: float,
    model_weight: float,
    embedding: Optional[List[float]] = None,
    keyword_id_map: Optional[Dict[str, int]] = None,
    asset_id=None,
) -> List[dict]:
    """Compute and persist trained tags for a single image."""
    if not keyword_models:
        return []

    if embedding is None:
        if image_data is None:
            return []
        embedding_record = ensure_image_embedding(
            db,
            tenant_id,
            image_id,
            image_data,
            model_name,
            model_version,
            asset_id=asset_id,
        )
        embedding = embedding_record.embedding
    model_scores = score_image_with_models(embedding, keyword_models)

    trained_tags = [
        {
            "keyword": keyword,
            "category": keyword_to_category.get(keyword),
            "confidence": round(score, 2)
        }
        for keyword, score in model_scores.items()
        if score >= threshold
    ]
    trained_tags.sort(key=lambda x: x["confidence"], reverse=True)

    db.query(MachineTag).filter(
        MachineTag.tenant_id == tenant_id,
        MachineTag.asset_id == asset_id,
        MachineTag.tag_type == 'trained',
        MachineTag.model_name == model_name
    ).delete()

    if asset_id is None:
        image_row = db.query(ImageMetadata.asset_id).filter(
            ImageMetadata.tenant_id == tenant_id,
            ImageMetadata.id == image_id,
        ).first()
        asset_id = image_row[0] if image_row else None

    for tag in trained_tags:
        # Look up keyword_id for this keyword
        keyword_id = None
        if keyword_id_map is not None:
            keyword_id = keyword_id_map.get(tag["keyword"])
        if keyword_id is None:
            keyword_obj = db.query(Keyword).filter(
                Keyword.keyword == tag["keyword"],
                Keyword.tenant_id == tenant_id
            ).first()
            keyword_id = keyword_obj.id if keyword_obj else None
        if not keyword_id:
            print(f"Warning: Keyword '{tag['keyword']}' not found for tenant {tenant_id}")
            continue

        db.add(MachineTag(
            tenant_id=tenant_id,
            asset_id=asset_id,
            keyword_id=keyword_id,
            confidence=tag["confidence"],
            tag_type='trained',
            model_name=model_name,
            model_version=model_version
        ))

    return trained_tags


def score_keywords_for_categories(
    image_data: bytes,
    keywords_by_category: Dict[str, List[dict]],
    model_type: str,
    threshold: float,
    model_scores: Optional[Dict[str, float]] = None,
    model_weight: float = 0.6
) -> List[Tuple[str, float]]:
    """Compute keyword scores per category with optional model blending."""
    tagger = get_tagger(model_type=model_type)
    all_tags: List[Tuple[str, float]] = []

    for _, keywords in keywords_by_category.items():
        # Skip zero-shot scoring for keywords without explicit prompts.
        eligible_keywords = [
            kw for kw in keywords
            if isinstance(kw.get("prompt"), str) and kw["prompt"].strip()
        ]
        if not eligible_keywords:
            continue
        prompt_scores = tagger.tag_image(image_data, eligible_keywords, threshold=0.0)
        combined_scores = compute_combined_scores(prompt_scores, model_scores or {}, model_weight)
        for keyword, score in combined_scores.items():
            if score >= threshold:
                all_tags.append((keyword, score))

    all_tags.sort(key=lambda x: x[1], reverse=True)
    return all_tags


def build_keyword_models(
    db: Session,
    tenant_id: str,
    model_name: str,
    model_version: str,
    min_positive: int = 2,
    min_negative: int = 2
) -> Dict[str, int]:
    """Create or update keyword models using permatag labels."""
    permatags = db.query(Permatag).filter(
        Permatag.tenant_id == tenant_id,
        Permatag.asset_id.is_not(None),
    ).all()

    # Map keyword_id to keyword name and organize by name
    keyword_ids = {pt.keyword_id for pt in permatags}
    keyword_map = {}
    if keyword_ids:
        keywords = db.query(Keyword).filter(Keyword.id.in_(keyword_ids)).all()
        keyword_map = {kw.id: kw.keyword for kw in keywords}

    positive_ids: Dict[str, List[str]] = {}
    negative_ids: Dict[str, List[str]] = {}
    for tag in permatags:
        keyword_name = keyword_map.get(tag.keyword_id)
        if not keyword_name:
            continue
        bucket = positive_ids if tag.signum == 1 else negative_ids
        bucket.setdefault(keyword_name, []).append(str(tag.asset_id))

    trained = 0
    skipped = 0

    for keyword, pos_ids in positive_ids.items():
        neg_ids = negative_ids.get(keyword, [])
        # Require minimum positive examples, but allow zero negative examples
        if len(pos_ids) < min_positive:
            skipped += 1
            continue

        pos_embeddings = _fetch_embeddings(db, tenant_id, pos_ids)
        neg_embeddings = _fetch_embeddings(db, tenant_id, neg_ids) if neg_ids else []

        if not pos_embeddings:
            skipped += 1
            continue

        pos_centroid = np.mean(np.array(pos_embeddings), axis=0).tolist()
        # Use zero vector if no negative examples available
        neg_centroid = np.mean(np.array(neg_embeddings), axis=0).tolist() if neg_embeddings else [0.0] * len(pos_centroid)

        # Look up keyword_id for this keyword name
        keyword_obj = db.query(Keyword).filter(
            Keyword.keyword == keyword,
            Keyword.tenant_id == tenant_id
        ).first()
        if not keyword_obj:
            skipped += 1
            continue

        existing = db.query(KeywordModel).filter(
            KeywordModel.tenant_id == tenant_id,
            KeywordModel.keyword_id == keyword_obj.id,
            KeywordModel.model_name == model_name
        ).first()

        if existing:
            existing.positive_centroid = pos_centroid
            existing.negative_centroid = neg_centroid
            existing.model_version = model_version
            existing.updated_at = datetime.utcnow()
        else:
            db.add(KeywordModel(
                tenant_id=tenant_id,
                keyword_id=keyword_obj.id,
                model_name=model_name,
                model_version=model_version,
                positive_centroid=pos_centroid,
                negative_centroid=neg_centroid
            ))

        trained += 1

    return {"trained": trained, "skipped": skipped}


def _fetch_embeddings(
    db: Session,
    tenant_id: str,
    asset_ids: List[str]
) -> List[List[float]]:
    rows = db.query(ImageEmbedding).filter(
        ImageEmbedding.tenant_id == tenant_id,
        ImageEmbedding.asset_id.in_(asset_ids)
    ).all()
    return [row.embedding for row in rows]


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    if a.size == 0 or b.size == 0:
        return 0.0
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    if denom == 0:
        return 0.0
    return float(np.dot(a, b) / denom)
