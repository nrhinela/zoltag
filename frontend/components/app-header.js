import { LitElement, html } from 'lit';
import { getTenantsPublic } from '../services/api.js';
import { supabase } from '../services/supabase.js';
import { getStoredAppTenant } from '../services/app-storage.js';
import {
    canCurateTenant,
    canViewTenantUsers,
    hasAnyTenantUsersAccess,
    normalizeTenantRef,
    userIsSuperAdmin,
} from './shared/tenant-permissions.js';
import './app-header.css';

class AppHeader extends LitElement {
      static properties = {
        tenants: { type: Array },
        tenant: { type: String },
        activeTab: { type: String },
        currentUser: { type: Object },
        canCurate: { type: Boolean },
        tenantMenuOpen: { type: Boolean },
        userMenuOpen: { type: Boolean },
    }

    constructor() {
        super();
        this.tenants = [];
        this.activeTab = 'home'; // Default
        this.currentUser = null;
        this.canCurate = null;
        this.tenantMenuOpen = false;
        this.userMenuOpen = false;
        this._lastTenantReconcileAttempt = '';
        this._handleDocumentClick = this._handleDocumentClick.bind(this);
    }

  createRenderRoot() {
      return this;
  }

  connectedCallback() {
      super.connectedCallback();
      if (this.currentUser) {
          this._syncTenantsForCurrentUser();
      }
      document.addEventListener('click', this._handleDocumentClick);
  }

  disconnectedCallback() {
      document.removeEventListener('click', this._handleDocumentClick);
      super.disconnectedCallback();
  }

  willUpdate(changedProperties) {
      if (changedProperties.has('currentUser')) {
          this._syncTenantsForCurrentUser();
      }
  }

  updated() {
      const storedTenant = this._getStoredTenant();
      const currentTenant = this._normalizeTenantValue(this.tenant);
      if (!storedTenant || storedTenant === currentTenant) {
          return;
      }
      const reconcileKey = `${storedTenant}::${currentTenant}`;
      if (this._lastTenantReconcileAttempt === reconcileKey) {
          return;
      }
      this._lastTenantReconcileAttempt = reconcileKey;
      queueMicrotask(() => {
          this.dispatchEvent(new CustomEvent('tenant-change', {
              detail: storedTenant,
              bubbles: true,
              composed: true,
          }));
      });
  }

  async fetchTenants() {
      const fallbackTenants = this._getTenantsFromMemberships();
      if (!this._isAdmin() && fallbackTenants.length) {
          this.tenants = fallbackTenants;
          this._reconcileTenantWithStoredSelection();
          return;
      }
      try {
          const publicTenants = await getTenantsPublic();
          this.tenants = Array.isArray(publicTenants) ? publicTenants : [];
          if (!this.tenants.length && fallbackTenants.length) {
              this.tenants = fallbackTenants;
          }
          this._reconcileTenantWithStoredSelection();
      } catch (error) {
          if (fallbackTenants.length) {
              this.tenants = fallbackTenants;
              this._reconcileTenantWithStoredSelection();
              return;
          }
          console.error('Error fetching tenants:', error);
      }
  }

  _getTenantsFromMemberships() {
      const memberships = Array.isArray(this.currentUser?.tenants) ? this.currentUser.tenants : [];
      if (!memberships.length) return [];

      const seen = new Set();
      const tenants = [];
      for (const membership of memberships) {
          const tenantId = this._normalizeTenantValue(membership?.tenant_id);
          if (!tenantId || seen.has(tenantId)) continue;
          seen.add(tenantId);
          tenants.push({
              id: tenantId,
              identifier: this._normalizeTenantValue(membership?.tenant_identifier),
              name: this._normalizeTenantValue(membership?.tenant_name) || tenantId,
              active: true,
          });
      }
      return tenants;
  }

  _syncTenantsForCurrentUser() {
      const membershipTenants = this._getTenantsFromMemberships();
      if (membershipTenants.length) {
          this.tenants = membershipTenants;
      } else if (!this._isAdmin()) {
          this.tenants = [];
      }
      this._reconcileTenantWithStoredSelection();
      if (this._isAdmin()) {
          this.fetchTenants();
      }
  }

  _reconcileTenantWithStoredSelection() {
      const storedTenant = this._getStoredTenant();
      const currentTenant = this._normalizeTenantValue(this.tenant);
      if (!storedTenant || storedTenant === currentTenant) return;
      this.dispatchEvent(new CustomEvent('tenant-change', {
          detail: storedTenant,
          bubbles: true,
          composed: true,
      }));
  }

  _handleUserMenuAction(value) {
      this.userMenuOpen = false;
      if (value === 'public-site') {
          window.location.href = '/';
      } else if (value === 'manage-users') {
          this.dispatchEvent(new CustomEvent('tab-change', {
              detail: { tab: 'library', subTab: 'users' },
              bubbles: true,
              composed: true,
          }));
      } else if (value === 'admin') {
          this._openAdmin();
      } else if (value === 'logout') {
          this._handleLogout();
      }
  }

  _isAdmin() {
      return userIsSuperAdmin(this.currentUser);
  }

  _canCurateFromUser() {
      return canCurateTenant(this.currentUser, this._getEffectiveTenantId());
  }

  _canManageTenantUsersFromUser() {
      return canViewTenantUsers(this.currentUser, this._getEffectiveTenantId());
  }

  _canOpenSystemAdmin() {
      return this._isAdmin() || hasAnyTenantUsersAccess(this.currentUser);
  }

  async _handleLogout() {
      try {
          await supabase.auth.signOut();
          localStorage.removeItem('zoltag_user');
          window.location.href = '/login';
      } catch (error) {
          console.error('Logout error:', error);
      }
  }

  _openAdmin() {
      window.location.href = '/admin';
  }

  _formatTenantLabel(tenant) {
      if (!tenant) return '';
      const name = this._normalizeTenantValue(tenant.name);
      const id = this._normalizeTenantValue(tenant.id);
      if (name) return name;
      return id;
  }

  _normalizeTenantValue(value) {
      return normalizeTenantRef(value);
  }

  _getStoredTenant() {
      return this._normalizeTenantValue(getStoredAppTenant());
  }

  _getEffectiveTenantId() {
      return this._getStoredTenant() || this._normalizeTenantValue(this.tenant);
  }

  _getTenantDisplayLabel(tenantId) {
      const normalizedId = this._normalizeTenantValue(tenantId);
      if (!normalizedId) return 'Select Tenant';
      const match = this.tenants.find((tenant) => this._normalizeTenantValue(tenant.id) === normalizedId);
      if (!match) return `${normalizedId} (not in tenant list)`;
      return this._formatTenantLabel(match);
  }

  _handleTenantMenuSelect(tenantId) {
      const nextTenant = this._normalizeTenantValue(tenantId);
      const currentTenant = this._normalizeTenantValue(this.tenant);
      this.tenantMenuOpen = false;
      if (!nextTenant || nextTenant === currentTenant) return;
      this.dispatchEvent(new CustomEvent('tenant-change', { detail: nextTenant, bubbles: true, composed: true }));
      this.userMenuOpen = false;
  }

  _toggleTenantMenu(event) {
      event?.stopPropagation?.();
      if (!this.userMenuOpen) return;
      this.tenantMenuOpen = !this.tenantMenuOpen;
  }

  _toggleUserMenu(event) {
      event?.stopPropagation?.();
      const nextOpen = !this.userMenuOpen;
      this.userMenuOpen = nextOpen;
      if (!nextOpen) {
          this.tenantMenuOpen = false;
      }
  }

  _handleDocumentClick(event) {
      if (!this.userMenuOpen && !this.tenantMenuOpen) return;
      const target = event?.target;
      if (target && this.contains(target)) return;
      this.tenantMenuOpen = false;
      this.userMenuOpen = false;
  }

  _getUserDisplayName() {
      return this.currentUser?.user?.display_name
          || this.currentUser?.user?.email?.split('@')?.[0]
          || 'User';
  }

  _getUserEmail() {
      return this.currentUser?.user?.email || '';
  }

  _getUserAvatarLetter() {
      const name = this._getUserDisplayName().trim();
      return name ? name.charAt(0).toUpperCase() : 'U';
  }

  _hashString(value) {
      let hash = 0;
      for (let i = 0; i < value.length; i += 1) {
          hash = ((hash << 5) - hash) + value.charCodeAt(i);
          hash |= 0;
      }
      return Math.abs(hash);
  }

  _getUserAvatarStyle() {
      const seed = `${this._getUserDisplayName()}|${this._getUserEmail()}`;
      const hash = this._hashString(seed);
      const hueA = hash % 360;
      const hueB = (hueA + 45 + (hash % 70)) % 360;
      return `background: linear-gradient(135deg, hsl(${hueA} 78% 56%), hsl(${hueB} 78% 46%));`;
  }

  render() {
    const canCurate = this.canCurate ?? this._canCurateFromUser();
    const canManageTenantUsers = this._canManageTenantUsersFromUser();
    const canOpenSystemAdmin = this._canOpenSystemAdmin();
    const libraryActive = this.activeTab === 'library';
    const topNavItems = [
      { tab: 'search', label: 'Explore', active: this.activeTab === 'search' },
      { tab: 'lists', label: 'Lists', active: this.activeTab === 'lists' },
      ...(canCurate ? [{ tab: 'curate', label: 'Curate', active: this.activeTab === 'curate' }] : []),
      { tab: 'library', label: 'Admin', active: libraryActive },
    ];
    const userDisplayName = this._getUserDisplayName();
    const userEmail = this._getUserEmail();
    const selectedTenant = this._getEffectiveTenantId();
    const tenantMissingFromList = !!selectedTenant
      && !this.tenants.some((tenant) => this._normalizeTenantValue(tenant.id) === selectedTenant);
    const tenantOptions = tenantMissingFromList
      ? [{ id: selectedTenant, name: `${selectedTenant} (not in tenant list)` }, ...(this.tenants || [])]
      : (this.tenants || []);
    return html`
        <nav class="bg-white shadow-lg border-b border-gray-200">
            <div class="max-w-7xl mx-auto px-4 py-3">
                <div class="flex items-center justify-between gap-4">
                    <div class="flex items-center gap-6 min-w-0">
                        <a
                            href="#"
                            class="flex items-center space-x-2 shrink-0 text-left no-underline"
                            @click=${(event) => {
                              event.preventDefault();
                              this._handleTabChange('home');
                            }}
                            title="Home"
                        >
                            <i class="fas fa-camera text-blue-600 text-2xl"></i>
                            <h1 class="text-2xl font-bold text-gray-800">Zoltag</h1>
                        </a>
                        <nav class="inline-flex items-center overflow-x-auto whitespace-nowrap" aria-label="Primary navigation">
                            ${topNavItems.map((item) => html`
                              <a
                                href="#"
                                class="inline-flex items-center px-6 py-3 text-base font-semibold transition-colors ${item.active ? 'text-blue-800' : 'text-gray-600 hover:text-gray-800'}"
                                style=${`text-decoration:none;border-bottom:4px solid ${item.active ? '#2563eb' : 'transparent'};`}
                                @click=${(event) => {
                                  event.preventDefault();
                                  this._handleTabChange(item.tab);
                                }}
                              >
                                <span>${item.label}</span>
                              </a>
                            `)}
                        </nav>
                    </div>
                    <div class="relative shrink-0">
                        <button
                            type="button"
                            class="inline-flex items-center justify-center h-10 w-10 rounded-full text-white text-lg font-semibold shadow-sm ring-1 ring-black/10 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            style=${this._getUserAvatarStyle()}
                            aria-haspopup="menu"
                            aria-expanded=${this.userMenuOpen ? 'true' : 'false'}
                            @click=${this._toggleUserMenu}
                            title=${this._getUserDisplayName()}
                        >
                            ${this._getUserAvatarLetter()}
                        </button>
                        ${this.userMenuOpen ? html`
                            <div class="absolute right-0 mt-2 min-w-[320px] max-w-[80vw] bg-white border border-gray-200 rounded-lg shadow-lg z-50" role="menu">
                                <div class="px-3 py-2 border-b border-gray-100">
                                    <div class="text-sm font-semibold text-gray-800 truncate" title=${userDisplayName}>
                                        ${userDisplayName}
                                    </div>
                                    ${userEmail ? html`
                                        <div class="text-xs text-gray-500 truncate mt-0.5" title=${userEmail}>
                                            ${userEmail}
                                        </div>
                                    ` : html``}
                                </div>
                                <div class="px-3 py-2 border-b border-gray-100 relative">
                                    <button
                                        type="button"
                                        class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center justify-between gap-2"
                                        aria-haspopup="listbox"
                                        aria-expanded=${this.tenantMenuOpen ? 'true' : 'false'}
                                        @click=${this._toggleTenantMenu}
                                    >
                                        <span class="truncate">${this._getTenantDisplayLabel(selectedTenant)}</span>
                                        <i class="fas fa-chevron-down text-xs text-gray-500"></i>
                                    </button>
                                    ${this.tenantMenuOpen ? html`
                                        <div class="absolute left-3 right-3 mt-1 max-h-72 overflow-auto bg-white border border-gray-200 rounded-lg shadow-lg z-50" role="listbox">
                                            ${tenantOptions.length ? tenantOptions.map((tenant) => {
                                                const tenantId = this._normalizeTenantValue(tenant.id);
                                                const isSelected = tenantId === selectedTenant;
                                                return html`
                                                    <button
                                                        type="button"
                                                        class="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${isSelected ? 'bg-blue-50 text-blue-900' : 'text-gray-800'}"
                                                        aria-selected=${isSelected ? 'true' : 'false'}
                                                        @click=${() => this._handleTenantMenuSelect(tenantId)}
                                                    >
                                                        ${this._formatTenantLabel(tenant)}
                                                    </button>
                                                `;
                                            }) : html`
                                                <div class="px-3 py-2 text-sm text-gray-500">No tenants available.</div>
                                            `}
                                        </div>
                                    ` : html``}
                                </div>
                                ${canManageTenantUsers ? html`
                                    <button
                                        type="button"
                                        class="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 text-gray-800"
                                        @click=${() => this._handleUserMenuAction('manage-users')}
                                    >Manage users</button>
                                ` : html``}
                                ${canOpenSystemAdmin ? html`
                                    <button
                                        type="button"
                                        class="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 text-gray-800"
                                        @click=${() => this._handleUserMenuAction('admin')}
                                    >System Administration</button>
                                ` : html``}
                                <button
                                    type="button"
                                    class="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 text-gray-800"
                                    @click=${() => this._handleUserMenuAction('public-site')}
                                >Back to public site</button>
                                <button
                                    type="button"
                                    class="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 text-red-700 border-t border-gray-100"
                                    @click=${() => this._handleUserMenuAction('logout')}
                                >Sign Out</button>
                            </div>
                        ` : html``}
                    </div>
                </div>
            </div>
        </nav>
    `;
  }

  _handleTabChange(tabName) {
      this.dispatchEvent(new CustomEvent('tab-change', { detail: tabName, bubbles: true, composed: true }));
  }
}

customElements.define('app-header', AppHeader);
