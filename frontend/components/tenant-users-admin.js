import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import {
  getTenantUsers,
  updateTenantUserRole,
  removeTenantUserMembership,
  createTenantInvitation,
  getTenantInvitations,
  cancelTenantInvitation,
} from '../services/api.js';

class TenantUsersAdmin extends LitElement {
  static properties = {
    tenant: { type: String },
    canManage: { type: Boolean },
    isSuperAdmin: { type: Boolean },
    users: { type: Array },
    loading: { type: Boolean },
    error: { type: String },
    editingUser: { type: Object },
    editRole: { type: String },
    saving: { type: Boolean },
    invitations: { type: Array },
    invitationsLoading: { type: Boolean },
    showInviteModal: { type: Boolean },
    inviteEmail: { type: String },
    inviteRole: { type: String },
    inviteSubmitting: { type: Boolean },
    inviteLink: { type: String },
  };

  static styles = [
    tailwind,
    css`
      :host {
        display: block;
      }

      .card {
        border: 1px solid #d1d5db;
        border-radius: 12px;
        background: white;
      }

      .card-header {
        padding: 20px;
        border-bottom: 1px solid #e5e7eb;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
      }

      .card-title {
        margin: 0;
        font-size: 34px;
        font-weight: 700;
        color: #111827;
      }

      .card-subtitle {
        margin: 4px 0 0;
        font-size: 15px;
        color: #6b7280;
      }

      .card-content {
        padding: 20px;
      }

      .refresh-btn {
        border: 1px solid #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
        border-radius: 10px;
        padding: 8px 14px;
        font-weight: 600;
        cursor: pointer;
      }

      .refresh-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .header-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .invite-btn {
        border: 1px solid #93c5fd;
        background: #2563eb;
        color: white;
        border-radius: 10px;
        padding: 8px 14px;
        font-weight: 600;
        cursor: pointer;
      }

      .invite-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .table-wrap {
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        overflow: hidden;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th {
        text-align: left;
        padding: 12px 14px;
        font-size: 12px;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        color: #374151;
        background: #f9fafb;
        border-bottom: 1px solid #e5e7eb;
      }

      td {
        padding: 12px 14px;
        border-bottom: 1px solid #e5e7eb;
        vertical-align: middle;
      }

      tr:last-child td {
        border-bottom: none;
      }

      .name {
        font-weight: 600;
        color: #111827;
      }

      .email {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 13px;
        color: #4b5563;
        overflow-wrap: anywhere;
      }

      .badge {
        display: inline-block;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 600;
        padding: 4px 10px;
      }

      .badge-approved {
        background: #dcfce7;
        color: #166534;
      }

      .badge-disabled {
        background: #fee2e2;
        color: #991b1b;
      }

      .badge-admin {
        background: #ede9fe;
        color: #5b21b6;
      }

      .badge-user {
        background: #e0e7ff;
        color: #3730a3;
      }

      .badge-editor {
        background: #dbeafe;
        color: #1d4ed8;
      }

      .row-actions {
        display: flex;
        gap: 8px;
      }

      .btn {
        border-radius: 8px;
        padding: 7px 12px;
        font-size: 13px;
        font-weight: 600;
        border: 1px solid transparent;
        cursor: pointer;
      }

      .btn-primary {
        background: #2563eb;
        border-color: #2563eb;
        color: white;
      }

      .btn-primary:disabled {
        background: #d1d5db;
        border-color: #d1d5db;
        color: #6b7280;
        cursor: not-allowed;
      }

      .empty,
      .loading,
      .access-denied {
        padding: 30px 18px;
        text-align: center;
        color: #6b7280;
      }

      .error {
        border: 1px solid #fecaca;
        background: #fef2f2;
        color: #b91c1c;
        padding: 10px 12px;
        border-radius: 8px;
        margin-bottom: 14px;
      }

      .hint {
        font-size: 12px;
        color: #6b7280;
      }

      .modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1200;
      }

      .modal {
        background: #fff;
        border-radius: 12px;
        width: min(560px, 92vw);
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.25);
      }

      .modal-header {
        border-bottom: 1px solid #e5e7eb;
        padding: 16px 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .modal-title {
        margin: 0;
        font-size: 20px;
        font-weight: 700;
        color: #111827;
      }

      .modal-content {
        padding: 16px 20px 20px;
      }

      .modal-close {
        border: none;
        background: none;
        font-size: 24px;
        line-height: 1;
        cursor: pointer;
        color: #6b7280;
      }

      .field {
        margin-bottom: 12px;
      }

      .label {
        display: block;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.02em;
        color: #6b7280;
        margin-bottom: 6px;
      }

      select {
        width: 100%;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        padding: 9px 10px;
        font-size: 14px;
      }

      .modal-actions {
        margin-top: 18px;
        display: flex;
        justify-content: space-between;
        gap: 8px;
      }

      .btn-danger {
        background: #fef2f2;
        border: 1px solid #fca5a5;
        color: #b91c1c;
      }

      .btn-secondary {
        border: 1px solid #d1d5db;
        background: white;
        color: #374151;
      }

      .invite-success {
        border: 1px solid #86efac;
        background: #f0fdf4;
        color: #166534;
        padding: 10px 12px;
        border-radius: 8px;
        margin-bottom: 14px;
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
      }

      .invite-success-link {
        max-width: 100%;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        overflow-wrap: anywhere;
      }

      .invite-table {
        margin-top: 16px;
      }

      .invite-status {
        font-size: 12px;
        color: #6b7280;
      }

      .btn-small {
        padding: 5px 9px;
        font-size: 12px;
      }

      .inline-input {
        width: 100%;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        padding: 9px 10px;
        font-size: 14px;
      }
    `,
  ];

  constructor() {
    super();
    this.tenant = '';
    this.canManage = false;
    this.isSuperAdmin = false;
    this.users = [];
    this.loading = false;
    this.error = '';
    this.editingUser = null;
    this.editRole = 'user';
    this.saving = false;
    this.invitations = [];
    this.invitationsLoading = false;
    this.showInviteModal = false;
    this.inviteEmail = '';
    this.inviteRole = 'user';
    this.inviteSubmitting = false;
    this.inviteLink = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadData();
  }

  updated(changedProperties) {
    if (changedProperties.has('tenant') || changedProperties.has('canManage')) {
      this._loadData();
    }
  }

  async _loadData() {
    await Promise.all([
      this._loadUsers(),
      this._loadInvitations(),
    ]);
  }

  _isAdminProtected(user) {
    if (!user) return true;
    return Boolean(user.is_super_admin);
  }

  _roleLabel(role) {
    if (role === 'admin') return 'Admin';
    if (role === 'editor') return 'Editor';
    return 'User';
  }

  _roleBadgeClass(role) {
    if (role === 'admin') return 'badge-admin';
    if (role === 'editor') return 'badge-editor';
    return 'badge-user';
  }

  async _loadUsers() {
    if (!this.tenant || !this.canManage) {
      this.users = [];
      this.loading = false;
      return;
    }
    this.loading = true;
    this.error = '';
    try {
      this.users = await getTenantUsers(this.tenant);
    } catch (error) {
      console.error('Failed to load tenant users:', error);
      this.error = error.message || 'Failed to load users';
      this.users = [];
    } finally {
      this.loading = false;
    }
  }

  async _loadInvitations() {
    if (!this.tenant || !this.canManage) {
      this.invitations = [];
      this.invitationsLoading = false;
      return;
    }
    this.invitationsLoading = true;
    try {
      const rows = await getTenantInvitations(this.tenant);
      this.invitations = (rows || []).filter((invitation) => !invitation.accepted_at);
    } catch (error) {
      console.error('Failed to load tenant invitations:', error);
      this.error = error.message || 'Failed to load invitations';
      this.invitations = [];
    } finally {
      this.invitationsLoading = false;
    }
  }

  _formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  _openEdit(user) {
    if (!user || this._isAdminProtected(user)) return;
    this.editingUser = user;
    this.editRole = user.role || 'user';
    this.error = '';
  }

  _closeEdit() {
    this.editingUser = null;
    this.saving = false;
  }

  async _saveRole() {
    if (!this.editingUser) return;
    this.saving = true;
    this.error = '';
    try {
      await updateTenantUserRole(this.tenant, this.editingUser.supabase_uid, this.editRole);
      await this._loadUsers();
      this._closeEdit();
    } catch (error) {
      console.error('Failed to update tenant user role:', error);
      this.error = error.message || 'Failed to update role';
      this.saving = false;
    }
  }

  async _removeUser() {
    if (!this.editingUser) return;
    const ok = confirm(`Remove ${this.editingUser.email} from this tenant?`);
    if (!ok) return;
    this.saving = true;
    this.error = '';
    try {
      await removeTenantUserMembership(this.tenant, this.editingUser.supabase_uid);
      await this._loadUsers();
      this._closeEdit();
    } catch (error) {
      console.error('Failed to remove tenant user:', error);
      this.error = error.message || 'Failed to remove user';
      this.saving = false;
    }
  }

  _openInviteModal() {
    this.showInviteModal = true;
    this.inviteEmail = '';
    this.inviteRole = 'user';
    this.error = '';
  }

  _closeInviteModal() {
    this.showInviteModal = false;
    this.inviteSubmitting = false;
  }

  _buildInvitationLink(token) {
    const encoded = encodeURIComponent(String(token || '').trim());
    return `${window.location.origin}/signup?invitation_token=${encoded}`;
  }

  async _copyToClipboard(value) {
    const text = String(value || '').trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (_error) {
      const input = document.createElement('input');
      input.value = text;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
  }

  async _submitInvite() {
    if (!this.tenant || !this.canManage) return;
    const email = (this.inviteEmail || '').trim();
    if (!email) {
      this.error = 'Email is required';
      return;
    }
    this.inviteSubmitting = true;
    this.error = '';
    try {
      const result = await createTenantInvitation(this.tenant, email, this.inviteRole || 'user');
      const token = result?.token || '';
      this.inviteLink = token ? this._buildInvitationLink(token) : '';
      await this._loadInvitations();
      this._closeInviteModal();
      if (this.inviteLink) {
        await this._copyToClipboard(this.inviteLink);
      }
    } catch (error) {
      console.error('Failed to create invitation:', error);
      this.error = error.message || 'Failed to create invitation';
      this.inviteSubmitting = false;
    }
  }

  async _cancelInvitation(invitation) {
    const invitationId = invitation?.id;
    if (!invitationId) return;
    const ok = confirm(`Cancel invitation for ${invitation.email}?`);
    if (!ok) return;
    this.error = '';
    try {
      await cancelTenantInvitation(this.tenant, invitationId);
      await this._loadInvitations();
    } catch (error) {
      console.error('Failed to cancel invitation:', error);
      this.error = error.message || 'Failed to cancel invitation';
    }
  }

  _renderInvitationsTable() {
    if (this.invitationsLoading) {
      return html`<div class="loading"><i class="fas fa-spinner fa-spin mr-2"></i>Loading invitations...</div>`;
    }

    if (!this.invitations.length) {
      return html`<div class="empty">No pending invitations for this tenant.</div>`;
    }

    return html`
      <div class="table-wrap invite-table">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Invited</th>
              <th>Expires</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${this.invitations.map((invitation) => html`
              <tr>
                <td><span class="email">${invitation.email}</span></td>
                <td>
                  <span class="badge ${this._roleBadgeClass(invitation.role)}>
                    ${this._roleLabel(invitation.role)}
                  </span>
                </td>
                <td>${this._formatDate(invitation.created_at)}</td>
                <td>${this._formatDate(invitation.expires_at)}</td>
                <td>
                  <button
                    class="btn btn-danger btn-small"
                    @click=${() => this._cancelInvitation(invitation)}
                  >
                    Cancel
                  </button>
                </td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    `;
  }

  _renderTable() {
    if (this.loading) {
      return html`<div class="loading"><i class="fas fa-spinner fa-spin mr-2"></i>Loading tenant users...</div>`;
    }

    if (!this.users.length) {
      return html`<div class="empty">No users are assigned to this tenant.</div>`;
    }

    return html`
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Status</th>
              <th>Account</th>
              <th>Tenant Role</th>
              <th>Registered</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${this.users.map((user) => {
              const protectedAdmin = this._isAdminProtected(user);
              return html`
                <tr>
                  <td><span class="name">${user.display_name || 'No name'}</span></td>
                  <td><span class="email">${user.email}</span></td>
                  <td>
                    <span class="badge ${user.is_active ? 'badge-approved' : 'badge-disabled'}">
                      ${user.is_active ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td>
                    <span class="badge ${user.is_super_admin ? 'badge-admin' : 'badge-user'}">
                      ${user.is_super_admin ? 'Super Admin' : 'User'}
                    </span>
                  </td>
                  <td>
                    <span class="badge ${this._roleBadgeClass(user.role)}>
                      ${this._roleLabel(user.role)}
                    </span>
                  </td>
                  <td>${this._formatDate(user.created_at)}</td>
                  <td>
                    <div class="row-actions">
                      <button
                        class="btn btn-primary"
                        ?disabled=${protectedAdmin}
                        @click=${() => this._openEdit(user)}
                        title=${protectedAdmin ? 'Admin users are visible but cannot be edited here' : 'Edit user'}
                      >
                        <i class="fas fa-pen mr-1"></i>Edit
                      </button>
                    </div>
                    ${protectedAdmin ? html`<div class="hint mt-1">Admin user (read-only)</div>` : ''}
                  </td>
                </tr>
              `;
            })}
          </tbody>
        </table>
      </div>
    `;
  }

  render() {
    if (!this.canManage) {
      return html`
        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">Tenant Users</h2>
              <p class="card-subtitle">Manage users assigned to this tenant.</p>
            </div>
          </div>
          <div class="card-content">
            <div class="access-denied">
              <i class="fas fa-lock mr-2"></i>
              Tenant admin role is required to manage users.
            </div>
          </div>
        </div>
      `;
    }

    return html`
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Tenant Users</h2>
            <p class="card-subtitle">Manage users assigned to tenant <strong>${this.tenant}</strong>.</p>
          </div>
          <div class="header-actions">
            <button class="invite-btn" @click=${this._openInviteModal}>
              <i class="fas fa-user-plus mr-1"></i>Invite User
            </button>
            <button class="refresh-btn" @click=${this._loadData} ?disabled=${this.loading || this.invitationsLoading}>
              <i class="fas fa-rotate-right mr-1"></i>Refresh
            </button>
          </div>
        </div>
        <div class="card-content">
          ${this.error ? html`<div class="error">${this.error}</div>` : ''}
          ${this.inviteLink ? html`
            <div class="invite-success">
              <div>
                <div><strong>Invitation created.</strong> Share this signup link with the user:</div>
                <div class="invite-success-link">${this.inviteLink}</div>
              </div>
              <div class="row-actions">
                <button class="btn btn-secondary btn-small" @click=${() => this._copyToClipboard(this.inviteLink)}>
                  Copy Link
                </button>
                <button class="btn btn-secondary btn-small" @click=${() => { this.inviteLink = ''; }}>
                  Dismiss
                </button>
              </div>
            </div>
          ` : html``}
          ${this._renderTable()}
          <div class="mt-6">
            <h3 class="card-title" style="font-size: 22px; margin: 0;">Pending Invitations</h3>
            <p class="invite-status">Invited users keep their pre-assigned role after registration and invitation acceptance.</p>
            ${this._renderInvitationsTable()}
          </div>
        </div>
      </div>

      ${this.editingUser ? html`
        <div class="modal-overlay" @click=${this._closeEdit}>
          <div class="modal" @click=${(e) => e.stopPropagation()}>
            <div class="modal-header">
              <h3 class="modal-title">Edit Tenant User</h3>
              <button class="modal-close" @click=${this._closeEdit}>x</button>
            </div>
            <div class="modal-content">
              <div class="field">
                <span class="label">User</span>
                <div>${this.editingUser.display_name || 'No name'} (${this.editingUser.email})</div>
              </div>
              <div class="field">
                <label class="label" for="tenant-user-role">Tenant Role</label>
                <select
                  id="tenant-user-role"
                  .value=${this.editRole}
                  @change=${(e) => {
                    this.editRole = e.target.value;
                  }}
                  ?disabled=${this.saving}
                >
                  <option value="user">User</option>
                  <option value="editor">Editor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div class="modal-actions">
                <button class="btn btn-danger" @click=${this._removeUser} ?disabled=${this.saving}>
                  <i class="fas fa-user-minus mr-1"></i>Remove from Tenant
                </button>
                <div class="row-actions">
                  <button class="btn btn-secondary" @click=${this._closeEdit} ?disabled=${this.saving}>Cancel</button>
                  <button class="btn btn-primary" @click=${this._saveRole} ?disabled=${this.saving}>
                    ${this.saving ? html`<i class="fas fa-spinner fa-spin mr-1"></i>Saving...` : html`Save`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ` : html``}

      ${this.showInviteModal ? html`
        <div class="modal-overlay" @click=${this._closeInviteModal}>
          <div class="modal" @click=${(e) => e.stopPropagation()}>
            <div class="modal-header">
              <h3 class="modal-title">Invite User to Tenant</h3>
              <button class="modal-close" @click=${this._closeInviteModal}>x</button>
            </div>
            <div class="modal-content">
              <div class="field">
                <label class="label" for="invite-email">Email</label>
                <input
                  id="invite-email"
                  class="inline-input"
                  type="email"
                  .value=${this.inviteEmail}
                  @input=${(e) => { this.inviteEmail = e.target.value; }}
                  placeholder="user@example.com"
                  ?disabled=${this.inviteSubmitting}
                />
              </div>
              <div class="field">
                <label class="label" for="invite-role">Tenant Role</label>
                <select
                  id="invite-role"
                  .value=${this.inviteRole}
                  @change=${(e) => { this.inviteRole = e.target.value; }}
                  ?disabled=${this.inviteSubmitting}
                >
                  <option value="user">User</option>
                  <option value="editor">Editor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div class="hint">
                The invitee must register/sign in with the same email address. Role is applied during invitation acceptance.
              </div>
              <div class="modal-actions">
                <button class="btn btn-secondary" @click=${this._closeInviteModal} ?disabled=${this.inviteSubmitting}>Cancel</button>
                <button class="btn btn-primary" @click=${this._submitInvite} ?disabled=${this.inviteSubmitting}>
                  ${this.inviteSubmitting ? html`<i class="fas fa-spinner fa-spin mr-1"></i>Creating...` : html`Create Invite`}
                </button>
              </div>
            </div>
          </div>
        </div>
      ` : html``}
    `;
  }
}

customElements.define('tenant-users-admin', TenantUsersAdmin);
