# Overview
@README.md for project overview
@docs/DEPLOYMENT.md for deployment instructions.
@docs/refactoring_plan.md for the frontend refactoring plan, in case some legacy code is observed
- @src/photocat/static contains some legacy html files that were the source of the latest front-end conversion.
- Originally designed to accomodate multiple categorization models, currently only one is supported.

## Additional Instructions for Claude:

- In choosing architecture, keep filesizes modular and small, because lesser LLMS are using this codebase.
- The project is designed to be used with continue.dev. See .continue/rules for coding standards

## Token Efficiency

- Prefer targeted line-range reads over full file reads when possible
- Use Grep/Glob to locate code before reading entire files
- When exploring, start with the most specific search possible
- Avoid using the Explore agent for simple lookups - use direct file reads instead

## Key Entry Points

- Frontend: frontend/main.js → frontend/components/photocat-app.js
- Backend API: src/photocat/api.py
- Database models: src/photocat/models.py

## Component Architecture

### LitElement Components - Use Light DOM

**IMPORTANT**: When creating LitElement components, always use Light DOM (not Shadow DOM) to maintain access to Tailwind CSS classes.

**Pattern to follow**:
```javascript
export class MyComponent extends LitElement {
  // Disable Shadow DOM - render to Light DOM instead
  createRenderRoot() {
    return this;
  }

  // No static styles needed - use Tailwind classes directly

  render() {
    return html`
      <div class="grid grid-cols-5 gap-2">
        <!-- Tailwind classes work here! -->
      </div>
    `;
  }
}
```

**Why Light DOM**:
- ✅ Tailwind CSS classes work without rewriting as scoped styles
- ✅ No need to translate 200+ lines of CSS per component
- ✅ Styling matches parent document automatically
- ✅ Simpler code and faster development
- ✅ Still get component benefits: encapsulated logic, props, events, reusability

**When to use Shadow DOM**:
- Only for truly reusable widget libraries that need style isolation
- Not for internal application components

**Example**: See `frontend/components/curate-home-tab.js` for the pattern.

### Standardized Image Rendering Pattern

**CRITICAL**: All components that display images MUST use the standardized rendering pattern from the shared modules under `frontend/components/shared/`.

**Why this matters**:
- Ensures consistent user experience (selection, drag & drop, ratings, modal behavior)
- Prevents bugs from reinventing image rendering logic
- Leverages shared, tested code for complex interactions

**Required imports**:
```javascript
import { createSelectionHandlers } from './shared/selection-handlers.js';
```

**Required props from parent** (photocat-app.js):
```javascript
.renderCurateRatingWidget=${this._renderCurateRatingWidget}
.renderCurateRatingStatic=${this._renderCurateRatingStatic}
.formatCurateDate=${this._formatCurateDate}
```

**Selection handler setup** (in constructor):
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

**Required component properties**:
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

**Image template pattern**:
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

**Features enabled by this pattern**:
- ✅ Long-press to start multi-select
- ✅ Drag selection across multiple images
- ✅ Drag & drop selected images
- ✅ Interactive rating widgets (star/trash)
- ✅ Static rating display
- ✅ Click to open image editor modal
- ✅ Photo date and ID display
- ✅ Visual selection feedback (blue border, flash animation)

**Reference implementations**:
- `frontend/components/search-tab.js` (lines 136-149, 369-410, 479-507)
- `frontend/components/shared/curate-shared.js` (legacy barrel; comprehensive pattern doc at top)

**Common mistakes to avoid**:
1. ❌ Using simple `<img>` tags without wrapper divs
2. ❌ Forgetting to pass render helper props from parent
3. ❌ Not configuring selection handlers with all required properties
4. ❌ Missing pointer event handlers (@pointerdown, @pointermove, @pointerenter)
5. ❌ Not preventing drag during selection mode
6. ❌ Forgetting to emit 'image-clicked' event for modal

**When creating ANY new component that displays images**, copy the pattern from search-tab.js exactly. Don't reinvent - reuse!
