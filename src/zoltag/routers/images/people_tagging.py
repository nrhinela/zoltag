"""Image people tagging endpoints: tag/untag people on images."""

from typing import List
from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from zoltag.dependencies import get_db, get_tenant
from zoltag.tenant import Tenant
from zoltag.metadata import ImageMetadata, MachineTag, Person
from zoltag.models.config import Keyword
from zoltag.routers.people import get_or_create_person_keyword

# Sub-router with no prefix/tags (inherits from parent)
router = APIRouter()


# ============================================================================
# Request/Response Models
# ============================================================================

class TagPersonRequest(BaseModel):
    """Request to tag a person to an image."""
    person_id: int = Field(..., gt=0, description="ID of the person to tag")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0, description="Confidence score (1.0 = manual tag)")


class PersonTagResponse(BaseModel):
    """Response model for a person tag."""
    id: int
    person_id: int
    person_name: str
    confidence: float
    tag_type: str
    created_at: str


class ImagePeopleTagsResponse(BaseModel):
    """Response model for all people tags on an image."""
    image_id: int
    people_tags: List[PersonTagResponse]


# ============================================================================
# People Tagging Endpoints
# ============================================================================

@router.post("/images/{image_id}/people", response_model=PersonTagResponse)
async def tag_person_on_image(
    image_id: int,
    request: TagPersonRequest,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Tag a person on an image.

    Creates a MachineTag linking the image to the person via their keyword.
    If the person doesn't have a keyword yet, creates one automatically.
    """
    # Get the image
    image = db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        ImageMetadata.tenant_id == tenant.id
    ).first()

    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    # Get the person
    person = db.query(Person).filter(
        Person.id == request.person_id,
        Person.tenant_id == tenant.id
    ).first()

    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    try:
        # Get or create keyword for this person
        keyword = get_or_create_person_keyword(db, tenant.id, request.person_id)

        if not keyword:
            raise HTTPException(status_code=500, detail="Failed to create keyword for person")

        # Check if tag already exists (avoid duplicates)
        existing_tag = db.query(MachineTag).filter(
            MachineTag.asset_id == image.asset_id,
            MachineTag.keyword_id == keyword.id,
            MachineTag.tenant_id == tenant.id,
            MachineTag.tag_type == 'manual_person'
        ).first()

        if existing_tag:
            # Update existing tag confidence
            existing_tag.confidence = request.confidence
            db.commit()
            db.refresh(existing_tag)
            tag = existing_tag
        else:
            # Create new tag
            tag = MachineTag(
                asset_id=image.asset_id,
                tenant_id=tenant.id,
                keyword_id=keyword.id,
                confidence=request.confidence,
                tag_type='manual_person',
                model_name='manual',
                model_version='1.0'
            )
            db.add(tag)
            db.commit()
            db.refresh(tag)

        return PersonTagResponse(
            id=tag.id,
            person_id=person.id,
            person_name=person.name,
            confidence=tag.confidence,
            tag_type=tag.tag_type,
            created_at=tag.created_at.isoformat() if tag.created_at else ""
        )

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to tag person: {str(e)}")


@router.delete("/images/{image_id}/people/{person_id}")
async def remove_person_tag(
    image_id: int,
    person_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Remove a person tag from an image."""
    # Get the image
    image = db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        ImageMetadata.tenant_id == tenant.id
    ).first()

    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    # Get the person
    person = db.query(Person).filter(
        Person.id == person_id,
        Person.tenant_id == tenant.id
    ).first()

    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    try:
        # Get the person's keyword
        keyword = db.query(Keyword).filter(
            Keyword.person_id == person_id
        ).first()

        if not keyword:
            raise HTTPException(status_code=404, detail="Person has no tags on this image")

        # Delete the tag
        deleted_count = db.query(MachineTag).filter(
            MachineTag.asset_id == image.asset_id,
            MachineTag.keyword_id == keyword.id,
            MachineTag.tenant_id == tenant.id,
            MachineTag.tag_type == 'manual_person'
        ).delete()

        if deleted_count == 0:
            raise HTTPException(status_code=404, detail="Person tag not found on this image")

        db.commit()

        return {
            "status": "deleted",
            "image_id": image_id,
            "person_id": person_id,
            "deleted_count": deleted_count
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to remove person tag: {str(e)}")


@router.get("/images/{image_id}/people", response_model=ImagePeopleTagsResponse)
async def get_image_people_tags(
    image_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Get all people tagged on an image."""
    # Get the image
    image = db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        ImageMetadata.tenant_id == tenant.id
    ).first()

    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    # Get all people tags for this image
    people_tags = db.query(MachineTag, Keyword, Person).join(
        Keyword, MachineTag.keyword_id == Keyword.id
    ).join(
        Person, Keyword.person_id == Person.id
    ).filter(
        MachineTag.asset_id == image.asset_id,
        MachineTag.tag_type == 'manual_person',
        MachineTag.tenant_id == tenant.id
    ).all()

    tags = []
    for tag, keyword, person in people_tags:
        tags.append(PersonTagResponse(
            id=tag.id,
            person_id=person.id,
            person_name=person.name,
            confidence=tag.confidence,
            tag_type=tag.tag_type,
            created_at=tag.created_at.isoformat() if tag.created_at else ""
        ))

    return ImagePeopleTagsResponse(
        image_id=image_id,
        people_tags=tags
    )


@router.put("/images/{image_id}/people/{person_id}", response_model=PersonTagResponse)
async def update_person_tag_confidence(
    image_id: int,
    person_id: int,
    request: TagPersonRequest = Body(...),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Update the confidence score of a person tag on an image."""
    # Get the image
    image = db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        ImageMetadata.tenant_id == tenant.id
    ).first()

    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    # Get the person
    person = db.query(Person).filter(
        Person.id == person_id,
        Person.tenant_id == tenant.id
    ).first()

    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    try:
        # Get the person's keyword
        keyword = db.query(Keyword).filter(
            Keyword.person_id == person_id
        ).first()

        if not keyword:
            raise HTTPException(status_code=404, detail="Person tag not found on this image")

        # Get the tag
        tag = db.query(MachineTag).filter(
            MachineTag.asset_id == image.asset_id,
            MachineTag.keyword_id == keyword.id,
            MachineTag.tenant_id == tenant.id,
            MachineTag.tag_type == 'manual_person'
        ).first()

        if not tag:
            raise HTTPException(status_code=404, detail="Person tag not found on this image")

        # Update confidence
        tag.confidence = request.confidence
        db.commit()
        db.refresh(tag)

        return PersonTagResponse(
            id=tag.id,
            person_id=person.id,
            person_name=person.name,
            confidence=tag.confidence,
            tag_type=tag.tag_type,
            created_at=tag.created_at.isoformat() if tag.created_at else ""
        )

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update person tag: {str(e)}")
