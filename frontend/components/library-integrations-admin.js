import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import {
  connectIntegrationProvider,
  createIntegration,
  deleteIntegrationProvider,
  disconnectIntegrationProvider,
  getIntegrationPickerSession,
  getIntegrationProviders,
  getIntegrationStatus,
  getLiveDropboxFolders,
  getLiveGdriveFolders,
  getLiveGphotosAlbums,
  getLiveYoutubePlaylists,
  queueIntegrationProviderSync,
  saveGdriveCredentials,
  startIntegrationPickerSession,
  listIntegrationPickerItems,
  updateIntegrationProvider,
} from '../services/api.js';

const PROVIDER_LABELS = {
  dropbox: 'Dropbox',
  gdrive: 'Google Drive',
  youtube: 'YouTube',
  gphotos: 'Google Photos',
};

const PROVIDER_TYPES = ['dropbox', 'gdrive', 'youtube', 'gphotos'];

function normalizeProviderId(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'google-drive' || normalized === 'google_drive' || normalized === 'drive') {
    return 'gdrive';
  }
  if (normalized === 'yt') {
    return 'youtube';
  }
  if (normalized === 'google-photos' || normalized === 'google_photos') {
    return 'gphotos';
  }
  if (normalized === 'dropbox' || normalized === 'gdrive' || normalized === 'youtube' || normalized === 'gphotos') {
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
    syncNowRunning: { type: Boolean },
    errorMessage: { type: String },
    successMessage: { type: String },
    // UUID of the instance currently being configured, or '' for list view
    configureProviderId: { type: String },
    // Guided configure step (1-4)
    configureStep: { type: Number },
    // All provider instances from GET /providers
    _allProviderInstances: { type: Array },
    // Connection status keyed by instance UUID (from GET /status providers[].provider_id)
    _statusByUuid: { type: Object },
    // Sync folders keyed by instance UUID
    syncFoldersByProvider: { type: Object },
    // Picker-selected sync items keyed by instance UUID
    syncItemsByProvider: { type: Object },
    // Selection mode keyed by instance UUID
    selectionModeByProvider: { type: Object },
    newSyncFolder: { type: String },
    _catalogFilter: { type: String },
    _showAllOverflow: { type: Boolean },
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
    _gphotosKnownNames: { type: Object },
    _gdriveCredClientId: { type: String },
    _gdriveCredClientSecret: { type: String },
    _gdriveCredSaving: { type: Boolean },
    pickerSessionId: { type: String },
    pickerSessionUri: { type: String },
    pickerSessionExpireTime: { type: String },
    pickerBusy: { type: Boolean },
    pickerStatusMessage: { type: String },
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
        overflow-x: hidden;
      }

      .wizard-steps {
        display: grid;
        gap: 8px;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        width: 100%;
        min-width: 0;
      }

      .wizard-step {
        border: 1px solid #d1d5db;
        border-radius: 10px;
        padding: 8px 10px;
        background: #ffffff;
        text-align: left;
        font-size: 12px;
        color: #4b5563;
        cursor: pointer;
      }

      .wizard-step:disabled {
        cursor: not-allowed;
        opacity: 0.7;
      }

      .wizard-step-active {
        border-color: #2563eb;
        background: #eff6ff;
        color: #1e40af;
        font-weight: 700;
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

      .wizard-step-layout {
        --wizard-help-bottom-offset: 0px;
        --wizard-layout-height: 100vh;
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(260px, 30%);
        grid-template-rows: minmax(0, 1fr);
        gap: 14px;
        align-items: stretch;
        height: var(--wizard-layout-height);
        min-height: 0;
        overflow: hidden;
        width: 100%;
        max-width: 100%;
      }

      .wizard-step-main-col {
        grid-column: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        height: 100%;
      }

      .wizard-step-main-col > .wizard-steps {
        flex: 0 0 auto;
      }

      .wizard-step-main-col > .configure-section {
        margin-top: 0;
        flex: 1 1 auto;
        min-height: 0;
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .wizard-main {
        min-width: 0;
        min-height: 0;
        height: 100%;
        flex: 1;
        display: flex;
        flex-direction: column;
      }

      .wizard-main-content {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 0;
        min-height: 0;
        overflow-y: auto;
        padding-right: 4px;
      }

      .wizard-nav-actions {
        margin-top: 0;
        padding-top: 10px;
        border-top: 1px solid #e5e7eb;
        background: #ffffff;
        flex: 0 0 auto;
      }

      .wizard-main > .wizard-nav-actions {
        margin-top: 10px;
      }

      .wizard-main-content > .wizard-nav-actions {
        margin-top: auto;
      }

      .wizard-help {
        grid-column: 2;
        border: 1px solid #bfdbfe;
        border-radius: 12px;
        background: #eff6ff;
        padding: 12px;
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
        min-height: 0;
        height: max(0px, calc(100% - var(--wizard-help-bottom-offset)));
        align-self: start;
        overflow-y: auto;
      }

      .wizard-help-title {
        margin: 0 0 8px;
        color: #1e40af;
        font-size: 13px;
        font-weight: 700;
      }

      .wizard-help-list {
        margin: 0;
        padding-left: 18px;
        color: #1f2937;
        font-size: 12px;
      }

      .wizard-help-list li + li {
        margin-top: 6px;
      }

      .wizard-help-note {
        margin-top: 10px;
        color: #1e3a8a;
        font-size: 12px;
      }

      @media (max-width: 700px) {
        .wizard-step-layout {
          grid-template-columns: 1fr;
          height: auto;
        }

        .wizard-step-main-col {
          grid-column: auto;
          height: auto;
        }

        .wizard-main {
          grid-column: auto;
          height: auto;
          display: block;
        }

        .wizard-main-content {
          flex: none;
          overflow: visible;
          padding-right: 0;
        }

        .wizard-help {
          grid-column: auto;
          height: auto;
          overflow: visible;
        }
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

      .folder-input-add-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        column-gap: 8px;
      }

      .folder-input-add-row .field-input {
        width: 100%;
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

      .folder-typeahead-meta-row {
        margin-top: 6px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .folder-typeahead-meta-row .folder-typeahead-meta {
        margin-top: 0;
      }

      .wizard-main-content-scope {
        overflow: hidden;
      }

      .scope-step-stack {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
      }

      .scope-configure-section {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
      }

      .scope-two-panel {
        margin-top: 10px;
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .scope-section-title {
        margin: 0 0 8px;
        color: #374151;
        font-size: 13px;
        font-weight: 700;
      }

      .scope-saved-block {
        min-height: 0;
        display: flex;
        flex-direction: column;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        background: #ffffff;
        overflow: hidden;
      }

      .scope-saved-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 10px;
        border-bottom: 1px solid #f3f4f6;
        background: #f9fafb;
      }

      .scope-saved-title {
        color: #374151;
        font-size: 12px;
        font-weight: 700;
      }

      .scope-saved-list {
        max-height: 240px;
        overflow-y: auto;
        padding: 8px;
      }

      .scope-saved-list .folder-list {
        margin-top: 0;
      }

      .scope-folder-mode {
        margin-top: 10px;
        display: flex;
        align-items: center;
        gap: 14px;
        flex-wrap: wrap;
      }

      .scope-folder-mode-option {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: #374151;
        font-size: 13px;
        font-weight: 600;
        border: 1px solid #d1d5db;
        border-radius: 999px;
        padding: 4px 10px;
        background: #ffffff;
      }

      .scope-folder-mode-option-active {
        border-color: #2563eb;
        background: #eff6ff;
        color: #1e40af;
      }

      .scope-folder-mode-note {
        margin-top: 6px;
        color: #6b7280;
        font-size: 12px;
      }

      .scope-discovery-block {
        min-height: 0;
        display: flex;
        flex-direction: column;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        background: #ffffff;
        padding: 10px;
      }

      .scope-discovery-scroll {
        max-height: 320px;
        overflow-y: auto;
        padding-right: 4px;
      }

      .folder-typeahead-eight {
        max-height: 288px;
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
    this.syncNowRunning = false;
    this.errorMessage = '';
    this.successMessage = '';
    this.configureProviderId = '';
    this.configureStep = 1;
    this._allProviderInstances = [];
    this._statusByUuid = {};
    this.syncFoldersByProvider = {};
    this.syncItemsByProvider = {};
    this.selectionModeByProvider = {};
    this.newSyncFolder = '';
    this._catalogFilter = '';
    this._showAllOverflow = false;
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
    this._gphotosKnownNames = {};
    this._gdriveCredClientId = '';
    this._gdriveCredClientSecret = '';
    this._gdriveCredSaving = false;
    this.pickerSessionId = '';
    this.pickerSessionUri = '';
    this.pickerSessionExpireTime = '';
    this.pickerBusy = false;
    this.pickerStatusMessage = '';
    this._addPickerOpen = false;
    this._addPickerType = 'youtube';
    this._addingProvider = false;
    this._editingLabel = '';
    this._savingLabel = false;
    this._oauthRestoreProviderId = '';
    this._oauthRestoreStep = 0;
    this._boundSyncWizardLayout = () => this._syncWizardHelpHeight();
  }

  connectedCallback() {
    super.connectedCallback();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this._boundSyncWizardLayout);
    }
    this._applyOauthResultFromQuery();
    this._loadStatus();
  }

  disconnectedCallback() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this._boundSyncWizardLayout);
    }
    super.disconnectedCallback();
  }

  updated(changedProperties) {
    if (changedProperties.has('tenant')) {
      this._loadStatus();
    }
    this._syncWizardHelpHeight();
  }

  _syncWizardHelpHeight() {
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      const layout = this.renderRoot?.querySelector('.wizard-step-layout');
      if (!layout) return;
      const layoutTop = layout.getBoundingClientRect().top;
      const availableHeight = Math.max(360, Math.floor(window.innerHeight - layoutTop - 12));
      layout.style.setProperty('--wizard-layout-height', `${availableHeight}px`);
      const nav = layout.querySelector('.wizard-step-main-col .wizard-nav-actions');
      if (!nav) {
        layout.style.setProperty('--wizard-help-bottom-offset', '0px');
        return;
      }
      const navStyles = window.getComputedStyle(nav);
      const marginTop = Number.parseFloat(navStyles.marginTop || '0') || 0;
      const marginBottom = Number.parseFloat(navStyles.marginBottom || '0') || 0;
      const offset = Math.max(0, Math.ceil(nav.getBoundingClientRect().height + marginTop + marginBottom));
      layout.style.setProperty('--wizard-help-bottom-offset', `${offset}px`);
    });
  }

  _applyOauthResultFromQuery() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const integration = normalizeProviderId(params.get('integration'));
      const oauthProviderId = String(params.get('provider_id') || '').trim();
      const oauthStep = Number(params.get('configure_step') || 0);
      if (!integration) return;
      const providerLabel = PROVIDER_LABELS[integration] || 'Integration';
      const result = (params.get('result') || '').trim();
      if (result === 'connected') {
        this.successMessage = `${providerLabel} connected successfully.`;
      } else if (result === 'error') {
        this.errorMessage = `${providerLabel} connection failed. Please try again.`;
      }
      if (oauthProviderId) {
        this._oauthRestoreProviderId = oauthProviderId;
        this._oauthRestoreStep = Number.isFinite(oauthStep) ? oauthStep : 0;
      }
      params.delete('integration');
      params.delete('result');
      params.delete('provider_id');
      params.delete('configure_step');
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
      this.syncItemsByProvider = {};
      this.selectionModeByProvider = {};
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
      const itemsByUuid = {};
      const selectionModeByUuid = {};
      for (const inst of instances) {
        const uuid = String(inst.id || '');
        const status = statusByUuid[uuid];
        const providerType = normalizeProviderId(inst.provider_type);
        const folders = Array.isArray(inst.config_json?.sync_folders) ? inst.config_json.sync_folders : [];
        const items = Array.isArray(inst.config_json?.sync_items) ? inst.config_json.sync_items : [];
        foldersByUuid[uuid] = folders;
        itemsByUuid[uuid] = items
          .map((item) => {
            if (item && typeof item === 'object') {
              const id = String(item.id || item.source_key || '').trim();
              if (!id) return null;
              return {
                id,
                name: String(item.name || id),
                mime_type: String(item.mime_type || item.mimeType || ''),
                creation_time: String(item.creation_time || item.creationTime || ''),
              };
            }
            const id = String(item || '').trim();
            if (!id) return null;
            return { id, name: id, mime_type: '', creation_time: '' };
          })
          .filter(Boolean);
        selectionModeByUuid[uuid] = this._resolveSelectionMode(providerType, status, inst.config_json?.selection_mode);
      }
      this.syncFoldersByProvider = foldersByUuid;
      this.syncItemsByProvider = itemsByUuid;
      this.selectionModeByProvider = selectionModeByUuid;

      // If the instance being configured was deleted, go back to list
      if (this.configureProviderId && !instances.find((i) => i.id === this.configureProviderId)) {
        this.configureProviderId = '';
      }

      if (this._oauthRestoreProviderId) {
        const restoreId = this._oauthRestoreProviderId;
        const restoreStepRaw = this._oauthRestoreStep;
        this._oauthRestoreProviderId = '';
        this._oauthRestoreStep = 0;
        const restored = instances.find((i) => String(i.id || '') === restoreId);
        if (restored) {
          this._handleConfigureProvider(restoreId);
          const restoredStatus = this._getInstanceStatus(restoreId);
          const connected = !!restoredStatus?.connected;
          const isActive = !!restored.is_active;
          const requested = Math.max(1, Math.min(Math.trunc(Number(restoreStepRaw) || 0), 4));
          const defaultStep = connected && !isActive ? 3 : 2;
          const targetStep = requested || defaultStep;
          this._setConfigureStep(targetStep, { silent: true });
        }
      }

    } catch (error) {
      this._allProviderInstances = [];
      this._statusByUuid = {};
      this.syncFoldersByProvider = {};
      this.syncItemsByProvider = {};
      this.selectionModeByProvider = {};
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

  _getProviderItems(uuid) {
    const items = this.syncItemsByProvider?.[uuid];
    return Array.isArray(items) ? [...items] : [];
  }

  _setProviderFolders(uuid, folders) {
    const next = { ...(this.syncFoldersByProvider || {}) };
    next[uuid] = Array.isArray(folders) ? [...folders] : [];
    this.syncFoldersByProvider = next;
    this._showAllOverflow = false;
  }

  _setProviderItems(uuid, items) {
    const next = { ...(this.syncItemsByProvider || {}) };
    next[uuid] = Array.isArray(items) ? [...items] : [];
    this.syncItemsByProvider = next;
  }

  _getSelectionMode(inst, status) {
    const providerType = normalizeProviderId(inst?.provider_type);
    const uuid = String(inst?.id || '').trim();
    const fromState = uuid ? this.selectionModeByProvider?.[uuid] : '';
    return this._resolveSelectionMode(
      providerType,
      status,
      fromState || status?.selection_mode || inst?.config_json?.selection_mode,
    );
  }

  _getSelectionCapabilities(providerType, status) {
    const hasCaps = !!status?.selection_capabilities;
    const supportsCatalog = hasCaps
      ? status.selection_capabilities.supports_catalog !== false
      : providerType !== 'gphotos';
    const supportsPicker = hasCaps
      ? status.selection_capabilities.supports_picker === true
      : providerType === 'gphotos';
    return { supportsCatalog, supportsPicker };
  }

  _resolveSelectionMode(providerType, status, rawValue) {
    const { supportsCatalog, supportsPicker } = this._getSelectionCapabilities(providerType, status);
    const raw = String(rawValue || '').trim().toLowerCase();
    if (raw === 'picker' && supportsPicker) return 'picker';
    if (raw === 'catalog' && supportsCatalog) return 'catalog';
    if (supportsPicker && !supportsCatalog) return 'picker';
    if (supportsCatalog && !supportsPicker) return 'catalog';
    if (providerType === 'gphotos') return 'picker';
    return 'catalog';
  }

  _setSelectionMode(uuid, mode) {
    const next = { ...(this.selectionModeByProvider || {}) };
    next[uuid] = mode;
    this.selectionModeByProvider = next;
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
    const query = String(this._catalogFilter || '').trim().toLowerCase();
    const knownNames = { ...this._gdriveKnownNames, ...this._youtubeKnownNames, ...this._gphotosKnownNames };
    const matches = (f) => {
      if (!query) return true;
      if (f.toLowerCase().includes(query)) return true;
      const name = (knownNames[f] || '').toLowerCase();
      return name.includes(query);
    };
    // Selected items pinned at top, then unselected
    const selected = (this.folderCatalog || []).filter((f) => current.has(f) && matches(f));
    const unselected = (this.folderCatalog || []).filter((f) => !current.has(f) && matches(f));
    return [...selected, ...unselected];
  }

  _setConfigureStep(step, { silent = false } = {}) {
    const target = Math.max(1, Math.min(Math.trunc(Number(step) || 1), 4));
    const uuid = String(this.configureProviderId || '').trim();
    if (!uuid) {
      this.configureStep = target;
      return;
    }
    const inst = this._getInstance(uuid);
    const status = this._getInstanceStatus(uuid);
    const providerType = normalizeProviderId(inst?.provider_type);
    const typeLabel = PROVIDER_LABELS[providerType] || inst?.provider_type || 'provider';
    const connected = !!status?.connected;
    const isActive = !!inst?.is_active;

    if (target >= 3 && !connected) {
      if (!silent) this.errorMessage = `Connect ${typeLabel} before configuring sync scope.`;
      return;
    }
    if (target === 3 && isActive) {
      if (!silent) this.errorMessage = `Deactivate ${typeLabel} before editing sync scope.`;
      return;
    }
    if (!silent) this.errorMessage = '';
    this.configureStep = target;
  }

  _resetEditorState() {
    this._folderLoadRunId += 1;
    this.newSyncFolder = '';
    this._catalogFilter = '';
    this._showAllOverflow = false;
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
    this.pickerSessionId = '';
    this.pickerSessionUri = '';
    this.pickerSessionExpireTime = '';
    this.pickerBusy = false;
    this.pickerStatusMessage = '';
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  _handleConfigureProvider(uuid) {
    this.errorMessage = '';
    this.successMessage = '';
    this.configureProviderId = uuid;
    this.configureStep = 1;
    this._addPickerOpen = false;
    this._resetEditorState();
    const inst = this._getInstance(uuid);
    const status = this._getInstanceStatus(uuid);
    this._editingLabel = inst?.label || '';
    this._setSelectionMode(uuid, this._getSelectionMode(inst, status));
    this.pickerSessionId = String(status?.picker_session_id || inst?.config_json?.picker_session_id || '').trim();
    this.pickerSessionUri = '';
    this.pickerSessionExpireTime = '';
    this.pickerStatusMessage = '';
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
    const selectionMode = this._getSelectionMode(inst, status);
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
    } else if (providerType === 'gphotos' && selectionMode === 'catalog') {
      getLiveGphotosAlbums(tenantId, { provider_id: uuid }).then((result) => {
        const names = { ...this._gphotosKnownNames };
        for (const a of (result?.albums || [])) {
          if (a.id && a.name) names[a.id] = a.name;
        }
        this._gphotosKnownNames = names;
        this.requestUpdate();
      }).catch(() => {});
    } else if (providerType === 'gphotos') {
      const names = { ...this._gphotosKnownNames };
      for (const item of this._getProviderItems(uuid)) {
        if (item?.id && item?.name) names[item.id] = item.name;
      }
      this._gphotosKnownNames = names;
    }
  }

  _handleBackToProviders() {
    this.configureProviderId = '';
    this.configureStep = 1;
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
      const returnParams = new URLSearchParams({
        tab: 'library',
        subTab: 'providers',
        provider_id: uuid,
        configure_step: '2',
      });
      const returnTo = `/app?${returnParams.toString()}`;
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

  async _handleContinueToScope() {
    const uuid = this.configureProviderId;
    const inst = this._getInstance(uuid);
    const status = this._getInstanceStatus(uuid);
    const providerType = normalizeProviderId(inst?.provider_type);
    const typeLabel = PROVIDER_LABELS[providerType] || inst?.provider_type || 'provider';
    if (!uuid) return;
    if (!status?.connected) {
      this.errorMessage = `Connect ${typeLabel} before continuing to scope.`;
      return;
    }
    if (inst?.is_active) {
      await this._handleToggleProviderActive(false);
    }
    const refreshed = this._getInstance(uuid);
    if (refreshed && !refreshed.is_active) {
      this._setConfigureStep(3, { silent: true });
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

  async _handleSyncNow() {
    const tenantId = String(this.tenant || '').trim();
    const uuid = this.configureProviderId;
    const inst = this._getInstance(uuid);
    const status = this._getInstanceStatus(uuid);
    const providerType = normalizeProviderId(inst?.provider_type);
    const typeLabel = PROVIDER_LABELS[providerType] || inst?.provider_type || 'provider';
    if (!tenantId || !uuid || this.syncNowRunning) return;
    if (!status?.connected) {
      this.errorMessage = `Connect ${typeLabel} first.`;
      return;
    }
    if (!inst?.is_active) {
      this.errorMessage = `Activate ${typeLabel} before syncing.`;
      return;
    }

    this.syncNowRunning = true;
    this.errorMessage = '';
    this.successMessage = '';
    try {
      const result = await queueIntegrationProviderSync(tenantId, uuid, {});
      const queuedState = String(result?.status || '').trim().toLowerCase();
      const queuedJobId = String(result?.job_id || '').trim();
      if (queuedState === 'already_queued') {
        this.successMessage = `A sync job is already queued or running for ${typeLabel}.${queuedJobId ? ` Job: ${queuedJobId}.` : ''}`;
      } else {
        this.successMessage = `Sync job queued for ${typeLabel}.${queuedJobId ? ` Job: ${queuedJobId}.` : ''}`;
      }
    } catch (error) {
      this.errorMessage = error?.message || `Failed to queue sync for ${typeLabel}`;
    } finally {
      this.syncNowRunning = false;
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
    const inst = this._getInstance(uuid);
    const status = this._getInstanceStatus(uuid);
    const selectionMode = this._getSelectionMode(inst, status);

    if (selectionMode === 'catalog') {
      const pending = String(this.newSyncFolder || '').trim();
      if (pending && !this._tryAddFolderValue(uuid, pending)) return false;
    } else if (!String(this.pickerSessionId || '').trim()) {
      this.errorMessage = 'Picker session ID is required. Launch picker first.';
      return false;
    }

    this.savingConfig = true;
    this.errorMessage = '';
    this.successMessage = '';
    try {
      await updateIntegrationProvider(tenantId, uuid, {
        sync_folders: this._getProviderFolders(uuid),
        sync_items: this._getProviderItems(uuid),
        selection_mode: selectionMode,
        picker_session_id: String(this.pickerSessionId || '').trim(),
      });
      this.successMessage = selectionMode === 'picker' ? 'Picker selections saved.' : 'Sync folders saved.';
      await this._loadStatus();
      return true;
    } catch (error) {
      this.errorMessage = error?.message || (selectionMode === 'picker'
        ? 'Failed to save picker selections'
        : 'Failed to save sync folders');
      return false;
    } finally {
      this.savingConfig = false;
    }
  }

  async _handleSaveAndReactivate() {
    const uuid = this.configureProviderId;
    const inst = this._getInstance(uuid);
    const status = this._getInstanceStatus(uuid);
    const providerType = normalizeProviderId(inst?.provider_type);
    const typeLabel = PROVIDER_LABELS[providerType] || inst?.provider_type || 'provider';
    if (!uuid) return;
    if (!status?.connected) {
      this.errorMessage = `Connect ${typeLabel} before finalizing.`;
      return;
    }

    const saved = await this._handleSaveConfig();
    if (!saved) return;

    const refreshed = this._getInstance(uuid);
    if (!refreshed?.is_active) {
      await this._handleToggleProviderActive(true);
    }

    const latest = this._getInstance(uuid);
    if (latest?.is_active) {
      this._setConfigureStep(1, { silent: true });
    }
  }

  _handleResetConfig() {
    const uuid = this.configureProviderId;
    const inst = this._getInstance(uuid);
    if (!inst) return;
    const status = this._getInstanceStatus(uuid);
    const folders = Array.isArray(inst.config_json?.sync_folders) ? inst.config_json.sync_folders : [];
    const items = Array.isArray(inst.config_json?.sync_items) ? inst.config_json.sync_items : [];
    this._setProviderFolders(uuid, folders);
    this._setProviderItems(uuid, items);
    this._setSelectionMode(uuid, this._resolveSelectionMode(
      normalizeProviderId(inst.provider_type),
      status,
      inst.config_json?.selection_mode,
    ));
    this._resetEditorState();
    this.pickerSessionId = String(inst.config_json?.picker_session_id || '').trim();
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
    const selectionMode = this._getSelectionMode(inst, status);
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

    if (providerType === 'gphotos' && selectionMode === 'catalog') {
      if (!status?.connected) { this.errorMessage = 'Connect Google Photos first.'; return; }
      this.folderCatalogLoading = true;
      this.folderCatalogLoaded = false;
      this.folderCatalogError = '';
      this.folderCatalogStatus = '';
      this.folderCatalog = [];
      this.errorMessage = '';
      try {
        const result = await getLiveGphotosAlbums(tenantId, { provider_id: uuid });
        const albums = Array.isArray(result?.albums) ? result.albums : [];
        const names = { ...this._gphotosKnownNames };
        for (const a of albums) {
          if (a.id && a.name) names[a.id] = a.name;
        }
        this._gphotosKnownNames = names;
        this.folderCatalog = albums.map((a) => a.id).filter(Boolean);
        this.folderCatalogLoaded = true;
        if (!this.folderCatalog.length) {
          this.folderCatalogError = 'No albums found in this Google Photos library.';
        }
      } catch (error) {
        this.folderCatalogError = error?.message || 'Failed to load Google Photos albums.';
      } finally {
        this.folderCatalogLoading = false;
      }
      return;
    }

    if (providerType === 'gphotos') {
      this.errorMessage = 'Google Photos is configured for picker mode. Use Launch Picker instead.';
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
      const rootsPayload = await getLiveDropboxFolders(tenantId, { provider_id: uuid, mode: 'roots', limit: 2000 });
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
            const payload = await getLiveDropboxFolders(tenantId, { provider_id: uuid, path: parentPath, limit: 2000 });
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

  async _handleLaunchPicker() {
    const tenantId = String(this.tenant || '').trim();
    const uuid = this.configureProviderId;
    const inst = this._getInstance(uuid);
    const status = this._getInstanceStatus(uuid);
    const providerType = normalizeProviderId(inst?.provider_type);
    if (!tenantId || !uuid || providerType !== 'gphotos' || this.pickerBusy) return;
    if (!status?.connected) {
      this.errorMessage = 'Connect Google Photos first.';
      return;
    }

    this.pickerBusy = true;
    this.errorMessage = '';
    this.pickerStatusMessage = '';
    try {
      const result = await startIntegrationPickerSession(tenantId, uuid, { max_item_count: 2000 });
      const sessionId = String(result?.session_id || '').trim();
      const pickerUri = String(result?.picker_uri || '').trim();
      this.pickerSessionId = sessionId;
      this.pickerSessionUri = pickerUri;
      this.pickerSessionExpireTime = String(result?.expire_time || '').trim();
      this.pickerStatusMessage = sessionId ? `Picker session created: ${sessionId}` : 'Picker session created.';
      if (!pickerUri) {
        throw new Error('Picker session created, but no picker URL was returned.');
      }
      window.open(pickerUri, '_blank', 'noopener,noreferrer');
    } catch (error) {
      this.errorMessage = error?.message || 'Failed to launch picker';
    } finally {
      this.pickerBusy = false;
    }
  }

  async _handleRefreshPickerItems() {
    const tenantId = String(this.tenant || '').trim();
    const uuid = this.configureProviderId;
    const sessionId = String(this.pickerSessionId || '').trim();
    if (!tenantId || !uuid || !sessionId || this.pickerBusy) return;

    this.pickerBusy = true;
    this.errorMessage = '';
    this.pickerStatusMessage = '';
    try {
      const session = await getIntegrationPickerSession(tenantId, uuid, sessionId);
      const itemsResult = await listIntegrationPickerItems(tenantId, uuid, sessionId, { limit: 5000 });
      const items = Array.isArray(itemsResult?.items) ? itemsResult.items : [];
      const normalizedItems = items
        .map((item) => {
          const id = String(item?.id || '').trim();
          if (!id) return null;
          return {
            id,
            name: String(item?.name || id),
            mime_type: String(item?.mime_type || ''),
            creation_time: String(item?.creation_time || ''),
          };
        })
        .filter(Boolean);
      this._setProviderItems(uuid, normalizedItems);
      const names = { ...this._gphotosKnownNames };
      for (const item of normalizedItems) {
        if (item.id && item.name) names[item.id] = item.name;
      }
      this._gphotosKnownNames = names;

      this.pickerSessionId = String(session?.session_id || sessionId || '').trim();
      this.pickerSessionUri = String(session?.picker_uri || this.pickerSessionUri || '').trim();
      this.pickerSessionExpireTime = String(session?.expire_time || this.pickerSessionExpireTime || '').trim();
      const pickedCount = Number(session?.picked_items_count || normalizedItems.length || 0);
      this.pickerStatusMessage = `Loaded ${normalizedItems.length} selected media item${normalizedItems.length === 1 ? '' : 's'} (picker reports ${pickedCount}).`;
    } catch (error) {
      this.errorMessage = error?.message || 'Failed to refresh picker items';
    } finally {
      this.pickerBusy = false;
    }
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
    const status = this._getInstanceStatus(uuid);
    const selectionMode = this._getSelectionMode(inst, status);
    if (selectionMode === 'picker') {
      this.errorMessage = 'This provider uses picker mode. Launch picker to select media.';
      return false;
    }
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

  _handleClearScopeSelections() {
    const uuid = String(this.configureProviderId || '').trim();
    if (!uuid) return;
    const inst = this._getInstance(uuid);
    const status = this._getInstanceStatus(uuid);
    const selectionMode = this._getSelectionMode(inst, status);
    if (selectionMode === 'picker') {
      this._setProviderItems(uuid, []);
    } else {
      this._setProviderFolders(uuid, []);
      this.editingFolderIndex = -1;
      this.editingFolderValue = '';
    }
    this.newSyncFolder = '';
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

  _movePickerItem(index, direction) {
    const uuid = this.configureProviderId;
    const current = this._getProviderItems(uuid);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return;
    const updated = [...current];
    const [item] = updated.splice(index, 1);
    updated.splice(nextIndex, 0, item);
    this._setProviderItems(uuid, updated);
  }

  _removePickerItem(index) {
    const uuid = this.configureProviderId;
    const current = this._getProviderItems(uuid);
    if (index < 0 || index >= current.length) return;
    this._setProviderItems(uuid, current.filter((_, i) => i !== index));
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

  _handleRemoveFolder(folder) {
    const uuid = this.configureProviderId;
    const current = this._getProviderFolders(uuid);
    this._setProviderFolders(uuid, current.filter((f) => f !== folder));
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

  _renderStepHelpCard({ step, typeLabel, connected, isActive, selectionMode, resourceLabelPlural }) {
    const currentStep = Math.max(1, Math.min(Math.trunc(Number(step) || 1), 4));
    const modeLabel = selectionMode === 'picker'
      ? `selected ${resourceLabelPlural}`
      : `sync ${resourceLabelPlural}`;

    let title = 'Step Instructions';
    let items = [];
    let note = '';

    if (currentStep === 1) {
      title = 'Step 1: Name This Source';
      items = [
        `Set a clear label for this ${typeLabel} connection (for example: "Marketing ${typeLabel}" or "Personal ${typeLabel}").`,
        'Click Save to keep the label.',
        'Use Continue to Connection to move to step 2.',
      ];
      note = 'Use unique labels when you have multiple connections of the same provider.';
    } else if (currentStep === 2) {
      title = 'Step 2: Connect Account';
      items = [
        `Connect or reconnect ${typeLabel} and complete OAuth.`,
        connected ? 'Connection is complete. You can continue.' : 'After OAuth returns, verify status shows Connected.',
        isActive
          ? 'Deactivate before moving to scope editing.'
          : 'Leave integration inactive while you configure scope in the next step.',
      ];
      note = connected
        ? 'Continue to Scope becomes available when the connection is valid.'
        : 'If OAuth returns to another page, reopen this provider and continue.';
    } else if (currentStep === 3) {
      title = 'Step 3: Configure Scope';
      items = [
        `Choose exactly what to sync by setting ${modeLabel}.`,
        selectionMode === 'picker'
          ? `Launch Picker, select ${resourceLabelPlural}, then refresh selected items.`
          : `Load available ${resourceLabelPlural}, then add the ones you want synced (or leave empty to sync all).`,
        'Review and reorder or remove entries as needed.',
      ];
      note = 'Changes here are local until you save in step 4.';
    } else {
      title = 'Step 4: Finalize + Run';
      items = [
        'Save Configuration to persist scope changes.',
        'Use Save + Reactivate to enable ingestion with the new scope.',
        'Use Sync Now to enqueue a background sync job after activation.',
      ];
      note = 'After Save + Reactivate, the wizard returns to step 1 so you can review or adjust.';
    }

    return html`
      <aside class="wizard-help" aria-label="Step instructions">
        <h6 class="wizard-help-title">${title}</h6>
        <ol class="wizard-help-list">
          ${items.map((item) => html`<li>${item}</li>`)}
        </ol>
        ${note ? html`<div class="wizard-help-note">${note}</div>` : ''}
      </aside>
    `;
  }

  _renderGdriveFolderBrowser() {
    const stack = this._gdriveBrowserStack || [];
    const items = this._gdriveBrowserItems || [];
    const currentParentId = this._gdriveCurrentParentId();
    const breadcrumb = ['My Drive', ...stack.map((s) => s.name)].join(' › ');
    const disabled = this.loading || this.savingConfig || this.updatingProviderState || this.syncNowRunning;

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

  _renderScopeDiscoveryContent({ selectionMode, isGdrive, isYoutube, isGphotos, disabled, resourceLabelPlural, folderOptions }) {
    if (selectionMode === 'picker') {
      return html`
        <div class="actions" style="margin-top: 0;">
          <button type="button" class="btn btn-secondary"
            ?disabled=${disabled || this.pickerBusy}
            @click=${this._handleLaunchPicker}>
            ${this.pickerBusy
              ? html`<span class="btn-content"><span class="btn-spinner" aria-hidden="true"></span><span>Starting…</span></span>`
              : (this._getInstanceStatus(this.configureProviderId)?.selection_capabilities?.picker_start_label || 'Launch Picker')}
          </button>
          <button type="button" class="btn btn-secondary"
            ?disabled=${disabled || this.pickerBusy || !String(this.pickerSessionId || '').trim()}
            @click=${this._handleRefreshPickerItems}>
            ${this.pickerBusy
              ? html`<span class="btn-content"><span class="btn-spinner" aria-hidden="true"></span><span>Refreshing…</span></span>`
              : `Refresh Selected ${resourceLabelPlural.charAt(0).toUpperCase()}${resourceLabelPlural.slice(1)}`}
          </button>
        </div>
        ${this.pickerStatusMessage ? html`<div class="folder-typeahead-meta">${this.pickerStatusMessage}</div>` : ''}
        ${this.pickerSessionId ? html`<div class="folder-typeahead-meta">Session: ${this.pickerSessionId}</div>` : ''}
        ${this.pickerSessionExpireTime ? html`<div class="folder-typeahead-meta">Session expires: ${this.pickerSessionExpireTime}</div>` : ''}
        ${this._getProviderItems(this.configureProviderId).length
          ? html`<div class="folder-typeahead-meta">Loaded ${this._getProviderItems(this.configureProviderId).length} selected ${resourceLabelPlural}.</div>`
          : html`<div class="muted" style="margin-top:8px;">Launch picker, select media, then click refresh.</div>`}
      `;
    }

    if (isGdrive) {
      return this._renderGdriveFolderBrowser();
    }

    if (isYoutube) {
      return html`
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
              <div class="folder-input-add-row">
                <input class="field-input" type="text" style="width:100%;"
                  placeholder="Type to filter playlists…"
                  .value=${this.newSyncFolder}
                  ?disabled=${disabled}
                  @input=${this._handleFolderInputChange}
                  @keydown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); this._handleAddFolder(); } }} />
                <button type="button" class="btn btn-secondary btn-sm"
                  ?disabled=${disabled} @click=${this._handleAddFolder}>Add</button>
              </div>
              <div class="folder-typeahead-meta">
                Showing ${folderOptions.length} match${folderOptions.length === 1 ? '' : 'es'}.
              </div>
              ${folderOptions.length ? html`
                <div class="folder-typeahead folder-typeahead-eight">
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
            </div>
          </div>
        ` : html`<div class="muted" style="margin-top:8px;">Load playlists to enable selection.</div>`}
      `;
    }

    if (isGphotos) {
      return html`
        <div class="actions" style="margin-top: 0;">
          <button type="button" class="btn btn-secondary"
            ?disabled=${disabled || this.folderCatalogLoading}
            @click=${this._handleLoadFolderCatalog}>
            ${this.folderCatalogLoading
              ? html`<span class="btn-content"><span class="btn-spinner" aria-hidden="true"></span><span>Loading…</span></span>`
              : 'Load Albums'}
          </button>
          ${this.folderCatalogLoaded ? html`<span class="muted">Loaded ${this.folderCatalog.length} album${this.folderCatalog.length === 1 ? '' : 's'}</span>` : ''}
        </div>
        ${this.folderCatalogError ? html`<div class="folder-typeahead-meta" style="color:#b91c1c;">${this.folderCatalogError}</div>` : ''}
        ${this.folderCatalogLoaded ? html`
          <div style="margin-top: 10px;">
            <div class="field-label" style="min-width:0; margin-bottom:6px;">Add Album</div>
            <div class="folder-input-shell" style="width:100%; max-width:none;">
              <div class="folder-input-add-row">
                <input class="field-input" type="text" style="width:100%;"
                  placeholder="Type to filter albums…"
                  .value=${this.newSyncFolder}
                  ?disabled=${disabled}
                  @input=${this._handleFolderInputChange}
                  @keydown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); this._handleAddFolder(); } }} />
                <button type="button" class="btn btn-secondary btn-sm"
                  ?disabled=${disabled} @click=${this._handleAddFolder}>Add</button>
              </div>
              <div class="folder-typeahead-meta">
                Showing ${folderOptions.length} match${folderOptions.length === 1 ? '' : 'es'}.
              </div>
              ${folderOptions.length ? html`
                <div class="folder-typeahead folder-typeahead-eight">
                  ${folderOptions.map((id) => html`
                    <div class="folder-typeahead-row">
                      <button type="button" class="folder-typeahead-btn"
                        @click=${() => this._handleFolderSuggestionSelect(id)}>
                        ${this._gphotosKnownNames?.[id] || id}
                      </button>
                    </div>
                  `)}
                </div>
              ` : ''}
            </div>
          </div>
        ` : html`<div class="muted" style="margin-top:8px;">Load albums to enable selection.</div>`}
      `;
    }

    return html`
      <div class="actions" style="margin-top: 0;">
        <button type="button"
          class="btn ${this.folderCatalogLoading ? 'btn-danger' : 'btn-secondary'}"
          ?disabled=${disabled}
          @click=${this.folderCatalogLoading ? this._handleCancelFolderCatalogLoad : this._handleLoadFolderCatalog}>
          ${this.folderCatalogLoading
            ? html`<span class="btn-content"><span class="btn-spinner" aria-hidden="true"></span><span>Cancel</span></span>`
            : this.folderCatalogLoaded ? 'Reload Folders' : 'Load Folders'}
        </button>
        ${this.folderCatalogLoaded ? html`<span class="muted">${this.folderCatalog.length} folder${this.folderCatalog.length === 1 ? '' : 's'} loaded</span>` : ''}
      </div>
      ${this.folderCatalogStatus ? html`<div class="folder-typeahead-meta">${this.folderCatalogStatus}</div>` : ''}
      ${this.folderCatalogError ? html`
        <div class="folder-typeahead-meta" style="color:${this.folderCatalogTruncated ? '#92400e' : '#b91c1c'};">
          ${this.folderCatalogError}
        </div>
      ` : ''}
      ${this.folderCatalogLoaded ? html`
        <div style="margin-top: 10px;">
          <input class="field-input" type="text" style="width:100%; margin-bottom:6px;"
            placeholder="Filter folders…"
            .value=${this._catalogFilter}
            ?disabled=${disabled}
            @input=${(e) => { this._catalogFilter = e.target.value || ''; this._showAllOverflow = false; }} />
                <div class="folder-typeahead folder-typeahead-eight">
                  ${folderOptions.length === 0 ? html`<div class="muted" style="padding:8px;">No matches.</div>` : folderOptions.map((folder) => {
                    const isSelected = this._getProviderFolders(this.configureProviderId).includes(folder);
                    return html`
                      <div class="folder-typeahead-row" style="display:flex; align-items:center; gap:6px; ${isSelected ? 'background:#f0fdf4;' : ''}">
                        <button type="button" class="folder-typeahead-btn" style="flex:1; text-align:left;"
                          ?disabled=${disabled}
                          @click=${() => {
                            if (isSelected) {
                              this._handleRemoveFolder(folder);
                            } else {
                              this._tryAddFolderValue(this.configureProviderId, folder);
                            }
                          }}>
                          ${isSelected ? html`<span style="color:#16a34a; margin-right:4px;">✓</span>` : html`<span style="color:#9ca3af; margin-right:4px;">+ Add</span>`}${folder}
                        </button>
                      </div>
                    `;
                  })}
                </div>
        </div>
      ` : html`<div class="muted" style="margin-top:8px;">Load folders to enable selection.</div>`}
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
            const items = this._getProviderItems(uuid);
            const selectionMode = this._getSelectionMode(inst, status);
            const resourceLabelPlural = String(status?.selection_capabilities?.resource_label_plural || (selectionMode === 'picker' ? 'items' : 'folders'));
            const selectionCount = selectionMode === 'picker' ? items.length : folders.length;
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
                  <span>${selectionCount} ${resourceLabelPlural}</span>
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
    const syncItems = this._getProviderItems(uuid);
    const folderOptions = this._getFilteredCatalogOptions(uuid);
    const isYoutube = providerType === 'youtube';
    const isGdrive = providerType === 'gdrive';
    const isGphotos = providerType === 'gphotos';
    const selectionMode = this._getSelectionMode(inst, status);
    const selectionCaps = this._getSelectionCapabilities(providerType, status);
    const resourceLabelPlural = String(status?.selection_capabilities?.resource_label_plural
      || (isYoutube ? 'playlists' : isGphotos ? 'albums' : 'folders'));
    const hasScopedFolders = syncFolders.length > 0;
    const selectionCount = selectionMode === 'picker' ? syncItems.length : syncFolders.length;
    const scopeDiscoveryTitle = selectionMode === 'picker'
      ? `Select ${resourceLabelPlural}`
      : `Limit load to the following ${resourceLabelPlural}:`;
    const scopeAddedTitle = `Added ${resourceLabelPlural}`;
    const folderLabel = selectionMode === 'picker'
      ? `Sync ${resourceLabelPlural.charAt(0).toUpperCase()}${resourceLabelPlural.slice(1)}`
      : (isYoutube ? 'Sync Playlists' : isGphotos ? 'Sync Albums' : 'Sync Folders');
    const disabled = this.loading || this.savingConfig || this.updatingProviderState || this.syncNowRunning;
    const configureStep = Math.max(1, Math.min(Math.trunc(Number(this.configureStep) || 1), 4));
    const canProceedToStep3 = connected && !isActive;
    const stepSubtitle = configureStep === 1
      ? 'Step 1 of 4: Set the provider label.'
      : configureStep === 2
        ? 'Step 2 of 4: Connect or reconnect, then leave this integration inactive for configuration.'
        : configureStep === 3
          ? `Step 3 of 4: Configure ${selectionMode === 'picker' ? `selected ${resourceLabelPlural}` : (isYoutube ? 'playlists' : isGphotos ? 'albums' : 'folders')}.`
          : 'Step 4 of 4: Save configuration and reactivate.';
    const helpCard = this._renderStepHelpCard({
      step: configureStep,
      typeLabel,
      connected,
      isActive,
      selectionMode,
      resourceLabelPlural,
    });

    return html`
      <div class="header">
        <div>
          <h3 class="title">Configure ${typeLabel}</h3>
          <p class="subtitle">${stepSubtitle}</p>
        </div>
        <button type="button" class="btn btn-secondary" @click=${this._handleBackToProviders}>Back</button>
      </div>

      ${this.errorMessage ? html`<div class="notice notice-error">${this.errorMessage}</div>` : ''}
      ${this.successMessage ? html`<div class="notice notice-success">${this.successMessage}</div>` : ''}
      ${this.loading ? html`<div class="loading-row"><span class="spinner"></span>Loading…</div>` : ''}

      <div class="configure-shell">
        <div class="wizard-step-layout">
          <div class="wizard-step-main-col">
            <div class="wizard-steps">
              <button type="button" class="wizard-step ${configureStep === 1 ? 'wizard-step-active' : ''}"
                @click=${() => this._setConfigureStep(1)}>
                1. Label
              </button>
              <button type="button" class="wizard-step ${configureStep === 2 ? 'wizard-step-active' : ''}"
                @click=${() => this._setConfigureStep(2)}>
                2. Connection
              </button>
              <button type="button" class="wizard-step ${configureStep === 3 ? 'wizard-step-active' : ''}"
                ?disabled=${!connected || isActive}
                @click=${() => this._setConfigureStep(3)}>
                3. Scope
              </button>
              <button type="button" class="wizard-step ${configureStep === 4 ? 'wizard-step-active' : ''}"
                ?disabled=${!connected}
                @click=${() => this._setConfigureStep(4)}>
                4. Save + Activate
              </button>
            </div>
        ${configureStep === 1 ? html`
          <div class="configure-section">
            <div class="wizard-main">
              <div class="wizard-main-content">
                <h5 class="section-title">Screen 1: Edit Label</h5>
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
              <div class="actions wizard-nav-actions">
                <button type="button" class="btn btn-primary" ?disabled=${disabled} @click=${() => this._setConfigureStep(2)}>
                  Continue to Connection
                </button>
              </div>
            </div>
          </div>
        ` : ''}

        ${configureStep === 2 ? html`
          <div class="configure-section">
            <div class="wizard-main">
              <div class="wizard-main-content">
                <h5 class="section-title">Screen 2: Connection</h5>
                <div class="muted" style="margin-bottom:8px;">Connect, reconnect, or disconnect. Leave this integration inactive before moving to scope configuration.</div>
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
              </div>

              <div class="actions wizard-nav-actions">
                <button type="button" class="btn btn-secondary" ?disabled=${disabled} @click=${() => this._setConfigureStep(1)}>
                  Back
                </button>
                <button type="button" class="btn btn-primary"
                  ?disabled=${disabled || !connected || this.connecting || this.disconnecting}
                  @click=${this._handleContinueToScope}>
                  Continue to Scope
                </button>
              </div>
            </div>
          </div>
        ` : ''}

        ${configureStep === 3 ? html`
          <div class="configure-section">
            <div class="wizard-main">
              <div class="wizard-main-content wizard-main-content-scope">
                <div class="scope-step-stack">
                ${selectionCaps.supportsCatalog && selectionCaps.supportsPicker ? html`
                <div class="configure-section" style="padding-bottom:0;">
                  <div class="field-row" style="align-items:center;">
                    <label class="field-label">Selection Mode</label>
                    <select class="type-select"
                      .value=${selectionMode}
                      ?disabled=${disabled || (connected && isActive)}
                      @change=${(e) => this._setSelectionMode(uuid, this._resolveSelectionMode(providerType, status, e.target.value))}>
                      <option value="catalog">Catalog (folders/albums/playlists)</option>
                      <option value="picker">Picker (user-selected items)</option>
                    </select>
                  </div>
                </div>
              ` : ''}

              <div class="configure-section scope-configure-section">
                <h5 class="section-title">Screen 3: ${folderLabel}</h5>
                <div class="muted" style="margin-bottom: 8px;">
                  ${selectionMode === 'picker'
                    ? `Optional. Sync only the ${resourceLabelPlural} the user selects in picker mode.`
                    : isYoutube
                    ? 'Optional. Limit which YouTube playlists Zoltag ingests. Leave empty to ingest all uploads.'
                    : `Optional. Limit which ${typeLabel} folders Zoltag ingests. Leave empty to ingest all files.`}
                </div>


                ${connected && isActive ? html`
                  <div class="notice notice-error" style="margin-top: 8px;">
                    Deactivate this source in Screen 2 before editing ${selectionMode === 'picker'
                      ? `selected ${resourceLabelPlural}`
                      : (isYoutube ? 'sync playlists' : isGphotos ? 'sync albums' : 'sync folders')}.
                  </div>
                ` : ''}

                ${connected ? html`
                  <div class="scope-two-panel">
                    <div class="scope-discovery-block">
                      <p class="scope-section-title">${scopeDiscoveryTitle}</p>
                      <div class="scope-discovery-scroll">
                    ${!isActive
                      ? this._renderScopeDiscoveryContent({
                        selectionMode,
                        isGdrive,
                        isYoutube,
                        isGphotos,
                        disabled,
                        resourceLabelPlural,
                        folderOptions,
                      })
                      : html`<div class="muted">Deactivate this source in Screen 2 to edit sync scope.</div>`}
                      </div>
                    </div>

                    <div class="scope-saved-block">
                      <div class="scope-saved-header">
                        <span class="scope-saved-title">${scopeAddedTitle} (${selectionCount})</span>
                        ${!isActive && selectionCount > 0 ? html`
                          <button type="button" class="btn btn-secondary btn-sm"
                            ?disabled=${disabled}
                            @click=${this._handleClearScopeSelections}>
                            Clear all
                          </button>
                        ` : ''}
                      </div>
                      <div class="scope-saved-list">
                        <div class="folder-list">
                    ${selectionMode === 'picker'
                      ? (syncItems.length ? syncItems.map((item, index) => html`
                        <div class="folder-item">
                          <div class="folder-index">${index + 1}</div>
                          <div class="folder-value">
                            <span title="${item.id}">${item.name || item.id}</span>
                            ${item.mime_type ? html`<span class="muted" style="margin-left:8px;">${item.mime_type}</span>` : ''}
                          </div>
                          ${!isActive ? html`
                            <button type="button" class="btn btn-secondary btn-sm"
                              ?disabled=${index === 0 || disabled} @click=${() => this._movePickerItem(index, -1)}>Up</button>
                            <button type="button" class="btn btn-secondary btn-sm"
                              ?disabled=${index === syncItems.length - 1 || disabled} @click=${() => this._movePickerItem(index, 1)}>Down</button>
                            <button type="button" class="btn btn-danger btn-sm"
                              ?disabled=${disabled} @click=${() => this._removePickerItem(index)}>Remove</button>
                          ` : ''}
                        </div>
                      `) : html`<div class="muted">No selected ${resourceLabelPlural} configured yet.</div>`)
                      : (() => {
                          if (!syncFolders.length) return html`<div class="muted">No sync ${isYoutube ? 'playlists' : isGphotos ? 'albums' : 'folders'} configured yet.</div>`;
                          const knownNames = { ...this._gdriveKnownNames, ...this._youtubeKnownNames, ...this._gphotosKnownNames };
                          const PILL_VISIBLE = 5;
                          const visible = this._showAllOverflow ? syncFolders : syncFolders.slice(0, PILL_VISIBLE);
                          const overflow = syncFolders.length - PILL_VISIBLE;
                          return html`
                            <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
                              ${visible.map((folder, index) => {
                                const label = knownNames[folder] || folder;
                                return html`
                                  <span style="display:inline-flex; align-items:center; gap:4px; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:9999px; padding:2px 10px 2px 8px; font-size:13px; max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${folder}">
                                    <span style="overflow:hidden; text-overflow:ellipsis;">${label}</span>
                                    ${!isActive ? html`
                                      <button type="button" style="background:none; border:none; cursor:pointer; color:#64748b; padding:0 0 0 2px; font-size:14px; line-height:1;"
                                        ?disabled=${disabled} @click=${() => this._handleRemoveFolder(folder)} title="Remove">×</button>
                                    ` : ''}
                                  </span>
                                `;
                              })}
                              ${!this._showAllOverflow && overflow > 0 ? html`
                                <button type="button" class="btn btn-secondary btn-sm"
                                  @click=${() => { this._showAllOverflow = true; }}>+${overflow} more</button>
                              ` : this._showAllOverflow && syncFolders.length > PILL_VISIBLE ? html`
                                <button type="button" class="btn btn-secondary btn-sm"
                                  @click=${() => { this._showAllOverflow = false; }}>Show less</button>
                              ` : ''}
                            </div>
                          `;
                        })()}
                        </div>
                      </div>
                    </div>
                  </div>
                ` : ''}

                ${!connected ? html`
                  <div class="muted">Complete Screen 2 first, then ${selectionMode === 'picker'
                    ? `launch picker to choose ${resourceLabelPlural}`
                    : `load ${isYoutube ? 'playlists' : 'folders'} to configure sync scope`}.</div>
                ` : ''}
              </div>
                </div>
              </div>
              <div class="actions wizard-nav-actions">
                <button type="button" class="btn btn-secondary" ?disabled=${disabled} @click=${() => this._setConfigureStep(2)}>
                  Back
                </button>
                <button type="button" class="btn btn-primary" ?disabled=${disabled || !canProceedToStep3} @click=${() => this._setConfigureStep(4)}>
                  Continue to Save + Activate
                </button>
              </div>
            </div>
          </div>
        ` : ''}

        ${configureStep === 4 ? html`
          <div class="configure-section">
            <div class="wizard-main">
              <div class="wizard-main-content">
                <h5 class="section-title">Screen 4: Save and Re-Activate</h5>
                ${this._renderProviderStatusRow(status, inst)}
                <div class="muted" style="margin-top:8px;">
                  Save your configuration, then reactivate this source to resume ingestion.
                </div>
              </div>
              <div class="actions wizard-nav-actions">
                <button type="button" class="btn btn-secondary" ?disabled=${disabled} @click=${() => this._setConfigureStep(3)}>
                  Back
                </button>
                <button type="button" class="btn btn-primary"
                  ?disabled=${disabled || this.savingConfig || this.updatingProviderState || isActive}
                  @click=${this._handleSaveAndReactivate}>
                  ${this.savingConfig || this.updatingProviderState ? 'Applying...' : 'Save + Reactivate'}
                </button>
              </div>
            </div>
          </div>
        ` : ''}
          </div>
          ${helpCard}
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
