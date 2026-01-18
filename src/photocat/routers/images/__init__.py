"""Aggregated images router combining all sub-routers.

This module provides backward compatibility by exposing a unified router
that combines all domain-specific sub-routers (core, permatags, ml_training, tagging).
"""

from fastapi import APIRouter
from .core import router as core_router
from .permatags import router as permatags_router
from .ml_training import router as ml_training_router
from .tagging import router as tagging_router

# Main router with shared prefix and tags
# Sub-routers inherit these settings and maintain API contract
router = APIRouter(
    prefix="/api/v1",
    tags=["images"]
)

# Include all sub-routers (no prefix, tags inherited)
router.include_router(core_router)
router.include_router(permatags_router)
router.include_router(ml_training_router)
router.include_router(tagging_router)
