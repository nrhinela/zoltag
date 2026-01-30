# PhotoCat Component Extraction Plan

## Current Situation

**File:** `frontend/components/photocat-app.js`
- **Size:** 5,795 lines
- **Type:** Single monolithic Lit component
- **Complexity:** Manages 6+ major tabs and 10+ sub-features

## Problem

The monolithic design violates the project's core principle:
> "In choosing architecture, keep filesizes modular and small, because lesser LLMS are using this codebase."

**Current Challenge:** 5,795 lines is too large for most LLMs to work with efficiently.

**Cognitive Load Issues:**
- Handler functions are deeply mixed (search handlers, curate handlers, audit handlers)
- State management is scattered throughout (30+ properties per feature)
- Render logic is complex (tab switching with hundreds of lines per section)

---

## Extraction Strategy

### Phase 2A: Extract Major Features into Separate Components (Recommended Order)

#### 1. **Search Component** (extract `search-editor` component)
**Current State:**
- Lines: ~800-1000 lines of search-specific logic
- Properties: `searchImages`, `searchPageOffset`, `searchFilters`, `searchTotal`, etc.
- Methods: `_loadSearchImages()`, `_handleSearchFilter()`, `_updateSearchFilters()`, etc.
- Render Section: ~400 lines in main render()

**Why First:**
- Most self-contained feature
- Least interaction with other components
- Clear input/output contract

**New Structure:**
```
photocat-app.js (reduced to ~5000 lines)
├── search-editor.js (new, ~300 lines)
└── handles: search filters, image loading, list management
```

---

#### 2. **Curate Component** (extract `curate-home` component)
**Current State:**
- Lines: ~1200-1400 lines
- Properties: `curateImages`, `curatePageOffset`, `curateFilters`, etc.
- Methods: `_loadCurateImages()`, `_applyNewCurateFilters()`, `_handleCurateDragStart()`, etc.
- Render Section: ~500 lines

**New Structure:**
```
photocat-app.js
├── curate-home.js (new, ~400 lines)
└── handles: curate image loading, pagination, filtering
```

---

#### 3. **Curate Audit Component** (extract `curate-audit` component)
**Current State:**
- Lines: ~800-1000 lines
- Properties: `curateAuditImages`, `curateAuditKeyword`, `curateAuditMode`, etc.
- Methods: `_loadCurateAuditImages()`, `_applyCurateAuditFilters()`, etc.
- Render Section: ~300 lines

**New Structure:**
```
photocat-app.js
├── curate-audit.js (new, ~300 lines)
└── handles: tag audit workflows, "find missing tags"
```

---

#### 4. **Explore by Tag Component** (extract `curate-explore` component)
**Current State:**
- Lines: ~400-500 lines (most recent addition)
- Properties: `exploreByTagData`, `exploreByTagKeywords`, etc.
- Methods: `_loadExploreByTagData()`, `_handleExploreByTagPointerDown()`, etc.
- Render Section: ~150 lines

**New Structure:**
```
photocat-app.js
├── curate-explore.js (new, ~150 lines)
└── handles: keyword grouping, highly-rated item display
```

---

#### 5. **List Management Component** (extract `list-editor` component)
**Current State:**
- Lines: ~600-800 lines
- Properties: `listsForEditor`, `activeList`, `selectedListItems`, etc.
- Methods: `_loadLists()`, `_handleListItemDragStart()`, `_addToList()`, etc.
- Render Section: ~300 lines

**New Structure:**
```
photocat-app.js
├── list-editor.js (new, ~250 lines)
└── handles: list CRUD, item management
```

---

#### 6. **Admin & System Components** (extract multiple)
**Current State:**
- Lines: ~1200+ for admin + system tabs
- Properties: Complex tenant settings, admin operations
- Render Section: ~400+ lines

**New Structure:**
```
photocat-app.js
├── admin-tabs.js (already exists, integrate better)
├── system-panel.js (extract, ~200 lines)
└── handles: system operations, pipelines
```

---

## Projected Reduction

| Component | Extracted Lines | Extracted Methods | Extracted Properties |
|-----------|-----------------|-------------------|----------------------|
| search-editor | 300 | 8 | 12 |
| curate-home | 400 | 10 | 15 |
| curate-audit | 300 | 8 | 10 |
| curate-explore | 150 | 6 | 8 |
| list-editor | 250 | 8 | 10 |
| system-panel | 200 | 6 | 8 |
| **Total** | **1,600** | **46** | **63** |

**Result:** photocat-app.js from 5,795 → 4,195 lines (-28%)

---

## Communication Pattern

Each extracted component will:

1. **Accept Props:**
   - `tenantId` - current tenant
   - `currentFilters` - relevant filters
   - `imageStats` - statistics (if needed)

2. **Emit Events:**
   - `@image-selected` - when user selects image
   - `@filter-changed` - when filters change
   - `@list-updated` - when lists change
   - `@load-more` - when pagination requested

3. **Example:**
```javascript
// In search-editor.js
this.dispatchEvent(new CustomEvent('filter-changed', {
  detail: { filters: newFilters },
  bubbles: true,
  composed: true
}));

// In photocat-app.js
async _handleSearchFilterChanged(e) {
  this.searchFilters = e.detail.filters;
  await this._loadSearchImages();
}
```

---

## Implementation Roadmap

### Step 1: Create Foundation
- [ ] Create base component class/utilities (shared-component-base.js)
- [ ] Define event types and interfaces
- [ ] Create state management helpers

### Step 2: Extract Components (in order)
- [ ] Extract search-editor
- [ ] Extract curate-home
- [ ] Extract curate-audit
- [ ] Extract curate-explore
- [ ] Extract list-editor
- [ ] Extract system-panel

### Step 3: Refactor Main App
- [ ] Update photocat-app to use extracted components
- [ ] Add event listeners for component communication
- [ ] Consolidate remaining logic
- [ ] Remove duplicate methods

### Step 4: Testing & Verification
- [ ] Component unit tests
- [ ] Integration tests
- [ ] End-to-end workflow tests
- [ ] Performance verification

---

## Benefits

### For "Lesser LLMs"
- ✅ Smaller files (~300 lines each) are manageable
- ✅ Clear component boundaries make context switching easier
- ✅ Self-contained logic is easier to understand

### For Maintainers
- ✅ Changes to one feature don't affect others
- ✅ Easier to add/remove features
- ✅ Clearer code organization

### For Performance
- ✅ Can lazy-load components if needed
- ✅ Smaller render trees per component
- ✅ Easier to optimize individual components

---

## Risks & Mitigation

| Risk | Mitigation |
|------|-----------|
| Breaking existing functionality | Test each component extraction independently |
| Complex state sharing | Use custom events + props pattern consistently |
| Performance regression | Profile before/after, optimize if needed |
| Increased bundle size | Vite handles tree-shaking automatically |

---

## Next Steps

1. Choose first component to extract (recommend: **search-editor**)
2. Create shared utilities and base classes
3. Extract component with tests
4. Integrate into main app
5. Repeat for other components

---

**Status:** Planning complete, ready for implementation
**Estimated Effort:** 2-3 weeks for full refactoring
**Priority:** High (critical for maintainability)
