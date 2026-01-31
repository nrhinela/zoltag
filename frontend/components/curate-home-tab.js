import { LitElement, html } from 'lit';
import { formatStatNumber } from './curate-shared.js';

/**
 * Curate Home Tab Component
 *
 * Displays tag and rating statistics for the curate view.
 * Uses Light DOM to inherit Tailwind styles from parent.
 *
 * @property {Object} imageStats - Image statistics from backend
 * @property {Object} tagStatsBySource - Tag statistics by source
 * @property {String} activeCurateTagSource - Currently active tag source
 * @property {Array} curateCategoryCards - Category cards data
 *
 * @fires tag-source-changed - When user changes tag source
 */
export class CurateHomeTab extends LitElement {
  // Disable Shadow DOM to use Tailwind classes from parent
  createRenderRoot() {
    return this;
  }

  static properties = {
    imageStats: { type: Object },
    tagStatsBySource: { type: Object },
    activeCurateTagSource: { type: String },
    curateCategoryCards: { type: Array },
  };

  constructor() {
    super();
    this.imageStats = null;
    this.tagStatsBySource = {};
    this.activeCurateTagSource = 'permatags';
    this.curateCategoryCards = [];
  }

  _handleTagSourceChange(source) {
    this.activeCurateTagSource = source;
    this.dispatchEvent(new CustomEvent('tag-source-changed', {
      detail: { source },
      bubbles: true,
      composed: true,
    }));
  }

  render() {
    const categoryCards = this.curateCategoryCards || [];
    const showCategorySkeleton = !this.imageStats && !categoryCards.length;
    const skeletonCards = Array.from({ length: 3 });
    const skeletonRows = Array.from({ length: 7 });

    return html`
      <div
        class="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch"
        style="height: calc(100vh - 240px); grid-template-rows: minmax(0, 1fr);"
      >
        <!-- Left Column: Tags Information -->
        <div class="bg-white rounded-lg shadow p-4 h-full min-h-0 overflow-y-auto flex flex-col">
          <div class="text-xs text-gray-500 uppercase font-semibold mb-4">Tags</div>

          <!-- Tag Counts Summary Box -->
          <div class="border border-gray-200 rounded-lg p-2 bg-green-50 mb-4">
            <!-- Headers -->
            <div class="grid grid-cols-5 gap-1 text-xs mb-1 pb-1 border-b border-green-200">
              <div class="text-left py-1 px-1 font-semibold text-green-900">Total Tags</div>
              <div class="text-center py-1 px-1 font-semibold text-green-900">Total</div>
              <div class="text-center py-1 px-1 font-semibold text-green-900">Tagged</div>
              <div class="text-center py-1 px-1 font-semibold text-green-900">Untagged</div>
              <div class="text-center py-1 px-1 font-semibold text-green-900">%Tagged</div>
            </div>
            <!-- Data Row -->
            <div class="grid grid-cols-5 gap-1 text-xs">
              <div class="text-left py-1 px-1"></div>
              ${(() => {
                const tagged = Number.isFinite(this.imageStats?.positive_permatag_image_count)
                  ? this.imageStats.positive_permatag_image_count
                  : (this.imageStats?.tagged_image_count || 0);
                const total = this.imageStats?.image_count || 0;
                const untagged = total - tagged;
                const percent = total > 0 ? Math.round((tagged / total) * 100) : 0;
                return html`
                  <div class="text-center py-1 px-1 bg-white rounded border border-gray-100">
                    <div class="text-gray-700">${formatStatNumber(total)}</div>
                  </div>
                  <div class="text-center py-1 px-1 bg-white rounded border border-gray-100">
                    <div class="text-green-600">${formatStatNumber(tagged)}</div>
                  </div>
                  <div class="text-center py-1 px-1 bg-white rounded border border-gray-100">
                    <div class="text-orange-600">${formatStatNumber(untagged)}</div>
                  </div>
                  <div class="text-center py-1 px-1 bg-white rounded border border-gray-100">
                    <div class="text-green-600 font-semibold">${percent}%</div>
                  </div>
                `;
              })()}
            </div>
          </div>

          <!-- Tag Source Selector -->
          <div class="flex items-center gap-2 mb-3 text-xs font-semibold text-gray-600">
            ${[
              { key: 'permatags', label: 'Permatags' },
              { key: 'zero_shot', label: 'Zero-Shot' },
              { key: 'keyword_model', label: 'Keyword-Model' },
            ].map((tab) => html`
              <button
                class="px-2 py-1 rounded border ${this.activeCurateTagSource === tab.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}"
                @click=${() => this._handleTagSourceChange(tab.key)}
              >
                ${tab.label}
              </button>
            `)}
          </div>

          <!-- Category Cards -->
          <div>
            ${showCategorySkeleton ? html`
              <div class="flex gap-4 items-stretch overflow-x-auto pb-2">
                ${skeletonCards.map(() => html`
                  <div class="flex-1 min-w-[200px] border border-gray-200 rounded-lg p-2 flex flex-col animate-pulse bg-white">
                    <div class="h-3 w-28 bg-gray-200 rounded"></div>
                    <div class="mt-3 space-y-3 pr-1">
                      ${skeletonRows.map(() => html`
                        <div class="space-y-1">
                          <div class="h-2 w-3/4 bg-gray-200 rounded"></div>
                          <div class="h-1.5 w-full bg-gray-100 rounded"></div>
                        </div>
                      `)}
                    </div>
                  </div>
                `)}
              </div>
            ` : categoryCards.length ? html`
              <div class="flex gap-4 items-stretch overflow-x-auto pb-2">
                ${categoryCards.map((item) => {
                  const label = item.category.replace(/_/g, ' ');
                  return html`
                    <div class="flex-1 min-w-[200px] border border-gray-200 rounded-lg p-2 flex flex-col">
                      <div class="text-xs font-semibold text-gray-700 truncate" title=${label}>${label}</div>
                      <div class="mt-2 space-y-2 pr-1">
                        ${item.keywordRows.length ? item.keywordRows.map((kw) => {
                          const width = item.maxCount
                            ? Math.round((kw.count / item.maxCount) * 100)
                            : 0;
                          return html`
                            <div>
                              <div class="flex items-center justify-between gap-2 text-xs text-gray-600">
                                <span class="truncate" title=${kw.keyword}>${kw.keyword}</span>
                                <span class="text-gray-500">${formatStatNumber(kw.count)}</span>
                              </div>
                              <div class="h-1 bg-gray-200 rounded overflow-hidden mt-1">
                                <div class="h-full bg-blue-500 transition-all duration-300" style="width: ${width}%"></div>
                              </div>
                            </div>
                          `;
                        }) : html`<div class="text-xs text-gray-400">No tags yet.</div>`}
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

        <!-- Right Column: Ratings Information -->
        <div class="bg-white rounded-lg shadow p-4 h-full min-h-0 overflow-y-auto">
          <div class="text-xs text-gray-500 uppercase font-semibold mb-4">
            Ratings
          </div>

          <!-- Ratings Summary -->
          <div class="border border-gray-200 rounded-lg p-2 bg-blue-50 mb-2">
            <!-- Headers -->
            <div class="grid grid-cols-5 gap-1 text-xs mb-1 pb-1 border-b border-blue-200">
              <div class="text-left py-1 px-1 font-semibold text-blue-900">Total Ratings</div>
              <div class="text-center py-1 px-1 font-semibold text-blue-900">Total</div>
              <div class="text-center py-1 px-1 font-semibold text-blue-900">Rated</div>
              <div class="text-center py-1 px-1 font-semibold text-blue-900">Trash</div>
              <div class="text-center py-1 px-1 font-semibold text-blue-900">%Rated</div>
            </div>
            <!-- Data Row -->
            <div class="grid grid-cols-5 gap-1 text-xs">
              <div class="text-left py-1 px-1"></div>
              ${(() => {
                const totalRated = (this.imageStats?.rated_image_count || 0) + (this.imageStats?.rating_counts?.trash || 0);
                const totalImages = this.imageStats?.image_count || 0;
                const percent = totalImages > 0 ? Math.round((totalRated / totalImages) * 100) : 0;
                return html`
                  <div class="text-center py-1 px-1 bg-white rounded border border-gray-100">
                    <div class="text-gray-700">${formatStatNumber(totalImages)}</div>
                  </div>
                  <div class="text-center py-1 px-1 bg-white rounded border border-gray-100">
                    <div class="text-blue-600">${formatStatNumber(this.imageStats?.rated_image_count || 0)}</div>
                  </div>
                  <div class="text-center py-1 px-1 bg-white rounded border border-gray-100">
                    <div class="text-red-600">${formatStatNumber(this.imageStats?.rating_counts?.trash || 0)}</div>
                  </div>
                  <div class="text-center py-1 px-1 bg-white rounded border border-gray-100">
                    <div class="text-blue-600 font-semibold">${percent}%</div>
                  </div>
                `;
              })()}
            </div>
          </div>

          <!-- Rating Breakdown by Category -->
          <div class="mt-2">
            ${Object.keys(this.imageStats?.rating_by_category || {}).length ? html`
              ${Object.entries(this.imageStats?.rating_by_category || {}).map(([category, categoryData]) => html`
                <div class="border border-gray-200 rounded-lg p-2 bg-gray-50 mb-2">
                  <!-- Category Header -->
                  <div class="text-xs font-semibold text-gray-700 mb-2">${category.replace(/_/g, ' ')}</div>

                  <!-- Column Headers -->
                  <div class="grid grid-cols-5 gap-1 text-xs mb-1 pb-1 border-b border-gray-200">
                    <div class="text-left py-1 px-1"></div>
                    <div class="text-center py-1 px-1 font-semibold text-gray-600">Total</div>
                    <div class="text-center py-1 px-1 font-semibold text-gray-600">Rated</div>
                    <div class="text-center py-1 px-1 font-semibold text-gray-600">Trash</div>
                    <div class="text-center py-1 px-1 font-semibold text-gray-600">%Rated</div>
                  </div>

                  <!-- Individual Keywords -->
                  <div class="space-y-0.5">
                    ${Object.entries(categoryData.keywords || {}).sort(([a], [b]) => a.localeCompare(b)).map(([keywordName, keywordData]) => {
                      const ratedPlusTrash = (keywordData.rated_images || 0) + (keywordData.trash || 0);
                      const total = keywordData.total_images || 0;
                      const percentRated = total > 0 ? Math.round((ratedPlusTrash / total) * 100) : 0;
                      return html`
                        <div class="grid grid-cols-5 gap-1 text-xs">
                          <div class="text-left py-1 px-1 text-gray-600 truncate" title="${keywordName}">${keywordName}</div>
                          <div class="text-center py-1 px-1 bg-white rounded border border-gray-100">
                            <div class="text-gray-700">${formatStatNumber(total)}</div>
                          </div>
                          <div class="text-center py-1 px-1 bg-white rounded border border-gray-100">
                            <div class="text-blue-600">${formatStatNumber(keywordData.rated_images || 0)}</div>
                          </div>
                          <div class="text-center py-1 px-1 bg-white rounded border border-gray-100">
                            <div class="text-red-600">${formatStatNumber(keywordData.trash || 0)}</div>
                          </div>
                          <div class="text-center py-1 px-1 bg-white rounded border border-gray-100">
                            <div class="text-purple-600 font-semibold">${percentRated}%</div>
                          </div>
                        </div>
                      `;
                    })}
                  </div>
                </div>
              `)}
            ` : html`
              <div class="text-xs text-gray-400">No rating data by category yet.</div>
            `}
          </div>
        </div>
      </div>
    `;
  }
}

// Force cache bust by changing registration name temporarily
customElements.define('curate-home-tab-v2', CurateHomeTab);
