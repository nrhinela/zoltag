import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import './admin-tabs.js';
import {
  disconnectIntegration,
  getIntegrationStatus,
  startIntegrationConnect,
  updateIntegrationConfig,
} from '../services/api.js';

const PROVIDER_LABELS = {
  dropbox: 'Dropbox',
  gdrive: 'Google Drive',
};

function normalizeProviderId(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'google-drive' || normalized === 'google_drive' || normalized === 'drive') {
    return 'gdrive';
  }
  if (normalized === 'dropbox' || normalized === 'gdrive') {
    return normalized;
  }
  return '';
}

export class LibraryIntegrationsAdmin extends LitElement {
  static properties = {
    tenant: { type: String },
    status: { type: Object },
    loading: { type: Boolean },
    connecting: { type: Boolean },
    disconnecting: { type: Boolean },
    savingConfig: { type: Boolean },
    settingDefault: { type: Boolean },
    errorMessage: { type: String },
    successMessage: { type: String },
    activeProvider: { type: String },
    defaultSourceProvider: { type: String },
    providers: { type: Array },
    syncFoldersByProvider: { type: Object },
    newSyncFolder: { type: String },
    editingFolderIndex: { type: Number },
    editingFolderValue: { type: String },
  };

  static styles = [
    tailwind,
    css`
      :host {
        display: block;
      }

      .card {
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 14px;
        padding: 18px;
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 14px;
      }

      .title {
        margin: 0;
        color: #111827;
        font-size: 18px;
        font-weight: 700;
      }

      .subtitle {
        margin: 4px 0 0;
        color: #6b7280;
        font-size: 13px;
      }

      .status-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 10px;
        margin-bottom: 14px;
      }

      .status-chip {
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 10px 12px;
        background: #f9fafb;
      }

      .status-chip-active {
        border-color: #2563eb;
        background: #eff6ff;
      }

      .status-chip-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .status-chip-label {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: #111827;
        font-size: 14px;
        font-weight: 700;
      }

      .status-dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: #9ca3af;
      }

      .status-dot-connected {
        background: #16a34a;
      }

      .status-dot-disconnected {
        background: #dc2626;
      }

      .status-chip-value {
        margin-top: 6px;
        color: #4b5563;
        font-size: 12px;
      }

      .provider-row {
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 14px;
      }

      .provider-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .provider-title {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 16px;
        font-weight: 700;
        color: #1f2937;
      }

      .provider-meta {
        margin-top: 10px;
        color: #4b5563;
        font-size: 13px;
        line-height: 1.45;
      }

      .issues {
        margin-top: 10px;
        color: #b45309;
        font-size: 12px;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 14px;
      }

      .pill {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 5px 10px;
        font-size: 12px;
        font-weight: 700;
      }

      .pill-default {
        background: #dbeafe;
        color: #1e40af;
      }

      .config-panel {
        margin-top: 16px;
        border-top: 1px solid #e5e7eb;
        padding-top: 14px;
      }

      .config-title {
        margin: 0 0 10px;
        color: #1f2937;
        font-size: 14px;
        font-weight: 700;
      }

      .field-row {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-bottom: 10px;
      }

      .field-label {
        min-width: 90px;
        color: #374151;
        font-size: 13px;
        font-weight: 600;
      }

      .field-input {
        flex: 1;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        padding: 8px 10px;
        font-size: 13px;
        color: #111827;
        background: #ffffff;
      }

      .folder-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .folder-item {
        display: flex;
        align-items: center;
        gap: 8px;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        padding: 8px;
      }

      .folder-index {
        width: 24px;
        text-align: center;
        color: #6b7280;
        font-size: 12px;
        font-weight: 700;
      }

      .folder-value {
        flex: 1;
        color: #111827;
        font-size: 13px;
        word-break: break-all;
      }

      .btn-secondary {
        background: #e5e7eb;
        color: #1f2937;
      }

      .btn-sm {
        border-radius: 8px;
        padding: 6px 9px;
        font-size: 12px;
      }

      .btn {
        border: none;
        border-radius: 10px;
        padding: 9px 14px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
      }

      .btn:disabled {
        opacity: 0.65;
        cursor: not-allowed;
      }

      .btn-primary {
        background: #2563eb;
        color: #ffffff;
      }

      .btn-danger {
        background: #dc2626;
        color: #ffffff;
      }

      .notice {
        margin-bottom: 12px;
        border-radius: 10px;
        padding: 10px 12px;
        font-size: 13px;
      }

      .notice-error {
        background: #fef2f2;
        border: 1px solid #fecaca;
        color: #991b1b;
      }

      .notice-success {
        background: #f0fdf4;
        border: 1px solid #bbf7d0;
        color: #166534;
      }

      .muted {
        color: #6b7280;
        font-size: 13px;
      }

      .loading-row {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
        padding: 8px 10px;
        border-radius: 10px;
        border: 1px solid #dbeafe;
        background: #eff6ff;
        color: #1d4ed8;
        font-size: 13px;
        font-weight: 600;
      }

      .spinner {
        width: 14px;
        height: 14px;
        border-radius: 999px;
        border: 2px solid #bfdbfe;
        border-top-color: #2563eb;
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ];

  constructor() {
    super();
    this.tenant = '';
    this.status = null;
    this.loading = false;
    this.connecting = false;
    this.disconnecting = false;
    this.savingConfig = false;
    this.settingDefault = false;
    this.errorMessage = '';
    this.successMessage = '';
    this.activeProvider = 'dropbox';
    this.defaultSourceProvider = 'dropbox';
    this.providers = [];
    this.syncFoldersByProvider = {};
    this.newSyncFolder = '';
    this.editingFolderIndex = -1;
    this.editingFolderValue = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this._applyOauthResultFromQuery();
    this._loadStatus();
  }

  updated(changedProperties) {
    if (changedProperties.has('tenant')) {
      this._loadStatus();
    }
  }

  _applyOauthResultFromQuery() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const integration = normalizeProviderId(params.get('integration'));
      if (!integration) {
        return;
      }
      const providerLabel = PROVIDER_LABELS[integration] || 'Integration';
      const result = (params.get('result') || '').trim();
      if (result === 'connected') {
        this.successMessage = `${providerLabel} connected successfully.`;
      } else if (result === 'error') {
        this.errorMessage = `${providerLabel} connection failed. Please try again.`;
      }
      params.delete('integration');
      params.delete('result');
      const nextQuery = params.toString();
      const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash || ''}`;
      window.history.replaceState({}, '', nextUrl);
    } catch (_error) {
      // ignore URL parsing errors
    }
  }

  _normalizeProviders(rawProviders) {
    if (!Array.isArray(rawProviders)) {
      return [];
    }
    return rawProviders
      .map((provider) => {
        const id = normalizeProviderId(provider?.id);
        if (!id) return null;
        return {
          id,
          label: String(provider?.label || PROVIDER_LABELS[id] || id),
          connected: !!provider?.connected,
          can_connect: !!provider?.can_connect,
          mode: String(provider?.mode || '').trim(),
          issues: Array.isArray(provider?.issues) ? provider.issues : [],
          sync_folders: Array.isArray(provider?.sync_folders) ? provider.sync_folders : [],
        };
      })
      .filter((provider) => !!provider);
  }

  _providerLabel(providerId) {
    return PROVIDER_LABELS[providerId] || providerId;
  }

  _providerModeLabel(provider) {
    if (!provider) return 'Unconfigured';
    if (provider.id === 'dropbox') {
      if (provider.mode === 'managed') return 'Managed App';
      return 'Unconfigured';
    }
    return provider.mode ? provider.mode.replace(/_/g, ' ') : 'OAuth';
  }

  _getProvider(providerId) {
    return (this.providers || []).find((provider) => provider.id === providerId) || null;
  }

  _getActiveProvider() {
    return this._getProvider(this.activeProvider);
  }

  _getProviderFolders(providerId) {
    const folders = this.syncFoldersByProvider?.[providerId];
    return Array.isArray(folders) ? [...folders] : [];
  }

  _setProviderFolders(providerId, folders) {
    const next = { ...(this.syncFoldersByProvider || {}) };
    next[providerId] = Array.isArray(folders) ? [...folders] : [];
    this.syncFoldersByProvider = next;
  }

  _resetEditState() {
    this.newSyncFolder = '';
    this.editingFolderIndex = -1;
    this.editingFolderValue = '';
  }

  _providerIconClass(providerId) {
    return providerId === 'dropbox' ? 'fab fa-dropbox' : 'fab fa-google-drive';
  }

  _syncFolderPlaceholder(providerId) {
    return providerId === 'dropbox' ? '/Photos/Events' : 'Google Drive folder ID';
  }

  async _loadStatus() {
    const tenantId = String(this.tenant || '').trim();
    if (!tenantId) {
      this.status = null;
      this.providers = [];
      this.syncFoldersByProvider = {};
      return;
    }
    this.loading = true;
    this.errorMessage = '';
    try {
      this.status = await getIntegrationStatus(tenantId);
      const providers = this._normalizeProviders(this.status?.providers || []);
      const foldersByProvider = {};
      providers.forEach((provider) => {
        foldersByProvider[provider.id] = [...provider.sync_folders];
      });
      this.providers = providers;
      this.syncFoldersByProvider = foldersByProvider;
      const defaultProvider = normalizeProviderId(this.status?.default_source_provider) || 'dropbox';
      this.defaultSourceProvider = defaultProvider;
      const activeCandidate = normalizeProviderId(this.activeProvider);
      const hasActive = providers.some((provider) => provider.id === activeCandidate);
      this.activeProvider = hasActive
        ? activeCandidate
        : (providers.find((provider) => provider.id === defaultProvider)?.id || providers[0]?.id || 'dropbox');
      this._resetEditState();
    } catch (error) {
      this.status = null;
      this.providers = [];
      this.syncFoldersByProvider = {};
      this.errorMessage = error?.message || 'Failed to load integration status';
    } finally {
      this.loading = false;
    }
  }

  _handleProviderTabChanged(event) {
    const nextProvider = normalizeProviderId(event?.detail?.tabId);
    if (!nextProvider || nextProvider === this.activeProvider) {
      return;
    }
    this.activeProvider = nextProvider;
    this.errorMessage = '';
    this._resetEditState();
  }

  async _handleConnect() {
    const tenantId = String(this.tenant || '').trim();
    const providerId = normalizeProviderId(this.activeProvider);
    if (!tenantId || !providerId || this.connecting) {
      return;
    }
    this.connecting = true;
    this.errorMessage = '';
    try {
      const returnTo = '/app?tab=library&subTab=providers';
      const redirectOrigin = window.location.origin || '';
      const result = await startIntegrationConnect(tenantId, providerId, returnTo, redirectOrigin);
      const authorizeUrl = String(result?.authorize_url || '').trim();
      if (!authorizeUrl) {
        throw new Error('Missing authorize URL');
      }
      window.location.assign(authorizeUrl);
    } catch (error) {
      const providerLabel = this._providerLabel(providerId);
      this.errorMessage = error?.message || `Failed to start ${providerLabel} connection`;
      this.connecting = false;
    }
  }

  async _handleDisconnect() {
    const tenantId = String(this.tenant || '').trim();
    const providerId = normalizeProviderId(this.activeProvider);
    if (!tenantId || !providerId || this.disconnecting) {
      return;
    }
    const providerLabel = this._providerLabel(providerId);
    const confirmed = window.confirm(`Disconnect ${providerLabel} for this tenant?`);
    if (!confirmed) {
      return;
    }
    this.disconnecting = true;
    this.errorMessage = '';
    this.successMessage = '';
    try {
      await disconnectIntegration(tenantId, providerId);
      this.successMessage = `${providerLabel} disconnected.`;
      await this._loadStatus();
    } catch (error) {
      this.errorMessage = error?.message || `Failed to disconnect ${providerLabel}`;
    } finally {
      this.disconnecting = false;
    }
  }

  async _handleSetDefaultSource() {
    const tenantId = String(this.tenant || '').trim();
    const providerId = normalizeProviderId(this.activeProvider);
    if (!tenantId || !providerId || this.settingDefault) {
      return;
    }
    this.settingDefault = true;
    this.errorMessage = '';
    this.successMessage = '';
    try {
      await updateIntegrationConfig(tenantId, {
        defaultSourceProvider: providerId,
      });
      this.defaultSourceProvider = providerId;
      this.successMessage = `${this._providerLabel(providerId)} set as default sync source.`;
      await this._loadStatus();
    } catch (error) {
      this.errorMessage = error?.message || 'Failed to set default sync source';
    } finally {
      this.settingDefault = false;
    }
  }

  _moveFolder(index, direction) {
    const providerId = normalizeProviderId(this.activeProvider);
    const current = this._getProviderFolders(providerId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
      return;
    }
    const updated = [...current];
    const [item] = updated.splice(index, 1);
    updated.splice(nextIndex, 0, item);
    this._setProviderFolders(providerId, updated);
    if (this.editingFolderIndex === index) {
      this.editingFolderIndex = nextIndex;
    }
  }

  _removeFolder(index) {
    const providerId = normalizeProviderId(this.activeProvider);
    const current = this._getProviderFolders(providerId);
    if (index < 0 || index >= current.length) {
      return;
    }
    this._setProviderFolders(
      providerId,
      current.filter((_, i) => i !== index),
    );
    if (this.editingFolderIndex === index) {
      this.editingFolderIndex = -1;
      this.editingFolderValue = '';
    }
  }

  _startEditFolder(index) {
    const providerId = normalizeProviderId(this.activeProvider);
    const current = this._getProviderFolders(providerId);
    if (index < 0 || index >= current.length) {
      return;
    }
    this.editingFolderIndex = index;
    this.editingFolderValue = String(current[index] || '');
  }

  _cancelEditFolder() {
    this.editingFolderIndex = -1;
    this.editingFolderValue = '';
  }

  _commitEditFolder(index) {
    const providerId = normalizeProviderId(this.activeProvider);
    const current = this._getProviderFolders(providerId);
    const value = String(this.editingFolderValue || '').trim();
    if (!value) {
      this.errorMessage = 'Folder path cannot be empty.';
      return;
    }
    const duplicate = current.some((folder, i) => i !== index && folder === value);
    if (duplicate) {
      this.errorMessage = 'Folder already exists in sync list.';
      return;
    }
    this._setProviderFolders(
      providerId,
      current.map((folder, i) => (i === index ? value : folder)),
    );
    this.editingFolderIndex = -1;
    this.editingFolderValue = '';
  }

  _handleAddFolder() {
    const providerId = normalizeProviderId(this.activeProvider);
    const current = this._getProviderFolders(providerId);
    const value = String(this.newSyncFolder || '').trim();
    if (!value) {
      this.errorMessage = 'Enter a folder path.';
      return;
    }
    if (current.includes(value)) {
      this.errorMessage = 'Folder already exists in sync list.';
      return;
    }
    this._setProviderFolders(providerId, [...current, value]);
    this.newSyncFolder = '';
    this.errorMessage = '';
  }

  _applyPendingNewFolder() {
    const providerId = normalizeProviderId(this.activeProvider);
    const current = this._getProviderFolders(providerId);
    const value = String(this.newSyncFolder || '').trim();
    if (!value) {
      return true;
    }
    if (current.includes(value)) {
      this.errorMessage = 'Folder already exists in sync list.';
      return false;
    }
    this._setProviderFolders(providerId, [...current, value]);
    this.newSyncFolder = '';
    return true;
  }

  async _handleSaveConfig() {
    const tenantId = String(this.tenant || '').trim();
    const providerId = normalizeProviderId(this.activeProvider);
    if (!tenantId || !providerId || this.savingConfig) {
      return;
    }
    if (!this._applyPendingNewFolder()) {
      return;
    }
    this.savingConfig = true;
    this.errorMessage = '';
    this.successMessage = '';
    try {
      await updateIntegrationConfig(tenantId, {
        provider: providerId,
        syncFolders: this._getProviderFolders(providerId),
      });
      this.successMessage = `${this._providerLabel(providerId)} sync folders saved.`;
      await this._loadStatus();
    } catch (error) {
      this.errorMessage = error?.message || 'Failed to save integration config';
    } finally {
      this.savingConfig = false;
    }
  }

  _handleResetConfig() {
    const providers = this._normalizeProviders(this.status?.providers || []);
    const foldersByProvider = {};
    providers.forEach((provider) => {
      foldersByProvider[provider.id] = [...provider.sync_folders];
    });
    this.syncFoldersByProvider = foldersByProvider;
    this._resetEditState();
    this.errorMessage = '';
  }

  render() {
    const providers = Array.isArray(this.providers) ? this.providers : [];
    const activeProvider = this._getActiveProvider();
    const activeProviderId = activeProvider?.id || 'dropbox';
    const syncFolders = this._getProviderFolders(activeProviderId);
    const isDefaultSource = activeProviderId === this.defaultSourceProvider;
    const tabs = providers.map((provider) => ({
      id: provider.id,
      label: provider.label || this._providerLabel(provider.id),
    }));

    return html`
      <div class="card">
        <div class="header">
          <div>
            <h3 class="title">Integrations</h3>
            <p class="subtitle">Connect and configure Dropbox and Google Drive for this tenant.</p>
          </div>
        </div>

        ${this.errorMessage ? html`<div class="notice notice-error">${this.errorMessage}</div>` : ''}
        ${this.successMessage ? html`<div class="notice notice-success">${this.successMessage}</div>` : ''}
        ${this.loading ? html`
          <div class="loading-row">
            <span class="spinner"></span>
            Loading integration status...
          </div>
        ` : html``}

        <div class="status-grid">
          ${providers.map((provider) => {
            const isActive = provider.id === activeProviderId;
            const connected = !!provider.connected;
            return html`
              <div class="status-chip ${isActive ? 'status-chip-active' : ''}">
                <div class="status-chip-head">
                  <div class="status-chip-label">
                    <span class="status-dot ${connected ? 'status-dot-connected' : 'status-dot-disconnected'}"></span>
                    ${provider.label}
                  </div>
                  ${provider.id === this.defaultSourceProvider ? html`<span class="pill pill-default">Default</span>` : ''}
                </div>
                <div class="status-chip-value">${connected ? 'Connected' : 'Not connected'}</div>
              </div>
            `;
          })}
        </div>

        <div class="provider-row">
          ${tabs.length ? html`
            <admin-tabs
              .tabs=${tabs}
              .activeTab=${activeProviderId}
              @tab-changed=${this._handleProviderTabChanged}
            ></admin-tabs>
          ` : html``}

          ${activeProvider ? html`
            <div class="provider-head">
              <div class="provider-title">
                <i class="${this._providerIconClass(activeProviderId)}"></i>
                ${activeProvider.label}
                <span class="status-dot ${activeProvider.connected ? 'status-dot-connected' : 'status-dot-disconnected'}"></span>
              </div>
              ${isDefaultSource ? html`<span class="pill pill-default">Default Sync Source</span>` : html``}
            </div>
            <div class="provider-meta">
              ${this.loading ? 'Checking connection...' : `Connection mode: ${this._providerModeLabel(activeProvider)}`}
            </div>
            ${activeProvider.issues?.length ? html`
              <div class="issues">Setup notes: ${activeProvider.issues.join(', ')}</div>
            ` : html``}

            <div class="actions">
              <button
                type="button"
                class="btn btn-primary"
                ?disabled=${this.loading || this.connecting || !activeProvider.can_connect}
                @click=${this._handleConnect}
              >
                ${this.connecting
                  ? 'Redirecting...'
                  : activeProvider.connected
                    ? `Reconnect ${activeProvider.label}`
                    : `Connect ${activeProvider.label}`}
              </button>
              ${activeProvider.connected ? html`
                <button
                  type="button"
                  class="btn btn-danger"
                  ?disabled=${this.loading || this.disconnecting}
                  @click=${this._handleDisconnect}
                >
                  ${this.disconnecting ? 'Disconnecting...' : 'Disconnect'}
                </button>
              ` : html``}
              ${!isDefaultSource ? html`
                <button
                  type="button"
                  class="btn btn-secondary"
                  ?disabled=${this.loading || this.settingDefault}
                  @click=${this._handleSetDefaultSource}
                >
                  ${this.settingDefault ? 'Saving...' : 'Set As Default Sync Source'}
                </button>
              ` : html``}
            </div>
            ${!activeProvider.can_connect ? html`
              <div class="issues">
                OAuth credentials are not configured yet for ${activeProvider.label}. Legacy setup remains available in /admin.
              </div>
            ` : html``}

            <div class="config-panel">
              <h4 class="config-title">Sync Folders</h4>
              <div class="field-row">
                <span class="field-label">Add Folder</span>
                <input
                  class="field-input"
                  type="text"
                  placeholder=${this._syncFolderPlaceholder(activeProviderId)}
                  .value=${this.newSyncFolder}
                  ?disabled=${this.loading || this.savingConfig}
                  @input=${(event) => {
                    this.newSyncFolder = event.target.value || '';
                  }}
                  @keydown=${(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      this._handleAddFolder();
                    }
                  }}
                />
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  ?disabled=${this.loading || this.savingConfig}
                  @click=${this._handleAddFolder}
                >
                  Add
                </button>
              </div>
              <div class="muted" style="margin-bottom: 10px;">
                ${activeProviderId === 'dropbox'
                  ? 'Use Dropbox paths (for example: /Archive - Photo/Events).'
                  : 'Use Google Drive folder IDs for Drive source sync.'}
              </div>

              <div class="folder-list">
                ${syncFolders.length ? syncFolders.map((folder, index) => html`
                  <div class="folder-item">
                    <div class="folder-index">${index + 1}</div>
                    ${this.editingFolderIndex === index ? html`
                      <input
                        class="field-input"
                        type="text"
                        .value=${this.editingFolderValue}
                        ?disabled=${this.loading || this.savingConfig}
                        @input=${(event) => {
                          this.editingFolderValue = event.target.value || '';
                        }}
                      />
                    ` : html`<div class="folder-value">${folder}</div>`}
                    ${this.editingFolderIndex === index ? html`
                      <button
                        type="button"
                        class="btn btn-secondary btn-sm"
                        ?disabled=${this.loading || this.savingConfig}
                        @click=${() => this._commitEditFolder(index)}
                      >Save</button>
                      <button
                        type="button"
                        class="btn btn-secondary btn-sm"
                        ?disabled=${this.loading || this.savingConfig}
                        @click=${this._cancelEditFolder}
                      >Cancel</button>
                    ` : html`
                      <button
                        type="button"
                        class="btn btn-secondary btn-sm"
                        ?disabled=${this.loading || this.savingConfig}
                        @click=${() => this._startEditFolder(index)}
                      >Edit</button>
                    `}
                    <button
                      type="button"
                      class="btn btn-secondary btn-sm"
                      ?disabled=${index === 0 || this.loading || this.savingConfig}
                      @click=${() => this._moveFolder(index, -1)}
                    >Up</button>
                    <button
                      type="button"
                      class="btn btn-secondary btn-sm"
                      ?disabled=${index === syncFolders.length - 1 || this.loading || this.savingConfig}
                      @click=${() => this._moveFolder(index, 1)}
                    >Down</button>
                    <button
                      type="button"
                      class="btn btn-danger btn-sm"
                      ?disabled=${this.loading || this.savingConfig}
                      @click=${() => this._removeFolder(index)}
                    >Remove</button>
                  </div>
                `) : html`
                  <div class="muted">No folder restrictions configured. All folders will be eligible for sync.</div>
                `}
              </div>

              <div class="actions">
                <button
                  type="button"
                  class="btn btn-primary"
                  ?disabled=${this.loading || this.savingConfig}
                  @click=${this._handleSaveConfig}
                >
                  ${this.savingConfig ? 'Saving...' : 'Save Configuration'}
                </button>
                <button
                  type="button"
                  class="btn btn-secondary"
                  ?disabled=${this.loading || this.savingConfig}
                  @click=${this._handleResetConfig}
                >
                  Reset
                </button>
              </div>
            </div>
          ` : html`
            <div class="muted">No integration providers are available.</div>
          `}
        </div>
      </div>
    `;
  }
}

customElements.define('library-integrations-admin', LibraryIntegrationsAdmin);
