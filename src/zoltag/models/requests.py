"""Pydantic request models for API endpoints."""

from typing import List
from pydantic import BaseModel


class AddPhotoRequest(BaseModel):
    """Request model for add-photo endpoint."""
    photo_id: int


class ReorderListItemsRequest(BaseModel):
    """Request model for list-item reorder endpoint."""
    item_ids: List[int]
