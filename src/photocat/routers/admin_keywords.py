"""Router for keyword and category management endpoints."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from photocat.auth.dependencies import require_tenant_role_from_header
from photocat.dependencies import get_db, get_tenant
from photocat.metadata import Person
from photocat.models.config import KeywordCategory, Keyword
from photocat.tenant import Tenant

router = APIRouter(
    prefix="/api/v1/admin/keywords",
    tags=["admin-keywords"],
    dependencies=[Depends(require_tenant_role_from_header("admin"))],
)


def _normalize_instagram_url(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _load_people_by_id(db: Session, tenant_id: str, person_ids: list[int]) -> dict[int, Person]:
    if not person_ids:
        return {}
    people = db.query(Person).filter(
        Person.tenant_id == tenant_id,
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
            Person.tenant_id == tenant.id
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

    person = Person(
        tenant_id=tenant.id,
        name=name.strip(),
        instagram_url=instagram_url
    )
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


# ============================================================================
# Keyword Category Endpoints
# ============================================================================

@router.get("/categories", response_model=list)
async def list_keyword_categories(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """List all keyword categories for a tenant."""
    categories = db.query(KeywordCategory).filter(
        KeywordCategory.tenant_id == tenant.id
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
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Create a new keyword category."""
    if not category_data.get("name"):
        raise HTTPException(status_code=400, detail="name is required")

    # Get max sort_order for this tenant
    max_sort = db.query(func.max(KeywordCategory.sort_order)).filter(
        KeywordCategory.tenant_id == tenant.id
    ).scalar() or -1

    slug = _normalize_slug(category_data.get("slug"))

    category = KeywordCategory(
        tenant_id=tenant.id,
        name=category_data["name"],
        slug=slug,
        parent_id=category_data.get("parent_id"),
        is_people_category=category_data.get("is_people_category", False),
        is_attribution=category_data.get("is_attribution", False),
        sort_order=category_data.get("sort_order", max_sort + 1)
    )

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
    db: Session = Depends(get_db)
):
    """Update a keyword category."""
    category = db.query(KeywordCategory).filter(KeywordCategory.id == category_id).first()
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
    db: Session = Depends(get_db)
):
    """Delete a keyword category and all its keywords."""
    category = db.query(KeywordCategory).filter(KeywordCategory.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    # Delete all keywords in this category
    db.query(Keyword).filter(Keyword.category_id == category_id).delete()

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
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """List all keywords in a category."""
    keywords = db.query(Keyword).filter(
        Keyword.category_id == category_id,
        Keyword.tenant_id == tenant.id
    ).order_by(Keyword.sort_order).all()

    person_ids = [kw.person_id for kw in keywords if kw.person_id]
    people_by_id = _load_people_by_id(db, tenant.id, person_ids)

    return [
        _serialize_keyword(kw, people_by_id.get(kw.person_id))
        for kw in keywords
    ]


@router.post("/categories/{category_id}/keywords", response_model=dict)
async def create_keyword(
    category_id: int,
    keyword_data: dict,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Create a new keyword in a category."""
    if not keyword_data.get("keyword"):
        raise HTTPException(status_code=400, detail="keyword is required")

    # Verify category exists
    category = db.query(KeywordCategory).filter(
        KeywordCategory.id == category_id,
        KeywordCategory.tenant_id == tenant.id
    ).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    # Get max sort_order for this category
    max_sort = db.query(func.max(Keyword.sort_order)).filter(
        Keyword.category_id == category_id,
        Keyword.tenant_id == tenant.id
    ).scalar() or -1

    person = None
    person_payload = keyword_data.get("person")
    if person_payload is not None:
        if not category.is_people_category:
            raise HTTPException(status_code=400, detail="person is only allowed for people categories")
        person = _upsert_person(db, tenant, person_payload)
        _ensure_person_not_linked(db, person)

    keyword = Keyword(
        tenant_id=tenant.id,
        category_id=category_id,
        keyword=keyword_data["keyword"],
        prompt=keyword_data.get("prompt", ""),
        sort_order=keyword_data.get("sort_order", max_sort + 1),
        tag_type="person" if category.is_people_category else "keyword",
        person_id=person.id if person else None
    )

    db.add(keyword)
    db.commit()
    db.refresh(keyword)

    return _serialize_keyword(keyword, person)


@router.put("/{keyword_id}", response_model=dict)
async def update_keyword(
    keyword_id: int,
    keyword_data: dict,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Update a keyword."""
    keyword = db.query(Keyword).filter(
        Keyword.id == keyword_id,
        Keyword.tenant_id == tenant.id
    ).first()
    if not keyword:
        raise HTTPException(status_code=404, detail="Keyword not found")

    target_category_id = keyword_data.get("category_id", keyword.category_id)
    category = db.query(KeywordCategory).filter(
        KeywordCategory.id == target_category_id,
        KeywordCategory.tenant_id == tenant.id
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
            Person.tenant_id == tenant.id
        ).first()

    return _serialize_keyword(keyword, person)


@router.delete("/{keyword_id}", response_model=dict)
async def delete_keyword(
    keyword_id: int,
    db: Session = Depends(get_db)
):
    """Delete a keyword."""
    keyword = db.query(Keyword).filter(Keyword.id == keyword_id).first()
    if not keyword:
        raise HTTPException(status_code=404, detail="Keyword not found")

    db.delete(keyword)
    db.commit()

    return {"status": "deleted", "keyword_id": keyword_id}
