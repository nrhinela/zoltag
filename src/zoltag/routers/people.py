"""People management and tagging endpoints."""

from typing import List, Literal, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import distinct, func, case
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from zoltag.dependencies import get_db, get_tenant
from zoltag.tenant import Tenant
from zoltag.metadata import Asset, Person, PersonReferenceImage, Permatag
from zoltag.models.config import Keyword, KeywordCategory
from zoltag.tenant_scope import assign_tenant_scope, tenant_column_filter, tenant_column_filter_for_values

router = APIRouter(prefix="/api/v1/people", tags=["people"])


def _tenant_filter(model, tenant: Tenant | str):
    if isinstance(tenant, Tenant):
        return tenant_column_filter(model, tenant)
    return tenant_column_filter_for_values(model, tenant, tenant)


def _get_person_keyword(db: Session, tenant: Tenant | str, person_id: int) -> Optional[Keyword]:
    """Resolve the canonical keyword row backing a person tag.

    Prefer tag_type='person' rows, but fall back to any keyword linked to the
    person to support legacy data.
    """
    keyword = db.query(Keyword).filter(
        _tenant_filter(Keyword, tenant),
        Keyword.person_id == person_id,
        Keyword.tag_type == "person",
    ).first()
    if keyword:
        return keyword

    return db.query(Keyword).filter(
        _tenant_filter(Keyword, tenant),
        Keyword.person_id == person_id,
    ).order_by(Keyword.id.asc()).first()


def _count_person_tagged_images(db: Session, tenant: Tenant | str, keyword_id: int) -> int:
    """Count distinct assets tagged for this person within tenant scope.

    Counts only positive permatags attached to the person's keyword.
    """
    count = db.query(func.count(distinct(Permatag.asset_id))).filter(
        _tenant_filter(Permatag, tenant),
        Permatag.keyword_id == keyword_id,
        Permatag.signum == 1,
    ).scalar()
    return int(count or 0)


# ============================================================================
# Request/Response Models
# ============================================================================

class PersonResponse(BaseModel):
    """Response model for a person."""
    id: int
    name: str
    instagram_url: Optional[str] = None
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


class PersonUpdateRequest(BaseModel):
    """Request to update a person."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    instagram_url: Optional[str] = Field(None, max_length=512)


class PersonStatsResponse(BaseModel):
    """Statistics for a person."""
    id: int
    name: str
    total_images: int = 0
    manual_tags: int = 0
    detected_faces: int = 0
    last_tagged_at: Optional[str] = None


class PersonReferenceResponse(BaseModel):
    """Reference image metadata for a person."""

    id: str
    person_id: int
    source_type: Literal["upload", "asset"]
    source_asset_id: Optional[str] = None
    storage_key: Optional[str] = None
    is_active: bool = True
    face_count: int = 0
    quality_score: Optional[float] = None
    created_by: Optional[str] = None
    created_at: str = ""
    updated_at: str = ""


class PersonReferenceCreateRequest(BaseModel):
    """Create a person reference image from an upload or existing asset."""

    source_type: Literal["upload", "asset"]
    source_asset_id: Optional[str] = None
    storage_key: Optional[str] = Field(None, max_length=1024)
    is_active: bool = True
    face_count: int = Field(0, ge=0)
    quality_score: Optional[float] = None


def _serialize_reference(reference: PersonReferenceImage) -> PersonReferenceResponse:
    return PersonReferenceResponse(
        id=str(reference.id),
        person_id=reference.person_id,
        source_type=reference.source_type,
        source_asset_id=str(reference.source_asset_id) if reference.source_asset_id else None,
        storage_key=reference.storage_key,
        is_active=bool(reference.is_active),
        face_count=int(reference.face_count or 0),
        quality_score=reference.quality_score,
        created_by=str(reference.created_by) if reference.created_by else None,
        created_at=reference.created_at.isoformat() if reference.created_at else "",
        updated_at=reference.updated_at.isoformat() if reference.updated_at else "",
    )


def _get_person_for_tenant(db: Session, tenant: Tenant, person_id: int) -> Person:
    person = db.query(Person).filter(
        Person.id == person_id,
        tenant_column_filter(Person, tenant),
    ).first()
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    return person


# ============================================================================
# People CRUD Endpoints
# ============================================================================

@router.post("", response_model=PersonResponse)
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
        tenant_column_filter(Person, tenant),
        Person.name == request.name
    ).first()

    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Person '{request.name}' already exists for this tenant"
        )

    try:
        # Create person record
        person = assign_tenant_scope(Person(
            name=request.name,
            instagram_url=request.instagram_url
        ), tenant)
        db.add(person)
        db.flush()  # Get person.id before creating keyword

        # Find or create keyword category for people
        keyword_cat = db.query(KeywordCategory).filter(
            tenant_column_filter(KeywordCategory, tenant),
            KeywordCategory.is_people_category == True
        ).first()

        if not keyword_cat:
            # Create keyword category for people
            keyword_cat = assign_tenant_scope(KeywordCategory(
                name="people",
                is_people_category=True,
                sort_order=0
            ), tenant)
            db.add(keyword_cat)
            db.flush()

        # Create keyword for this person
        keyword = assign_tenant_scope(Keyword(
            category_id=keyword_cat.id,
            keyword=request.name,
            person_id=person.id,
            tag_type="person"
        ), tenant)
        db.add(keyword)
        db.commit()
        db.refresh(person)

        return PersonResponse(
            id=person.id,
            name=person.name,
            instagram_url=person.instagram_url,
            keyword_id=keyword.id,
            created_at=person.created_at.isoformat() if person.created_at else "",
            updated_at=person.updated_at.isoformat() if person.updated_at else ""
        )

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("", response_model=List[PersonResponse])
async def list_people(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500)
):
    """List all people for a tenant."""

    query = db.query(Person).filter(tenant_column_filter(Person, tenant))
    people = query.order_by(Person.name).offset(skip).limit(limit).all()
    if not people:
        return []

    person_ids = [person.id for person in people]

    # Resolve each person's canonical keyword in one pass:
    # prefer tag_type='person', else lowest keyword id for legacy rows.
    keyword_rows = db.query(
        Keyword.id,
        Keyword.person_id,
    ).filter(
        tenant_column_filter(Keyword, tenant),
        Keyword.person_id.in_(person_ids),
    ).order_by(
        Keyword.person_id.asc(),
        case((Keyword.tag_type == "person", 0), else_=1),
        Keyword.id.asc(),
    ).all()

    keyword_id_by_person: dict[int, int] = {}
    for keyword_id, person_id in keyword_rows:
        if person_id is None or person_id in keyword_id_by_person:
            continue
        keyword_id_by_person[person_id] = keyword_id

    keyword_ids = list(keyword_id_by_person.values())
    tag_count_by_keyword: dict[int, int] = {}
    if keyword_ids:
        tag_count_rows = db.query(
            Permatag.keyword_id,
            func.count(distinct(Permatag.asset_id)).label("tag_count"),
        ).filter(
            tenant_column_filter(Permatag, tenant),
            Permatag.keyword_id.in_(keyword_ids),
            Permatag.signum == 1,
        ).group_by(
            Permatag.keyword_id,
        ).all()
        tag_count_by_keyword = {
            keyword_id: int(tag_count or 0)
            for keyword_id, tag_count in tag_count_rows
        }

    results = []
    for person in people:
        keyword_id = keyword_id_by_person.get(person.id)
        tag_count = int(tag_count_by_keyword.get(keyword_id, 0)) if keyword_id else 0

        results.append(PersonResponse(
            id=person.id,
            name=person.name,
            instagram_url=person.instagram_url,
            keyword_id=keyword_id,
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
        tenant_column_filter(Person, tenant),
    ).first()

    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    # Get the keyword for this person
    keyword = _get_person_keyword(db, tenant, person.id)

    tag_count = 0
    keyword_id = None
    if keyword:
        keyword_id = keyword.id
        tag_count = _count_person_tagged_images(db, tenant, keyword.id)

    return PersonResponse(
        id=person.id,
        name=person.name,
        instagram_url=person.instagram_url,
        keyword_id=keyword_id,
        tag_count=tag_count,
        aliases=person.aliases,
        created_at=person.created_at.isoformat() if person.created_at else "",
        updated_at=person.updated_at.isoformat() if person.updated_at else ""
    )


@router.get("/{person_id}/references", response_model=List[PersonReferenceResponse])
async def list_person_references(
    person_id: int,
    include_inactive: bool = Query(False),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    """List reference images for a person."""
    _get_person_for_tenant(db, tenant, person_id)

    query = db.query(PersonReferenceImage).filter(
        tenant_column_filter(PersonReferenceImage, tenant),
        PersonReferenceImage.person_id == person_id,
    )
    if not include_inactive:
        query = query.filter(PersonReferenceImage.is_active.is_(True))
    references = query.order_by(PersonReferenceImage.created_at.desc()).all()
    return [_serialize_reference(reference) for reference in references]


@router.post("/{person_id}/references", response_model=PersonReferenceResponse)
async def create_person_reference(
    person_id: int,
    request: PersonReferenceCreateRequest,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    """Create a reference image for a person."""
    _get_person_for_tenant(db, tenant, person_id)

    source_type = (request.source_type or "").strip().lower()
    source_asset_id: UUID | None = None
    storage_key: str | None = None

    if source_type == "asset":
        if not request.source_asset_id:
            raise HTTPException(status_code=400, detail="source_asset_id is required when source_type='asset'")
        try:
            source_asset_id = UUID(request.source_asset_id)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="source_asset_id must be a valid UUID")

        asset = db.query(Asset).filter(
            tenant_column_filter(Asset, tenant),
            Asset.id == source_asset_id,
        ).first()
        if not asset:
            raise HTTPException(status_code=404, detail="Asset not found for tenant")
    elif source_type == "upload":
        storage_key = (request.storage_key or "").strip()
        if not storage_key:
            raise HTTPException(status_code=400, detail="storage_key is required when source_type='upload'")
    else:
        raise HTTPException(status_code=400, detail="source_type must be 'upload' or 'asset'")

    reference = assign_tenant_scope(
        PersonReferenceImage(
            person_id=person_id,
            source_type=source_type,
            source_asset_id=source_asset_id,
            storage_key=storage_key,
            is_active=bool(request.is_active),
            face_count=int(request.face_count or 0),
            quality_score=request.quality_score,
        ),
        tenant,
    )

    db.add(reference)
    db.commit()
    db.refresh(reference)
    return _serialize_reference(reference)


@router.delete("/{person_id}/references/{reference_id}")
async def delete_person_reference(
    person_id: int,
    reference_id: str,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    """Delete a reference image for a person."""
    _get_person_for_tenant(db, tenant, person_id)

    try:
        parsed_reference_id = UUID(reference_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="reference_id must be a valid UUID")

    reference = db.query(PersonReferenceImage).filter(
        tenant_column_filter(PersonReferenceImage, tenant),
        PersonReferenceImage.person_id == person_id,
        PersonReferenceImage.id == parsed_reference_id,
    ).first()
    if not reference:
        raise HTTPException(status_code=404, detail="Reference not found")

    db.delete(reference)
    db.commit()
    return {"status": "deleted", "person_id": person_id, "reference_id": reference_id}


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
        tenant_column_filter(Person, tenant),
    ).first()

    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    try:
        # Get the keyword for this person
        keyword = _get_person_keyword(db, tenant, person.id)

        # Update person fields
        if request.name is not None:
            person.name = request.name
            # Also update the keyword if it exists
            if keyword:
                keyword.keyword = request.name

        if request.instagram_url is not None:
            person.instagram_url = request.instagram_url

        db.commit()
        db.refresh(person)

        tag_count = 0
        keyword_id = None
        if keyword:
            keyword_id = keyword.id
            tag_count = _count_person_tagged_images(db, tenant, keyword.id)

        return PersonResponse(
            id=person.id,
            name=person.name,
            instagram_url=person.instagram_url,
            keyword_id=keyword_id,
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
        tenant_column_filter(Person, tenant),
    ).first()

    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    try:
        # Get the keyword for this person
        keyword = _get_person_keyword(db, tenant, person.id)

        # Ensure references are removed even if DB-level cascade is unavailable.
        db.query(PersonReferenceImage).filter(
            tenant_column_filter(PersonReferenceImage, tenant),
            PersonReferenceImage.person_id == person.id,
        ).delete(synchronize_session=False)

        # Delete associated keyword (cascade will delete related tags)
        if keyword:
            db.delete(keyword)

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
        tenant_column_filter(Person, tenant),
    ).first()

    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    # Get the keyword for this person
    keyword = _get_person_keyword(db, tenant, person.id)

    # Count tags if keyword exists
    tag_count = 0
    if keyword:
        tag_count = _count_person_tagged_images(db, tenant, keyword.id)

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
    tenant: Tenant | str,
    person_id: int
) -> Optional[Keyword]:
    """Get person's keyword, creating it if missing."""
    person = db.query(Person).filter(
        Person.id == person_id,
        _tenant_filter(Person, tenant),
    ).first()

    if not person:
        return None

    # Check if keyword already exists for this person
    existing_keyword = _get_person_keyword(db, tenant, person.id)

    if existing_keyword:
        return existing_keyword

    # Create keyword if missing
    keyword_cat = db.query(KeywordCategory).filter(
        _tenant_filter(KeywordCategory, tenant),
        KeywordCategory.is_people_category == True
    ).first()

    if not keyword_cat:
        # Create people category
        keyword_cat = KeywordCategory(
            name="people",
            is_people_category=True
        )
        if isinstance(tenant, Tenant):
            assign_tenant_scope(keyword_cat, tenant)
        else:
            keyword_cat.tenant_id = tenant
        db.add(keyword_cat)
        db.flush()

    keyword = Keyword(
        category_id=keyword_cat.id,
        keyword=person.name,
        person_id=person.id,
        tag_type="person"
    )
    if isinstance(tenant, Tenant):
        assign_tenant_scope(keyword, tenant)
    else:
        keyword.tenant_id = tenant
    db.add(keyword)
    db.commit()

    return keyword
