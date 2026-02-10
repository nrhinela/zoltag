import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import './admin-form-group.js';
import './admin-tabs.js';
import { updateTenant, updateTenantSettings } from '../services/api.js';

/**
 * Admin Storage Setup Component
 * Manages storage integrations, OAuth flows, and sync folder configuration
 */
export class AdminStorageSetup extends LitElement {
  static properties = {
    tenant: { type: Object },
    systemSettings: { type: Object },
    dropboxAppKey: { type: String },
    syncFolders: { type: Array },
    newSyncFolder: { type: String },
    gdriveClientId: { type: String },
    gdriveClientSecret: { type: String },
    gdriveTokenSecret: { type: String },
    gdriveSyncFolders: { type: Array },
    newGdriveSyncFolder: { type: String },
    flickrApiKey: { type: String },
    flickrApiSecret: { type: String },
    flickrTokenSecret: { type: String },
    flickrSyncAlbums: { type: Array },
    newFlickrSyncAlbum: { type: String },
    errorMessage: { type: String },
    successMessage: { type: String },
    isSaving: { type: Boolean },
    connectionStatus: { type: String },
    gdriveConnectionStatus: { type: String },
    activeStorageTab: { type: String },
  };

  static styles = [
    tailwind,
    css`
      :host {
        display: block;
      }

      .error {
        background: #f8d7da;
        color: #721c24;
        padding: 12px;
        border-radius: 4px;
        margin-bottom: 20px;
        display: none;
      }

      .error.show {
        display: block;
      }

      .success {
        background: #d4edda;
        color: #155724;
        padding: 12px;
        border-radius: 4px;
        margin-bottom: 20px;
        display: none;
      }

      .success.show {
        display: block;
      }

      .card {
        background: white;
        padding: 30px;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        margin-bottom: 20px;
      }

      h3 {
        margin-top: 0;
        margin-bottom: 15px;
        color: #333;
      }

      .section {
        margin-bottom: 30px;
        padding: 20px;
        background: #f8f9fa;
        border-radius: 6px;
        border-left: 4px solid #007bff;
      }

      .section h4 {
        margin-top: 0;
        color: #007bff;
      }

      .section-success {
        border-left-color: #28a745;
      }

      .section-success h4 {
        color: #28a745;
      }

      .section-warning {
        background: #e7f3ff;
        border-left-color: #0066cc;
      }

      .section-warning h4 {
        color: #0066cc;
      }

      p {
        color: #666;
        margin-bottom: 15px;
        line-height: 1.6;
      }

      .form-row {
        display: flex;
        gap: 10px;
        margin-bottom: 10px;
        align-items: flex-end;
      }

      .form-row > * {
        flex: 1;
      }

      .form-actions {
        display: flex;
        gap: 10px;
        justify-content: flex-end;
        margin-top: 20px;
      }

      .btn {
        padding: 10px 20px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: all 0.2s;
      }

      .btn-primary {
        background: #007bff;
        color: white;
      }

      .btn-primary:hover {
        background: #0056b3;
      }

      .btn-primary:disabled {
        background: #cccccc;
        cursor: not-allowed;
      }

      .btn-secondary {
        background: #6c757d;
        color: white;
      }

      .btn-secondary:hover {
        background: #545b62;
      }

      .btn-sm {
        padding: 4px 12px;
        font-size: 12px;
      }

      .btn-danger {
        background: #dc3545;
        color: white;
      }

      .btn-danger:hover {
        background: #c82333;
      }

      code {
        background: #f8f9fa;
        padding: 2px 4px;
        border-radius: 2px;
        font-family: monospace;
        font-size: 12px;
      }

      pre {
        background: #2d2d2d;
        color: #f8f8f2;
        padding: 10px;
        border-radius: 4px;
        overflow-x: auto;
        font-size: 12px;
        line-height: 1.6;
        margin: 8px 0;
      }

      .code-block {
        background: white;
        border: 1px solid #dee2e6;
        padding: 10px;
        border-radius: 4px;
        font-family: monospace;
        font-size: 13px;
        color: #212529;
        overflow-x: auto;
      }

      .sync-folder-list {
        margin-bottom: 15px;
      }

      .sync-folder-item {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 8px;
        padding: 8px;
        background: white;
        border: 1px solid #dee2e6;
        border-radius: 4px;
      }

      .sync-folder-item code {
        flex: 1;
        color: #212529;
      }

      .connection-status {
        margin-top: 10px;
        font-size: 14px;
      }

      .status-loading {
        color: #666;
      }

      .status-success {
        color: #28a745;
      }

      .status-error {
        color: #dc3545;
      }

      ol {
        color: #666;
        line-height: 1.8;
        margin: 10px 0;
      }

      li {
        margin-bottom: 8px;
      }

      small {
        display: block;
        color: #666;
        font-size: 12px;
        margin-top: 5px;
      }

      .provider-panel {
        margin-top: 6px;
      }
    `
  ];

  constructor() {
    super();
    this.tenant = null;
    this.dropboxAppKey = '';
    this.syncFolders = [];
    this.newSyncFolder = '';
    this.gdriveClientId = '';
    this.gdriveClientSecret = '';
    this.gdriveTokenSecret = '';
    this.gdriveSyncFolders = [];
    this.newGdriveSyncFolder = '';
    this.flickrApiKey = '';
    this.flickrApiSecret = '';
    this.flickrTokenSecret = '';
    this.flickrSyncAlbums = [];
    this.newFlickrSyncAlbum = '';
    this.errorMessage = '';
    this.successMessage = '';
    this.isSaving = false;
    this.connectionStatus = '';
    this.gdriveConnectionStatus = '';
    this.activeStorageTab = 'dropbox';
  }

  updated(changedProperties) {
    if (changedProperties.has('tenant')) {
      this.dropboxAppKey = this.tenant?.dropbox_app_key || '';
      this.syncFolders = (this.tenant?.settings?.dropbox_sync_folders) || [];
      this.gdriveClientId = this.tenant?.settings?.gdrive_client_id || '';
      this.gdriveClientSecret = this.tenant?.settings?.gdrive_client_secret || '';
      this.gdriveTokenSecret = this.tenant?.settings?.gdrive_token_secret || '';
      this.gdriveSyncFolders = (this.tenant?.settings?.gdrive_sync_folders) || [];
      this.flickrApiKey = this.tenant?.settings?.flickr_api_key || '';
      this.flickrApiSecret = this.tenant?.settings?.flickr_api_secret || '';
      this.flickrTokenSecret = this.tenant?.settings?.flickr_token_secret || '';
      this.flickrSyncAlbums = (this.tenant?.settings?.flickr_sync_albums) || [];
    }
  }

  handleAppKeyChange(e) {
    this.dropboxAppKey = e.detail.value;
  }

  handleNewSyncFolderChange(e) {
    this.newSyncFolder = e.detail.value;
  }

  handleGdriveClientIdChange(e) {
    this.gdriveClientId = e.detail.value;
  }

  handleGdriveClientSecretChange(e) {
    this.gdriveClientSecret = e.detail.value;
  }

  handleGdriveTokenSecretChange(e) {
    this.gdriveTokenSecret = e.detail.value;
  }

  handleNewGdriveSyncFolderChange(e) {
    this.newGdriveSyncFolder = e.detail.value;
  }

  handleFlickrApiKeyChange(e) {
    this.flickrApiKey = e.detail.value;
  }

  handleFlickrApiSecretChange(e) {
    this.flickrApiSecret = e.detail.value;
  }

  handleFlickrTokenSecretChange(e) {
    this.flickrTokenSecret = e.detail.value;
  }

  handleNewFlickrSyncAlbumChange(e) {
    this.newFlickrSyncAlbum = e.detail.value;
  }

  handleAddSyncFolder() {
    const folder = this.newSyncFolder.trim();

    if (!folder) {
      this.errorMessage = 'Please enter a folder path';
      return;
    }

    if (!folder.startsWith('/')) {
      this.errorMessage = 'Folder path must start with /';
      return;
    }

    if (this.syncFolders.includes(folder)) {
      this.errorMessage = 'This folder is already in the list';
      return;
    }

    this.syncFolders = [...this.syncFolders, folder];
    this.newSyncFolder = '';
    this.errorMessage = '';

    // Focus on input for next folder
    this.updateComplete.then(() => {
      const input = this.shadowRoot.querySelector('#new-sync-folder');
      if (input) input.focus();
    });
  }

  handleRemoveSyncFolder(index) {
    this.syncFolders = this.syncFolders.filter((_, i) => i !== index);
  }

  handleAddGdriveSyncFolder() {
    const folderId = this.newGdriveSyncFolder.trim();
    if (!folderId) {
      this.errorMessage = 'Please enter a Google Drive folder ID';
      return;
    }
    if (this.gdriveSyncFolders.includes(folderId)) {
      this.errorMessage = 'This Google Drive folder ID is already in the list';
      return;
    }
    this.gdriveSyncFolders = [...this.gdriveSyncFolders, folderId];
    this.newGdriveSyncFolder = '';
    this.errorMessage = '';
  }

  handleRemoveGdriveSyncFolder(index) {
    this.gdriveSyncFolders = this.gdriveSyncFolders.filter((_, i) => i !== index);
  }

  handleAddFlickrSyncAlbum() {
    const albumId = this.newFlickrSyncAlbum.trim();
    if (!albumId) {
      this.errorMessage = 'Please enter a Flickr album ID';
      return;
    }
    if (this.flickrSyncAlbums.includes(albumId)) {
      this.errorMessage = 'This Flickr album ID is already in the list';
      return;
    }
    this.flickrSyncAlbums = [...this.flickrSyncAlbums, albumId];
    this.newFlickrSyncAlbum = '';
    this.errorMessage = '';
  }

  handleRemoveFlickrSyncAlbum(index) {
    this.flickrSyncAlbums = this.flickrSyncAlbums.filter((_, i) => i !== index);
  }

  async handleSaveDropboxSettings(e) {
    e.preventDefault();

    this.isSaving = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      const data = {
        id: this.tenant.id,
        dropbox_app_key: this.dropboxAppKey
      };

      const updated = await updateTenant(this.tenant.id, data);

      this.successMessage = 'Dropbox settings saved successfully';
      this.dispatchEvent(
        new CustomEvent('tenant-updated', {
          detail: { tenant: updated },
          bubbles: true,
          composed: true
        })
      );

      setTimeout(() => {
        this.successMessage = '';
      }, 3000);
    } catch (error) {
      console.error('Error saving Dropbox settings:', error);
      this.errorMessage = error.message || 'Failed to save Dropbox settings';
    } finally {
      this.isSaving = false;
    }
  }

  async handleSaveSyncFolders() {
    this.isSaving = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      const updated = await updateTenantSettings(this.tenant.id, {
        dropbox_sync_folders: this.syncFolders
      });

      this.successMessage = 'Sync folders saved successfully';
      this.dispatchEvent(
        new CustomEvent('tenant-updated', {
          detail: { tenant: { settings: updated.settings } },
          bubbles: true,
          composed: true
        })
      );
      setTimeout(() => {
        this.successMessage = '';
      }, 3000);
    } catch (error) {
      console.error('Error saving sync folders:', error);
      this.errorMessage = error.message || 'Failed to save sync folders';
    } finally {
      this.isSaving = false;
    }
  }

  async handleSaveGdriveSettings(e) {
    e.preventDefault();

    this.isSaving = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      const settingsPatch = {
        gdrive_client_id: this.gdriveClientId.trim(),
        gdrive_client_secret: this.gdriveClientSecret.trim() || `gdrive-client-secret-${this.tenant.id}`,
        gdrive_token_secret: this.gdriveTokenSecret.trim() || `gdrive-token-${this.tenant.id}`,
        gdrive_sync_folders: this.gdriveSyncFolders,
      };

      const updated = await updateTenantSettings(this.tenant.id, settingsPatch);
      this.successMessage = 'Google Drive settings saved successfully';
      this.dispatchEvent(
        new CustomEvent('tenant-updated', {
          detail: { tenant: { settings: updated.settings } },
          bubbles: true,
          composed: true
        })
      );
      setTimeout(() => {
        this.successMessage = '';
      }, 3000);
    } catch (error) {
      console.error('Error saving Google Drive settings:', error);
      this.errorMessage = error.message || 'Failed to save Google Drive settings';
    } finally {
      this.isSaving = false;
    }
  }

  async handleSaveFlickrSettings(e) {
    e.preventDefault();

    this.isSaving = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      const settingsPatch = {
        flickr_api_key: this.flickrApiKey.trim(),
        flickr_api_secret: this.flickrApiSecret.trim() || `flickr-api-secret-${this.tenant.id}`,
        flickr_token_secret: this.flickrTokenSecret.trim() || `flickr-token-${this.tenant.id}`,
        flickr_sync_albums: this.flickrSyncAlbums,
      };

      const updated = await updateTenantSettings(this.tenant.id, settingsPatch);
      this.successMessage = 'Flickr settings saved successfully';
      this.dispatchEvent(
        new CustomEvent('tenant-updated', {
          detail: { tenant: { settings: updated.settings } },
          bubbles: true,
          composed: true
        })
      );
      setTimeout(() => {
        this.successMessage = '';
      }, 3000);
    } catch (error) {
      console.error('Error saving Flickr settings:', error);
      this.errorMessage = error.message || 'Failed to save Flickr settings';
    } finally {
      this.isSaving = false;
    }
  }

  handleConnectDropbox() {
    if (!this.tenant?.id) {
      this.errorMessage = 'No tenant selected';
      return;
    }

    this.connectionStatus = 'Opening authentication window...';

    const authWindow = window.open(
      `/oauth/dropbox/authorize?tenant=${this.tenant.id}`,
      'dropbox_oauth',
      'width=800,height=600'
    );

    if (!authWindow || authWindow.closed || typeof authWindow.closed === 'undefined') {
      this.connectionStatus = '⚠️ Popup blocked. Please allow popups for this site.';
    } else {
      this.connectionStatus = '✓ Authentication window opened. Complete the authorization in the popup.';
    }
  }

  handleConnectGdrive() {
    if (!this.tenant?.id) {
      this.errorMessage = 'No tenant selected';
      return;
    }

    if (!this.gdriveClientId.trim()) {
      this.errorMessage = 'Save Google Drive client ID before connecting';
      return;
    }

    this.gdriveConnectionStatus = 'Opening authentication window...';

    const authWindow = window.open(
      `/oauth/gdrive/authorize?tenant=${this.tenant.id}`,
      'gdrive_oauth',
      'width=900,height=700'
    );

    if (!authWindow || authWindow.closed || typeof authWindow.closed === 'undefined') {
      this.gdriveConnectionStatus = 'Warning: Popup blocked. Please allow popups for this site.';
    } else {
      this.gdriveConnectionStatus = 'Authentication window opened. Complete authorization in the popup.';
    }
  }

  handleStorageTabChanged(e) {
    this.activeStorageTab = e.detail.tabId;
  }

  _renderDropboxSections(appSecretPath, tokenPath) {
    return html`
      <div class="provider-panel">
        <div class="section">
          <h4>1. Configure App Key</h4>
          <form @submit="${this.handleSaveDropboxSettings}">
            <admin-form-group
              label="Dropbox App Key"
              type="text"
              placeholder="abc123xyz456"
              .value="${this.dropboxAppKey}"
              @input-changed="${this.handleAppKeyChange}"
              helper-text="Public identifier from your Dropbox App Console"
              required
            ></admin-form-group>

            <div class="form-actions">
              <button type="submit" class="btn btn-primary" ?disabled="${this.isSaving}">
                ${this.isSaving ? 'Saving...' : 'Save App Key'}
              </button>
            </div>
          </form>
        </div>

        <div class="section section-success">
          <h4>2. Connect to Dropbox</h4>
          <p>
            Authorize PhotoCat to access this tenant's Dropbox account. This will automatically create and store the
            refresh token in Secret Manager.
          </p>
          <button type="button" class="btn btn-primary" @click="${this.handleConnectDropbox}">
            <i class="fab fa-dropbox"></i> Connect Dropbox Account
          </button>
          ${this.connectionStatus
            ? html`<div class="connection-status ${
                  this.connectionStatus.includes('⚠️') ? 'status-error' : 'status-success'
                }">
                ${this.connectionStatus}
              </div>`
            : ''}
        </div>

        <div class="section">
          <h4>3. Current Configuration</h4>
          <div style="margin-bottom: 15px;">
            <label style="display: block; font-weight: 600; margin-bottom: 5px; color: #495057;">App Secret Reference</label>
            <div class="code-block">${appSecretPath}</div>
          </div>
          <div>
            <label style="display: block; font-weight: 600; margin-bottom: 5px; color: #495057;">Refresh Token Reference</label>
            <div class="code-block">${tokenPath}</div>
            <small>Automatically populated by OAuth flow</small>
          </div>
        </div>

        <div class="section">
          <h4>4. Sync Folders (Optional)</h4>
          <p>Specify which Dropbox folders to sync. Leave empty to sync all folders in your Dropbox.</p>

          ${this.syncFolders.length > 0
            ? html`<div class="sync-folder-list">
                ${this.syncFolders.map(
                  (folder, index) =>
                    html`<div class="sync-folder-item">
                      <code>${folder}</code>
                      <button
                        type="button"
                        class="btn btn-danger btn-sm"
                        @click="${() => this.handleRemoveSyncFolder(index)}"
                      >
                        Remove
                      </button>
                    </div>`
                )}
              </div>`
            : html`<p style="color: #999; font-style: italic; margin: 15px 0;">
                No folders configured - will sync entire Dropbox
              </p>`}

          <div class="form-row">
            <admin-form-group
              id="new-sync-folder"
              label=""
              type="text"
              placeholder="/Archive - Photo/Events/2025 Events"
              .value="${this.newSyncFolder}"
              @input-changed="${this.handleNewSyncFolderChange}"
            ></admin-form-group>
            <button type="button" class="btn btn-primary" @click="${this.handleAddSyncFolder}">
              Add Folder
            </button>
          </div>

          <div style="margin-top: 15px;">
            <button
              type="button"
              class="btn btn-primary"
              @click="${this.handleSaveSyncFolders}"
              ?disabled="${this.isSaving}"
            >
              ${this.isSaving ? 'Saving...' : 'Save Sync Folders'}
            </button>
          </div>

          <small style="display: block; margin-top: 10px;">
            Examples: /Archive - Photo/Events/2025 Events, /Camera Uploads, /Photos<br />
            Leave list empty to sync entire Dropbox without folder restrictions.
          </small>
        </div>

        <div class="section section-warning">
          <h4>Initial Setup Instructions</h4>
          <p><strong>Before connecting, create required secrets in Google Cloud Secret Manager:</strong></p>
          <ol>
            <li>Create Dropbox app at <a href="https://www.dropbox.com/developers/apps" target="_blank">Dropbox App Console</a></li>
            <li>Copy your App Key from the Dropbox console</li>
            <li>Copy your App Secret from the Dropbox console</li>
            <li>Create App Secret in Secret Manager (replace YOUR_APP_SECRET with actual value):
              <pre>echo -n "YOUR_APP_SECRET" | \
  gcloud secrets create dropbox-app-secret-${this.tenant.id} \
  --data-file=- \
  --project=photocat-483622</pre>
            </li>
            <li>Enter your App Key above and click "Save App Key"</li>
            <li>Click "Connect Dropbox Account" to generate/store the refresh token secret</li>
          </ol>
        </div>
      </div>
    `;
  }

  _renderGdriveSections(gdriveClientSecretName, gdriveTokenSecretName, gdriveClientSecretPath, gdriveTokenPath) {
    return html`
      <div class="provider-panel">
        <div class="section">
          <h4>1. Configure Google Drive</h4>
          <form @submit="${this.handleSaveGdriveSettings}">
            <admin-form-group
              label="Google Drive Client ID"
              type="text"
              placeholder="1234567890-abc.apps.googleusercontent.com"
              .value="${this.gdriveClientId}"
              @input-changed="${this.handleGdriveClientIdChange}"
              helper-text="OAuth client ID for Google Drive web application flow"
              required
            ></admin-form-group>

            <admin-form-group
              label="Google Client Secret Name (Secret Manager)"
              type="text"
              placeholder="gdrive-client-secret-${this.tenant.id}"
              .value="${this.gdriveClientSecret}"
              @input-changed="${this.handleGdriveClientSecretChange}"
              helper-text="Secret name only; full path is shown below"
            ></admin-form-group>

            <admin-form-group
              label="Google Refresh Token Secret Name (Secret Manager)"
              type="text"
              placeholder="gdrive-token-${this.tenant.id}"
              .value="${this.gdriveTokenSecret}"
              @input-changed="${this.handleGdriveTokenSecretChange}"
              helper-text="Secret name for OAuth refresh token"
            ></admin-form-group>

            <div class="form-actions">
              <button type="submit" class="btn btn-primary" ?disabled="${this.isSaving}">
                ${this.isSaving ? 'Saving...' : 'Save Google Drive Settings'}
              </button>
            </div>
          </form>
        </div>

        <div class="section section-success">
          <h4>2. Connect Google Drive</h4>
          <p>
            Authorize PhotoCat to access this tenant's Google Drive. The refresh token will be stored in Secret Manager.
          </p>
          <button type="button" class="btn btn-primary" @click="${this.handleConnectGdrive}">
            <i class="fab fa-google-drive"></i> Connect Google Drive
          </button>
          ${this.gdriveConnectionStatus
            ? html`<div class="connection-status ${
                  this.gdriveConnectionStatus.includes('Warning:') ? 'status-error' : 'status-success'
                }">
                ${this.gdriveConnectionStatus}
              </div>`
            : ''}
        </div>

        <div class="section">
          <h4>3. Current Configuration</h4>
          <div style="margin-bottom: 15px;">
            <label style="display: block; font-weight: 600; margin-bottom: 5px; color: #495057;">Client Secret Reference</label>
            <div class="code-block">${gdriveClientSecretPath}</div>
          </div>
          <div>
            <label style="display: block; font-weight: 600; margin-bottom: 5px; color: #495057;">Refresh Token Reference</label>
            <div class="code-block">${gdriveTokenPath}</div>
            <small>Automatically populated by OAuth flow</small>
          </div>
        </div>

        <div class="section">
          <h4>4. Sync Folders (Optional)</h4>
          <p>Specify Google Drive folder IDs to sync. Leave empty to sync all accessible image files.</p>

          ${this.gdriveSyncFolders.length > 0
            ? html`<div class="sync-folder-list">
                ${this.gdriveSyncFolders.map(
                  (folder, index) =>
                    html`<div class="sync-folder-item">
                      <code>${folder}</code>
                      <button
                        type="button"
                        class="btn btn-danger btn-sm"
                        @click="${() => this.handleRemoveGdriveSyncFolder(index)}"
                      >
                        Remove
                      </button>
                    </div>`
                )}
              </div>`
            : html`<p style="color: #999; font-style: italic; margin: 15px 0;">
                No Google Drive folder IDs configured - sync includes all accessible Drive images
              </p>`}

          <div class="form-row">
            <admin-form-group
              id="new-gdrive-sync-folder"
              label=""
              type="text"
              placeholder="Google Drive folder ID"
              .value="${this.newGdriveSyncFolder}"
              @input-changed="${this.handleNewGdriveSyncFolderChange}"
            ></admin-form-group>
            <button type="button" class="btn btn-primary" @click="${this.handleAddGdriveSyncFolder}">
              Add Folder ID
            </button>
          </div>

          <small style="display: block; margin-top: 10px;">
            Use Drive folder IDs (not names). You can copy IDs from Drive URLs.
          </small>
        </div>

        <div class="section section-warning">
          <h4>Initial Setup Instructions</h4>
          <p><strong>How to obtain required Google Drive values:</strong></p>
          <ol>
            <li>Open Google Cloud Console and select the project that will own the OAuth app.</li>
            <li>Enable the Google Drive API in that project.</li>
            <li>Create OAuth credentials (OAuth client ID) for a Web application.</li>
            <li>Add this redirect URI in the OAuth client configuration:
              <pre>${window.location.origin}/oauth/gdrive/callback</pre>
            </li>
            <li>Copy the OAuth client ID and save it into "Google Drive Client ID" above.</li>
            <li>Store the OAuth client secret in Secret Manager:
              <pre>echo -n "YOUR_GOOGLE_CLIENT_SECRET" | \
  gcloud secrets create ${gdriveClientSecretName} \
  --data-file=- \
  --project=photocat-483622</pre>
            </li>
            <li>Save the secret names above, then click "Connect Google Drive" to complete OAuth and store refresh token in:
              <pre>${gdriveTokenSecretName}</pre>
            </li>
            <li>If needed, use folder IDs in "Sync Folders" to restrict ingestion scope.</li>
          </ol>
          <p>
            Helpful references:
            <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank">Enable Drive API</a>
            ,
            <a href="https://console.cloud.google.com/apis/credentials" target="_blank">OAuth Credentials</a>
            .
          </p>
        </div>
      </div>
    `;
  }

  _renderFlickrSections(flickrApiSecretName, flickrTokenSecretName, flickrApiSecretPath, flickrTokenPath) {
    return html`
      <div class="provider-panel">
        <div class="section">
          <h4>1. Configure Flickr</h4>
          <form @submit="${this.handleSaveFlickrSettings}">
            <admin-form-group
              label="Flickr API Key"
              type="text"
              placeholder="Your Flickr API key"
              .value="${this.flickrApiKey}"
              @input-changed="${this.handleFlickrApiKeyChange}"
              helper-text="Public API key from Flickr App Garden"
              required
            ></admin-form-group>

            <admin-form-group
              label="Flickr API Secret Name (Secret Manager)"
              type="text"
              placeholder="flickr-api-secret-${this.tenant.id}"
              .value="${this.flickrApiSecret}"
              @input-changed="${this.handleFlickrApiSecretChange}"
              helper-text="Secret name only; full path is shown below"
            ></admin-form-group>

            <admin-form-group
              label="Flickr OAuth Token Secret Name (Secret Manager)"
              type="text"
              placeholder="flickr-token-${this.tenant.id}"
              .value="${this.flickrTokenSecret}"
              @input-changed="${this.handleFlickrTokenSecretChange}"
              helper-text="Secret name for OAuth access token and secret"
            ></admin-form-group>

            <div class="form-actions">
              <button type="submit" class="btn btn-primary" ?disabled="${this.isSaving}">
                ${this.isSaving ? 'Saving...' : 'Save Flickr Settings'}
              </button>
            </div>
          </form>
        </div>

        <div class="section">
          <h4>2. Current Configuration</h4>
          <div style="margin-bottom: 15px;">
            <label style="display: block; font-weight: 600; margin-bottom: 5px; color: #495057;">API Secret Reference</label>
            <div class="code-block">${flickrApiSecretPath}</div>
          </div>
          <div>
            <label style="display: block; font-weight: 600; margin-bottom: 5px; color: #495057;">OAuth Token Reference</label>
            <div class="code-block">${flickrTokenPath}</div>
          </div>
        </div>

        <div class="section">
          <h4>3. Sync Albums (Optional)</h4>
          <p>Specify Flickr album IDs (photoset IDs) to sync. Leave empty to sync all accessible assets.</p>

          ${this.flickrSyncAlbums.length > 0
            ? html`<div class="sync-folder-list">
                ${this.flickrSyncAlbums.map(
                  (album, index) =>
                    html`<div class="sync-folder-item">
                      <code>${album}</code>
                      <button
                        type="button"
                        class="btn btn-danger btn-sm"
                        @click="${() => this.handleRemoveFlickrSyncAlbum(index)}"
                      >
                        Remove
                      </button>
                    </div>`
                )}
              </div>`
            : html`<p style="color: #999; font-style: italic; margin: 15px 0;">
                No Flickr album IDs configured - sync includes all accessible Flickr assets
              </p>`}

          <div class="form-row">
            <admin-form-group
              id="new-flickr-sync-album"
              label=""
              type="text"
              placeholder="Flickr photoset ID"
              .value="${this.newFlickrSyncAlbum}"
              @input-changed="${this.handleNewFlickrSyncAlbumChange}"
            ></admin-form-group>
            <button type="button" class="btn btn-primary" @click="${this.handleAddFlickrSyncAlbum}">
              Add Album ID
            </button>
          </div>

          <small style="display: block; margin-top: 10px;">
            Use Flickr photoset IDs. You can derive these from Flickr album URLs or API responses.
          </small>
        </div>

        <div class="section section-warning">
          <h4>Initial Setup Instructions</h4>
          <p><strong>How to obtain required Flickr values:</strong></p>
          <ol>
            <li>Create an app in Flickr App Garden and copy the API key and API secret.</li>
            <li>Save the API key above in "Flickr API Key".</li>
            <li>Store API secret in Secret Manager:
              <pre>echo -n "YOUR_FLICKR_API_SECRET" | \
  gcloud secrets create ${flickrApiSecretName} \
  --data-file=- \
  --project=photocat-483622</pre>
            </li>
            <li>Create OAuth token/secret for the tenant, then store them together as JSON in:
              <pre>${flickrTokenSecretName}</pre>
            </li>
            <li>Optional: add photoset IDs in "Sync Albums" to limit scope.</li>
          </ol>
          <p>
            OAuth callback wiring for Flickr is not yet enabled in PhotoCat. Save settings here first, then backend OAuth can
            be added without changing tenant config.
          </p>
        </div>
      </div>
    `;
  }

  render() {
    if (!this.tenant || !this.systemSettings) {
      return html`<div class="error show">Unable to load tenant or system information</div>`;
    }

    const projectId = this.systemSettings.gcp_project_id;
    const appSecretPath = `projects/${projectId}/secrets/dropbox-app-secret-${this.tenant.id}/versions/latest`;
    const tokenPath = `projects/${projectId}/secrets/dropbox-token-${this.tenant.id}/versions/latest`;
    const gdriveClientSecretName = this.gdriveClientSecret.trim() || `gdrive-client-secret-${this.tenant.id}`;
    const gdriveTokenSecretName = this.gdriveTokenSecret.trim() || `gdrive-token-${this.tenant.id}`;
    const gdriveClientSecretPath = `projects/${projectId}/secrets/${gdriveClientSecretName}/versions/latest`;
    const gdriveTokenPath = `projects/${projectId}/secrets/${gdriveTokenSecretName}/versions/latest`;
    const flickrApiSecretName = this.flickrApiSecret.trim() || `flickr-api-secret-${this.tenant.id}`;
    const flickrTokenSecretName = this.flickrTokenSecret.trim() || `flickr-token-${this.tenant.id}`;
    const flickrApiSecretPath = `projects/${projectId}/secrets/${flickrApiSecretName}/versions/latest`;
    const flickrTokenPath = `projects/${projectId}/secrets/${flickrTokenSecretName}/versions/latest`;
    const storageTabs = [
      { id: 'dropbox', label: 'Dropbox' },
      { id: 'gdrive', label: 'Google Drive' },
      { id: 'flickr', label: 'Flickr' },
    ];

    return html`
      <div class="card">
        <h3>Storage Integrations</h3>
        <p>Configure provider settings under each storage sub-folder.</p>

        <div class="error ${this.errorMessage ? 'show' : ''}">${this.errorMessage}</div>
        <div class="success ${this.successMessage ? 'show' : ''}">${this.successMessage}</div>
        <admin-tabs
          .tabs="${storageTabs}"
          .activeTab="${this.activeStorageTab}"
          @tab-changed="${this.handleStorageTabChanged}"
        ></admin-tabs>

        ${this.activeStorageTab === 'dropbox'
          ? this._renderDropboxSections(appSecretPath, tokenPath)
          : html``}
        ${this.activeStorageTab === 'gdrive'
          ? this._renderGdriveSections(gdriveClientSecretName, gdriveTokenSecretName, gdriveClientSecretPath, gdriveTokenPath)
          : html``}
        ${this.activeStorageTab === 'flickr'
          ? this._renderFlickrSections(flickrApiSecretName, flickrTokenSecretName, flickrApiSecretPath, flickrTokenPath)
          : html``}
      </div>
    `;
  }
}

customElements.define('admin-storage-setup', AdminStorageSetup);
