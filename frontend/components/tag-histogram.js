import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';

class TagHistogram extends LitElement {
  static styles = [tailwind, css`
    :host {
      display: block;
      height: 100%;
    }
    .histogram-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }
    .histogram-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
      flex-wrap: wrap;
    }
    .histogram-scroll {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      min-height: 0;
    }
    .tag-carousel {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .tag-card {
      flex-shrink: 0;
      border: 1px solid #e2e8f0;
      border-radius: 0.5rem;
      padding: 0.5rem;
      background-color: white;
    }
    .tag-card-body {
      margin-top: 0.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .tag-bar {
      width: 100%;
      height: 0.25rem;
      background-color: #e2e8f0;
      border-radius: 0.125rem;
      overflow: hidden;
    }
    .tag-bar-fill {
      height: 100%;
      background-color: #3b82f6;
      border-radius: 0.125rem;
      transition: width 0.2s ease;
    }
  `];

  static properties = {
    categoryCards: { type: Array },
    activeTagSource: { type: String },
    tagStatsBySource: { type: Object },
  };

  constructor() {
    super();
    this.categoryCards = [];
    this.activeTagSource = 'permatags';
    this.tagStatsBySource = {};
  }

  render() {
    return html`
      <div class="histogram-container">
        <div class="histogram-header">
          <div class="text-xs font-semibold text-gray-600">Tag Counts</div>
          <div class="flex items-center gap-2 ml-auto">
            ${[
              { key: 'permatags', label: 'Permatags' },
              { key: 'keyword_model', label: 'Keyword-Model' },
              { key: 'zero_shot', label: 'Zero-Shot' },
            ].map((tab) => html`
              <button
                class="px-2 py-1 rounded border text-xs font-semibold ${this.activeTagSource === tab.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}"
                @click=${() => {
                  this.activeTagSource = tab.key;
                  this.dispatchEvent(new CustomEvent('tag-source-change', {
                    detail: { source: tab.key },
                    bubbles: true,
                    composed: true,
                  }));
                }}
              >
                ${tab.label}
              </button>
            `)}
          </div>
        </div>
        <div class="histogram-scroll">
          ${this.categoryCards.length ? html`
            <div class="tag-carousel">
              ${this.categoryCards.map((item) => {
                const label = item.category.replace(/_/g, ' ');
                return html`
                  <div class="tag-card">
                    <div class="text-xs font-semibold text-gray-700 truncate" title=${label}>${label}</div>
                    <div class="tag-card-body">
                      ${item.keywordRows.map((kw) => {
                        const width = item.maxCount
                          ? Math.round((kw.count / item.maxCount) * 100)
                          : 0;
                        return html`
                          <div>
                            <div class="flex items-center justify-between gap-2 text-xs text-gray-600">
                              <span class="truncate" title=${kw.keyword}>${kw.keyword}</span>
                              <span class="text-gray-500">${this._formatStatNumber(kw.count)}</span>
                            </div>
                            <div class="tag-bar mt-1">
                              <div class="tag-bar-fill" style="width: ${width}%"></div>
                            </div>
                          </div>
                        `;
                      })}
                    </div>
                  </div>
                `;
              })}
            </div>
          ` : html`
            <div class="text-xs text-gray-400">No tag data yet.</div>
          `}
        </div>
      </div>
    `;
  }

  _formatStatNumber(value) {
    if (value === null || value === undefined) return '--';
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return '--';
    return numericValue.toLocaleString();
  }
}

customElements.define('tag-histogram', TagHistogram);
