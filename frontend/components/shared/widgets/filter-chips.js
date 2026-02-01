import { LitElement, html, css } from 'lit';
import { tailwind } from '../../tailwind-lit.js';

class FilterChips extends LitElement {
  static styles = [tailwind, css`
    :host {
      display: block;
    }
    .filter-menu {
      position: absolute;
      top: 100%;
      left: 0;
      margin-top: 4px;
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      z-index: 50;
      min-width: 200px;
    }
    .filter-menu-item {
      padding: 10px 16px;
      cursor: pointer;
      border-bottom: 1px solid #f3f4f6;
      transition: background-color 0.15s;
    }
    .filter-menu-item:last-child {
      border-bottom: none;
    }
    .filter-menu-item:hover {
      background: #f9fafb;
    }
    .filter-controls {
      position: relative;
      flex: 1 1 100%;
      min-width: 220px;
    }
    .value-selector {
      position: absolute;
      top: 100%;
      left: 0;
      margin-top: 4px;
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      z-index: 50;
      min-width: 300px;
      max-width: 400px;
      max-height: 400px;
      overflow-y: auto;
    }
    .value-selector.full-width {
      left: 0;
      right: 0;
      width: 100%;
      min-width: 0;
      max-width: 100%;
    }
    .keyword-option {
      padding: 8px 16px;
      cursor: pointer;
      transition: background-color 0.15s;
      border-bottom: 1px solid #f9fafb;
    }
    .keyword-option:last-child {
      border-bottom: none;
    }
    .keyword-option:hover {
      background: #f3f4f6;
    }
    .keyword-category {
      padding: 8px 16px;
      font-weight: 600;
      color: #6b7280;
      background: #f9fafb;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
  `];

  static properties = {
    tenant: { type: String },
    tagStatsBySource: { type: Object },
    activeCurateTagSource: { type: String },
    imageStats: { type: Object },
    activeFilters: { type: Array },
    filterMenuOpen: { type: Boolean },
    valueSelectorOpen: { type: String },
    dropboxFolders: { type: Array },
    searchDropboxQuery: { type: String },
  };

  constructor() {
    super();
    this.tenant = '';
    this.tagStatsBySource = {};
    this.activeCurateTagSource = 'permatags';
    this.imageStats = {};
    this.activeFilters = [];
    this.filterMenuOpen = false;
    this.valueSelectorOpen = null;
    this.dropboxFolders = [];
    this.searchDropboxQuery = '';
  }

  _getAvailableFilterTypes() {
    const active = new Set(this.activeFilters.map(f => f.type));
    const all = [
      { type: 'keyword', label: 'Keywords', icon: '🏷️' },
      { type: 'rating', label: 'Rating', icon: '⭐' },
      { type: 'folder', label: 'Folder', icon: '📂' },
    ];
    return all.filter(f => !active.has(f.type));
  }

  _handleAddFilterClick() {
    this.filterMenuOpen = !this.filterMenuOpen;
    if (this.filterMenuOpen) {
      this.valueSelectorOpen = null;
    }
  }

  _handleFilterTypeSelect(type) {
    this.filterMenuOpen = false;
    this.valueSelectorOpen = type;
  }

  _handleKeywordSelect(category, keyword) {
    this.valueSelectorOpen = null;
    const filter = {
      type: 'keyword',
      category,
      value: keyword,
      displayLabel: 'Keywords',
      displayValue: keyword,
    };
    this._addFilter(filter);
  }

  _handleRatingSelect(rating) {
    this.valueSelectorOpen = null;
    const displayValue = rating === 0 ? '0' : `${rating}+`;
    const filter = {
      type: 'rating',
      value: rating,
      displayLabel: 'Rating',
      displayValue,
    };
    this._addFilter(filter);
  }

  _handleFolderSelect(folder) {
    this.valueSelectorOpen = null;
    this.searchDropboxQuery = ''; // Clear the input
    const filter = {
      type: 'folder',
      value: folder,
      displayLabel: 'Folder',
      displayValue: folder,
    };
    this._addFilter(filter);
  }

  _addFilter(filter) {
    this.activeFilters = [...this.activeFilters, filter];
    this.dispatchEvent(new CustomEvent('filters-changed', {
      detail: { filters: this.activeFilters },
      bubbles: true,
      composed: true,
    }));
  }

  _removeFilter(index) {
    this.activeFilters = this.activeFilters.filter((_, i) => i !== index);
    this.dispatchEvent(new CustomEvent('filters-changed', {
      detail: { filters: this.activeFilters },
      bubbles: true,
      composed: true,
    }));
  }

  _getKeywordsByCategory() {
    // Group keywords by category with counts, returns array of [category, keywords] tuples
    const sourceStats = this.tagStatsBySource?.[this.activeCurateTagSource] || this.tagStatsBySource?.permatags || {};
    const result = [];

    Object.entries(sourceStats).forEach(([category, keywords]) => {
        const categoryKeywords = (keywords || [])
            .map(kw => ({
                keyword: kw.keyword,
                count: kw.count || 0
            }))
            .sort((a, b) => a.keyword.localeCompare(b.keyword));

        if (categoryKeywords.length > 0) {
            result.push([category, categoryKeywords]);
        }
    });

    // Sort categories alphabetically
    return result.sort((a, b) => a[0].localeCompare(b[0]));
  }

  _getCategoryCount(category) {
    // Get total positive permatag count for a category
    const sourceStats = this.tagStatsBySource?.[this.activeCurateTagSource] || this.tagStatsBySource?.permatags || {};
    const keywords = sourceStats[category] || [];
    return (keywords || []).reduce((sum, kw) => sum + (kw.count || 0), 0);
  }

  _renderFilterMenu() {
    const available = this._getAvailableFilterTypes();
    if (!available.length) return html``;

    return html`
      <div class="filter-menu">
        ${available.map(filterType => html`
          <div
            class="filter-menu-item"
            @click=${() => this._handleFilterTypeSelect(filterType.type)}
          >
            <span class="mr-2">${filterType.icon}</span>
            <span>${filterType.label}</span>
          </div>
        `)}
      </div>
    `;
  }

  _renderValueSelector() {
    if (!this.valueSelectorOpen) return html``;

    switch (this.valueSelectorOpen) {
      case 'keyword':
        return this._renderKeywordSelector();
      case 'rating':
        return this._renderRatingSelector();
      case 'folder':
        return this._renderFolderSelector();
      default:
        return html``;
    }
  }

  _renderKeywordSelector() {
    const categories = this._getKeywordsByCategory();
    const untaggedCount = this.imageStats?.untagged_positive_count || 0;

    return html`
      <div class="value-selector">
        ${untaggedCount > 0 ? html`
          <div
            class="keyword-option"
            @click=${() => this._handleKeywordSelect('Untagged', '__untagged__')}
          >
            <strong>Untagged</strong> (${untaggedCount})
          </div>
        ` : ''}
        ${categories.map(([category, keywords]) => html`
          <div class="keyword-category">${category} (${this._getCategoryCount(category)})</div>
          ${keywords.map(kw => html`
            <div
              class="keyword-option"
              @click=${() => this._handleKeywordSelect(category, kw.keyword)}
            >
              ${kw.keyword} <span class="text-gray-500 text-sm">(${kw.count || 0})</span>
            </div>
          `)}
        `)}
      </div>
    `;
  }

  _renderRatingSelector() {
    return html`
      <div class="value-selector">
        <div class="p-4">
          <div class="text-sm font-semibold text-gray-700 mb-3">Minimum Rating</div>
          <div class="flex gap-2">
            ${[0, 1, 2, 3].map(rating => {
              const label = rating === 0 ? '0' : `${rating}+`;
              const title = rating === 0 ? 'Quality = 0' : `Quality >= ${rating}`;
              return html`
                <button
                  class="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50"
                  title=${title}
                  @click=${() => this._handleRatingSelect(rating)}
                >
                  <i class="fas fa-star text-yellow-500"></i>
                  <span class="ml-1">${label}</span>
                </button>
              `;
            })}
          </div>
        </div>
      </div>
    `;
  }

  _renderFolderSelector() {
    return html`
      <div class="value-selector full-width">
        <div class="p-4">
          <div class="text-sm font-semibold text-gray-700 mb-2">Dropbox Folder</div>
          <input
            type="text"
            class="w-full px-3 py-2 border rounded-lg text-sm"
            placeholder="Search folders..."
            .value=${this.searchDropboxQuery}
            @input=${(e) => {
              this.searchDropboxQuery = e.target.value;
              // Trigger folder search
              this.dispatchEvent(new CustomEvent('folder-search', {
                detail: { query: e.target.value },
                bubbles: true,
                composed: true,
              }));
            }}
          >
          ${this.dropboxFolders && this.dropboxFolders.length > 0 ? html`
            <div class="mt-2 max-h-64 overflow-y-auto border rounded-lg">
              ${this.dropboxFolders.map(folder => html`
                <div
                  class="keyword-option cursor-pointer"
                  @click=${() => this._handleFolderSelect(folder)}
                >
                  ${folder}
                </div>
              `)}
            </div>
          ` : this.searchDropboxQuery.trim() ? html`
            <div class="mt-2 text-xs text-gray-500 p-2">
              No folders found. Type to search...
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  _handleClickOutside(e) {
    if (!e.composedPath().includes(this)) {
      this.filterMenuOpen = false;
      this.valueSelectorOpen = null;
    }
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('click', this._handleClickOutside.bind(this));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this._handleClickOutside.bind(this));
  }

  render() {
    return html`
      <div class="bg-white rounded-lg shadow p-4 mb-4">
        <!-- FILTERS Section -->
        <div class="mb-4">
          <div class="text-xs font-semibold text-gray-500 uppercase mb-2">Filters</div>
          <div class="flex flex-wrap items-center gap-2">
            <!-- Active filter chips -->
            ${this.activeFilters.map((filter, index) => html`
              <div class="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-full text-sm">
                <span class="font-medium text-blue-900">${filter.displayLabel}:</span>
                <span class="text-blue-700">${filter.displayValue}</span>
                <button
                  @click=${() => this._removeFilter(index)}
                  class="ml-1 text-blue-600 hover:text-blue-800"
                  aria-label="Remove filter"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            `)}

            <!-- Add filter button -->
            <div class="filter-controls">
              <button
                @click=${this._handleAddFilterClick}
                class="inline-flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-full text-sm text-gray-700 hover:bg-gray-50"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                </svg>
                <span>Add filter</span>
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                </svg>
              </button>
              ${this.filterMenuOpen ? this._renderFilterMenu() : ''}
              ${this._renderValueSelector()}
            </div>
          </div>
        </div>

        <!-- SORT & DISPLAY Section -->
        <div class="border-t pt-4">
          <div class="text-xs font-semibold text-gray-500 uppercase mb-2">Sort & Display</div>
          <div class="flex flex-wrap items-center gap-4">
            <slot name="sort-controls"></slot>
            <slot name="view-controls"></slot>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('filter-chips', FilterChips);
