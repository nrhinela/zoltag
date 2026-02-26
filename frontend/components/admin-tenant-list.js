import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import { adminTypography } from './shared/admin-typography.js';
import './admin-form-group.js';
import { createTenant, fetchWithAuth } from '../services/api.js';

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
    isCreating: { type: Boolean },
    _storageUsage: { type: Object },  // { [tenantId]: { bytes: number, loading: boolean } }
  };

  static styles = [
    tailwind,
    adminTypography,
    css`
      :host { display: block; }

      .card {
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
      }

      .header {
        padding: 18px 20px;
        border-bottom: 1px solid #e5e7eb;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }

      .title {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
        color: #111827;
      }

      .subtitle {
        margin: 4px 0 0;
        color: #6b7280;
        font-size: 14px;
      }

      .content { padding: 18px 20px 20px; }

      .btn {
        border: 1px solid #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
        border-radius: 8px;
        padding: 8px 12px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
      }

      .btn:disabled { opacity: 0.6; cursor: not-allowed; }

      .btn-success {
        border-color: #bbf7d0;
        background: #f0fdf4;
        color: #15803d;
      }

      .btn-secondary {
        border-color: #e5e7eb;
        background: white;
        color: #374151;
      }

      .btn-sm { padding: 5px 10px; font-size: 12px; }

      .notice {
        padding: 10px 12px;
        border-radius: 8px;
        margin-bottom: 16px;
        font-size: 14px;
      }
      .notice-error { border: 1px solid #fecaca; background: #fef2f2; color: #b91c1c; }
      .notice-success { border: 1px solid #bbf7d0; background: #f0fdf4; color: #15803d; }

      .new-tenant-form {
        border: 1px solid #e5e7eb;
        padding: 16px;
        border-radius: 10px;
        margin-bottom: 16px;
      }

      .new-tenant-title {
        margin: 0 0 14px;
        color: #1f2937;
        font-size: 15px;
        font-weight: 600;
      }

      .form-row {
        display: flex;
        gap: 12px;
        align-items: flex-end;
        margin-bottom: 10px;
        flex-wrap: wrap;
      }

      .form-row > * { flex: 1; min-width: 160px; }

      .table-wrap {
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        overflow-x: auto;
      }

      table { width: 100%; border-collapse: collapse; }

      th {
        text-align: left;
        font-size: 12px;
        color: #374151;
        background: #f9fafb;
        text-transform: uppercase;
        letter-spacing: 0.02em;
        padding: 10px 12px;
        border-bottom: 1px solid #e5e7eb;
      }

      td {
        padding: 10px 12px;
        border-bottom: 1px solid #f1f5f9;
        font-size: 13px;
        color: #1f2937;
        vertical-align: middle;
      }

      tr:last-child td { border-bottom: none; }
      tr:hover td { background: #f9fafb; }

      .badge {
        display: inline-block;
        padding: 3px 10px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 500;
      }
      .badge-active { background: #d1fae5; color: #065f46; }
      .badge-inactive { background: #fee2e2; color: #991b1b; }
      .badge-storage { background: #fee2e2; color: #991b1b; }
      .badge-storage-dedicated { background: #dbeafe; color: #1e40af; }
      .badge-dropbox { background: #fee2e2; color: #991b1b; }
      .badge-dropbox-configured { background: #d1fae5; color: #065f46; }

      .mono { font-family: monospace; font-size: 12px; overflow-wrap: anywhere; }
      .muted { color: #6b7280; }
      .no-tenants { text-align: center; padding: 40px; color: #6b7280; }

      .usage-val { font-variant-numeric: tabular-nums; }
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
    this._storageUsage = {};
  }

  _formatBytes(bytes) {
    if (bytes == null || bytes < 0) return '—';
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  }

  async _loadStorageUsage(tenantId) {
    this._storageUsage = { ...this._storageUsage, [tenantId]: { bytes: null, loading: true } };
    try {
      const data = await fetchWithAuth('/images/stats?include_storage=true', { tenantId });
      this._storageUsage = {
        ...this._storageUsage,
        [tenantId]: { bytes: data.storage_bytes ?? -1, loading: false },
      };
    } catch (_e) {
      this._storageUsage = { ...this._storageUsage, [tenantId]: { bytes: -1, loading: false } };
    }
  }

  handleShowNewForm() {
    this.showNewForm = true;
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

  handleTenantIdChange(e) { this.newTenantId = e.detail.value; }
  handleTenantNameChange(e) { this.newTenantName = e.detail.value; }

  async handleCreateTenant(e) {
    e.preventDefault();
    if (!/^[a-z0-9-]+$/.test(this.newTenantId)) {
      this.errorMessage = 'Tenant identifier must contain only lowercase letters, numbers, and hyphens';
      return;
    }
    if (!this.newTenantId.trim() || !this.newTenantName.trim()) {
      this.errorMessage = 'Both tenant identifier and display name are required';
      return;
    }
    this.isCreating = true;
    this.errorMessage = '';
    this.successMessage = '';
    try {
      const data = { identifier: this.newTenantId.toLowerCase(), name: this.newTenantName.trim(), active: true };
      await createTenant(data);
      this.successMessage = `Tenant "${this.newTenantName}" created successfully`;
      this.newTenantId = '';
      this.newTenantName = '';
      this.showNewForm = false;
      this.dispatchEvent(new CustomEvent('create-tenant', { detail: { tenant: data }, bubbles: true, composed: true }));
      setTimeout(() => { this.successMessage = ''; }, 3000);
    } catch (error) {
      this.errorMessage = error.response?.detail || error.message || 'Failed to create tenant';
    } finally {
      this.isCreating = false;
    }
  }

  handleEditTenant(tenantId) {
    this.dispatchEvent(new CustomEvent('edit-tenant', { detail: { tenantId }, bubbles: true, composed: true }));
  }

  _renderStorageCell(t) {
    const usage = this._storageUsage[t.id];
    if (!usage) {
      return html`<button class="btn btn-sm btn-secondary" @click=${() => this._loadStorageUsage(t.id)}>Load</button>`;
    }
    if (usage.loading) return html`<span class="muted">Loading…</span>`;
    return html`<span class="usage-val">${this._formatBytes(usage.bytes)}</span>`;
  }

  render() {
    return html`
      <div class="card">
        <div class="header">
          <div>
            <h2 class="title">Tenant Management</h2>
            <p class="subtitle">${this.tenants.length} tenant${this.tenants.length === 1 ? '' : 's'}</p>
          </div>
          ${!this.showNewForm ? html`
            <button class="btn" @click="${this.handleShowNewForm}">+ New Tenant</button>
          ` : html``}
        </div>

        <div class="content">
          ${this.errorMessage ? html`<div class="notice notice-error">${this.errorMessage}</div>` : html``}
          ${this.successMessage ? html`<div class="notice notice-success">${this.successMessage}</div>` : html``}

          ${this.showNewForm ? html`
            <div class="new-tenant-form">
              <h3 class="new-tenant-title">Create New Tenant</h3>
              <form @submit="${this.handleCreateTenant}">
                <div class="form-row">
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
                <div class="form-row">
                  <button type="submit" class="btn btn-success" ?disabled="${this.isCreating}">
                    ${this.isCreating ? 'Creating…' : 'Create'}
                  </button>
                  <button type="button" class="btn btn-secondary" @click="${this.handleHideNewForm}">Cancel</button>
                </div>
              </form>
            </div>
          ` : html``}

          ${this.tenants.length === 0
            ? html`<div class="no-tenants">No tenants found</div>`
            : html`
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Identifier</th>
                      <th>UUID</th>
                      <th>Name</th>
                      <th>Status</th>
                      <th>Storage type</th>
                      <th>GCS usage</th>
                      <th>Dropbox</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${this.tenants.map((t) => html`
                      <tr>
                        <td><span class="mono">${t.identifier || t.id}</span></td>
                        <td><span class="mono muted">${t.id}</span></td>
                        <td>${t.name}</td>
                        <td>
                          <span class="badge ${t.active ? 'badge-active' : 'badge-inactive'}">
                            ${t.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td>
                          <span class="badge ${t.thumbnail_bucket ? 'badge-storage-dedicated' : 'badge-storage'}"
                                title="${t.thumbnail_bucket ? 'Dedicated buckets configured' : 'Using shared buckets'}">
                            ${t.thumbnail_bucket ? 'Dedicated' : 'Shared'}
                          </span>
                        </td>
                        <td>${this._renderStorageCell(t)}</td>
                        <td>
                          <span class="badge ${t.dropbox_configured ? 'badge-dropbox-configured' : 'badge-dropbox'}">
                            ${t.dropbox_configured ? 'Configured' : 'Not configured'}
                          </span>
                        </td>
                        <td class="muted">${new Date(t.created_at).toLocaleDateString()}</td>
                        <td>
                          <button class="btn btn-sm" @click="${() => this.handleEditTenant(t.id)}">Edit</button>
                        </td>
                      </tr>
                    `)}
                  </tbody>
                </table>
              </div>
            `}
        </div>
      </div>
    `;
  }
}

customElements.define('admin-tenant-list', AdminTenantList);
