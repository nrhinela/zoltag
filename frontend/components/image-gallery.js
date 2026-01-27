import { LitElement, html, css } from 'lit';
import './image-card.js';
import { getImages } from '../services/api.js';
import { tailwind } from './tailwind-lit.js';

class ImageGallery extends LitElement {
  static styles = [tailwind, css`
    :host {
      display: block;
    }
  `];

  static properties = {
    images: { type: Array },
    filters: { type: Object },
    tenant: { type: String },
    activeListName: { type: String },
    activeListItemIds: { type: Object },
    keywords: { type: Array },
    totalCount: { type: Number },
    displayMode: { type: String },
  };
  
  constructor() {
    super();
    this.images = [];
    this.filters = {};
    this.activeListName = '';
    this.activeListItemIds = new Set();
    this.keywords = [];
    this.totalCount = 0;
    this.displayMode = 'grid';
    this._fetchScheduled = false;
  }

  willUpdate(changedProperties) {
    if (changedProperties.has('filters') || changedProperties.has('tenant')) {
      // Debounce multiple property changes in the same update cycle
      if (!this._fetchScheduled) {
        this._fetchScheduled = true;
        queueMicrotask(() => {
          this._fetchScheduled = false;
          this.fetchImages();
        });
      }
    }
  }

  async fetchImages() {
    if (!this.tenant) return;
    try {
      const result = await getImages(this.tenant, this.filters);
      if (Array.isArray(result)) {
        this.images = result;
        this.totalCount = result.length;
      } else {
        this.images = result.images || [];
        this.totalCount = result.total ?? this.images.length;
      }
    } catch (error) {
      console.error('Error fetching images:', error);
    }
  }

  applyRatingUpdate(imageId, rating, hideZero) {
    const index = this.images.findIndex((image) => image.id === imageId);
    if (index === -1) return;
    if (hideZero && rating === 0) {
      this.images = this.images.filter((image) => image.id !== imageId);
      this.totalCount = Math.max(0, this.totalCount - 1);
      return;
    }
    const updated = { ...this.images[index], rating };
    this.images = [
      ...this.images.slice(0, index),
      updated,
      ...this.images.slice(index + 1),
    ];
    this.requestUpdate();
  }

  render() {
    return html`
      <div class="text-xs text-gray-500 mb-2">Showing ${this.totalCount} item${this.totalCount === 1 ? '' : 's'}</div>
      ${this.displayMode === 'list' ? html`
        <div class="divide-y divide-gray-200">
          ${this.images.map((image) => html`
            <image-card
              .image=${image}
              .tenant=${this.tenant}
              .activeListName=${this.activeListName}
              .isInActiveList=${this.activeListItemIds.has(image.id)}
              .keywords=${this.keywords}
              .listMode=${true}
            ></image-card>
          `)}
        </div>
      ` : html`
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          ${this.images.map((image) => html`
            <image-card
              .image=${image}
              .tenant=${this.tenant}
              .activeListName=${this.activeListName}
              .isInActiveList=${this.activeListItemIds.has(image.id)}
              .keywords=${this.keywords}
            ></image-card>
          `)}
        </div>
      `}
    `;
  }
}

customElements.define('image-gallery', ImageGallery);
