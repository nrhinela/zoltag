import { LitElement, html } from 'lit';
import { getTenantsPublic, sync, retagAll } from '../services/api.js';
import { getCurrentUser } from '../services/auth.js';
import { supabase } from '../services/supabase.js';
import './app-header.css';

class AppHeader extends LitElement {
      static properties = {
        tenants: { type: Array },
        tenant: { type: String },
        activeTab: { type: String },
        isSyncing: { type: Boolean },
        syncCount: { type: Number },
        environment: { type: String },
        syncStatus: { type: String },
        lastSyncAt: { type: String },
        lastSyncCount: { type: Number },
        queueCount: { type: Number },
        currentUser: { type: Object },
    }

    constructor() {
        super();
        this.tenants = [];
        this.activeTab = 'home'; // Default
        this.isSyncing = false;
        this.syncCount = 0;
        this._stopRequested = false;
        this.environment = '...';
        this.syncStatus = 'idle';
        this.lastSyncAt = '';
        this.lastSyncCount = 0;
        this.queueCount = 0;
        this.currentUser = null;
    }

  createRenderRoot() {
      return this;
  }

  connectedCallback() {
      super.connectedCallback();
      this.fetchTenants();
      this.fetchEnvironment();
      this._loadSyncStatus();
      this.fetchCurrentUser();
  }

  async fetchCurrentUser() {
      try {
          const user = await getCurrentUser();
          this.currentUser = user;
      } catch (error) {
          console.error('Error fetching current user:', error);
          this.currentUser = null;
      }
  }

  willUpdate(changedProperties) {
      if (changedProperties.has('tenant')) {
          this._loadSyncStatus();
      }
  }

  async fetchEnvironment() {
      try {
          const response = await fetch('/api/v1/config/system');
          if (response.ok) {
              const data = await response.json();
              this.environment = data.environment?.toUpperCase() || 'UNKNOWN';
          }
      } catch (error) {
          console.error('Error fetching environment:', error);
          this.environment = 'ERROR';
      }
  }

  async fetchTenants() {
      try {
          this.tenants = await getTenantsPublic();
      } catch (error) {
          console.error('Error fetching tenants:', error);
      }
  }

  _handleUserMenuChange(e) {
      const value = e.target.value;
      if (value === 'public-site') {
          window.location.href = '/';
      } else if (value === 'admin') {
          this._openAdmin();
      } else if (value === 'logout') {
          this._handleLogout();
      }
      // Reset to default
      e.target.value = '';
  }

  _isAdmin() {
      return this.currentUser?.user?.is_super_admin || false;
  }

  async _handleLogout() {
      try {
          await supabase.auth.signOut();
          localStorage.removeItem('photocat_user');
          window.location.href = '/login';
      } catch (error) {
          console.error('Logout error:', error);
      }
  }

  _openAdmin() {
      window.location.href = '/admin';
  }

  render() {
    return html`
        <nav class="bg-white shadow-lg">
            <div class="max-w-7xl mx-auto px-4 py-4">
                <div class="flex justify-between items-start">
                    <div class="flex items-center space-x-2">
                        <i class="fas fa-camera text-blue-600 text-2xl"></i>
                        <h1 class="text-2xl font-bold text-gray-800">PhotoCat</h1>
                        <span class="text-sm px-3 py-1 rounded font-semibold text-white" style="background-color: ${this.environment === 'PROD' ? '#b91c1c' : '#16a34a'}">${this.environment}</span>
                    </div>
                    <div class="flex items-start space-x-4">
                        <div class="flex items-center space-x-2">
                            <label for="tenantSelect" class="text-gray-700 font-medium text-sm">Tenant:</label>
                            <select .value=${this.tenant} id="tenantSelect" class="px-4 py-2 border-2 border-gray-300 rounded-lg text-base font-medium focus:border-blue-500 focus:outline-none" style="min-height: 42px;" @change=${this._switchTenant}>
                                ${this.tenants.map(tenant => html`<option value=${tenant.id}>${tenant.name}</option>`)}
                            </select>
                        </div>
                        <select
                            class="px-4 py-2 text-base font-medium focus:outline-none bg-transparent"
                            style="min-height: 42px; border: none; appearance: none; cursor: pointer;"
                            @change=${this._handleUserMenuChange}
                        >
                            <option value="">${this.currentUser?.user?.display_name || 'User Menu'}</option>
                            <option value="public-site">Back to public site</option>
                            ${this._isAdmin() ? html`<option value="admin">System Administration</option>` : ''}
                            <option value="logout">Sign Out</option>
                        </select>
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
                        @click=${() => this._handleTabChange('curate')}
                        class="py-3 px-6 text-base font-semibold ${this.activeTab === 'curate' ? 'border-b-4 border-blue-600 text-blue-800 bg-blue-50' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'} transition-all duration-200"
                    >
                        <i class="fas fa-star mr-2"></i>Curate
                    </button>
                    <button
                        @click=${() => this._handleTabChange('lists')}
                        class="py-3 px-6 text-base font-semibold ${this.activeTab === 'lists' ? 'border-b-4 border-blue-600 text-blue-800 bg-blue-50' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'} transition-all duration-200"
                    >
                        <i class="fas fa-list mr-2"></i>Lists
                    </button>
                    <button
                        @click=${() => this._handleTabChange('admin')}
                        class="py-3 px-6 text-base font-semibold ${this.activeTab === 'admin' ? 'border-b-4 border-blue-600 text-blue-800 bg-blue-50' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'} transition-all duration-200"
                    >
                        <i class="fas fa-cog mr-2"></i>Admin
                    </button>
                    <button
                        @click=${() => this._handleTabChange('system')}
                        class="py-3 px-6 text-base font-semibold ${this.activeTab === 'system' ? 'border-b-4 border-blue-600 text-blue-800 bg-blue-50' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'} transition-all duration-200"
                    >
                        <i class="fas fa-sliders mr-2"></i>System
                    </button>
                    <button
                        @click=${() => this._handleTabChange('queue')}
                        class="py-3 px-6 text-base font-semibold ${this.activeTab === 'queue' ? 'border-b-4 border-blue-600 text-blue-800 bg-blue-50' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'} transition-all duration-200"
                    >
                        <i class="fas fa-stream mr-2"></i>Queue
                        <span class="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full ${this.queueCount > 0 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}">
                            ${this.queueCount}
                        </span>
                    </button>
                </div>
            </div>
        </nav>
    `;
  }

  _handleTabChange(tabName) {
      this.dispatchEvent(new CustomEvent('tab-change', { detail: tabName, bubbles: true, composed: true }));
  }

  async _sync() {
    if (this.isSyncing) return;

    this.isSyncing = true;
    this.syncCount = 0;
    this._stopRequested = false;
    this.syncStatus = 'running';
    this.lastSyncAt = '';
    this.lastSyncCount = 0;
    this._persistSyncStatus();

    try {
        let hasMore = true;

        while (hasMore && !this._stopRequested) {
            const result = await sync(this.tenant);

            if (result.processed > 0) {
                this.syncCount += result.processed;
                this.lastSyncCount = this.syncCount;
                this._persistSyncStatus();
                // Notify gallery to refresh
                this.dispatchEvent(new CustomEvent('sync-progress', {
                    detail: { count: this.syncCount, status: result.status },
                    bubbles: true,
                    composed: true
                }));
            }

            hasMore = result.has_more;

            if (!hasMore) {
                console.log(`Sync complete. Total processed: ${this.syncCount}`);
            }
        }

        if (this._stopRequested) {
            console.log(`Sync stopped by user. Processed: ${this.syncCount}`);
            this.syncStatus = 'stopped';
        }

        // Final refresh notification
        this.dispatchEvent(new CustomEvent('sync-complete', {
            detail: { count: this.syncCount },
            bubbles: true,
            composed: true
        }));
        this.syncStatus = 'complete';
        this.lastSyncAt = new Date().toISOString();
        this.lastSyncCount = this.syncCount;
        this._persistSyncStatus();

    } catch (error) {
        console.error('Failed to sync:', error);
        this.dispatchEvent(new CustomEvent('sync-error', {
            detail: { error: error.message },
            bubbles: true,
            composed: true
        }));
        this.syncStatus = 'error';
        this._persistSyncStatus();
    } finally {
        this.isSyncing = false;
        this._stopRequested = false;
    }
  }

  _stopSync() {
    console.log('Stop requested...');
    this._stopRequested = true;
  }

  _syncStorageKey() {
      return `photocat_sync_status_${this.tenant || 'default'}`;
  }

  _persistSyncStatus() {
      const payload = {
          status: this.syncStatus,
          lastSyncAt: this.lastSyncAt,
          lastSyncCount: this.lastSyncCount,
      };
      try {
          localStorage.setItem(this._syncStorageKey(), JSON.stringify(payload));
      } catch (error) {
          console.error('Failed to persist sync status:', error);
      }
  }

  _loadSyncStatus() {
      try {
          const raw = localStorage.getItem(this._syncStorageKey());
          if (!raw) {
              this.syncStatus = 'idle';
              this.lastSyncAt = '';
              this.lastSyncCount = 0;
              return;
          }
          const parsed = JSON.parse(raw);
          this.syncStatus = parsed.status || 'idle';
          this.lastSyncAt = parsed.lastSyncAt || '';
          this.lastSyncCount = parsed.lastSyncCount || 0;
          if (this.syncStatus === 'running') {
              this.syncStatus = 'interrupted';
          }
      } catch (error) {
          console.error('Failed to load sync status:', error);
      }
  }

  _getSyncLabel() {
      if (this.isSyncing || this.syncStatus === 'running') {
          return `Syncing: ${this.syncCount}`;
      }
      if (this.syncStatus === 'interrupted') {
          return `Sync interrupted (${this.lastSyncCount})`;
      }
      if (this.syncStatus === 'complete' && this.lastSyncAt) {
          const date = new Date(this.lastSyncAt).toLocaleString();
          return `Last sync: ${date} (${this.lastSyncCount})`;
      }
      if (this.syncStatus === 'stopped') {
          return `Sync stopped (${this.lastSyncCount})`;
      }
      if (this.syncStatus === 'error') {
          return 'Sync error';
      }
      return 'Sync idle';
  }

    async _retagAll() {
        try {
            await retagAll(this.tenant);
        } catch (error) {
            console.error('Failed to retag all:', error);
        }
    }

    _switchTenant(e) {
        this.dispatchEvent(new CustomEvent('tenant-change', { detail: e.target.value, bubbles: true, composed: true }));
    }

    _openAdmin() {
        window.location.href = '/admin';
    }
}

customElements.define('app-header', AppHeader);
