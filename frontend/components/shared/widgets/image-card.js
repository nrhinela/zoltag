import { LitElement, html, css } from 'lit';
import { enqueueCommand } from '../../../services/command-queue.js';
import { tailwind } from '../../tailwind-lit.js';

class ImageCard extends LitElement {
  static styles = [tailwind, css`
    .image-card {
      transition: transform 0.2s;
      overflow: visible;
    }
    .image-card:hover {
      transform: scale(1.02);
    }
    .image-card .fa-star {
      color: #fbbf24; /* text-yellow-400 */
    }
    .image-link {
      cursor: pointer;
    }
    .image-hover {
      position: relative;
    }
    .image-hover img {
      border-radius: 12px 12px 0 0;
    }
    .thumb-rating {
      position: absolute;
      right: 8px;
      bottom: 8px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: rgba(17, 24, 39, 0.85);
      color: #f9fafb;
      padding: 6px 8px;
      border-radius: 999px;
      opacity: 0;
      transform: translateY(4px);
      transition: opacity 0.15s ease, transform 0.15s ease;
      pointer-events: none;
      z-index: 12;
    }
    .thumb-rating button {
      font-size: 14px;
      line-height: 1;
    }
    .image-hover:hover .thumb-rating {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }
    .hover-label {
      color: #d1d5db;
      font-weight: 600;
      margin-right: 4px;
    }
    .hover-line {
      display: block;
      white-space: normal;
      overflow: visible;
      word-break: break-word;
    }
  `];

  static properties = {
    image: { type: Object },
    tenant: { type: String },
    showAddToList: { type: Boolean },
    activeListName: { type: String },
    isInActiveList: { type: Boolean },
    isRetagging: { type: Boolean },
    keywords: { type: Array },
    listMode: { type: Boolean },
    metadataOpen: { type: Boolean },
  };

  constructor() {
    super();
    this.image = {};
    this.showAddToList = true;
    this.activeListName = '';
    this.isInActiveList = false;
    this.isRetagging = false;
    this.keywords = [];
    this.listMode = false;
    this.metadataOpen = false;
    this._handleQueueComplete = (event) => {
      const detail = event?.detail;
      if (detail?.type === 'retag' && detail.imageId === this.image.id) {
        this.isRetagging = false;
      }
    };
    this._handleQueueFailed = (event) => {
      const detail = event?.detail;
      if (detail?.type === 'retag' && detail.imageId === this.image.id) {
        this.isRetagging = false;
      }
    };
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('queue-command-complete', this._handleQueueComplete);
    window.addEventListener('queue-command-failed', this._handleQueueFailed);
  }

  disconnectedCallback() {
    window.removeEventListener('queue-command-complete', this._handleQueueComplete);
    window.removeEventListener('queue-command-failed', this._handleQueueFailed);
    super.disconnectedCallback();
  }

  updated(changedProperties) {
    if (changedProperties.has('image')) {
      const previousImage = changedProperties.get('image');
      if (previousImage?.id !== this.image?.id) {
        this.metadataOpen = false;
      }
    }
  }

  _handleRetag(e) {
    e.stopPropagation();
    this.isRetagging = true;
    enqueueCommand({
      type: 'retag',
      tenantId: this.tenant,
      imageId: this.image.id,
    });
  }

  _handleAddToList(e) {
    e.stopPropagation();
    enqueueCommand({
      type: 'add-to-list',
      tenantId: this.tenant,
      imageId: this.image.id,
    });
    this.isInActiveList = true;
    this.dispatchEvent(new CustomEvent('list-item-added', {
      detail: { photoId: this.image.id },
      bubbles: true,
      composed: true,
    }));
  }

  _handleRemoveTag(e, tag) {
    e.stopPropagation();
    enqueueCommand({
      type: 'add-negative-permatag',
      tenantId: this.tenant,
      imageId: this.image.id,
      keyword: tag.keyword,
      category: tag.category,
    });
    this.image = {
      ...this.image,
      calculated_tags: (this.image.calculated_tags || []).filter(
        (item) => item.keyword !== tag.keyword
      ),
    };
    window.dispatchEvent(new CustomEvent('permatags-changed', {
      detail: { imageId: this.image.id }
    }));
  }

  _handleAddTag(e) {
    e.stopPropagation();
    const input = this.shadowRoot.getElementById(`add-tag-${this.image.id}`);
    const value = input ? input.value.trim() : '';
    if (!value) return;
    const keywordEntry = this.keywords.find((kw) => kw.keyword === value);
    if (!keywordEntry) {
      return;
    }
    enqueueCommand({
      type: 'add-positive-permatag',
      tenantId: this.tenant,
      imageId: this.image.id,
      keyword: value,
      category: keywordEntry.category,
    });
    if (input) input.value = '';
    window.dispatchEvent(new CustomEvent('permatags-changed', {
      detail: { imageId: this.image.id }
    }));
  }

  _handleRating(e, rating) {
    e.stopPropagation();
    this.image = { ...this.image, rating };
    enqueueCommand({
      type: 'set-rating',
      tenantId: this.tenant,
      imageId: this.image.id,
      rating,
    });
    this.dispatchEvent(new CustomEvent('image-rating-updated', {
      detail: { imageId: this.image.id, rating },
      bubbles: true,
      composed: true,
    }));
  }

  _renderThumbRating() {
    return html`
      <div class="thumb-rating" @click=${(e) => e.stopPropagation()}>
        <button
          type="button"
          class="cursor-pointer mx-0.5 ${this.image.rating == 0 ? 'text-gray-200' : 'text-gray-300 hover:text-gray-100'}"
          title="0 stars"
          @click=${(e) => this._handleRating(e, 0)}
        >
          ${this.image.rating == 0 ? '❌' : '🗑'}
        </button>
        ${[1, 2, 3].map((star) => html`
          <button
            type="button"
            class="cursor-pointer mx-0.5 ${this.image.rating && this.image.rating >= star ? 'text-yellow-300' : 'text-gray-400 hover:text-gray-200'}"
            title="${star} star${star > 1 ? 's' : ''}"
            @click=${(e) => this._handleRating(e, star)}
          >
            ${this.image.rating && this.image.rating >= star ? '★' : '☆'}
          </button>
        `)}
      </div>
    `;
  }

  _handleCardClick() {
      this.dispatchEvent(new CustomEvent('image-selected', { detail: this.image, bubbles: true, composed: true }));
  }

  _renderTagText(tags) {
    if (!tags || tags.length === 0) {
      return html`<span class="text-xs text-gray-500">No tags yet.</span>`;
    }
    const sortedTags = [...tags].sort((a, b) => a.keyword.localeCompare(b.keyword));
    return html`
      <span class="inline-flex flex-wrap items-center gap-1 flex-1 min-w-0">
        ${sortedTags.map(tag => html`
          <span class="inline-flex items-center gap-1 bg-gray-100 text-gray-700 px-2 py-1 rounded text-sm">
            ${tag.keyword}
            <button
              type="button"
              class="text-red-600 hover:text-red-700 text-base leading-none"
              title="Remove tag"
              @click=${(e) => this._handleRemoveTag(e, tag)}
            >
              ❌
            </button>
          </span>
        `)}
      </span>
    `;
  }

  _renderTagChips(tags) {
    if (!tags || tags.length === 0) {
      return html`<span class="text-xs text-gray-500">No tags yet.</span>`;
    }
    const sortedTags = [...tags].sort((a, b) => a.keyword.localeCompare(b.keyword));
    return html`
      <div class="flex flex-wrap items-center gap-2">
        ${sortedTags.map(tag => html`
          <span class="inline-flex items-center gap-2 bg-blue-100 text-blue-700 px-2 py-1 rounded-full text-xs">
            ${tag.keyword}
          </span>
        `)}
      </div>
    `;
  }

  _formatDropboxPath(path) {
    if (!path) return '';
    return path.replace(/_/g, '_\u200b');
  }

  _formatDateTime(value) {
    if (!value) return 'Unknown';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleString();
  }

  _formatRating(value) {
    if (value === null || value === undefined || value === '') {
      return 'Unrated';
    }
    return String(value);
  }

  _handleMetadataToggle(event) {
    this.metadataOpen = event.target.open;
  }

  _renderMetadataAccordion() {
    const camera = [this.image.camera_make, this.image.camera_model].filter(Boolean).join(' ');
    const gpsLat = this.image.gps_latitude;
    const gpsLon = this.image.gps_longitude;
    const metadataRows = [
      { label: 'Photo taken', value: this._formatDateTime(this.image.capture_timestamp) },
      { label: 'Dropbox modified', value: this._formatDateTime(this.image.modified_time) },
      { label: 'Ingested', value: this._formatDateTime(this.image.created_at) },
      { label: 'Camera', value: camera || null },
      { label: 'Lens', value: this.image.lens_model },
      { label: 'ISO', value: this.image.iso },
      { label: 'Aperture', value: this.image.aperture ? `f/${this.image.aperture}` : null },
      { label: 'Shutter', value: this.image.shutter_speed },
      { label: 'Focal length', value: this.image.focal_length ? `${this.image.focal_length}mm` : null },
      { label: 'GPS', value: (gpsLat !== null && gpsLat !== undefined && gpsLon !== null && gpsLon !== undefined)
        ? `${gpsLat}, ${gpsLon}`
        : null },
      { label: 'Dimensions', value: (this.image.width && this.image.height)
        ? `${this.image.width} × ${this.image.height}`
        : null },
      { label: 'Format', value: this.image.format },
    ];

    const rows = metadataRows.filter((row, index) => {
      if (index < 3) {
        return true;
      }
      return row.value !== null && row.value !== undefined && row.value !== '';
    });

    return html`
      <details
        class="mt-2 text-xs text-gray-600"
        ?open=${this.metadataOpen}
        @toggle=${this._handleMetadataToggle}
      >
        <summary class="cursor-pointer font-semibold text-gray-700">Metadata</summary>
        <div class="mt-2 space-y-1">
          ${rows.map((row) => html`
            <div class="flex justify-between gap-3">
              <span class="font-medium text-gray-600">${row.label}:</span>
              <span class="text-right text-gray-700">${row.value}</span>
            </div>
          `)}
        </div>
      </details>
    `;
  }

  render() {
    if (!this.image.id) {
      return html`<div>Loading...</div>`;
    }

    if (this.listMode) {
      return this._renderListMode();
    }

    const tagsText = this._renderTagText(this.image.calculated_tags);
    const dropboxPath = this.image.dropbox_path || '';
    const dropboxHref = dropboxPath
      ? `https://www.dropbox.com/home${encodeURIComponent(dropboxPath)}`
      : '';
    const formattedPath = this._formatDropboxPath(dropboxPath);
    const photoCreatedAt = this.image.capture_timestamp ? this._formatDateTime(this.image.capture_timestamp) : null;
    const listName = this.activeListName || 'None';
    const canAddToList = !!this.activeListName && this.showAddToList;
    const addLabel = this.isInActiveList ? 'Added' : 'Add';

    return html`
      <div class="image-card bg-white rounded-lg shadow overflow-hidden">
        <div class="aspect-square bg-gray-200 image-link image-hover flex items-center justify-center" @click=${this._handleCardClick}>
          <img
            src="${this.image.thumbnail_url || `/api/v1/images/${this.image.id}/thumbnail`}"
            alt="${this.image.filename}"
            class="block max-w-full max-h-full"
            loading="lazy"
            onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 400%22%3E%3Crect fill=%22%23ddd%22 width=%22400%22 height=%22400%22/%3E%3Ctext fill=%22%23999%22 x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22%3ENo Image%3C/text%3E%3C/svg%3E';"
          />
          ${this.image.tags_applied ? html`<div class="absolute top-2 right-2 bg-green-500 text-white px-2 py-1 rounded text-xs"><i class="fas fa-tag"></i></div>` : ''}
          ${this._renderThumbRating()}
        </div>
        <div class="p-3 text-sm text-gray-700 space-y-2">
          ${photoCreatedAt ? html`
            <div>
              <span class="font-semibold text-gray-700">photo created:</span>
              <span class="ml-1">${photoCreatedAt}</span>
            </div>
          ` : html``}
          <div>
            <span class="font-semibold text-gray-700">file:</span>
            ${dropboxHref ? html`
              <a
                href=${dropboxHref}
                target="dropbox"
                class="ml-1 text-blue-600 hover:text-blue-700 break-all whitespace-normal"
                @click=${(e) => e.stopPropagation()}
                title=${dropboxPath}
              >
                ${formattedPath}
              </a>
            ` : html`<span class="ml-1 text-gray-400">Unknown</span>`}
          </div>
          <div>
            <span class="font-semibold text-gray-700">last review:</span>
            <span class="ml-1">
              ${this.image.reviewed_at ? new Date(this.image.reviewed_at).toLocaleDateString() : 'Unreviewed'}
            </span>
          </div>
          ${this._renderMetadataAccordion()}
          <div>
            <span class="font-semibold text-gray-700">list [${listName}]:</span>
            ${this.showAddToList ? html`
              <button
                type="button"
                class="ml-1 ${this.isInActiveList ? 'text-gray-500' : 'text-green-700 hover:text-green-800'}"
                @click=${this._handleAddToList}
                ?disabled=${!canAddToList || this.isInActiveList}
              >
                ${addLabel}
              </button>
            ` : html`<span class="ml-1 text-gray-400">Unavailable</span>`}
          </div>
          <div class="flex items-center">
            <span class="font-semibold text-gray-700 mr-1">rating:</span>
            <span class="star-rating" data-image-id="${this.image.id}">
              <button
                type="button"
                class="cursor-pointer mx-0.5 ${this.image.rating == 0 ? 'text-gray-700' : 'text-gray-600 hover:text-gray-800'}"
                title="0 stars"
                @click=${(e) => this._handleRating(e, 0)}
              >
                ${this.image.rating == 0 ? '❌' : '🗑'}
              </button>
              ${[1, 2, 3].map((star) => html`
                <button
                  type="button"
                  class="cursor-pointer mx-0.5 text-yellow-500 hover:text-yellow-600"
                  title="${star} star${star > 1 ? 's' : ''}"
                  @click=${(e) => this._handleRating(e, star)}
                >
                  ${this.image.rating && this.image.rating >= star ? '★' : '☆'}
                </button>
              `)}
            </span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-semibold text-gray-700">tags:</span>
            <button
              type="button"
              class="text-purple-600 hover:text-purple-700 text-sm"
              @click=${this._handleRetag}
              title="Retag"
            >
              ${this.isRetagging ? '⟳' : '↻'}
            </button>
            ${tagsText}
          </div>
          <div class="flex items-center gap-2">
            <label class="text-xs font-semibold text-gray-700" for="add-tag-${this.image.id}">Add tag:</label>
            <input
              id="add-tag-${this.image.id}"
              list="keyword-list"
              class="flex-1 min-w-[120px] border rounded px-2 py-1 text-xs"
              type="text"
              placeholder="Start typing..."
              @click=${(e) => e.stopPropagation()}
            >
            <button
              type="button"
              class="text-xs text-blue-600 hover:text-blue-700"
              @click=${this._handleAddTag}
            >
              Add
            </button>
          </div>
        </div>
      </div>
      <datalist id="keyword-list">
        ${this.keywords.map((kw) => html`<option value=${kw.keyword}></option>`)}
      </datalist>
    `;
  }

  _renderListMode() {
    const dropboxPath = this.image.dropbox_path || '';
    const dropboxHref = dropboxPath
      ? `https://www.dropbox.com/home${encodeURIComponent(dropboxPath)}`
      : '';
    const photoCreatedAt = this.image.capture_timestamp ? this._formatDateTime(this.image.capture_timestamp) : null;
    const listName = this.activeListName || 'None';
    const canAddToList = !!this.activeListName && this.showAddToList;
    const addLabel = this.isInActiveList ? 'Added' : `Add to list: ${listName}`;
    const tagsChips = this._renderTagChips(this.image.calculated_tags);

    return html`
      <div class="flex items-center gap-4 py-4">
        <div class="w-20 h-20 flex-shrink-0 image-hover">
          <img
            src="${this.image.thumbnail_url || `/api/v1/images/${this.image.id}/thumbnail`}"
            alt="${this.image.filename}"
            class="w-20 h-20 object-cover rounded"
            loading="lazy"
            @click=${this._handleCardClick}
          />
          ${this._renderThumbRating()}
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-semibold text-gray-800 truncate">${this.image.filename}</div>
          ${photoCreatedAt ? html`
            <div class="text-xs text-gray-500">photo created: ${photoCreatedAt}</div>
          ` : html``}
          ${dropboxHref ? html`
            <a
              href=${dropboxHref}
              target="dropbox"
              class="text-xs text-gray-500 hover:text-gray-700 break-all"
              @click=${(e) => e.stopPropagation()}
              title=${dropboxPath}
            >
              ${this._formatDropboxPath(dropboxPath)}
            </a>
          ` : html``}
          <div class="mt-2">
            ${tagsChips}
          </div>
        </div>
        <div class="flex flex-col items-end gap-2">
          ${this.showAddToList ? html`
            <button
              type="button"
              class="px-3 py-1 rounded bg-green-600 text-white text-xs hover:bg-green-700"
              @click=${this._handleAddToList}
              ?disabled=${!canAddToList || this.isInActiveList}
            >
              ${addLabel}
            </button>
          ` : html``}
        </div>
      </div>
    `;
  }

}

customElements.define('image-card', ImageCard);
