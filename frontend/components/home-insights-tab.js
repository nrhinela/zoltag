import { LitElement, html } from 'lit';
import { formatStatNumber } from './shared/formatting.js';

export class HomeInsightsTab extends LitElement {
  createRenderRoot() {
    return this;
  }

  static properties = {
    imageStats: { type: Object },
    mlTrainingStats: { type: Object },
    keywords: { type: Array },
  };

  constructor() {
    super();
    this.imageStats = null;
    this.mlTrainingStats = null;
    this.keywords = [];
  }

  _formatAge(dateValue) {
    if (!dateValue) return '--';
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return '--';
    const diffMs = Date.now() - date.getTime();
    const clamped = diffMs < 0 ? 0 : diffMs;
    const days = Math.floor(clamped / 86400000);
    if (days < 1) {
      const hours = Math.max(1, Math.floor(clamped / 3600000));
      return `${hours}h`;
    }
    if (days < 30) return `${days}d`;
    if (days < 365) return `${Math.floor(days / 30)}mo`;
    return `${Math.floor(days / 365)}y`;
  }

  _formatDate(dateValue) {
    if (!dateValue) return '--';
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  _buildMockBins(total, labels, fractions) {
    const safeTotal = Math.max(0, Number(total) || 0);
    const bins = [];
    let allocated = 0;
    labels.forEach((label, index) => {
      const fraction = fractions[index] ?? 0;
      const count = index === labels.length - 1
        ? Math.max(0, safeTotal - allocated)
        : Math.round(safeTotal * fraction);
      allocated += count;
      bins.push({ label, count });
    });
    return bins;
  }

  _renderBarList(bins, { max = null } = {}) {
    const maxValue = max ?? Math.max(...bins.map((bin) => bin.count), 0);
    return html`
      <div class="space-y-2">
        ${bins.map((bin) => {
          const width = maxValue ? Math.round((bin.count / maxValue) * 100) : 0;
          return html`
            <div class="flex items-center gap-3">
              <div class="w-20 text-xs text-gray-500">${bin.label}</div>
              <div class="flex-1 bg-gray-100 rounded-full h-2">
                <div class="h-2 rounded-full bg-blue-500" style="width: ${width}%"></div>
              </div>
              <div class="w-12 text-xs text-gray-500 text-right">${formatStatNumber(bin.count)}</div>
            </div>
          `;
        })}
      </div>
    `;
  }

  render() {
    const imageCount = this.imageStats?.image_count || 0;
    const taggedCount = Number.isFinite(this.imageStats?.positive_permatag_image_count)
      ? this.imageStats.positive_permatag_image_count
      : (this.imageStats?.tagged_image_count || 0);
    const coveragePct = imageCount ? Math.round((taggedCount / imageCount) * 100) : 0;

    const modelLastTrained = this.mlTrainingStats?.keyword_model_last_trained;
    const trainedOldest = this.mlTrainingStats?.trained_tag_oldest;
    const trainedNewest = this.mlTrainingStats?.trained_tag_newest;
    const keywordCount = (this.keywords || []).length;

    const keywordAgeBins = this._buildMockBins(
      keywordCount,
      ['0-30d', '31-90d', '91-180d', '180d+'],
      [0.2, 0.3, 0.25, 0.25]
    );

    const photoAgeBins = this._buildMockBins(
      imageCount,
      ['0-6mo', '6-12mo', '1-2y', '2-5y', '5-10y', '10y+'],
      [0.14, 0.2, 0.24, 0.22, 0.12, 0.08]
    );

    return html`
      <div class="container">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div class="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
            <div class="flex items-center justify-between mb-3">
              <div class="text-sm font-semibold text-gray-800">Model + Keyword Age</div>
              <span class="text-xs text-gray-500">Mock</span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div class="border border-gray-100 rounded-lg p-3 bg-gray-50">
                <div class="text-xs text-gray-500 uppercase">Model Age</div>
                <div class="text-2xl font-semibold text-gray-900">
                  ${this._formatAge(modelLastTrained)}
                </div>
                <div class="text-xs text-gray-500 mt-1">
                  Last trained: ${this._formatDate(modelLastTrained)}
                </div>
              </div>
              <div class="border border-gray-100 rounded-lg p-3 bg-gray-50">
                <div class="text-xs text-gray-500 uppercase">Trained Tag Window</div>
                <div class="text-sm font-semibold text-gray-900">
                  ${this._formatDate(trainedOldest)} → ${this._formatDate(trainedNewest)}
                </div>
                <div class="text-xs text-gray-500 mt-1">
                  Oldest: ${this._formatAge(trainedOldest)} · Newest: ${this._formatAge(trainedNewest)}
                </div>
              </div>
            </div>
            <div class="mt-4">
              <div class="text-xs font-semibold text-gray-600 uppercase mb-2">Keyword Age Distribution</div>
              ${this._renderBarList(keywordAgeBins)}
              <div class="text-xs text-gray-400 mt-2">Mock distribution until keyword timestamps are surfaced.</div>
            </div>
          </div>

          <div class="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
            <div class="text-sm font-semibold text-gray-800 mb-3">Coverage</div>
            <div class="flex items-end gap-4">
              <div class="text-3xl font-semibold text-gray-900">${coveragePct}%</div>
              <div class="text-sm text-gray-500 mb-1">
                ${formatStatNumber(taggedCount)} tagged of ${formatStatNumber(imageCount)} images
              </div>
            </div>
            <div class="mt-3 h-3 bg-gray-100 rounded-full">
              <div class="h-3 bg-emerald-500 rounded-full" style="width: ${coveragePct}%"></div>
            </div>
            <div class="text-xs text-gray-400 mt-2">Positive permatags coverage.</div>
          </div>

          <div class="bg-white border border-gray-200 rounded-xl p-4 shadow-sm lg:col-span-2">
            <div class="flex items-center justify-between mb-3">
              <div class="text-sm font-semibold text-gray-800">Photo Age Histogram (by photo date)</div>
              <span class="text-xs text-gray-500">Mock</span>
            </div>
            ${this._renderBarList(photoAgeBins)}
            <div class="text-xs text-gray-400 mt-2">Mock histogram until photo date stats are available.</div>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('home-insights-tab', HomeInsightsTab);
