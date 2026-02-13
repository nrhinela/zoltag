"""Pydantic request models for API endpoints."""

from pydantic import BaseModel


class AddPhotoRequest(BaseModel):
    """Request model for add-photo endpoint."""
    photo_id: int
