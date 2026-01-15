import { LitElement, html, css } from 'lit';
import { getKeywords } from '../services/api.js';
import { tailwind } from './tailwind-lit.js';

class FilterControls extends LitElement {
  static styles = [tailwind, css`
    :host {
      display: block;
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
          changedProperties.has('listFilterId')) {
          this.fetchKeywords();
      }
  }

  async fetchKeywords() {
    if (!this.tenant) return;
    try {
      const filters = {
        rating: this.ratingFilter,
        ratingOperator: this.ratingOperator,
        hideZeroRating: this.hideZeroRating,
        listId: this.listFilterId,
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
    return html`
      <div class="bg-white rounded-lg shadow p-6 mb-6">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div class="md:col-span-2">
            <input
              id="searchInput"
              type="text"
              placeholder="Search tags..."
              class="w-full px-4 py-2 border rounded-lg"
              @keyup=${this._handleSearch}
            >
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
          <div class="flex items-end">
            <label class="inline-flex items-center gap-2 text-xs font-semibold text-gray-600">
              <input
                type="checkbox"
                class="h-4 w-4"
                .checked=${this.hideZeroRating}
                @change=${this._handleHideZeroChange}
              >
              hide 🗑
            </label>
          </div>
        </div>

        <!-- Faceted Search -->
        <div class="border-t pt-4">
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
      </div>
    `;
  }

  _renderCategoryFilter(category, keywords) {
    const filterText = this.filterInputs[category] || '';
    const selected = this.selectedKeywords[category] || new Set();
    const filteredKeywords = keywords.filter(kw => 
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
    return html`
        <div class="dropdown">
            ${keywords.map(kw => html`
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
      };
      this.dispatchEvent(new CustomEvent('filter-change', { detail: filters }));
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
    this._emitFilterChangeEvent();
  }

  _clearFilters() {
    Object.keys(this.keywords).forEach(category => {
        this.selectedKeywords[category].clear();
    });
    this.querySelector('#searchInput').value = '';
    this.listFilterId = '';
    this.ratingFilter = '';
    this.ratingOperator = 'gte';
    this.hideZeroRating = true;
    this.requestUpdate();
    this._emitFilterChangeEvent();
  }
}

customElements.define('filter-controls', FilterControls);
