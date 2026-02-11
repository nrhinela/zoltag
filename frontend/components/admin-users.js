import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import {
  fetchWithAuth,
  disableUser,
  enableUser,
  setSuperAdminStatus,
  updateUserTenantRole,
  removeUserTenantAssignment,
} from '../services/api.js';

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
    showEditUserForm: { type: Boolean },
    showDisableConfirmation: { type: Boolean },
    disablingUser: { type: Boolean },
    userToDisable: { type: Object },
    updatingUserStatus: { type: Boolean },
    updatingMembershipKey: { type: String },
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
        overflow-x: auto;
      }

      .users-grid {
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        overflow: hidden;
        min-width: 1180px;
      }

      .users-grid-row {
        display: grid;
        grid-template-columns:
          minmax(140px, 1fr)
          minmax(220px, 1.4fr)
          120px
          130px
          170px
          minmax(260px, 2fr)
          minmax(140px, 1.1fr);
        gap: 12px;
        align-items: start;
        padding: 12px 16px;
        border-bottom: 1px solid #e5e7eb;
      }

      .users-grid-row:last-child {
        border-bottom: none;
      }

      .users-grid-row:hover {
        background: #f9fafb;
      }

      .users-grid-header {
        background: #f9fafb;
        color: #374151;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.02em;
        text-transform: uppercase;
      }

      .users-grid-header:hover {
        background: #f9fafb;
      }

      .users-grid-cell {
        min-width: 0;
      }

      .user-email {
        font-family: monospace;
        font-size: 13px;
        color: #6b7280;
        overflow-wrap: anywhere;
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
      }

      .btn-secondary:hover {
        background: #d1d5db;
      }

      .btn-info {
        background: #2563eb;
        color: white;
      }

      .btn-info:hover {
        background: #1d4ed8;
      }

      .btn-danger {
        background: #dc2626;
        color: white;
      }

      .btn-danger:hover {
        background: #b91c1c;
      }

      .btn-warning {
        background: #f59e0b;
        color: white;
      }

      .btn-warning:hover {
        background: #d97706;
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

      .status-super-admin {
        background: #fce7f3;
        color: #831843;
      }

      .status-user {
        background: #e0e7ff;
        color: #3730a3;
      }

      .tenant-memberships {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .tenant-membership-row {
        display: grid;
        grid-template-columns: minmax(100px, 1fr) 96px auto;
        gap: 8px;
        align-items: center;
      }

      .tenant-membership-name {
        font-size: 13px;
        color: #1f2937;
        overflow-wrap: anywhere;
      }

      .tenant-role-select {
        border: 1px solid #d1d5db;
        border-radius: 6px;
        background: white;
        font-size: 12px;
        padding: 5px 8px;
        color: #374151;
      }

      .tenant-role-select:disabled {
        background: #f3f4f6;
      }

      .tenant-remove-btn {
        border: 1px solid #fca5a5;
        border-radius: 6px;
        background: #fef2f2;
        color: #dc2626;
        font-size: 12px;
        padding: 6px 10px;
        cursor: pointer;
      }

      .tenant-remove-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .muted-label {
        color: #9ca3af;
        font-size: 13px;
      }

      .row-actions {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }

      .tenant-summary {
        font-size: 13px;
        color: #374151;
      }

      .tenant-summary-sub {
        font-size: 12px;
        color: #6b7280;
        margin-top: 2px;
      }

      .edit-section {
        margin-bottom: 16px;
        padding: 12px;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
      }

      .edit-section:last-of-type {
        margin-bottom: 0;
      }

      .edit-section-title {
        font-size: 13px;
        font-weight: 700;
        color: #374151;
        margin-bottom: 10px;
        text-transform: uppercase;
        letter-spacing: 0.02em;
      }

      .edit-inline-row {
        display: grid;
        grid-template-columns: 1fr 130px auto;
        gap: 8px;
        align-items: center;
      }

      @media (max-width: 1400px) {
        .users-grid-row {
          grid-template-columns:
            minmax(140px, 1fr)
            minmax(220px, 1.4fr)
            110px
            120px
            150px
            minmax(220px, 1.7fr)
            minmax(130px, 1fr);
        }
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
    this.showEditUserForm = false;
    this.showDisableConfirmation = false;
    this.disablingUser = false;
    this.userToDisable = null;
    this.updatingMembershipKey = '';
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
      if (this.selectedUser?.supabase_uid) {
        const refreshedUser = this.allUsers.find((u) => u.supabase_uid === this.selectedUser.supabase_uid);
        if (refreshedUser) {
          this.selectedUser = refreshedUser;
        }
      }
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
      this.tenants = await fetchWithAuth('/tenants');
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
      await fetchWithAuth(
        `/admin/users/${this.selectedUser.supabase_uid}/approve`,
        {
          method: 'POST',
          body: JSON.stringify({
            tenant_id: this.approvalForm.tenantId || null,
            role: this.approvalForm.role,
          }),
        }
      );

      // Success - reload users and close form
      this.closeApprovalForm();
      await this.loadAllUsers();
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
      await fetchWithAuth(
        `/admin/users/${user.supabase_uid}/reject`,
        { method: 'POST' }
      );

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
    if (!this.showEditUserForm) {
      this.selectedUser = null;
    }
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
      await fetchWithAuth(
        `/admin/users/${this.selectedUser.supabase_uid}/assign-tenant`,
        {
          method: 'POST',
          body: JSON.stringify({
            tenant_id: this.assignForm.tenantId,
            role: this.assignForm.role,
          }),
        }
      );

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

  openEditUserForm(user) {
    this.selectedUser = user;
    this.showEditUserForm = true;
    this.assignForm = {
      tenantId: '',
      role: 'user',
    };
  }

  closeEditUserForm() {
    this.showEditUserForm = false;
    if (!this.showAssignTenantForm && !this.showApprovalForm) {
      this.selectedUser = null;
    }
  }

  async assignTenantFromEdit() {
    if (!this.selectedUser || !this.assignForm.tenantId) {
      this.error = 'Please select a tenant';
      return;
    }

    this.assigningTenant = true;
    try {
      await fetchWithAuth(
        `/admin/users/${this.selectedUser.supabase_uid}/assign-tenant`,
        {
          method: 'POST',
          body: JSON.stringify({
            tenant_id: this.assignForm.tenantId,
            role: this.assignForm.role,
          }),
        }
      );

      this.assignForm = {
        tenantId: '',
        role: 'user',
      };
      await this.loadAllUsers();
    } catch (error) {
      console.error('Failed to assign tenant:', error);
      this.error = error.message;
    } finally {
      this.assigningTenant = false;
    }
  }

  openDisableConfirmation(user) {
    this.userToDisable = user;
    this.showDisableConfirmation = true;
  }

  closeDisableConfirmation() {
    this.showDisableConfirmation = false;
    this.userToDisable = null;
  }

  async disableUserAccount() {
    if (!this.userToDisable) return;

    this.disablingUser = true;
    try {
      await disableUser(this.userToDisable.supabase_uid);

      // Success - reload users and close confirmation
      this.closeDisableConfirmation();
      await this.loadAllUsers();
    } catch (error) {
      console.error('Failed to disable user:', error);
      this.error = error.message;
    } finally {
      this.disablingUser = false;
    }
  }

  async enableUserAccount(user) {
    this.disablingUser = true;
    try {
      await enableUser(user.supabase_uid);

      // Success - reload users
      await this.loadAllUsers();
    } catch (error) {
      console.error('Failed to enable user:', error);
      this.error = error.message;
    } finally {
      this.disablingUser = false;
    }
  }

  async toggleSuperAdmin(user) {
    this.updatingUserStatus = true;
    try {
      const newStatus = !user.is_super_admin;
      await setSuperAdminStatus(user.supabase_uid, newStatus);

      // Success - reload users
      await this.loadAllUsers();
    } catch (error) {
      console.error('Failed to update user status:', error);
      this.error = error.message;
    } finally {
      this.updatingUserStatus = false;
    }
  }

  getMembershipKey(supabaseUid, tenantId) {
    return `${supabaseUid}:${tenantId}`;
  }

  isMembershipUpdating(supabaseUid, tenantId) {
    return this.updatingMembershipKey === this.getMembershipKey(supabaseUid, tenantId);
  }

  async updateMembershipRole(user, tenantId, role) {
    const membershipKey = this.getMembershipKey(user.supabase_uid, tenantId);
    this.updatingMembershipKey = membershipKey;
    this.error = '';
    try {
      await updateUserTenantRole(user.supabase_uid, tenantId, role);
      await this.loadAllUsers();
    } catch (error) {
      console.error('Failed to update tenant role:', error);
      this.error = error.message;
    } finally {
      this.updatingMembershipKey = '';
    }
  }

  async removeMembership(user, tenant) {
    const confirmMessage = `Remove ${user.email} from tenant "${tenant.tenant_name}"?`;
    if (!confirm(confirmMessage)) {
      return;
    }

    const membershipKey = this.getMembershipKey(user.supabase_uid, tenant.tenant_id);
    this.updatingMembershipKey = membershipKey;
    this.error = '';
    try {
      await removeUserTenantAssignment(user.supabase_uid, tenant.tenant_id);
      await this.loadAllUsers();
    } catch (error) {
      console.error('Failed to remove tenant membership:', error);
      this.error = error.message;
    } finally {
      this.updatingMembershipKey = '';
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

  renderTenantMemberships(user) {
    if (!user.tenants || user.tenants.length === 0) {
      return html`<span class="muted-label">No tenants</span>`;
    }

    return html`
      <div class="tenant-memberships">
        ${user.tenants.map((tenant) => {
          const isBusy = this.isMembershipUpdating(user.supabase_uid, tenant.tenant_id);
          return html`
            <div class="tenant-membership-row">
              <span class="tenant-membership-name">${tenant.tenant_name}</span>
              <select
                class="tenant-role-select"
                .value=${tenant.role}
                ?disabled=${isBusy}
                @change=${(e) => this.updateMembershipRole(user, tenant.tenant_id, e.target.value)}
                title="Change role for this tenant"
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
              <button
                class="tenant-remove-btn"
                ?disabled=${isBusy}
                @click=${() => this.removeMembership(user, tenant)}
                title="Remove tenant assignment"
              >
                ${isBusy ? 'Saving...' : 'Remove'}
              </button>
            </div>
          `;
        })}
      </div>
    `;
  }

  renderTenantSummary(user) {
    if (!user.tenants || user.tenants.length === 0) {
      return html`<span class="muted-label">No tenants</span>`;
    }

    const names = user.tenants.map((tenant) => tenant.tenant_name);
    const headline = user.tenants.length === 1 ? '1 tenant' : `${user.tenants.length} tenants`;
    const preview = names.slice(0, 2).join(', ');
    const suffix = names.length > 2 ? ` +${names.length - 2} more` : '';

    return html`
      <div class="tenant-summary">${headline}</div>
      <div class="tenant-summary-sub">${preview}${suffix}</div>
    `;
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
      <div class="users-grid">
        <div class="users-grid-row users-grid-header">
          <div class="users-grid-cell">User</div>
          <div class="users-grid-cell">Email</div>
          <div class="users-grid-cell">Status</div>
          <div class="users-grid-cell">Account</div>
          <div class="users-grid-cell">Registered</div>
          <div class="users-grid-cell">Tenant Assignments</div>
          <div class="users-grid-cell">Actions</div>
        </div>
        ${users.map((user) => html`
          <div class="users-grid-row">
            <div class="users-grid-cell">
              <div class="user-name">${user.display_name || 'No name'}</div>
            </div>
            <div class="users-grid-cell">
              <div class="user-email">${user.email}</div>
            </div>
            <div class="users-grid-cell">
              <span class="user-status-badge ${user.is_active ? 'status-approved' : 'status-pending'}">
                ${user.is_active ? 'Approved' : 'Pending'}
              </span>
            </div>
            <div class="users-grid-cell">
              <span class="user-status-badge ${user.is_super_admin ? 'status-super-admin' : 'status-user'}">
                ${user.is_super_admin ? 'Super Admin' : 'User'}
              </span>
            </div>
            <div class="users-grid-cell">
              <div class="created-date">${this.formatDate(user.created_at)}</div>
            </div>
            <div class="users-grid-cell">
              ${user.is_active ? this.renderTenantSummary(user) : html`<span class="muted-label">Pending approval</span>`}
            </div>
            <div class="users-grid-cell">
              <div class="row-actions">
                ${user.is_active
                  ? html`
                      <button
                        class="btn btn-primary"
                        @click=${() => this.openEditUserForm(user)}
                      >
                        <i class="fas fa-pen"></i> Edit
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
              </div>
            </div>
          </div>
        `)}
      </div>
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

      ${this.showEditUserForm
        ? html`
            <div class="modal-overlay" @click=${this.closeEditUserForm}>
              <div class="modal" @click=${(e) => e.stopPropagation()}>
                <div class="modal-header">
                  <h3 class="modal-title">Edit User</h3>
                  <button
                    class="modal-close"
                    @click=${this.closeEditUserForm}
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

                  <div class="edit-section">
                    <div class="edit-section-title">Account Controls</div>
                    <div class="row-actions">
                      <button
                        class="btn ${this.selectedUser?.is_super_admin ? 'btn-warning' : 'btn-info'}"
                        @click=${() => this.toggleSuperAdmin(this.selectedUser)}
                        ?disabled=${this.updatingUserStatus}
                      >
                        <i class="fas ${this.selectedUser?.is_super_admin ? 'fa-crown' : 'fa-user'}"></i>
                        ${this.selectedUser?.is_super_admin ? 'Remove Admin' : 'Make Admin'}
                      </button>
                      ${this.selectedUser?.is_active
                        ? html`
                            <button
                              class="btn btn-danger"
                              @click=${() => this.openDisableConfirmation(this.selectedUser)}
                            >
                              <i class="fas fa-ban"></i> Disable
                            </button>
                          `
                        : html`
                            <button
                              class="btn btn-primary"
                              @click=${() => this.enableUserAccount(this.selectedUser)}
                            >
                              <i class="fas fa-check"></i> Enable
                            </button>
                          `}
                    </div>
                  </div>

                  <div class="edit-section">
                    <div class="edit-section-title">Tenant Assignments</div>
                    ${this.renderTenantMemberships(this.selectedUser || {})}
                  </div>

                  <div class="edit-section">
                    <div class="edit-section-title">Assign Tenant</div>
                    ${this.getAvailableTenants(this.selectedUser || {}).length > 0
                      ? html`
                          <div class="edit-inline-row">
                            <select
                              class="form-control"
                              .value=${this.assignForm.tenantId}
                              @change=${(e) => this.updateAssignForm('tenantId', e.target.value)}
                            >
                              <option value="">-- Choose a tenant --</option>
                              ${this.getAvailableTenants(this.selectedUser || {}).map(
                                (tenant) => html`<option value=${tenant.id}>${tenant.name}</option>`
                              )}
                            </select>
                            <select
                              class="form-control"
                              .value=${this.assignForm.role}
                              @change=${(e) => this.updateAssignForm('role', e.target.value)}
                            >
                              <option value="user">User</option>
                              <option value="admin">Admin</option>
                            </select>
                            <button
                              class="btn btn-primary"
                              @click=${() => this.assignTenantFromEdit()}
                              ?disabled=${this.assigningTenant || !this.assignForm.tenantId}
                            >
                              ${this.assigningTenant
                                ? html`<i class="fas fa-spinner fa-spin"></i> Assigning...`
                                : html`<i class="fas fa-plus"></i> Assign`}
                            </button>
                          </div>
                        `
                      : html`<span class="muted-label">User is assigned to all available tenants.</span>`}
                  </div>

                  <div class="modal-actions">
                    <button
                      class="btn btn-secondary"
                      @click=${this.closeEditUserForm}
                    >
                      Done
                    </button>
                  </div>
                </div>
              </div>
            </div>
          `
        : ''}

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

      ${this.showDisableConfirmation
        ? html`
            <div class="modal-overlay" @click=${this.closeDisableConfirmation}>
              <div class="modal" @click=${(e) => e.stopPropagation()}>
                <div class="modal-header">
                  <h3 class="modal-title">Disable User Account</h3>
                  <button
                    class="modal-close"
                    @click=${this.closeDisableConfirmation}
                  >
                    ×
                  </button>
                </div>

                <div class="modal-content">
                  <div class="user-info">
                    <div class="user-info-item">
                      <span class="user-info-label">User:</span>
                      <span class="user-info-value">${this.userToDisable?.display_name || this.userToDisable?.email}</span>
                    </div>
                    <div class="user-info-item">
                      <span class="user-info-label">Email:</span>
                      <span class="user-info-value">${this.userToDisable?.email}</span>
                    </div>
                  </div>

                  <div style="padding: 16px; background: #fef3c7; border-radius: 6px; margin: 16px 0; border-left: 4px solid #f59e0b;">
                    <p style="margin: 0; color: #92400e; font-size: 14px;">
                      <i class="fas fa-exclamation-circle mr-2"></i>
                      This user will no longer be able to log in or access their assigned tenants. The account can be re-enabled later.
                    </p>
                  </div>

                  <div class="modal-actions">
                    <button
                      class="btn btn-secondary"
                      @click=${this.closeDisableConfirmation}
                    >
                      Cancel
                    </button>
                    <button
                      class="btn btn-danger"
                      @click=${this.disableUserAccount}
                      ?disabled=${this.disablingUser}
                    >
                      ${this.disablingUser
                        ? html`<i class="fas fa-spinner fa-spin"></i> Disabling...`
                        : html`<i class="fas fa-ban"></i> Disable User`}
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
