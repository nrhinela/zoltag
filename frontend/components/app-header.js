import { LitElement, html } from 'lit';
import { getSystemSettings, getTenantsPublic } from '../services/api.js';
import { supabase } from '../services/supabase.js';
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
        environment: { type: String },
        currentUser: { type: Object },
        canCurate: { type: Boolean },
        tenantMenuOpen: { type: Boolean },
        userMenuOpen: { type: Boolean },
    }

    constructor() {
        super();
        this.tenants = [];
        this.activeTab = 'home'; // Default
        this.environment = '...';
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
      this.fetchEnvironment();
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

  async fetchEnvironment() {
      try {
          const data = await getSystemSettings();
          this.environment = data?.environment?.toUpperCase() || 'UNKNOWN';
      } catch (error) {
          console.error('Error fetching environment:', error);
          this.environment = 'ERROR';
      }
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
      try {
          return this._normalizeTenantValue(
              localStorage.getItem('tenantId') || localStorage.getItem('currentTenant') || ''
          );
      } catch (_error) {
          return '';
      }
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

  _toggleTenantMenu(event) {
      event?.stopPropagation?.();
      this.userMenuOpen = false;
      this.tenantMenuOpen = !this.tenantMenuOpen;
  }

  _handleTenantMenuSelect(tenantId) {
      const nextTenant = this._normalizeTenantValue(tenantId);
      const currentTenant = this._normalizeTenantValue(this.tenant);
      this.tenantMenuOpen = false;
      if (!nextTenant || nextTenant === currentTenant) return;
      this.dispatchEvent(new CustomEvent('tenant-change', { detail: nextTenant, bubbles: true, composed: true }));
  }

  _toggleUserMenu(event) {
      event?.stopPropagation?.();
      this.tenantMenuOpen = false;
      this.userMenuOpen = !this.userMenuOpen;
  }

  _handleDocumentClick(event) {
      if (!this.tenantMenuOpen && !this.userMenuOpen) return;
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

  _getUserMenuIdentityLine() {
      const name = this._getUserDisplayName();
      const email = this._getUserEmail();
      return email ? `${name} - ${email}` : name;
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
    const selectedTenant = this._getEffectiveTenantId();
    const tenantMissingFromList = !!selectedTenant
      && !this.tenants.some((tenant) => this._normalizeTenantValue(tenant.id) === selectedTenant);
    return html`
        <nav class="bg-white shadow-lg">
            <div class="max-w-7xl mx-auto px-4 py-4">
                <div class="flex justify-between items-start">
                    <div class="flex items-center space-x-2">
                        <i class="fas fa-camera text-blue-600 text-2xl"></i>
                        <h1 class="text-2xl font-bold text-gray-800">Zoltag</h1>
                        <span class="text-sm px-3 py-1 rounded font-semibold text-white" style="background-color: ${this.environment === 'PROD' ? '#b91c1c' : '#16a34a'}">${this.environment}</span>
                    </div>
                    <div class="flex items-start space-x-4">
                        <div class="flex items-center space-x-2">
                            <label for="tenantSelect" class="text-gray-700 font-medium text-sm">Tenant:</label>
                            <div class="relative">
                                <button
                                    id="tenantSelect"
                                    type="button"
                                    class="px-4 py-2 border-2 border-gray-300 rounded-lg text-sm font-normal text-gray-800 focus:border-blue-500 focus:outline-none bg-white min-w-[280px] flex items-center justify-between gap-3"
                                    style="min-height: 42px;"
                                    aria-haspopup="listbox"
                                    aria-expanded=${this.tenantMenuOpen ? 'true' : 'false'}
                                    @click=${this._toggleTenantMenu}
                                >
                                    <span class="truncate">${this._getTenantDisplayLabel(selectedTenant)}</span>
                                    <i class="fas fa-chevron-down text-xs text-gray-500"></i>
                                </button>
                                ${this.tenantMenuOpen ? html`
                                    <div class="absolute left-0 mt-1 min-w-full max-w-[80vw] max-h-72 overflow-auto bg-white border border-gray-200 rounded-lg shadow-lg z-50" role="listbox">
                                        ${tenantMissingFromList ? html`
                                            <button
                                                type="button"
                                                class="w-full text-left px-3 py-2 text-sm bg-blue-50 text-blue-900 border-b border-blue-100"
                                                @click=${() => this._handleTenantMenuSelect(selectedTenant)}
                                            >
                                                ${selectedTenant} (not in tenant list)
                                            </button>
                                        ` : html``}
                                        ${this.tenants.length ? this.tenants.map((tenant) => {
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
                        </div>
                        <div class="relative">
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
                                    <div class="px-3 py-2 text-sm text-gray-800 border-b border-gray-100 truncate" title=${this._getUserMenuIdentityLine()}>
                                        ${this._getUserMenuIdentityLine()}
                                    </div>
                                    <button
                                        type="button"
                                        class="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 text-gray-800"
                                        @click=${() => this._handleUserMenuAction('public-site')}
                                    >Back to public site</button>
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
                                        class="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 text-red-700 border-t border-gray-100"
                                        @click=${() => this._handleUserMenuAction('logout')}
                                    >Sign Out</button>
                                </div>
                            ` : html``}
                        </div>
                    </div>
                </div>
            </div>
            <!-- Tab Navigation moved to a separate bar -->
            <div class="bg-gray-100 border-b border-gray-200">
                <div class="max-w-7xl mx-auto px-4">
                    <button
                        @click=${() => this._handleTabChange('home')}
                        class="py-3 px-6 text-base font-semibold ${this.activeTab === 'home' ? 'border-b-4 border-blue-600 text-blue-800 bg-blue-50' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'} transition-all duration-200"
                    >
                        <i class="fas fa-home mr-2"></i>Home
                    </button>
                    <button
                        @click=${() => this._handleTabChange('search')}
                        class="py-3 px-6 text-base font-semibold ${this.activeTab === 'search' ? 'border-b-4 border-blue-600 text-blue-800 bg-blue-50' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'} transition-all duration-200"
                    >
                        <i class="fas fa-magnifying-glass mr-2"></i>Search
                    </button>
                    <button
                        @click=${() => this._handleTabChange('lists')}
                        class="py-3 px-6 text-base font-semibold ${this.activeTab === 'lists' ? 'border-b-4 border-blue-600 text-blue-800 bg-blue-50' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'} transition-all duration-200"
                    >
                        <i class="fas fa-list mr-2"></i>Lists
                    </button>
                    ${canCurate ? html`
                    <button
                        @click=${() => this._handleTabChange('curate')}
                        class="py-3 px-6 text-base font-semibold ${this.activeTab === 'curate' ? 'border-b-4 border-blue-600 text-blue-800 bg-blue-50' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'} transition-all duration-200"
                    >
                        <i class="fas fa-star mr-2"></i>Curate
                    </button>
                    ` : html``}
                    <button
                        @click=${() => this._handleTabChange('library')}
                        class="py-3 px-6 text-base font-semibold ${libraryActive ? 'border-b-4 border-blue-600 text-blue-800 bg-blue-50' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'} transition-all duration-200"
                    >
                        <i class="fas fa-cog mr-2"></i>Admin
                    </button>
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
