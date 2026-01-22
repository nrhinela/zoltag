# PhotoCat Refactoring Plan

**Status**: Draft for Review
**Date**: January 2026
**Scope**: Address architectural issues identified in codebase analysis
**Timeline**: Phased approach over 3-4 weeks

---

## Executive Summary

The PhotoCat codebase has strong foundations but suffers from three critical architectural issues:

1. **Monolithic Components**: photocat-app.js (2,938 lines) and cli.py (1,042 lines) violate single-responsibility principle
2. **Code Duplication**: Keyword loading, EXIF parsing, and filter logic repeated 4+ times
3. **Performance Issues**: N+1 queries, materialized result sets, inefficient filters

**Baseline Performance Context**:
The 3-4x performance claim is anchored in current list_images implementation (images/core.py:486 lines) which:
- Executes 5+ separate queries for a single list_images request (N+1 pattern)
- Materializes entire keyword/tag/list result sets in Python (100k+ IDs for large tenants)
- Rebuilds query logic independently for each filter path (7 different code paths)
Refactoring to unified query builder + SQL subqueries should consolidate to 2-3 queries total.

**Expected Outcomes**:
- 60% reduction in largest files (photocat-app.js: 2,938 → ~1,200 lines)
- Elimination of 10+ duplicated code patterns
- 3-4x performance improvement on filtered list queries
- Easier testing and maintenance

**Measurement Plan**:
- **Baseline**: Run before refactoring with demo tenant (5k images, keywords with mix of AND/OR filters)
- **Metrics**: Query execution time, memory usage, JSON response size
- **Validation**: Same result counts/ordering across old and new implementations
- **Hardware**: Measure on consistent environment (local dev machine or staging)

---

## Phase 1: Foundation (Quick Wins - 3-4 Days)

### Goal
Reduce immediate duplication without major refactoring. Build utilities for use in later phases.

### 1.1 Extract Database Query Utilities
**File**: `src/photocat/config/db_utils.py` (NEW)
**Effort**: 1 day
**Impact**: HIGH (benefits 4+ files)

#### Current Duplication
- `images/core.py` lines 428-449: Keyword loading with category
- `images/permatags.py` lines 58-69: Identical logic
- `lists.py` ~lines 300+: Similar pattern
- `sync.py`: Implicit keyword lookups

#### Solution
Create shared utility functions:

```python
def load_keywords_map(db, tenant_id, keyword_ids):
    """
    Load keyword name and category for multiple keyword IDs.

    Handles large lists by chunking to avoid database parameter limits.
    Returns dict with 'found' flag for missing IDs (for safe error handling).

    Returns:
        dict: {keyword_id -> {'keyword': str, 'category': str, 'found': True}}
    """
    if not keyword_ids:
        return {}

    # Chunk to avoid parameter limit (PostgreSQL ~32k, SQLite 999; chunk at 500 for safety)
    CHUNK_SIZE = 500
    keywords_data = {}

    for i in range(0, len(keyword_ids), CHUNK_SIZE):
        chunk = keyword_ids[i:i + CHUNK_SIZE]
        rows = db.query(
            Keyword.id, Keyword.keyword, KeywordCategory.name
        ).join(
            KeywordCategory, Keyword.category_id == KeywordCategory.id
        ).filter(
            Keyword.tenant_id == tenant_id,
            Keyword.id.in_(chunk)
        ).all()

        for kw_id, kw_name, cat_name in rows:
            keywords_data[kw_id] = {
                "keyword": kw_name,
                "category": cat_name,
                "found": True
            }

    return keywords_data


def load_keyword_info(db, tenant_id, keyword_names):
    """Load keyword info (id, category) by keyword string."""
    # Implementation
    pass


def format_machine_tags(tags, keywords_map):
    """Format machine tags for API response, skipping tags with missing keywords."""
    return [
        {
            "keyword": keywords_map[tag.keyword_id]["keyword"],
            "category": keywords_map[tag.keyword_id]["category"],
            "confidence": tag.confidence,
            "model_name": tag.model_name,
        }
        for tag in tags
        if tag.keyword_id in keywords_map  # Only include tags with found keywords
    ]
```

#### Changes Required
| File | Change | LOC |
|------|--------|-----|
| images/core.py | Replace lines 428-449 | -20 |
| images/permatags.py | Replace lines 58-69 | -10 |
| lists.py | Replace keyword loading | -15 |
| sync.py | Use utility function | -5 |

### 1.2 Split Frontend API Service
**File**: Split `frontend/services/api.js` (675 lines)
**Effort**: 1 day
**Impact**: HIGH (improves maintainability)

#### Current Organization
Single file with ~60+ functions for:
- Images (getImages, getImage, updateRating) - 100 LOC
- Lists (getLists, getActiveList, etc.) - 80 LOC
- Keywords (getKeywords, getAllKeywords) - 40 LOC
- Permatags (getPermatags, addPermatag, deletePermatag) - 60 LOC
- Tags (getTagStats, getMlTrainingStats) - 50 LOC
- ML Training (getMlTrainingImages, postMlTraining) - 40 LOC
- Admin (getTenants, postNewKeywords) - 30 LOC
- Upload (uploadImages) - 35 LOC
- Commands (checkCommandQueue, retryCommand) - 30 LOC

#### New Structure
```
frontend/services/
├── api.js (core base URL, auth, shared fetch wrapper)
├── images.js (getImages, getImage, updateRating)
├── lists.js (getLists, getActiveList, etc.)
├── keywords.js (getKeywords, getAllKeywords)
├── tags.js (getTagStats, getMachineTagStats)
├── training.js (getMlTrainingImages, postMlTraining)
├── admin.js (getTenants, postNewKeywords)
└── uploads.js (uploadImages)
```

#### Implementation
1. Create base `api.js` with flexible helper:
```javascript
async function apiCall(endpoint, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body = null,
    responseType = 'json',  // 'json', 'blob', 'text', 'arraybuffer'
  } = options;

  // Determine content-type based on body type
  let finalHeaders = { 'X-Tenant-ID': getTenantId(), ...headers };
  let finalBody = body;

  if (body && !(body instanceof FormData)) {
    // Only JSON-stringify if not FormData (upload handler)
    finalHeaders['Content-Type'] = 'application/json';
    finalBody = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers: finalHeaders,
    body: finalBody,
  });

  if (!response.ok) throw new Error(`API error: ${response.status}`);

  // Handle different response types
  if (response.status === 204) return null;  // No content
  if (responseType === 'blob') return response.blob();
  if (responseType === 'text') return response.text();
  if (responseType === 'arraybuffer') return response.arrayBuffer();
  return response.json();  // Default
}
```

2. Create each service file importing and using `apiCall`

#### Changes Required
| File | Lines | Action |
|------|-------|--------|
| api.js | 675 | Split into 8 files (~80-100 lines each) |
| photocat-app.js | ~30 | Update imports |
| image-editor.js | ~5 | Update imports |

### 1.3 Extract Common Filter Helpers
**File**: `frontend/services/filters.js` (NEW)
**Effort**: 0.5 day
**Impact**: MEDIUM
**Important**: These are UI-state helpers ONLY, not data filtering

Extract repeated patterns from photocat-app.js:

```javascript
// UI STATE HELPERS - for managing filter UI and query building only
// All actual filtering happens server-side in the API

export function buildFilterQuery(filters) {
  // Converts UI filter state object to API query parameters
  // Does NOT filter actual data - only builds URL params
  const params = new URLSearchParams();
  if (filters.keywords?.length) params.set('keywords', filters.keywords.join(','));
  if (filters.category) params.set('category', filters.category);
  if (filters.minRating) params.set('min_rating', filters.minRating);
  return params.toString();
}

export function resetFilterState() {
  // Provides default filter state for UI
  return {
    keywords: [],
    category: '',
    minRating: 0,
    sortBy: 'date_desc',
  };
}

export function updateFilterState(current, field, value) {
  // Immutable filter state updates
  return { ...current, [field]: value };
}
```

**Rationale**: Server-side filtering is canonical. Client-side helpers only manage UI state and construct API requests. This prevents data inconsistency.

#### Files Affected
- photocat-app.js: -150 lines (filter building code)

### 1.4 Extract EXIF Utilities
**File**: `src/photocat/utils/exif_helpers.py` (NEW)
**Effort**: 0.5 day
**Impact**: LOW-MEDIUM

Consolidate EXIF extraction from:
- `cli.py` lines 426-431
- `cli.py` lines 952-960
- `image/__init__.py` ImageProcessor.extract_exif()

Create unified interface with graceful degradation:
```python
def extract_all_exif(image_path):
    """
    Extract EXIF from both PIL and piexif with graceful fallback.

    Returns normalized dict with timezone-aware datetime.
    Handles missing libraries gracefully.
    """
    exif_data = {}

    # Try PIL first (always available)
    try:
        from PIL import Image
        img = Image.open(image_path)
        exif_dict = img._getexif() if hasattr(img, '_getexif') else {}
        if exif_dict:
            exif_data.update(normalize_exif_fields(exif_dict))
    except Exception as e:
        logger.debug(f"PIL EXIF extraction failed: {e}")

    # Try piexif for deeper data (optional dependency)
    try:
        import piexif
        exif_dict = piexif.load(image_path)
        if exif_dict:
            exif_data.update(normalize_exif_fields(exif_dict))
    except ImportError:
        pass  # piexif optional
    except Exception as e:
        logger.debug(f"piexif extraction failed: {e}")

    # Normalize timezone-aware timestamps
    if 'datetime' in exif_data:
        exif_data['datetime'] = parse_exif_datetime(exif_data['datetime'])

    return exif_data

def parse_exif_datetime(dt_string):
    """Convert EXIF datetime to timezone-aware Python datetime."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    # EXIF format: "YYYY:MM:DD HH:MM:SS" (no timezone info)
    try:
        dt = datetime.strptime(dt_string, "%Y:%m:%d %H:%M:%S")
        # Use UTC as default since EXIF has no timezone
        return dt.replace(tzinfo=ZoneInfo('UTC'))
    except (ValueError, Exception) as e:
        logger.warning(f"Failed to parse EXIF datetime: {e}")
        return None
```

**Rationale**:
- Graceful library fallback prevents import errors when piexif missing
- Timezone normalization prevents comparison bugs across tenants
- Centralized parsing prevents duplication

---

## Phase 2: Backend Refactoring (5-7 Days)

### Goal
Decompose large backend files and fix database query patterns.

### 2.1 Split CLI into Command Pattern
**Directory**: `src/photocat/cli/commands/` (NEW)
**Effort**: 2 days
**Impact**: HIGH (1,042 → 10 files ~100 lines each)

#### Current Structure
```
cli.py
├── ingest (lines 46-130)
├── refresh_metadata (lines 150-400)
├── build_embeddings (lines 466-511)
├── train_keyword_models (lines 513-538)
├── recompute_trained_tags (lines 540-646)
├── list_images (lines 648-665)
├── show_config (lines 667-695)
├── retag (lines 698-817)
└── sync_dropbox (lines 820-1039)
```

#### New Structure
```
cli/
├── __init__.py (entry point with command registration)
├── commands/
│   ├── __init__.py
│   ├── ingest.py (80-120 LOC)
│   ├── metadata.py (140-180 LOC - refresh_metadata logic)
│   ├── embeddings.py (80-120 LOC)
│   ├── training.py (180-220 LOC - train + recompute)
│   ├── retagging.py (120-160 LOC)
│   ├── sync.py (200-250 LOC - sync_dropbox)
│   └── inspect.py (80-100 LOC - list_images, show_config)
├── utils/
│   ├── image_processor.py (shared image processing)
│   ├── exif_helpers.py (shared EXIF parsing)
│   └── progress.py (shared progress tracking)
└── base.py (base command class with shared setup)
```

#### Implementation Steps

1. **Create base command class** (`cli/base.py`):
```python
class CliCommand:
    def __init__(self):
        self.engine = None
        self.Session = None
        self.db = None

    def setup_db(self):
        self.engine = create_engine(settings.database_url)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

    def cleanup_db(self):
        if self.db:
            self.db.close()
```

2. **Extract each command**:
```python
# cli/commands/sync.py
@click.command(name='sync-dropbox')
@click.option('--tenant-id', default='demo')
@click.option('--count', default=1)
@click.option('--model', type=click.Choice(['siglip', 'clip']))
def sync_dropbox_command(tenant_id, count, model):
    cmd = SyncDropboxCommand(tenant_id, count, model)
    cmd.run()

class SyncDropboxCommand(CliCommand):
    def __init__(self, tenant_id, count, model):
        super().__init__()
        self.tenant_id = tenant_id
        self.count = count
        self.model = model

    def run(self):
        self.setup_db()
        try:
            # Previous sync_dropbox logic here
            pass
        finally:
            self.cleanup_db()
```

3. **Update main CLI** (`cli/__init__.py`) with backward compatibility:
```python
from .commands import sync, ingest, metadata, embeddings

@click.group()
def cli():
    """PhotoCat CLI"""
    pass

# Register commands (names match existing CLI for backward compatibility)
cli.add_command(sync.sync_dropbox_command, name='sync-dropbox')
cli.add_command(ingest.ingest_command, name='ingest')
cli.add_command(metadata.refresh_metadata_command, name='refresh-metadata')
# etc.
```

**Backward Compatibility**:
- Keep command names identical (`photocat sync-dropbox` still works)
- Update `pyproject.toml` console_scripts entrypoint to point to `cli:cli`
- Test: `photocat sync-dropbox --help` should work pre/post-refactor

#### Files to Modify/Create
| File | Action | Impact |
|------|--------|--------|
| cli.py | Delete | Move content to commands/ |
| cli/__init__.py | Create | New entry point |
| cli/base.py | Create | Base command class |
| cli/commands/*.py | Create | 7 command files |
| cli/utils/*.py | Create | Shared utilities |

### 2.2 Fix Database Query Performance
**Files**: `src/photocat/routers/filtering.py`, `images/core.py`
**Effort**: 2 days
**Impact**: HIGH (3-4x performance on filters)

#### Problem: Materialized Sets
Current approach materializes entire result sets:

```python
# INEFFICIENT - loads ALL matching image IDs into memory
def apply_list_filter(db, tenant, list_id, existing_filter=None):
    rows = db.query(PhotoListItem.image_id).filter(...).all()
    result_ids = {row[0] for row in rows}
    if existing_filter is None:
        return result_ids
    return existing_filter.intersection(result_ids)
```

For tenant with 100k images and multiple filters:
- Filter 1: Load 50k IDs
- Filter 2: Load 30k IDs
- Filter 3: Load 20k IDs
- Intersect in Python: O(N) memory usage

#### Solution: Use SQLAlchemy Subqueries

```python
from sqlalchemy import and_, or_

def apply_list_filter(db, tenant, list_id):
    """Return SQLAlchemy subquery instead of materialized set."""
    return db.query(PhotoListItem.image_id).filter(
        PhotoListItem.tenant_id == tenant.id,
        PhotoListItem.list_id == list_id
    ).subquery()

def apply_multiple_filters(db, tenant, criteria):
    """Combine filters using SQL logic."""
    query = db.query(ImageMetadata.id).filter(
        ImageMetadata.tenant_id == tenant.id
    )

    if 'list_id' in criteria:
        list_ids = apply_list_filter(db, tenant, criteria['list_id'])
        query = query.filter(ImageMetadata.id.in_(list_ids))

    if 'keywords' in criteria:
        kw_ids = apply_keyword_filter(db, tenant, criteria['keywords'])
        query = query.filter(ImageMetadata.id.in_(kw_ids))

    # Single query executes at db layer
    return query
```

**Performance Validation**:
- Add indexes on frequently-filtered columns (done in migration if not present)
- Monitor query plan: `EXPLAIN ANALYZE` on refactored queries before/after
- Verify count() doesn't regress (may need separate index on ImageMetadata.id)
- Benchmark with real data: 10k, 100k, 1M image datasets

#### Changes Required

| File | Lines | Action |
|------|-------|--------|
| filtering.py | 200+ | Replace materialized sets with subqueries |
| images/core.py | 486 | Refactor list_images to use new query builder |

### 2.3 Refactor list_images Endpoint
**File**: `src/photocat/routers/images/core.py` (lines 37-523)
**Effort**: 1.5 days
**Impact**: MEDIUM (performance + maintainability)

#### Current Problem
486-line function with 7 different filtering paths:

```
list_images (486 lines):
├── Path 1: Category filters (lines 105-223)
├── Path 2: Legacy keyword filters OR (lines 233-298)
├── Path 3: Legacy keyword filters AND (lines 300-366)
├── Path 4: Default no filters (lines 375-412)
├── Path 5: Response building
├── Path 6: Keyword loading
└── Path 7: Tag aggregation
```

Each path rebuilds query logic independently.

#### Solution: Extract Query Builder

Create `src/photocat/routers/images/query_builder.py`:

```python
class ImageQueryBuilder:
    def __init__(self, db, tenant_id):
        self.db = db
        self.tenant_id = tenant_id
        self.query = db.query(ImageMetadata).filter(
            ImageMetadata.tenant_id == tenant_id
        )

    def add_category_filter(self, category):
        """Add category filter to query."""
        # Implementation
        return self

    def add_keyword_filters(self, keywords, operator='AND'):
        """Add keyword filters with AND/OR logic."""
        # Implementation
        return self

    def add_list_filter(self, list_id):
        """Add list filter."""
        # Implementation
        return self

    def add_rating_filter(self, min_rating, operator='gte'):
        """Add rating filter."""
        # Implementation
        return self

    def build(self):
        """Return final query."""
        return self.query
```

Then refactor list_images:

```python
@router.get("/images")
async def list_images(...):
    builder = ImageQueryBuilder(db, tenant.id)

    if category:
        builder.add_category_filter(category)
    if keywords:
        builder.add_keyword_filters(keywords, keyword_operator)
    if list_id:
        builder.add_list_filter(list_id)
    if min_rating:
        builder.add_rating_filter(min_rating)

    # Single unified query
    query = builder.build()
    total = query.count()
    images = query.order_by(...).offset(...).limit(...).all()

    # Load keywords once for all images
    keyword_map = load_keywords_map(db, extract_keyword_ids(images))

    # Build response
    return format_image_response(images, keyword_map, ...)
```

**Critical Tests for Query Builder**:
- Relevance sorting preserved: keyword OR/AND filters return same ordering as old code
- Pagination totals consistent: total count matches actual filtered results
- Edge cases: empty keyword lists, missing categories, zero-rating filters
- Equivalence test: run same query against old and new implementations, verify identical results

**Test Fixture**:
```python
# tests/test_query_builder.py
@pytest.fixture
def sample_data(db, tenant):
    """Golden dataset for query equivalence testing."""
    # Create 10 images with various combinations of:
    # - 3 categories (landscape, portrait, abstract)
    # - 5 keywords per category
    # - Keywords with 0-10 machine tags each
    # - Ratings from 0-5
    # - Dates across 1 month
    ...

def test_query_builder_equivalence(sample_data, db, tenant):
    """Verify new builder returns identical results to old code."""
    old_results = old_list_images_logic(db, tenant, criteria)
    new_results = ImageQueryBuilder(db, tenant.id).build().all()
    assert old_results == new_results
```

#### Files to Create/Modify

| File | Action | Impact |
|------|--------|--------|
| query_builder.py | Create | Extract query building |
| core.py | Modify | Reduce from 486 → 150 lines |
| filtering.py | Modify | Use query builder approach |

---

## Phase 3: Frontend Refactoring (4-6 Days)

### Goal
Decompose photocat-app.js and create focused container components.

### 3.1 Create Container Component Architecture
**Effort**: 3-4 days
**Impact**: CRITICAL (2,938 → 1,200 lines main component)

#### Current Issues
photocat-app.js handles:
- Tab management (what users see)
- Home view state (homeTagStats, homeImages, pagination)
- Curation view state (50+ properties for curation)
- ML training state (30+ properties)
- List management (15+ properties)
- Modals (10+ properties)
- Event coordination (40+ handlers)

#### New Architecture

```
frontend/components/
├── photocat-app.js (MAIN ORCHESTRATOR - ~600 lines)
│   └── Responsibilities: Tab routing, tenant context, list management
│
├── containers/
│   ├── HomeContainer.js (~400 lines)
│   │   └── home tab state + logic
│   ├── CurateContainer.js (~500 lines)
│   │   └── curation tab state + logic
│   ├── MlContainer.js (~300 lines)
│   │   └── ML training tab state + logic
│   └── AdminContainer.js (~200 lines)
│       └── admin settings state + logic
│
└── [existing components]
    ├── image-gallery.js
    ├── image-card.js
    ├── filter-controls.js
    └── [others]
```

**Event Contract** (before starting Phase 3):
```
Container → photocat-app (dispatch custom events):
- home-container fires: 'list-selected', 'modal-open'
- curate-container fires: 'batch-process-complete', 'filter-change'
- ml-container fires: 'training-started', 'training-complete'

photocat-app → Containers (pass as properties):
- tenant (immutable object)
- lists (array, triggers full re-fetch on change)
- activeListId (scalar, triggers sync in container)

Important: Containers NEVER communicate directly. All cross-container updates go through photocat-app.
```

#### HomeContainer.js (~400 lines)
**Responsibilities**:
- Home tab rendering
- Tag statistics management
- Get Started section logic
- Curate home histogram display

```javascript
import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';

class HomeContainer extends LitElement {
  static properties = {
    tenant = {};
    homeTagStats = {};
    tagStatsBySource = {};
    activeCurateTagSource = 'permatags';
    curateCategoryCards = [];
    // Only home-specific properties
  };

  // Only home-specific methods
  async _loadTagStats() { }
  _handleCurateTagSourceChange(e) { }
  _formatStatNumber(num) { }

  render() {
    // Home tab content only
    return html`
      <div class="space-y-6">
        <!-- Home tab UI -->
      </div>
    `;
  }
}

customElements.define('home-container', HomeContainer);
```

#### CurateContainer.js (~500 lines)
**Responsibilities**:
- Curate tab rendering
- Curation view state (selected images, tag choices, etc.)
- Drag-drop orchestration
- Batch processing

```javascript
class CurateContainer extends LitElement {
  static properties = {
    tenant = {};
    lists = [];
    curateMode = 'explore';
    curateImages = [];
    curateSelectedImages = new Set();
    curateTagChoices = {};
    // Only curation-specific properties
  };

  // Only curation-specific methods
  _handleCurateFilterChange(e) { }
  _handleDragStart(e) { }
  _handleDrop(e) { }
  _handleCurateProcess() { }
}
```

#### MlContainer.js (~300 lines)
**Responsibilities**:
- ML training tab
- Training dataset management
- ML stats display

#### Updated photocat-app.js (~600 lines)
**Responsibilities**:
- Tab routing (which container to show)
- Tenant management (X-Tenant-ID header)
- List management (load, save, delete)
- Modal orchestration
- Window resize handling
- Command queue polling

```javascript
class PhotoCatApp extends LitElement {
  static properties = {
    // Only app-level properties
    activeTab = 'home';
    tenant = null;
    lists = [];
    activeListId = null;
    selectedImage = null;
    showModal = false;
  };

  render() {
    return html`
      <div class="app-layout">
        <nav>${this._renderTabs()}</nav>
        <main>
          ${this.activeTab === 'home' ? html`<home-container .tenant=${this.tenant}></home-container>` : html``}
          ${this.activeTab === 'curate' ? html`<curate-container .tenant=${this.tenant}></curate-container>` : html``}
          ${this.activeTab === 'ml' ? html`<ml-container .tenant=${this.tenant}></ml-container>` : html``}
          ${this.activeTab === 'admin' ? html`<admin-container .tenant=${this.tenant}></admin-container>` : html``}
        </main>
        ${this.showModal ? html`<image-modal .image=${this.selectedImage}></image-modal>` : html``}
      </div>
    `;
  }

  // Only app-level handlers
  _handleTabChange(tab) { }
  _handleListSelect(listId) { }
}
```

#### Implementation Steps

1. **Create container components** (one at a time):
   - Extract state from photocat-app.js
   - Extract related handlers
   - Extract render logic for tab
   - Move to new file

2. **Update photocat-app.js**:
   - Add container elements to main render
   - Pass tenant, lists, and callbacks as props
   - Remove tab-specific logic

3. **Update event handling**:
   - Containers dispatch custom events
   - photocat-app listens and handles list/modal updates
   - Containers don't manipulate siblings

#### Files to Modify/Create

| File | Action | LOC Change |
|------|--------|------------|
| photocat-app.js | Refactor | 2,938 → 600 |
| containers/HomeContainer.js | Create | 400 |
| containers/CurateContainer.js | Create | 500 |
| containers/MlContainer.js | Create | 300 |
| containers/AdminContainer.js | Create | 200 |

### 3.2 Extract Filter Helper Module
**File**: Already planned in Phase 1
**Already done in Phase 1.3**

### 3.3 Consolidate Image Editor
**File**: `frontend/components/image-editor.js` (703 lines)
**Effort**: 1 day
**Impact**: LOW-MEDIUM

Currently handles:
- Image display (modal UI)
- Permatag management
- Tag editing

Could split:
- `image-viewer.js`: Just image display
- `permatag-editor.js`: Tag editing logic

Consider if useful or over-engineering.

---

## Phase 4: Polish & Optimization (2-3 Days)

### 4.1 Add Comprehensive Tests
**Effort**: 2 days
**Impact**: MEDIUM (prevents regressions)

Priority areas:
- New query builder (images/query_builder.py)
- New API services (frontend)
- Container components

**Golden Dataset Fixture** (for performance validation):
```python
# tests/fixtures/sample_data.py
@pytest.fixture
def golden_dataset(db, tenant):
    """
    Small but realistic dataset for query benchmarking.
    - 5,000 images (small enough for quick testing, large enough to catch N+1)
    - 50 keywords across 5 categories
    - 2-3 machine tags per image on average
    - Mix of list memberships
    """
    # Create images with realistic distribution
    for i in range(5000):
        img = ImageMetadata(
            tenant_id=tenant.id,
            filename=f"image_{i:05d}.jpg",
            date_taken=datetime(2025, 1, 1) + timedelta(days=i % 365),
            rating=random.randint(0, 5),
        )
        db.add(img)
        # Add random tags, keywords, etc.
    db.commit()
    return {"image_count": 5000, "keyword_count": 50}

# Usage:
def test_query_performance(golden_dataset, benchmark):
    """Verify query builder stays sub-500ms on realistic data."""
    builder = ImageQueryBuilder(db, tenant.id)
    builder.add_keyword_filters(['landscape', 'outdoor'])
    query = builder.build()
    result = benchmark(query.all)  # pytest-benchmark plugin
    assert result.timing.total < 0.5  # 500ms threshold
```

### 4.2 Update Documentation
**Effort**: 1 day

Create/update:
- `ARCHITECTURE.md`: New component hierarchy
- `CLI_COMMANDS.md`: New command structure
- `CONTRIBUTING.md`: Patterns for new features

### 4.3 Performance Benchmarking
**Effort**: 0.5 days

Measure improvements:
- Query performance on list endpoint
- Component render times
- API response times

---

## Rollout Strategy

### Approach: Incremental Refactoring

**Do NOT** refactor entire app at once. Instead:

1. **Phase 1 (Week 1)**: Backend utilities + API service split (lowest risk)
2. **Phase 2 (Week 2)**: CLI decomposition + query optimization (mid risk)
3. **Phase 3 (Week 3-4)**: Frontend container extraction (higher risk, do incrementally)

### Testing Strategy

1. **After Phase 1**: Run existing tests, verify API still works
2. **After Phase 2**: CLI tests, performance benchmark queries
3. **After Phase 3**: E2E tests for each container, visual regression

### Deployment Strategy

1. Deploy Phase 1 changes (internal utilities, safe)
2. Deploy Phase 2 changes (query optimization, with correctness validation)
3. Deploy Phase 3 incrementally (one container at a time)

**Phase 2 Deployment Checklist** (Query Optimization):
Before merging/deploying query builder changes:
- [ ] Run equivalence test: old vs new implementations return identical results
- [ ] Run equivalence test on staging database (production-sized data)
- [ ] Verify pagination totals match (no off-by-one errors)
- [ ] Verify sort order matches (keyword relevance ranking unchanged)
- [ ] Monitor query execution times (expect 3-4x improvement, alert if regressed)
- [ ] Monitor error rates (should stay at 0)
- [ ] Canary deploy: 5% traffic to new code, monitor for 30 min
- [ ] Full rollout if no issues

---

## Success Metrics

### Code Quality
- [ ] Remove all files >700 lines
- [ ] Eliminate 10+ duplicated patterns
- [ ] All components <600 lines

### Performance
- [ ] List endpoint: 3-4x faster on large datasets
- [ ] Query count: Reduce from 5+ to 2-3 per list request
- [ ] Memory usage: Eliminate materialized sets

### Maintainability
- [ ] New developer can understand tab flow in <1 hour
- [ ] Adding new CLI command takes <15 minutes
- [ ] New feature doesn't require changes to 5+ files

---

## Risk Assessment

| Phase | Risk | Mitigation |
|-------|------|-----------|
| 1 | Low | Utilities are additive, don't change existing code paths |
| 2 | Medium | Query builder - comprehensive tests needed |
| 3 | Medium-High | UI refactoring - need E2E tests, deploy incrementally |

---

## Effort Estimate

| Phase | Days | Priority | Risk |
|-------|------|----------|------|
| Phase 1 | 3-4 | HIGH | LOW |
| Phase 2 | 5-7 | HIGH | MEDIUM |
| Phase 3 | 4-6 | MEDIUM | MEDIUM-HIGH |
| Phase 4 | 2-3 | MEDIUM | LOW |
| **TOTAL** | **14-20** | | |

---

## Decision Points

Before starting, clarify:

1. **Scope**: Do all phases at once, or phase by phase?
2. **CLI**: Is sync-dropbox CLI command used in production? (If not, lower priority)
3. **Frontend**: Should we use Redux/state management, or keep prop-based?
4. **Testing**: What's the minimum test coverage needed?
5. **Timeline**: Must this complete before next feature freeze?

---

## Appendix: File Change Summary

### Files to Create
- `src/photocat/config/db_utils.py`
- `src/photocat/cli/base.py`
- `src/photocat/cli/__init__.py`
- `src/photocat/cli/commands/*.py` (7 files)
- `src/photocat/cli/utils/*.py` (3 files)
- `src/photocat/routers/images/query_builder.py`
- `frontend/services/api/*.js` (7-8 files)
- `frontend/services/filters.js`
- `frontend/components/containers/HomeContainer.js`
- `frontend/components/containers/CurateContainer.js`
- `frontend/components/containers/MlContainer.js`
- `frontend/components/containers/AdminContainer.js`

### Files to Modify
- `cli.py` (delete after moving content)
- `src/photocat/routers/images/core.py` (486 → 150 lines)
- `src/photocat/routers/filtering.py` (200+ lines updated)
- `src/photocat/routers/images/permatags.py` (use new utils)
- `src/photocat/routers/lists.py` (use new utils)
- `src/photocat/routers/sync.py` (use new utils)
- `frontend/services/api.js` (split into separate files)
- `frontend/components/photocat-app.js` (2,938 → 600 lines)
- All files importing from api.js (update imports)

### Files Unchanged
- Models (metadata/__init__.py)
- Settings (settings.py)
- Dependencies (requirements.txt)
- Existing components (image-gallery.js, filter-controls.js, etc.)

---

## Next Steps

1. **Review this plan** - feedback on phases, priorities, approach
2. **Get approval** on scope and timeline
3. **Start Phase 1** if approved
4. **Create tickets** for each Phase 1 task
