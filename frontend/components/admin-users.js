import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import { fetchWithAuth } from '../services/api.js';

/**
 * Admin User Management Component
 * Allows super admins to view pending users, approve them, and assign to tenants
 */
class AdminUsers extends LitElement {
  static properties = {
    allUsers: { type: Array },
    pendingUsers: { type: Array },
    approvedUsers: { type: Array },
    activeUserTab: { type: String }, // 'all', 'pending', or 'approved'
    tenants: { type: Array },
    loading: { type: Boolean },
    error: { type: String },
    selectedUser: { type: Object },
    showApprovalForm: { type: Boolean },
    approvalForm: { type: Object },
    submitting: { type: Boolean },
    showAssignTenantForm: { type: Boolean },
    assignForm: { type: Object },
    assigningTenant: { type: Boolean },
  };

  static styles = [
    tailwind,
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
      }

      .card-title {
        font-size: 18px;
        font-weight: 600;
        color: #1f2937;
        margin: 0;
      }

      .card-content {
        padding: 20px;
      }

      .users-list {
        border-collapse: collapse;
        width: 100%;
      }

      .users-list th {
        text-align: left;
        padding: 12px;
        background: #f9fafb;
        border-bottom: 1px solid #e5e7eb;
        font-weight: 600;
        color: #374151;
        font-size: 14px;
      }

      .users-list td {
        padding: 12px;
        border-bottom: 1px solid #e5e7eb;
      }

      .users-list tr:hover {
        background: #f9fafb;
      }

      .user-email {
        font-family: monospace;
        font-size: 13px;
        color: #6b7280;
      }

      .user-name {
        font-weight: 500;
        color: #1f2937;
      }

      .created-date {
        color: #6b7280;
        font-size: 14px;
      }

      .btn {
        padding: 8px 16px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: all 0.2s;
        text-decoration: none;
      }

      .btn-primary {
        background: #2563eb;
        color: white;
      }

      .btn-primary:hover {
        background: #1d4ed8;
      }

      .btn-secondary {
        background: #e5e7eb;
        color: #374151;
        margin-left: 8px;
      }

      .btn-secondary:hover {
        background: #d1d5db;
      }

      .btn-danger {
        background: #dc2626;
        color: white;
      }

      .btn-danger:hover {
        background: #b91c1c;
      }

      .btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .empty-state {
        text-align: center;
        padding: 40px;
        color: #6b7280;
      }

      .empty-state-icon {
        font-size: 48px;
        margin-bottom: 16px;
        opacity: 0.5;
      }

      .error-message {
        background: #fee2e2;
        color: #dc2626;
        padding: 12px 16px;
        border-radius: 6px;
        margin-bottom: 16px;
        border-left: 4px solid #dc2626;
      }

      .loading {
        text-align: center;
        padding: 40px;
        color: #6b7280;
      }

      .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }

      .modal {
        background: white;
        border-radius: 8px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
        max-width: 500px;
        width: 90%;
        max-height: 90vh;
        overflow-y: auto;
      }

      .modal-header {
        padding: 20px;
        border-bottom: 1px solid #e5e7eb;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .modal-title {
        font-size: 18px;
        font-weight: 600;
        color: #1f2937;
        margin: 0;
      }

      .modal-close {
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: #6b7280;
      }

      .modal-content {
        padding: 20px;
      }

      .form-group {
        margin-bottom: 16px;
      }

      .form-label {
        display: block;
        margin-bottom: 6px;
        font-weight: 500;
        color: #374151;
        font-size: 14px;
      }

      .form-control {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 14px;
        box-sizing: border-box;
      }

      .form-control:focus {
        outline: none;
        border-color: #2563eb;
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
      }

      .user-info {
        background: #f3f4f6;
        padding: 12px;
        border-radius: 6px;
        margin-bottom: 16px;
      }

      .user-info-item {
        font-size: 14px;
        margin-bottom: 6px;
      }

      .user-info-item:last-child {
        margin-bottom: 0;
      }

      .user-info-label {
        font-weight: 600;
        color: #374151;
      }

      .user-info-value {
        color: #6b7280;
      }

      .modal-actions {
        display: flex;
        gap: 8px;
        margin-top: 24px;
        padding-top: 16px;
        border-top: 1px solid #e5e7eb;
      }

      .modal-actions button {
        flex: 1;
      }

      .user-tabs {
        display: flex;
        gap: 0;
        border-bottom: 2px solid #e5e7eb;
        margin-bottom: 16px;
        margin-top: 0;
      }

      .user-tab-button {
        padding: 12px 16px;
        background: none;
        border: none;
        border-bottom: 3px solid transparent;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        color: #6b7280;
        transition: all 0.2s;
      }

      .user-tab-button:hover {
        color: #374151;
      }

      .user-tab-button.active {
        color: #2563eb;
        border-bottom-color: #2563eb;
      }

      .user-status-badge {
        display: inline-block;
        padding: 4px 12px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 500;
      }

      .status-pending {
        background: #fef3c7;
        color: #92400e;
      }

      .status-approved {
        background: #d1fae5;
        color: #065f46;
      }

      .tenant-badge {
        display: inline-block;
        padding: 4px 8px;
        background: #e0e7ff;
        color: #3730a3;
        border-radius: 4px;
        font-size: 12px;
        margin: 2px 2px;
      }
    `
  ];

  constructor() {
    super();
    this.allUsers = [];
    this.pendingUsers = [];
    this.approvedUsers = [];
    this.activeUserTab = 'all';
    this.tenants = [];
    this.loading = false;
    this.error = '';
    this.selectedUser = null;
    this.showApprovalForm = false;
    this.approvalForm = {
      tenantId: '',
      role: 'user',
    };
    this.submitting = false;
    this.showAssignTenantForm = false;
    this.assignForm = {
      tenantId: '',
      role: 'user',
    };
    this.assigningTenant = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadAllUsers();
    this.loadTenants();
  }

  async loadAllUsers() {
    this.loading = true;
    this.error = '';
    try {
      // Load all users from a hypothetical endpoint or combine data
      // For now, we'll load pending users and separately load approved users
      await this.loadPendingUsers();
      await this.loadApprovedUsers();
      this.allUsers = [...this.pendingUsers, ...this.approvedUsers];
    } catch (error) {
      console.error('Failed to load users:', error);
      this.error = error.message;
    } finally {
      this.loading = false;
    }
  }

  async loadPendingUsers() {
    try {
      const users = await fetchWithAuth('/admin/users/pending');
      this.pendingUsers = users;
    } catch (error) {
      console.error('Failed to load pending users:', error);
      this.pendingUsers = [];
    }
  }

  async loadApprovedUsers() {
    try {
      const users = await fetchWithAuth('/admin/users/approved');
      this.approvedUsers = users;
    } catch (error) {
      console.error('Failed to load approved users:', error);
      this.approvedUsers = [];
    }
  }

  async loadTenants() {
    try {
      const response = await fetch('/api/v1/tenants');
      if (response.ok) {
        this.tenants = await response.json();
      }
    } catch (error) {
      console.error('Failed to load tenants:', error);
      this.tenants = [];
    }
  }

  openApprovalForm(user) {
    this.selectedUser = user;
    this.showApprovalForm = true;
    this.approvalForm = {
      tenantId: '',
      role: 'user',
    };
  }

  closeApprovalForm() {
    this.showApprovalForm = false;
    this.selectedUser = null;
  }

  updateFormField(field, value) {
    this.approvalForm = {
      ...this.approvalForm,
      [field]: value,
    };
  }

  async approveUser() {
    if (!this.selectedUser) return;

    this.submitting = true;
    try {
      const response = await fetchWithAuth(
        `/admin/users/${this.selectedUser.supabase_uid}/approve`,
        {
          method: 'POST',
          body: JSON.stringify({
            tenant_id: this.approvalForm.tenantId || null,
            role: this.approvalForm.role,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Approval failed' }));
        throw new Error(error.detail);
      }

      // Success - reload users and close form
      this.closeApprovalForm();
      await this.loadPendingUsers();
    } catch (error) {
      console.error('Failed to approve user:', error);
      this.error = error.message;
    } finally {
      this.submitting = false;
    }
  }

  async rejectUser(user) {
    if (!confirm(`Are you sure you want to reject ${user.email}?`)) {
      return;
    }

    try {
      const response = await fetchWithAuth(
        `/admin/users/${user.supabase_uid}/reject`,
        { method: 'POST' }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Rejection failed' }));
        throw new Error(error.detail);
      }

      // Success - reload users
      await this.loadAllUsers();
    } catch (error) {
      console.error('Failed to reject user:', error);
      this.error = error.message;
    }
  }

  openAssignTenantForm(user) {
    this.selectedUser = user;
    this.showAssignTenantForm = true;
    this.assignForm = {
      tenantId: '',
      role: 'user',
    };
  }

  closeAssignTenantForm() {
    this.showAssignTenantForm = false;
    this.selectedUser = null;
  }

  updateAssignForm(field, value) {
    this.assignForm = {
      ...this.assignForm,
      [field]: value,
    };
  }

  async assignTenant() {
    if (!this.selectedUser || !this.assignForm.tenantId) {
      this.error = 'Please select a tenant';
      return;
    }

    this.assigningTenant = true;
    try {
      const response = await fetchWithAuth(
        `/admin/users/${this.selectedUser.supabase_uid}/assign-tenant`,
        {
          method: 'POST',
          body: JSON.stringify({
            tenant_id: this.assignForm.tenantId,
            role: this.assignForm.role,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Assignment failed' }));
        throw new Error(error.detail);
      }

      // Success - reload users and close form
      this.closeAssignTenantForm();
      await this.loadAllUsers();
    } catch (error) {
      console.error('Failed to assign tenant:', error);
      this.error = error.message;
    } finally {
      this.assigningTenant = false;
    }
  }

  getTenantAssignments(user) {
    if (!user.tenants) return [];
    return user.tenants.map(t => t.tenant_id);
  }

  getAvailableTenants(user) {
    const assignedTenantIds = this.getTenantAssignments(user);
    return this.tenants.filter(tenant => !assignedTenantIds.includes(tenant.id));
  }

  formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  getDisplayUsers() {
    switch (this.activeUserTab) {
      case 'pending':
        return this.pendingUsers;
      case 'approved':
        return this.approvedUsers;
      case 'all':
      default:
        return this.allUsers;
    }
  }

  renderUserTable(users) {
    if (users.length === 0) {
      const emptyMessage =
        this.activeUserTab === 'pending'
          ? 'No pending users'
          : this.activeUserTab === 'approved'
            ? 'No approved users'
            : 'No users';
      const emptySubtitle =
        this.activeUserTab === 'pending'
          ? 'All users have been approved or no new registrations yet.'
          : this.activeUserTab === 'approved'
            ? 'No users have been approved yet.'
            : 'No users in the system.';

      return html`
        <div class="empty-state">
          <div class="empty-state-icon"><i class="fas fa-users"></i></div>
          <p>${emptyMessage}</p>
          <p style="font-size: 13px;">${emptySubtitle}</p>
        </div>
      `;
    }

    return html`
      <table class="users-list">
        <thead>
          <tr>
            <th>User</th>
            <th>Email</th>
            <th>Status</th>
            <th>Registered</th>
            ${this.activeUserTab !== 'pending' ? html`<th>Tenants</th>` : ''}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${users.map(
            user => html`
              <tr>
                <td>
                  <div class="user-name">
                    ${user.display_name || 'No name'}
                  </div>
                </td>
                <td>
                  <div class="user-email">${user.email}</div>
                </td>
                <td>
                  <span class="user-status-badge ${user.is_active ? 'status-approved' : 'status-pending'}">
                    ${user.is_active ? 'Approved' : 'Pending'}
                  </span>
                </td>
                <td>
                  <div class="created-date">${this.formatDate(user.created_at)}</div>
                </td>
                ${this.activeUserTab !== 'pending'
                  ? html`
                      <td>
                        ${user.tenants && user.tenants.length > 0
                          ? user.tenants.map(
                              tenant => html`
                                <span class="tenant-badge">
                                  ${tenant.tenant_name} (${tenant.role})
                                </span>
                              `
                            )
                          : html`<span style="color: #9ca3af; font-size: 13px;">No tenants</span>`}
                      </td>
                    `
                  : ''}
                <td>
                  ${user.is_active
                    ? html`
                        <button
                          class="btn btn-primary"
                          @click=${() => this.openAssignTenantForm(user)}
                          ?disabled=${this.getAvailableTenants(user).length === 0}
                          title="${this.getAvailableTenants(user).length === 0 ? 'No more tenants available' : ''}"
                        >
                          <i class="fas fa-plus"></i> Assign Tenant
                        </button>
                      `
                    : html`
                        <button
                          class="btn btn-primary"
                          @click=${() => this.openApprovalForm(user)}
                        >
                          <i class="fas fa-check"></i> Approve
                        </button>
                        <button
                          class="btn btn-secondary"
                          @click=${() => this.rejectUser(user)}
                        >
                          <i class="fas fa-times"></i> Reject
                        </button>
                      `}
                </td>
              </tr>
            `
          )}
        </tbody>
      </table>
    `;
  }

  render() {
    const displayUsers = this.getDisplayUsers();

    return html`
      <div class="card">
        <div class="card-header">
          <h2 class="card-title">
            <i class="fas fa-users-cog mr-2"></i>User Management
          </h2>
          <span style="color: #6b7280; font-size: 14px;">
            ${this.pendingUsers.length} pending, ${this.approvedUsers.length} approved
          </span>
        </div>

        <div class="card-content">
          ${this.error
            ? html`<div class="error-message">${this.error}</div>`
            : ''}

          <div class="user-tabs">
            <button
              class="user-tab-button ${this.activeUserTab === 'all' ? 'active' : ''}"
              @click=${() => (this.activeUserTab = 'all')}
            >
              <i class="fas fa-users mr-2"></i>All
              <span style="margin-left: 8px; opacity: 0.7;">
                (${this.allUsers.length})
              </span>
            </button>
            <button
              class="user-tab-button ${this.activeUserTab === 'pending' ? 'active' : ''}"
              @click=${() => (this.activeUserTab = 'pending')}
            >
              <i class="fas fa-hourglass-half mr-2"></i>Pending
              <span style="margin-left: 8px; opacity: 0.7;">
                (${this.pendingUsers.length})
              </span>
            </button>
            <button
              class="user-tab-button ${this.activeUserTab === 'approved' ? 'active' : ''}"
              @click=${() => (this.activeUserTab = 'approved')}
            >
              <i class="fas fa-check-circle mr-2"></i>Approved
              <span style="margin-left: 8px; opacity: 0.7;">
                (${this.approvedUsers.length})
              </span>
            </button>
          </div>

          ${this.loading
            ? html`<div class="loading">
                <i class="fas fa-spinner fa-spin" style="font-size: 24px; color: #2563eb; margin-bottom: 12px;"></i>
                <div>Loading users...</div>
              </div>`
            : this.renderUserTable(displayUsers)}
        </div>
      </div>

      ${this.showApprovalForm
        ? html`
            <div class="modal-overlay" @click=${this.closeApprovalForm}>
              <div class="modal" @click=${(e) => e.stopPropagation()}>
                <div class="modal-header">
                  <h3 class="modal-title">Approve User</h3>
                  <button
                    class="modal-close"
                    @click=${this.closeApprovalForm}
                  >
                    ×
                  </button>
                </div>

                <div class="modal-content">
                  <div class="user-info">
                    <div class="user-info-item">
                      <span class="user-info-label">Name:</span>
                      <span class="user-info-value">${this.selectedUser?.display_name || 'Not provided'}</span>
                    </div>
                    <div class="user-info-item">
                      <span class="user-info-label">Email:</span>
                      <span class="user-info-value">${this.selectedUser?.email}</span>
                    </div>
                    <div class="user-info-item">
                      <span class="user-info-label">Registered:</span>
                      <span class="user-info-value">${this.formatDate(this.selectedUser?.created_at)}</span>
                    </div>
                  </div>

                  <div class="form-group">
                    <label class="form-label">
                      <i class="fas fa-building mr-2"></i>Assign to Tenant (Optional)
                    </label>
                    <select
                      class="form-control"
                      .value=${this.approvalForm.tenantId}
                      @change=${(e) => this.updateFormField('tenantId', e.target.value)}
                    >
                      <option value="">-- No tenant assignment --</option>
                      ${this.tenants.map(
                        tenant => html`<option value=${tenant.id}>${tenant.name}</option>`
                      )}
                    </select>
                  </div>

                  ${this.approvalForm.tenantId
                    ? html`
                        <div class="form-group">
                          <label class="form-label">
                            <i class="fas fa-id-badge mr-2"></i>Role
                          </label>
                          <select
                            class="form-control"
                            .value=${this.approvalForm.role}
                            @change=${(e) => this.updateFormField('role', e.target.value)}
                          >
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                          </select>
                        </div>
                      `
                    : ''}

                  <div class="modal-actions">
                    <button
                      class="btn btn-secondary"
                      @click=${this.closeApprovalForm}
                    >
                      Cancel
                    </button>
                    <button
                      class="btn btn-primary"
                      @click=${this.approveUser}
                      ?disabled=${this.submitting}
                    >
                      ${this.submitting
                        ? html`<i class="fas fa-spinner fa-spin"></i> Approving...`
                        : html`<i class="fas fa-check"></i> Approve User`}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          `
        : ''}

      ${this.showAssignTenantForm
        ? html`
            <div class="modal-overlay" @click=${this.closeAssignTenantForm}>
              <div class="modal" @click=${(e) => e.stopPropagation()}>
                <div class="modal-header">
                  <h3 class="modal-title">Assign Tenant to User</h3>
                  <button
                    class="modal-close"
                    @click=${this.closeAssignTenantForm}
                  >
                    ×
                  </button>
                </div>

                <div class="modal-content">
                  <div class="user-info">
                    <div class="user-info-item">
                      <span class="user-info-label">User:</span>
                      <span class="user-info-value">${this.selectedUser?.display_name || this.selectedUser?.email}</span>
                    </div>
                    <div class="user-info-item">
                      <span class="user-info-label">Current Tenants:</span>
                      <span class="user-info-value">
                        ${this.selectedUser?.tenants && this.selectedUser.tenants.length > 0
                          ? this.selectedUser.tenants.map(t => `${t.tenant_name} (${t.role})`).join(', ')
                          : 'None'}
                      </span>
                    </div>
                  </div>

                  ${this.getAvailableTenants(this.selectedUser || {}).length > 0
                    ? html`
                        <div class="form-group">
                          <label class="form-label">
                            <i class="fas fa-building mr-2"></i>Select Tenant
                          </label>
                          <select
                            class="form-control"
                            .value=${this.assignForm.tenantId}
                            @change=${(e) => this.updateAssignForm('tenantId', e.target.value)}
                          >
                            <option value="">-- Choose a tenant --</option>
                            ${this.getAvailableTenants(this.selectedUser || {}).map(
                              tenant => html`<option value=${tenant.id}>${tenant.name}</option>`
                            )}
                          </select>
                        </div>

                        <div class="form-group">
                          <label class="form-label">
                            <i class="fas fa-id-badge mr-2"></i>Role
                          </label>
                          <select
                            class="form-control"
                            .value=${this.assignForm.role}
                            @change=${(e) => this.updateAssignForm('role', e.target.value)}
                          >
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                          </select>
                        </div>
                      `
                    : html`
                        <div style="padding: 20px; text-align: center; color: #6b7280;">
                          <p style="margin: 0;">This user is already assigned to all available tenants.</p>
                        </div>
                      `}

                  <div class="modal-actions">
                    <button
                      class="btn btn-secondary"
                      @click=${this.closeAssignTenantForm}
                    >
                      Cancel
                    </button>
                    <button
                      class="btn btn-primary"
                      @click=${this.assignTenant}
                      ?disabled=${this.assigningTenant || !this.assignForm.tenantId}
                    >
                      ${this.assigningTenant
                        ? html`<i class="fas fa-spinner fa-spin"></i> Assigning...`
                        : html`<i class="fas fa-plus"></i> Assign Tenant`}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          `
        : ''}
    `;
  }
}

customElements.define('admin-users', AdminUsers);
