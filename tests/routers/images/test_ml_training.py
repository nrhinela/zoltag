"""Tests for ML training router endpoints.

This module tests the ML training operations:
- GET /api/v1/ml-training/images (list_ml_training_images)
- GET /api/v1/ml-training/stats (get_ml_training_stats)
"""

import pytest

# TODO: Add integration tests for ML training endpoints
# These tests should verify ML training image listing, stats calculation,
# and the refresh functionality for trained tags.


class TestListMlTrainingImages:
    """Tests for GET /api/v1/ml-training/images endpoint."""

    # TODO: Test listing images with ML tags
    # TODO: Test pagination (limit, offset)
    # TODO: Test refresh=true parameter
    # TODO: Test response includes permatags, ml_tags, trained_tags
    # TODO: Test with images missing thumbnails
    pass


class TestGetMlTrainingStats:
    """Tests for GET /api/v1/ml-training/stats endpoint."""

    # TODO: Test stats calculation
    # TODO: Test image_count, embedding_count
    # TODO: Test zero_shot_image_count, trained_image_count
    # TODO: Test keyword_model_count, last_trained timestamp
    # TODO: Test trained_tag counts and timestamps
    pass
