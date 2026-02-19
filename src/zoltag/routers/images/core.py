"""Core image endpoints: list, get, asset."""

import json
import logging
import re
import threading
import time
from typing import Dict, List, Optional, Tuple
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, distinct, and_, case, cast, Text, literal, or_, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, load_only
from google.cloud import storage
import numpy as np

from zoltag.dependencies import get_db, get_tenant, get_tenant_setting
from zoltag.activity import EVENT_SEARCH_IMAGES, extract_client_ip, record_activity_event
from zoltag.auth.dependencies import get_current_user, require_tenant_permission_from_header
from zoltag.auth.models import UserProfile
from zoltag.list_visibility import is_tenant_admin_user
from zoltag.asset_helpers import load_assets_for_images
from zoltag.tenant import Tenant
from zoltag.metadata import (
    Asset,
    AssetDerivative,
    AssetTextIndex,
    ImageEmbedding,
    ImageMetadata,
    MachineTag,
    Permatag,
)
from zoltag.models.config import Keyword, PhotoListItem
from zoltag.tagging import calculate_tags, get_tagger
from zoltag.config.db_utils import load_keywords_map
from zoltag.settings import settings
from zoltag.tenant_scope import tenant_column_filter
from zoltag.routers.images._shared import (
    _build_source_url,
    _resolve_storage_or_409,
)

# Sub-router with no prefix/tags (inherits from parent)
router = APIRouter()
logger = logging.getLogger(__name__)

# Columns required by /images list response + ordering logic.
LIST_IMAGES_LOAD_ONLY_COLUMNS = (
    ImageMetadata.id,
    ImageMetadata.asset_id,
    ImageMetadata.tenant_id,
    ImageMetadata.created_at,
    ImageMetadata.filename,
    ImageMetadata.file_size,
    ImageMetadata.modified_time,
    ImageMetadata.width,
    ImageMetadata.height,
    ImageMetadata.format,
    ImageMetadata.camera_make,
    ImageMetadata.camera_model,
    ImageMetadata.lens_model,
    ImageMetadata.iso,
    ImageMetadata.aperture,
    ImageMetadata.shutter_speed,
    ImageMetadata.focal_length,
    ImageMetadata.capture_timestamp,
    ImageMetadata.gps_latitude,
    ImageMetadata.gps_longitude,
    ImageMetadata.last_processed,
    ImageMetadata.tags_applied,
    ImageMetadata.faces_detected,
    ImageMetadata.rating,
)

SIMILARITY_CACHE_TTL_SECONDS = 1800
SIMILARITY_CACHE_MAX_ENTRIES = 12
_similarity_cache_lock = threading.Lock()
_similarity_index_cache = {}
_pgvector_capability_cache: Dict[str, bool] = {}
_asset_text_index_pgvector_capability_cache: Dict[str, bool] = {}
_pg_trgm_capability_cache: Dict[str, bool] = {}
TEXT_QUERY_EMBEDDING_CACHE_TTL_SECONDS = 1800
TEXT_QUERY_EMBEDDING_CACHE_MAX_ENTRIES = 256
_text_query_embedding_cache_lock = threading.Lock()
_text_query_embedding_cache: Dict[Tuple[str, str], dict] = {}
HYBRID_TEXT_PREFILTER_BASE = 800
HYBRID_TEXT_PREFILTER_MAX = 4000
HYBRID_TRIGRAM_THRESHOLD = 0.12
TEXT_INDEX_SEMANTIC_BLEND = 0.35
LEGACY_LEXICAL_SCORING_MAX_CANDIDATES = 250


def _log_images_search_event(
    *,
    db: Session,
    request: Request,
    tenant: Tenant,
    current_user: UserProfile,
    total: int,
    returned_count: int,
    limit: int,
    offset: int,
    text_query: str,
    keywords: Optional[str],
    category_filters: Optional[str],
    filename_query: Optional[str],
    dropbox_path_prefix: Optional[str],
    order_by_value: Optional[str],
    date_order: str,
    hybrid_vector_weight: float,
    hybrid_lexical_weight: float,
) -> None:
    keyword_values = [k.strip() for k in str(keywords or "").split(",") if k.strip()]
    mode = (
        "text"
        if text_query
        else ("category_filters" if bool(category_filters) else ("keywords" if keyword_values else "browse"))
    )
    if mode == "browse":
        return

    record_activity_event(
        db,
        event_type=EVENT_SEARCH_IMAGES,
        actor_supabase_uid=current_user.supabase_uid,
        tenant_id=tenant.id,
        request_path=str(request.url.path),
        client_ip=extract_client_ip(
            x_forwarded_for=request.headers.get("X-Forwarded-For"),
            x_real_ip=request.headers.get("X-Real-IP"),
        ),
        user_agent=request.headers.get("User-Agent"),
        details={
            "mode": mode,
            "text_query": text_query[:200] if text_query else None,
            "text_query_length": len(text_query or ""),
            "keywords": keyword_values[:25],
            "has_category_filters": bool(category_filters),
            "filename_query": str(filename_query or "")[:200] or None,
            "dropbox_path_prefix": str(dropbox_path_prefix or "")[:200] or None,
            "order_by": order_by_value or "photo_creation",
            "date_order": date_order,
            "hybrid_vector_weight": float(hybrid_vector_weight or 0.0) if text_query else None,
            "hybrid_lexical_weight": float(hybrid_lexical_weight or 0.0) if text_query else None,
            "limit": int(limit or 0),
            "offset": int(offset or 0),
            "result_total": int(total or 0),
            "result_count": int(returned_count or 0),
        },
    )


def _build_similarity_index(
    db: Session,
    tenant: Tenant,
    media_type: Optional[str],
    embedding_dim: int,
) -> dict:
    query = db.query(
        ImageMetadata.id.label("image_id"),
        ImageEmbedding.embedding.label("embedding"),
    ).join(
        ImageEmbedding,
        and_(
            ImageEmbedding.asset_id == ImageMetadata.asset_id,
            tenant_column_filter(ImageEmbedding, tenant),
            ImageEmbedding.embedding.is_not(None),
        ),
    ).filter(
        tenant_column_filter(ImageMetadata, tenant),
        ImageMetadata.asset_id.is_not(None),
    )

    if media_type:
        query = query.join(
            Asset,
            and_(
                Asset.id == ImageMetadata.asset_id,
                tenant_column_filter(Asset, tenant),
            ),
        ).filter(
            func.lower(func.coalesce(Asset.media_type, "image")) == media_type
        )

    rows = query.all()
    image_ids = []
    vectors = []
    for row in rows:
        embedding = row.embedding
        if not embedding:
            continue
        vec = np.asarray(embedding, dtype=np.float32)
        if vec.ndim != 1 or vec.size != embedding_dim:
            continue
        norm = float(np.linalg.norm(vec))
        if norm <= 1e-12:
            continue
        image_ids.append(int(row.image_id))
        vectors.append(vec / norm)

    if not vectors:
        matrix = np.empty((0, embedding_dim), dtype=np.float32)
        ids = np.empty((0,), dtype=np.int64)
    else:
        matrix = np.vstack(vectors)
        ids = np.asarray(image_ids, dtype=np.int64)

    return {
        "built_at": time.time(),
        "matrix": matrix,
        "image_ids": ids,
        "media_type": media_type or "",
        "embedding_dim": embedding_dim,
    }


def _get_similarity_index(
    db: Session,
    tenant: Tenant,
    media_type: Optional[str],
    embedding_dim: int,
) -> dict:
    key = (str(tenant.id), media_type or "", int(embedding_dim))
    now = time.time()
    with _similarity_cache_lock:
        cached = _similarity_index_cache.get(key)
        if cached and (now - float(cached.get("built_at", 0))) <= SIMILARITY_CACHE_TTL_SECONDS:
            return cached

    built = _build_similarity_index(
        db=db,
        tenant=tenant,
        media_type=media_type,
        embedding_dim=embedding_dim,
    )
    with _similarity_cache_lock:
        _similarity_index_cache[key] = built
        if len(_similarity_index_cache) > SIMILARITY_CACHE_MAX_ENTRIES:
            oldest_key = min(
                _similarity_index_cache.keys(),
                key=lambda cache_key: float(_similarity_index_cache[cache_key].get("built_at", 0.0)),
            )
            if oldest_key != key:
                _similarity_index_cache.pop(oldest_key, None)
    return built


def _peek_cached_similarity_index(
    tenant: Tenant,
    media_type: Optional[str],
    embedding_dim: int,
) -> Optional[dict]:
    key = (str(tenant.id), media_type or "", int(embedding_dim))
    now = time.time()
    with _similarity_cache_lock:
        cached = _similarity_index_cache.get(key)
        if cached and (now - float(cached.get("built_at", 0))) <= SIMILARITY_CACHE_TTL_SECONDS:
            return cached
    return None


def _pgvector_cache_key(db: Session) -> str:
    bind = db.get_bind()
    return str(bind.engine.url)


def _set_pgvector_capability(db: Session, can_use: bool) -> None:
    _pgvector_capability_cache[_pgvector_cache_key(db)] = bool(can_use)


def _is_pgvector_ready(db: Session) -> bool:
    bind = db.get_bind()
    if bind.dialect.name != "postgresql":
        return False

    cache_key = _pgvector_cache_key(db)
    cached = _pgvector_capability_cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        row = db.execute(
            text(
                """
                SELECT
                    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS has_extension,
                    EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'image_embeddings'
                          AND column_name = 'embedding_vec'
                    ) AS has_embedding_vec
                """
            )
        ).mappings().first()
        can_use = bool(row and row["has_extension"] and row["has_embedding_vec"])
        _pgvector_capability_cache[cache_key] = can_use
        return can_use
    except SQLAlchemyError:
        db.rollback()
        _pgvector_capability_cache[cache_key] = False
        return False


def _is_pg_trgm_ready(db: Session) -> bool:
    bind = db.get_bind()
    if bind.dialect.name != "postgresql":
        return False

    cache_key = _pgvector_cache_key(db)
    cached = _pg_trgm_capability_cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        row = db.execute(
            text(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM pg_extension
                    WHERE extname = 'pg_trgm'
                ) AS has_pg_trgm
                """
            )
        ).mappings().first()
        can_use = bool(row and row["has_pg_trgm"])
        _pg_trgm_capability_cache[cache_key] = can_use
        return can_use
    except SQLAlchemyError:
        db.rollback()
        _pg_trgm_capability_cache[cache_key] = False
        return False


def _to_pgvector_literal(values: np.ndarray) -> str:
    return "[" + ",".join(f"{float(value):.10g}" for value in values.tolist()) + "]"


def _normalize_hybrid_weights(
    vector_weight: Optional[float],
    lexical_weight: Optional[float],
) -> Tuple[float, float]:
    try:
        vector = float(vector_weight if vector_weight is not None else 0.0)
    except (TypeError, ValueError):
        vector = 0.0
    try:
        lexical = float(lexical_weight if lexical_weight is not None else 1.0)
    except (TypeError, ValueError):
        lexical = 1.0

    vector = max(0.0, vector)
    lexical = max(0.0, lexical)
    total = vector + lexical
    if total <= 1e-9:
        return 0.0, 1.0
    return vector / total, lexical / total


def _compute_hybrid_text_prefilter_limit(
    limit: int,
    offset: int,
) -> int:
    safe_limit = max(1, int(limit or 100))
    safe_offset = max(0, int(offset or 0))
    requested_upper_bound = safe_offset + safe_limit
    window = max(
        HYBRID_TEXT_PREFILTER_BASE,
        safe_limit * 8,
        requested_upper_bound * 2,
    )
    return min(HYBRID_TEXT_PREFILTER_MAX, int(window))


def _compute_hybrid_seed_limits(
    limit: int,
    offset: int,
    prefilter_limit: int,
) -> Tuple[int, int, int]:
    safe_limit = max(1, int(limit or 100))
    safe_offset = max(0, int(offset or 0))
    requested_upper_bound = safe_limit + safe_offset
    lexical_seed_limit = min(prefilter_limit, max(300, requested_upper_bound * 3))
    vector_seed_limit = min(prefilter_limit, max(250, requested_upper_bound * 3))
    fallback_seed_limit = min(prefilter_limit, max(120, requested_upper_bound * 2))
    return int(lexical_seed_limit), int(vector_seed_limit), int(fallback_seed_limit)


def _merge_seed_image_ids(
    seed_groups: List[List[int]],
    max_rows: int,
) -> List[int]:
    safe_limit = max(1, int(max_rows or 1))
    merged: List[int] = []
    seen = set()
    for group in seed_groups:
        for image_id in group:
            image_id_int = int(image_id)
            if image_id_int in seen:
                continue
            seen.add(image_id_int)
            merged.append(image_id_int)
            if len(merged) >= safe_limit:
                return merged
    return merged


def _fetch_text_index_seed_image_ids(
    db: Session,
    tenant: Tenant,
    normalized_query: str,
    query_tokens: List[str],
    max_rows: int,
) -> List[int]:
    if not normalized_query and not query_tokens:
        return []

    safe_limit = max(1, int(max_rows or HYBRID_TEXT_PREFILTER_BASE))
    text_value = func.lower(func.coalesce(AssetTextIndex.search_text, ""))
    asset_ids_ordered = []
    seen_asset_ids = set()

    def _append_asset_ids(rows) -> None:
        for row in rows or []:
            asset_id = getattr(row, "asset_id", None)
            if asset_id is None or asset_id in seen_asset_ids:
                continue
            seen_asset_ids.add(asset_id)
            asset_ids_ordered.append(asset_id)
            if len(asset_ids_ordered) >= safe_limit:
                return

    dialect_name = getattr(getattr(db, "bind", None), "dialect", None)
    dialect_name = getattr(dialect_name, "name", "")
    rows = []
    if dialect_name == "postgresql" and normalized_query:
        try:
            tsvector = func.to_tsvector("english", func.coalesce(AssetTextIndex.search_text, ""))
            tsquery = func.websearch_to_tsquery("english", normalized_query)
            full_match_expr = tsvector.op("@@")(tsquery)
            token_terms = [token for token in query_tokens[:8] if token]
            token_match_exprs = []
            for token in token_terms:
                token_tsquery = func.plainto_tsquery("english", token)
                token_match_expr = tsvector.op("@@")(token_tsquery)
                token_match_exprs.append(token_match_expr)
            any_token_match_expr = or_(*token_match_exprs) if token_match_exprs else full_match_expr
            rows = (
                db.query(AssetTextIndex.asset_id.label("asset_id"))
                .filter(
                    tenant_column_filter(AssetTextIndex, tenant),
                    AssetTextIndex.asset_id.is_not(None),
                    or_(
                        full_match_expr,
                        any_token_match_expr,
                    ),
                )
                .limit(safe_limit)
                .all()
            )
            _append_asset_ids(rows)
        except SQLAlchemyError as exc:
            db.rollback()
            logger.debug("FTS seed query fallback to basic lexical matching: %s", exc)

    if (
        normalized_query
        and len(asset_ids_ordered) < safe_limit
        and dialect_name == "postgresql"
        and _is_pg_trgm_ready(db)
    ):
        try:
            remaining = max(1, safe_limit - len(asset_ids_ordered))
            trigram_query = (
                db.query(AssetTextIndex.asset_id.label("asset_id"))
                .filter(
                    tenant_column_filter(AssetTextIndex, tenant),
                    AssetTextIndex.asset_id.is_not(None),
                    func.similarity(text_value, normalized_query) >= HYBRID_TRIGRAM_THRESHOLD,
                )
                .limit(remaining)
            )
            if seen_asset_ids:
                trigram_query = trigram_query.filter(~AssetTextIndex.asset_id.in_(list(seen_asset_ids)))
            trigram_rows = trigram_query.all()
            _append_asset_ids(trigram_rows)
        except SQLAlchemyError as exc:
            db.rollback()
            logger.debug("Trigram seed query fallback to basic lexical matching: %s", exc)

    if not asset_ids_ordered:
        clauses = []
        if normalized_query:
            clauses.append(text_value.contains(normalized_query))
        for token in query_tokens:
            if token:
                clauses.append(text_value.contains(token))
        if not clauses:
            return []
        rows = (
            db.query(AssetTextIndex.asset_id.label("asset_id"))
            .filter(
                tenant_column_filter(AssetTextIndex, tenant),
                AssetTextIndex.asset_id.is_not(None),
                or_(*clauses),
            )
            .limit(safe_limit)
            .all()
        )
        _append_asset_ids(rows)

    if not asset_ids_ordered:
        return []

    image_rows = (
        db.query(
            ImageMetadata.id.label("image_id"),
            ImageMetadata.asset_id.label("asset_id"),
        )
        .filter(
            tenant_column_filter(ImageMetadata, tenant),
            ImageMetadata.asset_id.in_(asset_ids_ordered),
        )
        .all()
    )

    image_id_by_asset = {}
    for row in image_rows:
        if row.asset_id is not None and row.asset_id not in image_id_by_asset:
            image_id_by_asset[row.asset_id] = int(row.image_id)

    ordered_ids: List[int] = []
    seen_image_ids = set()
    for asset_id in asset_ids_ordered:
        image_id = image_id_by_asset.get(asset_id)
        if image_id is None or image_id in seen_image_ids:
            continue
        seen_image_ids.add(image_id)
        ordered_ids.append(image_id)
        if len(ordered_ids) >= safe_limit:
            break
    return ordered_ids


def _is_asset_text_index_pgvector_ready(db: Session) -> bool:
    bind = db.get_bind()
    if bind.dialect.name != "postgresql":
        return False

    cache_key = _pgvector_cache_key(db)
    cached = _asset_text_index_pgvector_capability_cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        row = db.execute(
            text(
                """
                SELECT
                    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS has_extension,
                    EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'asset_text_index'
                          AND column_name = 'search_embedding_vec'
                    ) AS has_embedding_vec
                """
            )
        ).mappings().first()
        can_use = bool(row and row["has_extension"] and row["has_embedding_vec"])
        _asset_text_index_pgvector_capability_cache[cache_key] = can_use
        return can_use
    except SQLAlchemyError:
        db.rollback()
        _asset_text_index_pgvector_capability_cache[cache_key] = False
        return False


def _fetch_text_index_vector_seed_image_ids(
    db: Session,
    tenant: Tenant,
    query_vector: Optional[np.ndarray],
    max_rows: int,
) -> List[int]:
    if query_vector is None or int(getattr(query_vector, "size", 0) or 0) <= 0:
        return []
    if not _is_asset_text_index_pgvector_ready(db):
        return []

    query_vec_literal = _to_pgvector_literal(query_vector)
    candidate_limit = max(1, int(max_rows or 1))
    try:
        rows = db.execute(
            text(
                """
                SELECT
                    im.id AS image_id
                FROM asset_text_index ati
                JOIN image_metadata im
                  ON im.asset_id = ati.asset_id
                 AND im.tenant_id = :tenant_id
                WHERE ati.tenant_id = :tenant_id
                  AND ati.search_embedding_vec IS NOT NULL
                ORDER BY ati.search_embedding_vec <=> CAST(:query_vec AS vector)
                LIMIT :candidate_limit
                """
            ),
            {
                "tenant_id": tenant.id,
                "query_vec": query_vec_literal,
                "candidate_limit": int(candidate_limit),
            },
        ).mappings().all()
    except SQLAlchemyError as exc:
        db.rollback()
        _asset_text_index_pgvector_capability_cache[_pgvector_cache_key(db)] = False
        logger.debug("Asset text index vector seed unavailable; disabling pgvector seed path: %s", exc)
        return []

    ordered_ids: List[int] = []
    seen = set()
    for row in rows:
        image_id = int(row["image_id"])
        if image_id in seen:
            continue
        seen.add(image_id)
        ordered_ids.append(image_id)
    return ordered_ids


def _tokenize_text_query(text_query: str) -> Tuple[str, List[str]]:
    normalized = " ".join(str(text_query or "").strip().lower().split())
    if not normalized:
        return "", []
    raw_tokens = re.findall(r"[a-z0-9][a-z0-9_-]{1,}", normalized)
    tokens: List[str] = []
    seen = set()
    for token in raw_tokens:
        if token in seen:
            continue
        seen.add(token)
        tokens.append(token)
    return normalized, tokens


def _get_text_query_embedding(
    text_query: str,
) -> np.ndarray:
    normalized_query, _ = _tokenize_text_query(text_query)
    if not normalized_query:
        raise ValueError("text_query is empty")

    model_name = str(getattr(settings, "tagging_model", "siglip") or "siglip")
    cache_key = (model_name, normalized_query)
    now = time.time()
    with _text_query_embedding_cache_lock:
        cached = _text_query_embedding_cache.get(cache_key)
        if cached and (now - float(cached.get("built_at", 0.0))) <= TEXT_QUERY_EMBEDDING_CACHE_TTL_SECONDS:
            return np.asarray(cached["vector"], dtype=np.float32)

    tagger = get_tagger(model_type=model_name)
    if not hasattr(tagger, "build_text_embeddings"):
        raise RuntimeError(f"Tagger {model_name} does not support text embeddings")

    _, text_embeddings = tagger.build_text_embeddings([
        {"keyword": normalized_query, "prompt": normalized_query},
    ])
    if text_embeddings is None:
        raise RuntimeError("Text embedding generation returned no tensor")

    first_embedding = text_embeddings[0]
    if hasattr(first_embedding, "detach"):
        first_embedding = first_embedding.detach().cpu().numpy()
    vector = np.asarray(first_embedding, dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(vector))
    if norm <= 1e-12:
        raise RuntimeError("Text embedding has zero magnitude")
    vector = vector / norm

    with _text_query_embedding_cache_lock:
        _text_query_embedding_cache[cache_key] = {
            "built_at": now,
            "vector": vector,
        }
        if len(_text_query_embedding_cache) > TEXT_QUERY_EMBEDDING_CACHE_MAX_ENTRIES:
            oldest_key = min(
                _text_query_embedding_cache.keys(),
                key=lambda key: float(_text_query_embedding_cache[key].get("built_at", 0.0)),
            )
            if oldest_key != cache_key:
                _text_query_embedding_cache.pop(oldest_key, None)

    return vector


def _string_match_score(
    text_value: str,
    normalized_query: str,
    query_tokens: List[str],
    phrase_weight: float,
    token_weight: float,
    token_cap: float,
) -> float:
    text_normalized = str(text_value or "").strip().lower()
    if not text_normalized:
        return 0.0

    score = phrase_weight if normalized_query and normalized_query in text_normalized else 0.0
    token_score = 0.0
    for token in query_tokens:
        if token in text_normalized:
            token_score += token_weight
    score += min(token_cap, token_score)
    return score


def _compute_lexical_scores_for_candidates(
    db: Session,
    tenant: Tenant,
    candidate_rows: List,
    normalized_query: str,
    query_tokens: List[str],
) -> Dict[int, float]:
    if not candidate_rows or (not normalized_query and not query_tokens):
        return {}

    asset_to_image_id = {}
    filename_by_image_id = {}
    for row in candidate_rows:
        image_id = int(row.image_id)
        filename_by_image_id[image_id] = str(row.filename or "")
        if row.asset_id is not None:
            asset_to_image_id[row.asset_id] = image_id

    if not asset_to_image_id and not filename_by_image_id:
        return {}

    raw_score_by_image_id: Dict[int, float] = {}

    asset_ids = list(asset_to_image_id.keys())
    if asset_ids:
        positive_rows = db.query(
            Permatag.asset_id.label("asset_id"),
            Keyword.keyword.label("keyword"),
        ).join(
            Keyword,
            and_(
                Keyword.id == Permatag.keyword_id,
                tenant_column_filter(Keyword, tenant),
            ),
        ).filter(
            tenant_column_filter(Permatag, tenant),
            Permatag.asset_id.in_(asset_ids),
            Permatag.signum == 1,
        ).all()

        for row in positive_rows:
            image_id = asset_to_image_id.get(row.asset_id)
            if image_id is None:
                continue
            delta = _string_match_score(
                row.keyword,
                normalized_query=normalized_query,
                query_tokens=query_tokens,
                phrase_weight=0.9,
                token_weight=0.2,
                token_cap=0.8,
            )
            if delta > 0:
                raw_score_by_image_id[image_id] = raw_score_by_image_id.get(image_id, 0.0) + delta

        negative_rows = db.query(
            Permatag.asset_id.label("asset_id"),
            Keyword.keyword.label("keyword"),
        ).join(
            Keyword,
            and_(
                Keyword.id == Permatag.keyword_id,
                tenant_column_filter(Keyword, tenant),
            ),
        ).filter(
            tenant_column_filter(Permatag, tenant),
            Permatag.asset_id.in_(asset_ids),
            Permatag.signum == -1,
        ).all()

        for row in negative_rows:
            image_id = asset_to_image_id.get(row.asset_id)
            if image_id is None:
                continue
            penalty = _string_match_score(
                row.keyword,
                normalized_query=normalized_query,
                query_tokens=query_tokens,
                phrase_weight=0.7,
                token_weight=0.15,
                token_cap=0.6,
            )
            if penalty > 0:
                raw_score_by_image_id[image_id] = raw_score_by_image_id.get(image_id, 0.0) - penalty

    for image_id, filename in filename_by_image_id.items():
        filename_bonus = _string_match_score(
            filename,
            normalized_query=normalized_query,
            query_tokens=query_tokens,
            phrase_weight=0.4,
            token_weight=0.08,
            token_cap=0.4,
        )
        if filename_bonus > 0:
            raw_score_by_image_id[image_id] = raw_score_by_image_id.get(image_id, 0.0) + filename_bonus

    positive_values = [value for value in raw_score_by_image_id.values() if value > 0]
    if not positive_values:
        return {}
    max_value = max(positive_values)
    if max_value <= 1e-9:
        return {}
    return {
        image_id: min(1.0, max(0.0, value / max_value))
        for image_id, value in raw_score_by_image_id.items()
        if value > 0
    }


def _compute_text_index_scores_for_candidates(
    db: Session,
    tenant: Tenant,
    candidate_rows: List,
    normalized_query: str,
    query_tokens: List[str],
    query_vector: Optional[np.ndarray],
) -> Tuple[Dict[int, float], Dict[int, float]]:
    if not candidate_rows:
        return {}, {}

    asset_to_image_id = {}
    for row in candidate_rows:
        if row.asset_id is None:
            continue
        asset_to_image_id[row.asset_id] = int(row.image_id)
    if not asset_to_image_id:
        return {}, {}

    text_value = func.lower(func.coalesce(AssetTextIndex.search_text, ""))
    query_columns = [
        AssetTextIndex.asset_id,
        AssetTextIndex.search_text,
    ]
    if normalized_query and db.get_bind().dialect.name == "postgresql":
        tsvector = func.to_tsvector("english", func.coalesce(AssetTextIndex.search_text, ""))
        tsquery = func.websearch_to_tsquery("english", normalized_query)
        query_columns.append(func.ts_rank_cd(tsvector, tsquery).label("fts_rank"))
        token_terms = [token for token in query_tokens[:8] if token]
        if token_terms:
            token_match_count_expr = literal(0)
            token_rank_sum_expr = literal(0.0)
            for token in token_terms:
                token_tsquery = func.plainto_tsquery("english", token)
                token_match_expr = tsvector.op("@@")(token_tsquery)
                token_match_count_expr = token_match_count_expr + case((token_match_expr, 1), else_=0)
                token_rank_sum_expr = token_rank_sum_expr + func.ts_rank_cd(tsvector, token_tsquery)
            query_columns.append(token_match_count_expr.label("fts_token_match_count"))
            query_columns.append(token_rank_sum_expr.label("fts_token_rank_sum"))
        if _is_pg_trgm_ready(db):
            query_columns.append(func.similarity(text_value, normalized_query).label("trigram_score"))
    if query_vector is not None and int(getattr(query_vector, "size", 0) or 0) > 0:
        query_columns.append(AssetTextIndex.search_embedding)

    try:
        rows = (
            db.query(*query_columns)
            .filter(
                tenant_column_filter(AssetTextIndex, tenant),
                AssetTextIndex.asset_id.in_(list(asset_to_image_id.keys())),
            )
            .all()
        )
    except SQLAlchemyError as exc:
        logger.debug("Asset text index unavailable for hybrid search scoring: %s", exc)
        return {}, {}

    lexical_raw: Dict[int, float] = {}
    semantic_scores: Dict[int, float] = {}
    has_query_terms = bool(normalized_query or query_tokens)
    can_score_semantic = query_vector is not None and int(getattr(query_vector, "size", 0) or 0) > 0

    for row in rows:
        image_id = asset_to_image_id.get(row.asset_id)
        if image_id is None:
            continue

        if has_query_terms:
            fts_rank = float(getattr(row, "fts_rank", 0.0) or 0.0)
            token_match_count = float(getattr(row, "fts_token_match_count", 0.0) or 0.0)
            token_rank_sum = float(getattr(row, "fts_token_rank_sum", 0.0) or 0.0)
            trigram_score = float(getattr(row, "trigram_score", 0.0) or 0.0)
            trigram_effective = trigram_score if trigram_score >= HYBRID_TRIGRAM_THRESHOLD else 0.0
            token_coverage = 0.0
            if query_tokens:
                token_coverage = min(1.0, token_match_count / float(max(1, len(query_tokens[:8]))))
            if fts_rank > 0 or token_rank_sum > 0 or trigram_effective > 0:
                score = (
                    max(0.0, fts_rank)
                    + (0.65 * max(0.0, token_rank_sum))
                    + (0.2 * token_coverage)
                    + (0.35 * trigram_effective)
                )
            else:
                score = _string_match_score(
                    str(row.search_text or ""),
                    normalized_query=normalized_query,
                    query_tokens=query_tokens,
                    phrase_weight=1.0,
                    token_weight=0.2,
                    token_cap=0.8,
                )
            if score > 0:
                lexical_raw[image_id] = max(float(lexical_raw.get(image_id, 0.0)), float(score))

        row_search_embedding = getattr(row, "search_embedding", None)
        if can_score_semantic and row_search_embedding:
            vec = np.asarray(row_search_embedding, dtype=np.float32).reshape(-1)
            if vec.ndim != 1 or vec.size != int(query_vector.size):
                continue
            norm = float(np.linalg.norm(vec))
            if norm <= 1e-12:
                continue
            similarity = float(np.dot(vec / norm, query_vector))
            semantic_scores[image_id] = max(
                float(semantic_scores.get(image_id, 0.0)),
                float(np.clip((similarity + 1.0) / 2.0, 0.0, 1.0)),
            )

    if not lexical_raw:
        return {}, semantic_scores

    max_lexical = max(lexical_raw.values())
    if max_lexical <= 1e-9:
        return {}, semantic_scores

    lexical_scores = {
        image_id: min(1.0, max(0.0, value / max_lexical))
        for image_id, value in lexical_raw.items()
        if value > 0
    }
    return lexical_scores, semantic_scores


def _rank_candidates_with_hybrid_scores(
    db: Session,
    tenant: Tenant,
    candidate_rows: List,
    text_query: str,
    order_by_value: Optional[str],
    date_order: str,
    vector_weight: float,
    lexical_weight: float,
    query_vector: Optional[np.ndarray] = None,
) -> Tuple[List[int], Dict[int, float], Dict[int, float], Dict[int, float]]:
    if not candidate_rows:
        return [], {}, {}, {}

    normalized_query, query_tokens = _tokenize_text_query(text_query)
    semantic_scores: Dict[int, float] = {}
    lexical_scores: Dict[int, float] = {}
    text_index_semantic_scores: Dict[int, float] = {}
    if vector_weight > 1e-6:
        try:
            if query_vector is None:
                query_vector = _get_text_query_embedding(normalized_query)
            index = _get_similarity_index(
                db=db,
                tenant=tenant,
                media_type=None,
                embedding_dim=int(query_vector.size),
            )
            matrix = index.get("matrix")
            indexed_ids = index.get("image_ids")
            if matrix is not None and indexed_ids is not None and matrix.size and indexed_ids.size:
                similarities = np.dot(matrix, query_vector)
                similarities = np.clip((similarities + 1.0) / 2.0, 0.0, 1.0)
                candidate_id_set = {int(row.image_id) for row in candidate_rows}
                for image_id, similarity in zip(indexed_ids.tolist(), similarities.tolist()):
                    image_id_int = int(image_id)
                    if image_id_int in candidate_id_set:
                        semantic_scores[image_id_int] = float(similarity)
        except Exception as exc:  # noqa: BLE001 - keep search functional even if embedding model fails.
            logger.warning("Hybrid search semantic scoring unavailable; falling back to lexical/date ranking: %s", exc)

    text_index_lexical_scores, text_index_semantic_scores = _compute_text_index_scores_for_candidates(
        db=db,
        tenant=tenant,
        candidate_rows=candidate_rows,
        normalized_query=normalized_query,
        query_tokens=query_tokens,
        query_vector=query_vector if vector_weight > 1e-6 else None,
    )
    if text_index_lexical_scores:
        lexical_scores = {
            int(image_id): float(min(1.0, max(0.0, score)))
            for image_id, score in text_index_lexical_scores.items()
        }
    elif len(candidate_rows) <= LEGACY_LEXICAL_SCORING_MAX_CANDIDATES:
        lexical_scores = _compute_lexical_scores_for_candidates(
            db=db,
            tenant=tenant,
            candidate_rows=candidate_rows,
            normalized_query=normalized_query,
            query_tokens=query_tokens,
        )

    hybrid_scores: Dict[int, float] = {}

    def _date_sort_key(row) -> float:
        if order_by_value == "processed":
            date_value = row.last_processed or row.created_at
        elif order_by_value == "created_at":
            date_value = row.created_at
        else:
            date_value = row.capture_timestamp or row.modified_time
        if not date_value:
            return float("inf")
        timestamp = date_value.timestamp()
        return -timestamp if date_order == "desc" else timestamp

    def _rating_sort_key(row) -> Tuple[int, float]:
        if row.rating is None:
            return (1, 0.0)
        value = float(row.rating)
        return (0, -value if date_order == "desc" else value)

    def _id_sort_key(image_id: int) -> int:
        return -image_id if date_order == "desc" else image_id

    ranked_rows = []
    for row in candidate_rows:
        image_id = int(row.image_id)
        image_semantic = float(semantic_scores.get(image_id, 0.0))
        text_semantic = float(text_index_semantic_scores.get(image_id, 0.0))
        if text_semantic > 0 and image_semantic > 0:
            semantic = (
                ((1.0 - TEXT_INDEX_SEMANTIC_BLEND) * image_semantic)
                + (TEXT_INDEX_SEMANTIC_BLEND * text_semantic)
            )
        elif text_semantic > 0:
            semantic = text_semantic
        else:
            semantic = image_semantic
        lexical = float(lexical_scores.get(image_id, 0.0))
        hybrid = (vector_weight * semantic) + (lexical_weight * lexical)
        hybrid_scores[image_id] = hybrid
        ranked_rows.append((row, hybrid, semantic, lexical))

    if order_by_value == "image_id":
        ranked_rows.sort(
            key=lambda payload: (
                -payload[1],
                -payload[2],
                -payload[3],
                _id_sort_key(int(payload[0].image_id)),
            )
        )
    elif order_by_value == "rating":
        ranked_rows.sort(
            key=lambda payload: (
                -payload[1],
                -payload[2],
                -payload[3],
                _rating_sort_key(payload[0]),
                _id_sort_key(int(payload[0].image_id)),
                _date_sort_key(payload[0]),
            )
        )
    else:
        ranked_rows.sort(
            key=lambda payload: (
                -payload[1],
                -payload[2],
                -payload[3],
                _id_sort_key(int(payload[0].image_id)),
                _date_sort_key(payload[0]),
            )
        )

    ordered_ids = [int(payload[0].image_id) for payload in ranked_rows]
    return ordered_ids, hybrid_scores, semantic_scores, lexical_scores


def _fetch_similar_ids_with_pgvector(
    db: Session,
    tenant: Tenant,
    source_image_id: int,
    source_asset_id,
    source_vector: np.ndarray,
    limit: int,
    min_score: Optional[float],
    media_type: Optional[str],
    candidate_scan_cap: Optional[int] = None,
) -> Optional[Tuple[List[int], Dict[int, float]]]:
    if not _is_pgvector_ready(db):
        return None

    query_vector = _to_pgvector_literal(source_vector)
    media_filter = media_type.lower() if media_type else None
    params = {
        "tenant_id": tenant.id,
        "source_image_id": int(source_image_id),
        "source_asset_id": source_asset_id,
        "query_vec": query_vector,
        "min_score": float(min_score) if min_score is not None else None,
    }

    try:
        # Phase 1: true KNN candidate fetch (index-friendly ORDER BY <=> on image_embeddings only).
        initial_candidate_limit = min(max(int(limit) * 4, 120), 800)
        max_candidate_limit = min(max(int(limit) * 20, 3000), 12000)
        if candidate_scan_cap is not None:
            safe_scan_cap = max(int(limit), max(50, int(candidate_scan_cap)))
            max_candidate_limit = min(max_candidate_limit, safe_scan_cap)
            initial_candidate_limit = min(initial_candidate_limit, max_candidate_limit)
        candidate_limit = initial_candidate_limit
        top_image_ids: List[int] = []
        score_by_image_id: Dict[int, float] = {}

        while True:
            candidate_rows = db.execute(
                text(
                    """
                    SELECT
                        ie.asset_id,
                        1 - (ie.embedding_vec <=> CAST(:query_vec AS vector)) AS similarity_score
                    FROM image_embeddings ie
                    WHERE ie.asset_id IS NOT NULL
                      AND ie.asset_id <> :source_asset_id
                      AND ie.embedding_vec IS NOT NULL
                    ORDER BY ie.embedding_vec <=> CAST(:query_vec AS vector)
                    LIMIT :candidate_limit
                    """
                ),
                {**params, "candidate_limit": int(candidate_limit)},
            ).mappings().all()

            if not candidate_rows:
                break

            candidate_asset_ids = [row["asset_id"] for row in candidate_rows if row.get("asset_id") is not None]
            if not candidate_asset_ids:
                break

            # Phase 2: hydrate image ids/media types for candidates and apply tenant/media/min-score filters.
            image_rows = db.query(
                ImageMetadata.id.label("image_id"),
                ImageMetadata.asset_id.label("asset_id"),
                func.lower(func.coalesce(Asset.media_type, "image")).label("media_type"),
            ).outerjoin(
                Asset,
                and_(
                    Asset.id == ImageMetadata.asset_id,
                    tenant_column_filter(Asset, tenant),
                ),
            ).filter(
                tenant_column_filter(ImageMetadata, tenant),
                ImageMetadata.asset_id.in_(candidate_asset_ids),
            ).all()

            image_by_asset = {
                row.asset_id: (int(row.image_id), str(row.media_type or "image").lower())
                for row in image_rows
                if row.asset_id is not None
            }

            for row in candidate_rows:
                asset_id = row.get("asset_id")
                if asset_id is None:
                    continue
                image_info = image_by_asset.get(asset_id)
                if not image_info:
                    continue
                image_id, candidate_media_type = image_info
                if image_id == int(source_image_id):
                    continue
                if media_filter and candidate_media_type != media_filter:
                    continue
                score = float(row.get("similarity_score") or 0.0)
                if min_score is not None and score < float(min_score):
                    continue
                if image_id in score_by_image_id:
                    continue
                top_image_ids.append(image_id)
                score_by_image_id[image_id] = round(score, 4)
                if len(top_image_ids) >= int(limit):
                    break

            if len(top_image_ids) >= int(limit):
                break
            if len(candidate_rows) < int(candidate_limit):
                break
            if candidate_limit >= max_candidate_limit:
                break

            candidate_limit = min(candidate_limit * 2, max_candidate_limit)
    except SQLAlchemyError as exc:
        db.rollback()
        _set_pgvector_capability(db, False)
        logger.warning("pgvector similarity query failed; falling back to in-memory index: %s", exc)
        return None

    return top_image_ids, score_by_image_id


@router.get("/images", response_model=dict, operation_id="list_images")
async def list_images(
    request: Request,
    tenant: Tenant = Depends(get_tenant),
    current_user: UserProfile = Depends(get_current_user),
    limit: int = 100,
    offset: int = 0,
    anchor_id: Optional[int] = None,
    keywords: Optional[str] = None,  # Comma-separated keywords (deprecated)
    operator: str = "OR",  # "AND" or "OR" (deprecated)
    category_filters: Optional[str] = None,  # JSON string with per-category filters
    list_id: Optional[int] = None,
    list_exclude_id: Optional[int] = None,
    rating: Optional[int] = None,
    rating_operator: str = "eq",
    hide_zero_rating: bool = False,
    reviewed: Optional[bool] = None,
    media_type: Optional[str] = None,
    dropbox_path_prefix: Optional[str] = None,
    filename_query: Optional[str] = None,
    text_query: Optional[str] = None,
    hybrid_vector_weight: float = 0.0,
    hybrid_lexical_weight: float = 1.0,
    permatag_keyword: Optional[str] = None,
    permatag_category: Optional[str] = None,
    permatag_signum: Optional[int] = None,
    permatag_missing: bool = False,
    permatag_positive_missing: bool = False,
    category_filter_source: Optional[str] = None,
    category_filter_operator: Optional[str] = None,
    date_order: str = "desc",
    order_by: Optional[str] = None,
    ml_keyword: Optional[str] = None,
    ml_tag_type: Optional[str] = None,
    ml_similarity_seed_count: Optional[int] = None,
    ml_similarity_similar_count: Optional[int] = None,
    ml_similarity_dedupe: bool = True,
    ml_similarity_random: bool = True,
    db: Session = Depends(get_db)
):
    """List images for tenant with optional faceted search by keywords."""
    from ..filtering import (
        apply_category_filters,
        calculate_relevance_scores,
        build_image_query_with_subqueries
    )

    ml_keyword_id = None
    if ml_keyword:
        normalized_keyword = ml_keyword.strip().lower()
        if normalized_keyword:
            keyword_row = db.query(Keyword.id).filter(
                func.lower(Keyword.keyword) == normalized_keyword,
                tenant_column_filter(Keyword, tenant)
            ).first()
            if keyword_row:
                ml_keyword_id = keyword_row[0]

    date_order = (date_order or "desc").lower()
    if date_order not in ("asc", "desc"):
        date_order = "desc"
    order_by_value = (order_by or "").lower()
    if order_by_value not in ("photo_creation", "created_at", "image_id", "processed", "ml_score", "rating"):
        order_by_value = None
    if order_by_value == "ml_score" and not ml_keyword_id:
        order_by_value = None
    similarity_seed_limit_value = int(ml_similarity_seed_count) if ml_similarity_seed_count is not None else 5
    similarity_seed_limit_value = max(1, min(similarity_seed_limit_value, 50))
    similarity_per_seed_limit_value = int(ml_similarity_similar_count) if ml_similarity_similar_count is not None else 10
    similarity_per_seed_limit_value = max(1, min(similarity_per_seed_limit_value, 50))
    similarity_dedupe_enabled = bool(ml_similarity_dedupe)
    similarity_random_enabled = bool(ml_similarity_random)
    constrain_to_ml_matches = order_by_value == "ml_score" and ml_keyword_id is not None
    media_type_value = (media_type or "all").strip().lower()
    if media_type_value not in {"all", "image", "video"}:
        media_type_value = "all"
    text_query_value = str(text_query or "").strip()
    normalized_text_query, text_query_tokens = _tokenize_text_query(text_query_value)
    vector_weight_value, lexical_weight_value = _normalize_hybrid_weights(
        hybrid_vector_weight,
        hybrid_lexical_weight,
    )
    lexical_only_mode = lexical_weight_value >= 0.999 and vector_weight_value <= 0.001
    text_query_vector: Optional[np.ndarray] = None
    if text_query_value and vector_weight_value > 1e-6:
        try:
            text_query_vector = _get_text_query_embedding(normalized_text_query)
        except Exception as exc:  # noqa: BLE001 - keep query flow resilient.
            logger.warning("Text query embedding unavailable during candidate seeding; continuing lexical-only: %s", exc)
            text_query_vector = None
    is_tenant_admin = is_tenant_admin_user(db, tenant, current_user)
    base_query, subqueries_list, exclude_subqueries_list, has_empty_filter = build_image_query_with_subqueries(
        db,
        tenant,
        current_user=current_user,
        is_tenant_admin=is_tenant_admin,
        list_id=list_id,
        list_exclude_id=list_exclude_id,
        rating=rating,
        rating_operator=rating_operator,
        hide_zero_rating=hide_zero_rating,
        reviewed=reviewed,
        media_type=None if media_type_value == "all" else media_type_value,
        dropbox_path_prefix=dropbox_path_prefix,
        filename_query=filename_query,
        permatag_keyword=permatag_keyword,
        permatag_category=permatag_category,
        permatag_signum=permatag_signum,
        permatag_missing=permatag_missing,
        permatag_positive_missing=permatag_positive_missing,
        ml_keyword=ml_keyword,
        ml_tag_type=ml_tag_type,
        apply_ml_tag_filter=not constrain_to_ml_matches,
    )
    # If any filter resulted in empty set, return empty response
    if has_empty_filter:
        result = {
            "tenant_id": tenant.id,
            "images": [],
            "total": 0,
            "limit": limit,
            "offset": offset
        }
        _log_images_search_event(
            db=db,
            request=request,
            tenant=tenant,
            current_user=current_user,
            total=0,
            returned_count=0,
            limit=limit,
            offset=offset,
            text_query=text_query_value,
            keywords=keywords,
            category_filters=category_filters,
            filename_query=filename_query,
            dropbox_path_prefix=dropbox_path_prefix,
            order_by_value=order_by_value,
            date_order=date_order,
            hybrid_vector_weight=vector_weight_value,
            hybrid_lexical_weight=lexical_weight_value,
        )
        return result

    def resolve_anchor_offset(query, current_offset):
        if anchor_id is None or limit is None:
            return current_offset
        order_by_clauses = getattr(query, "_order_by_clauses", None)
        if not order_by_clauses:
            return current_offset
        subquery = query.with_entities(
            ImageMetadata.id.label("image_id"),
            func.row_number().over(order_by=order_by_clauses).label("rn")
        ).subquery()
        rn = db.query(subquery.c.rn).filter(subquery.c.image_id == anchor_id).scalar()
        if rn is None:
            return current_offset
        return max(int(rn) - 1, 0)

    def resolve_anchor_offset_for_sorted_ids(sorted_ids: List[int], current_offset: int) -> int:
        if anchor_id is None:
            return current_offset
        try:
            return sorted_ids.index(anchor_id)
        except ValueError:
            return current_offset

    def build_candidate_rows_from_query(query, max_rows: Optional[int] = None):
        candidate_query = query.with_entities(
            ImageMetadata.id.label("image_id"),
            ImageMetadata.asset_id.label("asset_id"),
            ImageMetadata.filename.label("filename"),
            ImageMetadata.capture_timestamp.label("capture_timestamp"),
            ImageMetadata.modified_time.label("modified_time"),
            ImageMetadata.last_processed.label("last_processed"),
            ImageMetadata.created_at.label("created_at"),
            ImageMetadata.rating.label("rating"),
        )
        if max_rows and int(max_rows) > 0:
            candidate_query = candidate_query.limit(int(max_rows))
        return candidate_query.all()

    def build_candidate_rows_from_ids(image_ids: List[int], max_rows: Optional[int] = None):
        if not image_ids:
            return []
        candidate_query = db.query(
            ImageMetadata.id.label("image_id"),
            ImageMetadata.asset_id.label("asset_id"),
            ImageMetadata.filename.label("filename"),
            ImageMetadata.capture_timestamp.label("capture_timestamp"),
            ImageMetadata.modified_time.label("modified_time"),
            ImageMetadata.last_processed.label("last_processed"),
            ImageMetadata.created_at.label("created_at"),
            ImageMetadata.rating.label("rating"),
        ).filter(
            tenant_column_filter(ImageMetadata, tenant),
            ImageMetadata.id.in_(image_ids)
        ).order_by(*order_by_clauses)
        if max_rows and int(max_rows) > 0:
            candidate_query = candidate_query.limit(int(max_rows))
        return candidate_query.all()

    def load_images_by_ordered_ids(ordered_ids: List[int]):
        if not ordered_ids:
            return []
        image_rows = db.query(ImageMetadata).filter(
            tenant_column_filter(ImageMetadata, tenant),
            ImageMetadata.id.in_(ordered_ids)
        ).options(
            load_only(*LIST_IMAGES_LOAD_ONLY_COLUMNS)
        ).all()
        image_map = {img.id: img for img in image_rows}
        return [image_map[image_id] for image_id in ordered_ids if image_id in image_map]

    def _normalize_similarity_score(raw_score: Optional[float]) -> float:
        value = float(raw_score or 0.0)
        return float(np.clip((value + 1.0) / 2.0, 0.0, 1.0))

    total = 0
    image_entry_metadata: Optional[List[dict]] = None
    similarity_groups: Optional[List[dict]] = None

    # Handle per-category filters if provided
    if order_by_value == "processed":
        order_by_date = func.coalesce(ImageMetadata.last_processed, ImageMetadata.created_at)
    elif order_by_value == "created_at":
        order_by_date = ImageMetadata.created_at
    else:
        order_by_date = func.coalesce(ImageMetadata.capture_timestamp, ImageMetadata.modified_time)
    order_by_date = order_by_date.desc() if date_order == "desc" else order_by_date.asc()
    id_order = ImageMetadata.id.desc() if date_order == "desc" else ImageMetadata.id.asc()
    if order_by_value == "image_id":
        order_by_clauses = (id_order,)
    elif order_by_value == "rating":
        rating_order = ImageMetadata.rating.desc() if date_order == "desc" else ImageMetadata.rating.asc()
        rating_order = rating_order.nullslast()
        order_by_clauses = (rating_order, order_by_date, id_order)
    else:
        order_by_clauses = (order_by_date, id_order)

    if category_filters:
        try:
            from .query_builder import QueryBuilder

            filters = json.loads(category_filters)
            builder = QueryBuilder(db, tenant, date_order, order_by_value)

            # Apply category filters using helper
            unique_image_ids_set = apply_category_filters(
                db,
                tenant,
                category_filters,
                None,  # category_filters handles its own filtering now
                source=category_filter_source or "current",
                combine_operator=category_filter_operator or "AND"
            )

            if unique_image_ids_set:
                unique_image_ids = list(unique_image_ids_set)

                if subqueries_list or exclude_subqueries_list:
                    unique_image_ids = builder.apply_filters_to_id_set(
                        unique_image_ids,
                        subqueries_list,
                        exclude_subqueries_list
                    )

                # Get all keywords for relevance counting
                all_keywords = []
                for filter_data in filters.values():
                    all_keywords.extend(filter_data.get('keywords', []))

                if unique_image_ids:
                    # Get active tag type for scoring
                    active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')

                    date_rows = db.query(
                        ImageMetadata.id,
                        ImageMetadata.capture_timestamp,
                        ImageMetadata.modified_time,
                        ImageMetadata.last_processed,
                        ImageMetadata.created_at,
                        ImageMetadata.rating,
                    ).filter(ImageMetadata.id.in_(unique_image_ids)).all()
                    rating_map = {row[0]: row[5] for row in date_rows}
                    if order_by_value == "processed":
                        date_map = {
                            row[0]: row[3] or row[4]
                            for row in date_rows
                        }
                    elif order_by_value == "created_at":
                        date_map = {
                            row[0]: row[4]
                            for row in date_rows
                        }
                    else:
                        date_map = {
                            row[0]: row[1] or row[2]
                            for row in date_rows
                        }
                    def date_key(img_id: int) -> float:
                        date_value = date_map.get(img_id)
                        if not date_value:
                            return float('inf')
                        ts = date_value.timestamp()
                        return -ts if date_order == "desc" else ts

                    def rating_key(img_id: int) -> tuple:
                        rating_value = rating_map.get(img_id)
                        if rating_value is None:
                            return (1, 0)
                        score = -rating_value if date_order == "desc" else rating_value
                        return (0, score)
                    if text_query_value:
                        prefilter_limit = _compute_hybrid_text_prefilter_limit(limit, offset)
                        if lexical_only_mode:
                            requested_upper_bound = max(1, int(limit or 100)) + max(0, int(offset or 0))
                            prefilter_limit = min(prefilter_limit, max(200, requested_upper_bound * 2))
                        lexical_seed_limit, vector_seed_limit, fallback_seed_limit = _compute_hybrid_seed_limits(
                            limit=limit,
                            offset=offset,
                            prefilter_limit=prefilter_limit,
                        )
                        unique_ids_lookup = set(unique_image_ids)
                        lexical_seed_ids = _fetch_text_index_seed_image_ids(
                            db=db,
                            tenant=tenant,
                            normalized_query=normalized_text_query,
                            query_tokens=text_query_tokens,
                            max_rows=lexical_seed_limit,
                        )
                        lexical_seed_ids = [image_id for image_id in lexical_seed_ids if image_id in unique_ids_lookup]
                        vector_seed_ids: List[int] = []
                        if vector_weight_value > 1e-6 and text_query_vector is not None:
                            raw_vector_seed_ids = _fetch_text_index_vector_seed_image_ids(
                                db=db,
                                tenant=tenant,
                                query_vector=text_query_vector,
                                max_rows=vector_seed_limit,
                            )
                            vector_seed_ids = [image_id for image_id in raw_vector_seed_ids if image_id in unique_ids_lookup]
                        seed_candidate_ids = _merge_seed_image_ids(
                            [lexical_seed_ids, vector_seed_ids],
                            max_rows=prefilter_limit,
                        )
                        if not lexical_only_mode and len(seed_candidate_ids) < prefilter_limit:
                            fallback_rows = build_candidate_rows_from_ids(
                                unique_image_ids,
                                max_rows=fallback_seed_limit,
                            )
                            fallback_seed_ids = [int(row.image_id) for row in fallback_rows]
                            seed_candidate_ids = _merge_seed_image_ids(
                                [seed_candidate_ids, fallback_seed_ids],
                                max_rows=prefilter_limit,
                            )
                        if seed_candidate_ids:
                            candidate_rows = build_candidate_rows_from_ids(
                                seed_candidate_ids,
                                max_rows=prefilter_limit,
                            )
                        else:
                            candidate_rows = []
                        sorted_ids, _, _, lexical_scores = _rank_candidates_with_hybrid_scores(
                            db=db,
                            tenant=tenant,
                            candidate_rows=candidate_rows,
                            text_query=text_query_value,
                            order_by_value=order_by_value,
                            date_order=date_order,
                            vector_weight=vector_weight_value,
                            lexical_weight=lexical_weight_value,
                            query_vector=text_query_vector,
                        )
                        if lexical_weight_value >= 0.999 and vector_weight_value <= 0.001:
                            sorted_ids = [
                                image_id
                                for image_id in sorted_ids
                                if float(lexical_scores.get(image_id, 0.0)) > 0.0
                            ]
                    elif order_by_value == "image_id":
                        sorted_ids = sorted(
                            unique_image_ids,
                            key=lambda img_id: -img_id if date_order == "desc" else img_id
                        )
                    elif order_by_value in ("photo_creation", "processed", "created_at"):
                        sorted_ids = sorted(
                            unique_image_ids,
                            key=lambda img_id: (
                                date_key(img_id),
                                -img_id if date_order == "desc" else img_id
                            )
                        )
                    elif order_by_value == "rating":
                        sorted_ids = sorted(
                            unique_image_ids,
                            key=lambda img_id: (
                                rating_key(img_id),
                                date_key(img_id),
                                -img_id if date_order == "desc" else img_id
                            )
                        )
                    else:
                        # Calculate relevance scores using helper
                        score_map = calculate_relevance_scores(db, tenant, unique_image_ids, all_keywords, active_tag_type)
                        # Sort by relevance first; keep date only as a late tie-breaker.
                        sorted_ids = sorted(
                            unique_image_ids,
                            key=lambda img_id: (
                                -(score_map.get(img_id) or 0),
                                -img_id if date_order == "desc" else img_id,
                                (
                                    -(date_map.get(img_id).timestamp())
                                    if date_map.get(img_id) and date_order == "desc"
                                    else (date_map.get(img_id).timestamp() if date_map.get(img_id) else float('inf'))
                                ),
                            )
                        )

                    total = len(sorted_ids)

                    # Apply anchor offset if requested
                    if anchor_id is not None and limit is not None:
                        offset = resolve_anchor_offset_for_sorted_ids(sorted_ids, offset)

                    # Apply offset and limit
                    paginated_ids = builder.paginate_id_list(sorted_ids, offset, limit)

                    # Now fetch full ImageMetadata objects in order
                    images = load_images_by_ordered_ids(paginated_ids)
                else:
                    images = []
                    total = 0
            else:
                # No matches
                images = []
                total = 0

        except (json.JSONDecodeError, KeyError, TypeError) as e:
            print(f"Error parsing category_filters: {e}")
            # Fall back to returning all images
            query = db.query(ImageMetadata).filter(
                tenant_column_filter(ImageMetadata, tenant)
            )
            total = int(query.order_by(None).count() or 0)
            query = query.order_by(*order_by_clauses)
            offset = resolve_anchor_offset(query, offset)
            images = query.limit(limit).offset(offset).all() if limit else query.offset(offset).all()
    # Apply keyword filtering if provided (legacy support)
    elif keywords:
        from .query_builder import QueryBuilder

        keyword_list = [k.strip() for k in keywords.split(',') if k.strip()]
        builder = QueryBuilder(db, tenant, date_order, order_by_value)

        if keyword_list and operator.upper() == "OR":
            # OR: Image must have ANY of the selected keywords
            # Get active tag type for filtering
            active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')

            # Find keyword IDs for the given keyword names
            keyword_ids = db.query(Keyword.id).filter(
                Keyword.keyword.in_(keyword_list),
                tenant_column_filter(Keyword, tenant)
            ).all()
            keyword_id_list = [kw[0] for kw in keyword_ids]

            if not keyword_id_list:
                # No matching keywords, return empty result
                images = []
                total = 0
            else:
                # Use subquery to get asset IDs that match keywords.
                matching_asset_ids = db.query(MachineTag.asset_id).filter(
                    MachineTag.keyword_id.in_(keyword_id_list),
                    tenant_column_filter(MachineTag, tenant),
                    MachineTag.tag_type == active_tag_type,
                    MachineTag.asset_id.is_not(None),
                ).distinct().subquery()

                # Main query with relevance ordering (by sum of confidence scores)
                order_by_date = func.coalesce(ImageMetadata.capture_timestamp, ImageMetadata.modified_time).desc()
                query = db.query(
                    ImageMetadata,
                    func.sum(MachineTag.confidence).label('relevance_score')
                ).join(
                    MachineTag,
                    and_(
                        MachineTag.asset_id == ImageMetadata.asset_id,
                        MachineTag.keyword_id.in_(keyword_id_list),
                        tenant_column_filter(MachineTag, tenant),
                        MachineTag.tag_type == active_tag_type
                    )
                ).filter(
                    tenant_column_filter(ImageMetadata, tenant),
                    ImageMetadata.asset_id.in_(matching_asset_ids)
                ).group_by(
                    ImageMetadata.id
                ).order_by(
                    func.sum(MachineTag.confidence).desc(),
                    id_order,
                    order_by_date
                )

                # Apply base_query subquery filters (list, rating, etc.) to the keyword query
                query = builder.apply_subqueries(query, subqueries_list, exclude_subqueries_list)

                total = builder.get_total_count(query)
                offset = resolve_anchor_offset(query, offset)
                results = builder.apply_pagination(query, offset, limit)
                images = [img for img, _ in results]

        elif keyword_list and operator.upper() == "AND":
            # AND: Image must have ALL selected keywords
            # Get active tag type for filtering
            active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')

            # Find keyword IDs for the given keyword names
            keyword_ids = db.query(Keyword.id).filter(
                Keyword.keyword.in_(keyword_list),
                tenant_column_filter(Keyword, tenant)
            ).all()
            keyword_id_list = [kw[0] for kw in keyword_ids]

            if not keyword_id_list or len(keyword_id_list) < len(keyword_list):
                # Not all keywords exist, return empty result
                images = []
                total = 0
            else:
                # Start with images that have tenant_id
                and_query = db.query(ImageMetadata.id).filter(
                    tenant_column_filter(ImageMetadata, tenant)
                )

                # For each keyword, filter images that have that keyword
                for keyword_id in keyword_id_list:
                    keyword_subquery = db.query(MachineTag.asset_id).filter(
                        MachineTag.keyword_id == keyword_id,
                        tenant_column_filter(MachineTag, tenant),
                        MachineTag.tag_type == active_tag_type,
                        MachineTag.asset_id.is_not(None),
                    ).subquery()

                    and_query = and_query.filter(ImageMetadata.asset_id.in_(keyword_subquery))

                # Apply base_query subquery filters (list, rating, etc.)
                and_query = builder.apply_subqueries(and_query, subqueries_list, exclude_subqueries_list)

                # Get matching image IDs
                matching_image_ids = and_query.subquery()

                # Query with relevance ordering (by sum of confidence scores)
                order_by_date = func.coalesce(ImageMetadata.capture_timestamp, ImageMetadata.modified_time).desc()
                query = db.query(
                    ImageMetadata,
                    func.sum(MachineTag.confidence).label('relevance_score')
                ).join(
                    MachineTag,
                    and_(
                        MachineTag.asset_id == ImageMetadata.asset_id,
                        MachineTag.keyword_id.in_(keyword_id_list),
                        tenant_column_filter(MachineTag, tenant),
                        MachineTag.tag_type == active_tag_type
                    )
                ).filter(
                    tenant_column_filter(ImageMetadata, tenant),
                    ImageMetadata.id.in_(matching_image_ids)
                ).group_by(
                    ImageMetadata.id
                ).order_by(
                    func.sum(MachineTag.confidence).desc(),
                    id_order,
                    order_by_date
                )

                total = builder.get_total_count(query)
                offset = resolve_anchor_offset(query, offset)
                results = builder.apply_pagination(query, offset, limit)
                images = [img for img, _ in results]
        else:
            # No valid keywords, use base_query with subquery filters
            query = base_query
            query = builder.apply_subqueries(query, subqueries_list, exclude_subqueries_list)
            order_by_clauses = builder.build_order_clauses()
            total = builder.get_total_count(query)
            images = builder.apply_pagination(query.order_by(*order_by_clauses), offset, limit)
    else:
        # No keywords filter, use base_query with subquery filters
        from .query_builder import QueryBuilder

        query = base_query
        builder = QueryBuilder(db, tenant, date_order, order_by_value)
        query = builder.apply_subqueries(query, subqueries_list, exclude_subqueries_list)
        query = query.options(load_only(*LIST_IMAGES_LOAD_ONLY_COLUMNS))

        if text_query_value:
            prefilter_limit = _compute_hybrid_text_prefilter_limit(limit, offset)
            if lexical_only_mode:
                requested_upper_bound = max(1, int(limit or 100)) + max(0, int(offset or 0))
                prefilter_limit = min(prefilter_limit, max(200, requested_upper_bound * 2))
            ordered_candidate_query = query.order_by(*order_by_clauses)
            lexical_seed_limit, vector_seed_limit, fallback_seed_limit = _compute_hybrid_seed_limits(
                limit=limit,
                offset=offset,
                prefilter_limit=prefilter_limit,
            )
            lexical_seed_ids = _fetch_text_index_seed_image_ids(
                db=db,
                tenant=tenant,
                normalized_query=normalized_text_query,
                query_tokens=text_query_tokens,
                max_rows=lexical_seed_limit,
            )
            vector_seed_ids: List[int] = []
            if vector_weight_value > 1e-6 and text_query_vector is not None:
                vector_seed_ids = _fetch_text_index_vector_seed_image_ids(
                    db=db,
                    tenant=tenant,
                    query_vector=text_query_vector,
                    max_rows=vector_seed_limit,
                )
            seed_candidate_ids = _merge_seed_image_ids(
                [lexical_seed_ids, vector_seed_ids],
                max_rows=prefilter_limit,
            )
            if not lexical_only_mode and len(seed_candidate_ids) < prefilter_limit:
                fallback_rows = build_candidate_rows_from_query(
                    ordered_candidate_query,
                    max_rows=fallback_seed_limit,
                )
                fallback_seed_ids = [int(row.image_id) for row in fallback_rows]
                seed_candidate_ids = _merge_seed_image_ids(
                    [seed_candidate_ids, fallback_seed_ids],
                    max_rows=prefilter_limit,
                )
            if seed_candidate_ids:
                seeded_candidate_query = ordered_candidate_query.filter(ImageMetadata.id.in_(seed_candidate_ids))
                candidate_rows = build_candidate_rows_from_query(
                    seeded_candidate_query,
                    max_rows=prefilter_limit,
                )
            else:
                candidate_rows = []
            if candidate_rows:
                sorted_ids, _, _, lexical_scores = _rank_candidates_with_hybrid_scores(
                    db=db,
                    tenant=tenant,
                    candidate_rows=candidate_rows,
                    text_query=text_query_value,
                    order_by_value=order_by_value,
                    date_order=date_order,
                    vector_weight=vector_weight_value,
                    lexical_weight=lexical_weight_value,
                    query_vector=text_query_vector,
                )
                if lexical_weight_value >= 0.999 and vector_weight_value <= 0.001:
                    sorted_ids = [
                        image_id
                        for image_id in sorted_ids
                        if float(lexical_scores.get(image_id, 0.0)) > 0.0
                    ]
            else:
                sorted_ids = []
            total = len(sorted_ids)
            if anchor_id is not None and limit is not None:
                offset = resolve_anchor_offset_for_sorted_ids(sorted_ids, offset)
            paginated_ids = sorted_ids[offset: offset + limit] if limit else sorted_ids[offset:]
            images = load_images_by_ordered_ids(paginated_ids)
        elif order_by_value == "ml_score" and ml_keyword_id:
            is_ml_similarity_mode = str(ml_tag_type or "").strip().lower() == "ml-similarity"

            if is_ml_similarity_mode:
                similarity_seed_limit = similarity_seed_limit_value
                similarity_per_seed_limit = similarity_per_seed_limit_value
                similarity_keyword = permatag_keyword or ml_keyword

                seed_base_query, seed_subqueries, seed_exclude_subqueries, seed_has_empty_filter = build_image_query_with_subqueries(
                    db,
                    tenant,
                    current_user=current_user,
                    is_tenant_admin=is_tenant_admin,
                    list_id=list_id,
                    list_exclude_id=list_exclude_id,
                    rating=rating,
                    rating_operator=rating_operator,
                    hide_zero_rating=True,
                    reviewed=reviewed,
                    media_type=None if media_type_value == "all" else media_type_value,
                    dropbox_path_prefix=dropbox_path_prefix,
                    filename_query=filename_query,
                    permatag_keyword=similarity_keyword,
                    permatag_category=permatag_category,
                    permatag_signum=1,
                    permatag_missing=False,
                    permatag_positive_missing=False,
                    ml_keyword=ml_keyword,
                    ml_tag_type=ml_tag_type,
                    apply_ml_tag_filter=False,
                )
                candidate_base_query, candidate_subqueries, candidate_exclude_subqueries, candidate_has_empty_filter = build_image_query_with_subqueries(
                    db,
                    tenant,
                    current_user=current_user,
                    is_tenant_admin=is_tenant_admin,
                    list_id=list_id,
                    list_exclude_id=list_exclude_id,
                    rating=rating,
                    rating_operator=rating_operator,
                    hide_zero_rating=True,
                    reviewed=reviewed,
                    media_type=None if media_type_value == "all" else media_type_value,
                    dropbox_path_prefix=dropbox_path_prefix,
                    filename_query=filename_query,
                    permatag_keyword=similarity_keyword,
                    permatag_category=permatag_category,
                    permatag_signum=None,
                    permatag_missing=True,
                    permatag_positive_missing=permatag_positive_missing,
                    ml_keyword=ml_keyword,
                    ml_tag_type=ml_tag_type,
                    apply_ml_tag_filter=False,
                )

                if seed_has_empty_filter or candidate_has_empty_filter:
                    images = []
                    total = 0
                    similarity_groups = []
                else:
                    seed_query = builder.apply_subqueries(seed_base_query, seed_subqueries, seed_exclude_subqueries)
                    seed_query = seed_query.options(load_only(*LIST_IMAGES_LOAD_ONLY_COLUMNS))
                    if similarity_random_enabled:
                        seed_query = seed_query.order_by(func.random())
                    else:
                        seed_query = seed_query.order_by(
                            ImageMetadata.rating.desc().nullslast(),
                            func.coalesce(ImageMetadata.capture_timestamp, ImageMetadata.modified_time).desc(),
                            ImageMetadata.id.desc(),
                        )
                    seed_images = seed_query.limit(similarity_seed_limit).all()

                    candidate_query = builder.apply_subqueries(candidate_base_query, candidate_subqueries, candidate_exclude_subqueries)
                    candidate_rows = candidate_query.with_entities(
                        ImageMetadata.id.label("image_id"),
                    ).all()
                    candidate_id_set = {int(row.image_id) for row in candidate_rows}

                    flattened_ids: List[int] = []
                    flattened_meta: List[dict] = []
                    similarity_groups = []
                    similarity_media_type = None if media_type_value == "all" else media_type_value
                    # Conservative safety limits: prefer fewer results over long-running expansion.
                    similarity_fetch_limit_start = similarity_per_seed_limit + 15 + (10 if similarity_dedupe_enabled else 0)
                    similarity_fetch_limit_start = max(similarity_fetch_limit_start, similarity_per_seed_limit)
                    similarity_fetch_limit_max = min(max(similarity_per_seed_limit * 12, 150), 700)
                    similarity_pgvector_scan_cap = min(max(similarity_per_seed_limit * 30, 300), 1000)
                    similarity_max_expand_attempts = 3
                    similarity_seed_budget_seconds = 0.35
                    seen_image_ids: set[int] = set()

                    for group_index, seed_image in enumerate(seed_images):
                        seed_id = int(seed_image.id)
                        similarity_groups.append({
                            "group_index": group_index,
                            "seed_image_id": seed_id,
                        })
                        flattened_ids.append(seed_id)
                        flattened_meta.append({
                            "similarity_group": group_index,
                            "similarity_seed": True,
                            "similarity_seed_image_id": seed_id,
                            "similarity_score": 1.0,
                        })
                        if similarity_dedupe_enabled:
                            seen_image_ids.add(seed_id)

                        if seed_image.asset_id is None:
                            continue
                        seed_embedding = db.query(ImageEmbedding).filter(
                            tenant_column_filter(ImageEmbedding, tenant),
                            ImageEmbedding.asset_id == seed_image.asset_id,
                            ImageEmbedding.embedding.is_not(None),
                        ).first()
                        if not seed_embedding or not seed_embedding.embedding:
                            continue

                        seed_vector = np.asarray(seed_embedding.embedding, dtype=np.float32)
                        if seed_vector.ndim != 1 or seed_vector.size == 0:
                            continue
                        seed_norm = float(np.linalg.norm(seed_vector))
                        if seed_norm <= 1e-12:
                            continue
                        source_unit_vector = seed_vector / seed_norm

                        # With strict candidate filters, many nearest neighbors can be filtered out.
                        # Expand fetch depth until we can fill y (or hit a max cap).
                        pgvector_ranked = None
                        pgvector_viable_count = 0
                        pgvector_limit = int(similarity_fetch_limit_start)
                        expand_attempts = 0
                        seed_fetch_started = time.monotonic()
                        while True:
                            if expand_attempts >= similarity_max_expand_attempts:
                                break
                            if (time.monotonic() - seed_fetch_started) >= similarity_seed_budget_seconds:
                                break
                            expand_attempts += 1
                            pgvector_attempt = _fetch_similar_ids_with_pgvector(
                                db=db,
                                tenant=tenant,
                                source_image_id=seed_id,
                                source_asset_id=seed_image.asset_id,
                                source_vector=source_unit_vector,
                                limit=pgvector_limit,
                                min_score=None,
                                media_type=similarity_media_type,
                                candidate_scan_cap=similarity_pgvector_scan_cap,
                            )
                            if pgvector_attempt is None:
                                pgvector_ranked = None
                                break
                            attempt_ids, _attempt_scores = pgvector_attempt
                            viable_count = 0
                            for attempt_id in attempt_ids:
                                attempt_id_int = int(attempt_id)
                                if attempt_id_int == seed_id:
                                    continue
                                if attempt_id_int not in candidate_id_set:
                                    continue
                                if similarity_dedupe_enabled and attempt_id_int in seen_image_ids:
                                    continue
                                viable_count += 1
                                if viable_count >= similarity_per_seed_limit:
                                    break
                            pgvector_ranked = pgvector_attempt
                            pgvector_viable_count = viable_count
                            if viable_count >= similarity_per_seed_limit:
                                break
                            if pgvector_limit >= similarity_fetch_limit_max:
                                break
                            if len(attempt_ids) < pgvector_limit:
                                # No deeper pool available from pgvector for this seed.
                                break
                            pgvector_limit = min(pgvector_limit * 2, similarity_fetch_limit_max)

                        if pgvector_ranked is not None and pgvector_viable_count <= 0:
                            # pgvector path can occasionally return no viable in-tenant rows
                            # after post-filters; fall back to tenant-local in-memory ranking.
                            pgvector_ranked = None

                        if pgvector_ranked is not None:
                            ranked_ids, raw_score_by_id = pgvector_ranked
                            score_by_image_id = {
                                int(image_id): _normalize_similarity_score(score)
                                for image_id, score in (raw_score_by_id or {}).items()
                            }
                        else:
                            # Avoid expensive cold index builds on interactive audit requests.
                            # If a cache is already warm, use it; otherwise prefer fewer results
                            # over slow response times.
                            index = _peek_cached_similarity_index(
                                tenant=tenant,
                                media_type=similarity_media_type,
                                embedding_dim=int(seed_vector.size),
                            )
                            if index is None:
                                ranked_ids = []
                                score_by_image_id = {}
                                continue
                            matrix = index["matrix"]
                            candidate_ids = index["image_ids"]
                            if matrix.size == 0 or candidate_ids.size == 0:
                                ranked_ids = []
                                score_by_image_id = {}
                            else:
                                raw_scores = np.dot(matrix, source_unit_vector)
                                keep_mask = candidate_ids != seed_id
                                filtered_ids = candidate_ids[keep_mask]
                                filtered_scores = raw_scores[keep_mask]
                                if filtered_ids.size == 0:
                                    ranked_ids = []
                                    score_by_image_id = {}
                                else:
                                    ranked_indices = np.argsort(filtered_scores)[::-1]
                                    ranked_ids = [int(filtered_ids[int(idx)]) for idx in ranked_indices]
                                    score_by_image_id = {
                                        int(filtered_ids[int(idx)]): _normalize_similarity_score(filtered_scores[int(idx)])
                                        for idx in ranked_indices
                                    }

                        selected_similars = []
                        for similar_id in ranked_ids:
                            similar_id_int = int(similar_id)
                            if similar_id_int == seed_id:
                                continue
                            if similar_id_int not in candidate_id_set:
                                continue
                            if similarity_dedupe_enabled and similar_id_int in seen_image_ids:
                                continue
                            selected_similars.append(similar_id_int)
                            flattened_ids.append(similar_id_int)
                            flattened_meta.append({
                                "similarity_group": group_index,
                                "similarity_seed": False,
                                "similarity_seed_image_id": seed_id,
                                "similarity_score": float(score_by_image_id.get(similar_id_int, 0.0)),
                            })
                            if similarity_dedupe_enabled:
                                seen_image_ids.add(similar_id_int)
                            if len(selected_similars) >= similarity_per_seed_limit:
                                break

                    total = len(flattened_ids)
                    if anchor_id is not None and limit is not None:
                        offset = resolve_anchor_offset_for_sorted_ids(flattened_ids, offset)
                    if limit:
                        paginated_ids = flattened_ids[offset:offset + limit]
                        paginated_meta = flattened_meta[offset:offset + limit]
                    else:
                        paginated_ids = flattened_ids[offset:]
                        paginated_meta = flattened_meta[offset:]
                    images = load_images_by_ordered_ids(paginated_ids)
                    image_entry_metadata = paginated_meta[:len(images)]
            else:
                def fetch_ml_score_page(require_match: bool):
                    ml_query, ml_scores_subquery = builder.apply_ml_score_ordering(
                        query,
                        ml_keyword_id,
                        ml_tag_type,
                        require_match=require_match,
                    )
                    if order_by_value == "processed":
                        order_by_date_clause = func.coalesce(ImageMetadata.last_processed, ImageMetadata.created_at)
                    elif order_by_value == "created_at":
                        order_by_date_clause = ImageMetadata.created_at
                    else:
                        order_by_date_clause = func.coalesce(ImageMetadata.capture_timestamp, ImageMetadata.modified_time)
                    order_by_date_clause = order_by_date_clause.desc() if date_order == "desc" else order_by_date_clause.asc()
                    id_order_clause = ImageMetadata.id.desc() if date_order == "desc" else ImageMetadata.id.asc()
                    order_clauses = (
                        ml_scores_subquery.c.ml_score.desc().nullslast(),
                        order_by_date_clause,
                        id_order_clause,
                    )
                    ml_query = ml_query.order_by(*order_clauses)
                    resolved_offset = resolve_anchor_offset(ml_query, offset)
                    if limit:
                        rows = ml_query.limit(limit + 1).offset(resolved_offset).all()
                        has_more = len(rows) > limit
                        page_rows = rows[:limit] if has_more else rows
                        estimated_total = resolved_offset + len(page_rows) + (1 if has_more else 0)
                    else:
                        page_rows = ml_query.offset(resolved_offset).all()
                        estimated_total = resolved_offset + len(page_rows)
                    return ml_query, page_rows, resolved_offset, estimated_total

                query, images, resolved_offset, total = fetch_ml_score_page(require_match=True)
                if not images and query.limit(1).first() is None:
                    # No ML-tag matches at all: fall back to filtered rows ordered by ML score (nulls last).
                    query = base_query
                    query = builder.apply_subqueries(query, subqueries_list, exclude_subqueries_list)
                    query = query.options(load_only(*LIST_IMAGES_LOAD_ONLY_COLUMNS))
                    query, images, resolved_offset, total = fetch_ml_score_page(require_match=False)
                offset = resolved_offset
        else:
            total = builder.get_total_count(query)
            order_by_clauses = builder.build_order_clauses()
            query = query.order_by(*order_by_clauses)
            offset = resolve_anchor_offset(query, offset)
            images = query.limit(limit).offset(offset).all() if limit else query.offset(offset).all()
    # Get tags for all images
    image_ids = [img.id for img in images]
    asset_id_to_image_id = {img.asset_id: img.id for img in images if img.asset_id is not None}
    asset_ids = list(asset_id_to_image_id.keys())
    # Use ml_tag_type if provided (for AI filtering), otherwise use active_tag_type.
    # ml-similarity is audit-only and not an actual machine tag type.
    normalized_ml_tag_type = str(ml_tag_type or "").strip().lower()
    if ml_tag_type and normalized_ml_tag_type != "ml-similarity":
        tag_type_filter = ml_tag_type
    else:
        tag_type_filter = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')
    tags = db.query(MachineTag).filter(
        MachineTag.asset_id.in_(asset_ids),
        tenant_column_filter(MachineTag, tenant),
        MachineTag.tag_type == tag_type_filter
    ).all() if asset_ids else []

    # Get permatags for all images
    permatags = db.query(Permatag).filter(
        Permatag.asset_id.in_(asset_ids),
        tenant_column_filter(Permatag, tenant)
    ).all() if asset_ids else []
    variant_count_by_asset = {
        asset_id: int(count or 0)
        for asset_id, count in (
            db.query(
                AssetDerivative.asset_id,
                func.count(AssetDerivative.id),
            ).filter(
                AssetDerivative.asset_id.in_(asset_ids),
                AssetDerivative.deleted_at.is_(None),
            ).group_by(AssetDerivative.asset_id).all() if asset_ids else []
        )
    }
    # Load all keywords to avoid N+1 queries
    keyword_ids = set()
    for tag in tags:
        keyword_ids.add(tag.keyword_id)
    for permatag in permatags:
        keyword_ids.add(permatag.keyword_id)

    # Build keyword lookup map using utility function
    keywords_map = load_keywords_map(db, tenant.id, keyword_ids)

    # Group tags by image_id
    tags_by_image = {}
    for tag in tags:
        image_id = asset_id_to_image_id.get(tag.asset_id)
        if image_id is None:
            continue
        if image_id not in tags_by_image:
            tags_by_image[image_id] = []
        kw_info = keywords_map.get(tag.keyword_id, {"keyword": "unknown", "category": "unknown"})
        tags_by_image[image_id].append({
            "keyword": kw_info["keyword"],
            "category": kw_info["category"],
            "confidence": round(tag.confidence, 2)
        })

    # Group permatags by image_id
    permatags_by_image = {}
    reviewed_at_by_image = {}
    for permatag in permatags:
        image_id = asset_id_to_image_id.get(permatag.asset_id)
        if image_id is None:
            continue
        if image_id not in permatags_by_image:
            permatags_by_image[image_id] = []
        kw_info = keywords_map.get(permatag.keyword_id, {"keyword": "unknown", "category": "unknown"})
        permatags_by_image[image_id].append({
            "id": permatag.id,
            "keyword": kw_info["keyword"],
            "category": kw_info["category"],
            "signum": permatag.signum
        })
        if permatag.created_at:
            current_latest = reviewed_at_by_image.get(image_id)
            if current_latest is None or permatag.created_at > current_latest:
                reviewed_at_by_image[image_id] = permatag.created_at

    assets_by_id = load_assets_for_images(db, images)
    images_list = []
    for idx, img in enumerate(images):
        storage_info = _resolve_storage_or_409(
            image=img,
            tenant=tenant,
            db=db,
            assets_by_id=assets_by_id,
        )
        machine_tags = sorted(tags_by_image.get(img.id, []), key=lambda x: x['confidence'], reverse=True)
        image_permatags = permatags_by_image.get(img.id, [])
        calculated_tags = calculate_tags(machine_tags, image_permatags)
        image_payload = {
            "id": img.id,
            "asset_id": storage_info.asset_id,
            "variant_count": int(variant_count_by_asset.get(img.asset_id, 0)),
            "has_variants": int(variant_count_by_asset.get(img.asset_id, 0)) > 0,
            "filename": img.filename,
            "width": img.width,
            "height": img.height,
            "format": img.format,
            "file_size": img.file_size,
            "dropbox_path": storage_info.source_key,
            "source_provider": storage_info.source_provider,
            "source_key": storage_info.source_key,
            "source_rev": storage_info.source_rev,
            "source_url": _build_source_url(storage_info, tenant, img),
            "camera_make": img.camera_make,
            "camera_model": img.camera_model,
            "lens_model": img.lens_model,
            "iso": img.iso,
            "aperture": img.aperture,
            "shutter_speed": img.shutter_speed,
            "focal_length": img.focal_length,
            "gps_latitude": img.gps_latitude,
            "gps_longitude": img.gps_longitude,
            "capture_timestamp": img.capture_timestamp.isoformat() if img.capture_timestamp else None,
            "modified_time": img.modified_time.isoformat() if img.modified_time else None,
            "created_at": img.created_at.isoformat() if img.created_at else None,
            "thumbnail_path": storage_info.thumbnail_key,
            "thumbnail_url": storage_info.thumbnail_url,
            "media_type": (storage_info.asset.media_type if storage_info.asset else None) or "image",
            "mime_type": storage_info.asset.mime_type if storage_info.asset else None,
            "duration_ms": storage_info.asset.duration_ms if storage_info.asset else None,
            "tags_applied": img.tags_applied,
            "faces_detected": img.faces_detected,
            "rating": img.rating,
            "reviewed_at": reviewed_at_by_image.get(img.id).isoformat() if reviewed_at_by_image.get(img.id) else None,
            "tags": machine_tags,
            "permatags": image_permatags,
            "calculated_tags": calculated_tags
        }
        if image_entry_metadata and idx < len(image_entry_metadata):
            entry_meta = image_entry_metadata[idx] or {}
            image_payload["similarity_group"] = entry_meta.get("similarity_group")
            image_payload["similarity_seed"] = bool(entry_meta.get("similarity_seed"))
            image_payload["similarity_seed_image_id"] = entry_meta.get("similarity_seed_image_id")
            image_payload["similarity_score"] = float(entry_meta.get("similarity_score", 0.0))
        images_list.append(image_payload)
    result = {
        "tenant_id": tenant.id,
        "images": images_list,
        "total": total,
        "limit": limit,
        "offset": offset,
        "text_query": text_query_value or None,
        "hybrid_vector_weight": vector_weight_value if text_query_value else None,
        "hybrid_lexical_weight": lexical_weight_value if text_query_value else None,
    }
    if similarity_groups is not None:
        result["similarity_groups"] = similarity_groups
    _log_images_search_event(
        db=db,
        request=request,
        tenant=tenant,
        current_user=current_user,
        total=int(total or 0),
        returned_count=len(images_list),
        limit=limit,
        offset=offset,
        text_query=text_query_value,
        keywords=keywords,
        category_filters=category_filters,
        filename_query=filename_query,
        dropbox_path_prefix=dropbox_path_prefix,
        order_by_value=order_by_value,
        date_order=date_order,
        hybrid_vector_weight=vector_weight_value,
        hybrid_lexical_weight=lexical_weight_value,
    )
    return result


@router.get("/images/duplicates", response_model=dict, operation_id="list_duplicate_images")
async def list_duplicate_images(
    tenant: Tenant = Depends(get_tenant),
    limit: int = 100,
    offset: int = 0,
    date_order: str = "desc",
    filename_query: Optional[str] = None,
    include_total: bool = False,
    db: Session = Depends(get_db),
):
    """List duplicate assets using embedding hash (preferred) or content hash fallback."""
    date_order = (date_order or "desc").lower()
    if date_order not in ("asc", "desc"):
        date_order = "desc"

    embedding_key_expr = case(
        (
            ImageEmbedding.id.is_not(None),
            cast(literal("emb:"), Text) + func.md5(cast(ImageEmbedding.embedding, Text)),
        ),
        else_=None,
    )
    content_hash_key_expr = case(
        (
            ImageMetadata.content_hash.is_not(None),
            cast(literal("sha:"), Text) + ImageMetadata.content_hash,
        ),
        else_=None,
    )
    # Prefer content hash so duplicate grouping matches upload dedup behavior.
    # Fall back to embedding hash only when content hash is unavailable.
    duplicate_key_expr = func.coalesce(content_hash_key_expr, embedding_key_expr)

    image_keys = db.query(
        ImageMetadata.id.label("image_id"),
        ImageMetadata.filename.label("filename"),
        ImageMetadata.created_at.label("created_at"),
        duplicate_key_expr.label("duplicate_key"),
    ).outerjoin(
        ImageEmbedding,
        and_(
            ImageEmbedding.asset_id == ImageMetadata.asset_id,
            tenant_column_filter(ImageEmbedding, tenant),
            ImageEmbedding.asset_id.is_not(None),
        ),
    ).filter(
        tenant_column_filter(ImageMetadata, tenant),
    ).subquery()

    duplicate_groups = db.query(
        image_keys.c.duplicate_key.label("duplicate_key"),
        func.count(image_keys.c.image_id).label("duplicate_count"),
    ).filter(
        image_keys.c.duplicate_key.is_not(None),
    ).group_by(
        image_keys.c.duplicate_key,
    ).having(
        func.count(image_keys.c.image_id) > 1,
    ).subquery()

    base_query = db.query(
        image_keys.c.image_id.label("image_id"),
        duplicate_groups.c.duplicate_key.label("duplicate_key"),
        duplicate_groups.c.duplicate_count.label("duplicate_count"),
        image_keys.c.created_at.label("created_at"),
    ).join(
        duplicate_groups,
        image_keys.c.duplicate_key == duplicate_groups.c.duplicate_key,
    )
    if filename_query:
        filename_pattern = f"%{filename_query.strip()}%"
        if filename_pattern != "%%":
            base_query = base_query.filter(image_keys.c.filename.ilike(filename_pattern))

    created_order = image_keys.c.created_at.desc() if date_order == "desc" else image_keys.c.created_at.asc()
    id_order = image_keys.c.image_id.desc() if date_order == "desc" else image_keys.c.image_id.asc()
    requested_limit = max(1, int(limit or 100))
    rows = base_query.order_by(
        duplicate_groups.c.duplicate_count.desc(),
        duplicate_groups.c.duplicate_key.asc(),
        created_order,
        id_order,
    ).limit(requested_limit + 1).offset(offset).all()
    has_more = len(rows) > requested_limit
    if has_more:
        rows = rows[:requested_limit]

    total = int(base_query.order_by(None).count() or 0) if include_total else (offset + len(rows) + (1 if has_more else 0))

    image_ids = [row.image_id for row in rows]
    images = db.query(ImageMetadata).filter(
        ImageMetadata.id.in_(image_ids)
    ).options(
        load_only(*LIST_IMAGES_LOAD_ONLY_COLUMNS)
    ).all() if image_ids else []
    image_by_id = {img.id: img for img in images}
    ordered_images = [image_by_id[img_id] for img_id in image_ids if img_id in image_by_id]

    assets_by_id = load_assets_for_images(db, ordered_images)
    asset_id_to_image_id = {img.asset_id: img.id for img in ordered_images if img.asset_id is not None}
    asset_ids = list(asset_id_to_image_id.keys())
    duplicate_meta_by_image_id = {
        row.image_id: {
            "duplicate_key": row.duplicate_key,
            "duplicate_count": int(row.duplicate_count or 0),
        }
        for row in rows
    }

    permatags = db.query(Permatag).filter(
        Permatag.asset_id.in_(asset_ids),
        tenant_column_filter(Permatag, tenant)
    ).all() if asset_ids else []
    variant_count_by_asset = {
        asset_id: int(count or 0)
        for asset_id, count in (
            db.query(
                AssetDerivative.asset_id,
                func.count(AssetDerivative.id),
            ).filter(
                AssetDerivative.asset_id.in_(asset_ids),
                AssetDerivative.deleted_at.is_(None),
            ).group_by(AssetDerivative.asset_id).all() if asset_ids else []
        )
    }

    keyword_ids = {tag.keyword_id for tag in permatags}
    keywords_map = load_keywords_map(db, tenant.id, keyword_ids)

    permatags_by_image = {}
    for permatag in permatags:
        image_id = asset_id_to_image_id.get(permatag.asset_id)
        if image_id is None:
            continue
        if image_id not in permatags_by_image:
            permatags_by_image[image_id] = []
        kw_info = keywords_map.get(permatag.keyword_id, {"keyword": "unknown", "category": "unknown"})
        permatags_by_image[image_id].append({
            "id": permatag.id,
            "keyword": kw_info["keyword"],
            "category": kw_info["category"],
            "signum": permatag.signum,
        })

    images_list = []
    for img in ordered_images:
        storage_info = _resolve_storage_or_409(
            image=img,
            tenant=tenant,
            db=db,
            assets_by_id=assets_by_id,
        )
        dup_meta = duplicate_meta_by_image_id.get(img.id, {})
        image_permatags = permatags_by_image.get(img.id, [])
        duplicate_key = dup_meta.get("duplicate_key")
        duplicate_basis = "embedding" if (duplicate_key or "").startswith("emb:") else "content_hash"
        images_list.append({
            "id": img.id,
            "asset_id": storage_info.asset_id,
            "variant_count": int(variant_count_by_asset.get(img.asset_id, 0)),
            "has_variants": int(variant_count_by_asset.get(img.asset_id, 0)) > 0,
            "filename": img.filename,
            "file_size": img.file_size,
            "source_provider": storage_info.source_provider,
            "source_key": storage_info.source_key,
            "source_rev": storage_info.source_rev,
            "source_url": _build_source_url(storage_info, tenant, img),
            "capture_timestamp": img.capture_timestamp.isoformat() if img.capture_timestamp else None,
            "modified_time": img.modified_time.isoformat() if img.modified_time else None,
            "created_at": img.created_at.isoformat() if img.created_at else None,
            "thumbnail_path": storage_info.thumbnail_key,
            "thumbnail_url": storage_info.thumbnail_url,
            "media_type": (storage_info.asset.media_type if storage_info.asset else None) or "image",
            "mime_type": storage_info.asset.mime_type if storage_info.asset else None,
            "duration_ms": storage_info.asset.duration_ms if storage_info.asset else None,
            "rating": img.rating,
            "permatags": image_permatags,
            "duplicate_group": duplicate_key,
            "duplicate_count": dup_meta.get("duplicate_count", 0),
            "duplicate_basis": duplicate_basis,
        })

    return {
        "tenant_id": tenant.id,
        "images": images_list,
        "total": total,
        "limit": requested_limit,
        "offset": offset,
        "has_more": has_more,
    }


@router.get("/images/{image_id}/similar", response_model=dict, operation_id="get_similar_images")
def get_similar_images(
    image_id: int,
    tenant: Tenant = Depends(get_tenant),
    limit: int = 40,
    min_score: Optional[float] = None,
    same_media_type: bool = True,
    db: Session = Depends(get_db),
):
    """Return top embedding-similar images for a given image."""
    requested_limit = max(1, min(int(limit or 40), 200))
    if min_score is not None:
        if min_score < -1.0 or min_score > 1.0:
            raise HTTPException(status_code=400, detail="min_score must be between -1.0 and 1.0")

    source_image = db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        tenant_column_filter(ImageMetadata, tenant),
    ).options(
        load_only(*LIST_IMAGES_LOAD_ONLY_COLUMNS)
    ).first()
    if not source_image:
        raise HTTPException(status_code=404, detail="Image not found")
    if source_image.asset_id is None:
        raise HTTPException(status_code=400, detail="Image has no linked asset")

    source_embedding = db.query(ImageEmbedding).filter(
        tenant_column_filter(ImageEmbedding, tenant),
        ImageEmbedding.asset_id == source_image.asset_id,
        ImageEmbedding.embedding.is_not(None),
    ).first()
    if not source_embedding or not source_embedding.embedding:
        raise HTTPException(status_code=400, detail="Embedding not found for source image")

    source_vector = np.asarray(source_embedding.embedding, dtype=np.float32)
    if source_vector.ndim != 1 or source_vector.size == 0:
        raise HTTPException(status_code=400, detail="Invalid source embedding")
    source_norm = float(np.linalg.norm(source_vector))
    if source_norm <= 1e-12:
        raise HTTPException(status_code=400, detail="Source embedding has zero magnitude")
    source_unit_vector = source_vector / source_norm

    source_storage_info = _resolve_storage_or_409(image=source_image, tenant=tenant, db=db)
    source_media_type = ((source_storage_info.asset.media_type if source_storage_info.asset else None) or "image").lower()
    similarity_media_type = source_media_type if same_media_type else None

    pgvector_ranked = _fetch_similar_ids_with_pgvector(
        db=db,
        tenant=tenant,
        source_image_id=int(source_image.id),
        source_asset_id=source_image.asset_id,
        source_vector=source_unit_vector,
        limit=requested_limit,
        min_score=min_score,
        media_type=similarity_media_type,
    )

    if pgvector_ranked is not None:
        top_image_ids, score_by_image_id = pgvector_ranked
    else:
        index = _get_similarity_index(
            db=db,
            tenant=tenant,
            media_type=similarity_media_type,
            embedding_dim=int(source_vector.size),
        )
        matrix = index["matrix"]
        candidate_ids = index["image_ids"]
        if matrix.size == 0 or candidate_ids.size == 0:
            top_image_ids = []
            score_by_image_id = {}
        else:
            scores = np.dot(matrix, source_unit_vector)
            keep_mask = candidate_ids != int(source_image.id)
            filtered_ids = candidate_ids[keep_mask]
            filtered_scores = scores[keep_mask]

            if min_score is not None and filtered_ids.size > 0:
                score_mask = filtered_scores >= float(min_score)
                filtered_scores = filtered_scores[score_mask]
                filtered_ids = filtered_ids[score_mask]

            if filtered_ids.size == 0:
                top_image_ids = []
                score_by_image_id = {}
            else:
                if requested_limit < filtered_scores.size:
                    top_unsorted = np.argpartition(filtered_scores, -requested_limit)[-requested_limit:]
                    ordered_indices = top_unsorted[np.argsort(filtered_scores[top_unsorted])[::-1]]
                else:
                    ordered_indices = np.argsort(filtered_scores)[::-1]

                top_image_ids = [int(filtered_ids[int(idx)]) for idx in ordered_indices]
                score_by_image_id = {
                    int(filtered_ids[int(idx)]): round(float(filtered_scores[int(idx)]), 4)
                    for idx in ordered_indices
                }

    if not top_image_ids:
        return {
            "tenant_id": tenant.id,
            "source_image_id": source_image.id,
            "source_asset_id": str(source_image.asset_id),
            "source_media_type": source_media_type,
            "same_media_type": bool(same_media_type),
            "images": [],
            "count": 0,
            "limit": requested_limit,
        }

    top_images = db.query(ImageMetadata).filter(
        tenant_column_filter(ImageMetadata, tenant),
        ImageMetadata.id.in_(top_image_ids),
    ).options(
        load_only(*LIST_IMAGES_LOAD_ONLY_COLUMNS)
    ).all()
    images_by_id = {int(img.id): img for img in top_images}
    ordered_images = [images_by_id[img_id] for img_id in top_image_ids if img_id in images_by_id]
    assets_by_id = load_assets_for_images(db, ordered_images)
    asset_id_to_image_id = {img.asset_id: int(img.id) for img in ordered_images if img.asset_id is not None}
    asset_ids = list(asset_id_to_image_id.keys())
    permatags = db.query(Permatag).filter(
        Permatag.asset_id.in_(asset_ids),
        tenant_column_filter(Permatag, tenant),
    ).all() if asset_ids else []
    keyword_ids = {tag.keyword_id for tag in permatags}
    keywords_map = load_keywords_map(db, tenant.id, keyword_ids)
    permatags_by_image = {}
    for tag in permatags:
        image_row_id = asset_id_to_image_id.get(tag.asset_id)
        if image_row_id is None:
            continue
        kw_info = keywords_map.get(tag.keyword_id, {"keyword": "unknown", "category": "unknown"})
        permatags_by_image.setdefault(image_row_id, []).append({
            "id": tag.id,
            "keyword": kw_info["keyword"],
            "category": kw_info["category"],
            "signum": tag.signum,
        })

    images_list = []
    for image_row in ordered_images:
        try:
            storage_info = _resolve_storage_or_409(
                image=image_row,
                tenant=tenant,
                db=db,
                assets_by_id=assets_by_id,
            )
        except HTTPException:
            continue
        similarity_score = score_by_image_id.get(int(image_row.id), 0.0)
        image_permatags = permatags_by_image.get(int(image_row.id), [])
        images_list.append({
            "id": image_row.id,
            "asset_id": storage_info.asset_id,
            "filename": image_row.filename,
            "width": image_row.width,
            "height": image_row.height,
            "file_size": image_row.file_size,
            "capture_timestamp": image_row.capture_timestamp.isoformat() if image_row.capture_timestamp else None,
            "modified_time": image_row.modified_time.isoformat() if image_row.modified_time else None,
            "created_at": image_row.created_at.isoformat() if image_row.created_at else None,
            "source_provider": storage_info.source_provider,
            "source_key": storage_info.source_key,
            "source_url": _build_source_url(storage_info, tenant, image_row),
            "thumbnail_url": storage_info.thumbnail_url,
            "media_type": (storage_info.asset.media_type if storage_info.asset else None) or "image",
            "mime_type": storage_info.asset.mime_type if storage_info.asset else None,
            "duration_ms": storage_info.asset.duration_ms if storage_info.asset else None,
            "rating": image_row.rating,
            "permatags": image_permatags,
            "similarity_score": similarity_score,
        })

    return {
        "tenant_id": tenant.id,
        "source_image_id": source_image.id,
        "source_asset_id": str(source_image.asset_id),
        "source_media_type": source_media_type,
        "same_media_type": bool(same_media_type),
        "images": images_list,
        "count": len(images_list),
        "limit": requested_limit,
    }


@router.get("/images/{image_id}", response_model=dict, operation_id="get_image")
async def get_image(
    image_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Get image details with signed thumbnail URL."""
    image = db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        tenant_column_filter(ImageMetadata, tenant),
    ).first()

    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    # Get tags
    active_tag_type = get_tenant_setting(db, tenant.id, 'active_machine_tag_type', default='siglip')
    tags = db.query(MachineTag).filter(
        MachineTag.asset_id == image.asset_id,
        tenant_column_filter(MachineTag, tenant)
    ).all()

    # Get permatags
    permatags = db.query(Permatag).filter(
        Permatag.asset_id == image.asset_id,
        tenant_column_filter(Permatag, tenant),
    ).all()

    # Load keyword info for all tags
    keyword_ids = set()
    for tag in tags:
        keyword_ids.add(tag.keyword_id)
    for permatag in permatags:
        keyword_ids.add(permatag.keyword_id)

    # Build keyword lookup map
    keywords_map = {}
    if keyword_ids:
        from zoltag.models.config import KeywordCategory
        keywords_data = db.query(
            Keyword.id,
            Keyword.keyword,
            KeywordCategory.name
        ).join(
            KeywordCategory, Keyword.category_id == KeywordCategory.id
        ).filter(
            Keyword.id.in_(keyword_ids)
        ).all()
        for kw_id, kw_name, cat_name in keywords_data:
            keywords_map[kw_id] = {"keyword": kw_name, "category": cat_name}

    tags_by_type = {}
    for tag in tags:
        kw_info = keywords_map.get(tag.keyword_id, {"keyword": "unknown", "category": "unknown"})
        tags_by_type.setdefault(tag.tag_type, []).append({
            "keyword": kw_info["keyword"],
            "category": kw_info["category"],
            "confidence": round(tag.confidence, 2),
            "created_at": tag.created_at.isoformat() if tag.created_at else None
        })
    machine_tags_list = tags_by_type.get(active_tag_type, [])
    permatags_list = []
    for p in permatags:
        kw_info = keywords_map.get(p.keyword_id, {"keyword": "unknown", "category": "unknown"})
        permatags_list.append({
            "id": p.id,
            "keyword": kw_info["keyword"],
            "category": kw_info["category"],
            "signum": p.signum,
            "created_at": p.created_at.isoformat() if p.created_at else None
        })

    calculated_tags = calculate_tags(machine_tags_list, permatags_list)
    reviewed_at = db.query(func.max(Permatag.created_at)).filter(
        Permatag.asset_id == image.asset_id,
        tenant_column_filter(Permatag, tenant),
    ).scalar()

    storage_info = _resolve_storage_or_409(image=image, tenant=tenant, db=db)
    return {
        "id": image.id,
        "asset_id": storage_info.asset_id,
        "filename": image.filename,
        "width": image.width,
        "height": image.height,
        "format": image.format,
        "file_size": image.file_size,
        "dropbox_path": storage_info.source_key,
        "source_provider": storage_info.source_provider,
        "source_key": storage_info.source_key,
        "source_rev": storage_info.source_rev,
        "source_url": _build_source_url(storage_info, tenant, image),
        "camera_make": image.camera_make,
        "camera_model": image.camera_model,
        "lens_model": image.lens_model,
        "iso": image.iso,
        "aperture": image.aperture,
        "shutter_speed": image.shutter_speed,
        "focal_length": image.focal_length,
        "gps_latitude": image.gps_latitude,
        "gps_longitude": image.gps_longitude,
        "capture_timestamp": image.capture_timestamp.isoformat() if image.capture_timestamp else None,
        "modified_time": image.modified_time.isoformat() if image.modified_time else None,
        "created_at": image.created_at.isoformat() if image.created_at else None,
        "perceptual_hash": image.perceptual_hash,
        "thumbnail_path": storage_info.thumbnail_key,
        "thumbnail_url": storage_info.thumbnail_url,
        "media_type": (storage_info.asset.media_type if storage_info.asset else None) or "image",
        "mime_type": storage_info.asset.mime_type if storage_info.asset else None,
        "duration_ms": storage_info.asset.duration_ms if storage_info.asset else None,
        "rating": image.rating,
        "reviewed_at": reviewed_at.isoformat() if reviewed_at else None,
        "tags": machine_tags_list,
        "machine_tags_by_type": tags_by_type,
        "permatags": permatags_list,
        "calculated_tags": calculated_tags,
        "exif_data": image.exif_data,
        "dropbox_properties": image.dropbox_properties,
    }


@router.get("/images/{image_id}/asset", response_model=dict, operation_id="get_image_asset")
async def get_image_asset(
    image_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    """Get resolved asset info for an image, with fallback to image_metadata fields."""
    image = db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        tenant_column_filter(ImageMetadata, tenant),
    ).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    storage_info = _resolve_storage_or_409(image=image, tenant=tenant, db=db)
    asset = storage_info.asset

    return {
        "image_id": image.id,
        "asset_id": storage_info.asset_id,
        "resolved_from": "assets" if asset else "image_metadata_fallback",
        "thumbnail_path": storage_info.thumbnail_key,
        "thumbnail_url": storage_info.thumbnail_url,
        "source_provider": storage_info.source_provider,
        "source_key": storage_info.source_key,
        "source_rev": storage_info.source_rev,
        "source_url": _build_source_url(storage_info, tenant, image),
        "filename": asset.filename if asset else image.filename,
        "media_type": (asset.media_type if asset else None) or "image",
        "mime_type": asset.mime_type if asset else None,
        "width": asset.width if asset and asset.width is not None else image.width,
        "height": asset.height if asset and asset.height is not None else image.height,
        "duration_ms": asset.duration_ms if asset else None,
    }


@router.get("/assets/{asset_id}", response_model=dict, operation_id="get_asset")
async def get_asset(
    asset_id: UUID,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    """Get canonical asset details for a tenant."""
    asset = db.query(Asset).filter(
        Asset.id == asset_id,
        tenant_column_filter(Asset, tenant),
    ).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    linked_image_ids = [
        row[0]
        for row in db.query(ImageMetadata.id)
        .filter(
            tenant_column_filter(ImageMetadata, tenant),
            ImageMetadata.asset_id == asset.id,
        )
        .order_by(ImageMetadata.id.asc())
        .limit(25)
        .all()
    ]

    return {
        "id": str(asset.id),
        "tenant_id": asset.tenant_id,
        "filename": asset.filename,
        "source_provider": asset.source_provider,
        "source_key": asset.source_key,
        "source_rev": asset.source_rev,
        "source_url": _build_source_url(asset, tenant, image=None),
        "thumbnail_key": asset.thumbnail_key,
        "thumbnail_url": tenant.get_thumbnail_url(settings, asset.thumbnail_key),
        "media_type": asset.media_type,
        "mime_type": asset.mime_type,
        "width": asset.width,
        "height": asset.height,
        "duration_ms": asset.duration_ms,
        "linked_image_ids": linked_image_ids,
    }


@router.delete("/images/{image_id}", response_model=dict, operation_id="delete_image")
async def delete_image(
    image_id: int,
    _current_user: UserProfile = Depends(require_tenant_permission_from_header("tenant.settings.manage")),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    """Delete an asset image and related tenant-scoped records."""
    image = db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        tenant_column_filter(ImageMetadata, tenant),
    ).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    asset_id = image.asset_id
    asset = None
    derivative_keys = []
    source_provider = None
    source_key = None
    thumbnail_key = None

    if asset_id is not None:
        asset = db.query(Asset).filter(
            Asset.id == asset_id,
            tenant_column_filter(Asset, tenant),
        ).first()
        if asset:
            source_provider = (asset.source_provider or "").strip().lower() or None
            source_key = (asset.source_key or "").strip() or None
            thumbnail_key = (asset.thumbnail_key or "").strip() or None

        derivative_rows = db.query(AssetDerivative).filter(
            AssetDerivative.asset_id == asset_id
        ).all()
        derivative_keys = [
            (row.storage_key or "").strip()
            for row in derivative_rows
            if (row.storage_key or "").strip()
        ]

        db.query(Permatag).filter(
            tenant_column_filter(Permatag, tenant),
            Permatag.asset_id == asset_id,
        ).delete(synchronize_session=False)
        db.query(MachineTag).filter(
            tenant_column_filter(MachineTag, tenant),
            MachineTag.asset_id == asset_id,
        ).delete(synchronize_session=False)
        db.query(ImageEmbedding).filter(
            tenant_column_filter(ImageEmbedding, tenant),
            ImageEmbedding.asset_id == asset_id,
        ).delete(synchronize_session=False)
        db.query(PhotoListItem).filter(
            PhotoListItem.asset_id == asset_id
        ).delete(synchronize_session=False)
        db.query(AssetDerivative).filter(
            AssetDerivative.asset_id == asset_id
        ).delete(synchronize_session=False)

    db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        tenant_column_filter(ImageMetadata, tenant),
    ).delete(synchronize_session=False)
    if asset is not None:
        db.query(Asset).filter(
            Asset.id == asset_id,
            tenant_column_filter(Asset, tenant),
        ).delete(synchronize_session=False)
    db.commit()

    deleted_objects = []
    storage_delete_errors = []

    def _delete_blob(bucket_name: str, key: Optional[str]) -> None:
        normalized_key = (key or "").strip()
        if not bucket_name or not normalized_key:
            return
        try:
            bucket = storage_client.bucket(bucket_name)
            blob = bucket.blob(normalized_key)
            blob.delete()
            deleted_objects.append(f"{bucket_name}/{normalized_key}")
        except Exception as exc:  # pragma: no cover - best effort cleanup
            storage_delete_errors.append(f"{bucket_name}/{normalized_key}: {exc}")

    try:
        storage_client = storage.Client(project=settings.gcp_project_id)
        if source_provider in ("managed", "gcs", "google_cloud_storage"):
            _delete_blob(tenant.get_storage_bucket(settings), source_key)
        _delete_blob(tenant.get_thumbnail_bucket(settings), thumbnail_key)
        for derivative_key in derivative_keys:
            _delete_blob(tenant.get_storage_bucket(settings), derivative_key)
    except Exception as exc:  # pragma: no cover - best effort cleanup
        storage_delete_errors.append(f"storage client init failed: {exc}")

    return {
        "status": "deleted",
        "tenant_id": tenant.id,
        "image_id": image_id,
        "asset_id": str(asset_id) if asset_id is not None else None,
        "deleted_storage_objects": deleted_objects,
        "storage_delete_errors": storage_delete_errors,
    }
