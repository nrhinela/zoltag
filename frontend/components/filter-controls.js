import { LitElement, html, css } from 'lit';
import { getKeywords, getTagStats } from '../services/api.js';
import { tailwind } from './tailwind-lit.js';
import './tag-histogram.js';

class FilterControls extends LitElement {
  static styles = [tailwind, css`
    :host {
      display: block;
    }
    .filter-container {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      height: 100%;
    }
    .top-row {
      display: flex;
      gap: 1rem;
      align-items: flex-start;
    }
    .controls-section {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .histogram-column {
      width: 280px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .histogram-column.collapsed {
      max-height: 180px;
      overflow: hidden;
    }
    .histogram-toggle {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0.5rem;
      font-size: 0.75rem;
      color: #666;
      background-color: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 0.25rem;
      cursor: pointer;
      text-align: center;
      margin-top: 0.5rem;
    }
    .histogram-toggle:hover {
      background-color: #f3f4f6;
    }
    .dropdown {
        position: absolute;
        z-index: 10;
        width: 100%;
        margin-top: 4px;
        background-color: white;
        border: 1px solid #e2e8f0;
        border-radius: 0.375rem;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        max-height: 16rem;
        overflow-y: auto;
    }
    .keyword-tag {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        background-color: #ebf8ff;
        color: #3182ce;
        padding: 0.25rem 0.5rem;
        border-radius: 0.25rem;
        font-size: 0.875rem;
    }
  `];

  static properties = {
    keywords: { type: Object },
    filterInputs: { type: Object },
    showDropdown: { type: Object },
    selectedKeywords: { type: Object },
    categoryOperators: { type: Object },
    tenant: { type: String },
    lists: { type: Array },
    listFilterId: { type: String },
    ratingFilter: { type: String },
    ratingOperator: { type: String },
    hideZeroRating: { type: Boolean },
    reviewedFilter: { type: String },
    dateSortOrder: { type: String },
    showLimit: { type: Boolean },
    limit: { type: Number },
    keywordsOnly: { type: Boolean },
    embedded: { type: Boolean },
    singleSelect: { type: Boolean },
    keywordSource: { type: String },
    helpTitle: { type: String },
    helpIntro: { type: String },
    helpSteps: { type: Array },
    showHistogram: { type: Boolean },
    tagStatsBySource: { type: Object },
    activeTagSource: { type: String },
    categoryCards: { type: Array },
    histogramExpanded: { type: Boolean },
  };
  constructor() {
    super();
    this.keywords = {};
    this.filterInputs = {};
    this.showDropdown = {};
    this.selectedKeywords = {};
    this.categoryOperators = {};
    this.lists = [];
    this.listFilterId = '';
    this.ratingFilter = '';
    this.ratingOperator = 'gte';
    this.hideZeroRating = true;
    this.reviewedFilter = '';
    this.dateSortOrder = 'desc';
    this.showLimit = false;
    this.limit = 200;
    this.keywordsOnly = false;
    this.embedded = false;
    this.singleSelect = false;
    this.keywordSource = '';
    this.helpTitle = '';
    this.helpIntro = '';
    this.helpSteps = [];
    this.showHistogram = false;
    this.tagStatsBySource = {};
    this.activeTagSource = 'permatags';
    this.categoryCards = [];
    this.histogramExpanded = false;
  }

  firstUpdated() {
    this._emitFilterChangeEvent();
  }

  willUpdate(changedProperties) {
      if (changedProperties.has('tenant')) {
          this.fetchKeywords();
      }
      // Refetch keywords when filters change to reflect counts
      if (changedProperties.has('ratingFilter') ||
          changedProperties.has('ratingOperator') ||
          changedProperties.has('hideZeroRating') ||
          changedProperties.has('listFilterId') ||
          changedProperties.has('reviewedFilter')) {
          this.fetchKeywords();
      }
      // Recalculate categoryCards when activeTagSource or tagStatsBySource changes
      if (changedProperties.has('activeTagSource') || changedProperties.has('tagStatsBySource')) {
          this._updateCategoryCards();
      }
  }

  _updateCategoryCards() {
      const sourceStats = this.tagStatsBySource?.[this.activeTagSource] || {};
      const categoryCards = Object.entries(sourceStats)
        .map(([category, keywords]) => {
          const keywordRows = (keywords || [])
            .filter((kw) => (kw.count || 0) > 0)
            .sort((a, b) => (b.count || 0) - (a.count || 0));
          if (!keywordRows.length) {
            return null;
          }
          const maxCount = keywordRows.reduce((max, kw) => Math.max(max, kw.count || 0), 0);
          const totalCount = keywordRows.reduce((sum, kw) => sum + (kw.count || 0), 0);
          return { category, keywordRows, maxCount, totalCount };
        })
        .filter(Boolean)
        .sort((a, b) => b.totalCount - a.totalCount);
      this.categoryCards = categoryCards;
  }

  async fetchKeywords() {
    if (!this.tenant) return;
    try {
      const filters = {
        rating: this.ratingFilter,
        ratingOperator: this.ratingOperator,
        hideZeroRating: this.hideZeroRating,
        listId: this.listFilterId,
        reviewed: this.reviewedFilter,
        source: this.keywordSource,
      };
      this.keywords = await getKeywords(this.tenant, filters);
      Object.keys(this.keywords).forEach(category => {
        this.selectedKeywords[category] = new Set();
        this.categoryOperators[category] = 'OR'; // Default to OR
      });
      this.requestUpdate();
    } catch (error) {
      console.error('Error fetching keywords:', error);
    }
  }

  render() {
    const containerClass = this.embedded ? '' : 'bg-white rounded-lg shadow p-6 mb-6';

    return html`
      <div class=${containerClass}>
        <div class="filter-container">
          <!-- Top Row: Filter Controls and Histogram (if enabled) -->
          <div class="top-row">
            <div class="controls-section">
              ${!this.keywordsOnly ? html`
                <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                  <div class="flex items-end">
                    <label class="inline-flex items-center gap-2 text-xs font-semibold text-gray-600">
                      <input
                        type="checkbox"
                        class="h-4 w-4"
                        .checked=${this.hideZeroRating}
                        @change=${this._handleHideZeroChange}
                      >
                      🗑 hide deleted
                    </label>
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-gray-600 mb-1">Reviewed?</label>
                    <select class="w-full px-4 py-2 border rounded-lg" .value=${this.reviewedFilter} @change=${this._handleReviewedChange}>
                      <option value="">All</option>
                      <option value="true">Reviewed</option>
                      <option value="false">Unreviewed</option>
                    </select>
                  </div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                  <div>
                    <label class="block text-xs font-semibold text-gray-600 mb-1">Filter by List</label>
                    <select class="w-full px-4 py-2 border rounded-lg" .value=${this.listFilterId} @change=${this._handleListFilterChange}>
                      <option value="">All lists</option>
                      ${this.lists.map((list) => html`
                        <option value=${String(list.id)}>${list.title}</option>
                      `)}
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-gray-600 mb-1">Filter by Rating</label>
                    <select class="w-full px-4 py-2 border rounded-lg" .value=${this.ratingFilter} @change=${this._handleRatingFilterChange}>
                      <option value="">All ratings</option>
                      <option value="0">0</option>
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-gray-600 mb-1">Rating Operator</label>
                    <select class="w-full px-4 py-2 border rounded-lg" .value=${this.ratingOperator} @change=${this._handleRatingOperatorChange}>
                      <option value="gte">>=</option>
                      <option value="gt">></option>
                      <option value="eq">==</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-gray-600 mb-1">Sort by Date</label>
                    <select class="w-full px-4 py-2 border rounded-lg" .value=${this.dateSortOrder} @change=${this._handleDateSortChange}>
                      <option value="desc">Newest first</option>
                      <option value="asc">Oldest first</option>
                    </select>
                  </div>
                  ${this.showLimit ? html`
                    <div>
                      <label class="block text-xs font-semibold text-gray-600 mb-1">Limit</label>
                      <input
                        type="number"
                        min="1"
                        class="w-full px-4 py-2 border rounded-lg"
                        .value=${String(this.limit)}
                        @input=${this._handleLimitChange}
                      >
                    </div>
                  ` : html``}
                </div>
              ` : html``}
            </div>
            ${this.showHistogram ? html`
              <div class="histogram-column ${this.histogramExpanded ? '' : 'collapsed'}">
                <tag-histogram
                  .categoryCards=${this.categoryCards}
                  .activeTagSource=${this.activeTagSource}
                  .tagStatsBySource=${this.tagStatsBySource}
                  @tag-source-change=${this._handleTagSourceChange}
                ></tag-histogram>
                <button class="histogram-toggle" @click=${this._toggleHistogramExpanded}>
                  ${this.histogramExpanded ? 'Show less ▲' : 'Show more ▼'}
                </button>
              </div>
            ` : html``}
          </div>

          <!-- Second Row: Keywords and Help Text -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; border-top: 1px solid #e5e7eb; padding-top: 1rem;">
            <!-- Left Column: Keywords -->
            <div>
              <div class="flex items-center gap-4 mb-3">
                <div class="flex items-center gap-2">
                  <label class="text-sm text-gray-600 font-semibold">Filter by Keywords:</label>
                  <span id="activeFiltersCount" class="bg-blue-600 text-white text-xs px-2 py-1 rounded-full hidden">0</span>
                </div>
                <button @click=${this._clearFilters} class="text-sm text-red-600 hover:text-red-700 ml-auto">
                  <i class="fas fa-times mr-1"></i>Clear All
                </button>
              </div>

              <!-- Tag Input with Autocomplete - One per category -->
              <div id="categoryInputsContainer" class="space-y-3">
                ${Object.entries(this.keywords).map(([category, keywords]) => this._renderCategoryFilter(category, keywords))}
              </div>
            </div>

            <!-- Right Column: Reserved for Help Text -->
            <div class="bg-gray-50 rounded-lg p-4 border border-gray-200 text-sm text-gray-600">
              <p class="font-semibold text-gray-700 mb-2">${this.helpTitle || 'Keywords Help'}</p>
              <p class="mb-2">${this.helpIntro || 'Select keywords to filter images. Use the operator buttons to choose AND/OR logic between categories.'}</p>
              ${this.helpSteps?.length ? html`
                <ol class="list-decimal ml-4 space-y-1">
                  ${this.helpSteps.map((step) => html`<li>${step}</li>`)}
                </ol>
              ` : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _renderCategoryFilter(category, keywords) {
    const filterText = this.filterInputs[category] || '';
    const selected = this.selectedKeywords[category] || new Set();
    const filteredKeywords = [...keywords].sort((a, b) => a.keyword.localeCompare(b.keyword)).filter(kw => 
        !selected.has(kw.keyword) &&
        kw.keyword.toLowerCase().includes(filterText.toLowerCase())
    );

    return html`
      <div class="space-y-1">
        <div class="flex items-center justify-between">
            <label class="text-xs font-semibold text-gray-600 uppercase">${category}</label>
            <button class="px-2 py-0.5 rounded bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700" @click=${() => this._toggleOperator(category)}>
                ${this.categoryOperators[category] || 'OR'}
            </button>
        </div>
        <div class="relative">
          <div class="min-h-[42px] border rounded-lg p-2 bg-white flex flex-wrap gap-2 items-center cursor-text">
            ${[...selected].map(keyword => html`
                <span class="keyword-tag">
                    <span>${keyword}</span>
                    <button @click=${() => this._removeKeyword(category, keyword)}>×</button>
                </span>
            `)}
            <input
              type="text"
              .value=${filterText}
              @input=${e => this._handleCategoryInput(category, e.target.value)}
              @focus=${() => this._setDropdownVisibility(category, true)}
              @blur=${() => setTimeout(() => this._setDropdownVisibility(category, false), 100)}
              placeholder="Type to search ${category}..."
              class="flex-1 min-w-[200px] outline-none text-sm"
              autocomplete="off"
            >
          </div>
          ${this.showDropdown[category] ? this._renderDropdown(category, filteredKeywords) : ''}
        </div>
      </div>
    `;
  }

  _renderDropdown(category, keywords) {
    const sortedKeywords = [...keywords].sort((a, b) => a.keyword.localeCompare(b.keyword));
    return html`
        <div class="dropdown">
            ${sortedKeywords.map(kw => html`
                <div class="px-3 py-2 hover:bg-blue-50 cursor-pointer flex justify-between" @click=${() => this._selectKeyword(category, kw.keyword)}>
                    <span class="text-sm">${kw.keyword}</span>
                    <span class="text-xs text-gray-400">(${kw.count})</span>
                </div>
            `)}
        </div>
    `;
  }

  _toggleOperator(category) {
      this.categoryOperators[category] = this.categoryOperators[category] === 'OR' ? 'AND' : 'OR';
      this.requestUpdate();
      this._emitFilterChangeEvent();
  }


  _handleCategoryInput(category, value) {
    this.filterInputs = { ...this.filterInputs, [category]: value };
    this._setDropdownVisibility(category, true);
  }

  _setDropdownVisibility(category, isVisible) {
      this.showDropdown = {...this.showDropdown, [category]: isVisible};
  }

  _selectKeyword(category, keyword) {
    if (this.singleSelect) {
      Object.keys(this.selectedKeywords).forEach((key) => {
        this.selectedKeywords[key].clear();
      });
    }
    this.selectedKeywords[category].add(keyword);
    this.filterInputs = { ...this.filterInputs, [category]: '' };
    this._setDropdownVisibility(category, false);
    this.requestUpdate();
    this._emitFilterChangeEvent();
  }

  _removeKeyword(category, keyword) {
      this.selectedKeywords[category].delete(keyword);
      this.requestUpdate();
      this._emitFilterChangeEvent();
  }

  _emitFilterChangeEvent() {
      const searchInput = this.shadowRoot.querySelector('#searchInput');

      const filters = {
          search: searchInput ? searchInput.value : '',
          keywords: this.selectedKeywords,
          operators: this.categoryOperators,
          listId: this.listFilterId,
          rating: this.ratingFilter,
          ratingOperator: this.ratingOperator,
          hideZeroRating: this.hideZeroRating,
          reviewed: this.reviewedFilter,
          sortOrder: this.dateSortOrder,
      };
      if (this.showLimit) {
        filters.limit = this.limit;
      }
      this.dispatchEvent(new CustomEvent('filter-change', {
        detail: filters,
        bubbles: true,
        composed: true,
      }));
  }

  _handleSearch(e) {
    this._emitFilterChangeEvent();
  }

  _handleListFilterChange(e) {
    this.listFilterId = e.target.value;
    this._emitFilterChangeEvent();
  }

  _handleRatingFilterChange(e) {
    this.ratingFilter = e.target.value;
    this._emitFilterChangeEvent();
  }

  _handleRatingOperatorChange(e) {
    this.ratingOperator = e.target.value;
    this._emitFilterChangeEvent();
  }

  _handleHideZeroChange(e) {
    this.hideZeroRating = e.target.checked;
    this.fetchKeywords();
    this._emitFilterChangeEvent();
  }

  _handleReviewedChange(e) {
    this.reviewedFilter = e.target.value;
    this.fetchKeywords();
    this._emitFilterChangeEvent();
  }

  _handleDateSortChange(e) {
    this.dateSortOrder = e.target.value;
    this._emitFilterChangeEvent();
  }

  _handleLimitChange(e) {
    const parsed = Number.parseInt(e.target.value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      this.limit = 200;
    } else {
      this.limit = parsed;
    }
    this._emitFilterChangeEvent();
  }

  _clearFilters() {
    Object.keys(this.keywords).forEach(category => {
        this.selectedKeywords[category].clear();
    });
    const searchInput = this.querySelector('#searchInput');
    if (searchInput) {
      searchInput.value = '';
    }
    if (!this.keywordsOnly) {
      this.listFilterId = '';
      this.ratingFilter = '';
      this.ratingOperator = 'gte';
      this.hideZeroRating = true;
      this.dateSortOrder = 'desc';
      if (this.showLimit) {
        this.limit = 200;
      }
    }
    this.requestUpdate();
    this._emitFilterChangeEvent();
  }

  _handleTagSourceChange(e) {
    this.activeTagSource = e.detail.source;
    this._updateCategoryCards();
  }

  _toggleHistogramExpanded() {
    this.histogramExpanded = !this.histogramExpanded;
  }
}

customElements.define('filter-controls', FilterControls);
