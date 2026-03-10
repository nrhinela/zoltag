import { LitElement, html } from 'lit';
import { tailwind } from '../../tailwind-lit.js';
import { getKeywordsByCategory, getCategoryCount, getKeywordsByCategoryFromList, getCategoryCountFromList } from '../keyword-utils.js';

const SOURCE_PROVIDER_OPTIONS = [
  { value: 'dropbox', label: 'Dropbox' },
  { value: 'gdrive', label: 'Google Drive' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'managed', label: 'Managed Uploads' },
];

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
    hideFiltersSection: { type: Boolean },
    lists: { type: Array },
    listFilterMode: { type: String },
    keywordMultiSelect: { type: Boolean },
    keywordSearchQuery: { type: String },
    filenameFilterQuery: { type: String },
    textSearchFilterQuery: { type: String },
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
    this.hideFiltersSection = false;
    this.lists = [];
    this.listFilterMode = 'include';
    this.keywordMultiSelect = true;
    this.keywordSearchQuery = '';
    this.filenameFilterQuery = '';
    this.textSearchFilterQuery = '';
  }

  _getKeywordFilter() {
    return (this.activeFilters || []).find((filter) => filter.type === 'keyword') || null;
  }

  _normalizeKeywordFilter(filter) {
    const keywordsByCategory = {};
    let operator = 'OR';

    if (!filter) {
      return { keywordsByCategory, operator };
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

    return { keywordsByCategory, operator };
  }

  _buildKeywordFilterPayload({ keywordsByCategory, operator }) {
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
      displayLabel: 'Tags',
      displayValue: Object.keys(normalizedKeywords).length ? 'Multiple' : '',
    };
  }

  _getTagCoverageFilter() {
    return (this.activeFilters || []).find((filter) => filter.type === 'tag_coverage') || null;
  }

  _normalizeTagCoverageFilter(filter) {
    if (!filter) return { categories: [], includeUntagged: false, operator: 'AND' };
    const rawValues = Array.isArray(filter.noPermatagCategories)
      ? filter.noPermatagCategories
      : (Array.isArray(filter.categories)
        ? filter.categories
        : (filter.category ? [filter.category] : []));
    const categories = Array.from(
      new Set(
        rawValues
          .map((value) => String(value || '').trim())
          .filter(Boolean)
      )
    );
    const includeUntagged = Boolean(
      filter.includeUntagged
      || filter.noPermatagUntagged
      || filter.untagged
      || filter.value === '__untagged__'
      || filter.permatagPositiveMissing
    );
    const rawOperator = String(filter.operator || filter.noPermatagOperator || 'AND').trim().toUpperCase();
    const operator = rawOperator === 'OR' ? 'OR' : 'AND';
    return { categories, includeUntagged, operator };
  }

  _buildTagCoverageDisplayValue({ categories, includeUntagged }) {
    const labels = [];
    if (includeUntagged) labels.push('Untagged');
    labels.push(...categories.map((category) => `No ${category} tags`));
    if (!labels.length) return '';
    return labels.length <= 2 ? labels.join(', ') : `${labels.length} rules`;
  }

  _buildTagCoverageFilterPayload({ categories = [], includeUntagged = false, operator = 'AND' } = {}) {
    const normalized = this._normalizeTagCoverageFilter({
      noPermatagCategories: categories,
      includeUntagged,
      operator,
    });
    if (!normalized.categories.length && !normalized.includeUntagged) {
      return null;
    }
    return {
      type: 'tag_coverage',
      noPermatagCategories: normalized.categories,
      includeUntagged: normalized.includeUntagged,
      operator: normalized.operator,
      displayLabel: 'Tag Coverage',
      displayValue: this._buildTagCoverageDisplayValue(normalized),
    };
  }

  _toggleTagCoverageCategory(category) {
    const normalizedCategory = String(category || '').trim();
    if (!normalizedCategory) return;
    const existing = this._normalizeTagCoverageFilter(this._getTagCoverageFilter());
    const next = new Set(existing.categories);
    if (next.has(normalizedCategory)) {
      next.delete(normalizedCategory);
    } else {
      next.add(normalizedCategory);
    }
    const payload = this._buildTagCoverageFilterPayload({
      categories: Array.from(next),
      includeUntagged: existing.includeUntagged,
      operator: existing.operator,
    });
    if (!payload) {
      this._removeFilterByType('tag_coverage');
      return;
    }
    this._addFilter(payload);
  }

  _toggleTagCoverageUntagged() {
    const existing = this._normalizeTagCoverageFilter(this._getTagCoverageFilter());
    const payload = this._buildTagCoverageFilterPayload({
      categories: existing.categories,
      includeUntagged: !existing.includeUntagged,
      operator: existing.operator,
    });
    if (!payload) {
      this._removeFilterByType('tag_coverage');
      return;
    }
    this._addFilter(payload);
  }

  _toggleTagCoverageOperator() {
    const existing = this._normalizeTagCoverageFilter(this._getTagCoverageFilter());
    const selectionCount = existing.categories.length + (existing.includeUntagged ? 1 : 0);
    if (selectionCount <= 1) return;
    const nextOperator = existing.operator === 'OR' ? 'AND' : 'OR';
    const payload = this._buildTagCoverageFilterPayload({
      categories: existing.categories,
      includeUntagged: existing.includeUntagged,
      operator: nextOperator,
    });
    if (payload) {
      this._addFilter(payload);
    }
  }

  _handleTagCoverageRemove(value) {
    const existing = this._normalizeTagCoverageFilter(this._getTagCoverageFilter());
    const nextCategories = new Set(existing.categories);
    let includeUntagged = existing.includeUntagged;
    if (value === '__untagged__') {
      includeUntagged = false;
    } else {
      nextCategories.delete(String(value || '').trim());
    }
    const payload = this._buildTagCoverageFilterPayload({
      categories: Array.from(nextCategories),
      includeUntagged,
      operator: existing.operator,
    });
    if (!payload) {
      this._removeFilterByType('tag_coverage');
      return;
    }
    this._addFilter(payload);
  }

  _getAvailableFilterTypes() {
    const active = new Set(this.activeFilters.map(f => f.type));
    const all = [
      { type: 'keyword', label: 'Tags', icon: '🏷️' },
      { type: 'rating', label: 'Rating', icon: '⭐' },
      { type: 'source', label: 'Source', icon: '🔌' },
      { type: 'media', label: 'Media Type', icon: '🎬' },
      { type: 'folder', label: 'Folder', icon: '📂' },
      { type: 'list', label: 'List', icon: '🧾' },
      { type: 'filename', label: 'Filename', icon: '📝' },
      { type: 'text_search', label: 'Text search', icon: '🔎' },
      { type: 'tag_coverage', label: 'Tag Coverage', icon: '🛡️' },
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
    if (type === 'text_search') {
      const existing = (this.activeFilters || []).find((filter) => filter.type === 'text_search');
      this.textSearchFilterQuery = existing?.value || '';
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
    if (type === 'text_search') {
      const existing = this.activeFilters[index];
      this.textSearchFilterQuery = existing?.value || '';
    }
  }

  _handleKeywordSelect(category, keyword) {
    const keywordFilter = this._getKeywordFilter();
    const state = this._normalizeKeywordFilter(keywordFilter);

    if (!this.keywordMultiSelect) {
      this.valueSelectorOpen = null;
      const keywordsByCategory = { [category]: new Set([keyword]) };
      this._addFilter(this._buildKeywordFilterPayload({ keywordsByCategory, operator: state.operator }));
      return;
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

    this._addFilter(this._buildKeywordFilterPayload({ keywordsByCategory, operator: state.operator }));
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

    this._addFilter(this._buildKeywordFilterPayload({ keywordsByCategory, operator: state.operator }));
  }

  _toggleKeywordOperator() {
    const keywordFilter = this._getKeywordFilter();
    const state = this._normalizeKeywordFilter(keywordFilter);
    const current = state.operator || 'OR';
    const nextOperator = current === 'OR' ? 'AND' : 'OR';
    this._addFilter(this._buildKeywordFilterPayload({
      keywordsByCategory: state.keywordsByCategory,
      operator: nextOperator,
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

  _handleMediaSelect(mediaType) {
    const normalized = String(mediaType || '').trim().toLowerCase();
    if (normalized !== 'image' && normalized !== 'video') {
      this._removeFilterByType('media');
      this.valueSelectorOpen = null;
      this.filterMenuOpen = false;
      return;
    }
    this._addFilter({
      type: 'media',
      value: normalized,
      displayLabel: 'Media',
      displayValue: normalized === 'video' ? 'Videos' : 'Photos',
    });
    this.valueSelectorOpen = null;
    this.filterMenuOpen = false;
  }

  _normalizeSourceProviderValue(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized || normalized === 'all') return '';
    if (normalized === 'google') return 'gdrive';
    if (normalized === 'google-drive' || normalized === 'google_drive' || normalized === 'drive') return 'gdrive';
    if (normalized === 'yt') return 'youtube';
    if (normalized === 'managed_uploads' || normalized === 'managed-uploads' || normalized === 'uploads' || normalized === 'upload') return 'managed';
    return normalized;
  }

  _getSourceProviderLabel(value) {
    const normalized = this._normalizeSourceProviderValue(value);
    if (!normalized) return 'All sources';
    const known = SOURCE_PROVIDER_OPTIONS.find((option) => option.value === normalized);
    if (known) return known.label;
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  _handleSourceSelect(sourceProvider) {
    const normalized = this._normalizeSourceProviderValue(sourceProvider);
    if (!normalized) {
      this._removeFilterByType('source');
      this.valueSelectorOpen = null;
      this.filterMenuOpen = false;
      return;
    }
    this._addFilter({
      type: 'source',
      value: normalized,
      displayLabel: 'Source',
      displayValue: this._getSourceProviderLabel(normalized),
    });
    this.valueSelectorOpen = null;
    this.filterMenuOpen = false;
  }

  _getSourceProviderCounts() {
    const raw = this.imageStats?.source_provider_counts;
    if (!raw || typeof raw !== 'object') return {};
    const counts = {};
    Object.entries(raw).forEach(([provider, count]) => {
      const normalized = this._normalizeSourceProviderValue(provider);
      if (!normalized) return;
      const parsed = Number(count);
      counts[normalized] = (counts[normalized] || 0) + (Number.isFinite(parsed) ? parsed : 0);
    });
    return counts;
  }

  _getSourceOptionsWithCounts() {
    const counts = this._getSourceProviderCounts();
    const knownValues = new Set(SOURCE_PROVIDER_OPTIONS.map((option) => option.value));
    const dynamicOptions = Object.entries(counts)
      .filter(([provider]) => provider && !knownValues.has(provider))
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
      .map(([provider]) => ({
        value: provider,
        label: this._getSourceProviderLabel(provider),
      }));
    return [
      { value: 'all', label: 'All sources' },
      ...SOURCE_PROVIDER_OPTIONS,
      ...dynamicOptions,
    ];
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

  _handleTextSearchInput(value) {
    this.textSearchFilterQuery = String(value || '');
  }

  _clearTextSearchFilter() {
    this.textSearchFilterQuery = '';
    this._removeFilterByType('text_search');
    this.valueSelectorOpen = null;
    this.filterMenuOpen = false;
  }

  _applyTextSearchFilter() {
    const trimmed = (this.textSearchFilterQuery || '').trim();
    if (!trimmed) {
      this._removeFilterByType('text_search');
    } else {
      this._addFilter({
        type: 'text_search',
        value: trimmed,
        displayLabel: 'Text search',
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
    } else if (removed?.type === 'text_search') {
      this.textSearchFilterQuery = '';
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

  _getTagCoverageMissingCount(category) {
    const normalizedCategory = String(category || '').trim();
    if (!normalizedCategory) return 0;

    if (this.keywords && this.keywords.length) {
      const categoryMatches = this.keywords.filter((kw) => (
        String(kw?.category || '').trim().toLowerCase() === normalizedCategory.toLowerCase()
      ));
      const withMissingCount = categoryMatches.find((kw) => Number.isFinite(Number(kw?.category_missing_count)));
      if (withMissingCount) {
        return Number(withMissingCount.category_missing_count);
      }

      const withTaggedCount = categoryMatches.find((kw) => Number.isFinite(Number(kw?.category_tagged_count)));
      const totalImages = Number(this.imageStats?.image_count || 0);
      if (withTaggedCount && totalImages > 0) {
        return Math.max(totalImages - Number(withTaggedCount.category_tagged_count || 0), 0);
      }
    }

    return 0;
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
      case 'media':
        return this._renderMediaSelector();
      case 'source':
        return this._renderSourceSelector();
      case 'folder':
        return this._renderFolderSelector();
      case 'list':
        return this._renderListSelector();
      case 'tag_coverage':
        return this._renderTagCoverageSelector();
      case 'filename':
        return this._renderFilenameSelector();
      case 'text_search':
        return this._renderTextSearchSelector();
      default:
        return html``;
    }
  }

  _renderKeywordSelector() {
    const categories = this._getKeywordsByCategory();
    const hasTagDefinitions = Array.isArray(categories) && categories.length > 0;
    const keywordFilter = this._getKeywordFilter();
    const keywordState = this._normalizeKeywordFilter(keywordFilter);
    const selectedCount = Object.values(keywordState.keywordsByCategory || {}).reduce((total, set) => total + set.size, 0);
    const selectedLabel = selectedCount ? `${selectedCount} selected` : 'None selected';
    const keywordOperator = keywordState.operator || 'OR';
    const query = (this.keywordSearchQuery || '').trim().toLowerCase();
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
              <span class="font-semibold text-gray-700">Tags</span>
              ${this.keywordMultiSelect && selectedCount > 0 ? html`
                <div class="inline-flex items-center gap-1">
                  <button
                    class=${`px-2 py-0.5 border rounded-full text-[10px] ${keywordOperator === 'OR' ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-600 border-gray-300'}`}
                    @click=${(e) => { e.stopPropagation(); if (keywordOperator !== 'OR') this._toggleKeywordOperator(); }}
                  >
                    OR
                  </button>
                  <button
                    class=${`px-2 py-0.5 border rounded-full text-[10px] ${keywordOperator === 'AND' ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-600 border-gray-300'}`}
                    @click=${(e) => { e.stopPropagation(); if (keywordOperator !== 'AND') this._toggleKeywordOperator(); }}
                  >
                    AND
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
          ${hasTagDefinitions ? html`
            <div class="mt-2">
              <input
                type="text"
                class="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="Search tags..."
                .value=${this.keywordSearchQuery}
                @input=${(e) => {
                  e.stopPropagation();
                  this.keywordSearchQuery = e.target.value;
                }}
              >
            </div>
          ` : ''}
        </div>
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
        ${!hasTagDefinitions ? html`
          <div class="px-4 py-4">
            <div class="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
              <div class="text-sm font-semibold text-blue-900">No tags defined.</div>
              <div class="mt-1 text-sm text-blue-800">
                Set up tags to start filtering by tag categories and values.
              </div>
              <a
                class="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:text-blue-800 underline underline-offset-2"
                href="?tab=admin&subTab=keywords&adminSubTab=tagging"
              >
                Click here for tag setup
              </a>
            </div>
          </div>
        ` : ''}
        ${query && hasTagDefinitions && !filteredCategories.length ? html`
          <div class="px-4 py-3 text-sm text-gray-500">No tags found.</div>
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

  _renderTagCoverageSelector() {
    const selectedState = this._normalizeTagCoverageFilter(this._getTagCoverageFilter());
    const selected = new Set(selectedState.categories);
    const categories = Array.from(new Set(this._getKeywordsByCategory().map(([category]) => String(category || '').trim()).filter(Boolean)));
    const untaggedCount = Number(this.imageStats?.untagged_positive_count || 0);
    const selectedCount = selectedState.categories.length + (selectedState.includeUntagged ? 1 : 0);
    const selectedLabel = selectedCount ? `${selectedCount} selected` : 'None selected';
    const operator = selectedState.operator || 'AND';

    return html`
      <div class="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[420px] max-w-[560px] max-h-[400px] overflow-y-auto">
        <div class="sticky top-0 bg-white border-b border-gray-100 px-4 py-2 text-xs">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-3">
              <span class="font-semibold text-gray-700">Tag Coverage</span>
              ${selectedCount > 1 ? html`
                <div class="inline-flex items-center gap-1">
                  <button
                    class=${`px-2 py-0.5 border rounded-full text-[10px] ${operator === 'OR' ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-600 border-gray-300'}`}
                    @click=${(e) => { e.stopPropagation(); if (operator !== 'OR') this._toggleTagCoverageOperator(); }}
                  >
                    OR
                  </button>
                  <button
                    class=${`px-2 py-0.5 border rounded-full text-[10px] ${operator === 'AND' ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-600 border-gray-300'}`}
                    @click=${(e) => { e.stopPropagation(); if (operator !== 'AND') this._toggleTagCoverageOperator(); }}
                  >
                    AND
                  </button>
                </div>
              ` : html``}
            </div>
            <div class="flex items-center gap-2">
              <span class="text-gray-500">${selectedLabel}</span>
              ${selectedCount ? html`
                <button
                  class="px-2 py-1 border rounded-full text-gray-600 hover:bg-gray-50"
                  @click=${(e) => {
                    e.stopPropagation();
                    this._removeFilterByType('tag_coverage');
                  }}
                >
                  Clear
                </button>
              ` : html``}
              <button
                class="px-2 py-1 border rounded-full text-gray-600 hover:bg-gray-50"
                @click=${(e) => {
                  e.stopPropagation();
                  this.valueSelectorOpen = null;
                }}
              >
                Done
              </button>
            </div>
          </div>
          <div class="mt-1 text-[11px] text-gray-500">
            Show items missing positive permatags in selected coverage rules. Show items that have no tags at all for each category.
          </div>
        </div>
        <div
          class=${`px-4 py-2 cursor-pointer border-b border-gray-50 transition-colors ${selectedState.includeUntagged ? 'bg-blue-50' : 'hover:bg-gray-100'}`}
          @click=${() => this._toggleTagCoverageUntagged()}
        >
          <span class="inline-flex items-center gap-2">
            <span class=${`inline-flex h-4 w-4 items-center justify-center rounded border text-xs ${selectedState.includeUntagged ? 'border-blue-500 bg-blue-500 text-white' : 'border-gray-300 text-gray-300'}`}>
              ${selectedState.includeUntagged ? '✓' : ''}
            </span>
            <span>Untagged</span>
            <span class="text-gray-500 text-sm">(${untaggedCount})</span>
          </span>
        </div>
        ${categories.length ? categories.map((category) => {
          const isSelected = selected.has(category);
          const missingCount = this._getTagCoverageMissingCount(category);
          return html`
            <div
              class=${`px-4 py-2 cursor-pointer border-b border-gray-50 last:border-b-0 transition-colors ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-100'}`}
              @click=${() => this._toggleTagCoverageCategory(category)}
            >
              <span class="inline-flex items-center gap-2">
                <span class=${`inline-flex h-4 w-4 items-center justify-center rounded border text-xs ${isSelected ? 'border-blue-500 bg-blue-500 text-white' : 'border-gray-300 text-gray-300'}`}>
                  ${isSelected ? '✓' : ''}
                </span>
                <span>No ${category} tags</span>
                <span class="text-gray-500 text-sm">(${missingCount})</span>
              </span>
            </div>
          `;
        }) : html`
          <div class="px-4 py-3 text-sm text-gray-500">No categories available.</div>
        `}
      </div>
    `;
  }

  _renderMediaSelector() {
    const currentValue = ((this.activeFilters || []).find((filter) => filter.type === 'media')?.value || '').toLowerCase();
    const options = [
      { value: 'all', label: 'All media' },
      { value: 'image', label: 'Photos only' },
      { value: 'video', label: 'Videos only' },
    ];
    return html`
      <div class="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[260px] max-w-[340px]">
        <div class="p-4">
          <div class="text-sm font-semibold text-gray-700 mb-3">Media Type</div>
          <div class="space-y-2">
            ${options.map((option) => {
              const isActive = option.value === 'all'
                ? !currentValue
                : currentValue === option.value;
              return html`
                <button
                  class=${`w-full text-left px-3 py-2 border rounded-lg text-sm transition-colors ${isActive ? 'bg-blue-50 border-blue-300 text-blue-800' : 'hover:bg-gray-50 border-gray-200 text-gray-700'}`}
                  @click=${() => this._handleMediaSelect(option.value)}
                  type="button"
                >
                  ${option.label}
                </button>
              `;
            })}
          </div>
        </div>
      </div>
    `;
  }

  _renderSourceSelector() {
    const currentValue = this._normalizeSourceProviderValue(
      (this.activeFilters || []).find((filter) => filter.type === 'source')?.value
    );
    const counts = this._getSourceProviderCounts();
    const totalCount = Number(this.imageStats?.image_count || 0);
    const options = this._getSourceOptionsWithCounts();
    return html`
      <div class="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[260px] max-w-[360px]">
        <div class="p-4">
          <div class="text-sm font-semibold text-gray-700 mb-3">Source</div>
          <div class="space-y-2">
            ${options.map((option) => {
              const normalizedOption = this._normalizeSourceProviderValue(option.value);
              const isActive = option.value === 'all'
                ? !currentValue
                : normalizedOption === currentValue;
              const optionCount = option.value === 'all'
                ? totalCount
                : Number(counts[normalizedOption] || 0);
              return html`
                <button
                  class=${`w-full flex items-center justify-between gap-3 text-left px-3 py-2 border rounded-lg text-sm transition-colors ${isActive ? 'bg-blue-50 border-blue-300 text-blue-800' : 'hover:bg-gray-50 border-gray-200 text-gray-700'}`}
                  @click=${() => this._handleSourceSelect(option.value)}
                  type="button"
                >
                  <span>${option.label}</span>
                  <span class="text-xs opacity-75">${optionCount.toLocaleString('en-US')}</span>
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

  _renderTextSearchSelector() {
    return html`
      <div class="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 w-full max-w-none">
        <div class="p-4">
          <div class="text-sm font-semibold text-gray-700 mb-2">Text search</div>
          <input
            type="text"
            class="w-full px-3 py-2 border rounded-lg text-sm"
            placeholder="Describe what you want to find..."
            .value=${this.textSearchFilterQuery || ''}
            @input=${(e) => this._handleTextSearchInput(e.target.value)}
            @keydown=${(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                this._applyTextSearchFilter();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.valueSelectorOpen = null;
              }
            }}
          >
          <div class="mt-3 flex items-center justify-between gap-2">
            <div class="text-xs text-gray-500">
              Uses vectorstore semantic + lexical search.
            </div>
            <div class="flex items-center gap-2">
              <button
                class="px-3 py-1.5 border rounded-lg text-xs text-gray-700 hover:bg-gray-50"
                @click=${() => this._clearTextSearchFilter()}
                type="button"
              >
                Clear
              </button>
              <button
                class="px-3 py-1.5 rounded-lg text-xs bg-gray-900 text-white hover:bg-gray-800"
                @click=${() => this._applyTextSearchFilter()}
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
    const showFiltersSection = !this.hideFiltersSection;

    return html`
      <div class="bg-white rounded-lg shadow p-4">
        ${showFiltersSection ? html`
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
                      ${totalKeywords > 1 ? html`
                        <button
                          class="px-2 py-0.5 border border-blue-200 rounded-full text-[10px] text-blue-700 hover:bg-blue-100"
                          @click=${(e) => { e.stopPropagation(); this._toggleKeywordOperator(); }}
                          title="Toggle match mode"
                        >
                          ${keywordOperator === 'AND' ? 'AND' : 'OR'}
                        </button>
                      ` : html``}
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
                                      aria-label="Remove tag"
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
                if (filter.type === 'tag_coverage') {
                  const coverageState = this._normalizeTagCoverageFilter(filter);
                  const totalRules = coverageState.categories.length + (coverageState.includeUntagged ? 1 : 0);
                  const coverageOperator = coverageState.operator || 'AND';
                  return html`
                    <div class="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-full text-sm cursor-pointer hover:bg-blue-100 flex-wrap"
                         @click=${() => this._handleEditFilter(filter.type, index)}>
                      <span class="font-medium text-blue-900">${filter.displayLabel}:</span>
                      ${totalRules > 1 ? html`
                        <button
                          class="px-2 py-0.5 border border-blue-200 rounded-full text-[10px] text-blue-700 hover:bg-blue-100"
                          @click=${(e) => { e.stopPropagation(); this._toggleTagCoverageOperator(); }}
                          title="Toggle match mode"
                        >
                          ${coverageOperator}
                        </button>
                      ` : html``}
                      <span class="inline-flex flex-wrap items-center gap-1 text-blue-700">
                        ${coverageState.includeUntagged ? html`
                          <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-white/70 border border-blue-200 rounded-full text-xs">
                            Untagged
                            <button
                              class="text-blue-600 hover:text-blue-800"
                              @click=${(e) => { e.stopPropagation(); this._handleTagCoverageRemove('__untagged__'); }}
                              aria-label="Remove untagged"
                            >
                              ×
                            </button>
                          </span>
                        ` : html``}
                        ${coverageState.categories.map((category) => html`
                          <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-white/70 border border-blue-200 rounded-full text-xs">
                            No ${category} tags
                            <button
                              class="text-blue-600 hover:text-blue-800"
                              @click=${(e) => { e.stopPropagation(); this._handleTagCoverageRemove(category); }}
                              aria-label="Remove category"
                            >
                              ×
                            </button>
                          </span>
                        `)}
                      </span>
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
                if (filter.type === 'similarity') {
                  return html`
                    <div class="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-full text-sm">
                      <span class="font-medium text-blue-900">Similarity:<span class="text-blue-700">${filter.displayValue}</span></span>
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
        ` : html``}

        <!-- SORT & DISPLAY Section -->
        ${hasSortControls ? html`
          <div class=${showFiltersSection ? 'border-t pt-4' : ''}>
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
