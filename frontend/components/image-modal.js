import { LitElement, html, css } from 'lit';
import { getImageDetails, refreshImageMetadata } from '../services/api.js';
import { tailwind } from './tailwind-lit.js';
import './permatag-editor.js';

class ImageModal extends LitElement {
  static styles = [tailwind, css`
    .modal {
        display: none;
        position: fixed;
        z-index: 50;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        overflow: auto;
        background-color: rgba(0,0,0,0.75);
    }
    .modal.active {
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .modal-content {
        background-color: #fefefe;
        margin: auto;
        padding: 20px;
        border: 1px solid #888;
        width: 80%;
        max-width: 1280px;
        border-radius: 0.5rem;
    }
    .close {
        color: #aaaaaa;
        float: right;
        font-size: 28px;
        font-weight: bold;
    }
    .close:hover,
    .close:focus {
        color: #000;
        text-decoration: none;
        cursor: pointer;
    }
  `];

  static properties = {
    image: { type: Object },
    details: { type: Object },
    active: { type: Boolean, reflect: true },
    tenant: { type: String },
    metadataOpen: { type: Boolean },
    isRefreshingMetadata: { type: Boolean },
  };

  constructor() {
    super();
    this.active = false;
    this.details = null;
    this.metadataOpen = false;
    this.isRefreshingMetadata = false;
    this._handlePermatagEvent = (event) => {
      if (this.active && event?.detail?.imageId === this.image?.id) {
        this.fetchDetails();
      }
    };
    this._handleRetagEvent = (event) => {
      if (this.active && event?.detail?.imageId === this.image?.id) {
        this.fetchDetails();
      }
    };
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('permatags-changed', this._handlePermatagEvent);
    window.addEventListener('image-retagged', this._handleRetagEvent);
  }

  disconnectedCallback() {
    window.removeEventListener('permatags-changed', this._handlePermatagEvent);
    window.removeEventListener('image-retagged', this._handleRetagEvent);
    super.disconnectedCallback();
  }

  updated(changedProperties) {
    if (changedProperties.has('image')) {
      const previousImage = changedProperties.get('image');
      if (previousImage?.id !== this.image?.id) {
        this.metadataOpen = false;
      }
    }
    if (changedProperties.has('active') && !this.active) {
      this.metadataOpen = false;
    }
  }

  willUpdate(changedProperties) {
    if (changedProperties.has('active') && this.active) {
      this.fetchDetails();
    }
  }
  async fetchDetails() {
      if (!this.image) return;
      try {
          this.details = await getImageDetails(this.tenant, this.image.id);
      } catch (error) {
          console.error('Failed to fetch image details:', error);
      }
  }

  async _handleMetadataRefresh(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.image || this.isRefreshingMetadata) return;
    this.isRefreshingMetadata = true;
    try {
      await refreshImageMetadata(this.tenant, this.image.id);
      await this.fetchDetails();
    } catch (error) {
      console.error('Failed to refresh metadata:', error);
    } finally {
      this.isRefreshingMetadata = false;
    }
  }

  render() {
    if (!this.image) {
      return html``;
    }
    const modalClass = `modal${this.active ? ' active' : ''}`;
    return html`
      <div class="${modalClass}" @click=${this._closeModal}>
        <div class="modal-content" @click=${e => e.stopPropagation()}>
          <span class="close" @click=${this._closeModal}>&times;</span>
          <h2 class="text-2xl font-bold text-gray-800">${this.image.filename}</h2>
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-4">
            <div class="lg:col-span-2">
                <img src="${this.image.thumbnail_url || `/api/v1/images/${this.image.id}/thumbnail`}" alt="${this.image.filename}" class="w-full rounded-lg shadow-lg">
                <permatag-editor .tenant=${this.tenant} .imageId=${this.image.id} mode="grid"></permatag-editor>
            </div>
            <div>
                ${this.details ? this._renderDetails() : html`<p>Loading...</p>`}
                <permatag-editor .tenant=${this.tenant} .imageId=${this.image.id} mode="side"></permatag-editor>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _renderDetails() {
    return html`
        <div>
            <h3 class="font-semibold text-gray-700 mb-2">Details</h3>
            <div class="text-sm text-gray-600 space-y-1">
                <div><strong>Size:</strong> ${this.details.width} × ${this.details.height}</div>
                <div><strong>Format:</strong> ${this.details.format || 'Unknown'}</div>
                <div><strong>File Size:</strong> ${this.details.file_size}</div>
                <div>
                  <strong>Path:</strong>
                  ${this._renderDropboxLink(this.details.dropbox_path)}
                </div>
                <div><strong>Last Review:</strong> ${this.details.reviewed_at ? new Date(this.details.reviewed_at).toLocaleString() : 'Unreviewed'}</div>
            </div>
            ${this._renderMetadataAccordion()}
        </div>
        <div class="mt-4">
            <h3 class="font-semibold text-gray-700 mb-2">Active Tags</h3>
            <div class="flex flex-wrap gap-2">
                ${[...this.details.calculated_tags]
                  .sort((a, b) => a.keyword.localeCompare(b.keyword))
                  .map(tag => html`<span class="inline-block bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs">${tag.keyword}</span>`)}
            </div>
        </div>
    `;
  }

  _formatDateTime(value) {
    if (!value) return 'Unknown';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleString();
  }

  _handleMetadataToggle(event) {
    this.metadataOpen = event.target.open;
  }

  _renderMetadataAccordion() {
    const camera = [this.details.camera_make, this.details.camera_model].filter(Boolean).join(' ');
    const gpsLat = this.details.gps_latitude;
    const gpsLon = this.details.gps_longitude;
    const metadataRows = [
      { label: 'Photo taken', value: this._formatDateTime(this.details.capture_timestamp) },
      { label: 'Dropbox modified', value: this._formatDateTime(this.details.modified_time) },
      { label: 'Ingested', value: this._formatDateTime(this.details.created_at) },
      { label: 'Camera', value: camera || null },
      { label: 'Lens', value: this.details.lens_model },
      { label: 'ISO', value: this.details.iso },
      { label: 'Aperture', value: this.details.aperture ? `f/${this.details.aperture}` : null },
      { label: 'Shutter', value: this.details.shutter_speed },
      { label: 'Focal length', value: this.details.focal_length ? `${this.details.focal_length}mm` : null },
      { label: 'GPS', value: (gpsLat !== null && gpsLat !== undefined && gpsLon !== null && gpsLon !== undefined)
        ? `${gpsLat}, ${gpsLon}`
        : null },
    ];

    const rows = metadataRows.filter((row, index) => {
      if (index < 3) {
        return true;
      }
      return row.value !== null && row.value !== undefined && row.value !== '';
    });

    return html`
      <details
        class="mt-3 text-sm text-gray-600"
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
        <div class="mt-3 flex items-center justify-between text-xs text-gray-500">
          <span>Re-download the file and refresh metadata.</span>
          <button
            class="px-2.5 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
            ?disabled=${this.isRefreshingMetadata}
            @click=${this._handleMetadataRefresh}
          >
            ${this.isRefreshingMetadata ? 'Refreshing...' : 'Reprocess image'}
          </button>
        </div>
      </details>
    `;
  }

  _renderDropboxLink(dropboxPath) {
    if (!dropboxPath) {
      return html`<span class="ml-1 text-gray-400">Unknown</span>`;
    }
    const trimmed = dropboxPath.startsWith('/') ? dropboxPath.slice(1) : dropboxPath;
    const dropboxHref = `https://www.dropbox.com/home/${trimmed}`;
    const formattedPath = dropboxPath.replace(/_/g, '_\u200b');
    return html`
      <a
        href=${dropboxHref}
        target="dropbox"
        class="ml-1 text-blue-600 hover:text-blue-700 break-all whitespace-normal"
        @click=${(e) => e.stopPropagation()}
        title=${dropboxPath}
      >
        ${formattedPath}
      </a>
    `;
  }

  _closeModal() {
    this.active = false;
    this.details = null;
    this.dispatchEvent(new CustomEvent('close'));
  }
}

customElements.define('image-modal', ImageModal);
