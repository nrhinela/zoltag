"""People management and tagging endpoints."""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from photocat.dependencies import get_db, get_tenant
from photocat.tenant import Tenant
from photocat.metadata import Person, ImageMetadata, MachineTag
from photocat.models.config import Keyword, KeywordCategory, PersonCategory
from photocat.settings import settings

router = APIRouter(prefix="/api/v1/people", tags=["people"])


# ============================================================================
# Request/Response Models
# ============================================================================

class PersonResponse(BaseModel):
    """Response model for a person."""
    id: int
    name: str
    instagram_url: Optional[str] = None
    person_category: str
    keyword_id: Optional[int] = None
    aliases: Optional[List[str]] = None
    tag_count: int = 0
    image_count: int = 0
    created_at: str = ""
    updated_at: str = ""

    class Config:
        from_attributes = True


class PersonCreateRequest(BaseModel):
    """Request to create a new person."""
    name: str = Field(..., min_length=1, max_length=255)
    instagram_url: Optional[str] = Field(None, max_length=512)
    person_category: str = Field(default="people_in_scene", regex="^[a-z_]+$")


class PersonUpdateRequest(BaseModel):
    """Request to update a person."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    instagram_url: Optional[str] = Field(None, max_length=512)
    person_category: Optional[str] = Field(None, regex="^[a-z_]+$")


class PersonCategoryResponse(BaseModel):
    """Response model for a person category."""
    id: int
    name: str
    display_name: str
    people_count: int = 0
    created_at: str = ""

    class Config:
        from_attributes = True


class PersonStatsResponse(BaseModel):
    """Statistics for a person."""
    id: int
    name: str
    total_images: int = 0
    manual_tags: int = 0
    detected_faces: int = 0
    last_tagged_at: Optional[str] = None


# ============================================================================
# People CRUD Endpoints
# ============================================================================

@router.post("/", response_model=PersonResponse)
async def create_person(
    request: PersonCreateRequest,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Create a new person for tagging.

    Creates a Person record and automatically creates a corresponding Keyword
    entry so people integrate with the existing tagging infrastructure.
    """
    # Check if person already exists
    existing = db.query(Person).filter(
        Person.tenant_id == tenant.id,
        Person.name == request.name
    ).first()

    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Person '{request.name}' already exists for this tenant"
        )

    try:
        # Create person record
        person = Person(
            tenant_id=tenant.id,
            name=request.name,
            instagram_url=request.instagram_url,
            person_category=request.person_category
        )
        db.add(person)
        db.flush()  # Get person.id before creating keyword

        # Find or create keyword category for this person category
        keyword_cat = db.query(KeywordCategory).filter(
            KeywordCategory.tenant_id == tenant.id,
            KeywordCategory.is_people_category == True,
            # TODO: Join with PersonCategory to filter by category type
        ).first()

        if not keyword_cat:
            # Create keyword category for people
            keyword_cat = KeywordCategory(
                tenant_id=tenant.id,
                name=f"people_{request.person_category}",
                is_people_category=True,
                sort_order=0
            )
            db.add(keyword_cat)
            db.flush()

        # Create keyword for this person
        keyword = Keyword(
            tenant_id=tenant.id,
            category_id=keyword_cat.id,
            keyword=request.name,
            person_id=person.id,
            tag_type="person"
        )
        db.add(keyword)
        db.commit()
        db.refresh(person)

        return PersonResponse(
            id=person.id,
            name=person.name,
            instagram_url=person.instagram_url,
            person_category=person.person_category,
            keyword_id=keyword.id,
            created_at=person.created_at.isoformat() if person.created_at else "",
            updated_at=person.updated_at.isoformat() if person.updated_at else ""
        )

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/", response_model=List[PersonResponse])
async def list_people(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    person_category: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500)
):
    """List all people for a tenant."""
    query = db.query(Person).filter(Person.tenant_id == tenant.id)

    if person_category:
        query = query.filter(Person.person_category == person_category)

    people = query.order_by(Person.name).offset(skip).limit(limit).all()

    results = []
    for person in people:
        # Get tag count
        tag_count = db.query(MachineTag).filter(
            MachineTag.keyword_id == person.keyword.id if person.keyword else -1
        ).count() if person.keyword else 0

        results.append(PersonResponse(
            id=person.id,
            name=person.name,
            instagram_url=person.instagram_url,
            person_category=person.person_category,
            keyword_id=person.keyword.id if person.keyword else None,
            tag_count=tag_count,
            created_at=person.created_at.isoformat() if person.created_at else "",
            updated_at=person.updated_at.isoformat() if person.updated_at else ""
        ))

    return results


@router.get("/{person_id}", response_model=PersonResponse)
async def get_person(
    person_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Get details for a specific person."""
    person = db.query(Person).filter(
        Person.id == person_id,
        Person.tenant_id == tenant.id
    ).first()

    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    tag_count = db.query(MachineTag).filter(
        MachineTag.keyword_id == person.keyword.id if person.keyword else -1
    ).count() if person.keyword else 0

    return PersonResponse(
        id=person.id,
        name=person.name,
        instagram_url=person.instagram_url,
        person_category=person.person_category,
        keyword_id=person.keyword.id if person.keyword else None,
        tag_count=tag_count,
        aliases=person.aliases,
        created_at=person.created_at.isoformat() if person.created_at else "",
        updated_at=person.updated_at.isoformat() if person.updated_at else ""
    )


@router.put("/{person_id}", response_model=PersonResponse)
async def update_person(
    person_id: int,
    request: PersonUpdateRequest,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Update a person's details."""
    person = db.query(Person).filter(
        Person.id == person_id,
        Person.tenant_id == tenant.id
    ).first()

    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    try:
        # Update person fields
        if request.name is not None:
            person.name = request.name
            # Also update the keyword if it exists
            if person.keyword:
                person.keyword.keyword = request.name

        if request.instagram_url is not None:
            person.instagram_url = request.instagram_url

        if request.person_category is not None:
            person.person_category = request.person_category

        db.commit()
        db.refresh(person)

        tag_count = db.query(MachineTag).filter(
            MachineTag.keyword_id == person.keyword.id if person.keyword else -1
        ).count() if person.keyword else 0

        return PersonResponse(
            id=person.id,
            name=person.name,
            instagram_url=person.instagram_url,
            person_category=person.person_category,
            keyword_id=person.keyword.id if person.keyword else None,
            tag_count=tag_count,
            created_at=person.created_at.isoformat() if person.created_at else "",
            updated_at=person.updated_at.isoformat() if person.updated_at else ""
        )

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{person_id}")
async def delete_person(
    person_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Delete a person and associated keyword/tags."""
    person = db.query(Person).filter(
        Person.id == person_id,
        Person.tenant_id == tenant.id
    ).first()

    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    try:
        # Delete associated keyword (cascade will delete related tags)
        if person.keyword:
            db.delete(person.keyword)

        # Delete person
        db.delete(person)
        db.commit()

        return {"status": "deleted", "person_id": person_id}

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Person Statistics & Details
# ============================================================================

@router.get("/{person_id}/stats", response_model=PersonStatsResponse)
async def get_person_stats(
    person_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Get statistics for a person (how many images tagged, etc.)."""
    person = db.query(Person).filter(
        Person.id == person_id,
        Person.tenant_id == tenant.id
    ).first()

    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    # Count tags if keyword exists
    tag_count = 0
    if person.keyword:
        tag_count = db.query(MachineTag).filter(
            MachineTag.keyword_id == person.keyword.id
        ).count()

    return PersonStatsResponse(
        id=person.id,
        name=person.name,
        total_images=tag_count,
        manual_tags=0,  # TODO: Distinguish by tag_type
        detected_faces=0  # TODO: Implement face detection
    )


# ============================================================================
# Helper function for other routers
# ============================================================================

def get_or_create_person_keyword(
    db: Session,
    tenant_id: str,
    person_id: int
) -> Optional[Keyword]:
    """Get person's keyword, creating it if missing."""
    person = db.query(Person).filter(
        Person.id == person_id,
        Person.tenant_id == tenant_id
    ).first()

    if not person:
        return None

    # If keyword already exists, return it
    if person.keyword:
        return person.keyword

    # Create keyword if missing
    keyword_cat = db.query(KeywordCategory).filter(
        KeywordCategory.tenant_id == tenant_id,
        KeywordCategory.is_people_category == True
    ).first()

    if not keyword_cat:
        # Create people category
        keyword_cat = KeywordCategory(
            tenant_id=tenant_id,
            name="people",
            is_people_category=True
        )
        db.add(keyword_cat)
        db.flush()

    keyword = Keyword(
        tenant_id=tenant_id,
        category_id=keyword_cat.id,
        keyword=person.name,
        person_id=person.id,
        tag_type="person"
    )
    db.add(keyword)
    db.commit()

    return keyword
