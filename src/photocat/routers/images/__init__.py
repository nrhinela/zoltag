"""Aggregated images router combining all sub-routers.

This module provides backward compatibility by exposing a unified router
that combines all domain-specific sub-routers (core, permatags, ml_training, tagging).
"""

from fastapi import APIRouter
from .core import router as core_router
from .permatags import router as permatags_router
from .ml_training import router as ml_training_router
from .tagging import router as tagging_router
from .people_tagging import router as people_tagging_router
from .rating import router as rating_router
from .file_serving import router as file_serving_router
from .asset_variants import router as asset_variants_router
from .dropbox_sync import router as dropbox_sync_router
from .stats import router as stats_router

# Main router with shared prefix and tags
# Sub-routers inherit these settings and maintain API contract
router = APIRouter(
    prefix="/api/v1",
    tags=["images"]
)

# Include all sub-routers (no prefix, tags inherited)
# Routers with fixed paths must come before core_router to prevent
# /images/{image_id} from capturing routes like /images/stats or /images/dropbox-folders
router.include_router(stats_router)
router.include_router(dropbox_sync_router)
router.include_router(core_router)
router.include_router(permatags_router)
router.include_router(ml_training_router)
router.include_router(tagging_router)
router.include_router(people_tagging_router)
router.include_router(rating_router)
router.include_router(file_serving_router)
router.include_router(asset_variants_router)
