import { LitElement, html } from 'lit';
import ImageFilterPanel from './shared/state/image-filter-panel.js';
import { getKeywordsByCategoryFromList } from './shared/keyword-utils.js';
import { formatDropboxTag, formatDropboxRatingTag } from './shared/formatting.js';
import './search-tab.js';

/**
 * Home Chips Subtab
 *
 * Shows all tags as chips grouped by category. Selecting a chip
 * loads the standard search results view.
 */
export class HomeChipsTab extends LitElement {
  createRenderRoot() {
    return this;
  }

  static properties = {
    tenant: { type: String },
    canCurate: { type: Boolean },
    selectedTag: { type: Object },
    searchFilterPanel: { type: Object },
    searchImages: { type: Array },
    searchTotal: { type: Number },
    searchChipFilters: { type: Array },
    curateThumbSize: { type: Number },
    tagStatsBySource: { type: Object },
    activeCurateTagSource: { type: String },
    keywords: { type: Array },
    imageStats: { type: Object },
    curateOrderBy: { type: String },
    curateDateOrder: { type: String },
    initialSelection: { type: Object },
    renderCurateRatingWidget: { type: Object },
    renderCurateRatingStatic: { type: Object },
    formatCurateDate: { type: Object },
    chipMode: { type: String },
    chipRatingFilter: { type: String },
    ratingOnlyActive: { type: Boolean },
  };

  constructor() {
    super();
    this.tenant = '';
    this.canCurate = true;
    this.tagStatsBySource = {};
    this.selectedTag = null;
    this.searchFilterPanel = new ImageFilterPanel('home-chips');
    this.searchImages = [];
    this.searchTotal = 0;
    this.searchChipFilters = [];
    this.curateThumbSize = 190;
    this.activeCurateTagSource = 'permatags';
    this.keywords = [];
    this.imageStats = null;
    this.curateOrderBy = 'photo_creation';
    this.curateDateOrder = 'desc';
    this.initialSelection = null;
    this.renderCurateRatingWidget = null;
    this.renderCurateRatingStatic = null;
    this.formatCurateDate = null;
    this.chipMode = 'search';
    this.chipRatingFilter = 'hide-deleted';
    this.ratingOnlyActive = false;
    this._appliedInitialSelectionKey = '';

    this._panelHandlers = null;
    this._setupFilterPanelHandlers();
  }

  updated(changedProps) {
    if (changedProps.has('tenant') && this.searchFilterPanel) {
      this.searchFilterPanel.setTenant(this.tenant);
    }
    if (changedProps.has('initialSelection') || changedProps.has('tenant')) {
      this._applyInitialSelection();
    }
  }

  disconnectedCallback() {
    this._teardownFilterPanelHandlers();
    super.disconnectedCallback();
  }

  _setupFilterPanelHandlers() {
    if (!this.searchFilterPanel || this._panelHandlers) return;
    const handleLoaded = (detail) => {
      if (detail?.tabId !== 'home-chips') return;
      this.searchImages = [...(detail.images || [])];
      this.searchTotal = detail.total || 0;
    };
    const handleError = () => {};
    this._panelHandlers = { handleLoaded, handleError };
    this.searchFilterPanel.on('images-loaded', handleLoaded);
    this.searchFilterPanel.on('error', handleError);
  }

  _teardownFilterPanelHandlers() {
    if (!this.searchFilterPanel || !this._panelHandlers) return;
    this.searchFilterPanel.off('images-loaded', this._panelHandlers.handleLoaded);
    this.searchFilterPanel.off('error', this._panelHandlers.handleError);
    this._panelHandlers = null;
  }

  _buildChipFilterState(category, keyword) {
    const ratingConfig = this._getRatingFilterConfig();
    const keywords = {};
    const operators = {};
    keywords[category] = new Set([keyword]);
    operators[category] = 'OR';
    return {
      limit: 100,
      offset: 0,
      sortOrder: this.curateDateOrder || 'desc',
      orderBy: this.curateOrderBy || 'photo_creation',
      hideZeroRating: ratingConfig.hideZeroRating,
      keywords,
      operators,
      categoryFilterOperator: 'OR',
      rating: ratingConfig.rating,
      ratingOperator: ratingConfig.ratingOperator,
      reviewed: undefined,
      dropboxPathPrefix: '',
      categoryFilterSource: 'permatags',
      permatagPositiveMissing: false,
      listId: undefined,
      listExcludeId: undefined,
    };
  }

  _handleChipSelect(category, keyword, count) {
    if (!this.searchFilterPanel || !this.tenant) return;
    this.selectedTag = { category, keyword, count };
    this.ratingOnlyActive = false;
    this.searchChipFilters = this._buildSearchChipFilters(category, keyword);
    const filters = this._buildChipFilterState(category, keyword);
    this.searchFilterPanel.setTenant(this.tenant);
    this.searchFilterPanel.updateFilters(filters);
    this.searchFilterPanel.fetchImages();
  }

  _handleBackToSelection() {
    this.selectedTag = null;
    this.ratingOnlyActive = false;
    this.searchImages = [];
    this.searchTotal = 0;
    this.searchChipFilters = [];
    this.searchFilterPanel?.reset();
  }

  _handleRatingFilterChange(value) {
    if (this.chipRatingFilter === value) return;
    this.chipRatingFilter = value;
    if (this.selectedTag && this.chipMode === 'search') {
      const filters = this._buildChipFilterState(this.selectedTag.category, this.selectedTag.keyword);
      this.searchChipFilters = this._buildSearchChipFilters(this.selectedTag.category, this.selectedTag.keyword);
      this.searchFilterPanel.updateFilters(filters);
      this.searchFilterPanel.fetchImages();
      return;
    }
    if (this.ratingOnlyActive && this.chipMode === 'search') {
      this._applyRatingOnlySearch();
    }
  }

  _handleSearchFiltersChanged(event) {
    const filters = event?.detail?.filters;
    if (!Array.isArray(filters)) return;
    this.searchChipFilters = filters;
  }

  _handleSortChanged(event) {
    const orderBy = event.detail?.orderBy;
    const dateOrder = event.detail?.dateOrder;
    if (!orderBy || !dateOrder) return;
    this.curateOrderBy = orderBy;
    this.curateDateOrder = dateOrder;
    if (this.searchFilterPanel) {
      const filters = this.searchFilterPanel.getState();
      this.searchFilterPanel.updateFilters({
        ...filters,
        orderBy,
        sortOrder: dateOrder,
        offset: 0,
      });
      this.searchFilterPanel.fetchImages();
    }
  }

  _handleThumbSizeChanged(event) {
    const size = event.detail?.size;
    if (!size) return;
    this.curateThumbSize = size;
  }

  _handleRatingChipSelect(optionId) {
    this.chipRatingFilter = optionId;
    if (this.chipMode === 'dropbox') return;
    if (this.selectedTag) {
      const filters = this._buildChipFilterState(this.selectedTag.category, this.selectedTag.keyword);
      this.searchChipFilters = this._buildSearchChipFilters(this.selectedTag.category, this.selectedTag.keyword);
      this.searchFilterPanel.updateFilters(filters);
      this.searchFilterPanel.fetchImages();
      return;
    }
    this._applyRatingOnlySearch();
  }

  _applyRatingOnlySearch() {
    if (!this.searchFilterPanel || !this.tenant) return;
    this.ratingOnlyActive = true;
    this.selectedTag = null;
    this.searchChipFilters = this._buildRatingOnlyChipFilters();
    const filters = this._buildRatingOnlyFilterState();
    this.searchFilterPanel.setTenant(this.tenant);
    this.searchFilterPanel.updateFilters(filters);
    this.searchFilterPanel.fetchImages();
  }

  _getRatingFilterConfig() {
    switch (this.chipRatingFilter) {
      case '3plus':
        return { rating: 3, ratingOperator: 'gte', hideZeroRating: true };
      case '2plus':
        return { rating: 2, ratingOperator: 'gte', hideZeroRating: true };
      case '1plus':
        return { rating: 1, ratingOperator: 'gte', hideZeroRating: true };
      case 'unrated':
        return { rating: undefined, ratingOperator: 'is_null', hideZeroRating: false };
      case 'deleted':
        return { rating: 0, ratingOperator: 'eq', hideZeroRating: false };
      case 'all':
        return { rating: undefined, ratingOperator: undefined, hideZeroRating: false };
      case 'hide-deleted':
      default:
        return { rating: undefined, ratingOperator: undefined, hideZeroRating: true };
    }
  }

  _buildRatingOnlyFilterState() {
    const ratingConfig = this._getRatingFilterConfig();
    return {
      limit: 100,
      offset: 0,
      sortOrder: this.curateDateOrder || 'desc',
      orderBy: this.curateOrderBy || 'photo_creation',
      hideZeroRating: ratingConfig.hideZeroRating,
      keywords: {},
      operators: {},
      categoryFilterOperator: undefined,
      rating: ratingConfig.rating,
      ratingOperator: ratingConfig.ratingOperator,
      reviewed: undefined,
      dropboxPathPrefix: '',
      categoryFilterSource: 'permatags',
      permatagPositiveMissing: false,
      listId: undefined,
      listExcludeId: undefined,
    };
  }

  _buildRatingOnlyChipFilters() {
    const ratingFilter = this._getRatingFilterChip();
    return ratingFilter ? [ratingFilter] : [];
  }

  _getRatingFilterChip() {
    switch (this.chipRatingFilter) {
      case '3plus':
        return { type: 'rating', value: 3, displayLabel: 'Rating', displayValue: '3+' };
      case '2plus':
        return { type: 'rating', value: 2, displayLabel: 'Rating', displayValue: '2+' };
      case '1plus':
        return { type: 'rating', value: 1, displayLabel: 'Rating', displayValue: '1+' };
      case 'unrated':
        return { type: 'rating', value: 'unrated', displayLabel: 'Rating', displayValue: 'Unrated' };
      case 'deleted':
        return { type: 'rating', value: 0, displayLabel: 'Rating', displayValue: 'Deleted' };
      case 'all':
      case 'hide-deleted':
      default:
        return null;
    }
  }

  _getRatingFilterLabel() {
    const chip = this._getRatingFilterChip();
    if (!chip) return 'All ratings';
    return chip.displayValue || chip.value;
  }

  _applyInitialSelection() {
    const category = (this.initialSelection?.category || '').trim();
    const keyword = (this.initialSelection?.keyword || '').trim();
    if (!this.tenant || !category || !keyword) {
      return;
    }
    const count = Number(this.initialSelection?.count || 0);
    const selectionKey = `${this.tenant}::${category}::${keyword}::${count}`;
    if (this._appliedInitialSelectionKey === selectionKey) {
      return;
    }
    this._appliedInitialSelectionKey = selectionKey;
    this.chipMode = 'search';
    this._handleChipSelect(category, keyword, count);
    this.dispatchEvent(new CustomEvent('explore-selection-applied', {
      detail: { category, keyword, count },
      bubbles: true,
      composed: true,
    }));
  }

  _getDropboxRatingTag(optionId) {
    switch (optionId) {
      case '3plus':
        return formatDropboxRatingTag(3);
      case '2plus':
        return formatDropboxRatingTag(2);
      case '1plus':
        return formatDropboxRatingTag(1);
      case 'deleted':
        return formatDropboxRatingTag(0);
      default:
        return '';
    }
  }

  _getDropboxRatingHref(optionId) {
    const tag = this._getDropboxRatingTag(optionId);
    if (!tag) return 'https://www.dropbox.com/search/personal';
    return `https://www.dropbox.com/search/personal?query=${encodeURIComponent(`#${tag}`)}`;
  }

  _getDropboxKeywordHref(keyword) {
    const tag = formatDropboxTag(keyword);
    if (!tag) return 'https://www.dropbox.com/search/personal';
    return `https://www.dropbox.com/search/personal?query=${encodeURIComponent(`#${tag}`)}`;
  }

  _openDropboxLink(url) {
    if (!url) return;
    window.open(url, 'dropbox-tags');
  }

  _buildSearchChipFilters(category, keyword) {
    const filters = [{
      type: 'keyword',
      category,
      value: keyword,
      displayLabel: 'Keywords',
      displayValue: keyword,
    }];
    const ratingFilter = this._getRatingFilterChip();
    if (ratingFilter) {
      filters.push(ratingFilter);
    }
    return filters;
  }

  _renderChipList() {
    const categories = getKeywordsByCategoryFromList(this.keywords || []);
    const linkMode = this.chipMode === 'dropbox';
    if (!categories.length) {
      if (this.tenant) {
        return html`<div class="text-sm text-gray-500">Loading tag counts…</div>`;
      }
      return html`<div class="text-sm text-gray-500">No tags available.</div>`;
    }
    return html`
      ${categories.map(([category, keywords]) => html`
        <div class="mb-6">
          <div class="text-xs font-semibold uppercase text-gray-500">${category}</div>
          <div class="flex flex-wrap gap-2 mt-2">
            ${keywords.map((kw) => html`
              ${linkMode ? html`
                <button
                  class="px-3 py-1 rounded-full border border-gray-200 bg-white text-sm text-gray-800 hover:border-blue-300 hover:bg-blue-50"
                  @click=${() => this._openDropboxLink(this._getDropboxKeywordHref(kw.keyword))}
                >
                  ${kw.keyword}
                  <span class="ml-2 text-xs text-gray-500">(${kw.count || 0})</span>
                </button>
              ` : html`
                <button
                  class="px-3 py-1 rounded-full border border-gray-200 bg-white text-sm text-gray-800 hover:border-blue-300 hover:bg-blue-50"
                  @click=${() => this._handleChipSelect(category, kw.keyword, kw.count || 0)}
                >
                  ${kw.keyword}
                  <span class="ml-2 text-xs text-gray-500">(${kw.count || 0})</span>
                </button>
              `}
            `)}
          </div>
        </div>
      `)}
    `;
  }

  _handleChipModeChange(mode) {
    if (this.chipMode === mode) return;
    this.chipMode = mode;
    if (mode === 'dropbox') {
      this._handleBackToSelection();
    }
  }

  _renderModeToggle() {
    return html`
      <div class="flex flex-wrap items-center gap-4 mb-4 text-sm text-gray-600">
        <span class="font-medium text-gray-800">Mode</span>
        <label class="inline-flex items-center gap-2">
          <input
            type="radio"
            name="chip-mode"
            value="search"
            .checked=${this.chipMode === 'search'}
            @change=${() => this._handleChipModeChange('search')}
          >
          <span>Search in Zoltag</span>
        </label>
        <label class="inline-flex items-center gap-2">
          <input
            type="radio"
            name="chip-mode"
            value="dropbox"
            .checked=${this.chipMode === 'dropbox'}
            @change=${() => this._handleChipModeChange('dropbox')}
          >
          <span>Open in Dropbox</span>
        </label>
      </div>
    `;
  }

  _renderRatingsPanel() {
    const linkMode = this.chipMode === 'dropbox';
    const options = linkMode
      ? [
          { id: '3plus', label: '3★' },
          { id: '2plus', label: '2★' },
          { id: '1plus', label: '1★' },
          { id: 'deleted', label: 'Deleted (0★)' },
        ]
      : [
          { id: 'hide-deleted', label: 'All (hide deleted)' },
          { id: '3plus', label: '3★ only' },
          { id: '2plus', label: '2★+' },
          { id: '1plus', label: '1★+' },
          { id: 'unrated', label: 'Unrated' },
          { id: 'deleted', label: 'Deleted (0★)' },
          { id: 'all', label: 'All ratings' },
        ];
    return html`
      <section class="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <div class="text-xs font-semibold uppercase tracking-widest text-gray-500">Ratings</div>
        <div class="mt-3 flex flex-col gap-2 text-sm text-gray-700">
          ${options.map((option) => {
            const isActive = this.chipRatingFilter === option.id;
            const baseClass = `inline-flex items-center justify-between gap-2 px-3 py-1.5 rounded-full border text-sm transition-colors ${
              isActive
                ? 'border-blue-400 bg-blue-50 text-blue-800'
                : 'border-gray-200 bg-white text-gray-800 hover:border-blue-300 hover:bg-blue-50'
            }`;
            if (linkMode) {
              return html`
                <button
                  class=${baseClass}
                  @click=${() => {
                    this._handleRatingChipSelect(option.id);
                    this._openDropboxLink(this._getDropboxRatingHref(option.id));
                  }}
                >
                  <span>${option.label}</span>
                </button>
              `;
            }
            return html`
              <button
                class=${baseClass}
                @click=${() => this._handleRatingChipSelect(option.id)}
              >
                <span>${option.label}</span>
              </button>
            `;
          })}
        </div>
      </section>
    `;
  }

  render() {
    const showResults = this.chipMode === 'search' && (this.selectedTag || this.ratingOnlyActive);
    if (!showResults) {
      return html`
        <div class="container">
          <div class="space-y-6">
            <div>
              ${this._renderModeToggle()}
              ${this._renderChipList()}
            </div>
            <div>
              ${this._renderRatingsPanel()}
            </div>
          </div>
        </div>
      `;
    }

    const tagLabel = this.selectedTag ? `${this.selectedTag.category}: ${this.selectedTag.keyword}` : '';
    const tagCount = this.selectedTag?.count ?? 0;
    const ratingLabel = this._getRatingFilterLabel();

    return html`
      <div class="container">
        <div class="space-y-6">
          <div>
            ${this._renderModeToggle()}
            <button
              class="text-sm text-blue-600 hover:text-blue-700 mb-2"
              @click=${this._handleBackToSelection}
            >
              ← Back to tag selection
            </button>
            ${this.selectedTag ? html`
              <div class="text-sm text-gray-600 mb-6">
                Showing <span class="font-semibold">${tagLabel}</span> (${tagCount})
              </div>
            ` : html`
              <div class="text-sm text-gray-600 mb-6">
                Showing <span class="font-semibold">Rating: ${ratingLabel}</span>
              </div>
            `}
            <search-tab
              .tenant=${this.tenant}
              .canCurate=${this.canCurate}
              .searchFilterPanel=${this.searchFilterPanel}
              .searchChipFilters=${this.searchChipFilters}
              .searchImages=${this.searchImages}
              .searchTotal=${this.searchTotal}
              .curateThumbSize=${this.curateThumbSize}
              .tagStatsBySource=${this.tagStatsBySource}
              .activeCurateTagSource=${this.activeCurateTagSource}
              .keywords=${this.keywords}
              .imageStats=${this.imageStats}
              .curateOrderBy=${this.curateOrderBy}
              .curateDateOrder=${this.curateDateOrder}
              .hideSubtabs=${true}
              .renderCurateRatingWidget=${this.renderCurateRatingWidget}
              .renderCurateRatingStatic=${this.renderCurateRatingStatic}
              .formatCurateDate=${this.formatCurateDate}
              @sort-changed=${this._handleSortChanged}
              @thumb-size-changed=${this._handleThumbSizeChanged}
              @filters-changed=${this._handleSearchFiltersChanged}
            ></search-tab>
          </div>
        </div>
      </div>
    `;
  }

}

customElements.define('home-chips-tab', HomeChipsTab);
