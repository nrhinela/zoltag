import { LitElement, html, css } from 'lit';
import { getImageDetails, getKeywords, addPermatag, getFullImage, setRating, refreshImageMetadata } from '../services/api.js';
import { tailwind } from './tailwind-lit.js';

class ImageEditor extends LitElement {
  static styles = [tailwind, css`
    :host {
      display: block;
    }
    .modal {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 60;
      background: rgba(15, 23, 42, 0.65);
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .modal.open {
      display: flex;
    }
    .panel {
      background: #ffffff;
      border-radius: 16px;
      width: min(1200px, 95vw);
      height: 82vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 45px rgba(15, 23, 42, 0.25);
      font-size: 11px;
    }
    .panel.embedded {
      width: 100%;
      height: auto;
      box-shadow: none;
      border: 1px solid #e5e7eb;
    }
    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 18px;
      border-bottom: 1px solid #e5e7eb;
    }
    .panel-title {
      font-size: 16px;
      font-weight: 600;
      color: #111827;
      word-break: break-word;
    }
    .panel-close {
      font-size: 22px;
      color: #6b7280;
      line-height: 1;
    }
    .panel-body {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
      padding: 18px;
      flex: 1;
      overflow: hidden;
      align-items: stretch;
      min-height: 0;
    }
    .right-pane {
      text-align: left;
      font-size: inherit;
      color: #4b5563;
      display: flex;
      flex-direction: column;
      gap: 12px;
      overflow: auto;
      max-height: 100%;
      min-height: 0;
      min-width: 0;
    }
    .image-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      overflow: auto;
      max-height: 100%;
    }
    .image-wrap img {
      width: auto;
      height: auto;
      max-width: none;
      max-height: none;
      border-radius: 12px;
      border: 1px solid #e5e7eb;
      background: #f3f4f6;
    }
    .image-wrap.image-full img {
      width: 100%;
      height: 100%;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    .skeleton-block {
      background: linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 37%, #f3f4f6 63%);
      background-size: 400% 100%;
      animation: skeleton-shimmer 1.4s ease infinite;
      border-radius: 10px;
    }
    .skeleton-image {
      width: 100%;
      aspect-ratio: 4 / 3;
      border: 1px solid #e5e7eb;
    }
    .skeleton-line {
      height: 12px;
    }
    .skeleton-line.sm {
      height: 10px;
    }
    .skeleton-stack {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .loading-indicator {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #6b7280;
    }
    .loading-dot {
      width: 8px;
      height: 8px;
      border-radius: 9999px;
      background: #2563eb;
      animation: loading-pulse 1s ease-in-out infinite;
    }
    @keyframes skeleton-shimmer {
      0% { background-position: 100% 0; }
      100% { background-position: -100% 0; }
    }
    @keyframes loading-pulse {
      0%, 100% { opacity: 0.3; }
      50% { opacity: 1; }
    }
    .tab-row {
      display: flex;
      gap: 8px;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 8px;
    }
    .tab-button {
      padding: 6px 10px;
      font-size: inherit;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
      color: #4b5563;
      background: #ffffff;
    }
    .tab-button.active {
      border-color: #2563eb;
      background: #2563eb;
      color: #ffffff;
    }
    .tag-section {
      display: flex;
      flex-direction: column;
      gap: 12px;
      font-size: inherit;
    }
    .tag-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .tag-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #eef2ff;
      color: #3730a3;
      padding: 6px 10px;
      border-radius: 9999px;
      font-size: inherit;
    }
    .tag-remove {
      color: #dc2626;
      font-size: 14px;
      line-height: 1;
    }
    .tag-form {
      display: grid;
      grid-template-columns: 1fr 180px auto;
      gap: 8px;
      align-items: center;
    }
    .tag-input,
    .tag-select {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 8px 10px;
      font-size: inherit;
      color: #111827;
    }
    .tag-add {
      border-radius: 8px;
      padding: 8px 12px;
      background: #2563eb;
      color: #ffffff;
      font-size: inherit;
    }
    .metadata-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px 16px;
      font-size: inherit;
      color: inherit;
    }
    .metadata-label {
      font-weight: 500;
      color: inherit;
    }
    .tag-table {
      display: grid;
      gap: 6px;
      font-size: inherit;
      color: inherit;
    }
    .tag-row {
      display: grid;
      grid-template-columns: 2fr 1fr 2fr;
      gap: 10px;
      align-items: center;
    }
    .tag-row.header {
      font-weight: 600;
      color: #6b7280;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 4px;
    }
    .tag-cell {
      word-break: break-word;
    }
    .exif-block {
      border-top: 1px solid #e5e7eb;
      margin-top: 12px;
      padding-top: 12px;
    }
    .exif-list {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 12px;
      font-size: inherit;
      color: inherit;
      max-height: 240px;
      overflow: auto;
    }
    .empty-text {
      font-size: 12px;
      color: #9ca3af;
    }
    @media (max-width: 900px) {
      .panel-body {
        grid-template-columns: 1fr;
      }
      .tag-form {
        grid-template-columns: 1fr;
      }
    }
  `];

  static properties = {
    tenant: { type: String },
    image: { type: Object },
    open: { type: Boolean },
    embedded: { type: Boolean },
    details: { type: Object },
    keywordsByCategory: { type: Object },
    activeTab: { type: String },
    tagSubTab: { type: String },
    tagInput: { type: String },
    tagCategory: { type: String },
    loading: { type: Boolean },
    error: { type: String },
    fullImageUrl: { type: String },
    fullImageLoading: { type: Boolean },
    fullImageError: { type: String },
    ratingSaving: { type: Boolean },
    ratingError: { type: String },
    metadataRefreshing: { type: Boolean },
  };

  constructor() {
    super();
    this.tenant = '';
    this.image = null;
    this.open = false;
    this.embedded = false;
    this.details = null;
    this.keywordsByCategory = {};
    this.activeTab = 'edit';
    this.tagSubTab = 'permatags';
    this.tagInput = '';
    this.tagCategory = '';
    this.loading = false;
    this.error = '';
    this.fullImageUrl = '';
    this.fullImageLoading = false;
    this.fullImageError = '';
    this.ratingSaving = false;
    this.ratingError = '';
    this.metadataRefreshing = false;
    this._handlePermatagEvent = (event) => {
      if ((this.open || this.embedded) && event?.detail?.imageId === this.image?.id) {
        this.fetchDetails();
      }
    };
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('permatags-changed', this._handlePermatagEvent);
  }

  disconnectedCallback() {
    window.removeEventListener('permatags-changed', this._handlePermatagEvent);
    this._resetFullImage();
    super.disconnectedCallback();
  }

  willUpdate(changedProperties) {
    const shouldLoad = this.embedded || this.open;
    if (shouldLoad && (changedProperties.has('image') || changedProperties.has('tenant'))) {
      this._resetFullImage();
      this.fetchDetails();
      this.fetchKeywords();
    }
    if (changedProperties.has('details')) {
      this._syncTagSubTab();
      if (this.activeTab === 'image') {
        this._loadFullImage();
      }
    }
    if (changedProperties.has('open') && !this.open && !this.embedded) {
      this._resetFullImage();
    }
  }

  async fetchDetails() {
    if (!this.image || !this.tenant) return;
    this.loading = true;
    this.error = '';
    try {
      this.details = await getImageDetails(this.tenant, this.image.id);
    } catch (error) {
      this.error = 'Failed to load image details.';
      console.error('ImageEditor: fetchDetails failed', error);
    } finally {
      this.loading = false;
    }
  }

  async _handleMetadataRefresh() {
    if (!this.details || !this.tenant || this.metadataRefreshing) return;
    this.metadataRefreshing = true;
    try {
      await refreshImageMetadata(this.tenant, this.details.id);
      await this.fetchDetails();
    } catch (error) {
      console.error('ImageEditor: metadata refresh failed', error);
    } finally {
      this.metadataRefreshing = false;
    }
  }

  async fetchKeywords() {
    if (!this.tenant) return;
    try {
      this.keywordsByCategory = await getKeywords(this.tenant);
    } catch (error) {
      console.error('ImageEditor: fetchKeywords failed', error);
      this.keywordsByCategory = {};
    }
  }

  _close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  _setTab(tab) {
    this.activeTab = tab;
    if (tab === 'image') {
      this._loadFullImage();
    }
  }

  _setTagSubTab(tab) {
    this.tagSubTab = tab;
  }

  async _handleRatingClick(value) {
    if (!this.details || !this.tenant || this.ratingSaving) return;
    this.ratingSaving = true;
    this.ratingError = '';
    try {
      await setRating(this.tenant, this.details.id, value);
      this.details = { ...this.details, rating: value };
      this.dispatchEvent(new CustomEvent('image-rating-updated', {
        detail: { imageId: this.details.id, rating: value },
        bubbles: true,
        composed: true,
      }));
    } catch (error) {
      this.ratingError = 'Failed to update rating.';
      console.error('ImageEditor: rating update failed', error);
    } finally {
      this.ratingSaving = false;
    }
  }

  _resetFullImage() {
    if (this.fullImageUrl) {
      URL.revokeObjectURL(this.fullImageUrl);
    }
    this.fullImageUrl = '';
    this.fullImageLoading = false;
    this.fullImageError = '';
  }

  async _loadFullImage() {
    if (!this.details || !this.tenant) return;
    if (this.fullImageUrl || this.fullImageLoading) return;
    this.fullImageLoading = true;
    this.fullImageError = '';
    try {
      const blob = await getFullImage(this.tenant, this.details.id);
      this.fullImageUrl = URL.createObjectURL(blob);
    } catch (error) {
      this.fullImageError = 'Failed to load full-size image.';
      console.error('ImageEditor: full image load failed', error);
    } finally {
      this.fullImageLoading = false;
    }
  }

  _syncTagSubTab() {
    const types = Object.keys(this.details?.machine_tags_by_type || {});
    const tabs = ['permatags', ...types];
    if (!tabs.includes(this.tagSubTab)) {
      this.tagSubTab = 'permatags';
    }
  }

  _keywordIndex() {
    const map = {};
    Object.entries(this.keywordsByCategory || {}).forEach(([category, keywords]) => {
      keywords.forEach((entry) => {
        if (entry.keyword) {
          map[entry.keyword] = category;
        }
      });
    });
    return map;
  }

  async _handleAddTag() {
    if (!this.details) return;
    const keyword = this.tagInput.trim();
    if (!keyword) return;
    const keywordMap = this._keywordIndex();
    const category = this.tagCategory || keywordMap[keyword] || 'Uncategorized';
    try {
      await addPermatag(this.tenant, this.details.id, keyword, category, 1);
      this.tagInput = '';
      this.tagCategory = '';
      this.dispatchEvent(new CustomEvent('permatags-changed', {
        detail: { imageId: this.details.id },
        bubbles: true,
        composed: true,
      }));
      await this.fetchDetails();
    } catch (error) {
      this.error = 'Failed to add tag.';
      console.error('ImageEditor: add tag failed', error);
    }
  }

  async _handleRemoveTag(tag) {
    if (!this.details) return;
    try {
      await addPermatag(this.tenant, this.details.id, tag.keyword, tag.category, -1);
      this.dispatchEvent(new CustomEvent('permatags-changed', {
        detail: { imageId: this.details.id },
        bubbles: true,
        composed: true,
      }));
      await this.fetchDetails();
    } catch (error) {
      this.error = 'Failed to remove tag.';
      console.error('ImageEditor: remove tag failed', error);
    }
  }

  _formatDateTime(value) {
    if (!value) return 'Unknown';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleString();
  }

  _renderEditTab() {
    const permatags = (this.details?.permatags || []).filter((tag) => tag.signum === 1);
    const categories = Object.keys(this.keywordsByCategory || {}).sort((a, b) => a.localeCompare(b));
    const keywordList = [];
    Object.values(this.keywordsByCategory || {}).forEach((keywords) => {
      keywords.forEach((entry) => {
        if (entry.keyword) {
          keywordList.push(entry.keyword);
        }
      });
    });
    return html`
      <div class="tag-section">
        ${this._renderRatingControl()}
        <div class="right-pane">
          <div class="text-xs font-semibold text-gray-600 uppercase mb-2">Active Tags</div>
          ${permatags.length ? html`
            <div class="tag-list">
              ${permatags.map((tag) => html`
                <span class="tag-chip">
                  <span>${tag.keyword}</span>
                  <button class="tag-remove" title="Remove tag" @click=${() => this._handleRemoveTag(tag)}>❌</button>
                </span>
              `)}
            </div>
          ` : html`<div class="empty-text">No active tags.</div>`}
        </div>
        <div class="right-pane">
          <div class="text-xs font-semibold text-gray-600 uppercase mb-2">Add Tag</div>
          <div class="tag-form">
            <input
              class="tag-input"
              .value=${this.tagInput}
              list="editor-keywords"
              placeholder="Start typing a tag..."
              @input=${(e) => this.tagInput = e.target.value}
            >
            <select class="tag-select" .value=${this.tagCategory} @change=${(e) => this.tagCategory = e.target.value}>
              <option value="">Auto category</option>
              ${categories.map((category) => html`<option value=${category}>${category}</option>`)}
            </select>
            <button class="tag-add" @click=${this._handleAddTag}>Add Tag</button>
          </div>
          <datalist id="editor-keywords">
            ${keywordList.map((keyword) => html`<option value=${keyword}></option>`)}
          </datalist>
        </div>
      </div>
    `;
  }

  _renderTagsReadOnly() {
    const details = this.details;
    if (!details) return html`<div class="empty-text">No tags.</div>`;
    const machineTags = details.machine_tags_by_type || {};
    const machineTypes = Object.keys(machineTags).sort((a, b) => a.localeCompare(b));
    const tabs = ['permatags', ...machineTypes];
    const activeTab = this.tagSubTab;
    return html`
      <div>
        <div class="tab-row">
          ${tabs.map((tab) => {
            const label = tab === 'permatags' ? 'Permatags' : tab.replace(/_/g, ' ');
            return html`
              <button
                class="tab-button ${activeTab === tab ? 'active' : ''}"
                @click=${() => this._setTagSubTab(tab)}
              >
                ${label}
              </button>
            `;
          })}
        </div>
        <div class="mt-3 space-y-2 text-sm text-gray-600">
          ${activeTab === 'permatags'
            ? this._renderPermatagList(details.permatags || [])
            : this._renderMachineTagList(machineTags[activeTab] || [])}
        </div>
      </div>
    `;
  }

  _renderPermatagList(permatags) {
    if (!permatags.length) {
      return html`<div class="empty-text">No permatags.</div>`;
    }
    const sorted = [...permatags].sort((a, b) => {
      if (a.signum !== b.signum) {
        return b.signum - a.signum;
      }
      return String(a.keyword || '').localeCompare(String(b.keyword || ''));
    });
    return html`
      <div class="tag-table">
        <div class="tag-row header">
          <div class="tag-cell">Keyword</div>
          <div class="tag-cell">Sign</div>
          <div class="tag-cell">Created</div>
        </div>
        ${sorted.map((tag) => html`
          <div class="tag-row">
            <div class="tag-cell">${tag.keyword}</div>
            <div class="tag-cell">${tag.signum === 1 ? '＋ positive' : '− negative'}</div>
            <div class="tag-cell">${this._formatDateTime(tag.created_at)}</div>
          </div>
        `)}
      </div>
    `;
  }

  _renderMachineTagList(tags) {
    if (!tags.length) {
      return html`<div class="empty-text">No tags for this model.</div>`;
    }
    const sorted = [...tags].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    return html`
      <div class="tag-table">
        <div class="tag-row header">
          <div class="tag-cell">Keyword</div>
          <div class="tag-cell">Conf</div>
          <div class="tag-cell">Created</div>
        </div>
        ${sorted.map((tag) => html`
          <div class="tag-row">
            <div class="tag-cell">${tag.keyword}</div>
            <div class="tag-cell">${tag.confidence ?? ''}</div>
            <div class="tag-cell">${this._formatDateTime(tag.created_at)}</div>
          </div>
        `)}
      </div>
    `;
  }

  _renderMetadataTab() {
    const details = this.details;
    if (!details) return html`<div class="empty-text">No metadata.</div>`;
    const camera = [details.camera_make, details.camera_model].filter(Boolean).join(' ');
    const gps = (details.gps_latitude !== null && details.gps_longitude !== null)
      ? `${details.gps_latitude}, ${details.gps_longitude}`
      : 'Unknown';
    const exifEntries = Object.entries(details.exif_data || {})
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => a.key.localeCompare(b.key));

    return html`
      <div>
        <div class="metadata-grid">
          <div class="metadata-label">Filename</div>
          <div>${details.filename || 'Unknown'}</div>
          <div class="metadata-label">Dropbox path</div>
          <div>${details.dropbox_path || 'Unknown'}</div>
          <div class="metadata-label">Photo taken</div>
          <div>${this._formatDateTime(details.capture_timestamp)}</div>
          <div class="metadata-label">Dropbox modified</div>
          <div>${this._formatDateTime(details.modified_time)}</div>
          <div class="metadata-label">Ingested</div>
          <div>${this._formatDateTime(details.created_at)}</div>
          <div class="metadata-label">Last review</div>
          <div>${this._formatDateTime(details.reviewed_at)}</div>
          <div class="metadata-label">Dimensions</div>
          <div>${details.width} × ${details.height}</div>
          <div class="metadata-label">Format</div>
          <div>${details.format || 'Unknown'}</div>
          <div class="metadata-label">File size</div>
          <div>${details.file_size || 'Unknown'}</div>
          <div class="metadata-label">Rating</div>
          <div>${details.rating ?? 'Unrated'}</div>
          <div class="metadata-label">Camera</div>
          <div>${camera || 'Unknown'}</div>
          <div class="metadata-label">Lens</div>
          <div>${details.lens_model || 'Unknown'}</div>
          <div class="metadata-label">ISO</div>
          <div>${details.iso || 'Unknown'}</div>
          <div class="metadata-label">Aperture</div>
          <div>${details.aperture ? `f/${details.aperture}` : 'Unknown'}</div>
          <div class="metadata-label">Shutter</div>
          <div>${details.shutter_speed || 'Unknown'}</div>
          <div class="metadata-label">Focal length</div>
          <div>${details.focal_length ? `${details.focal_length}mm` : 'Unknown'}</div>
          <div class="metadata-label">GPS</div>
          <div>${gps}</div>
        </div>
        <div class="mt-3 flex items-center justify-between text-xs text-gray-500">
          <span>Re-download the file and refresh metadata.</span>
          <button
            class="px-2.5 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
            ?disabled=${this.metadataRefreshing}
            @click=${this._handleMetadataRefresh}
          >
            ${this.metadataRefreshing ? 'Refreshing...' : 'Reprocess image'}
          </button>
        </div>
        <div class="exif-block">
          <div class="text-xs font-semibold text-gray-600 uppercase mb-2">EXIF Data</div>
          ${exifEntries.length ? html`
            <div class="exif-list">
              ${exifEntries.map((entry) => html`
                <div>${entry.key}</div>
                <div>${String(entry.value)}</div>
              `)}
            </div>
          ` : html`<div class="empty-text">No EXIF data.</div>`}
        </div>
      </div>
    `;
  }

  _renderRatingControl() {
    if (!this.details) return html``;
    const currentRating = this.details.rating;
    return html`
      <div class="space-y-2">
        <div class="text-xs font-semibold text-gray-600 uppercase">Rating</div>
        <div class="flex flex-wrap items-center gap-2">
          ${[0, 1, 2, 3].map((value) => {
            const isActive = currentRating === value;
            return html`
              <button
                class="inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs ${isActive ? 'bg-yellow-100 text-yellow-800 border-yellow-200' : 'bg-gray-100 text-gray-500 border-gray-200'}"
                title=${`Rating ${value}`}
                ?disabled=${this.ratingSaving}
                @click=${() => this._handleRatingClick(value)}
              >
                <i class="fas fa-star"></i>
                <span>${value}</span>
              </button>
            `;
          })}
          ${this.ratingSaving ? html`<span class="text-xs text-gray-500">Saving...</span>` : ''}
        </div>
        ${this.ratingError ? html`<div class="text-xs text-red-600">${this.ratingError}</div>` : ''}
      </div>
    `;
  }

  _renderImageTab() {
    const ratingControl = this._renderRatingControl();
    if (this.fullImageLoading) {
      return html`
        <div class="space-y-3">
          ${ratingControl}
          <div class="loading-indicator">
            <span class="loading-dot"></span>
            <span>Loading full-size image from Dropbox...</span>
          </div>
        </div>
      `;
    }
    if (this.fullImageError) {
      return html`
        <div class="space-y-3 text-sm text-gray-600">
          ${ratingControl}
          <div class="text-red-600">${this.fullImageError}</div>
          <button class="tag-add" @click=${() => this._loadFullImage()}>Retry</button>
        </div>
      `;
    }
    if (this.fullImageUrl) {
      const dropboxPath = this.details?.dropbox_path;
      const dropboxHref = dropboxPath
        ? `https://www.dropbox.com/home${encodeURIComponent(dropboxPath)}`
        : this.fullImageUrl;
      return html`
        <div class="space-y-3 text-sm text-gray-600">
          ${ratingControl}
          <div>Full-size image loaded from Dropbox.</div>
          <a class="text-blue-600" href=${dropboxHref} target="dropbox" rel="noopener noreferrer">Open in new tab</a>
        </div>
      `;
    }
    return html`
      <div class="space-y-3 text-sm text-gray-600">
        ${ratingControl}
        <div class="empty-text">Select the Image tab to load the full-size file.</div>
      </div>
    `;
  }

  _renderContent() {
    if (this.loading) {
      return html`
        <div class="panel-body">
          <div class="image-wrap">
            <div class="skeleton-block skeleton-image"></div>
          </div>
          <div class="skeleton-stack">
            <div class="loading-indicator">
              <span class="loading-dot"></span>
              <span>Loading image data…</span>
            </div>
            <div class="skeleton-line skeleton-block" style="width: 120px;"></div>
            <div class="skeleton-line skeleton-block" style="width: 180px;"></div>
            <div class="skeleton-line skeleton-block sm" style="width: 90%;"></div>
            <div class="skeleton-line skeleton-block sm" style="width: 75%;"></div>
            <div class="skeleton-line skeleton-block sm" style="width: 60%;"></div>
          </div>
        </div>
      `;
    }
    if (this.error) {
      return html`<div class="empty-text">${this.error}</div>`;
    }
    if (!this.details) {
      return html`<div class="empty-text">Select an image.</div>`;
    }
    const showFullImage = this.activeTab === 'image' && this.fullImageUrl;
    const imageSrc = showFullImage
      ? this.fullImageUrl
      : (this.details.thumbnail_url || `/api/v1/images/${this.details.id}/thumbnail`);
    return html`
      <div class="panel-body">
        <div class="image-wrap ${this.activeTab === 'image' ? 'image-full' : ''}">
          <img src="${imageSrc}" alt="${this.details.filename}">
        </div>
        <div>
          <div class="tab-row">
            <button class="tab-button ${this.activeTab === 'edit' ? 'active' : ''}" @click=${() => this._setTab('edit')}>
              Edit
            </button>
            <button class="tab-button ${this.activeTab === 'image' ? 'active' : ''}" @click=${() => this._setTab('image')}>
              Image
            </button>
            <button class="tab-button ${this.activeTab === 'metadata' ? 'active' : ''}" @click=${() => this._setTab('metadata')}>
              Metadata
            </button>
            <button class="tab-button ${this.activeTab === 'tags' ? 'active' : ''}" @click=${() => this._setTab('tags')}>
              Tags
            </button>
          </div>
          <div class="mt-3">
            ${this.activeTab === 'image'
              ? this._renderImageTab()
              : this.activeTab === 'metadata'
              ? this._renderMetadataTab()
              : this.activeTab === 'tags'
                ? this._renderTagsReadOnly()
                : this._renderEditTab()}
          </div>
        </div>
      </div>
    `;
  }

  render() {
    if (!this.image) {
      return html``;
    }
    if (this.embedded) {
      return html`
        <div class="panel embedded">
          <div class="panel-header">
            <div class="panel-title">${this.image.filename}</div>
          </div>
          ${this._renderContent()}
        </div>
      `;
    }

    return html`
      <div class="modal ${this.open ? 'open' : ''}" @click=${this._close}>
        <div class="panel" @click=${(e) => e.stopPropagation()}>
          <div class="panel-header">
            <div class="panel-title">${this.image.filename}</div>
            <button class="panel-close" @click=${this._close}>&times;</button>
          </div>
          ${this._renderContent()}
        </div>
      </div>
    `;
  }
}

customElements.define('image-editor', ImageEditor);
