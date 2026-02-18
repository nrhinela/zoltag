import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import { adminTypography } from './shared/admin-typography.js';
import './admin-form-group.js';
import { createTenant } from '../services/api.js';

/**
 * Admin Tenant List Component
 * Displays list of tenants and form to create new tenants
 */
export class AdminTenantList extends LitElement {
  static properties = {
    tenants: { type: Array },
    showNewForm: { type: Boolean },
    newTenantId: { type: String },
    newTenantName: { type: String },
    errorMessage: { type: String },
    successMessage: { type: String },
    isCreating: { type: Boolean }
  };

  static styles = [
    tailwind,
    adminTypography,
    css`
      :host {
        display: block;
      }

      .card {
        background: white;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        margin-bottom: 20px;
      }

      .card-header {
        padding: 20px;
        border-bottom: 1px solid #e5e7eb;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
      }

      .card-title {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: #1f2937;
      }

      .card-subtitle {
        margin-top: 6px;
        margin-bottom: 0;
        font-size: 14px;
        color: #6b7280;
      }

      .card-content {
        padding: 20px;
      }

      .btn {
        padding: 8px 16px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: all 0.2s;
      }

      .btn-primary {
        background: #2563eb;
        color: white;
      }

      .btn-primary:hover {
        background: #1d4ed8;
      }

      .btn-primary:disabled {
        background: #cccccc;
        cursor: not-allowed;
      }

      .btn-secondary {
        background: #e5e7eb;
        color: #374151;
      }

      .btn-secondary:hover {
        background: #d1d5db;
      }

      .btn-success {
        background: #16a34a;
        color: white;
      }

      .btn-success:hover {
        background: #15803d;
      }

      .notice {
        padding: 12px 16px;
        border-radius: 6px;
        margin-bottom: 20px;
      }

      .notice-error {
        background: #fee2e2;
        color: #dc2626;
        border-left: 4px solid #dc2626;
      }

      .notice-success {
        background: #d1fae5;
        color: #065f46;
        border-left: 4px solid #10b981;
      }

      .toolbar {
        display: flex;
        justify-content: flex-end;
      }

      .new-tenant-form {
        border: 1px solid #e5e7eb;
        padding: 20px;
        border-radius: 8px;
        margin-bottom: 20px;
      }

      .new-tenant-title {
        margin: 0 0 16px;
        color: #1f2937;
        font-size: 16px;
        font-weight: 600;
      }

      .form-row {
        display: flex;
        gap: 15px;
        align-items: flex-end;
        margin-bottom: 10px;
      }

      .form-row > * {
        flex: 1;
        min-width: 0;
      }

      .hint-text {
        font-size: 12px;
        color: #666;
        margin-top: 4px;
      }

      .tenants-grid {
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        overflow: hidden;
        min-width: 1120px;
      }

      .tenants-grid-row {
        display: grid;
        grid-template-columns:
          minmax(120px, 1fr)
          minmax(220px, 1.6fr)
          minmax(180px, 1.2fr)
          110px
          120px
          150px
          130px
          100px;
        gap: 12px;
        align-items: center;
        padding: 12px 16px;
        border-bottom: 1px solid #e5e7eb;
      }

      .tenants-grid-row:last-child {
        border-bottom: none;
      }

      .tenants-grid-row:hover {
        background: #f9fafb;
      }

      .tenants-grid-header {
        background: #f9fafb;
        font-weight: 700;
        font-size: 12px;
        color: #374151;
        letter-spacing: 0.02em;
        text-transform: uppercase;
      }

      .tenants-grid-header:hover {
        background: #f9fafb;
      }

      .tenants-grid-cell {
        min-width: 0;
      }

      .tenant-name {
        font-weight: 500;
        color: #1f2937;
      }

      .created-date {
        color: #6b7280;
        font-size: 14px;
      }

      .badge {
        display: inline-block;
        padding: 4px 12px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 500;
      }

      .badge-active {
        background: #d1fae5;
        color: #065f46;
      }

      .badge-inactive {
        background: #fee2e2;
        color: #991b1b;
      }

      .badge-storage {
        background: #fee2e2;
        color: #991b1b;
      }

      .badge-storage-dedicated {
        background: #dbeafe;
        color: #1e40af;
      }

      .badge-dropbox {
        background: #fee2e2;
        color: #991b1b;
      }

      .badge-dropbox-configured {
        background: #d1fae5;
        color: #065f46;
      }

      .action-buttons {
        display: flex;
        gap: 5px;
      }

      .btn-sm {
        padding: 6px 12px;
        font-size: 12px;
      }

      .no-tenants {
        text-align: center;
        padding: 40px;
        color: #6b7280;
      }

      .mono {
        overflow-wrap: anywhere;
      }
    `
  ];

  constructor() {
    super();
    this.tenants = [];
    this.showNewForm = false;
    this.newTenantId = '';
    this.newTenantName = '';
    this.errorMessage = '';
    this.successMessage = '';
    this.isCreating = false;
  }

  handleShowNewForm() {
    this.showNewForm = true;
    // Focus on tenant ID input
    this.updateComplete.then(() => {
      const input = this.shadowRoot.querySelector('#new-tenant-id');
      if (input) input.focus();
    });
  }

  handleHideNewForm() {
    this.showNewForm = false;
    this.newTenantId = '';
    this.newTenantName = '';
    this.errorMessage = '';
  }

  handleTenantIdChange(e) {
    this.newTenantId = e.detail.value;
  }

  handleTenantNameChange(e) {
    this.newTenantName = e.detail.value;
  }

  async handleCreateTenant(e) {
    e.preventDefault();

    // Validate tenant identifier format
    if (!/^[a-z0-9-]+$/.test(this.newTenantId)) {
      this.errorMessage = 'Tenant identifier must contain only lowercase letters, numbers, and hyphens';
      return;
    }

    if (this.newTenantId.trim().length === 0 || this.newTenantName.trim().length === 0) {
      this.errorMessage = 'Both tenant identifier and display name are required';
      return;
    }

    this.isCreating = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      const data = {
        identifier: this.newTenantId.toLowerCase(),
        name: this.newTenantName.trim(),
        active: true
      };

      await createTenant(data);

      this.successMessage = `Tenant "${this.newTenantName}" created successfully`;
      this.newTenantId = '';
      this.newTenantName = '';
      this.showNewForm = false;

      // Emit create event
      this.dispatchEvent(
        new CustomEvent('create-tenant', {
          detail: { tenant: data },
          bubbles: true,
          composed: true
        })
      );

      // Clear success message after 3 seconds
      setTimeout(() => {
        this.successMessage = '';
      }, 3000);
    } catch (error) {
      console.error('Error creating tenant:', error);
      this.errorMessage =
        error.response?.detail ||
        error.message ||
        'Failed to create tenant';
    } finally {
      this.isCreating = false;
    }
  }

  handleEditTenant(tenantId) {
    this.dispatchEvent(
      new CustomEvent('edit-tenant', {
        detail: { tenantId },
        bubbles: true,
        composed: true
      })
    );
  }

  render() {
    return html`
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Tenant Management</h2>
            <p class="card-subtitle">${this.tenants.length} tenant${this.tenants.length === 1 ? '' : 's'}</p>
          </div>
          ${!this.showNewForm
            ? html`<div class="toolbar">
                <button class="btn btn-primary" @click="${this.handleShowNewForm}">
                  + New Tenant
                </button>
              </div>`
            : html``}
        </div>

        <div class="card-content">
          ${this.errorMessage ? html`<div class="notice notice-error">${this.errorMessage}</div>` : html``}
          ${this.successMessage ? html`<div class="notice notice-success">${this.successMessage}</div>` : html``}

          ${this.showNewForm
            ? html`<div class="new-tenant-form">
                <h3 class="new-tenant-title">Create New Tenant</h3>
                <form @submit="${this.handleCreateTenant}">
                  <div class="form-row">
                    <div>
                      <admin-form-group
                        id="new-tenant-id"
                        label="Tenant Identifier"
                        type="text"
                        placeholder="identifier"
                        .value="${this.newTenantId}"
                        @input-changed="${this.handleTenantIdChange}"
                        helper-text="Lowercase letters, numbers, and hyphens only"
                        required
                      ></admin-form-group>
                    </div>
                    <div>
                      <admin-form-group
                        id="new-tenant-name"
                        label="Display Name"
                        type="text"
                        placeholder="Display Name"
                        .value="${this.newTenantName}"
                        @input-changed="${this.handleTenantNameChange}"
                        required
                      ></admin-form-group>
                    </div>
                  </div>
                  <div class="form-row">
                    <button
                      type="submit"
                      class="btn btn-success"
                      ?disabled="${this.isCreating}"
                    >
                      ${this.isCreating ? 'Creating...' : 'Create'}
                    </button>
                    <button
                      type="button"
                      class="btn btn-secondary"
                      @click="${this.handleHideNewForm}"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>`
            : html``}

          ${this.tenants.length === 0
            ? html`<div class="no-tenants">No tenants found</div>`
            : html`<div class="tenants-grid">
                <div class="tenants-grid-row tenants-grid-header">
                  <div class="tenants-grid-cell">Identifier</div>
                  <div class="tenants-grid-cell">UUID</div>
                  <div class="tenants-grid-cell">Name</div>
                  <div class="tenants-grid-cell">Status</div>
                  <div class="tenants-grid-cell">Storage</div>
                  <div class="tenants-grid-cell">Dropbox</div>
                  <div class="tenants-grid-cell">Created</div>
                  <div class="tenants-grid-cell">Actions</div>
                </div>
                ${this.tenants.map((t) => html`
                  <div class="tenants-grid-row">
                    <div class="tenants-grid-cell"><span class="mono">${t.identifier || t.id}</span></div>
                    <div class="tenants-grid-cell"><span class="mono">${t.id}</span></div>
                    <div class="tenants-grid-cell tenant-name">${t.name}</div>
                    <div class="tenants-grid-cell">
                      <span class="badge ${t.active ? 'badge-active' : 'badge-inactive'}">
                        ${t.active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div class="tenants-grid-cell">
                      <span
                        class="badge ${t.thumbnail_bucket ? 'badge-storage-dedicated' : 'badge-storage'}"
                        title="${t.thumbnail_bucket ? 'Dedicated buckets configured' : 'Using shared buckets'}"
                      >
                        ${t.thumbnail_bucket ? 'Dedicated' : 'Shared'}
                      </span>
                    </div>
                    <div class="tenants-grid-cell">
                      <span class="badge ${t.dropbox_configured ? 'badge-dropbox-configured' : 'badge-dropbox'}">
                        ${t.dropbox_configured ? 'Configured' : 'Not configured'}
                      </span>
                    </div>
                    <div class="tenants-grid-cell created-date">${new Date(t.created_at).toLocaleDateString()}</div>
                    <div class="tenants-grid-cell action-buttons">
                      <button
                        class="btn btn-primary btn-sm"
                        @click="${() => this.handleEditTenant(t.id)}"
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                `)}
              </div>`}
        </div>
      </div>
    `;
  }
}

customElements.define('admin-tenant-list', AdminTenantList);
