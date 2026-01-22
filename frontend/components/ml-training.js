import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import { getMlTrainingImages, getMlTrainingStats, sync, retagAll } from '../services/api.js';

class MlTraining extends LitElement {
  static styles = [tailwind, css`
    :host {
      display: block;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
    }
    .table-wrapper {
      overflow-x: auto;
    }
    .thumb {
      width: 210px;
      height: 210px;
      object-fit: cover;
      border-radius: 0.5rem;
      border: 1px solid #e5e7eb;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: #f3f4f6;
      color: #374151;
      padding: 2px 6px;
      border-radius: 999px;
      font-size: 11px;
    }
  `];

  static properties = {
    tenant: { type: String },
    images: { type: Array },
    total: { type: Number },
    limit: { type: Number },
    limitAll: { type: Boolean },
    offset: { type: Number },
    isLoading: { type: Boolean },
    error: { type: String },
    useKeywordModels: { type: Boolean },
    keywordModelWeight: { type: Number },
    stats: { type: Object },
    isSyncing: { type: Boolean },
    syncCount: { type: Number },
    syncStatus: { type: String },
    lastSyncAt: { type: String },
    lastSyncCount: { type: Number },
  };

  constructor() {
    super();
    this.tenant = '';
    this.images = [];
    this.total = 0;
    this.limit = 50;
    this.limitAll = false;
    this.offset = 0;
    this.isLoading = false;
    this.error = '';
    this.useKeywordModels = null;
    this.keywordModelWeight = null;
    this.stats = null;
    this.isSyncing = false;
    this.syncCount = 0;
    this._stopRequested = false;
    this.syncStatus = 'idle';
    this.lastSyncAt = '';
    this.lastSyncCount = 0;
  }

  connectedCallback() {
    super.connectedCallback();
    this.fetchSystemConfig();
  }

  updated(changedProperties) {
    if (changedProperties.has('tenant')) {
      this.fetchImages();
      this.fetchStats();
      this._loadSyncStatus();
    }
  }

  async fetchSystemConfig() {
    try {
      const response = await fetch('/api/v1/config/system');
      if (!response.ok) {
        throw new Error('Failed to fetch system config');
      }
      const data = await response.json();
      this.useKeywordModels = data.use_keyword_models ?? null;
      this.keywordModelWeight = data.keyword_model_weight ?? null;
    } catch (error) {
      console.error('Failed to fetch ML training config:', error);
      this.useKeywordModels = null;
      this.keywordModelWeight = null;
    }
  }

  async fetchStats() {
    if (!this.tenant) return;
    try {
      this.stats = await getMlTrainingStats(this.tenant);
    } catch (error) {
      console.error('Failed to fetch ML training stats:', error);
      this.stats = null;
    }
  }

  async fetchImages(options = {}) {
    if (!this.tenant) return;
    this.isLoading = true;
    this.error = '';
    try {
      const effectiveLimit = this.limitAll && this.total > 0 ? this.total : this.limit;
      const response = await getMlTrainingImages(this.tenant, {
        limit: effectiveLimit,
        offset: this.offset,
        refresh: options.refresh || false,
      });
      this.images = response.images || [];
      this.total = response.total ?? this.images.length;
      if (this.limitAll && this.total > 0 && this.limit !== this.total) {
        this.limit = this.total;
      }
    } catch (error) {
      console.error('Failed to fetch ML training images:', error);
      this.error = 'Failed to load ML training data.';
    } finally {
      this.isLoading = false;
    }
  }

  _persistSyncStatus() {
    if (!this.tenant) return;
    const payload = {
      lastSyncAt: this.lastSyncAt,
      lastSyncCount: this.lastSyncCount,
      syncStatus: this.syncStatus,
    };
    localStorage.setItem(`photocat-sync-status-${this.tenant}`, JSON.stringify(payload));
  }

  _loadSyncStatus() {
    if (!this.tenant) return;
    const raw = localStorage.getItem(`photocat-sync-status-${this.tenant}`);
    if (!raw) {
      this.lastSyncAt = '';
      this.lastSyncCount = 0;
      this.syncStatus = 'idle';
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      this.lastSyncAt = parsed.lastSyncAt || '';
      this.lastSyncCount = parsed.lastSyncCount || 0;
      this.syncStatus = parsed.syncStatus || 'idle';
    } catch (error) {
      console.warn('Failed to parse sync status cache', error);
      this.lastSyncAt = '';
      this.lastSyncCount = 0;
      this.syncStatus = 'idle';
    }
  }

  _getSyncLabel() {
    if (this.isSyncing || this.syncStatus === 'running') {
      return `Syncing: ${this.syncCount}`;
    }
    if (this.syncStatus === 'stopped' && this.lastSyncCount) {
      return `Sync stopped (${this.lastSyncCount})`;
    }
    if (this.syncStatus === 'complete' && this.lastSyncAt) {
      const date = new Date(this.lastSyncAt).toLocaleString();
      return `Last sync: ${date} (${this.lastSyncCount})`;
    }
    if (this.syncStatus === 'error') {
      return 'Sync error';
    }
    return 'Sync idle';
  }

  async _sync() {
    if (this.isSyncing || !this.tenant) return;
    this.isSyncing = true;
    this.syncCount = 0;
    this._stopRequested = false;
    this.syncStatus = 'running';
    this.lastSyncAt = '';
    this.lastSyncCount = 0;
    this._persistSyncStatus();

    try {
      let hasMore = true;
      while (hasMore && !this._stopRequested) {
        const result = await sync(this.tenant);
        if (result.processed > 0) {
          this.syncCount += result.processed;
          this.lastSyncCount = this.syncCount;
          this._persistSyncStatus();
        }
        hasMore = result.has_more;
      }

      this.syncStatus = this._stopRequested ? 'stopped' : 'complete';
      if (!this._stopRequested) {
        this.lastSyncAt = new Date().toISOString();
        this.lastSyncCount = this.syncCount;
      }
    } catch (error) {
      console.error('Sync error:', error);
      this.syncStatus = 'error';
    } finally {
      this._persistSyncStatus();
      this.isSyncing = false;
      this._stopRequested = false;
    }
  }

  _stopSync() {
    this._stopRequested = true;
  }

  async _retagAll() {
    if (!this.tenant) return;
    try {
      await retagAll(this.tenant);
    } catch (error) {
      console.error('Retag error:', error);
      this.error = 'Failed to start retag job.';
    }
  }

  _handleLimitChange(e) {
    const value = e.target.value;
    if (value === 'all') {
      this.limitAll = true;
      if (this.total > 0) {
        this.limit = this.total;
      }
    } else {
      this.limitAll = false;
      this.limit = Number(value);
    }
    this.offset = 0;
    this.fetchImages();
  }

  _handlePagePrev() {
    if (this.isLoading || this.limitAll) return;
    const nextOffset = Math.max(0, this.offset - this.limit);
    if (nextOffset === this.offset) return;
    this.offset = nextOffset;
    this.fetchImages();
  }

  _handlePageNext() {
    if (this.isLoading || this.limitAll) return;
    const nextOffset = this.offset + this.limit;
    if (this.total && nextOffset >= this.total) return;
    this.offset = nextOffset;
    this.fetchImages();
  }

  _formatStatNumber(value) {
    if (value === null || value === undefined) return '--';
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return '--';
    return numericValue.toLocaleString();
  }

  _formatStatDate(value) {
    if (!value) return '--';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '--';
    return parsed.toLocaleString();
  }

  renderTagList(tags, emptyLabel = 'None') {
    if (!tags || tags.length === 0) {
      return html`<span class="text-xs text-gray-400">${emptyLabel}</span>`;
    }
    const hasCategory = tags.some((tag) => typeof tag !== 'string' && tag.category);
    if (!hasCategory) {
      return html`
        <div class="flex flex-wrap gap-1">
          ${tags.map((tag) => {
            if (typeof tag === 'string') {
              return html`<span class="chip">${tag}</span>`;
            }
            return html`<span class="chip">${tag.keyword} · ${(tag.confidence * 100).toFixed(0)}%</span>`;
          })}
        </div>
      `;
    }

    const grouped = {};
    tags.forEach((tag) => {
      if (typeof tag === 'string') {
        grouped.Uncategorized = grouped.Uncategorized || [];
        grouped.Uncategorized.push({ keyword: tag, confidence: null });
      } else {
        const category = tag.category || 'Uncategorized';
        grouped[category] = grouped[category] || [];
        grouped[category].push(tag);
      }
    });

    const sortedCategories = Object.keys(grouped).sort((a, b) => a.localeCompare(b));
    sortedCategories.forEach((category) => {
      grouped[category].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    });

    return html`
      <div class="space-y-2">
        ${sortedCategories.map((category) => html`
          <div>
            <div class="text-xs font-semibold text-gray-500 mb-1">${category}</div>
            <div class="flex flex-wrap gap-1">
              ${grouped[category].map((tag) => html`
                <span class="chip">
                  ${tag.keyword}${tag.confidence !== null ? ` · ${(tag.confidence * 100).toFixed(0)}%` : ''}
                </span>
              `)}
            </div>
          </div>
        `)}
      </div>
    `;
  }

  render() {
    const keywordModelsLabel = this.useKeywordModels === null
      ? '--'
      : this.useKeywordModels
        ? 'true'
        : 'false';
    const keywordWeightLabel = this.keywordModelWeight === null
      ? '--'
      : String(this.keywordModelWeight);

    const imageCount = this._formatStatNumber(this.stats?.image_count);
    const embeddingCount = this._formatStatNumber(this.stats?.embedding_count);
    const lastModelUpdate = this._formatStatDate(this.stats?.keyword_model_last_trained);
    const zeroShotCount = this._formatStatNumber(this.stats?.zero_shot_image_count);
    const trainedImageCount = this._formatStatNumber(this.stats?.trained_image_count);
    const pageStart = this.images.length ? this.offset + 1 : 0;
    const pageEnd = this.images.length ? this.offset + this.images.length : 0;
    const hasPrev = !this.limitAll && this.offset > 0;
    const hasNext = !this.limitAll && this.total && pageEnd < this.total;

    const totalLabel = this.total || this.images.length;
    const pagerControls = html`
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="text-xs text-gray-500">Showing ${pageStart}-${pageEnd} of ${totalLabel} images</div>
        <div class="flex flex-wrap items-center gap-3">
          <label class="text-xs font-semibold text-gray-600">
            Limit
            <select
              class="ml-2 px-2 py-1 border rounded"
              .value=${this.limitAll ? 'all' : String(this.limit)}
              @change=${this._handleLimitChange}
            >
              ${[25, 50, 100, 200].map((value) => html`
                <option value=${value}>${value}</option>
              `)}
              ${(this.total > 0 || this.limitAll) ? html`
                <option value="all">All (${this.total || this.limit})</option>
              ` : ''}
            </select>
          </label>
          <div class="flex items-center gap-2 text-xs text-gray-500">
            <button class="px-2 py-1 border rounded disabled:opacity-40" ?disabled=${!hasPrev} @click=${this._handlePagePrev}>
              Prev
            </button>
            <button class="px-2 py-1 border rounded disabled:opacity-40" ?disabled=${!hasNext} @click=${this._handlePageNext}>
              Next
            </button>
          </div>
          <button class="text-sm text-blue-600 hover:text-blue-700" @click=${() => this.fetchImages({ refresh: true })}>
            Recompute
          </button>
        </div>
      </div>
    `;

    return html`
      <div class="max-w-6xl mx-auto">
        <div class="stats-grid mb-4">
          <div class="border border-gray-200 rounded-lg p-2 bg-white shadow">
            <div class="text-xs text-gray-500 uppercase">Total Images</div>
            <div class="text-xl font-semibold text-gray-900">${imageCount}</div>
          </div>
          <div class="border border-gray-200 rounded-lg p-2 bg-white shadow">
            <div class="text-xs text-gray-500 uppercase">Embeddings</div>
            <div class="text-xl font-semibold text-gray-900">${embeddingCount}</div>
          </div>
          <div class="border border-gray-200 rounded-lg p-2 bg-white shadow">
            <div class="text-xs text-gray-500 uppercase">Zero-Shot</div>
            <div class="text-xl font-semibold text-gray-900">${zeroShotCount}</div>
          </div>
          <div class="border border-gray-200 rounded-lg p-2 bg-white shadow">
            <div class="text-xs text-gray-500 uppercase">Keyword-Model</div>
            <div class="text-xl font-semibold text-gray-900">${trainedImageCount}</div>
          </div>
          <div class="border border-gray-200 rounded-lg p-2 bg-white shadow">
            <div class="text-xs text-gray-500 uppercase">Model Updated</div>
            <div class="text-sm font-semibold text-gray-900">${lastModelUpdate}</div>
          </div>
        </div>

        <div class="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <h2 class="text-xl font-semibold text-gray-800">Pipeline</h2>
            <p class="text-sm text-gray-500">Compare verified tags with zero-shot and keyword-model output.</p>
            <div class="text-xs text-gray-500 mt-1 space-y-1">
              <div>USE_KEYWORD_MODELS: ${keywordModelsLabel} · KEYWORD_MODEL_WEIGHT: ${keywordWeightLabel}</div>
              <div class="text-gray-400">Rebuild model:</div>
              <pre class="bg-gray-50 border border-gray-200 rounded px-2 py-1 text-[11px] text-gray-700 whitespace-pre-wrap">
photocat build-embeddings --tenant-id &lt;tenant&gt; --force
photocat train-keyword-models --tenant-id &lt;tenant&gt; --min-positive 3 --min-negative 3
              </pre>
              <div class="text-gray-400">Retag keyword-model tags (batch):</div>
              <pre class="bg-gray-50 border border-gray-200 rounded px-2 py-1 text-[11px] text-gray-700 whitespace-pre-wrap">
photocat recompute-trained-tags --tenant-id &lt;tenant&gt; --batch-size 50 --limit 500 --offset 0
# Backfill only (default). Use --replace to overwrite existing keyword-model tags.
photocat recompute-trained-tags --tenant-id &lt;tenant&gt; --batch-size 50 --limit 500 --offset 0 --replace
              </pre>
            </div>
          </div>
          <div class="border border-gray-200 rounded-lg p-3 bg-white shadow-sm">
            <div class="text-xs text-gray-500 uppercase mb-2">Pipeline Actions</div>
            <div class="flex items-center gap-2">
              ${this.isSyncing ? html`
                <button
                  class="bg-red-600 text-white px-3 py-1.5 rounded-lg hover:bg-red-700 text-sm"
                  @click=${this._stopSync}
                >
                  <i class="fas fa-stop mr-2"></i>Stop (${this.syncCount})
                </button>
              ` : html`
                <button
                  class="bg-teal-600 text-white px-3 py-1.5 rounded-lg hover:bg-teal-700 text-sm"
                  @click=${this._sync}
                >
                  <i class="fas fa-sync mr-2"></i>Sync
                </button>
              `}
              <button
                class="bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700 text-sm"
                @click=${this._retagAll}
              >
                <i class="fas fa-tags mr-2"></i>Retag All
              </button>
            </div>
            <div class="text-xs text-gray-500 mt-2">${this._getSyncLabel()}</div>
          </div>
        </div>

        ${this.error ? html`<div class="text-sm text-red-600 mb-4">${this.error}</div>` : ''}
        ${this.isLoading ? html`<div class="text-sm text-gray-500 mb-4">Loading images...</div>` : ''}
        <div class="mb-3">
          ${pagerControls}
        </div>

        <div class="table-wrapper bg-white border border-gray-200 rounded-lg">
          <table class="min-w-full text-sm">
            <thead class="bg-gray-50 text-gray-600">
              <tr>
                <th class="text-left px-3 py-2 font-semibold">Image</th>
                <th class="text-left px-3 py-2 font-semibold">Embedding</th>
                <th class="text-left px-3 py-2 font-semibold">Positive Permatags</th>
                <th class="text-left px-3 py-2 font-semibold">Zero-Shot</th>
                <th class="text-left px-3 py-2 font-semibold">Keyword-Model</th>
              </tr>
            </thead>
            <tbody>
              ${this.images.map((image) => html`
                <tr class="border-t">
                  <td class="px-3 py-3 align-top">
                      <div class="flex flex-col items-start gap-2">
                        ${image.thumbnail_url ? html`
                          <img class="thumb" src=${image.thumbnail_url} alt=${image.filename} />
                        ` : html`
                          <div class="thumb bg-gray-100"></div>
                        `}
                        <div class="text-xs text-gray-600 break-all">
                          ${image.id !== undefined && image.id !== null ? `ID ${image.id}: ` : ''}${image.filename}
                        </div>
                      </div>
                  </td>
                  <td class="px-3 py-3 align-top">
                    ${image.embedding_generated
                      ? html`<span class="text-xs font-semibold text-green-600">Yes</span>`
                      : html`<span class="text-xs text-gray-400">No</span>`}
                  </td>
                  <td class="px-3 py-3 align-top">
                    ${this.renderTagList(image.positive_permatags, 'No positives')}
                  </td>
                  <td class="px-3 py-3 align-top">
                    ${this.renderTagList(image.ml_tags, 'No ML tags')}
                  </td>
                  <td class="px-3 py-3 align-top">
                    ${this.renderTagList(image.trained_tags, 'No keyword-model tags')}
                  </td>
                </tr>
              `)}
            </tbody>
          </table>
        </div>
        <div class="mt-3">
          ${pagerControls}
        </div>
      </div>
    `;
  }
}

customElements.define('ml-training', MlTraining);
