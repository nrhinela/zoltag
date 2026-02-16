import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import './app-header.js';
import './admin-tenant-list.js';
import './admin-tenant-editor.js';
import './admin-users.js';
import './cli-commands.js';
import './admin-jobs.js';
import './admin-keyword-thresholds.js';
import { getTenants } from '../services/api.js';

/**
 * Zoltag Admin Application
 * Main shell for tenant management and system administration
 */
class AdminApp extends LitElement {
  static properties = {
    activeTab: { type: String }, // 'tenants', 'users', 'jobs', 'keywords', or 'cli'
    _thresholdTenantId: { type: String },
    view: { type: String }, // 'list' or 'editor' (for tenants)
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

      .panel {
        background: white;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        padding: 20px;
      }

      .tabs {
        display: flex;
        gap: 0;
        border-bottom: 2px solid #e5e7eb;
        margin-bottom: 20px;
      }

      .tab-button {
        padding: 12px 20px;
        background: none;
        border: none;
        border-bottom: 3px solid transparent;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        color: #6b7280;
        transition: all 0.2s;
      }

      .tab-button:hover {
        color: #374151;
      }

      .tab-button.active {
        color: #2563eb;
        border-bottom-color: #2563eb;
      }
    `
  ];

  constructor() {
    super();
    this.activeTab = 'tenants';
    this.view = 'list';
    this.currentTenantId = null;
    this.tenants = [];
    this.loading = false;
    this._thresholdTenantId = null;
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
    window.location.href = '/app';
  }

  switchTab(tab) {
    this.activeTab = tab;
    this.view = 'list'; // Reset tenant view when switching tabs
  }

  render() {
    return html`
      <div class="container">
        <div class="header">
          <div class="header-content">
            <div>
              <h1><i class="fas fa-cog"></i> Zoltag System Administration</h1>
              <p class="header-subtitle">Tenant configuration, user management, and system settings</p>
            </div>
            <div>
              <button class="btn btn-secondary" @click="${this.handleBack}">
                <i class="fas fa-arrow-left"></i> Back
              </button>
            </div>
          </div>
        </div>

        <div class="tabs">
          <button
            class="tab-button ${this.activeTab === 'tenants' ? 'active' : ''}"
            @click="${() => this.switchTab('tenants')}"
          >
            <i class="fas fa-building mr-2"></i>Tenants
          </button>
          <button
            class="tab-button ${this.activeTab === 'users' ? 'active' : ''}"
            @click="${() => this.switchTab('users')}"
          >
            <i class="fas fa-users-cog mr-2"></i>Users
          </button>
          <button
            class="tab-button ${this.activeTab === 'jobs' ? 'active' : ''}"
            @click="${() => this.switchTab('jobs')}"
          >
            <i class="fas fa-gears mr-2"></i>Jobs
          </button>
          <button
            class="tab-button ${this.activeTab === 'keywords' ? 'active' : ''}"
            @click="${() => this.switchTab('keywords')}"
          >
            <i class="fas fa-sliders mr-2"></i>Thresholds
          </button>
          <button
            class="tab-button ${this.activeTab === 'cli' ? 'active' : ''}"
            @click="${() => this.switchTab('cli')}"
          >
            <i class="fas fa-terminal mr-2"></i>CLI Docs
          </button>
        </div>

        ${this.activeTab === 'tenants'
          ? this.loading
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
                ></admin-tenant-editor>`
          : this.activeTab === 'users'
            ? html`<admin-users></admin-users>`
            : this.activeTab === 'jobs'
              ? html`<admin-jobs .tenants=${this.tenants}></admin-jobs>`
            : this.activeTab === 'keywords'
              ? html`
                <div class="panel">
                  <div class="p-3 border-b border-gray-200 flex items-center gap-3">
                    <label class="text-sm text-gray-600 font-medium">Tenant:</label>
                    <select
                      class="text-sm border border-gray-300 rounded px-2 py-1"
                      .value=${this._thresholdTenantId || ''}
                      @change=${(e) => { this._thresholdTenantId = e.target.value; }}
                    >
                      <option value="">— select a tenant —</option>
                      ${(this.tenants || []).map(t => html`
                        <option value=${t.id}>${t.name}</option>
                      `)}
                    </select>
                  </div>
                  ${this._thresholdTenantId ? html`
                    <admin-keyword-thresholds
                      .tenantId=${this._thresholdTenantId}
                    ></admin-keyword-thresholds>
                  ` : html`
                    <div class="p-6 text-gray-400 text-sm">Select a tenant to view thresholds.</div>
                  `}
                </div>
              `
            : html`
                <div class="panel">
                  <cli-commands></cli-commands>
                </div>
              `}
      </div>
    `;
  }
}

customElements.define('admin-app', AdminApp);
export default AdminApp;
