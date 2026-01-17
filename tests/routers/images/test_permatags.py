"""Tests for permatag router endpoints.

This module tests the permatag management operations:
- GET /api/v1/images/{id}/permatags (get_permatags)
- POST /api/v1/images/{id}/permatags (add_permatag)
- DELETE /api/v1/images/{id}/permatags/{permatag_id} (delete_permatag)
- POST /api/v1/images/{id}/permatags/accept-all (accept_all_tags)
- POST /api/v1/images/{id}/permatags/freeze (freeze_permatags)
"""

import pytest

# TODO: Add integration tests for permatag endpoints
# These tests should verify permatag CRUD operations and their effect
# on tag computation (precedence over machine tags).


class TestGetPermatags:
    """Tests for GET /api/v1/images/{id}/permatags endpoint."""

    # TODO: Test retrieving permatags for image
    # TODO: Test empty permatags list
    # TODO: Test 404 for non-existent image
    pass


class TestAddPermatag:
    """Tests for POST /api/v1/images/{id}/permatags endpoint."""

    # TODO: Test adding positive permatag (signum=1)
    # TODO: Test adding negative permatag (signum=-1)
    # TODO: Test permatag overrides machine tag
    # TODO: Test duplicate permatag handling
    # TODO: Test 404 for non-existent image
    pass


class TestDeletePermatag:
    """Tests for DELETE /api/v1/images/{id}/permatags/{permatag_id} endpoint."""

    # TODO: Test deleting existing permatag
    # TODO: Test 404 for non-existent permatag
    # TODO: Test tenant isolation
    pass


class TestAcceptAllTags:
    """Tests for POST /api/v1/images/{id}/permatags/accept-all endpoint."""

    # TODO: Test accepting all machine tags as permatags
    # TODO: Test with existing permatags
    # TODO: Test with no machine tags
    pass


class TestFreezePermatags:
    """Tests for POST /api/v1/images/{id}/permatags/freeze endpoint."""

    # TODO: Test freezing current tags
    # TODO: Test freeze with negative permatags for removed tags
    # TODO: Test freeze updates existing permatags
    pass
