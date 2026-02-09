---
globs: "frontend/components/**/*.js"
description: All components displaying images MUST use the standardized rendering pattern from shared modules
alwaysApply: true
---

# Standardized Image Rendering Pattern

**CRITICAL**: All components that display images MUST use the standardized rendering pattern.

## Why This Matters

- ✅ Consistent user experience (selection, drag & drop, ratings, modal)
- ✅ Prevents bugs from reinventing image rendering logic
- ✅ Leverages shared, tested code for complex interactions

## Required Imports

```javascript
import { createSelectionHandlers } from './shared/selection-handlers.js';
```

## Required Props from Parent (photocat-app.js)

```javascript
.renderCurateRatingWidget=${this._renderCurateRatingWidget}
.renderCurateRatingStatic=${this._renderCurateRatingStatic}
.formatCurateDate=${this._formatCurateDate}
```

## Selection Handler Setup (in constructor)

```javascript
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
```

## Required Component Properties

```javascript
static properties = {
  // Selection state
  searchDragSelection: { type: Array },
  searchDragSelecting: { type: Boolean },
  searchDragStartIndex: { type: Number },
  searchDragEndIndex: { type: Number },
  // Helper functions from parent
  renderCurateRatingWidget: { type: Object },
  renderCurateRatingStatic: { type: Object },
  formatCurateDate: { type: Object },
};
```

## Image Template Pattern

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
      class="curate-thumb ${this.searchDragSelection.includes(image.id) ? 'selected' : ''}"
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
        <span class="curate-thumb-icon">📷</span>${this.formatCurateDate(image)}
      </div>
    ` : ''}
  </div>
`)}
```

## Features Enabled

- ✅ Long-press to start multi-select
- ✅ Drag selection across multiple images
- ✅ Drag & drop selected images
- ✅ Interactive rating widgets (star/trash)
- ✅ Static rating display
- ✅ Click to open image editor modal
- ✅ Photo date and ID display
- ✅ Visual selection feedback (blue border, flash animation)

## Reference Implementation

See `frontend/components/search-tab.js` (lines 136-149, 369-410, 479-507)

## Common Mistakes to Avoid

1. ❌ Using simple `<img>` tags without wrapper divs
2. ❌ Forgetting to pass render helper props from parent
3. ❌ Not configuring selection handlers with all required properties
4. ❌ Missing pointer event handlers (@pointerdown, @pointermove, @pointerenter)
5. ❌ Not preventing drag during selection mode
6. ❌ Forgetting to emit 'image-clicked' event for modal

## Golden Rule

**When creating ANY new component that displays images, copy the pattern from search-tab.js exactly. Don't reinvent - reuse!**
