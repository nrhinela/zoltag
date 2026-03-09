"""Router for keyword and category management endpoints."""

from datetime import datetime
import json
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from zoltag.auth.dependencies import require_tenant_permission_from_header
from zoltag.dependencies import get_db, get_tenant
from zoltag.metadata import Person
from zoltag.models.config import KeywordCategory, Keyword
from zoltag.settings import settings
from zoltag.tenant import Tenant
from zoltag.tenant_scope import assign_tenant_scope, tenant_column_filter

router = APIRouter(
    prefix="/api/v1/admin/keywords",
    tags=["admin-keywords"],
)


def _normalize_instagram_url(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _load_people_by_id(db: Session, tenant: Tenant, person_ids: list[int]) -> dict[int, Person]:
    if not person_ids:
        return {}
    people = db.query(Person).filter(
        tenant_column_filter(Person, tenant),
        Person.id.in_(person_ids)
    ).all()
    return {person.id: person for person in people}


def _serialize_keyword(keyword: Keyword, person: Person | None = None) -> dict:
    return {
        "id": keyword.id,
        "category_id": keyword.category_id,
        "keyword": keyword.keyword,
        "prompt": keyword.prompt,
        "sort_order": keyword.sort_order,
        "tag_type": keyword.tag_type,
        "person_id": keyword.person_id,
        "person_name": person.name if person else None,
        "person_instagram_url": person.instagram_url if person else None,
    }


def _normalize_slug(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _upsert_person(
    db: Session,
    tenant: Tenant,
    payload: dict,
) -> Person:
    person_id = payload.get("id")
    name = payload.get("name")
    instagram_url = payload.get("instagram_url")
    if instagram_url is not None:
        instagram_url = _normalize_instagram_url(instagram_url)

    if person_id:
        person = db.query(Person).filter(
            Person.id == person_id,
            tenant_column_filter(Person, tenant),
        ).first()
        if not person:
            raise HTTPException(status_code=404, detail="Person not found")
        if name is not None:
            name = name.strip()
            if not name:
                raise HTTPException(status_code=400, detail="person.name cannot be empty")
            person.name = name
        if "instagram_url" in payload:
            person.instagram_url = instagram_url
        db.flush()
        return person

    if not isinstance(name, str) or not name.strip():
        raise HTTPException(status_code=400, detail="person.name is required")

    person = assign_tenant_scope(Person(
        name=name.strip(),
        instagram_url=instagram_url
    ), tenant)
    db.add(person)
    db.flush()
    return person


def _ensure_person_not_linked(db: Session, person: Person, keyword_id: int | None = None) -> None:
    query = db.query(Keyword).filter(Keyword.person_id == person.id)
    if keyword_id is not None:
        query = query.filter(Keyword.id != keyword_id)
    existing = query.first()
    if existing:
        raise HTTPException(status_code=409, detail="Person is already linked to another keyword")


class KeywordSetupWizardMessage(BaseModel):
    role: str = Field(..., max_length=20)
    content: str = Field(..., min_length=1, max_length=4000)


class KeywordSetupWizardRequest(BaseModel):
    messages: list[KeywordSetupWizardMessage] = Field(default_factory=list, max_length=40)


def _normalize_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _build_setup_wizard_prompt(
    tenant: Tenant,
    existing_categories: list[dict[str, Any]],
) -> str:
    existing_lines = [
        f"- {row.get('name')}" for row in existing_categories if _normalize_text(row.get("name"))
    ]
    existing_block = "\n".join(existing_lines) if existing_lines else "- (none yet)"
    return (
        "You are an onboarding assistant helping users define image-tagging categories and keywords.\n"
        "Primary behavior rules:\n"
        "1) First prompt the user to identify desired tagging categories.\n"
        "2) Ask about the user's images and purpose so category choices are fit-for-purpose.\n"
        "3) Explicitly ask whether photo attribution is important.\n"
        "4) Keep asking focused follow-up questions until the user says they are satisfied with the draft.\n"
        "5) Once there is enough info, provide a draft taxonomy (categories + keywords + descriptions).\n"
        "6) If the user asks for changes, revise and return an updated draft.\n"
        "7) Keep replies concise and practical.\n"
        "Output must be strict JSON with this shape:\n"
        "{"
        "\"stage\":\"questions|proposal\","
        "\"assistant_message\":\"string\","
        "\"photo_attribution_important\":true|false,"
        "\"categories\":["
        "{\"name\":\"string\",\"description\":\"string\",\"keywords\":[{\"keyword\":\"string\",\"description\":\"string\"}]}"
        "]"
        "}\n"
        "Output rules:\n"
        "- stage='questions' when gathering details, stage='proposal' when providing taxonomy.\n"
        "- Always include your best current draft in categories, even during stage='questions'.\n"
        "- When stage='proposal', include categories and keyword descriptions.\n"
        "- If photo_attribution_important=true, include category name exactly 'Photo Attribution'.\n"
        "- Avoid duplicate category names and duplicate keywords within category.\n"
        "- Category and keyword names should be short and readable.\n"
        "- Existing categories for this tenant (avoid duplicating unless user asks):\n"
        f"{existing_block}\n"
        f"Tenant ID: {tenant.id}"
    )


def _get_gemini_endpoint(model_name: str) -> str:
    mode = (settings.gemini_api_mode or "generativelanguage").lower()
    if mode == "vertex":
        return f"https://aiplatform.googleapis.com/v1/publishers/google/models/{model_name}:generateContent"
    return f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"


def _build_setup_wizard_generation_config() -> dict[str, Any]:
    mode = (settings.gemini_api_mode or "generativelanguage").lower()
    response_schema = {
        "type": "object",
        "properties": {
            "stage": {"type": "string", "enum": ["questions", "proposal"]},
            "assistant_message": {"type": "string"},
            "photo_attribution_important": {"type": "boolean"},
            "categories": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "description": {"type": "string"},
                        "keywords": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "keyword": {"type": "string"},
                                    "description": {"type": "string"},
                                },
                                "required": ["keyword", "description"],
                            },
                        },
                    },
                    "required": ["name", "keywords"],
                },
            },
        },
        "required": ["stage", "assistant_message", "photo_attribution_important", "categories"],
    }
    if mode == "vertex":
        return {
            "temperature": 0.25,
            "responseMimeType": "application/json",
        }
    return {
        "temperature": 0.25,
        "response_mime_type": "application/json",
        "response_schema": response_schema,
    }


def _sanitize_wizard_categories(raw_categories: Any) -> list[dict[str, Any]]:
    categories = raw_categories if isinstance(raw_categories, list) else []
    cleaned: list[dict[str, Any]] = []
    seen_categories: set[str] = set()
    for entry in categories:
        if not isinstance(entry, dict):
            continue
        category_name = _normalize_text(entry.get("name"))
        if not category_name:
            continue
        category_key = category_name.lower()
        if category_key in seen_categories:
            continue
        seen_categories.add(category_key)
        category_description = _normalize_text(entry.get("description"))
        raw_keywords = entry.get("keywords")
        keyword_rows = raw_keywords if isinstance(raw_keywords, list) else []
        cleaned_keywords: list[dict[str, str]] = []
        seen_keywords: set[str] = set()
        for keyword_entry in keyword_rows:
            if not isinstance(keyword_entry, dict):
                continue
            keyword_name = _normalize_text(keyword_entry.get("keyword"))
            if not keyword_name:
                continue
            keyword_key = keyword_name.lower()
            if keyword_key in seen_keywords:
                continue
            seen_keywords.add(keyword_key)
            keyword_description = _normalize_text(keyword_entry.get("description"))
            cleaned_keywords.append({
                "keyword": keyword_name,
                "description": keyword_description or "No description provided.",
            })
        cleaned.append({
            "name": category_name,
            "description": category_description,
            "keywords": cleaned_keywords,
        })
    return cleaned


def _format_setup_wizard_definition(categories: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for category in categories:
        category_name = _normalize_text(category.get("name"))
        if not category_name:
            continue
        lines.append(category_name)
        for keyword in category.get("keywords", []) or []:
            keyword_name = _normalize_text(keyword.get("keyword"))
            keyword_desc = _normalize_text(keyword.get("description")) or "No description provided."
            if not keyword_name:
                continue
            lines.append(f"{keyword_name}, {keyword_desc}")
        if not category.get("keywords"):
            lines.append("(no keywords yet)")
        lines.append("")
    return "\n".join(lines).strip()


# ============================================================================
# Setup Wizard Endpoint
# ============================================================================

@router.post("/setup-wizard", response_model=dict)
async def keyword_setup_wizard_turn(
    request: KeywordSetupWizardRequest,
    _editor=Depends(require_tenant_permission_from_header("keywords.write")),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    """Generate a guided setup-wizard response for category/keyword definitions."""
    api_key = settings.gemini_api_key
    model_name = settings.gemini_model
    if not api_key:
        raise HTTPException(status_code=500, detail="Gemini API key not configured.")

    existing_categories = db.query(KeywordCategory).filter(
        tenant_column_filter(KeywordCategory, tenant)
    ).order_by(
        KeywordCategory.sort_order,
        KeywordCategory.name
    ).all()
    existing_rows = [{"name": row.name} for row in existing_categories]
    prompt = _build_setup_wizard_prompt(tenant, existing_rows)

    messages = request.messages or []
    normalized_messages = [
        msg for msg in messages
        if _normalize_text(msg.content)
        and str(msg.role).strip().lower() in ("user", "assistant")
    ][-24:]

    contents: list[dict[str, Any]] = [{"role": "user", "parts": [{"text": prompt}]}]
    for message in normalized_messages:
        role = "model" if str(message.role).strip().lower() == "assistant" else "user"
        contents.append({"role": role, "parts": [{"text": _normalize_text(message.content)}]})

    if not normalized_messages:
        contents.append({
            "role": "user",
            "parts": [{"text": "Please begin the wizard now."}],
        })

    payload = {
        "contents": contents,
        "generationConfig": _build_setup_wizard_generation_config(),
    }
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": api_key,
    }
    url = _get_gemini_endpoint(model_name)

    try:
        async with httpx.AsyncClient(timeout=35.0) as client:
            response = await client.post(url, headers=headers, json=payload)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Gemini request failed: {exc}") from exc

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Gemini error: {response.text}")

    data = response.json()
    candidates = data.get("candidates") or []
    if not candidates:
        raise HTTPException(status_code=502, detail="Gemini returned no candidates.")
    parts = candidates[0].get("content", {}).get("parts", [])
    text = parts[0].get("text", "") if parts else ""
    if not text:
        raise HTTPException(status_code=502, detail="Gemini response missing content.")

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Gemini response was not valid JSON.") from exc

    stage = str(parsed.get("stage", "questions")).strip().lower()
    if stage not in ("questions", "proposal"):
        stage = "questions"
    assistant_message = _normalize_text(parsed.get("assistant_message")) or (
        "Tell me more about your images and how you plan to use them."
    )
    photo_attribution_important = bool(parsed.get("photo_attribution_important"))
    categories = _sanitize_wizard_categories(parsed.get("categories"))
    if photo_attribution_important:
        has_attr_category = any(
            _normalize_text(category.get("name")).lower() == "photo attribution"
            for category in categories
        )
        if not has_attr_category:
            categories.append({
                "name": "Photo Attribution",
                "description": "Track photographer, source, and usage credit details.",
                "keywords": [],
            })

    return {
        "stage": stage,
        "assistant_message": assistant_message,
        "photo_attribution_important": photo_attribution_important,
        "categories": categories,
        "formatted_definition": _format_setup_wizard_definition(categories),
    }


# ============================================================================
# Keyword Category Endpoints
# ============================================================================

@router.get("/categories", response_model=list)
async def list_keyword_categories(
    _viewer=Depends(require_tenant_permission_from_header("keywords.read")),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """List all keyword categories for a tenant."""
    categories = db.query(KeywordCategory).filter(
        tenant_column_filter(KeywordCategory, tenant)
    ).order_by(KeywordCategory.sort_order).all()

    return [{
        "id": cat.id,
        "tenant_id": cat.tenant_id,
        "name": cat.name,
        "slug": cat.slug,
        "parent_id": cat.parent_id,
        "is_people_category": cat.is_people_category,
        "is_attribution": cat.is_attribution,
        "sort_order": cat.sort_order,
        "keyword_count": db.query(Keyword).filter(Keyword.category_id == cat.id).count()
    } for cat in categories]


@router.post("/categories", response_model=dict)
async def create_keyword_category(
    category_data: dict,
    _editor=Depends(require_tenant_permission_from_header("keywords.write")),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Create a new keyword category."""
    if not category_data.get("name"):
        raise HTTPException(status_code=400, detail="name is required")

    # Get max sort_order for this tenant
    max_sort = db.query(func.max(KeywordCategory.sort_order)).filter(
        tenant_column_filter(KeywordCategory, tenant)
    ).scalar() or -1

    slug = _normalize_slug(category_data.get("slug"))

    category = assign_tenant_scope(KeywordCategory(
        name=category_data["name"],
        slug=slug,
        parent_id=category_data.get("parent_id"),
        is_people_category=category_data.get("is_people_category", False),
        is_attribution=category_data.get("is_attribution", False),
        sort_order=category_data.get("sort_order", max_sort + 1)
    ), tenant)

    db.add(category)
    db.commit()
    db.refresh(category)

    return {
        "id": category.id,
        "tenant_id": category.tenant_id,
        "name": category.name,
        "slug": category.slug,
        "parent_id": category.parent_id,
        "is_people_category": category.is_people_category,
        "is_attribution": category.is_attribution,
        "sort_order": category.sort_order
    }


@router.put("/categories/{category_id}", response_model=dict)
async def update_keyword_category(
    category_id: int,
    category_data: dict,
    _editor=Depends(require_tenant_permission_from_header("keywords.write")),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Update a keyword category."""
    category = db.query(KeywordCategory).filter(
        KeywordCategory.id == category_id,
        tenant_column_filter(KeywordCategory, tenant),
    ).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    if "name" in category_data:
        category.name = category_data["name"]
    if "slug" in category_data:
        category.slug = _normalize_slug(category_data.get("slug"))
    if "parent_id" in category_data:
        category.parent_id = category_data["parent_id"]
    if "is_people_category" in category_data:
        category.is_people_category = category_data["is_people_category"]
    if "sort_order" in category_data:
        category.sort_order = category_data["sort_order"]
    if "is_attribution" in category_data:
        category.is_attribution = category_data["is_attribution"]

    category.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(category)

    return {
        "id": category.id,
        "name": category.name,
        "slug": category.slug,
        "parent_id": category.parent_id,
        "is_people_category": category.is_people_category,
        "is_attribution": category.is_attribution,
        "sort_order": category.sort_order
    }


@router.delete("/categories/{category_id}", response_model=dict)
async def delete_keyword_category(
    category_id: int,
    _editor=Depends(require_tenant_permission_from_header("keywords.write")),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Delete a keyword category and all its keywords."""
    category = db.query(KeywordCategory).filter(
        KeywordCategory.id == category_id,
        tenant_column_filter(KeywordCategory, tenant),
    ).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    # Delete all keywords in this category
    db.query(Keyword).filter(
        Keyword.category_id == category_id,
        tenant_column_filter(Keyword, tenant),
    ).delete()

    # Delete the category
    db.delete(category)
    db.commit()

    return {"status": "deleted", "category_id": category_id}


# ============================================================================
# Keyword Endpoints
# ============================================================================

@router.get("/categories/{category_id}/keywords", response_model=list)
async def list_keywords_in_category(
    category_id: int,
    _viewer=Depends(require_tenant_permission_from_header("keywords.read")),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """List all keywords in a category."""
    keywords = db.query(Keyword).filter(
        Keyword.category_id == category_id,
        tenant_column_filter(Keyword, tenant)
    ).order_by(Keyword.sort_order).all()

    person_ids = [kw.person_id for kw in keywords if kw.person_id]
    people_by_id = _load_people_by_id(db, tenant, person_ids)

    return [
        _serialize_keyword(kw, people_by_id.get(kw.person_id))
        for kw in keywords
    ]


@router.post("/categories/{category_id}/keywords", response_model=dict)
async def create_keyword(
    category_id: int,
    keyword_data: dict,
    _editor=Depends(require_tenant_permission_from_header("keywords.write")),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Create a new keyword in a category."""
    if not keyword_data.get("keyword"):
        raise HTTPException(status_code=400, detail="keyword is required")

    # Verify category exists
    category = db.query(KeywordCategory).filter(
        KeywordCategory.id == category_id,
        tenant_column_filter(KeywordCategory, tenant),
    ).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    # Get max sort_order for this category
    max_sort = db.query(func.max(Keyword.sort_order)).filter(
        Keyword.category_id == category_id,
        tenant_column_filter(Keyword, tenant),
    ).scalar() or -1

    person = None
    person_payload = keyword_data.get("person")
    if person_payload is not None:
        if not category.is_people_category:
            raise HTTPException(status_code=400, detail="person is only allowed for people categories")
        person = _upsert_person(db, tenant, person_payload)
        _ensure_person_not_linked(db, person)

    keyword = assign_tenant_scope(Keyword(
        category_id=category_id,
        keyword=keyword_data["keyword"],
        prompt=keyword_data.get("prompt", ""),
        sort_order=keyword_data.get("sort_order", max_sort + 1),
        tag_type="person" if category.is_people_category else "keyword",
        person_id=person.id if person else None
    ), tenant)

    db.add(keyword)
    db.commit()
    db.refresh(keyword)

    return _serialize_keyword(keyword, person)


@router.put("/{keyword_id}", response_model=dict)
async def update_keyword(
    keyword_id: int,
    keyword_data: dict,
    _editor=Depends(require_tenant_permission_from_header("keywords.write")),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Update a keyword."""
    keyword = db.query(Keyword).filter(
        Keyword.id == keyword_id,
        tenant_column_filter(Keyword, tenant)
    ).first()
    if not keyword:
        raise HTTPException(status_code=404, detail="Keyword not found")

    target_category_id = keyword_data.get("category_id", keyword.category_id)
    category = db.query(KeywordCategory).filter(
        KeywordCategory.id == target_category_id,
        tenant_column_filter(KeywordCategory, tenant),
    ).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    if "keyword" in keyword_data:
        keyword.keyword = keyword_data["keyword"]
    if "prompt" in keyword_data:
        keyword.prompt = keyword_data["prompt"]
    if "sort_order" in keyword_data:
        keyword.sort_order = keyword_data["sort_order"]
    if "category_id" in keyword_data:
        keyword.category_id = keyword_data["category_id"]

    if category.is_people_category:
        keyword.tag_type = "person"
    else:
        keyword.tag_type = "keyword"

    person = None
    if "person" in keyword_data:
        person_payload = keyword_data.get("person")
        if not category.is_people_category:
            if person_payload is not None:
                raise HTTPException(status_code=400, detail="person is only allowed for people categories")
            keyword.person_id = None
        else:
            if person_payload is None:
                keyword.person_id = None
            else:
                person = _upsert_person(db, tenant, person_payload)
                _ensure_person_not_linked(db, person, keyword_id=keyword.id)
                keyword.person_id = person.id
    elif not category.is_people_category:
        keyword.person_id = None

    keyword.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(keyword)

    if keyword.person_id and person is None:
        person = db.query(Person).filter(
            Person.id == keyword.person_id,
            tenant_column_filter(Person, tenant),
        ).first()

    return _serialize_keyword(keyword, person)


@router.delete("/{keyword_id}", response_model=dict)
async def delete_keyword(
    keyword_id: int,
    _editor=Depends(require_tenant_permission_from_header("keywords.write")),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Delete a keyword."""
    keyword = db.query(Keyword).filter(
        Keyword.id == keyword_id,
        tenant_column_filter(Keyword, tenant),
    ).first()
    if not keyword:
        raise HTTPException(status_code=404, detail="Keyword not found")

    db.delete(keyword)
    db.commit()

    return {"status": "deleted", "keyword_id": keyword_id}
