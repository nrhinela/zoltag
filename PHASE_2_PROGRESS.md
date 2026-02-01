# Phase 2: Component Extraction - Progress Report

**Date Started**: 2026-01-30
**Goal**: Split photocat-app.js into maintainable components (< 1,500 lines each)
**Branch**: refactor-feb

---

> **Note (2026-02-01)**: `curate-shared.js` has since been split into canonical modules under
> `frontend/components/shared/` (legacy barrel: `frontend/components/shared/curate-shared.js`).

## Summary

Phase 2 focuses on extracting components from the monolithic 6,004-line photocat-app.js to improve maintainability for "lesser LLMs" per project goals.

---

## Completed Work

### ✅ Filter Panel Architecture (Previously Completed)

Before starting component extraction, we completed the filter panel refactoring:

**Files Modified**:
- [frontend/components/shared/state/image-filter-panel.js](frontend/components/shared/state/image-filter-panel.js) - Pure state container (270 lines)
- [frontend/components/photocat-app.js](frontend/components/photocat-app.js) - Integrated 3 filter panel instances

**Changes**:
- Migrated Search tab to use `searchFilterPanel`
- Migrated Curate Home (Explore) to use `curateHomeFilterPanel`
- Migrated Curate Audit to use `curateAuditFilterPanel`

**Bugs Fixed**:
- ✅ Fixed Object.assign state pollution (use spread operator for full replacement)
- ✅ Fixed API parameter loss (pass filter object directly to getImages)
- ✅ Fixed cross-tab state leakage (tab-gated refresh logic)
- ✅ Fixed deprecated method calls (console warnings + migration)

**Impact**:
- Independent filter state per tab
- No state pollution between tabs
- Single source of truth for filter logic
- Foundation for component extraction

---

### ✅ Component Extraction Plan

**Created**: [docs/COMPONENT_EXTRACTION_PLAN.md](docs/COMPONENT_EXTRACTION_PLAN.md)

**Strategy**:
1. Extract shared utilities first (dependencies)
2. Extract tab components (explore, audit, home, search)
3. Clean up main component

**Expected Results**:
- photocat-app.js: 6,004 → ~2,000-2,500 lines
- curate-shared.js: ~300 lines (shared utilities)
- curate-explore-tab.js: ~800-1,000 lines
- curate-audit-tab.js: ~800-1,000 lines
- curate-home-tab.js: ~300-400 lines
- search-tab.js: ~800-1,000 lines

---

### ✅ Shared Utilities Component

**Created**: [frontend/components/curate-shared.js](frontend/components/curate-shared.js) (330 lines)

**Exports**:
```javascript
// Rating widgets
export function renderRatingWidget(image, onRatingChange, burstIds)
export function renderRatingStatic(image)

// UI controls
export function renderPaginationControls(offset, limit, total, handlers, loading)
export function renderSortControls(orderBy, sortOrder, handlers, loading)
export function renderRatingButtons(activeRating, onChange, hideDeleted, onHideDeletedChange)

// Configuration UI
export function renderHotspotConfig(hotspot, index, options, handlers)

// Utilities
export function formatStatNumber(num)
export function createDragHandler(config)
```

**Purpose**:
- Eliminate duplication between explore, audit, and search components
- Provide consistent UI patterns
- Centralize rating widget logic (was duplicated 3+ times)
- Shared drag/drop handler creation

**Build Status**: ✅ Passes (verified with `npm run build`)

---

## Files Created/Modified

### Created
- `docs/COMPONENT_EXTRACTION_PLAN.md` - Extraction strategy and roadmap
- `frontend/components/curate-shared.js` - Shared utilities (330 lines)

### Modified
- *(None yet - shared utilities don't require changes to existing code)*

---

## Next Steps

### Phase 2.1: Extract Curate Explore Tab

**Target**: [frontend/components/curate-explore-tab.js](frontend/components/curate-explore-tab.js) (~800-1,000 lines)

**What to Extract**:
- Hotspot configuration UI (lines ~1513-1565)
- Drag-to-hotspot handlers (15+ methods)
- Drag-to-rating bucket handlers (4 methods)
- Image reordering handlers (3 methods)
- Explore render template

**Dependencies**:
- ✅ curate-shared.js (completed)
- ✅ image-filter-panel.js (completed)

**Events to Emit**:
- `hotspot-config-changed`
- `rating-applied`
- `images-reordered`
- `refresh-requested`

---

### Phase 2.2: Extract Curate Audit Tab

**Target**: [frontend/components/curate-audit-tab.js](frontend/components/curate-audit-tab.js) (~800-1,000 lines)

**What to Extract**:
- Tag audit UI (existing/missing modes)
- AI model selection
- Audit hotspot configuration
- Drag-to-hotspot/rating handlers
- Audit render template

---

### Phase 2.3: Extract Curate Home Tab

**Target**: [frontend/components/curate-home-tab.js](frontend/components/curate-home-tab.js) (~300-400 lines)

**What to Extract**:
- Tag statistics dashboard
- Category cards with keyword bars
- Rating overview

---

### Phase 2.4: Extract Search Tab

**Target**: [frontend/components/search-tab.js](frontend/components/search-tab.js) (~800-1,000 lines)

**What to Extract**:
- Search interface with filter chips
- Explore by tag view
- Saved items panel
- List creation/save functionality

---

### Phase 2.5: Cleanup

**Target**: Reduce photocat-app.js to ~2,000-2,500 lines

**Tasks**:
- Remove extracted code
- Update imports
- Wire up component events
- Update render() to use new components
- Test integration

---

## Testing Strategy

For each component extraction:

1. **Build Verification**: Run `npm run build` after each change
2. **Visual Testing**: Compare before/after screenshots
3. **Functional Testing**: Test drag/drop, filtering, pagination
4. **Integration Testing**: Verify events flow correctly
5. **Manual Testing**: Exercise all features in browser

---

## Success Metrics

### Code Quality
- ✅ Shared utilities created (curate-shared.js)
- ⏳ All components < 1,500 lines
- ⏳ Clear separation of concerns
- ⏳ No code duplication

### Functionality
- ⏳ All existing features work identically
- ⏳ No visual regressions
- ⏳ Build passes with no errors
- ⏳ No new console errors

### Maintainability
- ⏳ Easier for "lesser LLMs" to understand
- ⏳ Components focused on single responsibility
- ⏳ Clear event-driven architecture

---

## Current Status

**Phase 2 Progress**: 15% complete (1 of 6 tasks done)

- ✅ Extraction plan created
- ✅ Shared utilities extracted
- ⏳ Component extraction (paused - see revised strategy below)

**Build Status**: ✅ Passing
**Branch**: refactor-feb
**Blockers**: None

---

## Revised Strategy: Incremental vs. Full Extraction

### Initial Approach (Paused)
Original plan was to extract entire tab components (800-1,000 lines each) in one go. However, this approach has risks:
- Large template surgery required
- High chance of breaking functionality
- Difficult to test incrementally
- Could introduce subtle bugs in drag/drop

### Recommended Alternative: Method-Level Refactoring

Instead of extracting entire components immediately, consider:

1. **Continue using shared utilities** ✅
   - Already created curate-shared.js
   - Can be gradually adopted in photocat-app.js

2. **Extract handler factories** (Next step)
   - Create `hotspotHandlerFactory(config)` in curate-shared.js
   - Returns object with all hotspot methods
   - Reduces duplication between explore/audit (30+ identical handlers)

3. **Extract render utilities** (Future)
   - Move render methods to curate-shared.js
   - Use them directly in photocat-app.js templates
   - Reduces line count without architectural changes

4. **Component extraction** (Phase 3)
   - Only after proving incremental refactoring works
   - Lower risk with established patterns
   - Can be done one sub-section at a time

### Benefits of Revised Approach
- ✅ Lower risk - incremental changes
- ✅ Easier to test - one method at a time
- ✅ Immediate value - reduces duplication now
- ✅ Maintains functionality - no template surgery
- ✅ Foundation for future full extraction

---

## Notes

- Extraction is incremental - each refactoring can be tested independently
- Shared utilities established a pattern for remaining work
- Filter panel refactoring (completed previously) reduced state management complexity
- Method-level refactoring can achieve 40-50% of the duplication reduction with 10% of the risk

---

**Next Session**:
- Option A: Create handler factories in curate-shared.js (lower risk, incremental)
- Option B: Continue with full component extraction (higher risk, bigger impact)
