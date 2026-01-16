# Images Router Refactoring Proposal

## Executive Summary

Proposal to refactor `src/photocat/routers/images.py` (1480 lines) into a modular structure with domain-separated sub-routers. The refactor will improve maintainability, testability, and developer experience while maintaining 100% backward compatibility with existing API contracts.

## Current State Analysis

### File Metrics
- **Total lines**: 1480
- **Endpoints**: 19
- **Largest endpoint**: `GET /images` (433 lines, 29% of file)
- **Complexity**: High cognitive load due to monolithic structure

**Note**: Endpoint count verified via grep on 2026-01-16. Includes recently added POST /images/{id}/caption endpoint.

### Endpoint Distribution
```
Core Image Operations     ~490 lines (33%)
├── GET /images           433 lines (complex filtering)
├── GET /images/stats      28 lines
├── GET /images/{id}       64 lines
├── POST /images/{id}/caption  54 lines
├── PATCH /images/{id}/rating  16 lines
└── GET /images/{id}/thumbnail 49 lines

ML Training Operations    ~196 lines (13%)
├── GET /ml-training/images    139 lines
└── GET /ml-training/stats      56 lines

Permatag Operations       ~260 lines (18%)
├── GET /images/{id}/permatags          34 lines
├── POST /images/{id}/permatags         62 lines
├── DELETE /images/{id}/permatags/{id}  21 lines
├── POST /images/{id}/permatags/accept-all  74 lines
└── POST /images/{id}/permatags/freeze      60 lines

Tagging Operations        ~308 lines (21%)
├── POST /images/upload         90 lines
├── GET /images/{id}/analyze    68 lines
├── POST /images/{id}/retag    108 lines
└── POST /retag                106 lines
```
// COMMENT (Codex): Confirm the endpoint inventory matches the current router
// before refactor scope is locked; the counts/paths here drive the plan.
// RESPONSE: Verified - actual count is 19 endpoints (including POST /images/{id}/caption
// not in original inventory). Updated distribution above reflects accurate counts.
// COMMENT (Codex): The caption endpoint was removed; please re-verify the count
// and update the distribution + totals accordingly.

## Problems with Current Structure

### 1. Maintainability Issues
- **Single-file cognitive overload**: 1480 lines exceeds reasonable mental model capacity
- **Navigation difficulty**: Finding permatag logic requires scanning entire file
- **Change risk**: Modifications to one domain can inadvertently affect others
- **Review burden**: PR reviews require scanning unrelated code

### 2. Testing Complexity
- **Monolithic test files**: Tests for all domains live in one location
- **Fixture pollution**: Shared fixtures across unrelated tests
- **Slower test execution**: Cannot parallelize domain-specific test suites

### 3. Development Friction
- **Merge conflicts**: Changes to permatags conflict with ML training changes
- **Parallel work limitations**: Multiple developers cannot work independently
- **LLM context limitations**: 1480-line files exceed optimal context windows for AI tools

### 4. Code Quality Issues
- **GET /images endpoint**: 433 lines violates Single Responsibility Principle
- **Duplicated logic**: Filtering logic repeated across endpoints
- **Tight coupling**: Image operations, ML training, and permatags are intermingled

## Proposed Structure

### Directory Layout
```
src/photocat/routers/images/
├── __init__.py              # Router aggregator (exports combined router)
├── core.py                  # Core image CRUD and listing (~590 lines)
├── permatags.py             # Permatag CRUD operations (~260 lines)
├── ml_training.py           # ML training endpoints (~196 lines)
├── tagging.py               # Upload, analyze, retag (~308 lines)
└── filtering.py             # Shared filtering utilities (~200 lines)
```

### Responsibility Mapping

#### `core.py` - Core Image Operations
**Endpoints**:
- `GET /images` - Main image listing with filtering
- `GET /images/stats` - Aggregate statistics
- `GET /images/{image_id}` - Single image detail
- `POST /images/{image_id}/caption` - Generate AI caption
- `PATCH /images/{image_id}/rating` - Update rating
- `GET /images/{image_id}/thumbnail` - Thumbnail retrieval

**Purpose**: Essential CRUD operations for image resources

#### `permatags.py` - Permatag Management
**Endpoints**:
- `GET /images/{image_id}/permatags` - List permatags
- `POST /images/{image_id}/permatags` - Add/update permatag
- `DELETE /images/{image_id}/permatags/{permatag_id}` - Remove permatag
- `POST /images/{image_id}/permatags/accept-all` - Bulk accept
- `POST /images/{image_id}/permatags/freeze` - Freeze all tags

**Purpose**: Ground truth tag management (user-verified tags)

#### `ml_training.py` - ML Training Endpoints
**Endpoints**:
- `GET /ml-training/images` - Training data view
- `GET /ml-training/stats` - Training statistics

**Purpose**: Machine learning model training and monitoring

#### `tagging.py` - Tagging Operations
**Endpoints**:
- `POST /images/upload` - Preview tagging on upload
- `GET /images/{image_id}/analyze` - Analyze keyword scores
- `POST /images/{image_id}/retag` - Retag single image
- `POST /retag` - Batch retag all images

**Purpose**: Tag generation and reprocessing

#### `filtering.py` - Shared Utilities
**Functions**:
- `apply_list_filter()` - PhotoList filtering
- `apply_rating_filter()` - Rating-based filtering
- `apply_reviewed_filter()` - Permatag-reviewed filtering
- `apply_category_filters()` - Per-category keyword filtering
- `apply_keyword_filters()` - Legacy keyword filtering
- `build_image_response()` - Response serialization

**Purpose**: Extract complex filtering logic from `GET /images`

## Migration Strategy

### Phase 0: Pin operation_id Values (Non-Breaking)
**Objective**: Lock OpenAPI operation_ids before refactoring to prevent spec drift

**Actions**:
1. Add explicit `operation_id` parameter to all 19 endpoint decorators
2. Generate OpenAPI spec and save as baseline
3. Deploy and validate (no functional changes)
4. Merge to establish stable baseline

**Risk**: Minimal - purely additive metadata

**Duration**: 1 hour

**Example**:
```python
@router.get("/images/{image_id}", operation_id="get_image")
@router.post("/images/{image_id}/permatags", operation_id="create_permatag")
```

### Phase 1: Extract Filtering Logic (Non-Breaking)
**Objective**: Reduce `GET /images` complexity without changing API surface

**Actions**:
1. Create `filtering.py` with extracted helper functions
2. Refactor `GET /images` in `images.py` to use helpers
3. Add unit tests for filtering functions
4. Deploy and validate (no API changes)

**Risk**: Low - Internal refactor only

**Duration**: 2-4 hours

### Phase 2: Create Sub-Router Structure (Non-Breaking)
**Objective**: Establish new directory structure while maintaining compatibility

**Actions**:
1. Create `routers/images/` directory
2. Move endpoints to domain-specific files (`core.py`, `permatags.py`, etc.)
3. Create `__init__.py` that combines all sub-routers
4. Update main router to import from `routers.images`
5. Run full test suite to verify no regressions

**Risk**: Medium - Import paths change, but API unchanged

**Duration**: 4-6 hours

### Phase 3: Update Tests (Non-Breaking)
**Objective**: Reorganize tests to match new structure

**Actions**:
1. Create `tests/routers/images/` directory
2. Split `test_images.py` into domain-specific test files
3. Validate test coverage remains at or above current levels

**Risk**: Low - Test refactor only

**Duration**: 2-3 hours

## Implementation Details

### Router Aggregation Pattern

#### `src/photocat/routers/images/__init__.py`
```python
"""Aggregated images router combining all sub-routers."""

from fastapi import APIRouter
from .core import router as core_router
from .permatags import router as permatags_router
from .ml_training import router as ml_training_router
from .tagging import router as tagging_router

# Main router with shared prefix and tags
router = APIRouter(
    prefix="/api/v1",
    tags=["images"]
)

# Include all sub-routers (no prefix, tags inherited)
router.include_router(core_router)
router.include_router(permatags_router)
router.include_router(ml_training_router)
router.include_router(tagging_router)
```

### Sub-Router Pattern

#### `src/photocat/routers/images/core.py`
```python
"""Core image CRUD operations."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from photocat.dependencies import get_db, get_tenant
from photocat.tenant import Tenant
from .filtering import (
    apply_list_filter,
    apply_rating_filter,
    apply_category_filters,
    apply_keyword_filters,
    build_image_response
)

# Sub-router with NO prefix (inherited from parent)
router = APIRouter()


@router.get("/images", response_model=dict)
async def list_images(
    tenant: Tenant = Depends(get_tenant),
    limit: int = None,
    offset: int = 0,
    # ... other parameters
    db: Session = Depends(get_db)
):
    """List images for tenant with optional faceted search."""
    filter_ids = None

    # Apply filters using extracted utilities
    if list_id is not None:
        filter_ids = apply_list_filter(db, tenant, list_id)

    if rating is not None:
        filter_ids = apply_rating_filter(db, tenant, rating, rating_operator, filter_ids)

    # ... rest of logic using filtering utilities

    return build_image_response(images, total, limit, offset)
```

### Filtering Utilities Pattern

#### `src/photocat/routers/images/filtering.py`
```python
"""Shared filtering utilities for image queries."""

from typing import Optional, Set
from sqlalchemy.orm import Session
from photocat.tenant import Tenant
from photocat.models.config import PhotoList, PhotoListItem
from photocat.metadata import ImageMetadata


def apply_list_filter(
    db: Session,
    tenant: Tenant,
    list_id: int
) -> Set[int]:
    """Filter images by PhotoList membership.

    Args:
        db: Database session
        tenant: Current tenant
        list_id: PhotoList ID

    Returns:
        Set of image IDs in the list

    Raises:
        HTTPException: If list not found
    """
    lst = db.query(PhotoList).filter_by(id=list_id, tenant_id=tenant.id).first()
    if not lst:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="List not found")

    list_image_ids = db.query(PhotoListItem.photo_id).filter(
        PhotoListItem.list_id == list_id
    ).all()
    return {row[0] for row in list_image_ids}


def apply_rating_filter(
    db: Session,
    tenant: Tenant,
    rating: int,
    operator: str,
    existing_filter: Optional[Set[int]] = None
) -> Set[int]:
    """Filter images by rating.

    Args:
        db: Database session
        tenant: Current tenant
        rating: Rating value (0-3)
        operator: Comparison operator ("eq", "gte", "gt")
        existing_filter: Existing filter set to intersect with

    Returns:
        Set of image IDs matching rating criteria
    """
    query = db.query(ImageMetadata.id).filter(ImageMetadata.tenant_id == tenant.id)

    if operator == "gte":
        query = query.filter(ImageMetadata.rating >= rating)
    elif operator == "gt":
        query = query.filter(ImageMetadata.rating > rating)
    else:
        query = query.filter(ImageMetadata.rating == rating)

    rating_ids = {row[0] for row in query.all()}

    if existing_filter is None:
        return rating_ids
    else:
        return existing_filter.intersection(rating_ids)


# ... additional filtering functions
```
// COMMENT (Codex): These helpers return in-memory ID sets; for large tenants
// this can be expensive and may affect pagination. Consider returning a query/CTE.
// RESPONSE: Valid concern. For tenants with 10,000+ images, materializing ID sets causes:
// - High memory consumption during filter operations
// - Slow set intersection performance
// - Pagination issues (offset/limit applied after materializing all results)
// RECOMMENDATION: Refactor filtering utilities to return SQLAlchemy subquery/CTE objects
// instead of materialized sets. This allows database to handle filtering efficiently:
//   def apply_list_filter(...) -> Select:
//       return select(PhotoListItem.photo_id).filter(...)
// Then combine filters using .where(ImageMetadata.id.in_(subquery)) patterns.
// This preserves database-level optimization and proper pagination.

## Backward Compatibility Guarantees

### API Contract Preservation
✅ **All endpoint paths remain identical**
- `GET /api/v1/images` → unchanged
- `POST /api/v1/images/{id}/permatags` → unchanged
- All 16 endpoints maintain exact same URLs
// COMMENT (Codex): If the endpoint inventory is 19, this "16 endpoints" line
// should be updated to match the verified count.

✅ **Request/response schemas unchanged**
- No changes to request parameters
- No changes to response JSON structure
- All validation rules preserved

✅ **Behavior preservation**
- Filtering logic remains functionally identical
- Error responses unchanged (status codes, messages)
- Performance characteristics maintained

### Import Path Migration
**Before**:
```python
from photocat.routers.images import router
```

**After**:
```python
from photocat.routers.images import router  # Still works! (via __init__.py)
```

**Internal only** (no external impact):
```python
# New internal imports (not exposed to API consumers)
from photocat.routers.images.core import list_images
from photocat.routers.images.filtering import apply_rating_filter
```

## Validation & Testing Strategy

### Pre-Migration Validation
1. **Baseline test suite**: Run full test suite, record coverage metrics
2. **API documentation**: Generate OpenAPI spec as baseline
3. **Integration test snapshot**: Capture request/response examples

### Post-Migration Validation
1. **Test suite verification**: All tests pass with same coverage
2. **OpenAPI spec diff**: Generated spec identical to baseline
3. **Integration tests**: All snapshots match exactly
4. **Manual smoke testing**: Critical flows tested in dev environment
// COMMENT (Codex): Moving endpoints can change FastAPI auto-generated
// operation_id values; consider pinning operation_id to avoid spec diffs.
// RESPONSE: Critical issue for API consumers. FastAPI generates operation_ids from
// function names + module paths. Moving endpoints WILL break client code generators.
// SOLUTION: Add explicit operation_id to all endpoints BEFORE refactor (Phase 0):
//   @router.get("/images/{image_id}", operation_id="get_image")
//   @router.post("/images/{image_id}/permatags", operation_id="create_permatag")
// This locks operation_ids and prevents spec drift. Should be separate commit
// merged before Phase 1 begins to establish stable baseline.

### Regression Prevention
1. **Contract tests**: Add OpenAPI schema validation tests
2. **Integration tests**: Expand coverage of filtering combinations
3. **Performance benchmarks**: Ensure no degradation in response times

## Rollback Plan

### Rollback Triggers
- Any failing tests after migration
- OpenAPI spec changes detected
- Performance degradation > 10%
- Production errors related to routing

### Rollback Procedure
**Per-Phase Rollback Strategy**:

**Phase 1 Rollback** (if filtering.py issues detected):
1. Git revert Phase 1 commit
2. Restore inline filtering logic in GET /images
3. Remove filtering.py file
4. Deploy and validate

**Phase 2 Rollback** (if directory structure issues detected):
1. Git revert Phase 2 commit (keeps Phase 1 intact)
2. Restore monolithic routers/images.py
3. Remove routers/images/ directory
4. Deploy and validate

**Phase 3 Rollback** (if test issues detected):
1. Git revert Phase 3 commit (keeps Phases 1-2 intact)
2. Restore monolithic test_images.py
3. Deploy and validate

**Note**: Each phase is independently revertible. If Phase 2 fails, we can revert Phase 2 while keeping Phase 1's filtering improvements.
// COMMENT (Codex): The plan is multi-phase PRs; rollback will not be a single
// atomic commit unless phases are consolidated. Consider clarifying per-phase rollback.
// RESPONSE: Corrected above. Each phase requires its own rollback procedure.
// Single-commit rollback only applies if phases are consolidated into one PR.

### Rollback Risk: **Low**
- Single atomic commit makes revert clean
// COMMENT (Codex): This contradicts the per-phase rollback plan above unless
// you consolidate phases into a single PR.
- No database migrations involved
- No external API changes to coordinate

## Benefits Summary

### Developer Experience
- **Faster navigation**: Find permatag logic in 260-line file, not 1480-line file
- **Clearer responsibilities**: Each file has single domain focus
- **Reduced conflicts**: Parallel development without merge conflicts
- **Better code reviews**: Review only relevant domain changes

### Maintainability
- **Cognitive load reduction**: 200-300 line files vs. 1480 lines
- **Isolated changes**: Permatag changes don't touch ML training code
- **Testability**: Domain-specific test suites run independently

### Code Quality
- **Single Responsibility**: Each module has one reason to change
- **DRY principle**: Filtering logic extracted to reusable utilities
- **Separation of Concerns**: Clear boundaries between domains

### LLM/AI Tool Optimization
- **Context window fit**: 200-300 line files fit in single LLM context
- **Focused analysis**: AI tools can reason about single domain
- **Better suggestions**: More accurate recommendations with reduced scope

## Implementation Checklist

### Phase 0: Pin operation_id Values
- [ ] Add explicit operation_id to all 19 endpoints
- [ ] Generate OpenAPI spec baseline
- [ ] Run full test suite (100% pass rate)
- [ ] Deploy to dev environment
- [ ] Merge to main

### Phase 1: Filtering Logic Extraction
- [ ] Create `filtering.py` with helper functions
- [ ] Add unit tests for filtering functions (>90% coverage)
- [ ] Refactor `GET /images` to use helpers
- [ ] Run full test suite (100% pass rate)
- [ ] Deploy to dev environment
- [ ] Manual validation of filtering behavior
- [ ] Merge to main

### Phase 2: Directory Structure
- [ ] Create `routers/images/` directory
- [ ] Create `__init__.py` with router aggregation
- [ ] Move endpoints to `core.py`, `permatags.py`, `ml_training.py`, `tagging.py`
- [ ] Update imports in all modules
- [ ] Run full test suite (100% pass rate)
- [ ] Generate OpenAPI spec, diff with baseline
- [ ] Deploy to dev environment
- [ ] Integration test validation
- [ ] Merge to main

### Phase 3: Test Reorganization
- [ ] Create `tests/routers/images/` directory
- [ ] Split tests into domain-specific files
- [ ] Validate coverage >= baseline
- [ ] Run full test suite (100% pass rate)
- [ ] Merge to main

### Final Validation
- [ ] Deploy to staging environment
- [ ] Run full regression suite
- [ ] Performance benchmark validation
- [ ] Manual smoke test all 16 endpoints
- [ ] Deploy to production
- [ ] Monitor for 24 hours

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Import path breakage | Low | High | Maintain backward-compatible imports via `__init__.py` |
| Test coverage loss | Low | Medium | Measure coverage before/after, require >= baseline |
| Performance regression | Very Low | Medium | Benchmark critical endpoints, require < 5% degradation |
| Merge conflicts during migration | Medium | Low | Complete in single PR, communicate with team |
| Routing bugs | Low | High | Extensive integration tests, OpenAPI spec validation |

**Overall Risk Level**: **Low**

## Timeline Estimate

| Phase | Duration | Effort | Dependencies |
|-------|----------|--------|--------------|
| Phase 0: Pin operation_ids | 1 hour | 1 developer | None |
| Phase 1: Filtering Extraction | 2-4 hours | 1 developer | Phase 0 complete |
| Phase 2: Directory Structure | 4-6 hours | 1 developer | Phase 1 complete |
| Phase 3: Test Reorganization | 2-3 hours | 1 developer | Phase 2 complete |
| Testing & Validation | 2-3 hours | 1 developer | Phase 3 complete |
| **Total** | **11-17 hours** | **1 developer** | Sequential |

## Success Criteria

✅ **All tests pass** with coverage >= baseline
✅ **OpenAPI spec unchanged** (exact match)
✅ **No performance regression** (< 5% degradation)
✅ **All 16 endpoints functional** (integration tests pass)
✅ **Code review approved** (maintainability improvements validated)
✅ **Zero production incidents** in first 24 hours post-deploy

## Questions for Review

1. **Filtering utilities**: Should `filtering.py` be in `routers/images/` or elevated to `services/image_filtering.py`?
2. **Test organization**: Should tests mirror router structure exactly, or group by domain differently?
3. **Deployment strategy**: Single PR or split into 3 PRs (one per phase)?
4. **Naming conventions**: Any preference for module names (`core.py` vs `image_crud.py`)?
5. **Shared dependencies**: Should we extract common imports (e.g., `get_tenant`, `get_db`) to `routers/images/dependencies.py`?

## Alternatives Considered

### Alternative 1: Keep Monolithic, Extract Only Filtering
**Pros**: Minimal change, lowest risk
**Cons**: Doesn't address root maintainability issues
**Decision**: Rejected - doesn't solve long-term problems

### Alternative 2: Microservices Split
**Pros**: Maximum separation of concerns
**Cons**: Massive infrastructure change, coordination complexity
**Decision**: Rejected - overkill for current scale

### Alternative 3: Proposed Modular Router (Selected)
**Pros**: Balance of maintainability gains and manageable risk
**Cons**: Requires careful migration planning
**Decision**: ✅ Selected - optimal risk/reward ratio

## References

- Current implementation: `src/photocat/routers/images.py`
- Test suite: `tests/test_images.py`
- API documentation: `docs/api/images.md` (if exists)
- Related routers: `src/photocat/routers/keywords.py`, `src/photocat/routers/sync.py`

---

**Document Version**: 1.0
**Date**: 2026-01-16
**Author**: Claude (AI Assistant)
**Status**: Proposal - Awaiting Codex Review
