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
    disabled: loading,
    showPageSize: true,
  });
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
