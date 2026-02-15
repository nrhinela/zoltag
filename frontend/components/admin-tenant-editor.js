import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import './admin-tabs.js';
import './admin-tenant-settings.js';
import './library-integrations-admin.js';
import { getTenants, getSystemSettings } from '../services/api.js';

/**
 * Admin Tenant Editor Component
 * Main editor view for managing a specific tenant with tabs
 */
export class AdminTenantEditor extends LitElement {
  static properties = {
    tenantId: { type: String },
    tenant: { type: Object },
    systemSettings: { type: Object },
    activeTab: { type: String },
    loading: { type: Boolean }
  };

  static styles = [
    tailwind,
    css`
      :host {
        display: block;
      }

      .editor-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
      }

      .btn {
        padding: 10px 20px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: all 0.2s;
      }

      .btn-secondary {
        background: #6c757d;
        color: white;
      }

      .btn-secondary:hover {
        background: #545b62;
      }

      h2 {
        display: inline-block;
        margin: 0;
        color: #333;
        font-size: 20px;
      }

      .tab-content {
        display: none;
      }

      .tab-content.active {
        display: block;
      }

      .loading {
        text-align: center;
        padding: 40px;
        color: #666;
      }

      .error {
        background: #f8d7da;
        color: #721c24;
        padding: 12px;
        border-radius: 4px;
        margin-bottom: 20px;
      }
    `
  ];

  constructor() {
    super();
    this.tenantId = null;
    this.tenant = null;
    this.systemSettings = null;
    this.activeTab = 'settings';
    this.loading = false;
  }

  async connectedCallback() {
    super.connectedCallback();
    await this.loadTenantData();
  }

  async loadTenantData() {
    this.loading = true;
    try {
      // Load tenants list to find the specific tenant
      const tenants = await getTenants();
      this.tenant = tenants.find(t => t.id === this.tenantId);

      // Load system settings
      this.systemSettings = await getSystemSettings();

      if (!this.tenant) {
        throw new Error('Tenant not found');
      }
    } catch (error) {
      console.error('Failed to load tenant data:', error);
      this.tenant = null;
      this.systemSettings = null;
    } finally {
      this.loading = false;
    }
  }

  handleTabChanged(e) {
    this.activeTab = e.detail.tabId;
  }

  handleClose() {
    this.dispatchEvent(
      new CustomEvent('close', {
        bubbles: true,
        composed: true
      })
    );
  }

  handleTenantUpdated(e) {
    // Update local tenant data
    if (e.detail && e.detail.tenant) {
      this.tenant = { ...this.tenant, ...e.detail.tenant };
    }
  }

  render() {
    if (this.loading) {
      return html`<div class="loading">Loading tenant details...</div>`;
    }

    if (!this.tenant) {
      return html`<div class="error">Failed to load tenant. Please go back and try again.</div>`;
    }

    const tabs = [
      { id: 'settings', label: 'Settings' },
      { id: 'storage', label: 'Providers' }
    ];

    return html`
      <div class="editor-header">
        <button class="btn btn-secondary" @click="${this.handleClose}">
          ← Back to Tenants
        </button>
        <h2>Editing: ${this.tenant.name}</h2>
      </div>

      <admin-tabs
        .tabs="${tabs}"
        .activeTab="${this.activeTab}"
        @tab-changed="${this.handleTabChanged}"
      ></admin-tabs>

      <div class="tab-content ${this.activeTab === 'settings' ? 'active' : ''}">
        ${this.activeTab === 'settings'
          ? html`<admin-tenant-settings
              .tenant="${this.tenant}"
              .systemSettings="${this.systemSettings}"
              @tenant-updated="${this.handleTenantUpdated}"
              @close="${this.handleClose}"
            ></admin-tenant-settings>`
          : ''}
      </div>

      <div class="tab-content ${this.activeTab === 'storage' ? 'active' : ''}">
        ${this.activeTab === 'storage'
          ? html`<library-integrations-admin
              .tenant="${this.tenant?.identifier || this.tenant?.id || ''}"
            ></library-integrations-admin>`
          : ''}
      </div>
    `;
  }
}

customElements.define('admin-tenant-editor', AdminTenantEditor);
