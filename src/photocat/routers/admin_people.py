"""Router for people management endpoints."""

from typing import Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from photocat.dependencies import get_db
from photocat.auth.dependencies import require_super_admin
from photocat.metadata import Person, Tenant as TenantModel
from photocat.tenant_scope import tenant_column_filter_for_values, tenant_reference_filter

router = APIRouter(
    prefix="/api/v1/admin/people",
    tags=["admin-people"],
    dependencies=[Depends(require_super_admin)],
)


def _resolve_tenant(db: Session, tenant_ref: str):
    return db.query(TenantModel).filter(tenant_reference_filter(TenantModel, tenant_ref)).first()


@router.get("", response_model=list)
async def list_people(
    tenant_id: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """List people (optionally filtered by tenant)."""
    query = db.query(Person)
    if tenant_id:
        tenant_row = _resolve_tenant(db, tenant_id)
        if tenant_row:
            query = query.filter(
                tenant_column_filter_for_values(
                    Person,
                    str(tenant_row.id),
                )
            )
        else:
            query = query.filter(tenant_column_filter_for_values(Person, tenant_id))

    people = query.all()
    return [{
        "id": p.id,
        "tenant_id": p.tenant_id,
        "name": p.name,
        "aliases": p.aliases,
        "face_embedding_ref": p.face_embedding_ref,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None
    } for p in people]


@router.post("", response_model=dict)
async def create_person(
    person_data: dict,
    db: Session = Depends(get_db)
):
    """Create a new person."""
    # Validate required fields
    if not person_data.get("tenant_id") or not person_data.get("name"):
        raise HTTPException(status_code=400, detail="tenant_id and name are required")

    tenant_row = _resolve_tenant(db, person_data["tenant_id"])
    if not tenant_row:
        raise HTTPException(status_code=404, detail="Tenant not found")

    # Create person
    person = Person(
        tenant_id=tenant_row.id,
        name=person_data["name"],
        aliases=person_data.get("aliases", []),
        face_embedding_ref=person_data.get("face_embedding_ref")
    )

    db.add(person)
    db.commit()
    db.refresh(person)

    return {
        "id": person.id,
        "tenant_id": person.tenant_id,
        "name": person.name,
        "aliases": person.aliases,
        "created_at": person.created_at.isoformat()
    }


@router.put("/{person_id}", response_model=dict)
async def update_person(
    person_id: int,
    person_data: dict,
    db: Session = Depends(get_db)
):
    """Update an existing person."""
    person = db.query(Person).filter(Person.id == person_id).first()
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    # Update fields
    if "name" in person_data:
        person.name = person_data["name"]
    if "aliases" in person_data:
        person.aliases = person_data["aliases"]
    if "face_embedding_ref" in person_data:
        person.face_embedding_ref = person_data["face_embedding_ref"]

    person.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(person)

    return {
        "id": person.id,
        "name": person.name,
        "aliases": person.aliases,
        "updated_at": person.updated_at.isoformat()
    }


@router.delete("/{person_id}", response_model=dict)
async def delete_person(
    person_id: int,
    db: Session = Depends(get_db)
):
    """Delete a person."""
    person = db.query(Person).filter(Person.id == person_id).first()
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    db.delete(person)
    db.commit()

    return {"status": "deleted", "person_id": person_id}
