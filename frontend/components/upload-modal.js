import { LitElement, html, css } from 'lit';
import { uploadImages } from '../services/api.js';
import { tailwind } from './tailwind-lit.js';

class UploadModal extends LitElement {
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
        max-width: 500px;
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
    active: { type: Boolean, reflect: true },
    tenant: { type: String },
  };

  constructor() {
    super();
    this.active = false;
  }

  render() {
    return html`
      <div class="modal ${this.active ? 'active' : ''}" @click=${this._closeModal}>
        <div class="modal-content" @click=${e => e.stopPropagation()}>
          <span class="close" @click=${this._closeModal}>&times;</span>
          <h2 class="text-2xl font-bold text-gray-800">Upload Images</h2>
          <div class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center mt-4">
              <i class="fas fa-cloud-upload-alt text-6xl text-gray-400 mb-4"></i>
              <p class="text-gray-600 mb-4">Drag and drop images here or click to browse</p>
              <input type="file" id="fileInput" multiple accept="image/*" class="hidden" @change=${this._handleFileSelect}>
              <button @click=${() => this.shadowRoot.getElementById('fileInput').click()} class="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700">
                  Select Files
              </button>
          </div>
        </div>
      </div>
    `;
  }

  _closeModal() {
    this.active = false;
    this.dispatchEvent(new CustomEvent('close'));
  }

  async _handleFileSelect(e) {
      const files = e.target.files;
      if (files.length > 0) {
          try {
              await uploadImages(this.tenant, files);
              this._closeModal();
              this.dispatchEvent(new CustomEvent('upload-complete', { bubbles: true, composed: true }));
          } catch (error) {
              console.error('Upload failed:', error);
          }
      }
  }
}

customElements.define('upload-modal', UploadModal);
