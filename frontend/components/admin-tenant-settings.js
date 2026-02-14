import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import './admin-form-group.js';
import { updateTenant, deleteTenant, getTenantPhotoCount } from '../services/api.js';

/**
 * Admin Tenant Settings Component
 * Manages tenant settings, storage configuration, and deletion
 */
export class AdminTenantSettings extends LitElement {
  static properties = {
    tenant: { type: Object },
    systemSettings: { type: Object },
    formData: { type: Object },
    useDedicatedBucket: { type: Boolean },
    deleteConfirmation: { type: String },
    errorMessage: { type: String },
    successMessage: { type: String },
    isSaving: { type: Boolean },
    isDeleting: { type: Boolean },
    computedBucketName: { type: String }
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
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        margin-bottom: 20px;
      }

      .settings-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 15px;
        margin-bottom: 20px;
      }

      .setting-box {
        padding: 12px;
        background: #f8f9fa;
        border-radius: 6px;
      }

      .setting-label {
        font-size: 12px;
        color: #666;
        margin-bottom: 4px;
      }

      .setting-value {
        font-size: 16px;
        font-weight: 600;
        font-family: monospace;
        color: #333;
      }

      .bucket-info {
        background: #e7f3ff;
        border-left: 4px solid #0066cc;
        padding: 12px;
        margin-bottom: 20px;
        border-radius: 4px;
      }

      .bucket-info strong {
        color: #0066cc;
      }

      .bucket-info ul {
        margin: 8px 0 0 0;
        padding-left: 20px;
        color: #666;
        font-size: 13px;
      }

      .bucket-info li {
        margin: 4px 0;
      }

      .bucket-info code {
        background: white;
        padding: 2px 4px;
        border-radius: 2px;
      }

      .bucket-display {
        padding: 12px;
        background: #f8f9fa;
        border-radius: 6px;
        margin-top: 10px;
      }

      .bucket-display-label {
        font-size: 12px;
        color: #666;
        margin-bottom: 4px;
      }

      .bucket-display-name {
        font-size: 14px;
        font-weight: 500;
        font-family: monospace;
        color: #333;
      }

      .bucket-display-type {
        font-size: 12px;
        color: #999;
        margin-top: 4px;
      }

      h3 {
        margin-top: 30px;
        padding-top: 20px;
        border-top: 1px solid #eee;
        font-size: 18px;
        color: #333;
      }

      h3:first-child {
        margin-top: 0;
        padding-top: 0;
        border-top: none;
      }

      .form-row {
        display: flex;
        gap: 15px;
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

      .btn-danger {
        background: #dc3545;
        color: white;
      }

      .btn-danger:hover {
        background: #c82333;
      }

      .danger-zone {
        margin-top: 40px;
        padding: 20px;
        background: #fff5f5;
        border: 2px solid #fc8181;
        border-radius: 8px;
      }

      .danger-zone h4 {
        color: #c53030;
        margin-top: 0;
      }

      .danger-zone p {
        color: #666;
        margin-bottom: 15px;
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
    this.systemSettings = null;
    this.formData = {};
    this.useDedicatedBucket = false;
    this.deleteConfirmation = '';
    this.errorMessage = '';
    this.successMessage = '';
    this.isSaving = false;
    this.isDeleting = false;
    this.computedBucketName = '';
  }

  updated(changedProperties) {
    if (changedProperties.has('tenant')) {
      this.formData = {
        identifier: this.tenant?.identifier || this.tenant?.id || '',
        name: this.tenant?.name || '',
        active: this.tenant?.active || false
      };
      this.useDedicatedBucket = !!(this.tenant?.thumbnail_bucket);
      this.updateBucketDisplay();
    }
  }

  updateBucketDisplay() {
    if (!this.systemSettings || !this.tenant) return;

    const env = this.systemSettings.environment.toLowerCase();
    const projectId = this.systemSettings.gcp_project_id;
    const keyPrefix = this.tenant.key_prefix || this.tenant.id;

    if (this.useDedicatedBucket) {
      this.computedBucketName = `${projectId}-${env}-${keyPrefix}`;
    } else {
      this.computedBucketName = `${projectId}-${env}-shared`;
    }
  }

  handleIdentifierChange(e) {
    this.formData = { ...this.formData, identifier: e.detail.value };
  }

  handleNameChange(e) {
    this.formData = { ...this.formData, name: e.detail.value };
  }

  handleActiveChange(e) {
    this.formData = { ...this.formData, active: e.detail.checked };
  }

  handleBucketCheckboxChange(e) {
    this.useDedicatedBucket = e.detail.checked;
    this.updateBucketDisplay();
  }

  handleDeleteConfirmationChange(e) {
    this.deleteConfirmation = e.detail.value;
  }

  async handleSaveTenantSettings(e) {
    e.preventDefault();

    this.isSaving = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      const identifier = (this.formData.identifier || '').trim().toLowerCase();
      if (!/^[a-z0-9-]+$/.test(identifier)) {
        this.errorMessage = 'Identifier must contain only lowercase letters, numbers, and hyphens';
        this.isSaving = false;
        return;
      }

      const data = {
        identifier,
        name: this.formData.name,
        active: this.formData.active,
        thumbnail_bucket: this.useDedicatedBucket ? this.computedBucketName : null
      };

      const updated = await updateTenant(this.tenant.id, data);

      this.successMessage = 'Settings saved successfully';
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
      console.error('Error saving tenant settings:', error);
      this.errorMessage = error.message || 'Failed to save tenant settings';
    } finally {
      this.isSaving = false;
    }
  }

  async handleDeleteTenant() {
    if (this.deleteConfirmation !== 'I really mean it') {
      this.errorMessage = 'Please type "I really mean it" exactly to confirm deletion';
      return;
    }

    if (!this.tenant?.id) {
      this.errorMessage = 'No tenant selected';
      return;
    }

    // Check photo count before deleting
    this.isDeleting = true;
    this.errorMessage = '';

    try {
      // Check photo count before allowing deletion
      const photoCount = await getTenantPhotoCount(this.tenant.id);
      if (photoCount > 0) {
        this.errorMessage = `Cannot delete tenant: ${photoCount} photo(s) owned. Delete all photos first.`;
        this.isDeleting = false;
        return;
      }

      await deleteTenant(this.tenant.id);

      // Close the editor
      this.dispatchEvent(
        new CustomEvent('close', {
          bubbles: true,
          composed: true
        })
      );
    } catch (error) {
      console.error('Error deleting tenant:', error);
      this.errorMessage = error.message || 'Failed to delete tenant';
    } finally {
      this.isDeleting = false;
    }
  }

  render() {
    if (!this.tenant || !this.systemSettings) {
      return html`<div class="error show">Unable to load tenant settings</div>`;
    }

    const envColor = this.systemSettings.environment.toLowerCase() === 'prod' ? '#c53030' : '#38a169';

    return html`
      <div class="card">
        <div class="error ${this.errorMessage ? 'show' : ''}">${this.errorMessage}</div>
        <div class="success ${this.successMessage ? 'show' : ''}">${this.successMessage}</div>

        <h3 style="margin-top: 0;">System Settings (Read-Only)</h3>
        <div class="settings-grid">
          <div class="setting-box">
            <div class="setting-label">Environment</div>
            <div class="setting-value" style="color: ${envColor};">
              ${this.systemSettings.environment.toUpperCase()}
            </div>
          </div>
          <div class="setting-box">
            <div class="setting-label">GCP Project</div>
            <div class="setting-value">${this.systemSettings.gcp_project_id}</div>
          </div>
          <div class="setting-box">
            <div class="setting-label">Region</div>
            <div class="setting-value">${this.systemSettings.gcp_region}</div>
          </div>
          <div class="setting-box">
            <div class="setting-label">Default Storage Bucket</div>
            <div class="setting-value" style="font-size: 13px;">
              ${this.systemSettings.storage_bucket_name}
            </div>
          </div>
        </div>

        <h3>Tenant Details</h3>
        <form @submit="${this.handleSaveTenantSettings}">
          <admin-form-group
            label="Tenant UUID"
            type="text"
            .value="${this.tenant.id}"
            readonly
            helper-text="Internal immutable tenant ID"
          ></admin-form-group>

          <admin-form-group
            label="Identifier"
            type="text"
            .value="${this.formData.identifier || ''}"
            @input-changed="${this.handleIdentifierChange}"
            helper-text="Human-facing label used in CLI and manual entry points"
            required
          ></admin-form-group>

          <admin-form-group
            label="Key Prefix"
            type="text"
            .value="${this.tenant.key_prefix || this.tenant.id}"
            readonly
            helper-text="Immutable secret/object-key prefix"
          ></admin-form-group>

          <admin-form-group
            label="Display Name"
            type="text"
            .value="${this.formData.name}"
            @input-changed="${this.handleNameChange}"
            required
          ></admin-form-group>

          <admin-form-group
            .isCheckbox="${true}"
            label="Active"
            .checked="${this.formData.active}"
            @checkbox-changed="${this.handleActiveChange}"
          ></admin-form-group>

          <h3>Storage Configuration</h3>

          <div class="bucket-info">
            <p style="margin: 0;"><strong>Storage Bucket Convention:</strong></p>
            <ul>
              <li><strong>Shared bucket (default):</strong> <code>${this.systemSettings.gcp_project_id}-${this.systemSettings.environment.toLowerCase()}-shared</code></li>
              <li><strong>Tenant-specific:</strong> <code>${this.systemSettings.gcp_project_id}-${this.systemSettings.environment.toLowerCase()}-${this.tenant.key_prefix || this.tenant.id}</code></li>
              <li>Paths always include tenant key prefix: <code>${this.tenant.key_prefix || this.tenant.id}/thumbnails/image.jpg</code></li>
            </ul>
            <p style="margin: 8px 0 0 0; color: #666; font-size: 13px;">To set up a dedicated bucket, check the box below and run:</p>
            <code style="display: block; margin-top: 8px; padding: 8px; background: white; border-radius: 4px; font-family: monospace; font-size: 12px;">python scripts/setup_tenant_buckets.py --tenant-id ${this.tenant.identifier || this.tenant.id}</code>
          </div>

          <admin-form-group
            .isCheckbox="${true}"
            label="Use dedicated bucket for this tenant"
            .checked="${this.useDedicatedBucket}"
            @checkbox-changed="${this.handleBucketCheckboxChange}"
          ></admin-form-group>

          <div class="bucket-display">
            <div class="bucket-display-label">Active bucket:</div>
            <div class="bucket-display-name">${this.computedBucketName}</div>
            <div class="bucket-display-type">
              ${this.useDedicatedBucket ? 'Dedicated tenant bucket' : 'Shared bucket (default)'}
            </div>
          </div>

          <div class="form-actions">
            <button type="submit" class="btn btn-primary" ?disabled="${this.isSaving}">
              ${this.isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>

        <div class="danger-zone">
          <h4 style="margin-top: 0;">⚠️ Danger Zone</h4>
          <p>Deleting a tenant is permanent and will remove all associated data including keywords, people, and image metadata.</p>

          <admin-form-group
            label="Type 'I really mean it' to confirm deletion:"
            type="text"
            placeholder="Type exactly: I really mean it"
            .value="${this.deleteConfirmation}"
            @input-changed="${this.handleDeleteConfirmationChange}"
          ></admin-form-group>

          <button
            type="button"
            class="btn btn-danger"
            @click="${this.handleDeleteTenant}"
            ?disabled="${this.isDeleting}"
          >
            ${this.isDeleting ? 'Deleting...' : html`<i class="fas fa-trash"></i> Delete Tenant`}
          </button>
        </div>
      </div>
    `;
  }
}

customElements.define('admin-tenant-settings', AdminTenantSettings);
