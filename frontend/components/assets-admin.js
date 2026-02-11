import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import { renderPaginationControls } from './shared/pagination-controls.js';
import { deleteImage, getDuplicateImages, getImages } from '../services/api.js';

class AssetsAdmin extends LitElement {
  static styles = [tailwind, css`
    :host {
      display: block;
    }
    .admin-subtabs {
      display: inline-flex;
      gap: 6px;
      padding: 4px;
      border-radius: 999px;
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
      margin-bottom: 16px;
    }
    .admin-subtab {
      border: none;
      background: transparent;
      color: #6b7280;
      font-size: 12px;
      font-weight: 600;
      line-height: 1;
      padding: 8px 14px;
      border-radius: 999px;
      cursor: pointer;
    }
    .admin-subtab:hover {
      color: #374151;
      background: #e5e7eb;
    }
    .admin-subtab:focus-visible {
      outline: 2px solid #2563eb;
      outline-offset: 1px;
    }
    .admin-subtab.active {
      background: #2563eb;
      color: #ffffff;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
    }
  `];

  static properties = {
    tenant: { type: String },
    canUpload: { type: Boolean },
    canDelete: { type: Boolean },
    assets: { type: Array },
    total: { type: Number },
    offset: { type: Number },
    limit: { type: Number },
    loading: { type: Boolean },
    error: { type: String },
    deletingImageId: { type: Number },
    requestId: { type: Number },
    refreshToken: { type: Number },
    assetView: { type: String },
    filenameFilter: { type: String },
    filenameInput: { type: String },
  };

  constructor() {
    super();
    this.tenant = '';
    this.canUpload = true;
    this.canDelete = true;
    this.assets = [];
    this.total = 0;
    this.offset = 0;
    this.limit = 50;
    this.loading = false;
    this.error = '';
    this.deletingImageId = null;
    this.requestId = 0;
    this.refreshToken = 0;
    this.assetView = 'recent';
    this.filenameFilter = '';
    this.filenameInput = '';
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.tenant) {
      this._loadAssets();
    }
  }

  updated(changedProperties) {
    if (changedProperties.has('tenant')) {
      this.offset = 0;
      this._loadAssets({ offset: 0, reset: true });
      return;
    }
    if (changedProperties.has('assetView')) {
      this.offset = 0;
      this._loadAssets({ offset: 0, reset: true });
      return;
    }
    if (changedProperties.has('refreshToken')) {
      this.offset = 0;
      this._loadAssets({ offset: 0, reset: true });
    }
  }

  async _loadAssets({ offset = this.offset, limit = this.limit, reset = false } = {}) {
    if (!this.tenant) {
      this.assets = [];
      this.total = 0;
      return;
    }
    const nextRequestId = this.requestId + 1;
    this.requestId = nextRequestId;
    this.loading = true;
    this.error = '';
    if (reset) {
      this.assets = [];
      this.total = 0;
    }
    try {
      const response = this.assetView === 'dupes'
        ? await getDuplicateImages(this.tenant, {
          offset,
          limit,
          sortOrder: 'desc',
          filenameQuery: this.filenameFilter,
        })
        : await getImages(this.tenant, {
          offset,
          limit,
          orderBy: 'created_at',
          sortOrder: 'desc',
          filenameQuery: this.filenameFilter,
        });
      if (this.requestId !== nextRequestId) {
        return;
      }
      this.assets = response?.images || [];
      this.total = Number(response?.total) || 0;
      this.offset = Number.isFinite(response?.offset) ? response.offset : offset;
      this.limit = Number.isFinite(response?.limit) ? response.limit : limit;
    } catch (error) {
      if (this.requestId !== nextRequestId) {
        return;
      }
      console.error('Failed to load assets:', error);
      this.error = error?.message || 'Failed to load assets.';
      this.assets = [];
      this.total = 0;
    } finally {
      if (this.requestId === nextRequestId) {
        this.loading = false;
      }
    }
  }

  _formatCreatedAt(asset) {
    const raw = asset?.created_at;
    if (!raw) return 'Unknown';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleString();
  }

  _formatSource(asset) {
    const provider = String(asset?.source_provider || '').trim().toLowerCase();
    if (!provider) return 'Unknown';
    if (provider === 'managed' || provider === 'gcs' || provider === 'google_cloud_storage') {
      return 'Uploaded';
    }
    if (provider === 'google_drive' || provider === 'gdrive') {
      return 'Google Drive';
    }
    if (provider === 'dropbox') {
      return 'Dropbox';
    }
    if (provider === 'flickr' || provider === 'flikr') {
      return 'Flickr';
    }
    return provider.replace(/_/g, ' ');
  }

  _formatFileSize(asset) {
    const size = Number(asset?.file_size);
    if (!Number.isFinite(size) || size < 0) return 'Unknown';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  _openLibraryUpload() {
    if (!this.canUpload) return;
    this.dispatchEvent(new CustomEvent('open-library-upload-modal', {
      bubbles: true,
      composed: true,
    }));
  }

  _openImage(asset) {
    if (!asset?.id) return;
    this.dispatchEvent(new CustomEvent('image-selected', {
      detail: {
        image: asset,
        imageSet: this.assets || [],
      },
      bubbles: true,
      composed: true,
    }));
  }

  _getCounts(asset) {
    const hasRating = asset?.rating !== null && asset?.rating !== undefined && asset?.rating !== '';
    const ratingValue = hasRating ? Number(asset.rating) : null;
    const tagsCount = (asset?.permatags || []).filter((tag) => Number(tag?.signum) === 1).length;
    return {
      ratingValue,
      tags: tagsCount,
    };
  }

  async _handleDelete(asset) {
    if (!this.canDelete) return;
    const imageId = asset?.id;
    if (!imageId || !this.tenant) return;
    const confirmed = window.confirm(`Delete asset ${imageId}? This cannot be undone.`);
    if (!confirmed) return;

    this.error = '';
    this.deletingImageId = imageId;
    try {
      await deleteImage(this.tenant, imageId);
      const shouldMoveBack = this.assets.length === 1 && this.offset > 0;
      const nextOffset = shouldMoveBack ? Math.max(0, this.offset - this.limit) : this.offset;
      await this._loadAssets({ offset: nextOffset, limit: this.limit });
    } catch (error) {
      console.error('Failed to delete asset:', error);
      this.error = error?.message || 'Failed to delete asset.';
    } finally {
      this.deletingImageId = null;
    }
  }

  _handlePagePrev() {
    if (this.loading) return;
    const nextOffset = Math.max(0, this.offset - this.limit);
    this._loadAssets({ offset: nextOffset, limit: this.limit });
  }

  _handlePageNext() {
    if (this.loading) return;
    if ((this.offset + this.limit) >= this.total) return;
    const nextOffset = this.offset + this.limit;
    this._loadAssets({ offset: nextOffset, limit: this.limit });
  }

  _handleLimitChange(event) {
    const parsed = Number.parseInt(event?.target?.value ?? '', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    this.limit = parsed;
    this._loadAssets({ offset: 0, limit: parsed });
  }

  _setAssetView(nextView) {
    if (nextView !== 'recent' && nextView !== 'dupes') return;
    if (this.assetView === nextView) return;
    this.assetView = nextView;
  }

  _handleFilenameInput(event) {
    this.filenameInput = event?.target?.value || '';
  }

  _applyFilenameFilter() {
    const nextFilter = (this.filenameInput || '').trim();
    if (this.filenameFilter === nextFilter) {
      this._loadAssets({ offset: 0, reset: true });
      return;
    }
    this.filenameFilter = nextFilter;
    this.offset = 0;
    this._loadAssets({ offset: 0, reset: true });
  }

  _clearFilenameFilter() {
    if (!this.filenameFilter && !this.filenameInput) return;
    this.filenameInput = '';
    this.filenameFilter = '';
    this.offset = 0;
    this._loadAssets({ offset: 0, reset: true });
  }

  _handleFilenameKeydown(event) {
    if (event?.key !== 'Enter') return;
    event.preventDefault();
    this._applyFilenameFilter();
  }

  render() {
    const rows = this.assets || [];
    return html`
      <div class="w-full">
        <div class="bg-white rounded-lg border border-gray-200 p-6">
          <div class="flex items-center justify-between gap-4 mb-4">
            <div>
              <h2 class="text-xl font-semibold text-gray-800">Assets</h2>
              <p class="text-sm text-gray-500">Manage uploaded and provider-backed assets.</p>
              ${this.canUpload || this.canDelete ? html`` : html`
                <p class="text-xs text-gray-500 mt-1">Read-only for your tenant role.</p>
              `}
            </div>
            <div class="flex items-center gap-3">
              <button
                class="px-4 py-2 bg-emerald-600 text-white rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                ?disabled=${!this.canUpload}
                title=${this.canUpload ? 'Upload files' : 'Editor or Admin role required'}
                @click=${() => this._openLibraryUpload()}
              >
                <i class="fas fa-upload mr-2"></i>Upload
              </button>
              <button class="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg" @click=${() => this._loadAssets()}>
                Refresh
              </button>
            </div>
          </div>
          <div class="admin-subtabs mb-4">
            <button
              class="admin-subtab ${this.assetView === 'recent' ? 'active' : ''}"
              @click=${() => this._setAssetView('recent')}
            >
              <i class="fas fa-clock mr-2"></i>Recent
            </button>
            <button
              class="admin-subtab ${this.assetView === 'dupes' ? 'active' : ''}"
              @click=${() => this._setAssetView('dupes')}
            >
              <i class="fas fa-clone mr-2"></i>Dupes
            </button>
          </div>
          <div class="flex items-center gap-2 mb-4 max-w-xl">
            <input
              type="text"
              class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="Search filename (partial match)..."
              .value=${this.filenameInput}
              @input=${(event) => this._handleFilenameInput(event)}
              @keydown=${(event) => this._handleFilenameKeydown(event)}
            >
            <button
              class="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-60"
              ?disabled=${this.loading}
              @click=${() => this._applyFilenameFilter()}
            >
              Search
            </button>
            <button
              class="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm disabled:opacity-60"
              ?disabled=${this.loading || (!this.filenameFilter && !this.filenameInput)}
              @click=${() => this._clearFilenameFilter()}
            >
              Clear
            </button>
          </div>

          ${this.error ? html`<div class="text-sm text-red-600 mb-4">${this.error}</div>` : html``}

          <div class="relative border border-gray-200 rounded-lg overflow-hidden">
            ${this.loading ? html`
              <div class="absolute inset-0 z-10 flex items-center justify-center bg-white/70">
                <div class="inline-flex items-center gap-2 rounded-md border border-blue-100 bg-white px-3 py-2 text-sm text-blue-700 shadow-sm">
                  <span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"></span>
                  <span>Loading ${this.assetView === 'dupes' ? 'duplicates' : 'assets'}...</span>
                </div>
              </div>
            ` : html``}
            <div class="overflow-auto">
              <table class="min-w-full text-sm">
                <thead class="bg-gray-50 text-gray-600">
                  <tr>
                    <th class="px-3 py-2 text-left font-semibold">Filename</th>
                    <th class="px-3 py-2 text-left font-semibold">Date Created</th>
                    <th class="px-3 py-2 text-left font-semibold">Source</th>
                    <th class="px-3 py-2 text-left font-semibold">Counts</th>
                    <th class="px-3 py-2 text-left font-semibold">Thumbnail</th>
                    <th class="px-3 py-2 text-left font-semibold">Filesize</th>
                    <th class="px-3 py-2 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                  ${rows.map((asset, index) => {
                    const imageId = asset?.id;
                    const displayFilename = asset?.filename || 'Unknown';
                    const counts = this._getCounts(asset);
                    const duplicateGroup = asset?.duplicate_group || '';
                    const previousGroup = index > 0 ? (rows[index - 1]?.duplicate_group || '') : '';
                    const showDuplicateDivider = this.assetView === 'dupes' && (
                      index === 0 || duplicateGroup !== previousGroup
                    );
                    const ratingDisplay = Number.isFinite(counts.ratingValue)
                      ? (counts.ratingValue === 0 ? html`<span title="Trash">🗑</span>` : String(counts.ratingValue))
                      : 'none';
                    return html`
                      ${showDuplicateDivider ? html`
                        <tr class="bg-blue-50">
                          <td class="px-3 py-2 text-xs font-semibold text-blue-700 uppercase tracking-wide" colspan="7">
                            Duplicate set (${asset?.duplicate_count || 0} items)
                          </td>
                        </tr>
                      ` : html``}
                      <tr>
                        <td class="px-3 py-2 text-gray-800">${displayFilename}</td>
                        <td class="px-3 py-2 text-gray-700">${this._formatCreatedAt(asset)}</td>
                        <td class="px-3 py-2 text-gray-700">${this._formatSource(asset)}</td>
                        <td class="px-3 py-2 text-gray-700 text-xs whitespace-nowrap">
                          <div>rating:${ratingDisplay}</div>
                          <div>tags:${counts.tags}</div>
                          ${this.assetView === 'dupes' ? html`
                            <div>dupes:${asset?.duplicate_count || 0}</div>
                          ` : html``}
                        </td>
                        <td class="px-3 py-2">
                          ${asset?.thumbnail_url ? html`
                            <button
                              type="button"
                              class="rounded border border-gray-200 p-0.5 hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
                              @click=${() => this._openImage(asset)}
                              title="Open image details"
                            >
                              <img
                                src=${asset.thumbnail_url}
                                alt=${displayFilename}
                                class="w-16 h-16 object-cover rounded"
                                loading="lazy"
                              >
                            </button>
                          ` : html`
                            <span class="text-xs text-gray-500">No thumbnail</span>
                          `}
                        </td>
                        <td class="px-3 py-2 text-gray-700 whitespace-nowrap">${this._formatFileSize(asset)}</td>
                        <td class="px-3 py-2 text-right">
                          <button
                            class="px-3 py-1 rounded border border-red-200 text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-60"
                            ?disabled=${!this.canDelete || this.deletingImageId === imageId}
                            title=${this.canDelete ? 'Delete asset' : 'Admin role required'}
                            @click=${() => this._handleDelete(asset)}
                          >
                            ${this.deletingImageId === imageId ? 'Deleting...' : 'Delete'}
                          </button>
                        </td>
                      </tr>
                    `;
                  })}
                  ${!this.loading && rows.length === 0 ? html`
                    <tr>
                      <td class="px-3 py-6 text-gray-500 text-center" colspan="7">
                        ${this.assetView === 'dupes' ? 'No embedding duplicates found.' : 'No assets found.'}
                      </td>
                    </tr>
                  ` : html``}
                </tbody>
              </table>
            </div>
            <div class="px-4 py-3 border-t border-gray-200 bg-gray-50">
              ${renderPaginationControls(this.offset, this.limit, this.total, {
                onPrev: () => this._handlePagePrev(),
                onNext: () => this._handlePageNext(),
                onLimitChange: (event) => this._handleLimitChange(event),
              }, this.loading)}
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('assets-admin', AssetsAdmin);
