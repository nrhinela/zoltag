import { LitElement, html, css } from 'lit';
import { tailwind } from '../../tailwind-lit.js';
import {
  getKeywordsByCategory,
  getCategoryCount,
  getKeywordsByCategoryFromList,
  getCategoryCountFromList,
} from '../keyword-utils.js';

class KeywordDropdown extends LitElement {
  static styles = [
    tailwind,
    css`
      :host {
        display: block;
      }
    `,
  ];

  static properties = {
    value: { type: String },
    placeholder: { type: String },
    tagStatsBySource: { type: Object },
    activeCurateTagSource: { type: String },
    keywords: { type: Array },
    imageStats: { type: Object },
    includeUntagged: { type: Boolean },
    disabled: { type: Boolean },
    compact: { type: Boolean },
    prependOptions: { type: Array },
    open: { type: Boolean, state: true },
    searchQuery: { type: String, state: true },
  };

  constructor() {
    super();
    this.value = '';
    this.placeholder = 'Select a keyword...';
    this.tagStatsBySource = {};
    this.activeCurateTagSource = 'permatags';
    this.keywords = [];
    this.imageStats = {};
    this.includeUntagged = true;
    this.disabled = false;
    this.compact = false;
    this.prependOptions = [];
    this.open = false;
    this.searchQuery = '';
    this._handleOutsideClick = this._handleOutsideClick.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('pointerdown', this._handleOutsideClick);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('pointerdown', this._handleOutsideClick);
  }

  _handleOutsideClick(event) {
    if (!this.open) return;
    const path = event.composedPath ? event.composedPath() : [];
    if (!path.includes(this)) {
      this.open = false;
      this.searchQuery = '';
    }
  }

  _toggleOpen(event) {
    event?.stopPropagation?.();
    if (this.disabled) return;
    if (!this.open) {
      this.searchQuery = '';
    }
    this.open = !this.open;
    if (this.open) {
      this._focusSearchInput();
    }
  }

  _focusSearchInput() {
    this.updateComplete.then(() => {
      if (!this.open) return;
      const input = this.renderRoot?.querySelector('[data-role="keyword-search-input"]');
      if (!input) return;
      input.focus();
      input.select();
    });
  }

  _selectValue(value) {
    this.value = value;
    this.open = false;
    this.searchQuery = '';
    this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    this.dispatchEvent(new CustomEvent('keyword-selected', {
      detail: { value },
      bubbles: true,
      composed: true,
    }));
  }

  _getKeywordsByCategory() {
    if (this.keywords && this.keywords.length) {
      return getKeywordsByCategoryFromList(this.keywords);
    }
    return getKeywordsByCategory(this.tagStatsBySource, this.activeCurateTagSource);
  }

  _getCategoryCount(category) {
    if (this.keywords && this.keywords.length) {
      return getCategoryCountFromList(this.keywords, category);
    }
    return getCategoryCount(this.tagStatsBySource, category, this.activeCurateTagSource);
  }

  _getSelectedLabel() {
    if (!this.value) {
      return this.placeholder;
    }
    const prepend = Array.isArray(this.prependOptions) ? this.prependOptions : [];
    const prependMatch = prepend.find((opt) => String(opt?.value || '') === String(this.value || ''));
    if (prependMatch) {
      return String(prependMatch.label || prependMatch.value || this.placeholder);
    }
    if (this.value === '__untagged__') {
      const count = this.imageStats?.untagged_positive_count || 0;
      return `Untagged (${count})`;
    }
    const [rawCategory, rawKeyword] = this.value.split('::');
    if (!rawKeyword) {
      return this.placeholder;
    }
    const category = decodeURIComponent(rawCategory || '');
    const keyword = decodeURIComponent(rawKeyword || '');
    let count = 0;
    if (this.keywords && this.keywords.length) {
      const match = this.keywords.find((kw) => {
        const kwCategory = kw.category || 'Uncategorized';
        return kwCategory === category && kw.keyword === keyword;
      });
      count = match?.count || 0;
    } else {
      const categoryStats = this.tagStatsBySource?.[this.activeCurateTagSource] || this.tagStatsBySource?.permatags || {};
      const keywordStats = (categoryStats[category] || []).find((kw) => kw.keyword === keyword);
      count = keywordStats?.count || 0;
    }
    return count ? `${keyword} (${count})` : keyword;
  }

  _setSearchQuery(event) {
    this.searchQuery = String(event?.target?.value || '');
  }

  _normalize(value) {
    return String(value || '').trim().toLowerCase();
  }

  _getFilteredCategories() {
    const categories = this._getKeywordsByCategory();
    const query = this._normalize(this.searchQuery);
    if (!query) return categories;
    return categories
      .map(([category, keywords]) => {
        const categoryMatch = this._normalize(category).includes(query);
        const filteredKeywords = categoryMatch
          ? keywords
          : (keywords || []).filter((kw) => this._normalize(kw?.keyword).includes(query));
        return [category, filteredKeywords];
      })
      .filter(([, keywords]) => Array.isArray(keywords) && keywords.length > 0);
  }

  _showUntaggedInResults() {
    if (!this.includeUntagged) return false;
    const query = this._normalize(this.searchQuery);
    if (!query) return true;
    return 'untagged'.includes(query);
  }

  _getFilteredPrependOptions() {
    const prepend = Array.isArray(this.prependOptions) ? this.prependOptions : [];
    const query = this._normalize(this.searchQuery);
    if (!query) return prepend;
    return prepend.filter((opt) => this._normalize(opt?.label || opt?.value).includes(query));
  }

  _renderMenu() {
    if (!this.open) return html``;
    const categories = this._getFilteredCategories();
    const prependOptions = this._getFilteredPrependOptions();
    const untaggedCount = this.imageStats?.untagged_positive_count || 0;
    const showUntagged = this._showUntaggedInResults();
    const hasResults = prependOptions.length > 0 || showUntagged || categories.length > 0;

    return html`
      <div class="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[300px] max-w-[400px] max-h-[400px] overflow-y-auto">
        <div class="sticky top-0 bg-white border-b border-gray-100 p-2">
          <input
            type="text"
            data-role="keyword-search-input"
            class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Search keywords..."
            autofocus
            .value=${this.searchQuery}
            @input=${this._setSearchQuery}
            @keydown=${(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                this.open = false;
                this.searchQuery = '';
              }
            }}
          />
        </div>
        ${prependOptions.map((opt, index) => html`
          <div
            class="px-4 py-2 cursor-pointer ${index === prependOptions.length - 1 ? 'border-b border-gray-100' : 'border-b border-gray-50'} hover:bg-gray-100 transition-colors font-semibold text-gray-800"
            @click=${() => this._selectValue(String(opt?.value || ''))}
          >
            ${String(opt?.label || opt?.value || '').trim() || '--'}
          </div>
        `)}
        ${showUntagged ? html`
          <div
            class="px-4 py-2 cursor-pointer border-b border-gray-50 last:border-b-0 hover:bg-gray-100 transition-colors"
            @click=${() => this._selectValue('__untagged__')}
          >
            <strong>Untagged</strong> (${untaggedCount})
          </div>
        ` : ''}
        ${categories.map(([category, keywords]) => html`
          <div class="px-4 py-2 font-semibold text-gray-600 bg-gray-50 text-xs uppercase tracking-wide">
            ${category}
          </div>
          ${keywords.map((kw) => html`
            <div
              class="px-4 py-2 cursor-pointer border-b border-gray-50 last:border-b-0 hover:bg-gray-100 transition-colors"
              @click=${() => this._selectValue(`${encodeURIComponent(category)}::${encodeURIComponent(kw.keyword)}`)}
            >
              ${kw.keyword} <span class="text-gray-500 text-sm">(${kw.count || 0})</span>
            </div>
          `)}
        `)}
        ${!hasResults ? html`
          <div class="px-4 py-3 text-sm text-gray-500">No keywords match your search.</div>
        ` : ''}
      </div>
    `;
  }

  render() {
    const hasValue = Boolean(this.value);
    const label = this._getSelectedLabel();
    const paddingClass = this.compact ? 'px-3 py-2 text-sm' : 'px-4 py-3 text-lg';

    return html`
      <div class="relative">
        <button
          type="button"
          class="w-full ${paddingClass} border rounded-lg text-left flex items-center justify-between gap-2 ${hasValue ? 'bg-yellow-100 border-yellow-200' : 'bg-white'}"
          @click=${this._toggleOpen}
          ?disabled=${this.disabled}
        >
          <span class="truncate">${label}</span>
          <svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
          </svg>
        </button>
        ${this._renderMenu()}
      </div>
    `;
  }
}

customElements.define('keyword-dropdown', KeywordDropdown);
