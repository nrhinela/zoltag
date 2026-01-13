import { LitElement, html, css } from 'lit';
import './app-header.js';
import './image-gallery.js';
import './filter-controls.js';
import './image-modal.js';
import './upload-modal.js';

import { tailwind } from './tailwind-lit.js';

class PhotoCatApp extends LitElement {
  static styles = [tailwind, css`
    :host {
      display: block;
    }
    .container {
        max-width: 1280px;
        margin: 0 auto;
        padding: 16px;
    }
  `];

  static properties = {
      filters: { type: Object },
      tenant: { type: String },
      selectedImage: { type: Object },
      showUploadModal: { type: Boolean },
  }

  constructor() {
      super();
      this.filters = {};
      this.tenant = 'bcg'; // Default tenant
      this.selectedImage = null;
      this.showUploadModal = false;
  }

  _handleFilterChange(e) {
      this.filters = e.detail;
  }

  _handleTenantChange(e) {
      this.tenant = e.detail;
  }

  _handleImageSelected(e) {
      console.log('Image selected:', e.detail);
      this.selectedImage = e.detail;
  }

  _handleCloseModal() {
      this.selectedImage = null;
  }

  _handleOpenUploadModal() {
      this.showUploadModal = true;
  }

    _handleCloseUploadModal() {
        this.showUploadModal = false;
    }
    
    _handleUploadComplete() {
        this.showUploadModal = false;
        this.shadowRoot.querySelector('image-gallery').fetchImages();
    }

  render() {
    return html`
        <app-header 
            .tenant=${this.tenant} 
            @tenant-change=${this._handleTenantChange}
            @open-upload-modal=${this._handleOpenUploadModal}
        ></app-header>
        <div class="container">
            <filter-controls .tenant=${this.tenant} @filter-change=${this._handleFilterChange}></filter-controls>
            <image-gallery .tenant=${this.tenant} .filters=${this.filters} @image-selected=${this._handleImageSelected}></image-gallery>
        </div>
        ${this.selectedImage ? html`<image-modal .image=${this.selectedImage} .tenant=${this.tenant} .active=${true} @close=${this._handleCloseModal}></image-modal>` : ''}
        ${this.showUploadModal ? html`<upload-modal .tenant=${this.tenant} @close=${this._handleCloseUploadModal} @upload-complete=${this._handleUploadComplete} active></upload-modal>` : ''}
    `;
  }
}

customElements.define('photocat-app', PhotoCatApp);
