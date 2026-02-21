import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import {
  disconnectIntegration,
  getIntegrationStatus,
  getLiveDropboxFolders,
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
    errorMessage: { type: String },
    successMessage: { type: String },
    providers: { type: Array },
    defaultSourceProvider: { type: String },
    configureProviderId: { type: String },
    syncFoldersByProvider: { type: Object },
    newSyncFolder: { type: String },
    folderCatalogLoading: { type: Boolean },
    folderCatalogLoaded: { type: Boolean },
    folderCatalogError: { type: String },
    folderCatalog: { type: Array },
    folderCatalogTruncated: { type: Boolean },
    folderCatalogStatus: { type: String },
    folderScanDepth: { type: Number },
    editingFolderIndex: { type: Number },
    editingFolderValue: { type: String },
    updatingProviderState: { type: Boolean },
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
        align-items: flex-start;
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

      .provider-list {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 10px;
      }

      .provider-card {
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 12px;
        background: #f9fafb;
      }

      .provider-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .provider-title {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: #111827;
        font-size: 15px;
        font-weight: 700;
      }

      .provider-meta {
        margin-top: 6px;
        color: #4b5563;
        font-size: 13px;
      }

      .status-row {
        margin-top: 8px;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .status-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid #d1d5db;
        border-radius: 999px;
        padding: 3px 8px;
        font-size: 12px;
        font-weight: 600;
        color: #374151;
        background: #ffffff;
      }

      .provider-actions {
        margin-top: 12px;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .status-dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
      }

      .status-dot-connected {
        background: #16a34a;
      }

      .status-dot-disconnected {
        background: #9ca3af;
      }

      .status-dot-active {
        background: #16a34a;
      }

      .status-dot-inactive {
        background: #9ca3af;
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

      .btn-secondary {
        background: #e5e7eb;
        color: #1f2937;
      }

      .btn-sm {
        border-radius: 8px;
        padding: 6px 9px;
        font-size: 12px;
      }

      .btn-content {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .btn-spinner {
        width: 12px;
        height: 12px;
        border-radius: 999px;
        border: 2px solid rgba(255, 255, 255, 0.45);
        border-top-color: #ffffff;
        animation: spin 0.8s linear infinite;
      }

      .configure-shell {
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 14px;
      }

      .configure-title {
        margin: 0;
        color: #111827;
        font-size: 16px;
        font-weight: 700;
      }

      .configure-subtitle {
        margin: 4px 0 0;
        color: #6b7280;
        font-size: 13px;
      }

      .configure-section {
        margin-top: 16px;
        border-top: 1px solid #e5e7eb;
        padding-top: 14px;
      }

      .section-title {
        margin: 0 0 8px;
        color: #1f2937;
        font-size: 14px;
        font-weight: 700;
      }

      .muted {
        color: #6b7280;
        font-size: 13px;
      }

      .field-row {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-bottom: 8px;
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

      .folder-input-shell {
        flex: 1;
        min-width: 280px;
      }

      .folder-typeahead {
        margin-top: 6px;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        background: #ffffff;
        max-height: 220px;
        overflow-y: auto;
      }

      .folder-typeahead-row {
        border-bottom: 1px solid #f3f4f6;
      }

      .folder-typeahead-row:last-child {
        border-bottom: none;
      }

      .folder-typeahead-btn {
        width: 100%;
        border: none;
        background: #ffffff;
        text-align: left;
        padding: 8px 10px;
        font-size: 12px;
        color: #111827;
        cursor: pointer;
      }

      .folder-typeahead-btn:hover {
        background: #eff6ff;
      }

      .folder-typeahead-meta {
        margin-top: 6px;
        color: #6b7280;
        font-size: 12px;
      }

      .folder-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 10px;
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

      .actions {
        margin-top: 12px;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
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
    this.errorMessage = '';
    this.successMessage = '';
    this.providers = [];
    this.defaultSourceProvider = 'dropbox';
    this.configureProviderId = '';
    this.syncFoldersByProvider = {};
    this.newSyncFolder = '';
    this.folderCatalogLoading = false;
    this.folderCatalogLoaded = false;
    this.folderCatalogError = '';
    this.folderCatalog = [];
    this.folderCatalogTruncated = false;
    this.folderCatalogStatus = '';
    this.folderScanDepth = 5;
    this.editingFolderIndex = -1;
    this.editingFolderValue = '';
    this.updatingProviderState = false;
    this._folderLoadRunId = 0;
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
      if (!integration) return;
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
    if (!Array.isArray(rawProviders)) return [];
    return rawProviders
      .map((provider) => {
        const id = normalizeProviderId(provider?.id);
        if (!id) return null;
        return {
          id,
          label: String(provider?.label || PROVIDER_LABELS[id] || id),
          is_active: provider?.is_active !== undefined ? !!provider.is_active : true,
          connected: !!provider?.connected,
          can_connect: !!provider?.can_connect,
          mode: String(provider?.mode || '').trim(),
          issues: Array.isArray(provider?.issues) ? provider.issues : [],
          sync_folders: Array.isArray(provider?.sync_folders) ? provider.sync_folders : [],
        };
      })
      .filter((provider) => !!provider)
      .filter((provider) => provider.id === 'dropbox');
  }

  _providerLabel(providerId) {
    return PROVIDER_LABELS[providerId] || providerId;
  }

  _providerModeLabel(provider) {
    if (!provider) return 'Unconfigured';
    if (provider.id === 'dropbox') {
      return provider.mode === 'managed' ? 'Managed App' : 'Unconfigured';
    }
    return provider.mode ? provider.mode.replace(/_/g, ' ') : 'OAuth';
  }

  _renderProviderStatusRow(provider) {
    return html`
      <div class="status-row">
        <span class="status-chip">
          <span class="status-dot ${provider.connected ? 'status-dot-connected' : 'status-dot-disconnected'}"></span>
          Connection: ${provider.connected ? 'Connected' : 'Not connected'}
        </span>
        <span class="status-chip">
          <span class="status-dot ${provider.is_active ? 'status-dot-active' : 'status-dot-inactive'}"></span>
          Integration: ${provider.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>
    `;
  }

  _getProvider(providerId) {
    return (this.providers || []).find((provider) => provider.id === providerId) || null;
  }

  _sortFolderPaths(paths) {
    return [...(paths || [])]
      .filter((value) => !!String(value || '').trim())
      .sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }));
  }

  _getFolderScanDepth() {
    const raw = Number(this.folderScanDepth);
    if (!Number.isFinite(raw)) return 5;
    return Math.max(1, Math.min(Math.trunc(raw), 5));
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

  _resetEditorState() {
    this._folderLoadRunId += 1;
    this.newSyncFolder = '';
    this.folderCatalogLoading = false;
    this.folderCatalogLoaded = false;
    this.folderCatalogError = '';
    this.folderCatalog = [];
    this.folderCatalogTruncated = false;
    this.folderCatalogStatus = '';
    this.editingFolderIndex = -1;
    this.editingFolderValue = '';
  }

  async _loadStatus() {
    const tenantId = String(this.tenant || '').trim();
    if (!tenantId) {
      this.status = null;
      this.providers = [];
      this.syncFoldersByProvider = {};
      this.configureProviderId = '';
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
      this.defaultSourceProvider = normalizeProviderId(this.status?.default_source_provider) || 'dropbox';

      if (this.configureProviderId && !this._getProvider(this.configureProviderId)) {
        this.configureProviderId = '';
      }
    } catch (error) {
      this.status = null;
      this.providers = [];
      this.syncFoldersByProvider = {};
      this.errorMessage = error?.message || 'Failed to load integration status';
    } finally {
      this.loading = false;
    }
  }

  _handleAddProvider() {
    this.errorMessage = '';
    this.successMessage = '';
    this.configureProviderId = 'dropbox';
    this._resetEditorState();
  }

  _handleConfigureProvider(providerId) {
    this.errorMessage = '';
    this.successMessage = '';
    this.configureProviderId = providerId;
    this._resetEditorState();
  }

  _handleBackToProviders() {
    this.configureProviderId = '';
    this._resetEditorState();
  }

  _getFilteredCatalogOptions(providerId) {
    if (!this.folderCatalogLoaded || providerId !== 'dropbox') return [];
    const current = new Set(this._getProviderFolders(providerId));
    const query = String(this.newSyncFolder || '').trim().toLowerCase();
    return (this.folderCatalog || [])
      .filter((folder) => !current.has(folder))
      .filter((folder) => !query || folder.toLowerCase().includes(query));
  }

  _handleFolderInputChange(event) {
    this.newSyncFolder = String(event?.target?.value || '');
    this.errorMessage = '';
  }

  _handleDepthInputChange(event) {
    const next = Number(event?.target?.value);
    if (!Number.isFinite(next)) {
      this.folderScanDepth = 5;
      return;
    }
    this.folderScanDepth = Math.max(1, Math.min(Math.trunc(next), 5));
  }

  _handleFolderSuggestionSelect(folder) {
    this.newSyncFolder = String(folder || '');
    this.errorMessage = '';
  }

  async _handleConnect() {
    const tenantId = String(this.tenant || '').trim();
    const providerId = normalizeProviderId(this.configureProviderId || 'dropbox');
    if (!tenantId || !providerId || this.connecting) return;
    this.connecting = true;
    this.errorMessage = '';
    try {
      const returnTo = '/app?tab=library&subTab=providers';
      const redirectOrigin = window.location.origin || '';
      const result = await startIntegrationConnect(tenantId, providerId, returnTo, redirectOrigin);
      const authorizeUrl = String(result?.authorize_url || '').trim();
      if (!authorizeUrl) throw new Error('Missing authorize URL');
      window.location.assign(authorizeUrl);
    } catch (error) {
      this.errorMessage = error?.message || `Failed to start ${this._providerLabel(providerId)} connection`;
      this.connecting = false;
    }
  }

  async _handleDisconnect() {
    const tenantId = String(this.tenant || '').trim();
    const providerId = normalizeProviderId(this.configureProviderId || 'dropbox');
    if (!tenantId || !providerId || this.disconnecting) return;
    const confirmed = window.confirm(`Disconnect ${this._providerLabel(providerId)} for this tenant?`);
    if (!confirmed) return;

    this.disconnecting = true;
    this.errorMessage = '';
    this.successMessage = '';
    try {
      await disconnectIntegration(tenantId, providerId);
      this.successMessage = `${this._providerLabel(providerId)} disconnected.`;
      this._resetEditorState();
      await this._loadStatus();
    } catch (error) {
      this.errorMessage = error?.message || `Failed to disconnect ${this._providerLabel(providerId)}`;
    } finally {
      this.disconnecting = false;
    }
  }

  async _handleToggleProviderActive(nextActive) {
    const tenantId = String(this.tenant || '').trim();
    const providerId = normalizeProviderId(this.configureProviderId || 'dropbox');
    if (!tenantId || !providerId || this.updatingProviderState) return;

    this.updatingProviderState = true;
    this.errorMessage = '';
    this.successMessage = '';
    try {
      await updateIntegrationConfig(tenantId, {
        provider: providerId,
        isActive: !!nextActive,
      });
      this.successMessage = `${this._providerLabel(providerId)} ${nextActive ? 'activated' : 'deactivated'}.`;
      await this._loadStatus();
    } catch (error) {
      this.errorMessage = error?.message || `Failed to update ${this._providerLabel(providerId)} activation state`;
    } finally {
      this.updatingProviderState = false;
    }
  }

  async _handleLoadFolderCatalog() {
    const tenantId = String(this.tenant || '').trim();
    const providerId = normalizeProviderId(this.configureProviderId || 'dropbox');
    const provider = this._getProvider(providerId);
    if (!tenantId || providerId !== 'dropbox') return;
    if (!provider?.connected) {
      this.errorMessage = 'Connect Dropbox first.';
      return;
    }

    const runId = this._folderLoadRunId + 1;
    this._folderLoadRunId = runId;
    this.folderCatalogLoading = true;
    this.folderCatalogLoaded = false;
    this.folderCatalogError = '';
    this.folderCatalogStatus = '';
    this.folderCatalogTruncated = false;
    this.folderCatalog = [];
    this.errorMessage = '';
    try {
      const rootsPayload = await getLiveDropboxFolders(tenantId, {
        mode: 'roots',
        limit: 2000,
      });
      if (this._folderLoadRunId !== runId) return;

      const roots = Array.isArray(rootsPayload?.folders) ? rootsPayload.folders : [];
      const known = new Set(roots);
      this.folderCatalog = this._sortFolderPaths(known);
      this.folderCatalogLoaded = true;
      this.folderCatalogTruncated = !!rootsPayload?.truncated;
      if (roots.length === 0) {
        this.folderCatalogError = 'No folders found in Dropbox.';
        this.folderCatalogStatus = '';
      } else if (rootsPayload?.truncated) {
        this.folderCatalogError = `Loaded ${roots.length} root folders (truncated). Narrow folder structure if needed.`;
      }

      if (!roots.length) return;

      const depthCap = this._getFolderScanDepth();
      let failedRequests = 0;
      let currentLevelParents = this._sortFolderPaths(roots);
      this.folderCatalogStatus = `Loaded ${roots.length} root folder${roots.length === 1 ? '' : 's'}. Scanning level-by-level up to ${depthCap} levels…`;

      for (let level = 2; level <= depthCap; level += 1) {
        if (this._folderLoadRunId !== runId) return;
        if (!currentLevelParents.length) break;

        this.folderCatalogStatus =
          `Loaded ${this.folderCatalog.length} folders • scanning level ${level}/${depthCap} from ${currentLevelParents.length} parent folder${currentLevelParents.length === 1 ? '' : 's'}`;

        const nextLevelSet = new Set();
        let scannedParents = 0;
        for (const parentPath of currentLevelParents) {
          if (this._folderLoadRunId !== runId) return;
          try {
            const payload = await getLiveDropboxFolders(tenantId, {
              path: parentPath,
              limit: 2000,
            });
            if (this._folderLoadRunId !== runId) return;
            const childFolders = Array.isArray(payload?.folders) ? payload.folders : [];
            childFolders.forEach((folderPath) => {
              known.add(folderPath);
              nextLevelSet.add(folderPath);
            });
            if (payload?.truncated) {
              this.folderCatalogTruncated = true;
            }
          } catch (_error) {
            failedRequests += 1;
          }
          scannedParents += 1;
          this.folderCatalog = this._sortFolderPaths(known);
          this.folderCatalogStatus =
            `Loaded ${this.folderCatalog.length} folders • scanning level ${level}/${depthCap} (${scannedParents}/${currentLevelParents.length})` +
            (failedRequests ? ` • ${failedRequests} lookup error${failedRequests === 1 ? '' : 's'}` : '');
        }

        currentLevelParents = this._sortFolderPaths(nextLevelSet);
        this.folderCatalogStatus =
          `Loaded ${this.folderCatalog.length} folders • completed level ${level}/${depthCap}` +
          (failedRequests ? ` • ${failedRequests} lookup error${failedRequests === 1 ? '' : 's'}` : '');
      }

      if (this.folderCatalogTruncated) {
        this.folderCatalogError =
          `Loaded ${this.folderCatalog.length} folders (truncated). Narrow folder structure if needed.`;
      } else if (failedRequests > 0) {
        this.folderCatalogError =
          `Loaded ${this.folderCatalog.length} folders with ${failedRequests} lookup error${failedRequests === 1 ? '' : 's'}.`;
      } else {
        this.folderCatalogError = '';
      }
      if (this._folderLoadRunId === runId) {
        this.folderCatalogStatus =
          `Loaded ${this.folderCatalog.length} folders from ${roots.length} root folder${roots.length === 1 ? '' : 's'}.`;
      }
    } catch (error) {
      if (this._folderLoadRunId !== runId) return;
      this.folderCatalog = [];
      this.folderCatalogLoaded = false;
      this.folderCatalogError = error?.message || 'Failed to load Dropbox folders';
      this.folderCatalogStatus = '';
    } finally {
      if (this._folderLoadRunId === runId) {
        this.folderCatalogLoading = false;
      }
    }
  }

  _handleCancelFolderCatalogLoad() {
    if (!this.folderCatalogLoading) return;
    this._folderLoadRunId += 1;
    this.folderCatalogLoading = false;
    this.folderCatalogLoaded = Array.isArray(this.folderCatalog) && this.folderCatalog.length > 0;
    this.folderCatalogStatus = `Scan canceled. Loaded ${this.folderCatalog.length} folder${this.folderCatalog.length === 1 ? '' : 's'} so far.`;
    if (!this.folderCatalogError) {
      this.folderCatalogError = '';
    }
  }

  _moveFolder(index, direction) {
    const providerId = normalizeProviderId(this.configureProviderId || 'dropbox');
    const current = this._getProviderFolders(providerId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return;
    const updated = [...current];
    const [item] = updated.splice(index, 1);
    updated.splice(nextIndex, 0, item);
    this._setProviderFolders(providerId, updated);
    if (this.editingFolderIndex === index) this.editingFolderIndex = nextIndex;
  }

  _removeFolder(index) {
    const providerId = normalizeProviderId(this.configureProviderId || 'dropbox');
    const current = this._getProviderFolders(providerId);
    if (index < 0 || index >= current.length) return;
    this._setProviderFolders(providerId, current.filter((_, i) => i !== index));
    if (this.editingFolderIndex === index) {
      this.editingFolderIndex = -1;
      this.editingFolderValue = '';
    }
  }

  _startEditFolder(index) {
    const providerId = normalizeProviderId(this.configureProviderId || 'dropbox');
    const current = this._getProviderFolders(providerId);
    if (index < 0 || index >= current.length) return;
    this.editingFolderIndex = index;
    this.editingFolderValue = String(current[index] || '');
  }

  _cancelEditFolder() {
    this.editingFolderIndex = -1;
    this.editingFolderValue = '';
  }

  _commitEditFolder(index) {
    const providerId = normalizeProviderId(this.configureProviderId || 'dropbox');
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
    this._setProviderFolders(providerId, current.map((folder, i) => (i === index ? value : folder)));
    this.editingFolderIndex = -1;
    this.editingFolderValue = '';
  }

  _tryAddFolderValue(providerId, valueRaw) {
    const value = String(valueRaw || '').trim();
    const current = this._getProviderFolders(providerId);
    if (!value) {
      this.errorMessage = 'Select a folder to add.';
      return false;
    }
    if (providerId === 'dropbox') {
      if (!this.folderCatalogLoaded) {
        this.errorMessage = 'Load Dropbox folders first.';
        return false;
      }
      if (!this.folderCatalog.includes(value)) {
        this.errorMessage = 'Choose a folder from the loaded Dropbox list.';
        return false;
      }
    }
    if (current.includes(value)) {
      this.errorMessage = 'Folder already exists in sync list.';
      return false;
    }
    this._setProviderFolders(providerId, [...current, value]);
    this.newSyncFolder = '';
    this.errorMessage = '';
    return true;
  }

  _handleAddFolder() {
    const providerId = normalizeProviderId(this.configureProviderId || 'dropbox');
    this._tryAddFolderValue(providerId, this.newSyncFolder);
  }

  async _handleSaveConfig() {
    const tenantId = String(this.tenant || '').trim();
    const providerId = normalizeProviderId(this.configureProviderId || 'dropbox');
    if (!tenantId || !providerId || this.savingConfig) return false;

    const pending = String(this.newSyncFolder || '').trim();
    if (pending && !this._tryAddFolderValue(providerId, pending)) return false;

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
      return true;
    } catch (error) {
      this.errorMessage = error?.message || 'Failed to save integration config';
      return false;
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
    this._resetEditorState();
    this.errorMessage = '';
  }

  _renderProviderList() {
    const providers = Array.isArray(this.providers) ? this.providers : [];
    return html`
      <div class="header">
        <div>
          <h3 class="title">Provider Sources</h3>
          <p class="subtitle">Add a provider, connect it, then configure sync folders.</p>
        </div>
        <button
          type="button"
          class="btn btn-primary"
          ?disabled=${this.loading}
          @click=${this._handleAddProvider}
        >
          Add Provider
        </button>
      </div>

      ${this.errorMessage ? html`<div class="notice notice-error">${this.errorMessage}</div>` : ''}
      ${this.successMessage ? html`<div class="notice notice-success">${this.successMessage}</div>` : ''}
      ${this.loading ? html`
        <div class="loading-row">
          <span class="spinner"></span>
          Loading provider status...
        </div>
      ` : html``}

      <div class="provider-list">
        ${providers.map((provider) => {
          const folders = this._getProviderFolders(provider.id);
          return html`
            <div class="provider-card">
              <div class="provider-head">
                <div class="provider-title">
                  ${provider.label}
                </div>
                ${provider.id === this.defaultSourceProvider ? html`<span class="pill pill-default">Default</span>` : ''}
              </div>
              ${this._renderProviderStatusRow(provider)}
              <div class="provider-meta">
                ${folders.length} sync folder${folders.length === 1 ? '' : 's'} · Mode: ${this._providerModeLabel(provider)}
              </div>
              <div class="provider-actions">
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  @click=${() => this._handleConfigureProvider(provider.id)}
                >
                  Configure
                </button>
              </div>
            </div>
          `;
        })}
        ${providers.length === 0 ? html`
          <div class="provider-card">
            <div class="provider-title">
              <span class="status-dot status-dot-disconnected"></span>
              Dropbox
            </div>
            <div class="provider-meta">No provider configured yet.</div>
            <div class="provider-actions">
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                @click=${this._handleAddProvider}
              >
                Configure
              </button>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  _renderConfigureProvider() {
    const providerId = normalizeProviderId(this.configureProviderId || 'dropbox');
    const provider = this._getProvider(providerId) || {
      id: providerId,
      label: this._providerLabel(providerId),
      is_active: false,
      connected: false,
      can_connect: true,
      mode: 'unconfigured',
      issues: [],
    };
    const syncFolders = this._getProviderFolders(providerId);
    const folderOptions = this._getFilteredCatalogOptions(providerId);

    return html`
      <div class="header">
        <div>
          <h3 class="title">Configure Provider</h3>
          <p class="subtitle">Step 1: connect. Step 2: load folders. Step 3: add folders. Step 4: save and return.</p>
        </div>
        <button
          type="button"
          class="btn btn-secondary"
          @click=${this._handleBackToProviders}
        >
          Back
        </button>
      </div>

      ${this.errorMessage ? html`<div class="notice notice-error">${this.errorMessage}</div>` : ''}
      ${this.successMessage ? html`<div class="notice notice-success">${this.successMessage}</div>` : ''}
      ${this.loading ? html`
        <div class="loading-row">
          <span class="spinner"></span>
          Loading provider status...
        </div>
      ` : html``}

      <div class="configure-shell">
        <h4 class="configure-title">${provider.label}</h4>
        <p class="configure-subtitle">Mode: ${this._providerModeLabel(provider)}</p>
        ${this._renderProviderStatusRow(provider)}

        ${provider.issues?.length ? html`
          <div class="notice notice-error" style="margin-top: 10px;">
            Setup notes: ${provider.issues.join(', ')}
          </div>
        ` : ''}

        <div class="actions">
          <button
            type="button"
            class="btn btn-primary"
            ?disabled=${this.loading || this.connecting || this.updatingProviderState || !provider.can_connect}
            @click=${this._handleConnect}
          >
            ${this.connecting ? 'Redirecting...' : provider.connected ? `Reconnect ${provider.label}` : `Connect ${provider.label}`}
          </button>
          ${provider.connected ? html`
            <button
              type="button"
              class="btn btn-danger"
              ?disabled=${this.loading || this.disconnecting || this.updatingProviderState}
              @click=${this._handleDisconnect}
            >
              ${this.disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          ` : ''}
          <button
            type="button"
            class="btn ${provider.is_active ? 'btn-secondary' : 'btn-primary'}"
            ?disabled=${this.loading || this.connecting || this.disconnecting || this.savingConfig || this.folderCatalogLoading || this.updatingProviderState}
            @click=${() => this._handleToggleProviderActive(!provider.is_active)}
          >
            ${this.updatingProviderState
              ? 'Saving...'
              : provider.is_active
                ? 'Deactivate Integration'
                : 'Activate Integration'}
          </button>
        </div>

        <div class="configure-section">
          <h5 class="section-title">Sync Folders</h5>
          <div class="muted" style="margin-bottom: 8px;">
            Optional. Use sync folders to limit which Dropbox folders Zoltag ingests. If no folders are specified, Zoltag ingests all available media files.
          </div>
          ${provider.connected && provider.is_active ? html`
            <div class="notice notice-error" style="margin-top: 8px;">
              Deactivate this source before editing sync folders. This prevents ingestion changes while you update folder paths.
            </div>
          ` : html``}
          ${provider.connected && !provider.is_active ? html`
            <div class="actions" style="margin-top: 0;">
              <label class="muted" style="display:inline-flex; align-items:center; gap:6px;">
                Depth
                <input
                  class="field-input"
                  type="number"
                  min="1"
                  max="5"
                  step="1"
                  style="width:74px; padding:6px 8px;"
                  .value=${String(this._getFolderScanDepth())}
                  ?disabled=${this.loading || this.folderCatalogLoading || this.updatingProviderState}
                  @input=${this._handleDepthInputChange}
                />
              </label>
              <button
                type="button"
                class="btn ${this.folderCatalogLoading ? 'btn-danger' : 'btn-secondary'}"
                ?disabled=${this.loading || this.updatingProviderState}
                @click=${this.folderCatalogLoading ? this._handleCancelFolderCatalogLoad : this._handleLoadFolderCatalog}
              >
                ${this.folderCatalogLoading ? html`
                  <span class="btn-content">
                    <span class="btn-spinner" aria-hidden="true"></span>
                    <span>Cancel</span>
                  </span>
                ` : 'Load Dropbox Folders'}
              </button>
              ${this.folderCatalogLoaded ? html`
                <span class="muted">Loaded ${this.folderCatalog.length} folder${this.folderCatalog.length === 1 ? '' : 's'}</span>
              ` : ''}
            </div>
            ${this.folderCatalogStatus ? html`
              <div class="folder-typeahead-meta">${this.folderCatalogStatus}</div>
            ` : ''}
            ${this.folderCatalogError ? html`
              <div class="folder-typeahead-meta" style="color: ${this.folderCatalogTruncated ? '#92400e' : '#b91c1c'};">
                ${this.folderCatalogError}
              </div>
            ` : ''}

            ${this.folderCatalogLoaded ? html`
              <div style="margin-top: 10px;">
                <div class="field-label" style="min-width: 0; margin-bottom: 6px;">Add Folder</div>
                <div class="folder-input-shell" style="width: 100%; max-width: none;">
                  <input
                    class="field-input"
                    type="text"
                    style="width: 100%;"
                    placeholder="Type to filter loaded Dropbox folders…"
                    .value=${this.newSyncFolder}
                    ?disabled=${this.loading || this.savingConfig || this.updatingProviderState}
                    @input=${this._handleFolderInputChange}
                    @keydown=${(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        this._handleAddFolder();
                      }
                    }}
                  />
                  <div class="folder-typeahead-meta">
                    Select from the loaded Dropbox folder list, then click Add. Showing ${folderOptions.length} match${folderOptions.length === 1 ? '' : 'es'}.
                  </div>
                  ${folderOptions.length ? html`
                    <div class="folder-typeahead">
                      ${folderOptions.map((folder) => html`
                        <div class="folder-typeahead-row">
                          <button
                            type="button"
                            class="folder-typeahead-btn"
                            @click=${() => this._handleFolderSuggestionSelect(folder)}
                          >
                            ${folder}
                          </button>
                        </div>
                      `)}
                    </div>
                  ` : html``}
                  <div class="actions" style="margin-top: 8px; justify-content: flex-end;">
                    <button
                      type="button"
                      class="btn btn-secondary btn-sm"
                      ?disabled=${this.loading || this.savingConfig || this.updatingProviderState}
                      @click=${this._handleAddFolder}
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            ` : html`
              <div class="muted" style="margin-top: 8px;">Load Dropbox folders to enable folder selection.</div>
            `}
          ` : html``}
          ${!provider.connected ? html`
            <div class="muted">Connect Dropbox first, then load folders to configure sync scope.</div>
          ` : html``}

          ${provider.connected && !provider.is_active ? html`
            <div class="folder-list">
              ${syncFolders.length ? syncFolders.map((folder, index) => html`
                <div class="folder-item">
                  <div class="folder-index">${index + 1}</div>
                  ${this.editingFolderIndex === index ? html`
                    <input
                      class="field-input"
                      type="text"
                      .value=${this.editingFolderValue}
                      ?disabled=${this.loading || this.savingConfig || this.updatingProviderState}
                      @input=${(event) => {
                        this.editingFolderValue = event.target.value || '';
                      }}
                    />
                  ` : html`<div class="folder-value">${folder}</div>`}
                  ${this.editingFolderIndex === index ? html`
                    <button
                      type="button"
                      class="btn btn-secondary btn-sm"
                      ?disabled=${this.loading || this.savingConfig || this.updatingProviderState}
                      @click=${() => this._commitEditFolder(index)}
                    >Save</button>
                    <button
                      type="button"
                      class="btn btn-secondary btn-sm"
                      ?disabled=${this.loading || this.savingConfig || this.updatingProviderState}
                      @click=${this._cancelEditFolder}
                    >Cancel</button>
                  ` : html`
                    <button
                      type="button"
                      class="btn btn-secondary btn-sm"
                      ?disabled=${this.loading || this.savingConfig || this.updatingProviderState}
                      @click=${() => this._startEditFolder(index)}
                    >Edit</button>
                  `}
                  <button
                    type="button"
                    class="btn btn-secondary btn-sm"
                    ?disabled=${index === 0 || this.loading || this.savingConfig || this.updatingProviderState}
                    @click=${() => this._moveFolder(index, -1)}
                  >Up</button>
                  <button
                    type="button"
                    class="btn btn-secondary btn-sm"
                    ?disabled=${index === syncFolders.length - 1 || this.loading || this.savingConfig || this.updatingProviderState}
                    @click=${() => this._moveFolder(index, 1)}
                  >Down</button>
                  <button
                    type="button"
                    class="btn btn-danger btn-sm"
                    ?disabled=${this.loading || this.savingConfig || this.updatingProviderState}
                    @click=${() => this._removeFolder(index)}
                  >Remove</button>
                </div>
              `) : html`
                <div class="muted">No sync folders configured yet.</div>
              `}
            </div>
          ` : html``}
        </div>

        <div class="configure-section">
          <div class="actions" style="margin-top: 0;">
            <button
              type="button"
              class="btn btn-primary"
              ?disabled=${this.loading || this.savingConfig || this.updatingProviderState}
              @click=${this._handleSaveConfig}
            >
              ${this.savingConfig ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <div class="card">
        ${this.configureProviderId ? this._renderConfigureProvider() : this._renderProviderList()}
      </div>
    `;
  }
}

customElements.define('library-integrations-admin', LibraryIntegrationsAdmin);
