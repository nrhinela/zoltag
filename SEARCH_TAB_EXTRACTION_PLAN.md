# Search Tab Extraction Plan

**Date**: 2026-01-31
**Goal**: Extract search tab (517 lines) from photocat-app.js into search-tab.js component
**Architecture**: Light DOM (createRenderRoot pattern)

---

## Current State

**Location**: `frontend/components/photocat-app.js` lines 4205-4722 (517 lines)
**Subtabs**:
- Search Home (filter chips + image grid)
- Explore by Tag (keyword exploration)

---

## Properties to Extract

### Properties Used by Search Tab

```javascript
// From photocat-app.js - need to move to search-tab.js
searchSubTab: { type: String }
searchChipFilters: { type: Object }
searchFilterPanel: { type: Object }
searchDropboxOptions: { type: Array }
searchImages: { type: Array }
searchSelectedImages: { type: Set }
searchLists: { type: Array }
searchListId: { type: String }
searchListTitle: { type: String }
searchSavedImages: { type: Array }
exploreByTagData: { type: Object }
exploreByTagKeywords: { type: Array }
exploreByTagLoading: { type: Boolean }

// Shared properties (pass as props from parent)
tenant: { type: String }
curateThumbSize: { type: Number }
tagStatsBySource: { type: Object }
activeCurateTagSource: { type: String }
imageStats: { type: Object }
curateOrderBy: { type: String }
curateDateOrder: { type: String }
```

---

## Methods to Extract

### Search-Related Methods (~20 methods)

**Search List Management**:
- `_focusSearchListTitleInput()` (line 2627)
- `_resetSearchListDraft()` (line 2668)
- `_handleSearchListSelect()` (line 2699)
- `_handleSearchListTitleChange()` (line 2717)
- `_fetchSearchLists()` (needs to be found)

**Search Drag & Drop**:
- `_parseSearchDragIds()` (line 2868)
- `_addSearchSavedImagesByIds()` (line 2876)
- `_handleSearchRemoveSaved()` (line 2912)
- `_handleSearchSavedDragStart()` (line 2916)
- `_handleSearchSavedDragOver()` (line 2923)
- `_handleSearchSavedDragLeave()` (line 2930)
- `_handleSearchSavedDrop()` (line 2936)
- `_handleSearchAvailableDragOver()` (line 2947)
- `_handleSearchAvailableDrop()` (line 2951)

**Search Dropbox Integration**:
- `_handleSearchDropboxInput()` (line 3038)
- `_handleSearchDropboxFocus()` (line 3055)
- `_handleSearchDropboxBlur()` (line 3061)
- `_handleSearchDropboxSelect()` (line 3067)
- `_handleSearchDropboxPick()` (line 3081)
- `_handleSearchDropboxClear()` (line 3096)

**Search Tab Navigation**:
- `_handleSearchSubTabChange()` (line 3168)
- `_loadExploreByTagData()` (needs to be found)

**Shared Methods** (keep in parent, call via events):
- `_handleCurateThumbSizeChange()` - emit event
- `_handleCurateQuickSort()` - emit event
- `_getCurateQuickSortArrow()` - emit event
- `_handleChipFiltersChanged()` - emit event

---

## Events to Emit

New custom events from search-tab to parent:

```javascript
'search-subtab-changed' - { detail: { subtab } }
'search-filters-changed' - { detail: { filters } }
'search-list-created' - { detail: { list } }
'search-list-updated' - { detail: { list } }
'thumb-size-changed' - { detail: { size } }
'sort-changed' - { detail: { orderBy, dateOrder } }
'image-selected' - { detail: { image } }
```

---

## Dependencies to Import

```javascript
import { LitElement, html } from 'lit';
import { enqueueCommand } from '../services/command-queue.js';
import {
  getLists,
  createList,
  updateList,
  addToList,
  getDropboxFolders
} from '../services/api.js';
import './shared/widgets/filter-chips.js';
import './shared/widgets/image-card.js';
import ImageFilterPanel from './shared/state/image-filter-panel.js';
```

---

## Component Structure

```javascript
/**
 * Search Tab Component
 *
 * Provides search functionality with two modes:
 * - Search Home: Filter-based image search with list management
 * - Explore by Tag: Browse images grouped by keywords
 *
 * @fires search-subtab-changed
 * @fires search-filters-changed
 * @fires search-list-created
 * @fires thumb-size-changed
 * @fires sort-changed
 */
export class SearchTab extends LitElement {
  // Use Light DOM for Tailwind CSS
  createRenderRoot() {
    return this;
  }

  static properties = {
    tenant: { type: String },
    // ... all search properties
  };

  constructor() {
    super();
    // Initialize all properties
  }

  // All search methods here

  render() {
    // Render search tab content
  }
}

customElements.define('search-tab', SearchTab);
```

---

## Integration Steps

### Step 1: Create Component File
1. Create `frontend/components/search-tab.js`
2. Add Light DOM boilerplate
3. Define properties
4. Add constructor

### Step 2: Extract Methods
1. Copy all search-related methods from photocat-app.js
2. Update method signatures if needed
3. Ensure proper state management

### Step 3: Extract Template
1. Copy search tab template (lines 4205-4722)
2. Update to use component's local properties
3. Add event emitters for parent communication

### Step 4: Update Parent (photocat-app.js)
1. Import search-tab component
2. Replace inline template with `<search-tab>` component
3. Pass required props
4. Add event listeners
5. Remove extracted methods
6. Remove extracted properties (or mark as internal)

### Step 5: Test
1. Build passes
2. Search home works
3. Explore by tag works
4. List creation/editing works
5. Drag & drop works
6. Filter chips work

---

## File Size Estimates

**Before**:
- photocat-app.js: 5,932 lines

**After**:
- photocat-app.js: ~5,415 lines (-517 template lines)
- search-tab.js: ~650 lines (517 template + ~130 methods)

**Net Reduction**: photocat-app.js down to ~5,415 lines

---

## Testing Checklist

- [ ] Search home subtab displays
- [ ] Explore by tag subtab displays
- [ ] Filter chips work
- [ ] Image grid renders
- [ ] Thumb size slider works
- [ ] Sort buttons work
- [ ] Dropbox folder picker works
- [ ] List creation works
- [ ] List editing works
- [ ] Drag images to lists works
- [ ] Remove images from lists works
- [ ] Refresh button works
- [ ] Tab switching works
- [ ] Build passes
- [ ] No console errors

---

## Risk Mitigation

**High Risk Areas**:
1. **ImageFilterPanel** integration - complex state management
2. **Drag & drop** - event coordination between components
3. **List management** - shared state with parent

**Mitigation**:
- Extract incrementally, test after each major section
- Keep event-based communication clear and documented
- Maintain backward compatibility during extraction

---

## Next Steps After Extraction

1. Extract curate-explore-tab.js (660 lines - even bigger!)
2. Extract curate-audit-tab.js
3. Convert all components to Light DOM systematically
4. Final cleanup and testing

---

**Status**: Ready to begin extraction
**Estimated Time**: 2-3 hours for full extraction + testing
