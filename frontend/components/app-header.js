import { LitElement, html, css } from 'lit';
import { getTenants, sync, retagAll } from '../services/api.js';
import { getCurrentUser } from '../services/auth.js';
import { supabase } from '../services/supabase.js';
import { tailwind } from './tailwind-lit.js';

class AppHeader extends LitElement {
    static styles = [tailwind, css`
        :host {
            display: block;
        }
        .user-menu-container {
            position: relative;
            display: inline-block;
        }
        .user-menu-button {
            display: flex;
            align-items: center;
            gap: 8px;
            background: white;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 8px 12px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s;
        }
        .user-menu-button:hover {
            border-color: #d1d5db;
            background: #f9fafb;
        }
        .user-menu-dropdown {
            position: absolute;
            right: 0;
            top: 100%;
            margin-top: 4px;
            background: white;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            min-width: 240px;
            z-index: 50;
        }
        .user-menu-header {
            padding: 12px 16px;
            border-bottom: 1px solid #e5e7eb;
        }
        .user-email {
            font-size: 13px;
            color: #6b7280;
            margin: 4px 0 0 0;
        }
        .user-name {
            font-weight: 500;
            color: #1f2937;
        }
        .user-menu-item {
            padding: 12px 16px;
            cursor: pointer;
            font-size: 14px;
            color: #374151;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: background 0.2s;
        }
        .user-menu-item:hover {
            background: #f3f4f6;
        }
        .user-menu-item.logout {
            color: #dc2626;
            border-top: 1px solid #e5e7eb;
        }
        .user-menu-item.logout:hover {
            background: #fee2e2;
        }
    `];

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
        userMenuOpen: { type: Boolean },
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
        this.userMenuOpen = false;
        this.currentUser = null;
    }

  connectedCallback() {
      super.connectedCallback();
      this.fetchTenants();
      this.fetchEnvironment();
      this._loadSyncStatus();
      this.fetchCurrentUser();
      document.addEventListener('click', this._handleDocumentClick.bind(this));
  }

  disconnectedCallback() {
      super.disconnectedCallback();
      document.removeEventListener('click', this._handleDocumentClick.bind(this));
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
          this.tenants = await getTenants();
      } catch (error) {
          console.error('Error fetching tenants:', error);
      }
  }

  _handleDocumentClick(e) {
      const userMenu = this.shadowRoot?.querySelector('.user-menu-container');
      if (userMenu && !userMenu.contains(e.target) && !e.target.closest('.user-menu-container')) {
          this.userMenuOpen = false;
      }
  }

  _toggleUserMenu() {
      this.userMenuOpen = !this.userMenuOpen;
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
                            <label for="tenantSelect" class="text-gray-700 font-medium">Tenant:</label>
                            <select .value=${this.tenant} id="tenantSelect" class="px-4 py-2 border rounded-lg" @change=${this._switchTenant}>
                                ${this.tenants.map(tenant => html`<option value=${tenant.id}>${tenant.name}</option>`)}
                            </select>
                        </div>
                        <button @click=${this._openAdmin} class="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700" title="System Administration">
                            <i class="fas fa-cog mr-2"></i>Admin
                        </button>
                        <div class="user-menu-container">
                            <button class="user-menu-button" @click=${this._toggleUserMenu}>
                                <i class="fas fa-user-circle text-gray-600"></i>
                                <span>${this.currentUser?.user?.display_name || 'Login'}</span>
                                <i class="fas fa-chevron-down text-gray-400" style="font-size: 12px;"></i>
                            </button>
                            ${this.userMenuOpen ? html`
                                <div class="user-menu-dropdown">
                                    ${this.currentUser ? html`
                                        <div class="user-menu-header">
                                            <div class="user-name">${this.currentUser.user?.display_name || 'User'}</div>
                                            <div class="user-email">${this.currentUser.user?.email || ''}</div>
                                        </div>
                                        <div class="user-menu-item logout" @click=${this._handleLogout}>
                                            <i class="fas fa-sign-out-alt"></i>
                                            Sign Out
                                        </div>
                                    ` : html`
                                        <div style="padding: 12px 16px; text-align: center; color: #6b7280;">
                                            <p style="margin: 0; font-size: 14px;">Not logged in</p>
                                        </div>
                                        <div class="user-menu-item" @click=${() => window.location.href = '/login'}>
                                            <i class="fas fa-sign-in-alt"></i>
                                            Sign In
                                        </div>
                                    `}
                                </div>
                            ` : ''}
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
                        @click=${() => this._handleTabChange('people')}
                        class="py-3 px-6 text-base font-semibold ${this.activeTab === 'people' ? 'border-b-4 border-blue-600 text-blue-800 bg-blue-50' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'} transition-all duration-200"
                    >
                        <i class="fas fa-users mr-2"></i>People
                    </button>
                    <button
                        @click=${() => this._handleTabChange('tagging')}
                        class="py-3 px-6 text-base font-semibold ${this.activeTab === 'tagging' ? 'border-b-4 border-blue-600 text-blue-800 bg-blue-50' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'} transition-all duration-200"
                    >
                        <i class="fas fa-tags mr-2"></i>Tagging
                    </button>
                    <button
                        @click=${() => this._handleTabChange('ml-training')}
                        class="py-3 px-6 text-base font-semibold ${this.activeTab === 'ml-training' ? 'border-b-4 border-blue-600 text-blue-800 bg-blue-50' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'} transition-all duration-200"
                    >
                        <i class="fas fa-brain mr-2"></i>Pipeline
                    </button>
                    <button
                        @click=${() => this._handleTabChange('cli')}
                        class="py-3 px-6 text-base font-semibold ${this.activeTab === 'cli' ? 'border-b-4 border-blue-600 text-blue-800 bg-blue-50' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'} transition-all duration-200"
                    >
                        <i class="fas fa-terminal mr-2"></i>CLI
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
