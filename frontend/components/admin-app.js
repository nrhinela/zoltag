import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import './app-header.js';
import './admin-tenant-list.js';
import './admin-tenant-editor.js';
import { getTenants } from '../services/api.js';

/**
 * PhotoCat Admin Application
 * Main shell for tenant management and system administration
 */
class AdminApp extends LitElement {
  static properties = {
    view: { type: String }, // 'list' or 'editor'
    currentTenantId: { type: String },
    tenants: { type: Array },
    loading: { type: Boolean }
  };

  static styles = [
    tailwind,
    css`
      :host {
        display: block;
        background: #f5f5f5;
        min-height: 100vh;
      }

      .container {
        max-width: 1280px;
        margin: 0 auto;
        padding: 20px;
      }

      .header {
        background: white;
        padding: 20px;
        border-radius: 8px;
        margin-bottom: 20px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }

      .header-content {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      h1 {
        color: #333;
        margin: 0;
        font-size: 28px;
      }

      .header-subtitle {
        color: #666;
        margin-top: 5px;
        font-size: 14px;
      }

      .btn {
        padding: 10px 20px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: all 0.2s;
        text-decoration: none;
      }

      .btn-secondary {
        background: #6c757d;
        color: white;
      }

      .btn-secondary:hover {
        background: #545b62;
      }

      .loading {
        text-align: center;
        padding: 40px;
        color: #666;
      }
    `
  ];

  constructor() {
    super();
    this.view = 'list';
    this.currentTenantId = null;
    this.tenants = [];
    this.loading = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadTenants();
  }

  async loadTenants() {
    this.loading = true;
    try {
      this.tenants = await getTenants();
    } catch (error) {
      console.error('Failed to load tenants:', error);
      this.tenants = [];
    } finally {
      this.loading = false;
    }
  }

  handleEditTenant(e) {
    this.currentTenantId = e.detail.tenantId;
    this.view = 'editor';
  }

  handleCreateTenant(e) {
    // Reload tenants list after creation
    this.loadTenants();
  }

  handleCloseEditor() {
    this.view = 'list';
    this.currentTenantId = null;
    this.loadTenants();
  }

  handleBack() {
    window.location.href = '/';
  }

  render() {
    return html`
      <div class="container">
        <div class="header">
          <div class="header-content">
            <div>
              <h1><i class="fas fa-cog"></i> PhotoCat System Administration</h1>
              <p class="header-subtitle">Tenant configuration and system management</p>
            </div>
            <div>
              <button class="btn btn-secondary" @click="${this.handleBack}">
                <i class="fas fa-arrow-left"></i> Back
              </button>
            </div>
          </div>
        </div>

        ${this.loading
          ? html`<div class="loading">Loading tenants...</div>`
          : this.view === 'list'
            ? html`<admin-tenant-list
                .tenants="${this.tenants}"
                @edit-tenant="${this.handleEditTenant}"
                @create-tenant="${this.handleCreateTenant}"
              ></admin-tenant-list>`
            : html`<admin-tenant-editor
                .tenantId="${this.currentTenantId}"
                @close="${this.handleCloseEditor}"
              ></admin-tenant-editor>`}
      </div>
    `;
  }
}

customElements.define('admin-app', AdminApp);
export default AdminApp;
