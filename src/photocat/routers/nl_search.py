"""Natural language search endpoint using Gemini to map queries to filters."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from photocat.dependencies import get_db, get_tenant
from photocat.metadata import Person
from photocat.models.config import Keyword, KeywordCategory
from photocat.settings import settings
from photocat.tenant import Tenant


router = APIRouter(prefix="/api/v1/search", tags=["search"])


class NLSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500)
    clarification: Optional[str] = Field(default=None, max_length=200)
    clarification_options: Optional[List[str]] = Field(default=None, max_length=12)


def _normalize(value: Optional[str]) -> str:
    return " ".join((value or "").strip().lower().split())


def _wants_quality_sort(query: str) -> bool:
    normalized = _normalize(query)
    if not normalized:
        return False
    phrases = [
        "top rated",
        "top-rated",
        "best rated",
        "highest rated",
        "high rated",
        "highest-rated",
        "best",
        "great",
        "good",
        "excellent",
        "amazing",
        "awesome",
        "beautiful",
        "stunning",
        "favorite",
        "favourite",
        "favorites",
        "favourites",
        "high quality",
        "quality",
    ]
    if any(phrase in normalized for phrase in phrases):
        return True
    tokens = set(normalized.split())
    return any(token in tokens for token in ("best", "great", "good", "excellent", "amazing", "awesome"))


def _build_vocab(db: Session, tenant_id: str) -> Dict[str, Any]:
    categories = db.query(
        KeywordCategory.id,
        KeywordCategory.name,
        KeywordCategory.is_people_category,
    ).filter(
        KeywordCategory.tenant_id == tenant_id
    ).order_by(
        KeywordCategory.sort_order,
        KeywordCategory.name,
    ).all()

    category_by_id = {row.id: row for row in categories}

    keyword_rows = db.query(
        Keyword.keyword,
        Keyword.category_id,
        Keyword.person_id,
    ).filter(
        Keyword.tenant_id == tenant_id
    ).order_by(
        Keyword.keyword
    ).all()

    category_keywords: Dict[str, List[str]] = {}
    people_keywords: List[Dict[str, str]] = []

    for keyword, category_id, person_id in keyword_rows:
        category_row = category_by_id.get(category_id)
        if not category_row:
            continue
        category_name = category_row.name
        category_keywords.setdefault(category_name, []).append(keyword)

        if person_id:
            people_keywords.append({
                "person_id": str(person_id),
                "keyword": keyword,
                "category": category_name,
            })

    people_rows = db.query(Person.id, Person.name).filter(
        Person.tenant_id == tenant_id
    ).order_by(Person.name).all()
    person_name_by_id = {str(person_id): name for person_id, name in people_rows}

    people_entries = []
    for entry in people_keywords:
        name = person_name_by_id.get(entry["person_id"])
        if not name:
            continue
        people_entries.append({
            "name": name,
            "keyword": entry["keyword"],
            "category": entry["category"],
        })

    return {
        "category_keywords": category_keywords,
        "people_entries": people_entries,
        "people_categories": [
            row.name for row in categories if row.is_people_category
        ],
    }


def _build_prompt(request: NLSearchRequest, vocab: Dict[str, Any]) -> str:
    clarifying = ""
    if request.clarification:
        options = ", ".join(request.clarification_options or [])
        clarifying = (
            f"\nUser clarification: {request.clarification}."
            + (f" Options were: {options}." if options else "")
        )

    instructions = (
        "You are a search assistant for PhotoCat. "
        "Convert the user's natural language query into JSON filters.\n"
        "Rules:\n"
        "- Use ONLY the categories, keywords, and people mappings provided.\n"
        "- If the request is ambiguous or missing a required match, set needs_clarification=true and ask one concise question with 2-6 options.\n"
        "- Otherwise set needs_clarification=false.\n"
        "- category_filters is a list of objects with {category, keywords, operator} where operator is AND or OR.\n"
        "- sort.field must be one of: relevance, photo_creation, processed, rating, image_id.\n"
        "- sort.direction must be asc or desc.\n"
        "- rating is either null or {operator: eq|gte|gt|is_null, value: 0-3 or null}.\n"
        "- reviewed is true, false, or null.\n"
        "- hide_zero_rating is boolean.\n"
        "- dropbox_path_prefix is a string or null.\n"
        "- Include people by using the mapped keyword in its category.\n"
        "- If the user asks for good/great/best/top-rated photos, prefer sort.field=rating with direction=desc.\n"
        "- If no quality is specified, default to sort.field=rating with direction=desc and hide_zero_rating=true.\n"
    )

    data_block = json.dumps({
        "categories": vocab.get("category_keywords", {}),
        "people": vocab.get("people_entries", []),
        "people_categories": vocab.get("people_categories", []),
    }, ensure_ascii=True)

    return (
        f"{instructions}\n"
        f"User query: {request.query}{clarifying}\n"
        f"DATA:\n{data_block}"
    )


def _get_gemini_endpoint(model_name: str) -> str:
    mode = (settings.gemini_api_mode or "generativelanguage").lower()
    if mode == "vertex":
        # Vertex AI API key (express mode) endpoint
        return f"https://aiplatform.googleapis.com/v1/publishers/google/models/{model_name}:generateContent"
    return f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"


def _build_generation_config() -> Dict[str, Any]:
    mode = (settings.gemini_api_mode or "generativelanguage").lower()
    if mode == "vertex":
        return {
            "temperature": 0.2,
            "responseMimeType": "application/json",
        }
    return {
        "temperature": 0.2,
        "response_mime_type": "application/json",
        "response_schema": {
            "type": "object",
            "properties": {
                "category_filters": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "category": {"type": "string"},
                            "keywords": {"type": "array", "items": {"type": "string"}},
                            "operator": {"type": "string"},
                        },
                        "required": ["category", "keywords"],
                    },
                },
                "rating": {
                    "type": ["object", "null"],
                    "properties": {
                        "operator": {"type": "string"},
                        "value": {"type": ["integer", "null"]},
                    },
                },
                "reviewed": {"type": ["boolean", "null"]},
                "hide_zero_rating": {"type": "boolean"},
                "dropbox_path_prefix": {"type": ["string", "null"]},
                "sort": {
                    "type": "object",
                    "properties": {
                        "field": {"type": "string"},
                        "direction": {"type": "string"},
                    },
                    "required": ["field", "direction"],
                },
                "needs_clarification": {"type": "boolean"},
                "question": {"type": ["string", "null"]},
                "options": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["category_filters", "sort", "needs_clarification"],
        },
    }


def _sanitize_response(payload: Dict[str, Any], vocab: Dict[str, Any]) -> Dict[str, Any]:
    category_keywords = vocab.get("category_keywords", {})
    category_lookup = { _normalize(name): name for name in category_keywords.keys() }
    keyword_lookup = {
        _normalize(cat): { _normalize(kw): kw for kw in kws }
        for cat, kws in category_keywords.items()
    }

    raw_filters = payload.get("category_filters", []) or []
    sanitized_filters = []
    for entry in raw_filters:
        raw_category = entry.get("category") if isinstance(entry, dict) else None
        if not raw_category:
            continue
        category_key = _normalize(str(raw_category))
        category_name = category_lookup.get(category_key)
        if not category_name:
            continue
        keywords = entry.get("keywords") if isinstance(entry, dict) else None
        if not isinstance(keywords, list):
            continue
        keyword_map = keyword_lookup.get(_normalize(category_name), {})
        cleaned_keywords = []
        for keyword in keywords:
            keyword_key = _normalize(str(keyword))
            if keyword_key in keyword_map:
                cleaned_keywords.append(keyword_map[keyword_key])
        if not cleaned_keywords:
            continue
        operator = str(entry.get("operator", "OR")).upper()
        if operator not in ("AND", "OR"):
            operator = "OR"
        sanitized_filters.append({
            "category": category_name,
            "keywords": cleaned_keywords,
            "operator": operator,
        })

    sort = payload.get("sort") or {}
    sort_field = str(sort.get("field", "relevance")).lower()
    if sort_field not in ("relevance", "photo_creation", "processed", "rating", "image_id"):
        sort_field = "relevance"
    sort_direction = str(sort.get("direction", "desc")).lower()
    if sort_direction not in ("asc", "desc"):
        sort_direction = "desc"

    rating = payload.get("rating")
    rating_out = None
    if isinstance(rating, dict):
        operator = str(rating.get("operator", "")).lower()
        value = rating.get("value")
        if operator in ("eq", "gte", "gt", "is_null"):
            if operator == "is_null":
                rating_out = {"operator": "is_null", "value": None}
            else:
                try:
                    int_value = int(value)
                except (TypeError, ValueError):
                    int_value = None
                if int_value is not None and 0 <= int_value <= 3:
                    rating_out = {"operator": operator, "value": int_value}

    reviewed = payload.get("reviewed")
    reviewed_out = reviewed if isinstance(reviewed, bool) else None

    hide_zero_rating = payload.get("hide_zero_rating")
    hide_zero_rating_out = bool(hide_zero_rating) if isinstance(hide_zero_rating, bool) else False

    dropbox_path_prefix = payload.get("dropbox_path_prefix")
    dropbox_path_prefix_out = (
        str(dropbox_path_prefix)
        if isinstance(dropbox_path_prefix, str) and dropbox_path_prefix.strip()
        else None
    )

    needs_clarification = bool(payload.get("needs_clarification"))
    question = payload.get("question")
    question_out = str(question) if isinstance(question, str) and question.strip() else None
    options = payload.get("options") if isinstance(payload.get("options"), list) else []
    options_out = [str(opt) for opt in options if opt is not None]

    return {
        "filters": {
            "category_filters": sanitized_filters,
            "rating": rating_out,
            "reviewed": reviewed_out,
            "hide_zero_rating": hide_zero_rating_out,
            "dropbox_path_prefix": dropbox_path_prefix_out,
        },
        "sort": {
            "field": sort_field,
            "direction": sort_direction,
        },
        "needs_clarification": needs_clarification,
        "question": question_out,
        "options": options_out,
    }


def _apply_quality_defaults(response: Dict[str, Any], query: str) -> Dict[str, Any]:
    if not query:
        return response
    if response.get("needs_clarification"):
        return response
    sort = response.get("sort") or {}
    filters = response.get("filters") or {}
    rating = filters.get("rating")
    sort_field = str(sort.get("field", "relevance")).lower()
    if sort_field == "relevance" and not rating:
        sort["field"] = "rating"
        sort["direction"] = "desc"
    if not filters.get("hide_zero_rating"):
        filters["hide_zero_rating"] = True
    response["sort"] = sort
    response["filters"] = filters
    return response


@router.post("/nl")
async def nl_search(
    request: NLSearchRequest,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    api_key = settings.gemini_api_key
    model_name = settings.gemini_model
    if not api_key:
        raise HTTPException(status_code=500, detail="Gemini API key not configured.")

    vocab = _build_vocab(db, tenant.id)
    prompt = _build_prompt(request, vocab)

    payload = {
        "contents": [
            {"role": "user", "parts": [{"text": prompt}]},
        ],
        "generationConfig": _build_generation_config(),
    }

    url = _get_gemini_endpoint(model_name)
    headers = {"Content-Type": "application/json"}
    params = {"key": api_key}

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, headers=headers, params=params, json=payload)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Gemini request failed: {exc}") from exc

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Gemini error: {response.text}")

    data = response.json()
    candidates = data.get("candidates") or []
    if not candidates:
        raise HTTPException(status_code=502, detail="Gemini returned no candidates.")
    parts = candidates[0].get("content", {}).get("parts", [])
    text = ""
    if parts:
        text = parts[0].get("text", "") or ""
    if not text:
        raise HTTPException(status_code=502, detail="Gemini response missing content.")

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Gemini response was not valid JSON.") from exc

    sanitized = _sanitize_response(parsed, vocab)
    return _apply_quality_defaults(sanitized, request.query)
