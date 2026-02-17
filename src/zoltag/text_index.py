"""Denormalized per-asset text search index helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Optional
from uuid import UUID

import numpy as np
import sqlalchemy as sa
from sqlalchemy import and_, or_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from zoltag.list_visibility import LIST_VISIBILITY_SHARED
from zoltag.metadata import Asset, AssetNote, AssetTextIndex, ImageMetadata, Permatag
from zoltag.models.config import Keyword, PhotoList, PhotoListItem
from zoltag.settings import settings
from zoltag.tagging import get_tagger
from zoltag.tenant_scope import parse_tenant_id, tenant_column_filter_for_values


def _now_utc_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _normalize_uuid(raw_value: UUID | str | None, *, field_name: str) -> UUID:
    if isinstance(raw_value, UUID):
        return raw_value
    parsed = parse_tenant_id(str(raw_value or "").strip())
    if parsed is None:
        raise ValueError(f"{field_name} must be a valid UUID")
    return parsed


def _dedupe_non_empty(values: Iterable[str]) -> list[str]:
    seen = set()
    out: list[str] = []
    for value in values:
        text = str(value or "").strip()
        if not text:
            continue
        key = text.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(text)
    return out


def _keyword_pattern_phrases(keyword: str) -> list[str]:
    token = str(keyword or "").strip()
    if not token:
        return []
    human = token.replace("-", " ").replace("_", " ").strip()
    return _dedupe_non_empty([
        token,
        human,
        f"person performing {human}",
        f"person doing {human}",
        f"person in {human}",
    ])


def _chunk_text_for_embedding(text_value: str, *, max_words_per_chunk: int = 28) -> list[str]:
    words = [w for w in str(text_value or "").strip().split() if w]
    if not words:
        return []
    safe_window = max(8, int(max_words_per_chunk or 28))
    chunks: list[str] = []
    for idx in range(0, len(words), safe_window):
        chunk = " ".join(words[idx: idx + safe_window]).strip()
        if chunk:
            chunks.append(chunk)
    return chunks


def _embed_text_document(text_value: str) -> Optional[list[float]]:
    normalized = str(text_value or "").strip()
    if not normalized:
        return None

    tagger = get_tagger(model_type=settings.tagging_model)
    if not hasattr(tagger, "build_text_embeddings"):
        return None

    segments = _chunk_text_for_embedding(normalized)
    if not segments:
        return None

    _, text_embeddings = tagger.build_text_embeddings(
        [{"keyword": segment, "prompt": segment} for segment in segments]
    )
    if text_embeddings is None:
        return None

    if hasattr(text_embeddings, "detach"):
        arr = text_embeddings.detach().cpu().numpy()
    else:
        arr = np.asarray(text_embeddings, dtype=np.float32)
    arr = np.asarray(arr, dtype=np.float32)
    if arr.ndim == 1:
        arr = arr.reshape(1, -1)
    elif arr.ndim > 2:
        arr = arr.reshape(arr.shape[0], -1)
    if arr.size == 0:
        return None
    arr = np.mean(arr, axis=0)
    norm = float(np.linalg.norm(arr))
    if norm <= 1e-12:
        return None
    arr = arr / norm
    return arr.tolist()


@dataclass
class AssetTextDocument:
    asset_id: UUID
    tenant_id: UUID
    search_text: str
    components: dict
    search_embedding: Optional[list[float]]


def build_asset_text_document(
    db: Session,
    *,
    tenant_id: UUID | str,
    asset_id: UUID | str,
    include_embeddings: bool = True,
) -> AssetTextDocument:
    tenant_uuid = _normalize_uuid(tenant_id, field_name="tenant_id")
    asset_uuid = _normalize_uuid(asset_id, field_name="asset_id")

    image_row = (
        db.query(ImageMetadata.filename)
        .filter(
            tenant_column_filter_for_values(ImageMetadata, str(tenant_uuid)),
            ImageMetadata.asset_id == asset_uuid,
        )
        .order_by(ImageMetadata.id.desc())
        .first()
    )
    asset_row = (
        db.query(Asset.filename)
        .filter(
            tenant_column_filter_for_values(Asset, str(tenant_uuid)),
            Asset.id == asset_uuid,
        )
        .first()
    )
    filename = (
        str((image_row[0] if image_row else "") or "").strip()
        or str((asset_row[0] if asset_row else "") or "").strip()
    )

    positive_tag_rows = (
        db.query(Keyword.keyword, Keyword.prompt)
        .join(
            Permatag,
            and_(
                Permatag.keyword_id == Keyword.id,
                tenant_column_filter_for_values(Permatag, str(tenant_uuid)),
                Permatag.asset_id == asset_uuid,
                Permatag.signum == 1,
            ),
        )
        .filter(tenant_column_filter_for_values(Keyword, str(tenant_uuid)))
        .all()
    )
    keywords = _dedupe_non_empty(row.keyword for row in positive_tag_rows)
    keyword_descriptions = _dedupe_non_empty(
        row.prompt for row in positive_tag_rows if str(row.prompt or "").strip()
    )

    keyword_phrases: list[str] = []
    for keyword in keywords:
        keyword_phrases.extend(_keyword_pattern_phrases(keyword))
    keyword_phrases = _dedupe_non_empty(keyword_phrases)

    notes_rows = (
        db.query(AssetNote.note_type, AssetNote.body)
        .filter(
            tenant_column_filter_for_values(AssetNote, str(tenant_uuid)),
            AssetNote.asset_id == asset_uuid,
        )
        .order_by(AssetNote.updated_at.desc(), AssetNote.created_at.desc())
        .all()
    )
    notes = _dedupe_non_empty(row.body for row in notes_rows)

    shared_list_rows = (
        db.query(PhotoList.title)
        .join(PhotoListItem, PhotoListItem.list_id == PhotoList.id)
        .filter(
            tenant_column_filter_for_values(PhotoList, str(tenant_uuid)),
            PhotoListItem.asset_id == asset_uuid,
            or_(
                PhotoList.visibility == LIST_VISIBILITY_SHARED,
                PhotoList.visibility.is_(None),
            ),
        )
        .order_by(PhotoList.title.asc())
        .all()
    )
    shared_list_names = _dedupe_non_empty(row.title for row in shared_list_rows)

    chunks: list[str] = []
    if filename:
        chunks.append(f"asset {filename}")
    if keywords:
        chunks.append(f"keywords: {', '.join(keywords)}")
    if keyword_descriptions:
        chunks.append(f"keyword descriptions: {'; '.join(keyword_descriptions)}")
    for phrase in keyword_phrases:
        chunks.append(phrase)
    if notes:
        chunks.append(f"notes: {'; '.join(notes)}")
    if shared_list_names:
        chunks.append(f"shared lists: {', '.join(shared_list_names)}")

    search_text = ". ".join(_dedupe_non_empty(chunks))
    search_embedding = _embed_text_document(search_text) if include_embeddings else None

    return AssetTextDocument(
        asset_id=asset_uuid,
        tenant_id=tenant_uuid,
        search_text=search_text,
        components={
            "filename": filename,
            "keywords": keywords,
            "keyword_descriptions": keyword_descriptions,
            "keyword_phrases": keyword_phrases,
            "notes": notes,
            "shared_lists": shared_list_names,
        },
        search_embedding=search_embedding,
    )


def upsert_asset_text_document(db: Session, *, document: AssetTextDocument) -> None:
    now = _now_utc_naive()
    values = {
        "asset_id": document.asset_id,
        "tenant_id": document.tenant_id,
        "search_text": document.search_text or "",
        "components": document.components or {},
        "search_embedding": document.search_embedding,
        "created_at": now,
        "updated_at": now,
    }

    if db.bind and db.bind.dialect.name == "postgresql":
        stmt = pg_insert(AssetTextIndex).values(**values)
        stmt = stmt.on_conflict_do_update(
            index_elements=[AssetTextIndex.asset_id],
            set_={
                "tenant_id": values["tenant_id"],
                "search_text": values["search_text"],
                "components": values["components"],
                "search_embedding": sa.func.coalesce(
                    stmt.excluded.search_embedding,
                    AssetTextIndex.search_embedding,
                ),
                "updated_at": values["updated_at"],
            },
        )
        db.execute(stmt)
        return

    row = db.query(AssetTextIndex).filter(AssetTextIndex.asset_id == document.asset_id).first()
    if row is None:
        db.add(AssetTextIndex(**values))
        return
    row.tenant_id = values["tenant_id"]
    row.search_text = values["search_text"]
    row.components = values["components"]
    if values["search_embedding"] is not None:
        row.search_embedding = values["search_embedding"]
    row.updated_at = values["updated_at"]


def rebuild_asset_text_index(
    db: Session,
    *,
    tenant_id: UUID | str,
    asset_id: UUID | str | None = None,
    limit: int | None = None,
    offset: int = 0,
    include_embeddings: bool = True,
    refresh: bool = False,
) -> dict:
    tenant_uuid = _normalize_uuid(tenant_id, field_name="tenant_id")
    safe_offset = max(0, int(offset or 0))
    safe_limit = None if limit is None else max(1, int(limit))
    refresh_mode = bool(refresh)

    if asset_id is not None:
        asset_ids = [_normalize_uuid(asset_id, field_name="asset_id")]
    else:
        query = db.query(ImageMetadata.asset_id).filter(
            tenant_column_filter_for_values(ImageMetadata, str(tenant_uuid)),
            ImageMetadata.asset_id.is_not(None),
        )
        if not refresh_mode:
            positive_keyword_update_exists = (
                db.query(Permatag.id)
                .filter(
                    tenant_column_filter_for_values(Permatag, str(tenant_uuid)),
                    Permatag.asset_id == ImageMetadata.asset_id,
                    Permatag.signum == 1,
                    Permatag.created_at > sa.func.coalesce(
                        AssetTextIndex.updated_at,
                        datetime(1970, 1, 1),
                    ),
                )
                .exists()
            )
            query = query.outerjoin(
                AssetTextIndex,
                and_(
                    AssetTextIndex.asset_id == ImageMetadata.asset_id,
                    tenant_column_filter_for_values(AssetTextIndex, str(tenant_uuid)),
                ),
            ).filter(
                or_(
                    AssetTextIndex.asset_id.is_(None),
                    positive_keyword_update_exists,
                )
            )
        query = query.group_by(ImageMetadata.asset_id).order_by(ImageMetadata.asset_id.asc()).offset(safe_offset)
        if safe_limit is not None:
            query = query.limit(safe_limit)
        asset_ids = [row.asset_id for row in query.all() if row.asset_id is not None]

    processed = 0
    failed = 0
    errors: list[str] = []
    for row_asset_id in asset_ids:
        try:
            document = build_asset_text_document(
                db,
                tenant_id=tenant_uuid,
                asset_id=row_asset_id,
                include_embeddings=include_embeddings,
            )
            upsert_asset_text_document(db, document=document)
            db.commit()
            processed += 1
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            failed += 1
            errors.append(f"{row_asset_id}: {exc}")

    return {
        "tenant_id": str(tenant_uuid),
        "processed": processed,
        "failed": failed,
        "offset": safe_offset,
        "limit": safe_limit,
        "include_embeddings": bool(include_embeddings),
        "refresh": refresh_mode,
        "errors": errors,
    }
