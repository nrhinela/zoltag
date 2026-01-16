"""Utilities for embedding storage and lightweight keyword models."""

from __future__ import annotations

from datetime import datetime
from typing import Dict, Iterable, List, Optional, Tuple

import numpy as np
from sqlalchemy.orm import Session

from photocat.metadata import ImageEmbedding, ImageMetadata, KeywordModel, Permatag, MachineTag
from photocat.settings import settings
from photocat.tagging import get_image_embedding, get_tagger


def ensure_image_embedding(
    db: Session,
    tenant_id: str,
    image_id: int,
    image_data: bytes,
    model_name: str,
    model_version: str
) -> ImageEmbedding:
    """Persist an image embedding if missing and return it."""
    existing = db.query(ImageEmbedding).filter(
        ImageEmbedding.tenant_id == tenant_id,
        ImageEmbedding.image_id == image_id
    ).first()
    if existing:
        return existing

    embedding = get_image_embedding(image_data, model_type=settings.tagging_model)
    record = ImageEmbedding(
        image_id=image_id,
        tenant_id=tenant_id,
        embedding=embedding,
        model_name=model_name,
        model_version=model_version
    )
    db.add(record)

    image = db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        ImageMetadata.tenant_id == tenant_id
    ).first()
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
    return {row.keyword: row for row in rows}


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
    image_data: bytes,
    keywords_by_category: Dict[str, List[dict]],
    keyword_models: Dict[str, KeywordModel],
    keyword_to_category: Dict[str, str],
    model_name: str,
    model_version: str,
    model_type: str,
    threshold: float,
    model_weight: float
) -> List[dict]:
    """Compute and persist trained tags for a single image."""
    if not keyword_models:
        return []

    embedding_record = ensure_image_embedding(
        db,
        tenant_id,
        image_id,
        image_data,
        model_name,
        model_version
    )
    model_scores = score_image_with_models(embedding_record.embedding, keyword_models)

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
        MachineTag.image_id == image_id,
        MachineTag.tag_type == 'trained',
        MachineTag.model_name == model_name
    ).delete()

    for tag in trained_tags:
        db.add(MachineTag(
            tenant_id=tenant_id,
            image_id=image_id,
            keyword=tag["keyword"],
            category=tag["category"],
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
        prompt_scores = tagger.tag_image(image_data, keywords, threshold=0.0)
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
        Permatag.tenant_id == tenant_id
    ).all()

    positive_ids: Dict[str, List[int]] = {}
    negative_ids: Dict[str, List[int]] = {}
    for tag in permatags:
        bucket = positive_ids if tag.signum == 1 else negative_ids
        bucket.setdefault(tag.keyword, []).append(tag.image_id)

    trained = 0
    skipped = 0

    for keyword, pos_ids in positive_ids.items():
        neg_ids = negative_ids.get(keyword, [])
        if len(pos_ids) < min_positive or len(neg_ids) < min_negative:
            skipped += 1
            continue

        pos_embeddings = _fetch_embeddings(db, tenant_id, pos_ids)
        neg_embeddings = _fetch_embeddings(db, tenant_id, neg_ids)

        if not pos_embeddings or not neg_embeddings:
            skipped += 1
            continue

        pos_centroid = np.mean(np.array(pos_embeddings), axis=0).tolist()
        neg_centroid = np.mean(np.array(neg_embeddings), axis=0).tolist()

        existing = db.query(KeywordModel).filter(
            KeywordModel.tenant_id == tenant_id,
            KeywordModel.keyword == keyword,
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
                keyword=keyword,
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
    image_ids: List[int]
) -> List[List[float]]:
    rows = db.query(ImageEmbedding).filter(
        ImageEmbedding.tenant_id == tenant_id,
        ImageEmbedding.image_id.in_(image_ids)
    ).all()
    return [row.embedding for row in rows]


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    if a.size == 0 or b.size == 0:
        return 0.0
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    if denom == 0:
        return 0.0
    return float(np.dot(a, b) / denom)
