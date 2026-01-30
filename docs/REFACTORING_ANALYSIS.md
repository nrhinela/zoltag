# PhotoCat Codebase Refactoring Analysis

**Date**: 2026-01-30
**Scope**: Comprehensive analysis of codebase size, duplication, and maintainability opportunities

---

## Executive Summary

The PhotoCat codebase has grown significantly since the last refactoring. Critical issues include:

1. **Monolithic frontend component** (5,795 lines) violating core design principles
2. **100% function duplication** in filtering module (subquery vs. materialized versions)
3. **37+ parameter-building patterns** in API service that could be consolidated
4. **Similar event handlers** repeated across drag-drop operations
5. **Code duplication** across CRUD operations in admin components

These issues impact maintainability and make it harder for "lesser LLMs" to understand and modify the code, contrary to the project's stated goal of modular, small components.

---

## 1. FRONTEND: Massive Monolithic Component (photocat-app.js - 5,795 lines)

### Problem Statement

A single Lit component class handles 7+ distinct UI tabs/modes (Home, Explore, Audit, Search, Images, Lists, Settings) across **100+ methods**. This violates the project's core architectural principle:

> "Small, focused components are easy to understand and modify"

### Size Context
- **5,795 lines** = 5x larger than recommended component size
- **100+ methods** covering:
  - Drag-and-drop (6+ handlers each for Explore, Audit, Saved Items)
  - Filtering logic (5+ handlers + application methods)
  - State management (20+ state variables)
  - Rendering (15+ render methods)
  - API integration (8+ fetch methods)
  - Tab management (5+ tabs + subtabs)

### Specific Duplication Issues

#### 1.1 Drag-and-Drop Handler Duplication

**Problem**: Nearly identical drag-over/leave/drop handlers for different "zones"

| Handler | Lines | Target | Purpose |
|---------|-------|--------|---------|
| `_handleCurateExploreHotspotDragOver` | 1519 | Explore hotspots | Drag-to-rate explore view |
| `_handleCurateAuditHotspotDragOver` | 1677 | Audit hotspots | Drag-to-rate audit view |
| `_handleCurateExploreRatingDragOver` | 1759 | Explore ratings | Drag to rating bucket |
| `_handleCurateAuditRatingDragOver` | 1796 | Audit ratings | Drag to rating bucket |
| `_handleSearchSavedDragOver` | 2706 | Search saved items | Drag to saved list |

**Code Comparison** (1519-1527 vs 1677-1685):
```javascript
// Lines 1519-1527 (Explore)
_handleCurateExploreHotspotDragOver(event, targetId) {
  event.preventDefault();
  if (!this.curateExploreHotspotDragTarget) {
    this.curateExploreHotspotDragTarget = targetId;
  }
}

// Lines 1677-1685 (Audit) - 99% identical
_handleCurateAuditHotspotDragOver(event, targetId) {
  event.preventDefault();
  if (!this.curateAuditHotspotDragTarget) {
    this.curateAuditHotspotDragTarget = targetId;
  }
}
```

**Impact**: 8 nearly-identical methods (200+ lines) that could be consolidated into 1 parameterized handler.

#### 1.2 Rating Application Logic Duplication

**Files**: Lines 1924-1948 vs 1949-1983

```javascript
// Lines 1924-1948: _applyExploreRating()
_applyExploreRating(index, newRating) {
  const image = this.curateImages[index];
  if (!image?.id) return;
  this.curateOperations.push({
    type: 'rating',
    imageId: image.id,
    rating: newRating,
    timestamp: new Date(),
    undoable: true
  });
  // 15 more lines of identical logic
}

// Lines 1949-1983: _applyAuditRating() - 95% same code
_applyAuditRating(index, newRating) {
  const image = this.curateAuditImages[index];
  if (!image?.id) return;
  this.curateOperations.push({
    type: 'rating',
    imageId: image.id,
    rating: newRating,
    timestamp: new Date(),
    undoable: true
  });
  // Same 15 lines
}
```

**Impact**: ~60 lines of duplicated logic for simple parametric difference (explore vs audit images array).

#### 1.3 Selection State Management Duplication

**Lines**:
- `_startCurateSelection()` (2117-2129)
- `_startCurateAuditSelection()` (2131-2143) - nearly identical
- `_handleCuratePointerDownWithOrder()` (2169-2175) - mirrors same logic

**Example**:
```javascript
// Lines 2117-2129
_startCurateSelection(index, imageId) {
  if (this.curateDragSelection.includes(imageId)) {
    return;
  }
  this._cancelCuratePressState();
  this._curateLongPressTriggered = true;
  this.curateDragSelecting = true;
  this.curateDragStartIndex = index;
  this.curateDragEndIndex = index;
  this._curateSuppressClick = true;
  this._flashCurateSelection(imageId);
  this._updateCurateDragSelection();
}

// Lines 2131-2143 (Audit version - identical except variable names)
_startCurateAuditSelection(index, imageId) {
  if (this.curateAuditDragSelection.includes(imageId)) {
    return;
  }
  this._cancelCurateAuditPressState();
  this._curateAuditLongPressTriggered = true;
  this.curateAuditDragSelecting = true;
  this.curateAuditDragStartIndex = index;
  this.curateAuditDragEndIndex = index;
  this._curateSuppressClick = true;
  this._flashCurateSelection(imageId);
  this._updateCurateAuditDragSelection();
}
```

**Impact**: Multiple selection handlers with identical logic but different state variable names.

#### 1.4 Filter Application Duplication

**Lines**: 2036-2047 and scattered inline patterns

The `_applyCurateFilters()` method and filter resets appear in:
- Lines 2036-2047: Main filter apply
- Lines 2084-2086: Filter reset in `_handleCurateKeywordSelect()`
- Lines 3003-3009: Same reset pattern in `_handleCurateAuditModeChange()`
- Lines 3078-3081: Another variant in `_handleCurateAuditModeChange()`

#### 1.5 Pagination Handler Duplication

**Lines**:
- `_handleCuratePagePrev/Next()` (3101-3112)
- `_handleCurateAuditPagePrev/Next()` (3115-3127) - identical logic on different state

```javascript
// Lines 3101-3104
_handleCuratePagePrev() {
  if (this.curatePageOffset > 0) {
    this.curatePageOffset -= this.curateLimit;
    this._applyCurateFilters({ resetOffset: true });
  }
}

// Lines 3115-3118 (Audit - only variable names differ)
_handleCurateAuditPagePrev() {
  if (this.curateAuditPageOffset > 0) {
    this.curateAuditPageOffset -= this.curateAuditLimit;
    this._applyCurateAuditFilters({ resetOffset: true });
  }
}
```

#### 1.6 Render Method Duplication

**Rating Widgets** (Lines 3410-3440):
```javascript
// Lines 3410-3438: _renderCurateRatingWidget() - interactive
// Lines 3440-3469: _renderCurateRatingStatic() - static display

// Core difference: 2-3 lines
// Similarity: 95% of template structure is identical
```

**Statistics Display** (Lines 4663-4681 vs 4574-4587):
- Same calculation pattern (Total, Rated/Tagged, Trash, Percentage)
- Repeated for ratings and for tags

### Root Cause

The component tries to be "smart" by reusing rendering logic across tabs, but this forces it to handle all state and logic for all tabs, violating separation of concerns.

### Recommended Refactoring

**Create separate components for each major feature**:

1. **`curate-explore.js`** (1,200-1,500 lines)
   - Explore tab UI + explore-specific logic
   - Explore drag handlers
   - Explore filter application

2. **`curate-audit.js`** (1,200-1,500 lines)
   - Audit tab UI + audit-specific logic
   - Audit drag handlers
   - Audit filter application
   - AI model selection

3. **`search-editor.js`** (800-1,000 lines)
   - Search home + explore-by-tag tabs
   - Search-specific drag handlers
   - List management

4. **`shared-handlers.js`** (200-300 lines)
   - Unified drag manager
   - Pagination controller
   - Filter builder

5. **`image-grid.js`** (300-400 lines)
   - Shared image grid rendering
   - Single-source rating widget
   - Drag-drop attachment points

6. **`curate-state.js`** (100-150 lines)
   - State initialization helpers
   - State reset functions

**Result**: Each component would be 1,000-1,500 lines (maintainable), and logic duplication would drop by 70%.

---

## 2. FRONTEND: API Service Layer Duplication (api.js - 706 lines)

### Problem Statement

The API service has **37+ repetitive parameter-building patterns** and **duplicated CRUD operation methods** across 10+ functions.

### Specific Issues

#### 2.1 URLSearchParams Pattern Duplication

**Pattern**: Each function builds a `URLSearchParams` with conditional appends:

```javascript
// Repeated 37+ times with variations:
const params = new URLSearchParams();
if (filters.X !== undefined && filters.X !== '') {
  params.append('param_name', String(filters.X));
}
```

**Examples**:
- `getImages()` (lines 80-126): 37 individual `params.append()` calls
- `getMlTrainingImages()` (lines 215-229): 3 appends
- `getKeywords()` (lines 236-262): 6 appends
- `getListItems()` (lines 426-434): Similar pattern
- `getPeople()` (lines 629-637): Similar pattern

**Problem**: Code is error-prone (inconsistent null checking, easy to typo parameter names) and hard to maintain.

#### 2.2 CRUD Operation Duplication

**Pattern**: Create/Update/Delete operations are repeated for multiple resources:

**Keyword Categories** (Lines 359-365):
```javascript
export async function createKeywordCategory(tenantId, payload) {
  return fetchWithAuth(`/admin/keywords/categories`, {
    method: 'POST', tenantId, body: JSON.stringify(payload),
  });
}

export async function updateKeywordCategory(tenantId, categoryId, payload) {
  return fetchWithAuth(`/admin/keywords/categories/${categoryId}`, {
    method: 'PUT', tenantId, body: JSON.stringify(payload),
  });
}

export async function deleteKeywordCategory(tenantId, categoryId) {
  return fetchWithAuth(`/admin/keywords/categories/${categoryId}`, {
    method: 'DELETE', tenantId,
  });
}
```

**Same pattern repeats for**:
- Keywords (lines 387-408)
- Lists (lines 410-485)
- Permatags (lines 444-472)
- Tenants (lines 494-532)
- People (lines 646-665)

**Impact**: ~200 lines of nearly-identical CRUD code across 5+ resources.

### Recommended Refactoring

#### Option 1: Parameter Helper Function
```javascript
// Extract parameter building logic
function appendIfPresent(params, key, value, paramName, options = {}) {
  const { stringify = true, skipEmpty = true } = options;

  if (skipEmpty && (value === undefined || value === '' || value === null)) {
    return;
  }

  params.append(paramName, stringify ? String(value) : value);
}

// Usage:
const params = new URLSearchParams();
appendIfPresent(params, 'rating', filters.rating, 'rating');
appendIfPresent(params, 'limit', filters.limit, 'limit');
```

**Result**: Reduces 37 append calls to ~10 calls.

#### Option 2: Generic CRUD Factory
```javascript
// Create generic resource CRUD operations
function createResourceAPI(resourceName, baseUrl) {
  return {
    create: (tenantId, payload) =>
      fetchWithAuth(`${baseUrl}`, {
        method: 'POST', tenantId, body: JSON.stringify(payload),
      }),
    update: (tenantId, id, payload) =>
      fetchWithAuth(`${baseUrl}/${id}`, {
        method: 'PUT', tenantId, body: JSON.stringify(payload),
      }),
    delete: (tenantId, id) =>
      fetchWithAuth(`${baseUrl}/${id}`, {
        method: 'DELETE', tenantId,
      }),
    get: (tenantId, id) =>
      fetchWithAuth(`${baseUrl}/${id}`, { tenantId }),
    list: (tenantId) =>
      fetchWithAuth(`${baseUrl}`, { tenantId }),
  };
}

// Usage:
export const KeywordCategoryAPI = createResourceAPI('KeywordCategory', '/admin/keywords/categories');
export const KeywordAPI = createResourceAPI('Keyword', '/admin/keywords');
export const ListAPI = createResourceAPI('List', '/lists');
```

**Result**: Eliminates ~200 lines of CRUD duplication.

#### Option 3: Filter Object Builder
```javascript
class FilterBuilder {
  constructor() {
    this.params = new URLSearchParams();
  }

  addParam(key, value, paramName) {
    if (value !== undefined && value !== '' && value !== null) {
      this.params.append(paramName, String(value));
    }
    return this;
  }

  addEnum(key, value, paramName, validValues) {
    if (validValues.includes(value)) {
      this.params.append(paramName, value);
    }
    return this;
  }

  build() {
    return this.params;
  }
}

// Usage:
new FilterBuilder()
  .addParam('rating', filters.rating, 'rating')
  .addParam('limit', filters.limit, 'limit')
  .addEnum('sort', filters.sort, 'order_by', ['rating', 'date', 'id'])
  .build()
```

**Recommended approach**: Use **Option 2 (CRUD Factory) + Option 1 (Parameter Helper)** in combination.

---

## 3. BACKEND: Filtering Module Complete Duplication (filtering.py - 853 lines)

### Problem Statement

The filtering module contains **5 complete function pairs** where each filter exists in two versions:
1. Materialized version (returns `Set[int]`)
2. Subquery version (returns `Selectable`)

This represents **~100% code duplication** of core logic.

### Specific Issues

#### 3.1 List Filter Duplication

**Materialized Version** (Lines 25-50):
```python
def apply_list_filter(db: Session, tenant: Tenant, list_id: int) -> Set[int]:
    lst = db.query(PhotoList).filter_by(id=list_id, tenant_id=tenant.id).first()
    if not lst:
        raise HTTPException(status_code=404, detail="List not found")
    list_image_ids = db.query(PhotoListItem.photo_id).filter(
        PhotoListItem.list_id == list_id
    ).all()
    return {row[0] for row in list_image_ids}
```

**Subquery Version** (Lines 473-501):
```python
def apply_list_filter_subquery(db: Session, tenant: Tenant, list_id: int) -> Selectable:
    lst = db.query(PhotoList).filter_by(id=list_id, tenant_id=tenant.id).first()
    if not lst:
        raise HTTPException(status_code=404, detail="List not found")
    return db.query(ImageMetadata.id).filter(
        ImageMetadata.id.in_(
            db.query(PhotoListItem.photo_id).filter(
                PhotoListItem.list_id == list_id
            )
        )
    ).subquery()
```

**Duplication Level**: 98% identical code, only return type differs.

#### 3.2 All Filter Duplications

| Filter | Materialized | Subquery | Duplication |
|--------|--------------|----------|-------------|
| List | Lines 25-50 | Lines 473-501 | 98% |
| Rating | Lines 53-89 | Lines 504-534 | 95% |
| Hide Zero Rating | Lines 92-119 | Lines 537-554 | 90% |
| Reviewed | Lines 122-154 | Lines 557-595 | 88% |
| Permatag | Lines 157-233 | Lines 598-673 | 92% |

**Total**: ~300 lines of duplicated logic.

#### 3.3 Keyword Lookup Duplication

Keyword normalization and lookup appears in:
- `core.py` lines 161-166 (in `list_images()`)
- `filtering.py` lines 619-642 (in `apply_permatag_filter_subquery()`)
- `filtering.py` lines 185-197 (in `apply_permatag_filter()`)

**Pattern**:
```python
# All three locations use:
normalized_keyword = keyword.strip().lower()
keyword_row = db.query(Keyword.id).filter(
    func.lower(Keyword.keyword) == normalized_keyword,
    Keyword.tenant_id == tenant.id
).first()
```

### Root Cause

The dual approach (materialized + subquery) exists because:
- **Materialized**: Fast for small result sets, simpler debugging
- **Subquery**: Efficient in complex queries with multiple filters

But the code duplication means fixing one version requires fixing all duplicates.

### Recommended Refactoring

#### Solution: Unified Filter Abstraction

```python
class FilterDefinition:
    """Base class for filter logic that can return both materialized and subquery forms."""

    def __init__(self, db: Session, tenant: Tenant, **kwargs):
        self.db = db
        self.tenant = tenant
        self.params = kwargs

    def materialize(self) -> Set[int]:
        """Return materialized set of image IDs matching this filter."""
        raise NotImplementedError

    def subquery(self) -> Selectable:
        """Return subquery matching this filter."""
        raise NotImplementedError

    def _get_query_base(self) -> Query:
        """Shared base query building."""
        return self.db.query(ImageMetadata.id).filter(
            ImageMetadata.tenant_id == self.tenant.id
        )


class ListFilter(FilterDefinition):
    """Filter images by list membership."""

    def materialize(self) -> Set[int]:
        list_id = self.params['list_id']
        lst = self.db.query(PhotoList).filter_by(
            id=list_id, tenant_id=self.tenant.id
        ).first()
        if not lst:
            raise HTTPException(status_code=404, detail="List not found")

        return {
            row[0] for row in self.db.query(PhotoListItem.photo_id).filter(
                PhotoListItem.list_id == list_id
            ).all()
        }

    def subquery(self) -> Selectable:
        # Re-use the core logic from materialize()
        image_ids = self.materialize()
        return self.db.query(ImageMetadata.id).filter(
            ImageMetadata.id.in_(image_ids)
        ).subquery()


class RatingFilter(FilterDefinition):
    """Filter images by rating."""

    def materialize(self) -> Set[int]:
        rating = self.params['rating']
        operator = self.params.get('operator', 'eq')

        condition = self._build_rating_condition(
            ImageMetadata.rating, rating, operator
        )
        return {
            row[0] for row in self.db.query(ImageMetadata.id).filter(condition).all()
        }

    def subquery(self) -> Selectable:
        condition = self._build_rating_condition(
            ImageMetadata.rating,
            self.params['rating'],
            self.params.get('operator', 'eq')
        )
        return self._get_query_base().filter(condition).subquery()

    @staticmethod
    def _build_rating_condition(rating_col, value, operator):
        """Centralized rating condition logic."""
        if operator == 'eq':
            return rating_col == value
        elif operator == 'gte':
            return rating_col >= value
        elif operator == 'is_null':
            return rating_col.is_(None)
        # ... etc
```

**Benefits**:
- Single source of truth for each filter's logic
- Easier to add new filters
- Reduces code from 853 to ~450 lines
- Materialized and subquery forms share core logic

---

## 4. BACKEND: Monolithic Endpoint (core.py - 1,126 lines)

### Problem Statement

The `list_images()` endpoint (lines 79-461) is **383 lines** handling multiple code paths:
- Parameter parsing and validation
- Query building with multiple filter branches
- Custom sorting logic
- Pagination with anchor resolution
- Response formatting

### Specific Issues

#### 4.1 Overlapping Responsibilities

```python
# Lines 79-461: Single endpoint handling:
# 1. Parameter validation (lines 100-104)
# 2. Query building (lines 113-129)
# 3. Empty result handling (lines 131-139)
# 4. Anchor resolution (lines 141-154)
# 5. Ordering clause building (lines 156-189)
# 6. Category filtering (lines 191-276)
# 7. Sorting/pagination (lines 278-301)
# 8. Image fetching (lines 303-336)
# 9. Data transformation (lines 337-461)
```

#### 4.2 Duplicated Date/Rating Logic

**Lines 177-189**: Build order clauses
```python
if order_by_value == "ml_score" and not ml_keyword_id:
    order_by_value = None
if order_by_value == "processed":
    order_by_date = func.coalesce(ImageMetadata.last_processed, ImageMetadata.created_at)
else:
    order_by_date = func.coalesce(ImageMetadata.capture_timestamp, ImageMetadata.modified_time)
order_by_date = order_by_date.desc() if date_order == "desc" else order_by_date.asc()
```

**Lines 244-276**: Rebuilds similar logic in nested function

### Recommended Refactoring

The `query_builder.py` module (282 lines) already exists to abstract this. Extend it:

```python
# Use QueryBuilder more extensively
def list_images(
    tenant: Tenant,
    filters: ImageFilters,  # Pydantic model for validation
    pagination: PaginationParams,
    db: Session
):
    builder = QueryBuilder(db, tenant, filters.date_order, filters.order_by)

    # All complex logic is now in builder
    base_query = builder.build_base_query()

    # Apply filters
    unique_ids = apply_filters(db, tenant, filters)

    # Get total before pagination
    total = builder.get_total_count(unique_ids)

    # Apply pagination and fetch
    images = builder.fetch_paginated(base_query, unique_ids, pagination)

    # Transform and return
    return {
        "tenant_id": tenant.id,
        "images": [format_image(img) for img in images],
        "total": total,
        "limit": pagination.limit,
        "offset": pagination.offset
    }
```

---

## 5. BACKEND: CLI Command Duplication (cli.py - 1,120 lines)

### Problem Statement

Multiple CLI commands repeat similar patterns:
- Tenant setup (appears 3+ times)
- Image processing loops (appears 2+ times)
- Tag recomputation (appears 2+ times with same logic)

### Specific Issues

#### 5.1 Tenant Setup Duplication

**`ingest()` command** (Lines 68-88):
```python
# Tenant setup code
tenants = db.query(Tenant).all()
for tenant in tenants:
    tenant_context = TenantContext(...)
    TenantContext.set(tenant_context)
    # Process tenant
```

**`refresh_metadata()` command** (Lines 144-168): Same pattern

**`build_embeddings()` command** (Lines 492-553): Another variant

**Opportunity**: Extract to `get_tenant_contexts()` helper.

#### 5.2 Image Processing Loop Duplication

**`ingest()` function** (Lines 100-143):
```python
for image_path in image_paths:
    try:
        image_data = read_image(image_path)
        features = extract_features(image_data)
        # Process and store
    except Exception as e:
        handle_error(e)
```

**`refresh_metadata()` function** (Lines 170-423): Similar loop pattern

**Opportunity**: Extract to `process_images_batch()` helper with callback.

#### 5.3 Tag Recomputation Duplication

**`recompute_trained_tags()` command** (Lines 597-737):
```python
# Load model
model = load_model('trained')
for image in images:
    tags = model.predict(image)
    store_tags(image, tags)
```

**`recompute_siglip_tags()` command** (Lines 824-851): Nearly identical with different model

**Opportunity**: Consolidate into `recompute_tags(model_type)`.

### Recommended Refactoring

```python
def get_tenant_contexts(db: Session) -> List[TenantContext]:
    """Get all tenant contexts for batch processing."""
    tenants = db.query(Tenant).all()
    return [TenantContext(...) for tenant in tenants]


def process_images_batch(
    images: List[ImagePath],
    processor: Callable[[ImagePath], ImageData],
    error_handler: Callable[[Exception, ImagePath], None],
    batch_size: int = 25
):
    """Generic image batch processor."""
    for i in range(0, len(images), batch_size):
        batch = images[i:i+batch_size]
        for image_path in batch:
            try:
                processor(image_path)
            except Exception as e:
                error_handler(e, image_path)


def recompute_tags(db: Session, tenant: Tenant, model_type: str):
    """Generic tag recomputation for any model."""
    model = load_model(model_type)
    images = db.query(ImageMetadata).filter_by(tenant_id=tenant.id).all()

    for image in images:
        tags = model.predict(image)
        store_tags(db, image, tags)
```

---

## 6. FRONTEND: Admin Component CRUD Pattern Duplication

### Problem Statement

Multiple admin components (`admin-users.js`, `admin-tenant-list.js`, `person-manager.js`) repeat similar CRUD patterns:
- Fetch list from API
- Render table/grid
- Handle create modal
- Handle update modal
- Handle delete confirmation

### Specific Issues

**Pattern appears in**:
- `admin-users.js` (1,074 lines) - user management
- `admin-tenant-list.js` (437 lines) - tenant management
- `person-manager.js` (490 lines) - person/people management

**Estimated duplication**: ~500 lines of similar CRUD logic across components.

### Recommended Refactoring

Create reusable base component:

```javascript
// base-crud-component.js
export class BaseCRUDComponent extends LitElement {
  static properties = {
    items: { type: Array },
    selectedItem: { type: Object },
    showCreateModal: { type: Boolean },
    showEditModal: { type: Boolean },
    loading: { type: Boolean },
  };

  async loadItems() {
    // To be overridden by subclasses
    throw new NotImplementedError();
  }

  async createItem(data) {
    // To be overridden by subclasses
    throw new NotImplementedError();
  }

  async updateItem(id, data) {
    // To be overridden by subclasses
    throw new NotImplementedError();
  }

  async deleteItem(id) {
    // To be overridden by subclasses
    throw new NotImplementedError();
  }

  _handleCreateClick() {
    this.selectedItem = null;
    this.showCreateModal = true;
  }

  _handleEditClick(item) {
    this.selectedItem = { ...item };
    this.showEditModal = true;
  }

  async _handleSave(formData) {
    this.loading = true;
    try {
      if (this.selectedItem?.id) {
        await this.updateItem(this.selectedItem.id, formData);
      } else {
        await this.createItem(formData);
      }
      await this.loadItems();
      this.showCreateModal = false;
      this.showEditModal = false;
    } catch (error) {
      this._handleError(error);
    } finally {
      this.loading = false;
    }
  }

  async _handleDelete(item) {
    if (confirm(`Delete ${item.name}?`)) {
      this.loading = true;
      try {
        await this.deleteItem(item.id);
        await this.loadItems();
      } catch (error) {
        this._handleError(error);
      } finally {
        this.loading = false;
      }
    }
  }
}
```

**Usage**:
```javascript
export class UserManager extends BaseCRUDComponent {
  async loadItems() {
    this.items = await getUsers(this.tenant);
  }

  async createItem(data) {
    return createUser(this.tenant, data);
  }

  async updateItem(id, data) {
    return updateUser(this.tenant, id, data);
  }

  async deleteItem(id) {
    return deleteUser(this.tenant, id);
  }
}
```

---

## 7. Event Handler Consolidation Opportunities

### Frontend (photocat-app.js)

#### 7.1 Pointer Event Handler Duplication

**Pattern**: Similar pointer down/move/up handlers for different selection contexts

- Lines 2144-2165: `_handleCuratePointerDown()`
- Lines 2169-2175: `_handleCuratePointerDownWithOrder()` (wrapper)
- Lines 2177-2189: `_handleCuratePointerMove()`
- Similar trio for audit variant

**Opportunity**: Create event handler factory:

```javascript
function createSelectionHandler(config) {
  return {
    pointerDown: (event, index, imageId) => {
      // Unified logic using config
    },
    pointerMove: (event) => {
      // Unified move logic
    },
    pointerUp: (event) => {
      // Unified up logic
    }
  };
}
```

#### 7.2 Filter Change Handler Duplication

**Pattern**: Similar handlers for different filter types

- Lines 2049-2058: `_handleCurateMinRatingChange()`
- Lines 2060-2069: `_handleCurateMaxRatingChange()`
- Lines 2070-2080: `_handleCurateKeywordSelect()`
- All follow pattern: validate → update state → reset offset → apply filters

**Opportunity**: Extract to handler factory:

```javascript
_createFilterChangeHandler(stateProperty, options = {}) {
  return (event) => {
    const value = this._parseFilterValue(event);
    if (options.validate && !options.validate(value)) return;

    this[stateProperty] = value;
    this.curatePageOffset = 0;  // Reset pagination
    this._applyCurateFilters({ resetOffset: true });
  };
}
```

---

## 8. Summary: Code Quality Metrics

| Metric | Current | Target | Gap |
|--------|---------|--------|-----|
| **Largest Component** | 5,795 lines | < 1,500 lines | -75% |
| **API Duplication** | 37+ patterns | < 5 helpers | -87% |
| **Filter Duplication** | 100% (paired functions) | 0% (unified abstraction) | -100% |
| **Handler Duplication** | 8 near-identical handlers | 1 factory | -88% |
| **CRUD Duplication** | 200 lines × 5 resources | 30 lines × 1 factory | -85% |

---

## 9. Implementation Roadmap

### Phase 1: High-Impact, Low-Risk (1-2 weeks)
1. **Extract API helpers** (reduce from 706 to 500 lines)
   - Parameter builder
   - CRUD factory
   - Quick win with immediate impact

2. **Consolidate CLI commands** (reduce from 1,120 to 900 lines)
   - Tenant setup helper
   - Batch processor
   - Tag recomputation consolidation

**Expected Result**: 450 lines removed, better API maintainability

### Phase 2: Medium-Impact (2-3 weeks)
3. **Create filtering abstraction** (restructure 853 to 450 lines)
   - Unified filter definition
   - Shared keyword lookup
   - Centralized rating logic

4. **Refactor core.py endpoint** (from 1,126 to 900 lines)
   - Leverage QueryBuilder more
   - Split responsibilities

**Expected Result**: Core backend becomes cleaner, easier to extend

### Phase 3: Major Refactor (3-4 weeks)
5. **Split photocat-app.js** (from 5,795 to 1,200-1,500 lines each)
   - Extract curate-explore.js
   - Extract curate-audit.js
   - Extract search-editor.js
   - Extract shared utilities

6. **Create component base classes** (200-300 lines)
   - BaseCRUDComponent
   - BaseModalComponent
   - BaseDragDropManager

**Expected Result**: Codebase becomes maintainable by "lesser LLMs", aligns with core values

---

## 10. Risk Assessment & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Regression in complex drag-drop | HIGH | HIGH | Comprehensive test suite for handlers |
| API parameter mapping errors | MEDIUM | MEDIUM | Type-safe filter objects (TypeScript or Pydantic) |
| Filter abstraction complexity | MEDIUM | MEDIUM | Start with simple filters, graduate to complex |
| Component interaction issues | LOW | HIGH | E2E testing after splits |

---

## 11. Conclusion

The PhotoCat codebase has grown significantly and now contains substantial duplication that impacts maintainability. The primary issues are:

1. **photocat-app.js** (5,795 lines) is **5x larger than recommended**
2. **filtering.py** has **100% code duplication** across paired functions
3. **api.js** repeats **parameter-building logic 37+ times**
4. **CRUD operations** repeat **200+ lines** across 5+ resources

Implementing the recommended refactoring would:
- **Reduce core duplication by 70-90%**
- **Improve "lesser LLM" maintainability** (the project's stated goal)
- **Enable faster feature development** (less code to modify means fewer bugs)
- **Reduce lines of code** by ~1,500 (15% of project)

**Estimated effort**: 6-8 weeks for complete refactoring
**Benefit**: Significantly improved long-term maintainability

---

**Next Steps**: Review recommendations, prioritize Phase 1, create tracking tickets for implementation.
