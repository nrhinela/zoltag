# Image Filter Panel Migration Guide

## Overview

The `<image-filter-panel>` component provides a reusable, state-independent implementation for filtering and displaying images. Each panel instance maintains its own filters, results, and pagination state - eliminating filter pollution between tabs.

## Architecture

### State Management

Instead of sharing filter state in PhotoCatApp, use a Map keyed by tab ID:

```javascript
// In photocat-app.js constructor
this.filterPanelStates = {
  'search': {
    filters: { limit: 100, offset: 0, sortOrder: 'desc', ... },
    images: [],
    total: 0,
  },
  'curate-home': {
    filters: { ... },
    images: [],
    total: 0,
  },
  'curate-audit': {
    filters: { ... },
    images: [],
    total: 0,
  },
};
```

### Component Communication

```
PhotoCatApp (parent)
├── filterPanelStates (Map of state by tabId)
├── <image-filter-panel tabId="search">
│   ├── Listens: filters-changed event → parent stores in filterPanelStates['search']
│   ├── Listens: images-loaded event → parent stores in filterPanelStates['search']
│   └── Receives: filters & images from parent via properties
├── <image-filter-panel tabId="curate-home">
│   └── (Independent state)
└── <image-filter-panel tabId="curate-audit">
    └── (Independent state)
```

## Implementation Steps

### Step 1: Update PhotoCatApp Constructor

```javascript
constructor() {
  super();
  // ... existing init code ...

  // Initialize state for each filter panel
  this.filterPanelStates = {
    'search': {
      filters: {
        limit: 100,
        offset: 0,
        sortOrder: 'desc',
        orderBy: 'photo_creation',
        hideZeroRating: true,
        keywords: {},
        operators: {},
      },
      images: [],
      total: 0,
    },
    'curate-home': {
      filters: {
        limit: 100,
        offset: 0,
        sortOrder: 'desc',
        orderBy: 'photo_creation',
        hideZeroRating: true,
        keywords: {},
        operators: {},
      },
      images: [],
      total: 0,
    },
    'curate-audit': {
      filters: {
        limit: 100,
        offset: 0,
        sortOrder: 'desc',
        orderBy: 'photo_creation',
        hideZeroRating: true,
        keywords: {},
        operators: {},
      },
      images: [],
      total: 0,
    },
  };
}
```

### Step 2: Add Event Handlers in PhotoCatApp

```javascript
_handleFilterPanelFiltersChanged(event) {
  const { tabId, filters } = event.detail;
  this.filterPanelStates[tabId].filters = filters;
  // State persists in the Map, automatically survives tab switches
}

_handleFilterPanelImagesLoaded(event) {
  const { tabId, images, total } = event.detail;
  this.filterPanelStates[tabId].images = images;
  this.filterPanelStates[tabId].total = total;
}
```

### Step 3: Update Template to Use Component

```javascript
// Import the component in photocat-app.js
import './image-filter-panel.js';

render() {
  return html`
    <!-- In search slot -->
    <div slot="search">
      <image-filter-panel
        tabId="search"
        .tenant=${this.tenant}
        .filters=${this.filterPanelStates['search'].filters}
        .images=${this.filterPanelStates['search'].images}
        .imageStats=${this.imageStats}
        .tagStatsBySource=${this.tagStatsBySource}
        .activeCurateTagSource=${this.activeCurateTagSource}
        @filters-changed=${this._handleFilterPanelFiltersChanged}
        @images-loaded=${this._handleFilterPanelImagesLoaded}
      >
        <!-- Optional sort controls -->
        <div slot="sort-controls">
          <!-- Custom sort UI -->
        </div>
        <!-- Optional view controls -->
        <div slot="view-controls">
          <!-- Custom view UI -->
        </div>
      </image-filter-panel>
    </div>

    <!-- In curate home slot -->
    <div slot="curate">
      <image-filter-panel
        tabId="curate-home"
        .tenant=${this.tenant}
        .filters=${this.filterPanelStates['curate-home'].filters}
        .images=${this.filterPanelStates['curate-home'].images}
        .imageStats=${this.imageStats}
        .tagStatsBySource=${this.tagStatsBySource}
        .activeCurateTagSource=${this.activeCurateTagSource}
        @filters-changed=${this._handleFilterPanelFiltersChanged}
        @images-loaded=${this._handleFilterPanelImagesLoaded}
      ></image-filter-panel>
    </div>

    <!-- In audit slot -->
    <div slot="curate-audit">
      <image-filter-panel
        tabId="curate-audit"
        .tenant=${this.tenant}
        .filters=${this.filterPanelStates['curate-audit'].filters}
        .images=${this.filterPanelStates['curate-audit'].images}
        .imageStats=${this.imageStats}
        .tagStatsBySource=${this.tagStatsBySource}
        .activeCurateTagSource=${this.activeCurateTagSource}
        @filters-changed=${this._handleFilterPanelFiltersChanged}
        @images-loaded=${this._handleFilterPanelImagesLoaded}
      ></image-filter-panel>
    </div>
  `;
}
```

### Step 4: Remove Old Filter Code

Once all panels are migrated:

1. **Delete** old filter building methods:
   - `_buildCurateFilters()`
   - `_buildSearchFilters()` (if it existed)
   - `_buildAuditFilters()` (if it existed)

2. **Delete** old image fetching methods:
   - `_fetchCurateImages()`
   - `_fetchSearchImages()` (if it existed)
   - `_fetchAuditImages()` (if it existed)

3. **Delete** old filter state properties:
   - `curateMinRating`
   - `curateKeywordFilters`
   - `curateKeywordOperators`
   - `searchDropboxPathPrefix`
   - `curateImages`
   - And other filter-related properties

4. **Delete** old event handlers:
   - `_handleChipFiltersChanged()`
   - `_applyCurateFilters()`
   - And other filter-related handlers

## Benefits of This Architecture

✅ **Code Deduplication**: Single component handles all filtering logic
✅ **State Independence**: Each tab's state lives in its own Map entry
✅ **No Pollution**: Switching tabs doesn't affect other tabs' filters
✅ **Survives Tab Switching**: State persists in parent's Map
✅ **Reusable**: Easy to add new filter panels
✅ **Testable**: Component is isolated and independently testable
✅ **Scalable**: Supports unlimited panel instances

## Expected Code Reduction

**Before**:
- photocat-app.js: ~5,800 lines (mixed concerns)
- 3 sets of filter/fetch code (duplicate logic)

**After**:
- photocat-app.js: ~2,500 lines (orchestration only)
- image-filter-panel.js: ~350 lines (single implementation)
- **Saved**: ~2,950 lines + improved maintainability

## Migration Phases

### Phase 1 (Current - DONE)
✅ Create image-filter-panel component
✅ Fix filter pollution bugs in existing code

### Phase 2 (Next)
- [ ] Migrate Search tab to use component
- [ ] Verify state persists on tab switch
- [ ] Remove old search filter code

### Phase 3 (Follow-up)
- [ ] Migrate Curate Home to use component
- [ ] Remove old curate-home filter code

### Phase 4 (Follow-up)
- [ ] Migrate Curate Audit to use component
- [ ] Remove old audit filter code

### Phase 5 (Cleanup)
- [ ] Remove all old filter-related properties from PhotoCatApp
- [ ] Update CLAUDE.md documentation
- [ ] Run full test suite

## Testing Strategy

1. **Unit Tests for Component**:
   - Test filter building logic
   - Test image fetching
   - Test event emissions
   - Test pagination

2. **Integration Tests with Parent**:
   - Tab switching preserves filters
   - Multiple panels have independent state
   - Parent state Map updates correctly

3. **E2E Tests**:
   - Add search filter, switch to curate (should not have search filter)
   - Add curate filter, switch to audit (should not have curate filter)
   - Tab back and forth (state should persist)

## File References

- **Component**: `frontend/components/image-filter-panel.js`
- **Parent**: `frontend/components/photocat-app.js`
- **API Helpers**: `frontend/services/api-params.js`
- **Filter UI**: `frontend/components/filter-chips.js`

## Questions or Issues?

If you encounter issues during migration:
1. Check that `tabId` is unique for each instance
2. Verify parent is passing `filterPanelStates[tabId]` as properties
3. Ensure event handlers are correctly bound
4. Check browser console for error messages
