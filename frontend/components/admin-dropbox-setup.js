import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import './admin-form-group.js';
import { updateTenant, updateTenantSettings } from '../services/api.js';

/**
 * Admin Dropbox Setup Component
 * Manages Dropbox integration, OAuth flow, and sync folder configuration
 */
export class AdminDropboxSetup extends LitElement {
  static properties = {
    tenant: { type: Object },
    systemSettings: { type: Object },
    dropboxAppKey: { type: String },
    syncFolders: { type: Array },
    newSyncFolder: { type: String },
    errorMessage: { type: String },
    successMessage: { type: String },
    isSaving: { type: Boolean },
    connectionStatus: { type: String }
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
    `
  ];

  constructor() {
    super();
    this.tenant = null;
    this.dropboxAppKey = '';
    this.syncFolders = [];
    this.newSyncFolder = '';
    this.errorMessage = '';
    this.successMessage = '';
    this.isSaving = false;
    this.connectionStatus = '';
  }

  updated(changedProperties) {
    if (changedProperties.has('tenant')) {
      this.dropboxAppKey = this.tenant?.dropbox_app_key || '';
      this.syncFolders = (this.tenant?.settings?.dropbox_sync_folders) || [];
    }
  }

  handleAppKeyChange(e) {
    this.dropboxAppKey = e.detail.value;
  }

  handleNewSyncFolderChange(e) {
    this.newSyncFolder = e.detail.value;
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
      await updateTenantSettings(this.tenant.id, {
        dropbox_sync_folders: this.syncFolders
      });

      this.successMessage = 'Sync folders saved successfully';
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

  render() {
    if (!this.tenant || !this.systemSettings) {
      return html`<div class="error show">Unable to load tenant or system information</div>`;
    }

    const projectId = this.systemSettings.gcp_project_id;
    const appSecretPath = `projects/${projectId}/secrets/dropbox-app-secret-${this.tenant.id}/versions/latest`;
    const tokenPath = `projects/${projectId}/secrets/dropbox-token-${this.tenant.id}/versions/latest`;

    return html`
      <div class="card">
        <h3>Dropbox Integration</h3>
        <p>Connect this tenant to Dropbox for automatic file synchronization</p>

        <div class="error ${this.errorMessage ? 'show' : ''}">${this.errorMessage}</div>
        <div class="success ${this.successMessage ? 'show' : ''}">${this.successMessage}</div>

        <!-- App Key Configuration -->
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

        <!-- OAuth Connection -->
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

        <!-- Current Configuration -->
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

        <!-- Sync Folders -->
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

        <!-- Setup Instructions -->
        <div class="section section-warning">
          <h4>📋 Initial Setup Instructions</h4>
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
            <li>Enter your App Key in the form above and click "Save App Key"</li>
            <li>Click "Connect Dropbox Account" - this will automatically create the refresh token secret</li>
          </ol>
        </div>
      </div>
    `;
  }
}

customElements.define('admin-dropbox-setup', AdminDropboxSetup);
