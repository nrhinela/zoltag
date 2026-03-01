import { html } from 'lit';
import { formatStatNumber } from './formatting.js';

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
 * @param {string} [options.viewMode='thumb'] - Current results view mode ('thumb' | 'list')
 * @param {Function} [options.onViewModeChange] - View mode toggle handler
 * @param {boolean} [options.showViewModeToggle=false] - Show thumb/list icon buttons
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
  viewMode = 'thumb',
  onViewModeChange = null,
  showViewModeToggle = false,
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
  const normalizedViewMode = viewMode === 'list' ? 'list' : 'thumb';
  const showToggle = showViewModeToggle && typeof onViewModeChange === 'function';

  return html`
    <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
      <span class="font-semibold tracking-wide">${formattedTotal} ITEMS</span>
      <div class="flex items-center gap-3">
        ${showToggle ? html`
          <div class="results-view-toggle" role="group" aria-label="Results view mode">
            <button
              type="button"
              class="results-view-toggle-btn ${normalizedViewMode === 'thumb' ? 'active' : ''}"
              @click=${() => onViewModeChange?.('thumb')}
              ?disabled=${disabled}
              aria-label="Thumbnail view"
              aria-pressed=${normalizedViewMode === 'thumb' ? 'true' : 'false'}
              title="Thumbnail view"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="4" y="4" width="6.5" height="6.5" rx="1"></rect>
                <rect x="13.5" y="4" width="6.5" height="6.5" rx="1"></rect>
                <rect x="4" y="13.5" width="6.5" height="6.5" rx="1"></rect>
                <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"></rect>
              </svg>
            </button>
            <button
              type="button"
              class="results-view-toggle-btn ${normalizedViewMode === 'list' ? 'active' : ''}"
              @click=${() => onViewModeChange?.('list')}
              ?disabled=${disabled}
              aria-label="List view"
              aria-pressed=${normalizedViewMode === 'list' ? 'true' : 'false'}
              title="List view"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 6h13M7 12h13M7 18h13"></path>
                <circle cx="4" cy="6" r="1.2"></circle>
                <circle cx="4" cy="12" r="1.2"></circle>
                <circle cx="4" cy="18" r="1.2"></circle>
              </svg>
            </button>
          </div>
        ` : html``}
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
          type="button"
          class="curate-pane-action secondary"
          ?disabled=${disabled || !hasPrev}
          @click=${onPrev}
          aria-label="Previous page"
        >
          &lt;
        </button>
        <button
          type="button"
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
  const safeOffset = Number.isFinite(offset) ? offset : 0;
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 100;
  const totalCount = Number.isFinite(total) ? total : 0;
  const remaining = Math.max(0, totalCount - safeOffset);
  const count = Math.min(safeLimit, remaining);

  return renderResultsPagination({
    total: totalCount,
    offset: safeOffset,
    limit: safeLimit,
    count,
    onPrev: handlers.onPrev,
    onNext: handlers.onNext,
    onLimitChange: handlers.onLimitChange,
    viewMode: 'thumb',
    onViewModeChange: null,
    showViewModeToggle: false,
    disabled: loading,
    showPageSize: true,
  });
}

/**
 * Create pagination handlers - eliminates duplication between explore and audit
 *
 * This factory creates handlers for pagination controls (prev/next page, limit change).
 * Used to replace 6+ duplicate methods in zoltag-app.js.
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
