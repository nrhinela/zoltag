/**
 * curate-shared.js - Shared utilities for curate components (canonical)
 *
 * This module contains reusable rendering functions and utilities
 * used across multiple curate tab components (explore, audit, home).
 *
 * Created during Phase 2 refactoring to reduce code duplication.
 *
 * ⚠️ CRITICAL: STANDARDIZED IMAGE RENDERING PATTERN
 * ================================================================
 *
 * ALL components that display images MUST use this shared rendering pattern
 * to ensure consistent behavior across the application:
 *
 * 1. RATING WIDGETS
 *    - Use renderRatingWidget(image, onRatingChange, burstIds) for interactive ratings
 *    - Use renderRatingStatic(image) for non-interactive rating display
 *    - These render the star/trash UI that appears on image hover
 *
 * 2. SELECTION & MULTI-SELECT
 *    - Use createSelectionHandlers(context, config) to enable long-press selection
 *    - Required properties in your component:
 *      - selectionProperty: Array of selected image IDs (e.g., 'searchDragSelection')
 *      - selectingProperty: Boolean for active selection (e.g., 'searchDragSelecting')
 *      - startIndexProperty: Start index (e.g., 'searchDragStartIndex')
 *      - endIndexProperty: End index (e.g., 'searchDragEndIndex')
 *      - pressActiveProperty: Press active flag (e.g., '_searchPressActive')
 *      - pressStartProperty: Press start coords (e.g., '_searchPressStart')
 *      - pressIndexProperty: Press index (e.g., '_searchPressIndex')
 *      - pressImageIdProperty: Press image ID (e.g., '_searchPressImageId')
 *      - pressTimerProperty: Press timer (e.g., '_searchPressTimer')
 *      - longPressTriggeredProperty: Long press flag (e.g., '_searchLongPressTriggered')
 *      - getOrder: Function returning array of image IDs in display order
 *      - flashSelection: Function to show selection feedback (imageId) => void
 *    - See search-tab.js lines 136-149 for example configuration
 *
 * 3. DRAG & DROP
 *    - Images should be draggable with draggable="true" on wrapper div
 *    - Prevent dragging during selection mode (check selectingProperty)
 *    - Set dataTransfer with 'image-ids' JSON array
 *    - See search-tab.js _handleSearchDragStart (lines 394-410) for example
 *
 * 4. IMAGE CLICK HANDLERS
 *    - Open image editor modal on image click
 *    - Suppress click during selection or drag operations
 *    - Emit 'image-clicked' event to parent for modal handling
 *    - See search-tab.js _handleSearchImageClick (lines 381-392) for example
 *
 * 5. DATE DISPLAY
 *    - Use formatCurateDate() helper passed from parent
 *    - Shows photo creation date + image ID
 *    - See search-tab.js lines 500-505 for example
 *
 * 6. THUMBNAIL STYLING
 *    - Use .curate-thumb wrapper class with data-image-id attribute
 *    - Add .selected class when image is in selection array
 *    - Add .flash class temporarily for selection feedback (300ms)
 *    - Use CSS variable --curate-thumb-size for dynamic sizing
 *    - See search-tab.js lines 482-506 for complete example
 *
 * TEMPLATE PATTERN EXAMPLE (from search-tab.js):
 * ```javascript
 * ${this.searchImages.map((image, index) => html`
 *   <div
 *     class="curate-thumb-wrapper ${this.searchDragSelection.includes(image.id) ? 'selected' : ''}"
 *     data-image-id="${image.id}"
 *     draggable="true"
 *     @dragstart=${(event) => this._handleSearchDragStart(event, image)}
 *     @click=${(event) => this._handleSearchImageClick(event, image)}
 *   >
 *     <img
 *       src=${image.thumbnail_url || `/api/v1/images/${image.id}/thumbnail`}
 *       alt=${image.filename}
 *       class="curate-thumb ${this.searchDragSelection.includes(image.id) ? 'selected' : ''}"
 *       draggable="false"
 *       @pointerdown=${(event) => this._handleSearchPointerDown(event, index, image.id)}
 *       @pointermove=${(event) => this._handleSearchPointerMove(event)}
 *       @pointerenter=${() => this._handleSearchSelectHover(index)}
 *     >
 *     ${this.renderCurateRatingWidget ? this.renderCurateRatingWidget(image) : ''}
 *     ${this.renderCurateRatingStatic ? this.renderCurateRatingStatic(image) : ''}
 *     ${this.formatCurateDate && this.formatCurateDate(image) ? html`
 *       <div class="curate-thumb-date">
 *         <span class="curate-thumb-id">#${image.id}</span>
 *         <span class="curate-thumb-icon">📷</span>${this.formatCurateDate(image)}
 *       </div>
 *     ` : ''}
 *   </div>
 * `)}
 * ```
 *
 * REQUIRED PROPS FROM PARENT (zoltag-app.js):
 * - renderCurateRatingWidget: Function (bound method)
 * - renderCurateRatingStatic: Function (bound method)
 * - formatCurateDate: Function (bound method)
 *
 * ISSUES HISTORY (Learn from these mistakes):
 * - Issue #5 (2026-01-31): search-tab.js initially used simple <img> tags
 *   instead of full curate pattern → Fixed by adding rating widgets and handlers
 * - Issue #6 (2026-01-31): search-tab.js missing selection handlers
 *   → Fixed by importing createSelectionHandlers and configuring all properties
 *
 * REFERENCE IMPLEMENTATIONS:
 * - search-tab.js (lines 136-149, 369-410, 479-507) - Complete example
 * - curate-explore-tab.js - Original curate implementation
 * - zoltag-app.js - Parent component with render helpers
 */

if (!globalThis.__ZOLTAG_CURATE_SHARED_DEPRECATED__) {
  globalThis.__ZOLTAG_CURATE_SHARED_DEPRECATED__ = true;
  console.error(
    '[zoltag] Deprecated import: frontend/components/shared/curate-shared.js. ' +
    'Use specific modules under frontend/components/shared/* instead.'
  );
}

export { renderRatingWidget, renderRatingStatic } from './rating-widget.js';
export { formatStatNumber } from './formatting.js';
export {
  renderResultsPagination,
  renderPaginationControls,
  createPaginationHandlers,
} from './pagination-controls.js';
export { renderSortControls } from './sort-controls.js';
export { createDragHandler } from './drag-handler.js';
export {
  createHotspotHandlers,
  renderHotspotConfig,
  renderRatingButtons,
  parseUtilityKeywordValue,
} from './hotspot-controls.js';
export { createSelectionHandlers } from './selection-handlers.js';
export { createRatingDragHandlers } from './rating-drag-handlers.js';
