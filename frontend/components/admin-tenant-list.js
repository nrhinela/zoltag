import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
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
    css`
      :host {
        display: block;
      }

      h2 {
        margin-bottom: 20px;
        color: #333;
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

      .btn-primary {
        background: #007bff;
        color: white;
      }

      .btn-primary:hover {
        background: #0056b3;
      }

      .btn-primary:disabled {
        background: #cccccc;
        cursor: not-allowed;
      }

      .btn-secondary {
        background: #6c757d;
        color: white;
      }

      .btn-secondary:hover {
        background: #545b62;
      }

      .btn-success {
        background: #28a745;
        color: white;
      }

      .btn-success:hover {
        background: #218838;
      }

      .error {
        background: #f8d7da;
        color: #721c24;
        padding: 12px;
        border-radius: 4px;
        margin-bottom: 20px;
        display: none;
      }

      .error.show {
        display: block;
      }

      .success {
        background: #d4edda;
        color: #155724;
        padding: 12px;
        border-radius: 4px;
        margin-bottom: 20px;
        display: none;
      }

      .success.show {
        display: block;
      }

      .toolbar {
        margin-bottom: 20px;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 20px;
      }

      .new-tenant-form {
        background: white;
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        margin-bottom: 20px;
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

      .tenants-container {
        background: white;
        padding: 30px;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }

      h3 {
        margin-top: 0;
        margin-bottom: 20px;
        color: #333;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 20px;
      }

      th,
      td {
        padding: 12px;
        text-align: left;
        border-bottom: 1px solid #ddd;
      }

      th {
        background: #f8f9fa;
        font-weight: 600;
        color: #495057;
      }

      tr:hover {
        background: #f8f9fa;
      }

      .badge {
        display: inline-block;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 500;
      }

      .badge-success {
        background: #d4edda;
        color: #155724;
      }

      .badge-danger {
        background: #f8d7da;
        color: #721c24;
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
        color: #999;
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

    // Validate tenant ID format
    if (!/^[a-z0-9-]+$/.test(this.newTenantId)) {
      this.errorMessage = 'Tenant ID must contain only lowercase letters, numbers, and hyphens';
      return;
    }

    if (this.newTenantId.trim().length === 0 || this.newTenantName.trim().length === 0) {
      this.errorMessage = 'Both Tenant ID and Display Name are required';
      return;
    }

    this.isCreating = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      const data = {
        id: this.newTenantId.toLowerCase(),
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
      <div>
        <h2>Tenant Management</h2>

        <div class="error ${this.errorMessage ? 'show' : ''}">${this.errorMessage}</div>
        <div class="success ${this.successMessage ? 'show' : ''}">${this.successMessage}</div>

        ${!this.showNewForm
          ? html`<div class="toolbar">
              <button class="btn btn-primary" @click="${this.handleShowNewForm}">
                + New Tenant
              </button>
            </div>`
          : html`<div class="new-tenant-form">
              <h3 style="margin-top: 0;">Create New Tenant</h3>
              <form @submit="${this.handleCreateTenant}">
                <div class="form-row">
                  <div>
                    <admin-form-group
                      id="new-tenant-id"
                      label="Tenant ID"
                      type="text"
                      placeholder="ID"
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
            </div>`}

        <div class="tenants-container">
          <h3>Existing Tenants</h3>

          ${this.tenants.length === 0
            ? html`<div class="no-tenants">No tenants found</div>`
            : html`<table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Storage</th>
                    <th>Dropbox</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${this.tenants.map(
                    t =>
                      html`<tr>
                        <td><code>${t.id}</code></td>
                        <td>${t.name}</td>
                        <td>
                          <span
                            class="badge ${t.active ? 'badge-success' : 'badge-danger'}"
                          >
                            ${t.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td>
                          <span
                            class="badge ${t.thumbnail_bucket ? 'badge-success' : 'badge-danger'}"
                            title="${t.thumbnail_bucket
                              ? 'Dedicated buckets configured'
                              : 'Using shared buckets'}"
                          >
                            ${t.thumbnail_bucket ? 'Dedicated' : 'Shared'}
                          </span>
                        </td>
                        <td>
                          <span
                            class="badge ${t.dropbox_configured
                              ? 'badge-success'
                              : 'badge-danger'}"
                          >
                            ${t.dropbox_configured ? 'Configured' : 'Not configured'}
                          </span>
                        </td>
                        <td>${new Date(t.created_at).toLocaleDateString()}</td>
                        <td class="action-buttons">
                          <button
                            class="btn btn-primary btn-sm"
                            @click="${() => this.handleEditTenant(t.id)}"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>`
                  )}
                </tbody>
              </table>`}
        </div>
      </div>
    `;
  }
}

customElements.define('admin-tenant-list', AdminTenantList);
