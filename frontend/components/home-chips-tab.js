import { LitElement, html } from 'lit';
import ImageFilterPanel from './shared/state/image-filter-panel.js';
import { getKeywordsByCategoryFromList } from './shared/keyword-utils.js';
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
    renderCurateRatingWidget: { type: Object },
    renderCurateRatingStatic: { type: Object },
    formatCurateDate: { type: Object },
  };

  constructor() {
    super();
    this.tenant = '';
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
    this.renderCurateRatingWidget = null;
    this.renderCurateRatingStatic = null;
    this.formatCurateDate = null;

    this._panelHandlers = null;
    this._setupFilterPanelHandlers();
  }

  updated(changedProps) {
    if (changedProps.has('tenant') && this.searchFilterPanel) {
      this.searchFilterPanel.setTenant(this.tenant);
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
    const keywords = {};
    const operators = {};
    keywords[category] = new Set([keyword]);
    operators[category] = 'OR';
    return {
      limit: 100,
      offset: 0,
      sortOrder: this.curateDateOrder || 'desc',
      orderBy: this.curateOrderBy || 'photo_creation',
      hideZeroRating: true,
      keywords,
      operators,
      rating: undefined,
      ratingOperator: undefined,
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
    this.searchChipFilters = [{
      type: 'keyword',
      category,
      value: keyword,
      displayLabel: 'Keywords',
      displayValue: keyword,
    }];
    const filters = this._buildChipFilterState(category, keyword);
    this.searchFilterPanel.setTenant(this.tenant);
    this.searchFilterPanel.updateFilters(filters);
    this.searchFilterPanel.fetchImages();
  }

  _handleBackToSelection() {
    this.selectedTag = null;
    this.searchImages = [];
    this.searchTotal = 0;
    this.searchChipFilters = [];
    this.searchFilterPanel?.reset();
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

  _renderChipList() {
    const categories = getKeywordsByCategoryFromList(this.keywords || []);
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
              <button
                class="px-3 py-1 rounded-full border border-gray-200 bg-white text-sm text-gray-800 hover:border-blue-300 hover:bg-blue-50"
                @click=${() => this._handleChipSelect(category, kw.keyword, kw.count || 0)}
              >
                ${kw.keyword}
                <span class="ml-2 text-xs text-gray-500">(${kw.count || 0})</span>
              </button>
            `)}
          </div>
        </div>
      `)}
    `;
  }

  render() {
    if (!this.selectedTag) {
      return html`
        <div class="container">
          ${this._renderChipList()}
        </div>
      `;
    }

    const tagLabel = `${this.selectedTag.category}: ${this.selectedTag.keyword}`;
    const tagCount = this.selectedTag.count ?? 0;

    return html`
      <div>
        <div class="container">
          <button
            class="text-sm text-blue-600 hover:text-blue-700 mb-2"
            @click=${this._handleBackToSelection}
          >
            ← Back to tag selection
          </button>
          <div class="text-sm text-gray-600">
            Showing <span class="font-semibold">${tagLabel}</span> (${tagCount})
          </div>
        </div>
        <search-tab
          .tenant=${this.tenant}
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
    `;
  }
}

customElements.define('home-chips-tab', HomeChipsTab);
