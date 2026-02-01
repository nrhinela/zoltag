# PhotoCat Component Extraction Plan

**Date**: 2026-01-30
**Goal**: Split photocat-app.js (6,004 lines) into focused, maintainable components
**Target**: Components < 1,500 lines each

---

## Current Structure Analysis

### photocat-app.js (6,004 lines)

**Main Tabs** (slots):
- `search` - Search interface with saved items (lines ~4189-4697)
- `curate` - Main curation interface (lines ~4698-5512)
  - Sub-tabs: home, explore (main), tag-audit, help
- `lists` - List management (lines ~5513+)
- `images` - Image browser
- `settings` - Settings

**State Variables** (~150 properties):
- Search: `searchSubTab`, `searchSavedItems`, `searchListId`, etc.
- Curate: `curateSubTab`, `curateImages`, `curateMinRating`, etc.
- Curate Explore: `curateExploreHotspots`, `curateExploreRatingMode`, etc.
- Curate Audit: `curateAuditImages`, `curateAuditKeyword`, etc.

**Handler Methods** (~100+ methods):
- Curate Explore handlers: `_handleCurateExploreHotspot*` (15+ methods, lines 1513-1900)
- Curate Audit handlers: `_handleCurateAuditHotspot*` (15+ methods, lines 1671-1875)
- Search handlers: `_handleSearch*`, `_handleSearchSaved*` (20+ methods)
- Filter handlers: `_handleCurateMinRating`, `_handleCurateFilterChange`, etc.

---

## Extraction Strategy

### Phase 1: Extract Curate Explore Tab → `curate-explore-tab.js`

**Lines to Extract**: ~1513-1900 (handlers) + render section from 4698+
**Size Estimate**: ~800-1,000 lines

**Responsibilities**:
- Hotspot configuration UI (keyword, rating, action dropdowns)
- Drag-to-hotspot functionality
- Drag-to-rating bucket functionality
- Rating mode toggle
- Image reordering within explore
- Explore filter application (via `curateHomeFilterPanel`)

**State to Move**:
```javascript
// Hotspot state
curateExploreHotspots
curateExploreHotspotDragTarget

// Rating drag state
curateExploreRatingMode
curateExploreRatingDragTarget

// Reorder state
curateExploreReorderSource
curateExploreReorderTarget
```

**Methods to Move**:
- `_handleCurateExploreHotspot*` (15 methods)
- `_handleCurateExploreRating*` (4 methods)
- `_handleCurateExploreReorder*` (3 methods)
- `_applyExploreRating`
- `_processExploreDrop`

**Events to Emit**:
- `hotspot-config-changed` - When hotspot settings change
- `rating-applied` - When rating is applied via drag/drop
- `images-reordered` - When explore images are reordered
- `refresh-requested` - When user requests refresh

**Properties to Accept**:
```javascript
.filterPanel=${this.curateHomeFilterPanel}
.images=${this.curateImages}
.imageStats=${this.imageStats}
.keywordsByCategory=${this.keywordsByCategory}
.curateOperations=${this.curateOperations}
.tenant=${this.tenant}
```

---

### Phase 2: Extract Curate Audit Tab → `curate-audit-tab.js`

**Lines to Extract**: ~1671-1875 (handlers) + audit render section
**Size Estimate**: ~800-1,000 lines

**Responsibilities**:
- Tag audit functionality (existing/missing tags)
- AI model selection (SigLIP/Keyword Model)
- Hotspot configuration for audit
- Drag-to-hotspot for audit images
- Drag-to-rating bucket for audit
- Audit filter application (via `curateAuditFilterPanel`)

**State to Move**:
```javascript
// Audit mode
curateAuditMode  // 'existing' | 'missing'
curateAuditKeyword
curateAuditCategory
curateAuditMLModel

// Hotspot state
curateAuditHotspots
curateAuditHotspotDragTarget

// Rating drag state
curateAuditRatingMode
curateAuditRatingDragTarget

// Images
curateAuditImages
curateAuditTotal
```

**Methods to Move**:
- `_handleCurateAuditHotspot*` (15 methods)
- `_handleCurateAuditRating*` (4 methods)
- `_handleCurateAuditMode*`
- `_applyAuditRating`
- `_processAuditDrop`
- `_fetchCurateAuditImages`
- `_buildCurateAuditFilterObject`

**Events to Emit**:
- `audit-mode-changed` - When switching existing/missing
- `audit-keyword-selected` - When keyword/category selected
- `rating-applied` - When rating is applied
- `refresh-requested` - When user requests refresh

---

### Phase 3: Extract Search Tab → `search-tab.js`

**Lines to Extract**: Search handlers + render section (4189-4697)
**Size Estimate**: ~800-1,000 lines

**Responsibilities**:
- Search home with filter chips
- Explore by tag view
- Saved items panel
- List creation/save functionality
- Drag to saved items

**State to Move**:
```javascript
searchSubTab  // 'home' | 'explore-by-tag'
searchChipFilters
searchSavedItems
searchListId
searchListTitle
searchListSaving
searchSavedDragTarget
```

**Methods to Move**:
- `_handleSearch*` (search handlers)
- `_handleSearchSaved*` (saved items handlers)
- `_handleSearchList*` (list handlers)
- `_handleChipFiltersChanged`

**Events to Emit**:
- `search-performed` - When search is executed
- `item-saved` - When image saved to collection
- `list-created` - When new list created
- `list-updated` - When list saved

---

### Phase 4: Extract Curate Home Tab → `curate-home-tab.js`

**Lines to Extract**: Home dashboard render section
**Size Estimate**: ~300-400 lines

**Responsibilities**:
- Display tag statistics dashboard
- Tag count summaries (permatags, zero-shot, keyword-model)
- Category cards with keyword bars
- Rating statistics overview

**State to Move**:
```javascript
activeCurateTagSource  // 'permatags' | 'zero_shot' | 'keyword_model'
curateCategoryCards
```

**Methods to Move**:
- `_updateCurateCategoryCards`
- `_formatStatNumber`

**Events to Emit**:
- `tag-source-changed` - When tag source filter changes

---

### Phase 5: Create Shared Utilities → `frontend/components/shared/*` (legacy barrel: `shared/curate-shared.js`)

**Size Estimate**: ~200-300 lines

**Responsibilities**:
- Shared rating widget rendering
- Shared filter UI rendering
- Common drag/drop utilities
- Pagination controls

**Functions to Export**:
```javascript
export function renderRatingWidget(image, interactive, onChange) { ... }
export function renderRatingStatic(image) { ... }
export function renderFilterControls(options) { ... }
export function createDragHandler(config) { ... }
export function renderPaginationControls(offset, limit, total, onChange) { ... }
```

---

## Implementation Order

1. ✅ **Phase 0** (Completed): Filter panel migration
2. 🔄 **Phase 1**: Extract shared utilities first (canonical modules under `frontend/components/shared/`)
3. 🔄 **Phase 2**: Extract `curate-explore-tab.js`
4. 🔄 **Phase 3**: Extract `curate-audit-tab.js`
5. 🔄 **Phase 4**: Extract `curate-home-tab.js`
6. 🔄 **Phase 5**: Extract `search-tab.js`
7. 🔄 **Phase 6**: Clean up `photocat-app.js` (should be ~2,000-2,500 lines)

---

## Expected Results

### Before
- `photocat-app.js`: 6,004 lines (monolithic)

### After
- `photocat-app.js`: ~2,000-2,500 lines (orchestration, state management, main layout)
- `frontend/components/shared/*`: shared utilities (with legacy barrel at `shared/curate-shared.js`)
- `curate-explore-tab.js`: ~800-1,000 lines (explore functionality)
- `curate-audit-tab.js`: ~800-1,000 lines (audit functionality)
- `curate-home-tab.js`: ~300-400 lines (home dashboard)
- `search-tab.js`: ~800-1,000 lines (search interface)

**Total Lines**: ~5,000-6,500 lines (similar to current, but modular)
**Largest Component**: ~1,000 lines (vs 6,004 currently)
**Maintainability**: ✅ Aligned with "lesser LLMs" goal

---

## Testing Strategy

For each extracted component:

1. **Unit Testing**: Verify component renders correctly with mock props
2. **Event Testing**: Verify events are emitted with correct payloads
3. **Integration Testing**: Verify parent component receives events correctly
4. **Visual Testing**: Compare before/after screenshots
5. **Manual Testing**: Test drag/drop, filtering, pagination

---

## Risk Mitigation

**Risk**: Breaking drag-drop functionality
**Mitigation**: Extract shared drag utilities first, test incrementally

**Risk**: State synchronization issues
**Mitigation**: Use events for child→parent communication, props for parent→child

**Risk**: Duplication between components
**Mitigation**: Extract shared utilities (curate-shared.js) before extracting tabs

---

## Success Criteria

- ✅ Build passes with no errors
- ✅ All existing functionality works identically
- ✅ No visual regressions
- ✅ Components are < 1,500 lines each
- ✅ Clear separation of concerns
- ✅ Easier to understand for "lesser LLMs"
