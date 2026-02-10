import { LitElement, html } from 'lit';
import { formatStatNumber } from './shared/formatting.js';
import { renderPropertyRows, renderPropertySection } from './shared/widgets/property-grid.js';

export class HomeInsightsTab extends LitElement {
  createRenderRoot() {
    return this;
  }

  static properties = {
    imageStats: { type: Object },
    mlTrainingStats: { type: Object },
    tagStatsBySource: { type: Object },
    keywords: { type: Array },
  };

  constructor() {
    super();
    this.imageStats = null;
    this.mlTrainingStats = null;
    this.tagStatsBySource = {};
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

  _formatDateTime(dateValue) {
    if (!dateValue) return '--';
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
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

  _sumTagSourceCounts(sourceData) {
    if (!sourceData || typeof sourceData !== 'object') return 0;
    let total = 0;
    Object.values(sourceData).forEach((rows) => {
      if (!Array.isArray(rows)) return;
      rows.forEach((row) => {
        total += Number(row?.count || 0);
      });
    });
    return total;
  }

  render() {
    const imageCount = this.imageStats?.image_count || 0;
    const positiveTaggedAssetCount = Number.isFinite(this.imageStats?.positive_permatag_image_count)
      ? this.imageStats.positive_permatag_image_count
      : (this.imageStats?.tagged_image_count || 0);
    const coveragePct = imageCount ? Math.round((positiveTaggedAssetCount / imageCount) * 100) : 0;

    const positivePermatagCount = Number.isFinite(this.imageStats?.positive_permatag_count)
      ? this.imageStats.positive_permatag_count
      : this._sumTagSourceCounts(this.tagStatsBySource?.permatags);
    const avgPositivePermatagsPerAsset = imageCount
      ? (positivePermatagCount / imageCount)
      : 0;

    const modelLastTrained = this.mlTrainingStats?.keyword_model_last_trained;
    const trainedOldest = this.mlTrainingStats?.trained_tag_oldest;
    const trainedNewest = this.mlTrainingStats?.trained_tag_newest;

    const zeroShotOldest = this.mlTrainingStats?.zero_shot_tag_oldest;
    const zeroShotNewest = this.mlTrainingStats?.zero_shot_tag_newest;

    const assetsMostRecent = this.imageStats?.asset_newest || this.imageStats?.image_newest || null;
    const permatagOldest = this.imageStats?.positive_permatag_oldest || null;
    const permatagNewest = this.imageStats?.positive_permatag_newest || null;

    const keywordCount = (this.keywords || []).length;

    const photoAgeBins = Array.isArray(this.imageStats?.photo_age_bins) && this.imageStats.photo_age_bins.length
      ? this.imageStats.photo_age_bins
      : this._buildMockBins(
        imageCount,
        ['0-6mo', '6-12mo', '1-2y', '2-5y', '5-10y', '10y+'],
        [0.14, 0.2, 0.24, 0.22, 0.12, 0.08]
      );

    const assetsRows = [
      { label: 'Total assets', value: formatStatNumber(imageCount) },
      {
        label: 'Most recent asset',
        value: html`<span class=${assetsMostRecent ? 'text-gray-900' : 'text-amber-700'}>${this._formatDateTime(assetsMostRecent)}</span>`,
      },
      {
        label: 'Positive permatag coverage',
        value: `${coveragePct}% (${formatStatNumber(positiveTaggedAssetCount)} / ${formatStatNumber(imageCount)})`,
      },
    ];

    const permatagRows = [
      { label: 'Assets w/ positive permatags', value: formatStatNumber(positiveTaggedAssetCount) },
      { label: 'Avg positive permatags/asset', value: avgPositivePermatagsPerAsset.toFixed(2) },
      {
        label: 'Oldest positive permatag',
        value: html`<span class=${permatagOldest ? 'text-gray-900' : 'text-amber-700'}>${this._formatDateTime(permatagOldest)}</span>`,
      },
      {
        label: 'Newest positive permatag',
        value: html`<span class=${permatagNewest ? 'text-gray-900' : 'text-amber-700'}>${this._formatDateTime(permatagNewest)}</span>`,
      },
    ];

    const zeroShotRows = [
      { label: 'Assets with zero-shot tags', value: formatStatNumber(this.mlTrainingStats?.zero_shot_image_count || 0) },
      {
        label: 'Oldest zero-shot tag',
        value: html`<span class=${zeroShotOldest ? 'text-gray-900' : 'text-amber-700'}>${this._formatDateTime(zeroShotOldest)}</span>`,
      },
      {
        label: 'Newest zero-shot tag',
        value: html`<span class=${zeroShotNewest ? 'text-gray-900' : 'text-amber-700'}>${this._formatDateTime(zeroShotNewest)}</span>`,
      },
    ];

    const trainedRows = [
      {
        label: 'Last model build',
        value: html`<span class=${modelLastTrained ? 'text-gray-900' : 'text-amber-700'}>${this._formatDateTime(modelLastTrained)}</span>`,
      },
      {
        label: 'Oldest trained tag',
        value: html`<span class=${trainedOldest ? 'text-gray-900' : 'text-amber-700'}>${this._formatDateTime(trainedOldest)}</span>`,
      },
      {
        label: 'Newest trained tag',
        value: html`<span class=${trainedNewest ? 'text-gray-900' : 'text-amber-700'}>${this._formatDateTime(trainedNewest)}</span>`,
      },
      { label: 'Model age', value: this._formatAge(modelLastTrained) },
      { label: 'Trained-tag span', value: `${this._formatAge(trainedOldest)} -> ${this._formatAge(trainedNewest)}` },
    ];

    return html`
      <div class="container">
        <div class="mb-4 flex items-center justify-between">
          <div>
            <div class="text-lg font-semibold text-gray-900">Insights</div>
            <div class="text-xs text-gray-500">Live stats from image, permatag, and machine-tag data.</div>
          </div>
          <div class="text-xs text-gray-500">keywords: ${formatStatNumber(keywordCount)}</div>
        </div>

        <div class="grid grid-cols-1 xl:grid-cols-2 gap-3">
          ${renderPropertySection({
            title: 'Assets',
            body: html`
              ${renderPropertyRows(assetsRows)}
              <div class="prop-content">
                <div class="text-[10px] font-semibold uppercase tracking-[0.03em] text-gray-500 mb-2">Age histogram</div>
                ${this._renderBarList(photoAgeBins)}
              </div>
            `,
          })}
          ${renderPropertySection({ title: 'Permatags', rows: permatagRows })}
          ${renderPropertySection({ title: 'Zero-shot Tags', rows: zeroShotRows })}
          ${renderPropertySection({ title: 'Trained Tags', rows: trainedRows })}
        </div>
      </div>
    `;
  }
}

customElements.define('home-insights-tab', HomeInsightsTab);
