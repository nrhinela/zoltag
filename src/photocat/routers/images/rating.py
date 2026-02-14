"""Image rating endpoint."""

from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session

from photocat.dependencies import get_db, get_tenant
from photocat.tenant import Tenant
from photocat.metadata import ImageMetadata
from photocat.tenant_scope import tenant_column_filter

router = APIRouter()


@router.patch("/images/{image_id}/rating", response_model=dict, operation_id="update_image_rating")
async def update_image_rating(
    image_id: int,
    rating: int = Body(..., embed=True),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Update the rating for an image (0-3)."""
    if rating is not None and (rating < 0 or rating > 3):
        raise HTTPException(status_code=400, detail="Rating must be between 0 and 3.")
    image = db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        tenant_column_filter(ImageMetadata, tenant),
    ).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    image.rating = rating
    db.commit()
    return {"id": image.id, "rating": image.rating}
