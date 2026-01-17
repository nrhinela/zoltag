# Images Router Tests

This directory contains tests for the images router endpoints, organized to mirror the modular router structure.

## Test Organization

### Unit Tests (../../test_filtering.py)
- **Location**: `tests/routers/test_filtering.py`
- **Purpose**: Unit tests for filtering utility functions
- **Coverage**: 22 tests covering all 7 filtering helper functions
- **Status**: ✅ Complete (100% coverage of filtering logic)

### Integration Tests (To Be Implemented)

The following test files provide structure for future integration tests:

#### test_core.py
Tests for core image operations (5 endpoints):
- `GET /api/v1/images` - List images with filtering
- `GET /api/v1/images/stats` - Image statistics
- `GET /api/v1/images/{id}` - Get single image
- `PATCH /api/v1/images/{id}/rating` - Update rating
- `GET /api/v1/images/{id}/thumbnail` - Get thumbnail

#### test_permatags.py
Tests for permatag management (5 endpoints):
- `GET /api/v1/images/{id}/permatags` - List permatags
- `POST /api/v1/images/{id}/permatags` - Add permatag
- `DELETE /api/v1/images/{id}/permatags/{permatag_id}` - Delete permatag
- `POST /api/v1/images/{id}/permatags/accept-all` - Accept all tags
- `POST /api/v1/images/{id}/permatags/freeze` - Freeze tags

#### test_ml_training.py
Tests for ML training operations (2 endpoints):
- `GET /api/v1/ml-training/images` - List training images
- `GET /api/v1/ml-training/stats` - Training statistics

#### test_tagging.py
Tests for image tagging (4 endpoints):
- `POST /api/v1/images/upload` - Upload and analyze images
- `GET /api/v1/images/{id}/analyze` - Analyze keywords
- `POST /api/v1/images/{id}/retag` - Retag single image
- `POST /api/v1/retag` - Retag all images

## Running Tests

```bash
# Run all images router tests
pytest tests/routers/

# Run specific test file
pytest tests/routers/test_filtering.py

# Run tests for specific sub-router
pytest tests/routers/images/test_core.py
pytest tests/routers/images/test_permatags.py
pytest tests/routers/images/test_ml_training.py
pytest tests/routers/images/test_tagging.py

# Run with coverage
pytest tests/routers/ --cov=src/photocat/routers
```

## Test Implementation Guidelines

When implementing the integration tests:

1. **Use FastAPI TestClient**: All integration tests should use `fastapi.testclient.TestClient` to make actual HTTP requests

2. **Test Full Request/Response Cycle**: Verify:
   - Request parameter validation
   - Response status codes
   - Response JSON structure
   - Data integrity
   - Error handling

3. **Use Fixtures**: Leverage pytest fixtures from `tests/conftest.py`:
   - `test_db` - In-memory SQLite database
   - `test_tenant` - Test tenant instance
   - `sample_image_data` - Sample image bytes

4. **Test Tenant Isolation**: Ensure endpoints properly filter by tenant_id

5. **Test Edge Cases**:
   - Non-existent resources (404s)
   - Invalid input (422s)
   - Missing required fields
   - Boundary conditions

## Benefits of Modular Test Structure

- **Faster Navigation**: Find tests for specific endpoints quickly
- **Parallel Development**: Multiple developers can work on different test files
- **Clear Organization**: Test structure mirrors router structure
- **Easier Maintenance**: Changes to router endpoints only affect related test file
- **Better Test Reports**: Failures clearly indicate which router component is affected
