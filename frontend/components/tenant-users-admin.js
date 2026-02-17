import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import {
  getTenantUsers,
  updateTenantUserRole,
  removeTenantUserMembership,
  createTenantInvitation,
  getTenantInvitations,
  cancelTenantInvitation,
  getTenantRoles,
  getTenantPermissionCatalog,
  createTenantRole,
  updateTenantRole,
  deleteTenantRole,
} from '../services/api.js';

class TenantUsersAdmin extends LitElement {
  static properties = {
    tenant: { type: String },
    tenantName: { type: String },
    canView: { type: Boolean },
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
    roles: { type: Array },
    permissionCatalog: { type: Array },
    rolesLoading: { type: Boolean },
    showRoleModal: { type: Boolean },
    editingRole: { type: Object },
    roleFormKey: { type: String },
    roleFormLabel: { type: String },
    roleFormDescription: { type: String },
    roleFormActive: { type: Boolean },
    roleFormPermissions: { type: Array },
    roleSubmitting: { type: Boolean },
    roleDeleting: { type: Boolean },
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
        max-height: 90vh;
        display: flex;
        flex-direction: column;
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
        overflow-y: auto;
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

      .section-header {
        margin-top: 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .section-title {
        margin: 0;
        font-size: 22px;
        font-weight: 700;
        color: #111827;
      }

      .checkbox-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
        gap: 8px;
        margin-top: 8px;
      }

      .checkbox-row {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 8px;
      }

      .checkbox-row input {
        margin-top: 2px;
      }

      .checkbox-label {
        font-size: 13px;
        color: #111827;
      }

      .checkbox-hint {
        display: block;
        font-size: 11px;
        color: #6b7280;
        margin-top: 2px;
      }

      .permissions-scroll {
        max-height: min(42vh, 360px);
        overflow-y: auto;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 8px;
        background: #f9fafb;
      }
    `,
  ];

  constructor() {
    super();
    this.tenant = '';
    this.tenantName = '';
    this.canView = false;
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
    this.roles = [];
    this.permissionCatalog = [];
    this.rolesLoading = false;
    this.showRoleModal = false;
    this.editingRole = null;
    this.roleFormKey = '';
    this.roleFormLabel = '';
    this.roleFormDescription = '';
    this.roleFormActive = true;
    this.roleFormPermissions = [];
    this.roleSubmitting = false;
    this.roleDeleting = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadData();
  }

  updated(changedProperties) {
    if (changedProperties.has('tenant') || changedProperties.has('canManage') || changedProperties.has('canView')) {
      this._loadData();
    }
  }

  async _loadData() {
    await Promise.all([
      this._loadUsers(),
      this._loadInvitations(),
      this._loadRoles(),
    ]);
  }

  _isAdminProtected(user) {
    if (!user) return true;
    return Boolean(user.is_super_admin);
  }

  _normalizeRole(role) {
    return String(role || 'user').trim().toLowerCase();
  }

  _effectiveRoleValue(entity) {
    const roleKey = String(entity?.role_key || '').trim();
    if (roleKey) return roleKey;
    return this._normalizeRole(entity?.role);
  }

  _roleLabel(role) {
    const normalized = this._normalizeRole(role);
    if (normalized === 'admin') return 'Admin';
    if (normalized === 'editor') return 'Editor';
    return 'User';
  }

  _roleBadgeClass(role) {
    const normalized = this._normalizeRole(role);
    if (normalized === 'admin') return 'badge-admin';
    if (normalized === 'editor') return 'badge-editor';
    return 'badge-user';
  }

  _roleDisplayLabel(entity) {
    const explicit = String(entity?.role_label || '').trim();
    if (explicit) return explicit;
    const roleValue = this._effectiveRoleValue(entity);
    return this._roleLabel(roleValue);
  }

  _activeRoles() {
    const roles = Array.isArray(this.roles) ? this.roles : [];
    return roles.filter((role) => role?.is_active !== false);
  }

  _activeRolesOrFallback() {
    const activeRoles = this._activeRoles();
    if (activeRoles.length) return activeRoles;
    return [
      { role_key: 'user', label: 'User' },
      { role_key: 'editor', label: 'Editor' },
      { role_key: 'admin', label: 'Admin' },
    ];
  }

  _legacyAssignableRoles() {
    const allowed = new Set(['user', 'editor', 'admin']);
    const available = this._activeRoles().filter((role) => allowed.has(this._normalizeRole(role?.role_key)));
    if (available.length) return available;
    return [
      { role_key: 'user', label: 'User' },
      { role_key: 'editor', label: 'Editor' },
      { role_key: 'admin', label: 'Admin' },
    ];
  }

  async _loadUsers() {
    if (!this.tenant || !this.canView) {
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
    if (!this.tenant || !this.canView) {
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

  async _loadRoles() {
    if (!this.tenant || !this.canManage) {
      this.roles = [];
      this.permissionCatalog = [];
      this.rolesLoading = false;
      return;
    }
    this.rolesLoading = true;
    try {
      const [rolesResult, catalogResult] = await Promise.all([
        getTenantRoles(this.tenant, { includeInactive: true }),
        getTenantPermissionCatalog(this.tenant),
      ]);
      this.roles = Array.isArray(rolesResult?.roles) ? rolesResult.roles : [];
      this.permissionCatalog = Array.isArray(catalogResult?.permissions) ? catalogResult.permissions : [];
    } catch (error) {
      console.error('Failed to load tenant roles:', error);
      this.error = error.message || 'Failed to load role configuration';
      this.roles = [];
      this.permissionCatalog = [];
    } finally {
      this.rolesLoading = false;
    }
  }

  _formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  _openEdit(user) {
    if (!this.canManage || !user || this._isAdminProtected(user)) return;
    this.editingUser = user;
    this.editRole = this._effectiveRoleValue(user);
    this.error = '';
  }

  _closeEdit() {
    this.editingUser = null;
    this.saving = false;
  }

  async _saveRole() {
    if (!this.canManage || !this.editingUser) return;
    this.saving = true;
    this.error = '';
    try {
      await updateTenantUserRole(this.tenant, this.editingUser.supabase_uid, { role_key: this.editRole });
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
    if (!this.canManage) return;
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
      this.inviteLink = '';
      const result = await createTenantInvitation(this.tenant, email, this._normalizeRole(this.inviteRole || 'user'));
      const token = String(result?.token || '').trim();
      const apiInvitationLink = String(result?.invitation_link || '').trim();
      this.inviteLink = apiInvitationLink || (token ? this._buildInvitationLink(token) : '');
      this._closeInviteModal();
      await this._loadData();
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

  _openRoleModal(role = null) {
    if (!this.canManage) return;
    this.editingRole = role || null;
    this.roleFormKey = String(role?.role_key || '').trim();
    this.roleFormLabel = String(role?.label || '').trim();
    this.roleFormDescription = String(role?.description || '').trim();
    this.roleFormActive = role?.is_active !== false;
    this.roleFormPermissions = Array.isArray(role?.permission_keys) ? [...role.permission_keys] : [];
    this.showRoleModal = true;
    this.roleSubmitting = false;
    this.roleDeleting = false;
    this.error = '';
  }

  _closeRoleModal() {
    this.showRoleModal = false;
    this.editingRole = null;
    this.roleSubmitting = false;
    this.roleDeleting = false;
  }

  _toggleRolePermission(permissionKey, checked) {
    const key = String(permissionKey || '').trim();
    if (!key) return;
    const next = new Set(this.roleFormPermissions || []);
    if (checked) {
      next.add(key);
    } else {
      next.delete(key);
    }
    this.roleFormPermissions = Array.from(next);
  }

  _permissionGroups() {
    const grouped = new Map();
    for (const permission of (this.permissionCatalog || [])) {
      const category = String(permission?.category || 'other').trim() || 'other';
      const bucket = grouped.get(category) || [];
      bucket.push(permission);
      grouped.set(category, bucket);
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));
  }

  async _saveRoleDefinition() {
    if (!this.canManage) return;
    const roleKey = String(this.roleFormKey || '').trim().toLowerCase();
    const label = String(this.roleFormLabel || '').trim();
    if (!this.editingRole && !roleKey) {
      this.error = 'Role key is required';
      return;
    }
    if (!label) {
      this.error = 'Role label is required';
      return;
    }

    const payload = {
      label,
      description: String(this.roleFormDescription || '').trim(),
      is_active: !!this.roleFormActive,
      permission_keys: Array.isArray(this.roleFormPermissions) ? this.roleFormPermissions : [],
    };
    if (!this.editingRole) {
      payload.role_key = roleKey;
    }

    this.roleSubmitting = true;
    this.error = '';
    try {
      if (this.editingRole?.id) {
        await updateTenantRole(this.tenant, this.editingRole.id, payload);
      } else {
        await createTenantRole(this.tenant, payload);
      }
      await this._loadRoles();
      await this._loadUsers();
      this._closeRoleModal();
    } catch (error) {
      console.error('Failed to save role definition:', error);
      this.error = error.message || 'Failed to save role definition';
      this.roleSubmitting = false;
    }
  }

  async _deleteRoleDefinition() {
    if (!this.canManage || !this.editingRole?.id || this.editingRole?.is_system) return;
    const memberCount = Number(this.editingRole?.member_count || 0);
    if (memberCount > 0) {
      this.error = 'Cannot delete a role while it is assigned to users.';
      return;
    }
    const roleLabel = String(this.editingRole?.label || this.editingRole?.role_key || 'this role').trim();
    const confirmed = confirm(`Delete role "${roleLabel}"?`);
    if (!confirmed) return;
    this.roleDeleting = true;
    this.error = '';
    try {
      await deleteTenantRole(this.tenant, this.editingRole.id);
      await this._loadRoles();
      await this._loadUsers();
      this._closeRoleModal();
    } catch (error) {
      console.error('Failed to delete role definition:', error);
      this.error = error.message || 'Failed to delete role';
      this.roleDeleting = false;
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
                  <span class="badge ${this._roleBadgeClass(invitation.role)}">
                    ${this._roleLabel(invitation.role)}
                  </span>
                </td>
                <td>${this._formatDate(invitation.created_at)}</td>
                <td>${this._formatDate(invitation.expires_at)}</td>
                <td>
                  ${this.canManage ? html`
                    <button
                      class="btn btn-danger btn-small"
                      @click=${() => this._cancelInvitation(invitation)}
                    >
                      Cancel
                    </button>
                  ` : html`<span class="hint">Read-only</span>`}
                </td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    `;
  }

  _renderRolesTable() {
    if (!this.canManage) return html``;
    if (this.rolesLoading) {
      return html`<div class="loading"><i class="fas fa-spinner fa-spin mr-2"></i>Loading roles...</div>`;
    }
    if (!this.roles.length) {
      return html`<div class="empty">No tenant roles found.</div>`;
    }
    return html`
      <div class="table-wrap invite-table">
        <table>
          <thead>
            <tr>
              <th>Role</th>
              <th>Key</th>
              <th>Status</th>
              <th>Members</th>
              <th>Permissions</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${this.roles.map((role) => html`
              <tr>
                <td><span class="name">${role.label || role.role_key}</span></td>
                <td><span class="email">${role.role_key}</span></td>
                <td>
                  <span class="badge ${role.is_active ? 'badge-approved' : 'badge-disabled'}">
                    ${role.is_active ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td>${Number(role.member_count || 0)}</td>
                <td>${Array.isArray(role.permission_keys) ? role.permission_keys.length : 0}</td>
                <td>
                  <button class="btn btn-primary btn-small" @click=${() => this._openRoleModal(role)}>
                    Edit
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
              const canEdit = this.canManage && !protectedAdmin;
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
                    <span class="badge ${this._roleBadgeClass(this._effectiveRoleValue(user))}">
                      ${this._roleDisplayLabel(user)}
                    </span>
                  </td>
                  <td>${this._formatDate(user.created_at)}</td>
                  <td>
                    <div class="row-actions">
                      <button
                        class="btn btn-primary"
                        ?disabled=${!canEdit}
                        @click=${() => this._openEdit(user)}
                        title=${canEdit ? 'Edit user' : (protectedAdmin ? 'Admin users are visible but cannot be edited here' : 'Insufficient permission')}
                      >
                        <i class="fas fa-pen mr-1"></i>Edit
                      </button>
                    </div>
                    ${!canEdit ? html`<div class="hint mt-1">${protectedAdmin ? 'Admin user (read-only)' : 'Read-only for your role'}</div>` : ''}
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
    if (!this.canView) {
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
              You do not have permission to view tenant users.
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
            <p class="card-subtitle">Manage users assigned to tenant <strong>${this.tenantName || this.tenant}</strong>.</p>
          </div>
          <div class="header-actions">
            ${this.canManage ? html`
              <button class="invite-btn" @click=${this._openInviteModal}>
                <i class="fas fa-user-plus mr-1"></i>Invite User
              </button>
            ` : html``}
            <button class="refresh-btn" @click=${this._loadData} ?disabled=${this.loading || this.invitationsLoading}>
              <i class="fas fa-rotate-right mr-1"></i>Refresh
            </button>
          </div>
        </div>
        <div class="card-content">
          ${this.error ? html`<div class="error">${this.error}</div>` : ''}
          ${!this.canManage ? html`
            <div class="hint mb-3">Read only for your role.</div>
          ` : html``}
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
          ${this.canManage ? html`
            <div class="section-header">
              <h3 class="section-title">Roles & Permissions</h3>
              <button class="btn btn-primary btn-small" @click=${() => this._openRoleModal(null)}>
                <i class="fas fa-plus mr-1"></i>New Role
              </button>
            </div>
            <div class="invite-status">Manage tenant role labels and permission mappings.</div>
            ${this._renderRolesTable()}
          ` : html``}
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
                  ${this._activeRolesOrFallback().map((role) => html`
                    <option value=${role.role_key}>${role.label || role.role_key}</option>
                  `)}
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

      ${this.showRoleModal ? html`
        <div class="modal-overlay" @click=${this._closeRoleModal}>
          <div class="modal" @click=${(e) => e.stopPropagation()}>
            <div class="modal-header">
              <h3 class="modal-title">${this.editingRole ? 'Edit Role' : 'Create Role'}</h3>
              <button class="modal-close" @click=${this._closeRoleModal}>x</button>
            </div>
            <div class="modal-content">
              <div class="field">
                <label class="label" for="role-key">Role Key</label>
                <input
                  id="role-key"
                  class="inline-input"
                  .value=${this.roleFormKey}
                  @input=${(e) => { this.roleFormKey = e.target.value; }}
                  placeholder="example: reviewer"
                  ?disabled=${this.roleSubmitting || !!this.editingRole?.is_system || !!this.editingRole}
                />
                <div class="hint">Lowercase key used for assignment. System role keys are fixed.</div>
              </div>
              <div class="field">
                <label class="label" for="role-label">Label</label>
                <input
                  id="role-label"
                  class="inline-input"
                  .value=${this.roleFormLabel}
                  @input=${(e) => { this.roleFormLabel = e.target.value; }}
                  placeholder="Role label"
                  ?disabled=${this.roleSubmitting}
                />
              </div>
              <div class="field">
                <label class="label" for="role-description">Description</label>
                <input
                  id="role-description"
                  class="inline-input"
                  .value=${this.roleFormDescription}
                  @input=${(e) => { this.roleFormDescription = e.target.value; }}
                  placeholder="Optional description"
                  ?disabled=${this.roleSubmitting}
                />
              </div>
              <div class="field">
                <label class="label" for="role-active">Status</label>
                <select
                  id="role-active"
                  .value=${this.roleFormActive ? 'active' : 'inactive'}
                  @change=${(e) => { this.roleFormActive = e.target.value === 'active'; }}
                  ?disabled=${this.roleSubmitting}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div class="field">
                <span class="label">Permissions</span>
                <div class="permissions-scroll">
                  ${this._permissionGroups().map(([category, permissions]) => html`
                    <div class="hint" style="font-weight: 700; text-transform: uppercase; margin-top: 10px;">${category}</div>
                    <div class="checkbox-grid">
                      ${permissions.map((permission) => {
                        const key = String(permission?.key || '').trim();
                        const checked = (this.roleFormPermissions || []).includes(key);
                        return html`
                          <label class="checkbox-row">
                            <input
                              type="checkbox"
                              .checked=${checked}
                              @change=${(e) => this._toggleRolePermission(key, e.target.checked)}
                              ?disabled=${this.roleSubmitting}
                            />
                            <span class="checkbox-label">
                              ${key}
                              <span class="checkbox-hint">${permission.description || ''}</span>
                            </span>
                          </label>
                        `;
                      })}
                    </div>
                  `)}
                </div>
              </div>
              <div class="modal-actions">
                ${(this.editingRole && !this.editingRole.is_system) ? html`
                  <button
                    class="btn btn-danger"
                    @click=${this._deleteRoleDefinition}
                    ?disabled=${this.roleSubmitting || this.roleDeleting || Number(this.editingRole?.member_count || 0) > 0}
                    title=${Number(this.editingRole?.member_count || 0) > 0 ? 'Role is assigned to users' : 'Delete role'}
                  >
                    ${this.roleDeleting ? html`<i class="fas fa-spinner fa-spin mr-1"></i>Deleting...` : html`Delete`}
                  </button>
                ` : html`<span></span>`}
                <div class="row-actions">
                  <button class="btn btn-secondary" @click=${this._closeRoleModal} ?disabled=${this.roleSubmitting || this.roleDeleting}>Cancel</button>
                  <button class="btn btn-primary" @click=${this._saveRoleDefinition} ?disabled=${this.roleSubmitting || this.roleDeleting}>
                  ${this.roleSubmitting ? html`<i class="fas fa-spinner fa-spin mr-1"></i>Saving...` : html`Save`}
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
                  ${this._legacyAssignableRoles().map((role) => html`
                    <option value=${this._normalizeRole(role.role_key)}>
                      ${role.label || this._roleLabel(role.role_key)}
                    </option>
                  `)}
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
