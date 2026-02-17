import { LitElement, html } from 'lit';
import { getNlSearchFilters } from '../services/api.js';
import ImageFilterPanel from './shared/state/image-filter-panel.js';
import './search-tab.js';

/**
 * Lab Tab Component
 *
 * Experimental features (currently: natural language search).
 */
export class LabTab extends LitElement {
  // Use Light DOM to access Tailwind CSS classes
  createRenderRoot() {
    return this;
  }

  static properties = {
    tenant: { type: String },
    canCurate: { type: Boolean },
    nlQuery: { type: String },
    nlLoading: { type: Boolean },
    nlError: { type: String },
    nlQuestion: { type: String },
    nlOptions: { type: Array },
    nlFilterState: { type: Object },
    nlResponse: { type: Object },
    nlShowResults: { type: Boolean },
    searchFilterPanel: { type: Object },
    searchImages: { type: Array },
    searchTotal: { type: Number },
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
    this.canCurate = true;
    this.nlQuery = '';
    this.nlLoading = false;
    this.nlError = '';
    this.nlQuestion = '';
    this.nlOptions = [];
    this.nlFilterState = null;
    this.nlResponse = null;
    this.nlShowResults = false;
    this.searchFilterPanel = new ImageFilterPanel('lab');
    this.searchImages = [];
    this.searchTotal = 0;
    this.curateThumbSize = 190;
    this.tagStatsBySource = {};
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

  willUpdate(changedProps) {
    if (changedProps.has('tenant') && this.searchFilterPanel && this.tenant) {
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
      if (detail?.tabId !== 'lab') return;
      this.searchImages = [...(detail.images || [])];
      this.searchTotal = detail.total || 0;
    };
    const handleError = (detail) => {
      if (detail?.tabId !== 'lab') return;
      if (detail?.message) {
        this.nlError = detail.message;
      }
    };
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

  _handleQueryInput(event) {
    this.nlQuery = event.target.value;
  }

  _handleQueryFocus() {
    this.nlShowResults = false;
  }

  _handleQueryKeydown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      this._runNlSearch();
    }
  }

  _buildFilterState(response) {
    const filters = response?.filters || {};
    const categoryFilters = filters.category_filters || [];
    const keywordMap = {};
    const operatorMap = {};
    categoryFilters.forEach((entry) => {
      if (!entry?.category || !Array.isArray(entry.keywords)) return;
      keywordMap[entry.category] = new Set(entry.keywords);
      operatorMap[entry.category] = entry.operator || 'OR';
    });

    const rating = filters.rating?.value;
    const ratingOperator = filters.rating?.operator;

    const sortField = response?.sort?.field || 'relevance';
    const sortDirection = response?.sort?.direction || 'desc';
    const orderBy = sortField === 'relevance' ? undefined : sortField;

    return {
      limit: 48,
      offset: 0,
      sortOrder: sortDirection,
      orderBy,
      hideZeroRating: Boolean(filters.hide_zero_rating),
      keywords: keywordMap,
      operators: operatorMap,
      rating,
      ratingOperator,
      reviewed: filters.reviewed ?? undefined,
      dropboxPathPrefix: filters.dropbox_path_prefix || '',
      textQuery: this.nlQuery || '',
      categoryFilterSource: 'permatags',
      permatagPositiveMissing: false,
      listId: undefined,
      listExcludeId: undefined,
    };
  }

  async _runNlSearch(clarification = '') {
    const query = (this.nlQuery || '').trim();
    if (!query || this.nlLoading) return;
    if (!this.tenant) {
      this.nlError = 'Tenant not set';
      return;
    }
    const previousOptions = this.nlOptions;
    this.nlShowResults = false;
    this.nlLoading = true;
    this.nlError = '';
    this.nlQuestion = '';
    this.nlOptions = [];
    this.nlFilterState = null;
    this.nlResponse = null;
    try {
      if (this.searchFilterPanel) {
        this.searchFilterPanel.setTenant(this.tenant);
      }
      const response = await getNlSearchFilters(this.tenant, {
        query,
        clarification: clarification || undefined,
        clarification_options: clarification ? previousOptions : undefined,
      });
      if (response?.needs_clarification) {
        this.nlQuestion = response.question || 'Can you clarify?';
        this.nlOptions = response.options || [];
        return;
      }
      this.nlResponse = response;
      this.nlFilterState = this._buildFilterState(response);
      if (this.searchFilterPanel) {
        this.searchFilterPanel.updateFilters(this.nlFilterState);
        this.searchFilterPanel.fetchImages();
      }
      this.nlShowResults = true;
    } catch (error) {
      console.error('LabTab: NL search failed', error);
      this.nlError = error?.message || 'Search failed.';
    } finally {
      this.nlLoading = false;
    }
  }

  _handleClarification(option) {
    this._runNlSearch(option);
  }

  _serializeFilterState(filters) {
    if (!filters) return null;
    const keywords = {};
    Object.entries(filters.keywords || {}).forEach(([category, set]) => {
      keywords[category] = Array.from(set || []);
    });
    return { ...filters, keywords };
  }

  _renderAlgorithmFilters() {
    if (!this.nlFilterState) return html``;
    const filters = this.nlFilterState;
    const chips = [];
    Object.entries(filters.keywords || {}).forEach(([category, keywords]) => {
      const values = Array.from(keywords || []);
      if (!values.length) return;
      const op = filters.operators?.[category] || 'OR';
      chips.push(`${category} (${op}): ${values.join(', ')}`);
    });
    if (filters.reviewed === true) chips.push('Reviewed');
    if (filters.reviewed === false) chips.push('Unreviewed');
    if (filters.rating !== undefined) {
      const op = filters.ratingOperator || 'eq';
      chips.push(`Rating ${op} ${filters.rating}`);
    }
    if (filters.hideZeroRating) chips.push('Hide zero ratings');
    if (filters.dropboxPathPrefix) chips.push(`Dropbox: ${filters.dropboxPathPrefix}`);
    if (filters.orderBy) {
      chips.push(`Sort: ${filters.orderBy} ${filters.sortOrder || 'desc'}`);
    } else {
      chips.push(`Sort: relevance ${filters.sortOrder || 'desc'}`);
    }

    return html`
      <div class="mt-3 border-t border-gray-100 pt-3">
        <div class="text-xs font-semibold uppercase text-gray-500">Algorithm Filters</div>
        <div class="flex flex-wrap gap-2 text-xs text-gray-700 mt-2">
          ${chips.map((chip) => html`
            <span class="px-2 py-1 bg-gray-100 rounded-full border border-gray-200">${chip}</span>
          `)}
        </div>
      </div>
    `;
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

  render() {
    return html`
      <div>
        <div class="container">
          <div class="border border-gray-200 rounded-xl bg-white shadow-sm p-4 mb-6">
            <div class="flex flex-wrap items-center gap-3">
              <div class="text-lg font-semibold text-gray-900">Natural search</div>
              <span class="text-xs text-gray-500">Experimental. Results use hybrid semantic + permatag ranking.</span>
            </div>
          <div class="mt-3 flex flex-wrap gap-3 items-center">
            <input
              class="flex-1 min-w-[220px] border border-gray-300 rounded-lg px-3 py-2 text-sm"
              placeholder="e.g. red costume juggling, top rated"
              .value=${this.nlQuery}
              @input=${this._handleQueryInput}
              @focus=${this._handleQueryFocus}
              @keydown=${this._handleQueryKeydown}
            >
            <button
              class="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm"
              ?disabled=${this.nlLoading}
              @click=${() => this._runNlSearch()}
            >
              ${this.nlLoading ? 'Thinking...' : 'Search'}
            </button>
          </div>
          ${this.nlError ? html`<div class="mt-2 text-sm text-red-600">${this.nlError}</div>` : ''}
          ${this.nlQuestion ? html`
            <div class="mt-3 text-sm text-gray-700">
              <div class="font-semibold">${this.nlQuestion}</div>
              <div class="flex flex-wrap gap-2 mt-2">
                ${(this.nlOptions || []).map((option) => html`
                  <button class="px-3 py-1 rounded-full border border-gray-200 text-sm" @click=${() => this._handleClarification(option)}>
                    ${option}
                  </button>
                `)}
              </div>
            </div>
          ` : ''}
          ${this._renderAlgorithmFilters()}
          ${this.nlResponse ? html`
            <details class="mt-3">
              <summary class="text-xs font-semibold uppercase text-gray-500 cursor-pointer">Algorithm JSON</summary>
              <pre class="mt-2 text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-auto">${JSON.stringify({
                response: this.nlResponse,
                appliedFilters: this._serializeFilterState(this.nlFilterState),
              }, null, 2)}</pre>
            </details>
          ` : ''}
        </div>
      </div>
        ${this.nlShowResults ? html`
          <search-tab
            .tenant=${this.tenant}
            .canCurate=${this.canCurate}
            .searchFilterPanel=${this.searchFilterPanel}
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
          ></search-tab>
        ` : html``}
      </div>
    `;
  }
}

customElements.define('lab-tab', LabTab);
