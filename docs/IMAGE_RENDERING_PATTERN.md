# Standardized Image Rendering Pattern

**Created**: 2026-01-31
**Purpose**: Document the required pattern for rendering images consistently across all components

---

## Overview

ALL components that display images in PhotoCat MUST use this standardized rendering pattern to ensure consistent behavior across the application.

## Why This Pattern Exists

**Historical Context**: During search-tab.js extraction (2026-01-31), we encountered multiple issues from not following the established pattern:

- **Issue #5**: Search tab initially used simple `<img>` tags without rating widgets, selection handlers, or modal integration
- **Issue #6**: Missing multi-select and long-press functionality because selection handlers weren't properly configured

These issues were fixed by adopting the standardized pattern from curate components. This document exists to prevent similar issues in the future.

---

## Required Imports

```javascript
import { createSelectionHandlers } from './curate-shared.js';
```

---

## Required Props from Parent

Your component MUST receive these props from photocat-app.js:

```javascript
<your-component
  .renderCurateRatingWidget=${this._renderCurateRatingWidget}
  .renderCurateRatingStatic=${this._renderCurateRatingStatic}
  .formatCurateDate=${this._formatCurateDate}
  ...
></your-component>
```

Declare them in static properties:

```javascript
static properties = {
  renderCurateRatingWidget: { type: Object },
  renderCurateRatingStatic: { type: Object },
  formatCurateDate: { type: Object },
  // ... other props
};
```

---

## Selection Handler Configuration

In your component's constructor, initialize selection handlers:

```javascript
constructor() {
  super();

  // Initialize all selection state properties
  this.searchDragSelection = [];
  this.searchDragSelecting = false;
  this.searchDragStartIndex = null;
  this.searchDragEndIndex = null;
  this._searchPressActive = false;
  this._searchPressStart = null;
  this._searchPressIndex = null;
  this._searchPressImageId = null;
  this._searchPressTimer = null;
  this._searchLongPressTriggered = false;
  this._searchFlashSelectionIds = new Set();

  // Configure selection handlers
  this._searchSelectionHandlers = createSelectionHandlers(this, {
    selectionProperty: 'searchDragSelection',
    selectingProperty: 'searchDragSelecting',
    startIndexProperty: 'searchDragStartIndex',
    endIndexProperty: 'searchDragEndIndex',
    pressActiveProperty: '_searchPressActive',
    pressStartProperty: '_searchPressStart',
    pressIndexProperty: '_searchPressIndex',
    pressImageIdProperty: '_searchPressImageId',
    pressTimerProperty: '_searchPressTimer',
    longPressTriggeredProperty: '_searchLongPressTriggered',
    getOrder: () => (this.searchImages || []).map(img => img.id),
    flashSelection: (imageId) => this._flashSearchSelection(imageId),
  });
}
```

Declare selection properties:

```javascript
static properties = {
  searchDragSelection: { type: Array },
  searchDragSelecting: { type: Boolean },
  searchDragStartIndex: { type: Number },
  searchDragEndIndex: { type: Number },
  // ... other props
};
```

---

## Required Helper Methods

Add these wrapper methods to your component:

```javascript
// Flash selection feedback
_flashSearchSelection(imageId) {
  this._searchFlashSelectionIds.add(imageId);
  this.requestUpdate();
  setTimeout(() => {
    this._searchFlashSelectionIds.delete(imageId);
    this.requestUpdate();
  }, 300);
}

// Pointer event handlers (delegate to selection handlers)
_handleSearchPointerDown(event, index, imageId) {
  return this._searchSelectionHandlers.handlePointerDown(event, index, imageId);
}

_handleSearchPointerMove(event) {
  return this._searchSelectionHandlers.handlePointerMove(event);
}

_handleSearchSelectHover(index) {
  return this._searchSelectionHandlers.handleSelectHover(index);
}

// Image click handler
_handleSearchImageClick(event, image) {
  if (event.defaultPrevented) return;
  if (this._searchSuppressClick || this.searchDragSelection.length) {
    this._searchSuppressClick = false;
    return;
  }
  this.dispatchEvent(new CustomEvent('image-clicked', {
    detail: { event, image },
    bubbles: true,
    composed: true
  }));
}

// Drag start handler
_handleSearchDragStart(event, image) {
  // Prevent dragging during selection mode
  if (this.searchDragSelecting) {
    event.preventDefault();
    return;
  }

  let ids = [image.id];
  if (this.searchDragSelection.length && this.searchDragSelection.includes(image.id)) {
    ids = this.searchDragSelection;
  } else if (this.searchDragSelection.length) {
    this.searchDragSelection = [image.id];
  }
  event.dataTransfer.setData('text/plain', ids.join(','));
  event.dataTransfer.setData('application/x-photocat-source', 'search-available');
  event.dataTransfer.setData('image-ids', JSON.stringify(ids));
}
```

---

## Image Template Pattern

Use this exact template structure for rendering images:

```javascript
${this.searchImages.map((image, index) => html`
  <div
    class="curate-thumb-wrapper ${this.searchDragSelection.includes(image.id) ? 'selected' : ''}"
    data-image-id="${image.id}"
    draggable="true"
    @dragstart=${(event) => this._handleSearchDragStart(event, image)}
    @click=${(event) => this._handleSearchImageClick(event, image)}
  >
    <img
      src=${image.thumbnail_url || `/api/v1/images/${image.id}/thumbnail`}
      alt=${image.filename}
      class="curate-thumb ${this.searchDragSelection.includes(image.id) ? 'selected' : ''} ${this._searchFlashSelectionIds?.has(image.id) ? 'flash' : ''}"
      draggable="false"
      @pointerdown=${(event) => this._handleSearchPointerDown(event, index, image.id)}
      @pointermove=${(event) => this._handleSearchPointerMove(event)}
      @pointerenter=${() => this._handleSearchSelectHover(index)}
    >
    ${this.renderCurateRatingWidget ? this.renderCurateRatingWidget(image) : ''}
    ${this.renderCurateRatingStatic ? this.renderCurateRatingStatic(image) : ''}
    ${this.formatCurateDate && this.formatCurateDate(image) ? html`
      <div class="curate-thumb-date">
        <span class="curate-thumb-id">#${image.id}</span>
        <span class="curate-thumb-icon" aria-hidden="true">📷</span>${this.formatCurateDate(image)}
      </div>
    ` : ''}
  </div>
`)}
```

---

## Features Enabled by This Pattern

✅ **Long-press multi-select**: Hold pointer down for 250ms to start selection
✅ **Drag selection**: Move pointer while selecting to select range
✅ **Visual feedback**: Blue border on selected images, flash animation
✅ **Drag & drop**: Drag selected images (prevented during selection mode)
✅ **Rating widgets**: Interactive star/trash buttons on hover
✅ **Static ratings**: Display rating when not hovering
✅ **Click to view**: Open image editor modal
✅ **Photo metadata**: Display date and ID

---

## Common Mistakes to Avoid

❌ **Don't** use simple `<img>` tags without wrapper divs
❌ **Don't** forget to pass render helper props from parent
❌ **Don't** skip selection handler configuration
❌ **Don't** forget pointer event handlers (@pointerdown, @pointermove, @pointerenter)
❌ **Don't** allow dragging during selection mode
❌ **Don't** forget to emit 'image-clicked' event
❌ **Don't** forget to add `draggable="false"` on `<img>` element (wrapper handles drag)

---

## Reference Implementations

**Primary Reference**: `frontend/components/search-tab.js`
- Lines 139-152: Selection handler configuration
- Lines 369-410: Event handler methods
- Lines 714-747: Image template pattern

**Original Implementation**: `frontend/components/curate-explore-tab.js`

**Shared Code**: `frontend/components/curate-shared.js`
- Comprehensive documentation in header (lines 1-120)
- `createSelectionHandlers()` function (line 593+)
- `renderRatingWidget()` and `renderRatingStatic()` functions

---

## Checklist for New Components

When creating a component that displays images:

- [ ] Import `createSelectionHandlers` from curate-shared.js
- [ ] Add all required props (renderCurateRatingWidget, etc.)
- [ ] Initialize all selection state properties in constructor
- [ ] Configure selection handlers in constructor
- [ ] Add helper methods (_flashSelection, _handlePointerDown, etc.)
- [ ] Use the exact template pattern for image rendering
- [ ] Test long-press selection works
- [ ] Test drag & drop works
- [ ] Test rating widgets appear on hover
- [ ] Test clicking opens image editor modal
- [ ] Test selection visual feedback (blue border, flash)

---

## Questions?

See the comprehensive documentation in:
- `frontend/components/curate-shared.js` (header comment)
- `CLAUDE.md` (Standardized Image Rendering Pattern section)
- This file

Or review the reference implementation in `search-tab.js`.
