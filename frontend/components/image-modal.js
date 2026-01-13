import { LitElement, html, css } from 'lit';
import { getImageDetails } from '../services/api.js';
import { tailwind } from './tailwind-lit.js';

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
        max-width: 1024px;
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
  };

  constructor() {
    super();
    this.active = false;
    this.details = null;
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
            </div>
            <div>
                ${this.details ? this._renderDetails() : html`<p>Loading...</p>`}
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
                <div><strong>Path:</strong> ${this.details.dropbox_path}</div>
            </div>
        </div>
        <div class="mt-4">
            <h3 class="font-semibold text-gray-700 mb-2">Tags</h3>
            <div class="flex flex-wrap gap-2">
                ${this.details.tags.map(tag => html`<span class="inline-block bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs">${tag.keyword}</span>`)}
            </div>
        </div>
    `;
  }

  _closeModal() {
    this.active = false;
    this.details = null;
    this.dispatchEvent(new CustomEvent('close'));
  }
}

customElements.define('image-modal', ImageModal);