import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import {
  connectIntegrationProvider,
  createIntegration,
  deleteIntegrationProvider,
  disconnectIntegrationProvider,
  getIntegrationProviders,
  getIntegrationStatus,
  getLiveDropboxFolders,
  getLiveGdriveFolders,
  getLiveYoutubePlaylists,
  saveGdriveCredentials,
  updateIntegrationProvider,
} from '../services/api.js';

const PROVIDER_LABELS = {
  dropbox: 'Dropbox',
  gdrive: 'Google Drive',
  youtube: 'YouTube',
};

const PROVIDER_TYPES = ['dropbox', 'gdrive', 'youtube'];

function normalizeProviderId(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'google-drive' || normalized === 'google_drive' || normalized === 'drive') {
    return 'gdrive';
  }
  if (normalized === 'yt') {
    return 'youtube';
  }
  if (normalized === 'dropbox' || normalized === 'gdrive' || normalized === 'youtube') {
    return normalized;
  }
  return '';
}

export class LibraryIntegrationsAdmin extends LitElement {
  static properties = {
    tenant: { type: String },
    loading: { type: Boolean },
    connecting: { type: Boolean },
    disconnecting: { type: Boolean },
    savingConfig: { type: Boolean },
    deletingProvider: { type: Boolean },
    errorMessage: { type: String },
    successMessage: { type: String },
    // UUID of the instance currently being configured, or '' for list view
    configureProviderId: { type: String },
    // All provider instances from GET /providers
    _allProviderInstances: { type: Array },
    // Connection status keyed by instance UUID (from GET /status providers[].provider_id)
    _statusByUuid: { type: Object },
    // Sync folders keyed by instance UUID
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
    _gdriveBrowserStack: { type: Array },
    _gdriveBrowserItems: { type: Array },
    _gdriveBrowserLoading: { type: Boolean },
    _gdriveBrowserError: { type: String },
    _gdriveKnownNames: { type: Object },
    _youtubeKnownNames: { type: Object },
    _gdriveCredClientId: { type: String },
    _gdriveCredClientSecret: { type: String },
    _gdriveCredSaving: { type: Boolean },
    // 'add' picker state
    _addPickerOpen: { type: Boolean },
    _addPickerType: { type: String },
    _addingProvider: { type: Boolean },
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
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        overflow: hidden;
      }

      .provider-row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        border-bottom: 1px solid #f3f4f6;
        background: #ffffff;
      }

      .provider-row:last-child {
        border-bottom: none;
      }

      .provider-row:hover {
        background: #f9fafb;
      }

      .provider-title {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 8px;
        color: #111827;
        font-size: 14px;
        font-weight: 600;
        min-width: 0;
      }

      .provider-meta {
        color: #6b7280;
        font-size: 12px;
        white-space: nowrap;
      }

      .provider-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
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

      .status-dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
      }

      .status-dot-connected { background: #16a34a; }
      .status-dot-disconnected { background: #9ca3af; }
      .status-dot-active { background: #16a34a; }
      .status-dot-inactive { background: #9ca3af; }

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

      .btn-primary { background: #2563eb; color: #ffffff; }
      .btn-danger { background: #dc2626; color: #ffffff; }
      .btn-secondary { background: #e5e7eb; color: #1f2937; }

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

      .add-picker {
        margin-top: 14px;
        border: 1px solid #dbeafe;
        border-radius: 10px;
        padding: 12px;
        background: #eff6ff;
      }

      .add-picker-label {
        margin: 0 0 8px;
        color: #1e40af;
        font-size: 13px;
        font-weight: 700;
      }

      .type-select {
        border: 1px solid #d1d5db;
        border-radius: 8px;
        padding: 7px 10px;
        font-size: 13px;
        color: #111827;
        background: #ffffff;
        cursor: pointer;
      }

      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `,
  ];

  constructor() {
    super();
    this.tenant = '';
    this.loading = false;
    this.connecting = false;
    this.disconnecting = false;
    this.savingConfig = false;
    this.deletingProvider = false;
    this.errorMessage = '';
    this.successMessage = '';
    this.configureProviderId = '';
    this._allProviderInstances = [];
    this._statusByUuid = {};
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
    this._gdriveBrowserStack = [];
    this._gdriveBrowserItems = [];
    this._gdriveBrowserLoading = false;
    this._gdriveBrowserError = '';
    this._gdriveKnownNames = {};
    this._youtubeKnownNames = {};
    this._gdriveCredClientId = '';
    this._gdriveCredClientSecret = '';
    this._gdriveCredSaving = false;
    this._addPickerOpen = false;
    this._addPickerType = 'youtube';
    this._addingProvider = false;
    this._editingLabel = '';
    this._savingLabel = false;
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

  async _loadStatus() {
    const tenantId = String(this.tenant || '').trim();
    if (!tenantId) {
      this._allProviderInstances = [];
      this._statusByUuid = {};
      this.syncFoldersByProvider = {};
      this.configureProviderId = '';
      return;
    }

    this.loading = true;
    this.errorMessage = '';
    try {
      const [statusResult, providersResult] = await Promise.all([
        getIntegrationStatus(tenantId),
        getIntegrationProviders(tenantId).catch(() => ({ providers: [] })),
      ]);

      // Build UUID → connection status map from status.providers (which has connected/can_connect)
      const statusByUuid = {};
      for (const p of (statusResult?.providers || [])) {
        const uuid = String(p.provider_id || '').trim();
        if (uuid) statusByUuid[uuid] = p;
      }
      this._statusByUuid = statusByUuid;

      const instances = Array.isArray(providersResult?.providers) ? providersResult.providers : [];
      this._allProviderInstances = instances;

      // Build sync folders map keyed by UUID
      const foldersByUuid = {};
      for (const inst of instances) {
        const uuid = String(inst.id || '');
        const folders = Array.isArray(inst.config_json?.sync_folders) ? inst.config_json.sync_folders : [];
        foldersByUuid[uuid] = folders;
      }
      this.syncFoldersByProvider = foldersByUuid;

      // If the instance being configured was deleted, go back to list
      if (this.configureProviderId && !instances.find((i) => i.id === this.configureProviderId)) {
        this.configureProviderId = '';
      }

    } catch (error) {
      this._allProviderInstances = [];
      this._statusByUuid = {};
      this.syncFoldersByProvider = {};
      this.errorMessage = error?.message || 'Failed to load integration status';
    } finally {
      this.loading = false;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  _getInstance(uuid) {
    return (this._allProviderInstances || []).find((i) => i.id === uuid) || null;
  }

  _getInstanceStatus(uuid) {
    return this._statusByUuid?.[uuid] || null;
  }

  _getProviderFolders(uuid) {
    const folders = this.syncFoldersByProvider?.[uuid];
    return Array.isArray(folders) ? [...folders] : [];
  }

  _setProviderFolders(uuid, folders) {
    const next = { ...(this.syncFoldersByProvider || {}) };
    next[uuid] = Array.isArray(folders) ? [...folders] : [];
    this.syncFoldersByProvider = next;
  }

  _sortFolderPaths(paths) {
    return [...(paths || [])]
      .filter((v) => !!String(v || '').trim())
      .sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }));
  }

  _getFolderScanDepth() {
    const raw = Number(this.folderScanDepth);
    if (!Number.isFinite(raw)) return 5;
    return Math.max(1, Math.min(Math.trunc(raw), 5));
  }

  _getFilteredCatalogOptions(uuid) {
    if (!this.folderCatalogLoaded) return [];
    const current = new Set(this._getProviderFolders(uuid));
    const query = String(this.newSyncFolder || '').trim().toLowerCase();
    return (this.folderCatalog || [])
      .filter((f) => !current.has(f))
      .filter((f) => !query || f.toLowerCase().includes(query));
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
    this._gdriveBrowserStack = [];
    this._gdriveBrowserItems = [];
    this._gdriveBrowserLoading = false;
    this._gdriveBrowserError = '';
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  _handleConfigureProvider(uuid) {
    this.errorMessage = '';
    this.successMessage = '';
    this.configureProviderId = uuid;
    this._addPickerOpen = false;
    this._resetEditorState();
    const inst = this._getInstance(uuid);
    this._editingLabel = inst?.label || '';
    this._savingLabel = false;
    this._prefetchProviderNames(uuid);
  }

  _prefetchProviderNames(uuid) {
    const tenantId = String(this.tenant || '').trim();
    if (!tenantId || !uuid) return;
    const inst = this._getInstance(uuid);
    if (!inst) return;
    const providerType = normalizeProviderId(inst.provider_type);
    const status = this._getInstanceStatus(uuid);
    if (!status?.connected) return;

    if (providerType === 'gdrive') {
      const ids = (this._getProviderFolders(uuid)).filter(Boolean);
      if (!ids.length) return;
      getLiveGdriveFolders(tenantId, { ids }).then((result) => {
        const names = { ...this._gdriveKnownNames };
        for (const f of (result?.folders || [])) {
          if (f.id && f.name) names[f.id] = f.name;
        }
        this._gdriveKnownNames = names;
        this.requestUpdate();
      }).catch(() => {});
    } else if (providerType === 'youtube') {
      getLiveYoutubePlaylists(tenantId).then((result) => {
        const names = { ...this._youtubeKnownNames };
        for (const p of (result?.playlists || [])) {
          if (p.id && p.name) names[p.id] = p.name;
        }
        this._youtubeKnownNames = names;
        this.requestUpdate();
      }).catch(() => {});
    }
  }

  _handleBackToProviders() {
    this.configureProviderId = '';
    this._addPickerOpen = false;
    this._resetEditorState();
    this.errorMessage = '';
    this.successMessage = '';
  }

  // ── Add provider ──────────────────────────────────────────────────────────

  _handleOpenAddPicker() {
    this._addPickerOpen = true;
    this._addPickerType = 'youtube';
    this.errorMessage = '';
    this.successMessage = '';
  }

  async _handleConfirmAdd() {
    const tenantId = String(this.tenant || '').trim();
    const providerType = this._addPickerType;
    if (!tenantId || !providerType || this._addingProvider) return;
    const label = PROVIDER_LABELS[providerType] || providerType;
    this._addingProvider = true;
    this.errorMessage = '';
    try {
      const result = await createIntegration(tenantId, providerType, label);
      const newUuid = result?.provider?.id;
      await this._loadStatus();
      this._addPickerOpen = false;
      if (newUuid) {
        this._handleConfigureProvider(newUuid);
      }
    } catch (error) {
      this.errorMessage = error?.message || `Failed to add ${label} provider`;
    } finally {
      this._addingProvider = false;
    }
  }

  // ── Connect / Disconnect ──────────────────────────────────────────────────

  async _handleConnect() {
    const tenantId = String(this.tenant || '').trim();
    const uuid = this.configureProviderId;
    if (!tenantId || !uuid || this.connecting) return;
    this.connecting = true;
    this.errorMessage = '';
    try {
      const returnTo = '/app?tab=library&subTab=providers';
      const redirectOrigin = window.location.origin || '';
      const result = await connectIntegrationProvider(tenantId, uuid, returnTo, redirectOrigin);
      const authorizeUrl = String(result?.authorize_url || '').trim();
      if (!authorizeUrl) throw new Error('Missing authorize URL');
      window.location.assign(authorizeUrl);
    } catch (error) {
      this.errorMessage = error?.message || 'Failed to start connection';
      this.connecting = false;
    }
  }

  async _handleDisconnect() {
    const tenantId = String(this.tenant || '').trim();
    const uuid = this.configureProviderId;
    const inst = this._getInstance(uuid);
    if (!tenantId || !uuid || this.disconnecting) return;
    const label = PROVIDER_LABELS[normalizeProviderId(inst?.provider_type)] || inst?.label || 'provider';
    if (!window.confirm(`Disconnect ${label}?`)) return;
    this.disconnecting = true;
    this.errorMessage = '';
    this.successMessage = '';
    try {
      await disconnectIntegrationProvider(tenantId, uuid);
      this.successMessage = `${label} disconnected.`;
      this._resetEditorState();
      await this._loadStatus();
    } catch (error) {
      this.errorMessage = error?.message || 'Failed to disconnect';
    } finally {
      this.disconnecting = false;
    }
  }

  // ── Active toggle ─────────────────────────────────────────────────────────

  async _handleToggleProviderActive(nextActive) {
    const tenantId = String(this.tenant || '').trim();
    const uuid = this.configureProviderId;
    const inst = this._getInstance(uuid);
    if (!tenantId || !uuid || this.updatingProviderState) return;
    const label = PROVIDER_LABELS[normalizeProviderId(inst?.provider_type)] || inst?.label || 'provider';
    this.updatingProviderState = true;
    this.errorMessage = '';
    this.successMessage = '';
    try {
      await updateIntegrationProvider(tenantId, uuid, { is_active: !!nextActive });
      this.successMessage = `${label} ${nextActive ? 'activated' : 'deactivated'}.`;
      await this._loadStatus();
    } catch (error) {
      this.errorMessage = error?.message || 'Failed to update activation state';
    } finally {
      this.updatingProviderState = false;
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async _handleDeleteProvider() {
    const tenantId = String(this.tenant || '').trim();
    const uuid = this.configureProviderId;
    const inst = this._getInstance(uuid);
    if (!tenantId || !uuid || this.deletingProvider) return;
    const label = inst?.label || PROVIDER_LABELS[normalizeProviderId(inst?.provider_type)] || 'this provider';
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    this.deletingProvider = true;
    this.errorMessage = '';
    this.successMessage = '';
    try {
      await deleteIntegrationProvider(tenantId, uuid);
      this.configureProviderId = '';
      this._resetEditorState();
      await this._loadStatus();
      this.successMessage = `${label} deleted.`;
    } catch (error) {
      this.errorMessage = error?.message || 'Failed to delete provider';
    } finally {
      this.deletingProvider = false;
    }
  }

  // ── Save label ────────────────────────────────────────────────────────────

  async _handleSaveLabel() {
    const tenantId = String(this.tenant || '').trim();
    const uuid = this.configureProviderId;
    const label = String(this._editingLabel || '').trim();
    if (!tenantId || !uuid || !label || this._savingLabel) return;
    this._savingLabel = true;
    this.errorMessage = '';
    this.successMessage = '';
    try {
      await updateIntegrationProvider(tenantId, uuid, { label });
      this.successMessage = 'Label saved.';
      await this._loadStatus();
      // Sync local instance label so nav row updates too
      const inst = this._getInstance(uuid);
      if (inst) inst.label = label;
      this.requestUpdate();
    } catch (error) {
      this.errorMessage = error?.message || 'Failed to save label';
    } finally {
      this._savingLabel = false;
    }
  }

  // ── Save config ───────────────────────────────────────────────────────────

  async _handleSaveConfig() {
    const tenantId = String(this.tenant || '').trim();
    const uuid = this.configureProviderId;
    if (!tenantId || !uuid || this.savingConfig) return false;

    const pending = String(this.newSyncFolder || '').trim();
    if (pending && !this._tryAddFolderValue(uuid, pending)) return false;

    this.savingConfig = true;
    this.errorMessage = '';
    this.successMessage = '';
    try {
      await updateIntegrationProvider(tenantId, uuid, {
        sync_folders: this._getProviderFolders(uuid),
      });
      this.successMessage = 'Sync folders saved.';
      await this._loadStatus();
      return true;
    } catch (error) {
      this.errorMessage = error?.message || 'Failed to save sync folders';
      return false;
    } finally {
      this.savingConfig = false;
    }
  }

  _handleResetConfig() {
    const uuid = this.configureProviderId;
    const inst = this._getInstance(uuid);
    if (!inst) return;
    const folders = Array.isArray(inst.config_json?.sync_folders) ? inst.config_json.sync_folders : [];
    this._setProviderFolders(uuid, folders);
    this._resetEditorState();
    this.errorMessage = '';
  }

  // ── GDrive credential save ────────────────────────────────────────────────

  async _handleSaveGdriveCredentials() {
    const tenantId = String(this.tenant || '').trim();
    const clientId = String(this._gdriveCredClientId || '').trim();
    const clientSecret = String(this._gdriveCredClientSecret || '').trim();
    if (!tenantId || !clientId || !clientSecret || this._gdriveCredSaving) return;
    this._gdriveCredSaving = true;
    this.errorMessage = '';
    this.successMessage = '';
    try {
      await saveGdriveCredentials(tenantId, { clientId, clientSecret });
      this.successMessage = 'Google Drive credentials saved. You can now connect.';
      this._gdriveCredClientId = '';
      this._gdriveCredClientSecret = '';
      await this._loadStatus();
    } catch (error) {
      this.errorMessage = error?.message || 'Failed to save Google Drive credentials';
    } finally {
      this._gdriveCredSaving = false;
    }
  }

  // ── Folder catalog ────────────────────────────────────────────────────────

  async _handleLoadFolderCatalog() {
    const tenantId = String(this.tenant || '').trim();
    const uuid = this.configureProviderId;
    const inst = this._getInstance(uuid);
    const providerType = normalizeProviderId(inst?.provider_type);
    const status = this._getInstanceStatus(uuid);
    if (!tenantId || !providerType) return;

    if (providerType === 'gdrive') {
      if (!status?.connected) { this.errorMessage = 'Connect Google Drive first.'; return; }
      await this._loadGdriveBrowserLevel(null);
      return;
    }

    if (providerType === 'youtube') {
      if (!status?.connected) { this.errorMessage = 'Connect YouTube first.'; return; }
      this.folderCatalogLoading = true;
      this.folderCatalogLoaded = false;
      this.folderCatalogError = '';
      this.folderCatalogStatus = '';
      this.folderCatalog = [];
      this.errorMessage = '';
      try {
        const result = await getLiveYoutubePlaylists(tenantId);
        const playlists = Array.isArray(result?.playlists) ? result.playlists : [];
        const names = { ...this._youtubeKnownNames };
        for (const p of playlists) {
          if (p.id && p.name) names[p.id] = p.name;
        }
        this._youtubeKnownNames = names;
        this.folderCatalog = playlists.map((p) => p.id).filter(Boolean);
        this.folderCatalogLoaded = true;
        if (!this.folderCatalog.length) {
          this.folderCatalogError = 'No playlists found on this YouTube channel.';
        }
      } catch (error) {
        this.folderCatalogError = error?.message || 'Failed to load YouTube playlists.';
      } finally {
        this.folderCatalogLoading = false;
      }
      return;
    }

    if (providerType !== 'dropbox') return;
    if (!status?.connected) { this.errorMessage = 'Connect Dropbox first.'; return; }

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
      const rootsPayload = await getLiveDropboxFolders(tenantId, { mode: 'roots', limit: 2000 });
      if (this._folderLoadRunId !== runId) return;
      const roots = Array.isArray(rootsPayload?.folders) ? rootsPayload.folders : [];
      const known = new Set(roots);
      this.folderCatalog = this._sortFolderPaths(known);
      this.folderCatalogLoaded = true;
      this.folderCatalogTruncated = !!rootsPayload?.truncated;
      if (!roots.length) {
        this.folderCatalogError = 'No folders found in Dropbox.';
      } else if (rootsPayload?.truncated) {
        this.folderCatalogError = `Loaded ${roots.length} root folders (truncated).`;
      }
      if (!roots.length) return;

      const depthCap = this._getFolderScanDepth();
      let failedRequests = 0;
      let currentLevelParents = this._sortFolderPaths(roots);
      this.folderCatalogStatus = `Loaded ${roots.length} root folder${roots.length === 1 ? '' : 's'}. Scanning up to ${depthCap} levels…`;

      for (let level = 2; level <= depthCap; level += 1) {
        if (this._folderLoadRunId !== runId) return;
        if (!currentLevelParents.length) break;
        this.folderCatalogStatus = `Loaded ${this.folderCatalog.length} folders • scanning level ${level}/${depthCap}`;
        const nextLevelSet = new Set();
        let scannedParents = 0;
        for (const parentPath of currentLevelParents) {
          if (this._folderLoadRunId !== runId) return;
          try {
            const payload = await getLiveDropboxFolders(tenantId, { path: parentPath, limit: 2000 });
            if (this._folderLoadRunId !== runId) return;
            (Array.isArray(payload?.folders) ? payload.folders : []).forEach((p) => {
              known.add(p);
              nextLevelSet.add(p);
            });
            if (payload?.truncated) this.folderCatalogTruncated = true;
          } catch (_e) {
            failedRequests += 1;
          }
          scannedParents += 1;
          this.folderCatalog = this._sortFolderPaths(known);
          this.folderCatalogStatus = `Loaded ${this.folderCatalog.length} folders • level ${level}/${depthCap} (${scannedParents}/${currentLevelParents.length})${failedRequests ? ` • ${failedRequests} error${failedRequests === 1 ? '' : 's'}` : ''}`;
        }
        currentLevelParents = this._sortFolderPaths(nextLevelSet);
      }

      if (this.folderCatalogTruncated) {
        this.folderCatalogError = `Loaded ${this.folderCatalog.length} folders (truncated).`;
      } else if (failedRequests > 0) {
        this.folderCatalogError = `Loaded ${this.folderCatalog.length} folders with ${failedRequests} lookup error${failedRequests === 1 ? '' : 's'}.`;
      } else {
        this.folderCatalogError = '';
      }
      if (this._folderLoadRunId === runId) {
        this.folderCatalogStatus = `Loaded ${this.folderCatalog.length} folders from ${roots.length} root folder${roots.length === 1 ? '' : 's'}.`;
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
    this.folderCatalogStatus = `Scan canceled. Loaded ${this.folderCatalog.length} folder${this.folderCatalog.length === 1 ? '' : 's'}.`;
  }

  // ── GDrive browser ────────────────────────────────────────────────────────

  async _loadGdriveBrowserLevel(parentId) {
    const tenantId = String(this.tenant || '').trim();
    this._gdriveBrowserLoading = true;
    this._gdriveBrowserError = '';
    this._gdriveBrowserItems = [];
    try {
      const result = await getLiveGdriveFolders(tenantId, { parentId: parentId || undefined, limit: 200 });
      const folders = Array.isArray(result?.folders) ? result.folders : [];
      this._gdriveBrowserItems = folders;
      const names = { ...this._gdriveKnownNames };
      for (const f of folders) {
        if (f.id && f.name) names[f.id] = f.name;
      }
      this._gdriveKnownNames = names;
    } catch (error) {
      this._gdriveBrowserError = error?.message || 'Failed to load Google Drive folders.';
    } finally {
      this._gdriveBrowserLoading = false;
    }
  }

  _handleGdriveNavigateInto(folder) {
    if (!folder?.id) return;
    this._gdriveBrowserStack = [...this._gdriveBrowserStack, { id: folder.id, name: folder.name || folder.id }];
    this._loadGdriveBrowserLevel(folder.id);
  }

  _handleGdriveNavigateUp() {
    const stack = this._gdriveBrowserStack.slice(0, -1);
    this._gdriveBrowserStack = stack;
    this._loadGdriveBrowserLevel(stack.length ? stack[stack.length - 1].id : null);
  }

  _handleGdriveSelectFolder(folder) {
    if (!folder?.id) return;
    this._gdriveKnownNames = { ...this._gdriveKnownNames, [folder.id]: folder.name || folder.id };
    this._tryAddFolderValue(this.configureProviderId, folder.id);
  }

  _gdriveCurrentParentId() {
    const stack = this._gdriveBrowserStack;
    return stack.length ? stack[stack.length - 1].id : null;
  }

  // ── Folder list editing ───────────────────────────────────────────────────

  _tryAddFolderValue(uuid, valueRaw) {
    const value = String(valueRaw || '').trim();
    const current = this._getProviderFolders(uuid);
    const inst = this._getInstance(uuid);
    const providerType = normalizeProviderId(inst?.provider_type);
    if (!value) { this.errorMessage = 'Select a folder to add.'; return false; }
    if (providerType === 'dropbox' && !this.folderCatalogLoaded) {
      this.errorMessage = 'Load Dropbox folders first.';
      return false;
    }
    if (providerType === 'dropbox' && !this.folderCatalog.includes(value)) {
      this.errorMessage = 'Choose a folder from the loaded Dropbox list.';
      return false;
    }
    if (current.includes(value)) { this.errorMessage = 'Folder already exists in sync list.'; return false; }
    this._setProviderFolders(uuid, [...current, value]);
    this.newSyncFolder = '';
    this.errorMessage = '';
    return true;
  }

  _handleAddFolder() {
    this._tryAddFolderValue(this.configureProviderId, this.newSyncFolder);
  }

  _handleFolderInputChange(event) {
    this.newSyncFolder = String(event?.target?.value || '');
    this.errorMessage = '';
  }

  _handleDepthInputChange(event) {
    const next = Number(event?.target?.value);
    if (!Number.isFinite(next)) { this.folderScanDepth = 5; return; }
    this.folderScanDepth = Math.max(1, Math.min(Math.trunc(next), 5));
  }

  _handleFolderSuggestionSelect(folder) {
    this.newSyncFolder = String(folder || '');
    this.errorMessage = '';
  }

  _moveFolder(index, direction) {
    const uuid = this.configureProviderId;
    const current = this._getProviderFolders(uuid);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return;
    const updated = [...current];
    const [item] = updated.splice(index, 1);
    updated.splice(nextIndex, 0, item);
    this._setProviderFolders(uuid, updated);
    if (this.editingFolderIndex === index) this.editingFolderIndex = nextIndex;
  }

  _removeFolder(index) {
    const uuid = this.configureProviderId;
    const current = this._getProviderFolders(uuid);
    if (index < 0 || index >= current.length) return;
    this._setProviderFolders(uuid, current.filter((_, i) => i !== index));
    if (this.editingFolderIndex === index) {
      this.editingFolderIndex = -1;
      this.editingFolderValue = '';
    }
  }

  _startEditFolder(index) {
    const uuid = this.configureProviderId;
    const current = this._getProviderFolders(uuid);
    if (index < 0 || index >= current.length) return;
    this.editingFolderIndex = index;
    this.editingFolderValue = String(current[index] || '');
  }

  _cancelEditFolder() {
    this.editingFolderIndex = -1;
    this.editingFolderValue = '';
  }

  _commitEditFolder(index) {
    const uuid = this.configureProviderId;
    const current = this._getProviderFolders(uuid);
    const value = String(this.editingFolderValue || '').trim();
    if (!value) { this.errorMessage = 'Folder path cannot be empty.'; return; }
    if (current.some((f, i) => i !== index && f === value)) {
      this.errorMessage = 'Folder already exists in sync list.';
      return;
    }
    this._setProviderFolders(uuid, current.map((f, i) => (i === index ? value : f)));
    this.editingFolderIndex = -1;
    this.editingFolderValue = '';
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  _renderProviderStatusRow(status, inst) {
    const connected = !!status?.connected;
    const isActive = !!inst?.is_active;
    return html`
      <div class="status-row">
        <span class="status-chip">
          <span class="status-dot ${connected ? 'status-dot-connected' : 'status-dot-disconnected'}"></span>
          Connection: ${connected ? 'Connected' : 'Not connected'}
        </span>
        <span class="status-chip">
          <span class="status-dot ${isActive ? 'status-dot-active' : 'status-dot-inactive'}"></span>
          Integration: ${isActive ? 'Active' : 'Inactive'}
        </span>
      </div>
    `;
  }

  _renderGdriveFolderBrowser() {
    const stack = this._gdriveBrowserStack || [];
    const items = this._gdriveBrowserItems || [];
    const currentParentId = this._gdriveCurrentParentId();
    const breadcrumb = ['My Drive', ...stack.map((s) => s.name)].join(' › ');
    const disabled = this.loading || this.savingConfig || this.updatingProviderState;

    if (!this._gdriveBrowserLoading && !this._gdriveBrowserError && items.length === 0 && currentParentId === null) {
      return html`
        <div class="actions" style="margin-top: 0;">
          <button type="button" class="btn btn-secondary" ?disabled=${disabled} @click=${this._handleLoadFolderCatalog}>
            Browse Google Drive Folders
          </button>
        </div>
      `;
    }

    return html`
      <div style="margin-top: 8px;">
        <div class="actions" style="margin-top: 0; margin-bottom: 8px;">
          <button type="button" class="btn btn-secondary btn-sm"
            ?disabled=${disabled || stack.length === 0} @click=${this._handleGdriveNavigateUp}>← Back</button>
          <span class="muted" style="flex:1; font-size:13px; word-break:break-all;">${breadcrumb}</span>
          <button type="button" class="btn btn-secondary btn-sm"
            ?disabled=${disabled || this._gdriveBrowserLoading}
            @click=${() => this._loadGdriveBrowserLevel(currentParentId)} title="Refresh">↻</button>
        </div>
        ${this._gdriveBrowserLoading ? html`
          <div class="muted" style="padding: 12px 0;">
            <span class="btn-spinner" aria-hidden="true" style="display:inline-block; margin-right:6px;"></span>Loading…
          </div>
        ` : this._gdriveBrowserError ? html`
          <div class="folder-typeahead-meta" style="color:#b91c1c;">${this._gdriveBrowserError}</div>
        ` : items.length === 0 ? html`
          <div class="muted" style="padding: 8px 0;">No subfolders found.</div>
        ` : html`
          <div class="folder-typeahead" style="max-height: 280px;">
            ${items.map((folder) => html`
              <div class="folder-typeahead-row" style="display:flex; align-items:center; gap:6px;">
                <button type="button" class="folder-typeahead-btn" style="flex:1; text-align:left;"
                  ?disabled=${disabled} @click=${() => this._handleGdriveSelectFolder(folder)}
                  title="Add this folder to sync list">📁 ${folder.name}</button>
                <button type="button" class="btn btn-secondary btn-sm" ?disabled=${disabled}
                  @click=${() => this._handleGdriveNavigateInto(folder)} title="Browse into this folder">▶</button>
              </div>
            `)}
          </div>
        `}
      </div>
    `;
  }

  // ── List view ─────────────────────────────────────────────────────────────

  _renderProviderList() {
    const instances = Array.isArray(this._allProviderInstances) ? this._allProviderInstances : [];

    return html`
      <div class="header">
        <div>
          <h3 class="title">Provider Sources</h3>
          <p class="subtitle">Connect with the following providers to securely scan and import your content.</p>
        </div>
        <button type="button" class="btn btn-primary btn-sm" ?disabled=${this.loading || this._addingProvider}
          @click=${this._handleOpenAddPicker}>
          + Add Provider
        </button>
      </div>

      ${this.errorMessage ? html`<div class="notice notice-error">${this.errorMessage}</div>` : ''}
      ${this.successMessage ? html`<div class="notice notice-success">${this.successMessage}</div>` : ''}
      ${this.loading ? html`<div class="loading-row"><span class="spinner"></span>Loading…</div>` : ''}

      ${this._addPickerOpen ? html`
        <div class="add-picker">
          <p class="add-picker-label">Add Provider</p>
          <div class="actions" style="margin-top: 0; align-items: center;">
            <select class="type-select" .value=${this._addPickerType}
              @change=${(e) => { this._addPickerType = e.target.value; }}>
              ${PROVIDER_TYPES.map((t) => html`<option value=${t}>${PROVIDER_LABELS[t] || t}</option>`)}
            </select>
            <button type="button" class="btn btn-primary btn-sm" ?disabled=${this._addingProvider}
              @click=${this._handleConfirmAdd}>
              ${this._addingProvider ? html`<span class="btn-content"><span class="btn-spinner"></span><span>Adding…</span></span>` : 'Add'}
            </button>
            <button type="button" class="btn btn-secondary btn-sm" ?disabled=${this._addingProvider}
              @click=${() => { this._addPickerOpen = false; this.errorMessage = ''; }}>
              Cancel
            </button>
          </div>
        </div>
      ` : ''}

      ${instances.length === 0 && !this.loading ? html`
        <div class="muted" style="padding: 16px 0; text-align: center;">No providers configured yet. Click "+ Add Provider" to get started.</div>
      ` : html`
        <div class="provider-list">
          ${instances.map((inst) => {
            const uuid = String(inst.id || '');
            const providerType = normalizeProviderId(inst.provider_type);
            const status = this._getInstanceStatus(uuid);
            const connected = !!status?.connected;
            const isActive = !!inst.is_active;
            const folders = this._getProviderFolders(uuid);
            const typeLabel = PROVIDER_LABELS[providerType] || inst.provider_type || '';
            const displayLabel = inst.label && inst.label !== typeLabel ? `${typeLabel} · ${inst.label}` : typeLabel;
            return html`
              <div class="provider-row">
                <div class="provider-title">
                  <span class="status-dot ${connected ? 'status-dot-connected' : 'status-dot-disconnected'}"></span>
                  ${displayLabel}
                </div>
                <div class="provider-meta" style="display:flex;align-items:center;gap:10px;">
                  <span style="display:flex;align-items:center;gap:5px;">
                    <span class="status-dot ${isActive ? 'status-dot-active' : 'status-dot-inactive'}"></span>
                    <span>${isActive ? 'Active' : 'Inactive'}</span>
                  </span>
                  <span>${folders.length} folder${folders.length === 1 ? '' : 's'}</span>
                </div>
                <div class="provider-actions">
                  <button type="button" class="btn btn-secondary btn-sm"
                    ?disabled=${this.loading} @click=${() => this._handleConfigureProvider(uuid)}>
                    Configure
                  </button>
                </div>
              </div>
            `;
          })}
        </div>
      `}
    `;
  }

  // ── Configure view ────────────────────────────────────────────────────────

  _renderConfigureProvider() {
    const uuid = this.configureProviderId;
    const inst = this._getInstance(uuid);
    if (!inst) {
      return html`
        <div class="header">
          <div><h3 class="title">Configure Provider</h3></div>
          <button type="button" class="btn btn-secondary" @click=${this._handleBackToProviders}>Back</button>
        </div>
        <div class="notice notice-error">Provider not found.</div>
      `;
    }

    const providerType = normalizeProviderId(inst.provider_type);
    const status = this._getInstanceStatus(uuid);
    const connected = !!status?.connected;
    const canConnect = status?.can_connect !== false;
    const isActive = !!inst.is_active;
    const typeLabel = PROVIDER_LABELS[providerType] || inst.provider_type || '';
    const syncFolders = this._getProviderFolders(uuid);
    const folderOptions = this._getFilteredCatalogOptions(uuid);
    const isYoutube = providerType === 'youtube';
    const isGdrive = providerType === 'gdrive';
    const folderLabel = isYoutube ? 'Sync Playlists' : 'Sync Folders';
    const disabled = this.loading || this.savingConfig || this.updatingProviderState;

    return html`
      <div class="header">
        <div>
          <h3 class="title">Configure ${typeLabel}</h3>
          <p class="subtitle">${isYoutube ? 'Step 1: connect. Step 2: load playlists. Step 3: add playlists. Step 4: save.' : 'Step 1: connect. Step 2: load folders. Step 3: add folders. Step 4: save.'}</p>
        </div>
        <button type="button" class="btn btn-secondary" @click=${this._handleBackToProviders}>Back</button>
      </div>

      ${this.errorMessage ? html`<div class="notice notice-error">${this.errorMessage}</div>` : ''}
      ${this.successMessage ? html`<div class="notice notice-success">${this.successMessage}</div>` : ''}
      ${this.loading ? html`<div class="loading-row"><span class="spinner"></span>Loading…</div>` : ''}

      <div class="configure-shell">
        <div class="configure-section" style="padding-bottom:0;">
          <div class="field-row" style="align-items:center;">
            <label class="field-label">Label</label>
            <input class="field-input" type="text"
              .value=${this._editingLabel}
              ?disabled=${this._savingLabel || disabled}
              placeholder=${typeLabel}
              @input=${(e) => { this._editingLabel = e.target.value; }}
              @keydown=${(e) => { if (e.key === 'Enter') this._handleSaveLabel(); }} />
            <button type="button" class="btn btn-secondary"
              style="margin-left:8px;white-space:nowrap;"
              ?disabled=${this._savingLabel || disabled || !String(this._editingLabel || '').trim()}
              @click=${this._handleSaveLabel}>
              ${this._savingLabel ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        ${this._renderProviderStatusRow(status, inst)}

        <div class="actions">
          <button type="button" class="btn btn-primary"
            ?disabled=${disabled || this.connecting || !canConnect}
            @click=${this._handleConnect}>
            ${this.connecting ? 'Redirecting...' : connected ? `Reconnect ${typeLabel}` : `Connect ${typeLabel}`}
          </button>
          ${connected ? html`
            <button type="button" class="btn btn-danger"
              ?disabled=${disabled || this.disconnecting}
              @click=${this._handleDisconnect}>
              ${this.disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          ` : ''}
          <button type="button" class="btn ${isActive ? 'btn-secondary' : 'btn-primary'}"
            ?disabled=${disabled || this.connecting || this.disconnecting || this.folderCatalogLoading}
            @click=${() => this._handleToggleProviderActive(!isActive)}>
            ${this.updatingProviderState ? 'Saving...' : isActive ? 'Deactivate' : 'Activate'}
          </button>
        </div>

        ${isGdrive && !status ? html`
          <div class="configure-section">
            <h5 class="section-title">Google Drive Credentials</h5>
            <div class="muted" style="margin-bottom:10px;">Enter your OAuth client credentials to enable Google Drive connection.</div>
            <div class="field-row">
              <label class="field-label">Client ID</label>
              <input class="field-input" type="text" .value=${this._gdriveCredClientId}
                placeholder="Your Google OAuth client ID"
                ?disabled=${this._gdriveCredSaving}
                @input=${(e) => { this._gdriveCredClientId = e.target.value || ''; }} />
            </div>
            <div class="field-row">
              <label class="field-label">Client Secret</label>
              <input class="field-input" type="password" .value=${this._gdriveCredClientSecret}
                placeholder="Your Google OAuth client secret"
                ?disabled=${this._gdriveCredSaving}
                @input=${(e) => { this._gdriveCredClientSecret = e.target.value || ''; }} />
            </div>
            <div class="actions">
              <button type="button" class="btn btn-primary"
                ?disabled=${!this._gdriveCredClientId || !this._gdriveCredClientSecret || this._gdriveCredSaving}
                @click=${this._handleSaveGdriveCredentials}>
                ${this._gdriveCredSaving ? 'Saving...' : 'Save Credentials'}
              </button>
            </div>
          </div>
        ` : ''}

        <div class="configure-section">
          <h5 class="section-title">${folderLabel}</h5>
          <div class="muted" style="margin-bottom: 8px;">
            ${isYoutube
              ? 'Optional. Limit which YouTube playlists Zoltag ingests. Leave empty to ingest all uploads.'
              : `Optional. Limit which ${typeLabel} folders Zoltag ingests. Leave empty to ingest all files.`}
          </div>

          ${connected && isActive ? html`
            <div class="notice notice-error" style="margin-top: 8px;">
              Deactivate this source before editing ${isYoutube ? 'sync playlists' : 'sync folders'}.
            </div>
          ` : ''}

          ${connected && !isActive ? html`
            ${isGdrive ? html`
              ${this._renderGdriveFolderBrowser()}
            ` : isYoutube ? html`
              <div class="actions" style="margin-top: 0;">
                <button type="button" class="btn btn-secondary"
                  ?disabled=${disabled || this.folderCatalogLoading}
                  @click=${this._handleLoadFolderCatalog}>
                  ${this.folderCatalogLoading
                    ? html`<span class="btn-content"><span class="btn-spinner" aria-hidden="true"></span><span>Loading…</span></span>`
                    : 'Load YouTube Playlists'}
                </button>
                ${this.folderCatalogLoaded ? html`<span class="muted">Loaded ${this.folderCatalog.length} playlist${this.folderCatalog.length === 1 ? '' : 's'}</span>` : ''}
              </div>
              ${this.folderCatalogError ? html`<div class="folder-typeahead-meta" style="color:#b91c1c;">${this.folderCatalogError}</div>` : ''}
              ${this.folderCatalogLoaded ? html`
                <div style="margin-top: 10px;">
                  <div class="field-label" style="min-width:0; margin-bottom:6px;">Add Playlist</div>
                  <div class="folder-input-shell" style="width:100%; max-width:none;">
                    <input class="field-input" type="text" style="width:100%;"
                      placeholder="Type to filter playlists…"
                      .value=${this.newSyncFolder}
                      ?disabled=${disabled}
                      @input=${this._handleFolderInputChange}
                      @keydown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); this._handleAddFolder(); } }} />
                    <div class="folder-typeahead-meta">
                      Showing ${folderOptions.length} match${folderOptions.length === 1 ? '' : 'es'}.
                    </div>
                    ${folderOptions.length ? html`
                      <div class="folder-typeahead">
                        ${folderOptions.map((id) => html`
                          <div class="folder-typeahead-row">
                            <button type="button" class="folder-typeahead-btn"
                              @click=${() => this._handleFolderSuggestionSelect(id)}>
                              ${this._youtubeKnownNames?.[id] || id}
                            </button>
                          </div>
                        `)}
                      </div>
                    ` : ''}
                    <div class="actions" style="margin-top:8px; justify-content:flex-end;">
                      <button type="button" class="btn btn-secondary btn-sm"
                        ?disabled=${disabled} @click=${this._handleAddFolder}>Add</button>
                    </div>
                  </div>
                </div>
              ` : html`<div class="muted" style="margin-top:8px;">Load playlists to enable selection.</div>`}
            ` : html`
              <div class="actions" style="margin-top: 0;">
                <label class="muted" style="display:inline-flex; align-items:center; gap:6px;">
                  Depth
                  <input class="field-input" type="number" min="1" max="5" step="1"
                    style="width:74px; padding:6px 8px;"
                    .value=${String(this._getFolderScanDepth())}
                    ?disabled=${disabled || this.folderCatalogLoading}
                    @input=${this._handleDepthInputChange} />
                </label>
                <button type="button"
                  class="btn ${this.folderCatalogLoading ? 'btn-danger' : 'btn-secondary'}"
                  ?disabled=${disabled}
                  @click=${this.folderCatalogLoading ? this._handleCancelFolderCatalogLoad : this._handleLoadFolderCatalog}>
                  ${this.folderCatalogLoading
                    ? html`<span class="btn-content"><span class="btn-spinner" aria-hidden="true"></span><span>Cancel</span></span>`
                    : 'Load Dropbox Folders'}
                </button>
                ${this.folderCatalogLoaded ? html`<span class="muted">Loaded ${this.folderCatalog.length} folder${this.folderCatalog.length === 1 ? '' : 's'}</span>` : ''}
              </div>
              ${this.folderCatalogStatus ? html`<div class="folder-typeahead-meta">${this.folderCatalogStatus}</div>` : ''}
              ${this.folderCatalogError ? html`
                <div class="folder-typeahead-meta" style="color:${this.folderCatalogTruncated ? '#92400e' : '#b91c1c'};">
                  ${this.folderCatalogError}
                </div>
              ` : ''}
              ${this.folderCatalogLoaded ? html`
                <div style="margin-top: 10px;">
                  <div class="field-label" style="min-width:0; margin-bottom:6px;">Add Folder</div>
                  <div class="folder-input-shell" style="width:100%; max-width:none;">
                    <input class="field-input" type="text" style="width:100%;"
                      placeholder="Type to filter loaded Dropbox folders…"
                      .value=${this.newSyncFolder}
                      ?disabled=${disabled}
                      @input=${this._handleFolderInputChange}
                      @keydown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); this._handleAddFolder(); } }} />
                    <div class="folder-typeahead-meta">
                      Showing ${folderOptions.length} match${folderOptions.length === 1 ? '' : 'es'}.
                    </div>
                    ${folderOptions.length ? html`
                      <div class="folder-typeahead">
                        ${folderOptions.map((folder) => html`
                          <div class="folder-typeahead-row">
                            <button type="button" class="folder-typeahead-btn"
                              @click=${() => this._handleFolderSuggestionSelect(folder)}>
                              ${folder}
                            </button>
                          </div>
                        `)}
                      </div>
                    ` : ''}
                    <div class="actions" style="margin-top:8px; justify-content:flex-end;">
                      <button type="button" class="btn btn-secondary btn-sm"
                        ?disabled=${disabled} @click=${this._handleAddFolder}>Add</button>
                    </div>
                  </div>
                </div>
              ` : html`<div class="muted" style="margin-top:8px;">Load folders to enable selection.</div>`}
            `}
          ` : ''}

          ${!connected ? html`
            <div class="muted">Connect ${typeLabel} first, then load ${isYoutube ? 'playlists' : 'folders'} to configure sync scope.</div>
          ` : ''}

          ${connected ? html`
            <div class="folder-list">
              ${syncFolders.length ? syncFolders.map((folder, index) => html`
                <div class="folder-item">
                  <div class="folder-index">${index + 1}</div>
                  ${!isActive && this.editingFolderIndex === index ? html`
                    <input class="field-input" type="text" .value=${this.editingFolderValue}
                      ?disabled=${disabled}
                      @input=${(e) => { this.editingFolderValue = e.target.value || ''; }} />
                  ` : html`
                    <div class="folder-value">
                      ${isGdrive && this._gdriveKnownNames?.[folder]
                        ? html`<span title="${folder}">${this._gdriveKnownNames[folder]}</span>`
                        : isYoutube && this._youtubeKnownNames?.[folder]
                          ? html`<span title="${folder}">${this._youtubeKnownNames[folder]}</span>`
                          : folder}
                    </div>
                  `}
                  ${!isActive ? html`
                    ${this.editingFolderIndex === index ? html`
                      <button type="button" class="btn btn-secondary btn-sm"
                        ?disabled=${disabled} @click=${() => this._commitEditFolder(index)}>Save</button>
                      <button type="button" class="btn btn-secondary btn-sm"
                        ?disabled=${disabled} @click=${this._cancelEditFolder}>Cancel</button>
                    ` : html`
                      <button type="button" class="btn btn-secondary btn-sm"
                        ?disabled=${disabled} @click=${() => this._startEditFolder(index)}>Edit</button>
                    `}
                    <button type="button" class="btn btn-secondary btn-sm"
                      ?disabled=${index === 0 || disabled} @click=${() => this._moveFolder(index, -1)}>Up</button>
                    <button type="button" class="btn btn-secondary btn-sm"
                      ?disabled=${index === syncFolders.length - 1 || disabled} @click=${() => this._moveFolder(index, 1)}>Down</button>
                    <button type="button" class="btn btn-danger btn-sm"
                      ?disabled=${disabled} @click=${() => this._removeFolder(index)}>Remove</button>
                  ` : ''}
                </div>
              `) : html`<div class="muted">No sync ${isYoutube ? 'playlists' : 'folders'} configured yet.</div>`}
            </div>
          ` : ''}
        </div>

        <div class="configure-section">
          <div class="actions" style="margin-top: 0;">
            <button type="button" class="btn btn-primary" ?disabled=${disabled} @click=${this._handleSaveConfig}>
              ${this.savingConfig ? 'Saving...' : 'Save'}
            </button>
            <button type="button" class="btn btn-danger btn-sm"
              style="margin-left: auto;"
              ?disabled=${this.loading || this.deletingProvider || this.connecting || this.savingConfig}
              @click=${this._handleDeleteProvider}>
              ${this.deletingProvider ? 'Deleting...' : 'Delete Provider'}
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
