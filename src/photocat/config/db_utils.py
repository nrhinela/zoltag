"""Database query utilities for common patterns.

This module consolidates repeated query patterns to reduce duplication
and improve maintainability across the application.
"""

from typing import Dict, List, Set
from sqlalchemy.orm import Session
from photocat.models.config import Keyword, KeywordCategory
from photocat.tenant_scope import tenant_column_filter_for_values


def load_keywords_map(
    db: Session,
    tenant_id: str,
    keyword_ids: Set[int],
) -> Dict[int, Dict]:
    """
    Load keyword name and category for multiple keyword IDs.

    Handles large lists by chunking to avoid database parameter limits.
    Returns dict with safe fallback for missing IDs.

    Args:
        db: Database session
        tenant_id: Tenant ID for filtering
        keyword_ids: Set of keyword IDs to load

    Returns:
        dict: {keyword_id -> {'keyword': str, 'category': str}}
    """
    if not keyword_ids:
        return {}

    # Chunk to avoid parameter limit (PostgreSQL ~32k, SQLite 999; chunk at 500 for safety)
    CHUNK_SIZE = 500
    keywords_data = {}
    keyword_list = list(keyword_ids)

    for i in range(0, len(keyword_list), CHUNK_SIZE):
        chunk = keyword_list[i : i + CHUNK_SIZE]
        rows = db.query(
            Keyword.id,
            Keyword.keyword,
            KeywordCategory.name
        ).join(
            KeywordCategory, Keyword.category_id == KeywordCategory.id
        ).filter(
            tenant_column_filter_for_values(Keyword, tenant_id),
            Keyword.id.in_(chunk)
        ).all()

        for kw_id, kw_name, cat_name in rows:
            keywords_data[kw_id] = {
                "keyword": kw_name,
                "category": cat_name,
            }

    return keywords_data


def load_keyword_info_by_name(
    db: Session,
    tenant_id: str,
    keyword_names: List[str],
) -> Dict[str, Dict]:
    """
    Load keyword info (id, category) by keyword string.

    Args:
        db: Database session
        tenant_id: Tenant ID for filtering
        keyword_names: List of keyword strings to look up

    Returns:
        dict: {keyword_name -> {'id': int, 'category': str}}
    """
    if not keyword_names:
        return {}

    keywords_data = db.query(
        Keyword.keyword,
        Keyword.id,
        KeywordCategory.name
    ).join(
        KeywordCategory, Keyword.category_id == KeywordCategory.id
    ).filter(
        tenant_column_filter_for_values(Keyword, tenant_id),
        Keyword.keyword.in_(keyword_names)
    ).all()

    return {
        kw_name: {"id": kw_id, "category": cat_name}
        for kw_name, kw_id, cat_name in keywords_data
    }


def format_machine_tags(tags, keywords_map: Dict[int, Dict]) -> List[Dict]:
    """
    Format machine tags for API response, skipping tags with missing keywords.

    Args:
        tags: List of MachineTag objects
        keywords_map: Dict from load_keywords_map()

    Returns:
        List of formatted tag dicts
    """
    return [
        {
            "keyword": keywords_map[tag.keyword_id]["keyword"],
            "category": keywords_map[tag.keyword_id]["category"],
            "confidence": tag.confidence,
            "model_name": tag.model_name,
        }
        for tag in tags
        if tag.keyword_id in keywords_map  # Only include tags with found keywords
    ]


def format_permatags(permatags, keywords_map: Dict[int, Dict]) -> List[Dict]:
    """
    Format permatags for API response.

    Args:
        permatags: List of Permatag objects
        keywords_map: Dict from load_keywords_map()

    Returns:
        List of formatted permatag dicts
    """
    return [
        {
            "keyword": keywords_map[pt.keyword_id]["keyword"],
            "category": keywords_map[pt.keyword_id]["category"],
            "notes": pt.notes,
            "created_at": pt.created_at.isoformat() if pt.created_at else None,
        }
        for pt in permatags
        if pt.keyword_id in keywords_map  # Only include permatags with found keywords
    ]
