/**
 * curate-shared.js - Shared utilities for curate components
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
 * REQUIRED PROPS FROM PARENT (photocat-app.js):
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
 * - photocat-app.js - Parent component with render helpers
 */

import { html } from 'lit';

/**
 * Render an interactive rating widget for an image
 * @param {Object} image - Image object with id and rating
 * @param {Function} onRatingChange - Callback (event, image, newRating) => void
 * @param {Set} burstIds - Optional set of image IDs to show burst animation
 * @returns {TemplateResult}
 */
export function renderRatingWidget(image, onRatingChange, burstIds = null) {
  return html`
    <div class="curate-thumb-rating-widget" @click=${(e) => e.stopPropagation()}>
      ${burstIds?.has(image.id) ? html`
        <span class="curate-thumb-burst" aria-hidden="true"></span>
      ` : html``}
      <button
        type="button"
        class="curate-thumb-trash cursor-pointer mx-0.5 ${image.rating == 0 ? 'text-red-600' : 'text-gray-600 hover:text-gray-900'}"
        title="0 stars"
        @click=${(e) => onRatingChange(e, image, 0)}
      >
        ${image.rating == 0 ? '❌' : '🗑'}
      </button>
      <span class="curate-thumb-stars">
        ${[1, 2, 3].map((star) => html`
          <button
            type="button"
            class="cursor-pointer mx-0.5 ${image.rating && image.rating >= star ? 'text-yellow-500' : 'text-gray-500 hover:text-gray-900'}"
            title="${star} star${star > 1 ? 's' : ''}"
            @click=${(e) => onRatingChange(e, image, star)}
          >
            ${image.rating && image.rating >= star ? '★' : '☆'}
          </button>
        `)}
      </span>
    </div>
  `;
}

/**
 * Render a static (non-interactive) rating display
 * @param {Object} image - Image object with rating property
 * @returns {TemplateResult}
 */
export function renderRatingStatic(image) {
  if (image?.rating === null || image?.rating === undefined || image?.rating === '') {
    return html``;
  }
  return html`
    <div class="curate-thumb-rating-static" aria-label="Rating ${image.rating}">
      ${[1, 2, 3].map((star) => html`
        <span class=${image.rating >= star ? 'text-yellow-500' : 'text-gray-400'}>
          ${image.rating >= star ? '★' : '☆'}
        </span>
      `)}
    </div>
  `;
}

/**
 * Format a statistic number with commas
 * @param {number} num - Number to format
 * @returns {string} Formatted number string
 */
export function formatStatNumber(num) {
  if (num === null || num === undefined || num === '') {
    return '0';
  }
  const n = Number(num);
  if (Number.isNaN(n)) {
    return '0';
  }
  return n.toLocaleString();
}

/**
 * Render results pagination strip (matches search/curate pagination UI)
 * @param {Object} options
 * @param {number} options.total - Total count
 * @param {number} options.offset - Current offset
 * @param {number} options.limit - Page size
 * @param {number} options.count - Items currently shown
 * @param {Function} options.onPrev - Prev handler
 * @param {Function} options.onNext - Next handler
 * @param {Function} options.onLimitChange - Page size handler
 * @param {boolean} [options.disabled=false] - Disable controls
 * @param {boolean} [options.showPageSize=true] - Show page size selector
 * @returns {TemplateResult}
 */
export function renderResultsPagination({
  total,
  offset,
  limit,
  count,
  onPrev,
  onNext,
  onLimitChange,
  disabled = false,
  showPageSize = true,
}) {
  const totalCount = Number.isFinite(total) ? total : 0;
  const pageCount = Number.isFinite(count) ? count : 0;
  const pageOffset = Number.isFinite(offset) ? offset : 0;
  const pageLimit = Number.isFinite(limit) && limit > 0 ? limit : 100;
  const hasPrev = pageOffset > 0;
  const hasNext = pageOffset + pageLimit < totalCount;
  const start = pageCount > 0 ? pageOffset + 1 : 0;
  const end = pageCount > 0 ? pageOffset + pageCount : 0;
  const formattedTotal = formatStatNumber(totalCount);
  const rangeLabel = totalCount
    ? (end === 0 ? `0 of ${formattedTotal}` : `${formatStatNumber(start)}-${formatStatNumber(end)} of ${formattedTotal}`)
    : '0 of 0';

  return html`
    <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
      <span class="font-semibold tracking-wide">${formattedTotal} ITEMS</span>
      <div class="flex items-center gap-3">
        ${showPageSize ? html`
          <label class="inline-flex items-center gap-2 text-xs text-gray-500">
            <span>Results per page:</span>
            <select
              class="px-2 py-1 border rounded-md text-xs bg-white"
              .value=${String(pageLimit)}
              @change=${onLimitChange}
              ?disabled=${disabled}
            >
              ${[100, 50, 200].map((size) => html`<option value=${String(size)}>${size}</option>`)}
            </select>
          </label>
        ` : html``}
        <span>${rangeLabel.toUpperCase()}</span>
        <button
          class="curate-pane-action secondary"
          ?disabled=${disabled || !hasPrev}
          @click=${onPrev}
          aria-label="Previous page"
        >
          &lt;
        </button>
        <button
          class="curate-pane-action secondary"
          ?disabled=${disabled || !hasNext}
          @click=${onNext}
          aria-label="Next page"
        >
          &gt;
        </button>
      </div>
    </div>
  `;
}

/**
 * Render pagination controls
 * @param {number} offset - Current offset
 * @param {number} limit - Items per page
 * @param {number} total - Total count
 * @param {Object} handlers - { onPrev, onNext, onLimitChange }
 * @param {boolean} loading - Whether data is loading
 * @returns {TemplateResult}
 */
export function renderPaginationControls(offset, limit, total, handlers, loading = false) {
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;
  const totalFormatted = total.toLocaleString('en-US');
  const rangeStart = offset + 1;
  const rangeEnd = Math.min(offset + limit, total);

  return html`
    <div class="flex flex-wrap items-center justify-between gap-4 text-xs">
      <div class="font-semibold text-gray-700 uppercase tracking-wide">
        ${totalFormatted} ITEMS
      </div>
      <div class="flex items-center gap-3">
        <span class="font-medium text-gray-600 uppercase tracking-wide">Results per page:</span>
        <select
          class="curate-select text-xs"
          .value=${String(limit)}
          @change=${handlers.onLimitChange}
          ?disabled=${loading}
        >
          <option value="25">25</option>
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="200">200</option>
        </select>
        <span class="text-gray-600 uppercase tracking-wide">${rangeStart}-${rangeEnd} OF ${totalFormatted}</span>
        <button
          class="curate-pane-action secondary"
          ?disabled=${loading || !hasPrev}
          @click=${handlers.onPrev}
          aria-label="Previous page"
        >
          &lt;
        </button>
        <button
          class="curate-pane-action secondary"
          ?disabled=${loading || !hasNext}
          @click=${handlers.onNext}
          aria-label="Next page"
        >
          &gt;
        </button>
      </div>
    </div>
  `;
}

/**
 * Render sort controls
 * @param {string} orderBy - Current order field
 * @param {string} sortOrder - Current sort direction ('asc'|'desc')
 * @param {Object} handlers - { onOrderByChange, onSortOrderChange, onQuickSort }
 * @param {boolean} loading - Whether data is loading
 * @returns {TemplateResult}
 */
export function renderSortControls(orderBy, sortOrder, handlers, loading = false) {
  const sortOptions = [
    { value: 'photo_creation', label: 'Photo Date' },
    { value: 'rating', label: 'Rating' },
    { value: 'id', label: 'Upload Date' },
    { value: 'modified_time', label: 'Modified' },
  ];

  return html`
    <div class="flex items-center gap-2">
      <label class="text-xs font-semibold text-gray-600">Sort:</label>
      <select
        class="curate-select text-xs"
        .value=${orderBy}
        @change=${handlers.onOrderByChange}
        ?disabled=${loading}
      >
        ${sortOptions.map((opt) => html`
          <option value=${opt.value}>${opt.label}</option>
        `)}
      </select>
      <button
        class="inline-flex items-center gap-1 px-2 py-1 rounded border text-xs ${sortOrder === 'desc' ? 'bg-blue-100 text-blue-800 border-blue-200' : 'bg-gray-100 text-gray-600 border-gray-200'}"
        @click=${handlers.onSortOrderChange}
        ?disabled=${loading}
        title="Toggle sort direction"
      >
        <i class="fas fa-arrow-${sortOrder === 'desc' ? 'down' : 'up'}"></i>
        ${sortOrder === 'desc' ? 'Desc' : 'Asc'}
      </button>
      ${handlers.onQuickSort ? html`
        <div class="flex gap-1">
          <button
            class="px-2 py-1 text-xs rounded border border-gray-200 hover:bg-gray-50"
            @click=${() => handlers.onQuickSort('rating')}
            ?disabled=${loading}
            title="Quick sort by rating"
          >
            ★ Rating
          </button>
          <button
            class="px-2 py-1 text-xs rounded border border-gray-200 hover:bg-gray-50"
            @click=${() => handlers.onQuickSort('photo_creation')}
            ?disabled=${loading}
            title="Quick sort by photo date"
          >
            📅 Date
          </button>
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Create a drag handler configuration object
 * Used to standardize drag/drop behavior across components
 * @param {Object} config - Configuration object
 * @returns {Object} Drag handler methods
 */
export function createDragHandler(config) {
  const {
    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
    dragDataType = 'text/plain',
  } = config;

  return {
    handleDragStart: (event, data) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(dragDataType, JSON.stringify(data));
      if (onDragStart) onDragStart(event, data);
    },

    handleDragOver: (event, target) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (onDragOver) onDragOver(event, target);
    },

    handleDragLeave: (event) => {
      if (onDragLeave) onDragLeave(event);
    },

    handleDrop: (event, target) => {
      event.preventDefault();
      const dataStr = event.dataTransfer.getData(dragDataType);
      if (dataStr) {
        try {
          const data = JSON.parse(dataStr);
          if (onDrop) onDrop(event, target, data);
        } catch (error) {
          console.error('Error parsing drop data:', error);
        }
      }
    },
  };
}

/**
 * Render hotspot configuration UI
 * @param {Object} hotspot - Hotspot configuration object
 * @param {number} index - Hotspot index
 * @param {Object} options - { categories, keywords, actions, types }
 * @param {Object} handlers - { onChange, onRemove, onAdd }
 * @returns {TemplateResult}
 */
export function renderHotspotConfig(hotspot, index, options, handlers) {
  const { categories = [], keywords = [], actions = [], types = [] } = options;
  const { onChange, onRemove, onAdd } = handlers;

  return html`
    <div class="hotspot-config-row">
      <div class="hotspot-config-field">
        <label class="text-xs">Keyword</label>
        <select
          class="curate-select text-xs"
          .value=${hotspot.keyword || ''}
          @change=${(e) => onChange(index, 'keyword', e.target.value)}
        >
          <option value="">Select keyword...</option>
          ${keywords.map((kw) => html`
            <option value=${kw.value}>${kw.label}</option>
          `)}
        </select>
      </div>

      <div class="hotspot-config-field">
        <label class="text-xs">Action</label>
        <select
          class="curate-select text-xs"
          .value=${hotspot.action || 'add'}
          @change=${(e) => onChange(index, 'action', e.target.value)}
        >
          ${actions.map((action) => html`
            <option value=${action.value}>${action.label}</option>
          `)}
        </select>
      </div>

      <div class="hotspot-config-field">
        <label class="text-xs">Type</label>
        <select
          class="curate-select text-xs"
          .value=${hotspot.type || 'permatag'}
          @change=${(e) => onChange(index, 'type', e.target.value)}
        >
          ${types.map((type) => html`
            <option value=${type.value}>${type.label}</option>
          `)}
        </select>
      </div>

      ${hotspot.action === 'rate' ? html`
        <div class="hotspot-config-field">
          <label class="text-xs">Rating</label>
          <select
            class="curate-select text-xs"
            .value=${String(hotspot.rating || 1)}
            @change=${(e) => onChange(index, 'rating', Number(e.target.value))}
          >
            ${[0, 1, 2, 3].map((rating) => html`
              <option value=${rating}>${rating === 0 ? 'Trash' : `${rating} star${rating > 1 ? 's' : ''}`}</option>
            `)}
          </select>
        </div>
      ` : ''}

      <button
        class="hotspot-remove-btn"
        @click=${() => onRemove(index)}
        title="Remove hotspot"
      >
        ×
      </button>
    </div>
  `;
}

/**
 * Render rating button controls
 * @param {number|string} activeRating - Currently active rating filter
 * @param {Function} onChange - Callback (newRating) => void
 * @param {boolean} hideDeleted - Whether "hide deleted" is checked
 * @param {Function} onHideDeletedChange - Callback (event) => void
 * @returns {TemplateResult}
 */
export function renderRatingButtons(activeRating, onChange, hideDeleted, onHideDeletedChange) {
  return html`
    <div class="flex flex-wrap items-center gap-2">
      <label class="inline-flex items-center gap-2 text-xs text-gray-600">
        <input
          type="checkbox"
          class="h-4 w-4"
          .checked=${hideDeleted}
          @change=${onHideDeletedChange}
        >
        <span class="inline-flex items-center gap-2">
          <i class="fas fa-trash"></i>
          hide deleted
        </span>
      </label>
      <div class="flex items-center gap-1">
        ${[0, 1, 2, 3].map((value) => {
          const label = value === 0 ? '0' : `${value}+`;
          const title = value === 0 ? 'Quality = 0' : `Quality >= ${value}`;
          return html`
            <button
              class="inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs ${activeRating === value ? 'bg-yellow-100 text-yellow-800 border-yellow-200' : 'bg-gray-100 text-gray-500 border-gray-200'}"
              title=${title}
              @click=${() => onChange(value)}
            >
              <i class="fas fa-star"></i>
              <span>${label}</span>
            </button>
          `;
        })}
        <button
          class="inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs ${activeRating === 'unrated' ? 'bg-yellow-100 text-yellow-800 border-yellow-200' : 'bg-gray-100 text-gray-500 border-gray-200'}"
          title="Unrated images"
          @click=${() => onChange('unrated')}
        >
          <i class="fas fa-circle-notch"></i>
          <span>unrated</span>
        </button>
      </div>
    </div>
  `;
}

/**
 * Create hotspot handlers - eliminates duplication between explore and audit
 *
 * This factory creates all the handler methods needed for hotspot functionality.
 * Used to replace 15+ duplicate methods in photocat-app.js.
 *
 * @param {Object} context - Component context (usually `this` from LitElement)
 * @param {Object} config - Configuration object
 * @param {string} config.targetsProperty - Name of property storing targets array (e.g., 'curateExploreTargets')
 * @param {string} config.dragTargetProperty - Name of property for drag target (e.g., '_curateExploreHotspotDragTarget')
 * @param {string} config.nextIdProperty - Name of property for next ID (e.g., '_curateExploreHotspotNextId')
 * @param {Function} config.parseKeywordValue - Function to parse keyword value string
 * @param {Function} config.applyRating - Function to apply rating (imageIds, rating) => void
 * @param {Function} config.processTagDrop - Function to process tag drop (ids, target) => void
 * @param {Function} config.removeImages - Function to remove images by IDs
 * @returns {Object} Handler methods
 */
export function createHotspotHandlers(context, config) {
  const {
    targetsProperty,
    dragTargetProperty,
    nextIdProperty,
    parseKeywordValue,
    applyRating,
    processTagDrop,
    removeImages,
  } = config;

  return {
    /**
     * Handle keyword change for a hotspot
     */
    handleKeywordChange(event, targetId) {
      const value = event.target.value;
      const { category, keyword } = parseKeywordValue(value);
      context[targetsProperty] = (context[targetsProperty] || []).map((target) =>
        target.id === targetId ? { ...target, category, keyword, count: 0 } : target
      );
    },

    /**
     * Handle action change (add/remove) for a hotspot
     */
    handleActionChange(event, targetId) {
      const action = event.target.value === 'remove' ? 'remove' : 'add';
      context[targetsProperty] = (context[targetsProperty] || []).map((target) =>
        target.id === targetId ? { ...target, action, count: 0 } : target
      );
    },

    /**
     * Handle type change (permatag/rating) for a hotspot
     */
    handleTypeChange(event, targetId) {
      const type = event.target.value;
      context[targetsProperty] = (context[targetsProperty] || []).map((target) =>
        target.id === targetId
          ? { ...target, type, keyword: '', category: '', rating: '', action: 'add', count: 0 }
          : target
      );
    },

    /**
     * Handle rating change for a hotspot
     */
    handleRatingChange(event, targetId) {
      const rating = Number.parseInt(event.target.value, 10);
      context[targetsProperty] = (context[targetsProperty] || []).map((target) =>
        target.id === targetId ? { ...target, rating, count: 0 } : target
      );
    },

    /**
     * Add a new hotspot target
     */
    handleAddTarget() {
      const nextId = context[nextIdProperty] || 1;
      context[nextIdProperty] = nextId + 1;
      context[targetsProperty] = [
        ...(context[targetsProperty] || []),
        { id: nextId, category: '', keyword: '', action: 'add', count: 0 },
      ];
    },

    /**
     * Remove a hotspot target
     */
    handleRemoveTarget(targetId) {
      if (!context[targetsProperty] || context[targetsProperty].length <= 1) {
        return;
      }
      const firstId = context[targetsProperty][0]?.id;
      if (targetId === firstId) {
        return; // Can't remove first target
      }
      context[targetsProperty] = context[targetsProperty].filter(
        (target) => target.id !== targetId
      );
      if (context[dragTargetProperty] === targetId) {
        context[dragTargetProperty] = null;
      }
    },

    /**
     * Handle drag over hotspot
     */
    handleDragOver(event, targetId) {
      event.preventDefault();
      if (context[dragTargetProperty] !== targetId) {
        context[dragTargetProperty] = targetId;
        context.requestUpdate();
      }
    },

    /**
     * Handle drag leave hotspot
     */
    handleDragLeave() {
      if (context[dragTargetProperty] !== null) {
        context[dragTargetProperty] = null;
        context.requestUpdate();
      }
    },

    /**
     * Handle drop on hotspot
     */
    handleDrop(event, targetId) {
      event.preventDefault();
      const raw = event.dataTransfer?.getData('text/plain') || '';
      const ids = raw
        .split(',')
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((value) => Number.isFinite(value) && value > 0);

      if (!ids.length) {
        this.handleDragLeave();
        return;
      }

      const target = (context[targetsProperty] || []).find((entry) => entry.id === targetId);
      if (!target) {
        this.handleDragLeave();
        return;
      }

      // Handle rating hotspot
      if (target.type === 'rating') {
        if (typeof target.rating !== 'number' || target.rating < 0 || target.rating > 3) {
          this.handleDragLeave();
          return;
        }
        applyRating(ids, target.rating);
        context[targetsProperty] = context[targetsProperty].map((entry) =>
          entry.id === targetId ? { ...entry, count: (entry.count || 0) + ids.length } : entry
        );
      } else {
        // Handle tag hotspot
        if (!target.keyword) {
          this.handleDragLeave();
          return;
        }
        processTagDrop(ids, target);
        context[targetsProperty] = context[targetsProperty].map((entry) =>
          entry.id === targetId ? { ...entry, count: (entry.count || 0) + ids.length } : entry
        );
      }

      this.handleDragLeave();
    },
  };
}

/**
 * Parse utility keyword value from dropdown
 * Format: "category::keyword"
 * @param {string} value - Encoded value string
 * @returns {Object} { category, keyword }
 */
export function parseUtilityKeywordValue(value) {
  if (!value || value === '__untagged__') {
    return { category: '', keyword: '' };
  }
  const parts = value.split('::');
  if (parts.length === 2) {
    return {
      category: decodeURIComponent(parts[0]),
      keyword: decodeURIComponent(parts[1]),
    };
  }
  return { category: '', keyword: '' };
}

/**
 * Create selection handlers - eliminates duplication between explore and audit
 *
 * This factory creates handlers for long-press selection functionality.
 * Used to replace 10+ duplicate methods in photocat-app.js.
 *
 * @param {Object} context - Component context (usually `this` from LitElement)
 * @param {Object} config - Configuration object
 * @param {string} config.selectionProperty - Name of property for selection array (e.g., 'curateDragSelection')
 * @param {string} config.selectingProperty - Name of property for selecting state (e.g., 'curateDragSelecting')
 * @param {string} config.startIndexProperty - Name of property for start index (e.g., 'curateDragStartIndex')
 * @param {string} config.endIndexProperty - Name of property for end index (e.g., 'curateDragEndIndex')
 * @param {string} config.pressActiveProperty - Name of property for press active state (e.g., '_curatePressActive')
 * @param {string} config.pressStartProperty - Name of property for press start coords (e.g., '_curatePressStart')
 * @param {string} config.pressIndexProperty - Name of property for press index (e.g., '_curatePressIndex')
 * @param {string} config.pressImageIdProperty - Name of property for press image ID (e.g., '_curatePressImageId')
 * @param {string} config.pressTimerProperty - Name of property for press timer (e.g., '_curatePressTimer')
 * @param {string} config.longPressTriggeredProperty - Name of property for long press triggered (e.g., '_curateLongPressTriggered')
 * @param {Function} config.getOrder - Function to get image order array for selection (e.g., () => this._curateLeftOrder)
 * @param {Function} config.flashSelection - Function to flash selection feedback (e.g., (imageId) => this._flashCurateSelection(imageId))
 * @param {number} [config.longPressDelay=250] - Delay in ms before long press triggers
 * @param {number} [config.moveThreshold=6] - Movement threshold in pixels to cancel press
 * @param {string} [config.suppressClickProperty] - Property for suppressing click (defaults to _curateSuppressClick)
 * @param {boolean} [config.dragSelectOnMove=false] - Start selection when dragging beyond threshold
 * @returns {Object} Handler methods for selection functionality
 */
export function createSelectionHandlers(context, config) {
  const {
    selectionProperty,
    selectingProperty,
    startIndexProperty,
    endIndexProperty,
    pressActiveProperty,
    pressStartProperty,
    pressIndexProperty,
    pressImageIdProperty,
    pressTimerProperty,
    longPressTriggeredProperty,
    getOrder,
    flashSelection,
    longPressDelay = 250,
    moveThreshold = 6,
    suppressClickProperty,
    dragSelectOnMove = false,
  } = config;
  const suppressClickProp = suppressClickProperty || '_curateSuppressClick';

  return {
    /**
     * Cancel press state
     */
    cancelPressState() {
      if (context[pressTimerProperty]) {
        clearTimeout(context[pressTimerProperty]);
        context[pressTimerProperty] = null;
      }
      context[pressActiveProperty] = false;
      context[pressStartProperty] = null;
      context[pressIndexProperty] = null;
      context[pressImageIdProperty] = null;
      context[longPressTriggeredProperty] = false;
    },

    /**
     * Start selection at index
     */
    startSelection(index, imageId) {
      if (context[selectionProperty].includes(imageId)) {
        return;
      }
      this.cancelPressState();
      context[longPressTriggeredProperty] = true;
      context[selectingProperty] = true;
      context[startIndexProperty] = index;
      context[endIndexProperty] = index;
      context[suppressClickProp] = true;
      flashSelection(imageId);
      this.updateSelection();
    },

    /**
     * Handle pointer down
     */
    handlePointerDown(event, index, imageId) {
      if (context.curateDragSelecting || context.curateAuditDragSelecting) {
        return;
      }
      if (event.button !== 0) {
        return;
      }
      const alreadySelected = context[selectionProperty].length
        && context[selectionProperty].includes(imageId);
      if (alreadySelected) {
        context[suppressClickProp] = true;
        return;
      }
      if (dragSelectOnMove) {
        event.preventDefault();
      }
      context[suppressClickProp] = false;
      context[pressActiveProperty] = true;
      context[pressStartProperty] = { x: event.clientX, y: event.clientY };
      context[pressIndexProperty] = index;
      context[pressImageIdProperty] = imageId;
      context[pressTimerProperty] = setTimeout(() => {
        if (context[pressActiveProperty]) {
          this.startSelection(index, imageId);
        }
      }, longPressDelay);
    },

    /**
     * Handle pointer move
     */
    handlePointerMove(event) {
      if (!context[pressActiveProperty] || context[selectingProperty]) {
        return;
      }
      if (!context[pressStartProperty]) {
        return;
      }
      const dx = Math.abs(event.clientX - context[pressStartProperty].x);
      const dy = Math.abs(event.clientY - context[pressStartProperty].y);
      if (dx + dy > moveThreshold) {
        if (dragSelectOnMove && context[pressIndexProperty] !== null && context[pressImageIdProperty] !== null) {
          event.preventDefault();
          this.startSelection(context[pressIndexProperty], context[pressImageIdProperty]);
        } else {
          this.cancelPressState();
        }
      }
    },

    /**
     * Handle long press start
     */
    handleSelectStart(event, index, imageId) {
      if (context[selectionProperty].includes(imageId)) {
        return;
      }
      event.preventDefault();
      this.startSelection(index, imageId);
    },

    /**
     * Handle select hover
     */
    handleSelectHover(index) {
      if (!context[selectingProperty]) return;
      if (context[endIndexProperty] !== index) {
        context[endIndexProperty] = index;
        this.updateSelection();
      }
    },

    /**
     * Update selection based on start/end indices
     */
    updateSelection() {
      const order = getOrder();
      if (!order || context[startIndexProperty] === null || context[endIndexProperty] === null) {
        return;
      }
      const start = Math.min(context[startIndexProperty], context[endIndexProperty]);
      const end = Math.max(context[startIndexProperty], context[endIndexProperty]);
      const ids = order.slice(start, end + 1);
      context[selectionProperty] = ids;
    },

    /**
     * Clear selection
     */
    clearSelection() {
      context[selectionProperty] = [];
    },
  };
}

/**
 * Create rating drag handlers - eliminates duplication between explore and audit
 *
 * This factory creates handlers for drag-to-rating-bucket functionality.
 * Used to replace 4+ duplicate methods in photocat-app.js.
 *
 * @param {Object} context - Component context (usually `this` from LitElement)
 * @param {Object} config - Configuration object
 * @param {string} config.enabledProperty - Name of property for enabled state (e.g., 'curateExploreRatingEnabled')
 * @param {string} config.dragTargetProperty - Name of property for drag target (e.g., '_curateExploreRatingDragTarget')
 * @param {Function} config.showRatingDialog - Function to show rating dialog (imageIds) => void
 * @returns {Object} Handler methods
 */
export function createRatingDragHandlers(context, config) {
  const {
    enabledProperty,
    dragTargetProperty,
    showRatingDialog,
  } = config;

  return {
    /**
     * Toggle rating drag mode on/off
     */
    handleToggle() {
      context[enabledProperty] = !context[enabledProperty];
    },

    /**
     * Handle drag over rating drop zone
     */
    handleDragOver(event) {
      event.preventDefault();
      context[dragTargetProperty] = true;
      context.requestUpdate();
    },

    /**
     * Handle drag leave rating drop zone
     */
    handleDragLeave() {
      context[dragTargetProperty] = false;
      context.requestUpdate();
    },

    /**
     * Handle drop on rating zone
     */
    handleDrop(event) {
      event.preventDefault();
      const raw = event.dataTransfer?.getData('text/plain') || '';
      const ids = raw
        .split(',')
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((value) => Number.isFinite(value) && value > 0);

      if (!ids.length) {
        this.handleDragLeave();
        return;
      }

      // Show rating selection dialog
      showRatingDialog(ids);
      this.handleDragLeave();
    },
  };
}

/**
 * Create pagination handlers - eliminates duplication between explore and audit
 *
 * This factory creates handlers for pagination controls (prev/next page, limit change).
 * Used to replace 6+ duplicate methods in photocat-app.js.
 *
 * @param {Object} context - Component context (usually `this` from LitElement)
 * @param {Object} config - Configuration object
 * @param {string} config.loadingProperty - Name of property for loading state (e.g., 'curateAuditLoading')
 * @param {string} config.offsetProperty - Name of property for page offset (e.g., 'curateAuditPageOffset')
 * @param {string} config.limitProperty - Name of property for page limit (e.g., 'curateAuditLimit')
 * @param {string} [config.loadAllProperty] - Optional property for load all state (e.g., 'curateAuditLoadAll')
 * @param {Function} config.fetchData - Function to fetch data with new offset (e.g., (options) => this._fetchCurateAuditImages(options))
 * @returns {Object} Handler methods for pagination
 */
export function createPaginationHandlers(context, config) {
  const {
    loadingProperty,
    offsetProperty,
    limitProperty,
    loadAllProperty,
    fetchData,
  } = config;

  return {
    /**
     * Go to previous page
     */
    handlePagePrev() {
      if (context[loadingProperty]) return;
      const nextOffset = Math.max(0, (context[offsetProperty] || 0) - context[limitProperty]);
      if (loadAllProperty) {
        context[loadAllProperty] = false;
      }
      fetchData({ offset: nextOffset });
    },

    /**
     * Go to next page
     */
    handlePageNext() {
      if (context[loadingProperty]) return;
      const nextOffset = (context[offsetProperty] || 0) + context[limitProperty];
      if (loadAllProperty) {
        context[loadAllProperty] = false;
      }
      fetchData({ offset: nextOffset });
    },

    /**
     * Change page size limit
     */
    handleLimitChange(event) {
      const parsed = Number.parseInt(event.target.value, 10);
      const allowedSizes = new Set([50, 100, 200]);
      if (!Number.isFinite(parsed) || !allowedSizes.has(parsed)) {
        context[limitProperty] = 50;
      } else {
        context[limitProperty] = parsed;
      }
      // Reset to first page when limit changes
      if (loadAllProperty) {
        context[loadAllProperty] = false;
      }
      fetchData({ offset: 0, limit: context[limitProperty] });
    },
  };
}
