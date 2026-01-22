import { LitElement, html, css } from 'lit';

/**
 * Admin Modal Component
 * Reusable modal wrapper with header and backdrop
 */
export class AdminModal extends LitElement {
  static properties = {
    title: { type: String },
    open: { type: Boolean }
  };

  static styles = css`
    :host {
      display: block;
    }

    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      z-index: 1000;
    }

    .modal.active {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .modal-content {
      background: white;
      padding: 30px;
      border-radius: 8px;
      max-width: 600px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }

    .modal-header h2 {
      margin: 0;
      font-size: 20px;
      color: #333;
    }

    .close {
      font-size: 28px;
      cursor: pointer;
      color: #999;
      background: none;
      border: none;
      padding: 0;
      line-height: 1;
    }

    .close:hover {
      color: #333;
    }

    .modal-body {
      color: #666;
      line-height: 1.6;
    }
  `;

  constructor() {
    super();
    this.title = '';
    this.open = false;
  }

  handleClose() {
    this.open = false;
    this.dispatchEvent(
      new CustomEvent('modal-closed', {
        bubbles: true,
        composed: true
      })
    );
  }

  handleBackdropClick(e) {
    if (e.target === e.currentTarget) {
      this.handleClose();
    }
  }

  render() {
    return html`
      <div class="modal ${this.open ? 'active' : ''}" @click="${this.handleBackdropClick}">
        <div class="modal-content">
          ${this.title
            ? html`<div class="modal-header">
                <h2>${this.title}</h2>
                <button class="close" @click="${this.handleClose}">×</button>
              </div>`
            : ''}
          <div class="modal-body">
            <slot></slot>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('admin-modal', AdminModal);
