import { LitElement, html, css } from 'lit';
import { setRating, addToList, retagImage } from '../services/api.js';
import { tailwind } from './tailwind-lit.js';

class ImageCard extends LitElement {
  static styles = [tailwind, css`
    .image-card {
      transition: transform 0.2s;
      cursor: pointer;
    }
    .image-card:hover {
      transform: scale(1.02);
    }
    .image-card .fa-star {
      color: #fbbf24; /* text-yellow-400 */
    }
  `];

  static properties = {
    image: { type: Object },
    tenant: { type: String },
  };

  constructor() {
    super();
    this.image = {};
  }

  _handleRetag(e) {
    e.stopPropagation();
    try {
        retagImage(this.tenant, this.image.id);
        // Maybe show a notification?
    } catch (error) {
        console.error('Failed to retag image:', error);
    }
  }

  async _handleAddToList(e) {
    e.stopPropagation();
    try {
        await addToList(this.tenant, this.image.id);
        // Maybe show a notification?
    } catch (error) {
        console.error('Failed to add to list:', error);
    }
  }

  async _handleRating(e, rating) {
    e.stopPropagation();
    try {
        const updatedImage = await setRating(this.tenant, this.image.id, rating);
        this.image = { ...this.image, rating: updatedImage.rating };
    } catch (error) {
        console.error('Failed to set rating:', error);
    }
  }
  
  _handleCardClick() {
      this.dispatchEvent(new CustomEvent('image-selected', { detail: this.image, bubbles: true, composed: true }));
  }

  render() {
    if (!this.image.id) {
      return html`<div>Loading...</div>`;
    }

    const tagsHTML = this._renderTags();

    return html`
      <div class="image-card bg-white rounded-lg shadow overflow-hidden" @click=${this._handleCardClick}>
        <div class="aspect-square bg-gray-200 relative">
          <img
            src="${this.image.thumbnail_url || `/api/v1/images/${this.image.id}/thumbnail`}"
            alt="${this.image.filename}"
            class="w-full h-full object-cover"
            loading="lazy"
            onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 400%22%3E%3Crect fill=%22%23ddd%22 width=%22400%22 height=%22400%22/%3E%3Ctext fill=%22%23999%22 x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22%3ENo Image%3C/text%3E%3C/svg%3E';"
          />
          <a
            href="https://www.dropbox.com/home${encodeURIComponent(this.image.dropbox_path)}"
            target="dropbox"
            @click=${(e) => e.stopPropagation()}
            class="absolute top-2 left-2 bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-full shadow-lg transition-colors"
            title="Open in Dropbox"
          >
            <i class="fab fa-dropbox"></i>
          </a>
          <button
            @click=${this._handleRetag}
            class="absolute bottom-2 right-2 bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 rounded shadow-lg transition-colors text-xs"
            title="Reprocess this image with current keywords"
          >
            <i class="fas fa-sync-alt"></i> Retag
          </button>
          <button
            @click=${this._handleAddToList}
            class="absolute bottom-2 left-2 bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded shadow-lg transition-colors text-xs"
            title="Add to List"
          >
            <i class="fas fa-list"></i> Add to List
          </button>
          ${this.image.tags_applied ? html`<div class="absolute top-2 right-2 bg-green-500 text-white px-2 py-1 rounded text-xs"><i class="fas fa-tag"></i></div>` : ''}
        </div>
        <div class="p-3">
          <p class="font-semibold text-gray-800 truncate">${this.image.filename}</p>
          <p class="text-sm text-gray-500">${this.image.width} × ${this.image.height}</p>
          <p class="text-xs text-gray-400">
            <i class="far fa-clock"></i> ${this.image.modified_time ? new Date(this.image.modified_time).toLocaleDateString() : 'Unknown'}
          </p>
          ${this.image.capture_timestamp ? html`<p class="text-xs text-gray-400"><i class="far fa-calendar"></i> Photo: ${new Date(this.image.capture_timestamp).toLocaleDateString()}</p>` : ''}
          ${this.image.camera_model ? html`<p class="text-xs text-gray-400 truncate">${this.image.camera_model}</p>` : ''}
          <div class="flex items-center mt-2 mb-1">
            <span class="mr-2 text-xs text-gray-500">Rating:</span>
            <span class="star-rating" data-image-id="${this.image.id}">
              ${[1, 2, 3].map((star) => html`
                <i
                  class="fa${this.image.rating && this.image.rating >= star ? 's' : 'r'} fa-star cursor-pointer mx-0.5"
                  data-star="${star}"
                  title="${star} star${star > 1 ? 's' : ''}"
                  @click=${(e) => this._handleRating(e, star)}
                ></i>
              `)}
            </span>
          </div>
          ${tagsHTML}
        </div>
      </div>
    `;
  }

  _renderTags() {
    // This logic is complex and will be implemented later.
    return html``;
  }
}

customElements.define('image-card', ImageCard);
