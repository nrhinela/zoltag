import { LitElement, html } from 'lit';
import { tailwind } from '../../tailwind-lit.js';
import { getKeywordsByCategory, getCategoryCount, getKeywordsByCategoryFromList, getCategoryCountFromList } from '../keyword-utils.js';

class FilterChips extends LitElement {
  // Use Light DOM to access Tailwind CSS classes
  createRenderRoot() {
    return this;
  }

  static properties = {
    tenant: { type: String },
    tagStatsBySource: { type: Object },
    activeCurateTagSource: { type: String },
    keywords: { type: Array },
    imageStats: { type: Object },
    activeFilters: { type: Array },
    availableFilterTypes: { type: Array },
    filterMenuOpen: { type: Boolean },
    valueSelectorOpen: { type: String },
    dropboxFolders: { type: Array },
    searchDropboxQuery: { type: String },
    renderSortControls: { type: Object },
    renderFiltersActions: { type: Object },
    lists: { type: Array },
    listFilterMode: { type: String },
    keywordMultiSelect: { type: Boolean },
    keywordSearchQuery: { type: String },
    filenameFilterQuery: { type: String },
  };

  constructor() {
    super();
    this.tenant = '';
    this.tagStatsBySource = {};
    this.activeCurateTagSource = 'permatags';
    this.keywords = [];
    this.imageStats = {};
    this.activeFilters = [];
    this.availableFilterTypes = null;
    this.filterMenuOpen = false;
    this.valueSelectorOpen = null;
    this.dropboxFolders = [];
    this.searchDropboxQuery = '';
    this.renderSortControls = null;
    this.renderFiltersActions = null;
    this.lists = [];
    this.listFilterMode = 'include';
    this.keywordMultiSelect = true;
    this.keywordSearchQuery = '';
    this.filenameFilterQuery = '';
  }

  _getKeywordFilter() {
    return (this.activeFilters || []).find((filter) => filter.type === 'keyword') || null;
  }

  _normalizeKeywordFilter(filter) {
    const keywordsByCategory = {};
    let operator = 'OR';
    let untagged = false;

    if (!filter) {
      return { keywordsByCategory, operator, untagged };
    }

    if (filter.untagged || filter.value === '__untagged__') {
      return { keywordsByCategory, operator, untagged: true };
    }

    if (filter.keywordsByCategory && typeof filter.keywordsByCategory === 'object') {
      Object.entries(filter.keywordsByCategory).forEach(([category, values]) => {
        const list = Array.isArray(values) ? values : Array.from(values || []);
        if (list.length) {
          keywordsByCategory[category] = new Set(list);
        }
      });
    } else if (filter.category && filter.value) {
      keywordsByCategory[filter.category] = new Set([filter.value]);
    }

    if (filter.operator) {
      operator = filter.operator;
    } else if (filter.operatorsByCategory && typeof filter.operatorsByCategory === 'object') {
      const values = Object.values(filter.operatorsByCategory).filter(Boolean);
      const unique = Array.from(new Set(values));
      if (unique.length === 1) {
        operator = unique[0];
      }
    }

    return { keywordsByCategory, operator, untagged };
  }

  _buildKeywordFilterPayload({ keywordsByCategory, operator, untagged }) {
    if (untagged) {
      return {
        type: 'keyword',
        untagged: true,
        displayLabel: 'Keywords',
        displayValue: 'Untagged',
      };
    }

    const normalizedKeywords = {};
    Object.entries(keywordsByCategory || {}).forEach(([category, keywordSet]) => {
      const list = Array.from(keywordSet || []).filter(Boolean);
      if (list.length) {
        normalizedKeywords[category] = list;
      }
    });

    return {
      type: 'keyword',
      keywordsByCategory: normalizedKeywords,
      operator: operator || 'OR',
      displayLabel: 'Keywords',
      displayValue: Object.keys(normalizedKeywords).length ? 'Multiple' : '',
    };
  }

  _getAvailableFilterTypes() {
    const active = new Set(this.activeFilters.map(f => f.type));
    const all = [
      { type: 'keyword', label: 'Keywords', icon: '🏷️' },
      { type: 'rating', label: 'Rating', icon: '⭐' },
      { type: 'folder', label: 'Folder', icon: '📂' },
      { type: 'list', label: 'List', icon: '🧾' },
      { type: 'filename', label: 'Filename', icon: '📝' },
    ];
    const allowed = Array.isArray(this.availableFilterTypes) && this.availableFilterTypes.length
      ? new Set(this.availableFilterTypes)
      : null;
    return all
      .filter(f => !active.has(f.type))
      .filter(f => !allowed || allowed.has(f.type));
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
    if (type === 'list') {
      if (!this.listFilterMode) {
        this.listFilterMode = 'include';
      }
      if (!Array.isArray(this.lists) || this.lists.length === 0) {
        this._requestLists();
      }
    }
    if (type === 'folder') {
      this.searchDropboxQuery = '';
      this._requestFolders({ query: '', limit: 500 });
    }
    if (type === 'filename') {
      const existing = (this.activeFilters || []).find((filter) => filter.type === 'filename');
      this.filenameFilterQuery = existing?.value || '';
    }
  }

  _handleEditFilter(type, index) {
    // Close any open menus and open the value selector for this filter type
    this.filterMenuOpen = false;
    this.valueSelectorOpen = type;
    if (type === 'list') {
      const existing = this.activeFilters[index];
      this.listFilterMode = existing?.mode === 'exclude' ? 'exclude' : 'include';
      if (!Array.isArray(this.lists) || this.lists.length === 0) {
        this._requestLists();
      }
    }
    if (type === 'folder') {
      this._requestFolders({ query: this.searchDropboxQuery || '', limit: 500 });
    }
    if (type === 'filename') {
      const existing = this.activeFilters[index];
      this.filenameFilterQuery = existing?.value || '';
    }
  }

  _handleKeywordSelect(category, keyword) {
    const keywordFilter = this._getKeywordFilter();
    const state = this._normalizeKeywordFilter(keywordFilter);

    if (!this.keywordMultiSelect) {
      this.valueSelectorOpen = null;
      if (keyword === '__untagged__') {
        this._addFilter(this._buildKeywordFilterPayload({ keywordsByCategory: {}, operator: state.operator, untagged: true }));
        return;
      }
      const keywordsByCategory = { [category]: new Set([keyword]) };
      this._addFilter(this._buildKeywordFilterPayload({ keywordsByCategory, operator: state.operator, untagged: false }));
      return;
    }

    if (keyword === '__untagged__') {
      if (state.untagged) {
        this._removeKeywordFilter();
      } else {
        this._addFilter(this._buildKeywordFilterPayload({ keywordsByCategory: {}, operator: state.operator, untagged: true }));
      }
      return;
    }

    if (state.untagged) {
      state.untagged = false;
    }

    const keywordsByCategory = { ...state.keywordsByCategory };
    const set = keywordsByCategory[category] ? new Set(keywordsByCategory[category]) : new Set();
    if (set.has(keyword)) {
      set.delete(keyword);
    } else {
      set.add(keyword);
    }
    if (set.size) {
      keywordsByCategory[category] = set;
    } else {
      delete keywordsByCategory[category];
    }

    if (!Object.keys(keywordsByCategory).length) {
      this._removeKeywordFilter();
      return;
    }

    this._addFilter(this._buildKeywordFilterPayload({ keywordsByCategory, operator: state.operator, untagged: false }));
  }

  _removeKeywordFilter() {
    const nextFilters = (this.activeFilters || []).filter((filter) => filter.type !== 'keyword');
    this.activeFilters = nextFilters;
    this.dispatchEvent(new CustomEvent('filters-changed', {
      detail: { filters: this.activeFilters },
      bubbles: true,
      composed: true,
    }));
  }

  _handleKeywordRemove(category, keyword) {
    const keywordFilter = this._getKeywordFilter();
    const state = this._normalizeKeywordFilter(keywordFilter);
    const keywordsByCategory = { ...state.keywordsByCategory };
    const set = keywordsByCategory[category] ? new Set(keywordsByCategory[category]) : new Set();
    set.delete(keyword);
    if (set.size) {
      keywordsByCategory[category] = set;
    } else {
      delete keywordsByCategory[category];
    }

    if (!Object.keys(keywordsByCategory).length) {
      this._removeKeywordFilter();
      return;
    }

    this._addFilter(this._buildKeywordFilterPayload({ keywordsByCategory, operator: state.operator, untagged: false }));
  }

  _toggleKeywordOperator() {
    const keywordFilter = this._getKeywordFilter();
    const state = this._normalizeKeywordFilter(keywordFilter);
    const current = state.operator || 'OR';
    const nextOperator = current === 'OR' ? 'AND' : 'OR';
    this._addFilter(this._buildKeywordFilterPayload({
      keywordsByCategory: state.keywordsByCategory,
      operator: nextOperator,
      untagged: false,
    }));
  }

  _handleRatingSelect(rating) {
    this.valueSelectorOpen = null;
    const displayValue = rating === 'unrated'
      ? 'Unrated'
      : (rating === 0 ? html`<span class="text-gray-600" title="Rating 0" aria-label="Trash">🗑</span>` : `${rating}+`);
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

  _handleListModeChange(mode) {
    this.listFilterMode = mode === 'exclude' ? 'exclude' : 'include';
  }

  _handleListSelect(list) {
    if (!list) return;
    this.valueSelectorOpen = null;
    const mode = this.listFilterMode === 'exclude' ? 'exclude' : 'include';
    const title = list.title || `List ${list.id}`;
    const displayValue = mode === 'exclude' ? `Not in ${title}` : title;
    const filter = {
      type: 'list',
      value: list.id,
      mode,
      displayLabel: 'List',
      displayValue,
    };
    this._addFilter(filter);
  }

  _handleFilenameInput(value) {
    this.filenameFilterQuery = String(value || '');
  }

  _clearFilenameFilter() {
    this.filenameFilterQuery = '';
    this._removeFilterByType('filename');
    this.valueSelectorOpen = null;
    this.filterMenuOpen = false;
  }

  _applyFilenameFilter() {
    const trimmed = (this.filenameFilterQuery || '').trim();
    if (!trimmed) {
      this._removeFilterByType('filename');
    } else {
      this._addFilter({
        type: 'filename',
        value: trimmed,
        displayLabel: 'Filename',
        displayValue: trimmed,
      });
    }
    this.valueSelectorOpen = null;
    this.filterMenuOpen = false;
  }

  _removeFilterByType(type) {
    const nextFilters = (this.activeFilters || []).filter((filter) => filter.type !== type);
    if (nextFilters.length === (this.activeFilters || []).length) return;
    this.activeFilters = nextFilters;
    this.dispatchEvent(new CustomEvent('filters-changed', {
      detail: { filters: this.activeFilters },
      bubbles: true,
      composed: true,
    }));
  }

  _addFilter(filter) {
    const nextFilters = [...this.activeFilters];
    const existingIndex = nextFilters.findIndex((entry) => entry.type === filter.type);
    if (existingIndex >= 0) {
      nextFilters[existingIndex] = filter;
    } else {
      nextFilters.push(filter);
    }
    this.activeFilters = nextFilters;
    this.dispatchEvent(new CustomEvent('filters-changed', {
      detail: { filters: this.activeFilters },
      bubbles: true,
      composed: true,
    }));
  }

  _removeFilter(index) {
    const removed = this.activeFilters[index];
    this.activeFilters = this.activeFilters.filter((_, i) => i !== index);
    if (removed?.type === 'list') {
      this.listFilterMode = 'include';
    } else if (removed?.type === 'filename') {
      this.filenameFilterQuery = '';
    }
    this.dispatchEvent(new CustomEvent('filters-changed', {
      detail: { filters: this.activeFilters },
      bubbles: true,
      composed: true,
    }));
  }

  _getKeywordsByCategory() {
    // Group keywords by category with counts, returns array of [category, keywords] tuples
    if (this.keywords && this.keywords.length) {
      return getKeywordsByCategoryFromList(this.keywords);
    }
    return getKeywordsByCategory(this.tagStatsBySource, this.activeCurateTagSource);
  }

  _getCategoryCount(category) {
    // Get total positive permatag count for a category
    if (this.keywords && this.keywords.length) {
      return getCategoryCountFromList(this.keywords, category);
    }
    return getCategoryCount(this.tagStatsBySource, category, this.activeCurateTagSource);
  }

  _renderFilterMenu() {
    const available = this._getAvailableFilterTypes();
    if (!available.length) return html``;

    return html`
      <div class="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[200px]">
        ${available.map(filterType => html`
          <div
            class="px-4 py-2.5 cursor-pointer border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors"
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
      case 'list':
        return this._renderListSelector();
      case 'filename':
        return this._renderFilenameSelector();
      default:
        return html``;
    }
  }

  _renderKeywordSelector() {
    const categories = this._getKeywordsByCategory();
    const untaggedCount = this.imageStats?.untagged_positive_count || 0;
    const keywordFilter = this._getKeywordFilter();
    const keywordState = this._normalizeKeywordFilter(keywordFilter);
    const selectedCount = Object.values(keywordState.keywordsByCategory || {}).reduce((total, set) => total + set.size, 0);
    const selectedLabel = keywordState.untagged
      ? 'Untagged'
      : (selectedCount ? `${selectedCount} selected` : 'None selected');
    const keywordOperator = keywordState.operator || 'OR';
    const query = (this.keywordSearchQuery || '').trim().toLowerCase();
    const showUntagged = untaggedCount > 0 && (!query || 'untagged'.includes(query));
    const filteredCategories = query
      ? categories
        .map(([category, keywords]) => {
          const categoryMatch = category.toLowerCase().includes(query);
          const filteredKeywords = categoryMatch
            ? keywords
            : (keywords || []).filter((kw) => kw.keyword?.toLowerCase().includes(query));
          return [category, filteredKeywords];
        })
        .filter(([, keywords]) => keywords && keywords.length)
      : categories;

    return html`
      <div class="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[520px] max-w-[640px] max-h-[400px] overflow-y-auto">
        <div class="sticky top-0 bg-white border-b border-gray-100 px-4 py-2 text-xs">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <span class="font-semibold text-gray-700">Keywords</span>
              ${this.keywordMultiSelect && !keywordState.untagged && selectedCount > 0 ? html`
                <div class="inline-flex items-center gap-1">
                  <button
                    class=${`px-2 py-0.5 border rounded-full text-[10px] ${keywordOperator === 'OR' ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-600 border-gray-300'}`}
                    @click=${(e) => { e.stopPropagation(); if (keywordOperator !== 'OR') this._toggleKeywordOperator(); }}
                  >
                    Any
                  </button>
                  <button
                    class=${`px-2 py-0.5 border rounded-full text-[10px] ${keywordOperator === 'AND' ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-600 border-gray-300'}`}
                    @click=${(e) => { e.stopPropagation(); if (keywordOperator !== 'AND') this._toggleKeywordOperator(); }}
                  >
                    All
                  </button>
                </div>
              ` : html``}
            </div>
            <div class="flex items-center gap-2">
              <span class="text-gray-500">${selectedLabel}</span>
              ${keywordFilter ? html`
                <button
                  class="px-2 py-1 border rounded-full text-gray-600 hover:bg-gray-50"
                  @click=${(e) => { e.stopPropagation(); this._removeKeywordFilter(); }}
                >
                  Clear
                </button>
              ` : html``}
              <button
                class="px-2 py-1 border rounded-full text-gray-600 hover:bg-gray-50"
                @click=${(e) => { e.stopPropagation(); this.valueSelectorOpen = null; }}
              >
                Done
              </button>
            </div>
          </div>
          <div class="mt-2">
            <input
              type="text"
              class="w-full px-3 py-2 border rounded-lg text-sm"
              placeholder="Search keywords..."
              .value=${this.keywordSearchQuery}
              @input=${(e) => {
                e.stopPropagation();
                this.keywordSearchQuery = e.target.value;
              }}
            >
          </div>
        </div>
        ${showUntagged ? html`
          <div
            class=${`px-4 py-2 cursor-pointer border-b border-gray-50 last:border-b-0 transition-colors ${keywordState.untagged ? 'bg-blue-50' : 'hover:bg-gray-100'}`}
            @click=${() => this._handleKeywordSelect('Untagged', '__untagged__')}
          >
            <span class="inline-flex items-center gap-2">
              <span class=${`inline-flex h-4 w-4 items-center justify-center rounded border text-xs ${keywordState.untagged ? 'border-blue-500 bg-blue-500 text-white' : 'border-gray-300 text-gray-300'}`}>
                ${keywordState.untagged ? '✓' : ''}
              </span>
              <strong>Untagged</strong> (${untaggedCount})
            </span>
          </div>
        ` : ''}
        ${filteredCategories.map(([category, keywords]) => html`
          <div class="px-4 py-2 font-semibold text-gray-600 bg-gray-50 text-xs uppercase tracking-wide flex items-center justify-between">
            <span>${category}</span>
          </div>
          ${keywords.map(kw => html`
            <div
              class=${`px-4 py-2 cursor-pointer border-b border-gray-50 last:border-b-0 transition-colors ${keywordState.keywordsByCategory?.[category]?.has?.(kw.keyword) ? 'bg-blue-50' : 'hover:bg-gray-100'}`}
              @click=${() => this._handleKeywordSelect(category, kw.keyword)}
            >
              <span class="inline-flex items-center gap-2">
                <span class=${`inline-flex h-4 w-4 items-center justify-center rounded border text-xs ${keywordState.keywordsByCategory?.[category]?.has?.(kw.keyword) ? 'border-blue-500 bg-blue-500 text-white' : 'border-gray-300 text-gray-300'}`}>
                  ${keywordState.keywordsByCategory?.[category]?.has?.(kw.keyword) ? '✓' : ''}
                </span>
                <span>${kw.keyword}</span>
                <span class="text-gray-500 text-sm">(${kw.count || 0})</span>
              </span>
            </div>
          `)}
        `)}
        ${query && !filteredCategories.length && !showUntagged ? html`
          <div class="px-4 py-3 text-sm text-gray-500">No keywords found.</div>
        ` : ''}
      </div>
    `;
  }

  _renderRatingSelector() {
    return html`
      <div class="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[300px] max-w-[400px] max-h-[400px] overflow-y-auto">
        <div class="p-4">
          <div class="text-sm font-semibold text-gray-700 mb-3">Rating</div>
          <div class="flex flex-nowrap gap-2">
            <button
              class="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50"
              title="Rating is not set"
              @click=${() => this._handleRatingSelect('unrated')}
            >
              <span class="text-gray-400" aria-hidden="true">☆</span>
              <span class="ml-1">Unrated</span>
            </button>
            ${[0, 1, 2, 3].map(rating => {
              const label = rating === 0
                ? html`<span class="text-gray-600" aria-label="Trash">🗑</span>`
                : `${rating}+`;
              const title = rating === 0 ? 'Rating = 0' : `Rating >= ${rating}`;
              return html`
                <button
                  class="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50"
                  title=${title}
                  @click=${() => this._handleRatingSelect(rating)}
                >
                  ${rating === 0
                    ? html`<span class="ml-0">${label}</span>`
                    : html`<span class="text-yellow-500" aria-hidden="true">★</span><span class="ml-1">${label}</span>`}
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
      <div class="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 w-full max-w-none">
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
              this._requestFolders({ query: e.target.value, limit: 500 });
            }}
          >
          ${this.dropboxFolders && this.dropboxFolders.length > 0 ? html`
            <div class="mt-2 max-h-64 overflow-y-auto border rounded-lg">
              ${this.dropboxFolders.map(folder => html`
                <div
                  class="px-4 py-2 cursor-pointer border-b border-gray-50 last:border-b-0 hover:bg-gray-100 transition-colors"
                  @click=${() => this._handleFolderSelect(folder)}
                >
                  ${folder}
                </div>
              `)}
            </div>
          ` : html`
            <div class="mt-2 text-xs text-gray-500 p-2">
              ${this.searchDropboxQuery.trim() ? 'No folders found. Type to search...' : 'Loading folders…'}
            </div>
          `}
        </div>
      </div>
    `;
  }

  _requestFolders({ query, limit } = {}) {
    this.dispatchEvent(new CustomEvent('folder-search', {
      detail: { query, limit },
      bubbles: true,
      composed: true,
    }));
  }

  _renderListSelector() {
    const lists = Array.isArray(this.lists) ? [...this.lists] : [];
    lists.sort((a, b) => (a?.title || '').localeCompare(b?.title || ''));
    return html`
      <div class="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[360px] max-w-[520px] max-h-[400px] overflow-hidden">
        <div class="p-4">
          <div class="text-sm font-semibold text-gray-700 mb-3">List</div>
          <div class="inline-flex items-center gap-2 mb-3">
            <button
              class=${`px-3 py-1.5 text-xs rounded-full border ${this.listFilterMode !== 'exclude' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300'}`}
              @click=${() => this._handleListModeChange('include')}
              type="button"
            >
              In list
            </button>
            <button
              class=${`px-3 py-1.5 text-xs rounded-full border ${this.listFilterMode === 'exclude' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300'}`}
              @click=${() => this._handleListModeChange('exclude')}
              type="button"
            >
              Not in list
            </button>
          </div>
          ${lists.length ? html`
            <div class="max-h-64 overflow-y-auto border rounded-lg">
              ${lists.map((list) => html`
                <div
                  class="px-4 py-2 cursor-pointer border-b border-gray-50 last:border-b-0 hover:bg-gray-100 transition-colors flex items-center justify-between gap-2"
                  @click=${() => this._handleListSelect(list)}
                >
                  <span>${list.title || `List ${list.id}`}</span>
                  ${Number.isFinite(list.item_count) ? html`
                    <span class="text-xs text-gray-500">${list.item_count}</span>
                  ` : ''}
                </div>
              `)}
            </div>
          ` : html`
            <div class="text-xs text-gray-500 mb-2">No lists available.</div>
            <button
              class="px-3 py-1.5 text-xs border rounded-full text-gray-700 hover:bg-gray-50"
              @click=${this._requestLists}
              type="button"
            >
              Refresh lists
            </button>
          `}
        </div>
      </div>
    `;
  }

  _renderFilenameSelector() {
    return html`
      <div class="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 w-full max-w-none">
        <div class="p-4">
          <div class="text-sm font-semibold text-gray-700 mb-2">Filename</div>
          <input
            type="text"
            class="w-full px-3 py-2 border rounded-lg text-sm"
            placeholder="Type part of a filename..."
            .value=${this.filenameFilterQuery || ''}
            @input=${(e) => this._handleFilenameInput(e.target.value)}
            @keydown=${(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                this._applyFilenameFilter();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.valueSelectorOpen = null;
              }
            }}
          >
          <div class="mt-3 flex items-center justify-between gap-2">
            <div class="text-xs text-gray-500">
              Case-insensitive partial match.
            </div>
            <div class="flex items-center gap-2">
              <button
                class="px-3 py-1.5 border rounded-lg text-xs text-gray-700 hover:bg-gray-50"
                @click=${() => this._clearFilenameFilter()}
                type="button"
              >
                Clear
              </button>
              <button
                class="px-3 py-1.5 rounded-lg text-xs bg-gray-900 text-white hover:bg-gray-800"
                @click=${() => this._applyFilenameFilter()}
                type="button"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _requestLists() {
    this.dispatchEvent(new CustomEvent('lists-requested', {
      bubbles: true,
      composed: true,
    }));
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
    const sortControls = typeof this.renderSortControls === 'function'
      ? this.renderSortControls()
      : (this.renderSortControls || html``);
    const hasSortControls = !!this.renderSortControls;

    return html`
      <div class="bg-white rounded-lg shadow p-4">
        <!-- FILTERS Section -->
        <div class="mb-4">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-semibold text-gray-700">Filters:</span>
            <!-- Add filter button (kept first for layout stability) -->
            <div class="relative flex-none">
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
            </div>
            <!-- Active filter chips -->
            ${this.activeFilters.map((filter, index) => {
              if (filter.type === 'keyword') {
                const keywordState = this._normalizeKeywordFilter(filter);
                const totalKeywords = Object.values(keywordState.keywordsByCategory || {}).reduce((total, set) => total + set.size, 0);
                const keywordOperator = keywordState.operator || 'OR';
                return html`
                  <div class="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-full text-sm cursor-pointer hover:bg-blue-100 flex-wrap"
                       @click=${() => this._handleEditFilter(filter.type, index)}>
                    <span class="font-medium text-blue-900">${filter.displayLabel}:</span>
                    ${!keywordState.untagged && totalKeywords > 1 ? html`
                      <button
                        class="px-2 py-0.5 border border-blue-200 rounded-full text-[10px] text-blue-700 hover:bg-blue-100"
                        @click=${(e) => { e.stopPropagation(); this._toggleKeywordOperator(); }}
                        title="Toggle match mode"
                      >
                        ${keywordOperator === 'AND' ? 'All' : 'Any'}
                      </button>
                    ` : html``}
                    ${keywordState.untagged ? html`
                      <span class="text-blue-700">Untagged</span>
                    ` : html`
                      <span class="inline-flex flex-wrap items-center gap-2 text-blue-700">
                        ${Object.entries(keywordState.keywordsByCategory || {}).map(([category, keywords]) => {
                          return html`
                            <span class="inline-flex items-center gap-2">
                              <span class="text-blue-900 font-medium">${category}</span>
                              <span class="inline-flex flex-wrap items-center gap-1">
                                ${Array.from(keywords).map((keyword) => html`
                                  <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-white/70 border border-blue-200 rounded-full text-xs">
                                    ${keyword}
                                    <button
                                      class="text-blue-600 hover:text-blue-800"
                                      @click=${(e) => { e.stopPropagation(); this._handleKeywordRemove(category, keyword); }}
                                      aria-label="Remove keyword"
                                    >
                                      ×
                                    </button>
                                  </span>
                                `)}
                              </span>
                            </span>
                          `;
                        })}
                      </span>
                    `}
                    <button
                      @click=${(e) => { e.stopPropagation(); this._removeFilter(index); }}
                      class="ml-1 text-blue-600 hover:text-blue-800"
                      aria-label="Remove filter"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                      </svg>
                    </button>
                  </div>
                `;
              }

              return html`
                <div class="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-full text-sm cursor-pointer hover:bg-blue-100"
                     @click=${() => this._handleEditFilter(filter.type, index)}>
                  <span class="font-medium text-blue-900">${filter.displayLabel}:</span>
                  <span class="text-blue-700">${filter.displayValue}</span>
                  <button
                    @click=${(e) => { e.stopPropagation(); this._removeFilter(index); }}
                    class="ml-1 text-blue-600 hover:text-blue-800"
                    aria-label="Remove filter"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                  </button>
                </div>
              `;
            })}
            ${this.renderFiltersActions ? html`
              <div class="ml-auto flex items-center">
                ${this.renderFiltersActions()}
              </div>
            ` : ''}
          </div>
          <div class="relative w-full">
            ${this.filterMenuOpen ? this._renderFilterMenu() : ''}
            ${this._renderValueSelector()}
          </div>
        </div>

        <!-- SORT & DISPLAY Section -->
        ${hasSortControls ? html`
          <div class="border-t pt-4">
            <div class="flex flex-wrap items-center gap-4">
              ${sortControls}
            </div>
          </div>
        ` : html``}
      </div>
    `;
  }
}

customElements.define('filter-chips', FilterChips);
