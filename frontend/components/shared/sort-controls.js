import { html } from 'lit';

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
