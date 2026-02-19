import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import {
  getPeople,
  createPerson,
  updatePerson,
  deletePerson,
  getPersonReferences,
  createPersonReference,
  deletePersonReference,
  getImages,
  getImageDetails,
  uploadAndIngestImage,
} from '../services/api.js';

class PersonManager extends LitElement {
  static properties = {
    tenant: { type: String },
    readOnly: { type: Boolean },
    view: { type: String }, // 'list' or 'editor'
    people: { type: Array },
    selectedPersonId: { type: Number },
    loading: { type: Boolean },
    error: { type: String },
    formData: { type: Object },
    searchQuery: { type: String },
    references: { type: Array },
    referencesLoading: { type: Boolean },
    referencesError: { type: String },
    referenceUploadFile: { type: Object },
    referenceUploadBusy: { type: Boolean },
    referenceSearchQuery: { type: String },
    referenceSearchResults: { type: Array },
    referenceSearchLoading: { type: Boolean },
    referenceActionBusyKey: { type: String },
  };

  static styles = [tailwind, css`
    :host {
      display: block;
      min-height: 460px;
    }
    .container {
      display: flex;
      flex-direction: column;
      min-height: 460px;
      background: #f9fafb;
    }
    .header {
      background: #ffffff;
      border-bottom: 1px solid #e5e7eb;
      padding: 20px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }
    .header-title {
      font-size: 24px;
      font-weight: 700;
      color: #111827;
      margin-bottom: 14px;
    }
    .header-controls {
      display: flex;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
    }
    .search-box {
      flex: 1 1 420px;
      min-width: 220px;
      padding: 9px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 14px;
    }
    .btn-primary {
      padding: 10px 16px;
      background: #3b82f6;
      color: #ffffff;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-primary:hover {
      background: #2563eb;
    }
    .btn-secondary {
      padding: 10px 16px;
      background: #e5e7eb;
      color: #111827;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-secondary:hover {
      background: #d1d5db;
    }
    .btn-danger {
      padding: 10px 16px;
      background: #dc2626;
      color: #ffffff;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-danger:hover {
      background: #b91c1c;
    }
    .btn-danger:disabled,
    .btn-primary:disabled,
    .btn-secondary:disabled {
      opacity: 0.65;
      cursor: not-allowed;
    }
    .content {
      flex: 1;
      overflow: auto;
      padding: 20px;
    }
    .table-shell {
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 2px rgba(17, 24, 39, 0.05);
    }
    .table-wrap {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 860px;
    }
    thead th {
      text-align: left;
      background: #f3f4f6;
      color: #374151;
      padding: 12px 14px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border-bottom: 1px solid #e5e7eb;
      white-space: nowrap;
    }
    tbody td {
      padding: 13px 14px;
      border-bottom: 1px solid #e5e7eb;
      color: #111827;
      font-size: 14px;
      vertical-align: middle;
    }
    tbody tr:hover {
      background: #f9fafb;
    }
    tbody tr:last-child td {
      border-bottom: none;
    }
    .name-cell {
      font-weight: 600;
      color: #111827;
      white-space: nowrap;
    }
    .count-cell {
      font-weight: 600;
      color: #1f2937;
      white-space: nowrap;
    }
    .date-cell {
      color: #4b5563;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .url-cell a {
      color: #3b82f6;
      text-decoration: none;
      word-break: break-all;
    }
    .url-cell a:hover {
      text-decoration: underline;
    }
    .row-actions {
      display: inline-flex;
      gap: 8px;
      align-items: center;
    }
    .btn-small {
      padding: 7px 10px;
      background: #f3f4f6;
      color: #111827;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-small:hover {
      background: #e5e7eb;
    }
    .editor-form {
      width: 100%;
      max-width: 1152px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 8px;
      padding: 24px;
      border: 1px solid #e5e7eb;
      box-shadow: 0 10px 20px rgba(15, 23, 42, 0.08);
    }
    .editor-title {
      margin-bottom: 16px;
      font-size: 20px;
      font-weight: 700;
      color: #111827;
      line-height: 1.3;
    }
    .form-group {
      margin-bottom: 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .form-label {
      font-size: 14px;
      font-weight: 600;
      color: #111827;
    }
    .form-input {
      padding: 10px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 14px;
      font-family: inherit;
    }
    .form-input:focus {
      outline: none;
      border-color: #3b82f6;
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
    }
    .form-hint {
      font-size: 13px;
      color: #6b7280;
    }
    .form-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 24px;
    }
    .form-actions-right {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .error-message {
      background: #fee2e2;
      border: 1px solid #fecaca;
      border-radius: 6px;
      padding: 12px;
      color: #dc2626;
      font-size: 13px;
      margin-bottom: 16px;
    }
    .loading {
      text-align: center;
      padding: 40px;
      color: #6b7280;
      font-size: 13px;
    }
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #6b7280;
    }
    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 12px;
    }
    .references-section {
      margin-top: 24px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
    }
    .references-title {
      margin: 0 0 8px 0;
      font-size: 16px;
      font-weight: 700;
      color: #111827;
    }
    .references-summary {
      margin-bottom: 12px;
      font-size: 13px;
      color: #4b5563;
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }
    .references-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
    }
    @media (min-width: 980px) {
      .references-grid {
        grid-template-columns: 1fr 1fr;
      }
    }
    .reference-card {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #f9fafb;
      padding: 12px;
    }
    .reference-card-title {
      font-size: 13px;
      font-weight: 700;
      color: #111827;
      margin-bottom: 8px;
    }
    .reference-row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .reference-file-name {
      font-size: 12px;
      color: #4b5563;
      overflow-wrap: anywhere;
    }
    .reference-list {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
      margin-top: 10px;
      background: #fff;
      max-height: 260px;
      overflow-y: auto;
    }
    .reference-list-item {
      display: flex;
      gap: 8px;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      border-bottom: 1px solid #e5e7eb;
    }
    .reference-list-item:last-child {
      border-bottom: none;
    }
    .reference-meta {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
      font-size: 12px;
      color: #4b5563;
    }
    .reference-meta strong {
      font-size: 13px;
      color: #111827;
      overflow-wrap: anywhere;
    }
    .asset-search-results {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      margin-top: 10px;
      overflow: hidden;
      max-height: 260px;
      overflow-y: auto;
      background: #fff;
    }
    .asset-search-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      border-bottom: 1px solid #e5e7eb;
      padding: 8px 10px;
    }
    .asset-search-item:last-child {
      border-bottom: none;
    }
    .asset-search-left {
      display: flex;
      gap: 10px;
      min-width: 0;
      align-items: center;
    }
    .asset-search-thumb {
      width: 42px;
      height: 42px;
      border-radius: 6px;
      object-fit: cover;
      background: #e5e7eb;
      flex-shrink: 0;
    }
    .asset-search-text {
      min-width: 0;
      display: flex;
      flex-direction: column;
      font-size: 12px;
      color: #4b5563;
      gap: 1px;
    }
    .asset-search-text strong {
      font-size: 13px;
      color: #111827;
      overflow-wrap: anywhere;
    }
  `];

  constructor() {
    super();
    this.readOnly = false;
    this.view = 'list';
    this.people = [];
    this.selectedPersonId = null;
    this.loading = false;
    this.error = '';
    this.formData = { name: '', instagram_url: '' };
    this.searchQuery = '';
    this.references = [];
    this.referencesLoading = false;
    this.referencesError = '';
    this.referenceUploadFile = null;
    this.referenceUploadBusy = false;
    this.referenceSearchQuery = '';
    this.referenceSearchResults = [];
    this.referenceSearchLoading = false;
    this.referenceActionBusyKey = '';
  }

  async connectedCallback() {
    super.connectedCallback();
    console.log('[PersonManager] connectedCallback, tenant:', this.tenant);
    await this.loadData();
  }

  updated(changedProperties) {
    if (changedProperties.has('readOnly') && this.readOnly && this.view !== 'list') {
      this.view = 'list';
    }
  }

  async loadData() {
    console.log('[PersonManager] loadData starting');
    this.loading = true;
    this.error = '';
    try {
      await this.loadPeople();
      console.log('[PersonManager] people loaded:', this.people);
    } catch (err) {
      console.error('[PersonManager] loadData error:', err);
      this.error = err.message || 'Failed to load data';
    } finally {
      this.loading = false;
    }
  }

  async loadPeople() {
    const tenantId = this.tenant || localStorage.getItem('tenantId') || 'default';
    const data = await getPeople(tenantId, {
      limit: 500
    });
    this.people = data;
  }

  async savePerson() {
    if (this.readOnly) return;
    if (!this.formData.name.trim()) {
      this.error = 'Please enter a name';
      return;
    }

    const payload = {
      name: this.formData.name.trim(),
      instagram_url: (this.formData.instagram_url || '').trim(),
    };

    this.loading = true;
    this.error = '';
    try {
      const tenantId = this.tenant || localStorage.getItem('tenantId') || 'default';
      if (this.selectedPersonId) {
        await updatePerson(tenantId, this.selectedPersonId, payload);
      } else {
        await createPerson(tenantId, payload);
      }

      this.formData = { name: '', instagram_url: '' };
      this.selectedPersonId = null;
      this.view = 'list';
      await this.loadPeople();
    } catch (err) {
      this.error = err.message;
    } finally {
      this.loading = false;
    }
  }

  async deletePerson(personId) {
    if (this.readOnly) return;
    if (!personId) return;
    if (!confirm('Delete this person? This will remove all tags.')) return;

    this.loading = true;
    this.error = '';
    try {
      const tenantId = this.tenant || localStorage.getItem('tenantId') || 'default';
      await deletePerson(tenantId, personId);
      this.formData = { name: '', instagram_url: '' };
      this.selectedPersonId = null;
      this.view = 'list';
      await this.loadPeople();
    } catch (err) {
      this.error = err.message;
    } finally {
      this.loading = false;
    }
  }

  getFilteredPeople() {
    const query = (this.searchQuery || '').trim().toLowerCase();
    if (!query) return this.people;
    return this.people.filter((person) => {
      const name = (person.name || '').toLowerCase();
      const url = (person.instagram_url || '').toLowerCase();
      return name.includes(query) || url.includes(query);
    });
  }

  _formatDate(value) {
    if (!value) return '—';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return '—';
    return dt.toLocaleString();
  }

  _openCreateEditor() {
    this.selectedPersonId = null;
    this.formData = { name: '', instagram_url: '' };
    this.error = '';
    this.references = [];
    this.referencesError = '';
    this.referenceUploadFile = null;
    this.referenceUploadBusy = false;
    this.referenceSearchQuery = '';
    this.referenceSearchResults = [];
    this.referenceSearchLoading = false;
    this.referenceActionBusyKey = '';
    this.view = 'editor';
  }

  async _openEditEditor(person) {
    this.selectedPersonId = person.id;
    this.formData = {
      name: person.name || '',
      instagram_url: person.instagram_url || '',
    };
    this.error = '';
    this.references = [];
    this.referencesError = '';
    this.referenceUploadFile = null;
    this.referenceUploadBusy = false;
    this.referenceSearchQuery = '';
    this.referenceSearchResults = [];
    this.referenceSearchLoading = false;
    this.referenceActionBusyKey = '';
    this.view = 'editor';
    await this.loadReferences();
  }

  _getTenantId() {
    return this.tenant || localStorage.getItem('tenantId') || 'default';
  }

  async loadReferences() {
    if (!this.selectedPersonId) {
      this.references = [];
      return;
    }
    this.referencesLoading = true;
    this.referencesError = '';
    try {
      const tenantId = this._getTenantId();
      const refs = await getPersonReferences(tenantId, this.selectedPersonId);
      this.references = Array.isArray(refs) ? refs : [];
    } catch (err) {
      this.referencesError = err?.message || 'Failed to load references';
      this.references = [];
    } finally {
      this.referencesLoading = false;
    }
  }

  _handleReferenceFileInput(event) {
    const file = event?.target?.files?.[0] || null;
    this.referenceUploadFile = file;
  }

  async _uploadReferenceFile() {
    if (this.readOnly || !this.selectedPersonId || !this.referenceUploadFile) return;
    this.referenceUploadBusy = true;
    this.referencesError = '';
    try {
      const tenantId = this._getTenantId();
      const uploadResult = await uploadAndIngestImage(tenantId, this.referenceUploadFile, { dedupPolicy: 'skip_duplicate' });
      const imageId = Number(uploadResult?.image_id);
      if (!Number.isFinite(imageId) || imageId <= 0) {
        throw new Error('Upload completed but no image_id was returned.');
      }
      const image = await getImageDetails(tenantId, imageId);
      const sourceAssetId = String(image?.asset_id || '').trim();
      if (!sourceAssetId) {
        throw new Error('Uploaded image did not return an asset_id.');
      }
      await createPersonReference(tenantId, this.selectedPersonId, {
        source_type: 'asset',
        source_asset_id: sourceAssetId,
        is_active: true,
      });
      this.referenceUploadFile = null;
      await this.loadReferences();
    } catch (err) {
      this.referencesError = err?.message || 'Failed to upload reference.';
    } finally {
      this.referenceUploadBusy = false;
    }
  }

  async _searchAssetsForReference() {
    if (!this.selectedPersonId) return;
    const query = String(this.referenceSearchQuery || '').trim();
    if (!query) {
      this.referenceSearchResults = [];
      return;
    }
    this.referenceSearchLoading = true;
    this.referencesError = '';
    try {
      const tenantId = this._getTenantId();
      const response = await getImages(tenantId, {
        limit: 20,
        offset: 0,
        filenameQuery: query,
        hideZeroRating: true,
        orderBy: 'photo_creation',
        sortOrder: 'desc',
      });
      const images = Array.isArray(response) ? response : (response?.images || []);
      this.referenceSearchResults = images.filter((img) => img?.asset_id);
    } catch (err) {
      this.referencesError = err?.message || 'Failed to search assets.';
      this.referenceSearchResults = [];
    } finally {
      this.referenceSearchLoading = false;
    }
  }

  async _attachExistingAsset(assetId) {
    if (this.readOnly || !this.selectedPersonId || !assetId) return;
    const busyKey = `asset:${assetId}`;
    this.referenceActionBusyKey = busyKey;
    this.referencesError = '';
    try {
      const tenantId = this._getTenantId();
      await createPersonReference(tenantId, this.selectedPersonId, {
        source_type: 'asset',
        source_asset_id: String(assetId),
        is_active: true,
      });
      await this.loadReferences();
    } catch (err) {
      this.referencesError = err?.message || 'Failed to add reference.';
    } finally {
      this.referenceActionBusyKey = '';
    }
  }

  async _deleteReference(referenceId) {
    if (this.readOnly || !this.selectedPersonId || !referenceId) return;
    if (!confirm('Remove this reference photo?')) return;
    const busyKey = `ref:${referenceId}`;
    this.referenceActionBusyKey = busyKey;
    this.referencesError = '';
    try {
      const tenantId = this._getTenantId();
      await deletePersonReference(tenantId, this.selectedPersonId, referenceId);
      await this.loadReferences();
    } catch (err) {
      this.referencesError = err?.message || 'Failed to remove reference.';
    } finally {
      this.referenceActionBusyKey = '';
    }
  }

  _getReferenceSummary() {
    const refs = Array.isArray(this.references) ? this.references : [];
    const activeCount = refs.filter((ref) => ref?.is_active !== false).length;
    const lastUpdated = refs
      .map((ref) => new Date(ref?.updated_at || ref?.created_at || 0))
      .filter((dt) => !Number.isNaN(dt.getTime()))
      .sort((a, b) => b.getTime() - a.getTime())[0] || null;
    return {
      activeCount,
      totalCount: refs.length,
      lastUpdatedLabel: lastUpdated ? lastUpdated.toLocaleString() : '—',
    };
  }

  _truncateReferenceKey(reference) {
    const key = String(reference?.storage_key || reference?.source_asset_id || '').trim();
    if (!key) return '—';
    if (key.length <= 48) return key;
    return `${key.slice(0, 20)}…${key.slice(-24)}`;
  }

  render() {
    const filteredPeople = this.getFilteredPeople();
    const referenceSummary = this._getReferenceSummary();
    return html`
      <div class="container">
        <div class="header">
          <div class="header-title">People and Organizations</div>
          <div class="header-controls">
            ${this.view === 'list' ? html`
              <input
                type="text"
                class="search-box"
                placeholder="Search people and organizations..."
                .value="${this.searchQuery}"
                @input="${(e) => { this.searchQuery = e.target.value; }}"
              />
              ${this.readOnly ? html`` : html`
                <button class="btn-primary" @click="${this._openCreateEditor}">
                  + Add Person
                </button>
              `}
            ` : html`
              <button class="btn-secondary" @click="${() => { this.view = 'list'; this.error = ''; }}">
                ← Back to List
              </button>
            `}
          </div>
        </div>

        <div class="content">
          ${this.error ? html`
            <div class="error-message">${this.error}</div>
          ` : ''}

          ${this.view === 'list' ? html`
            ${this.loading ? html`
              <div class="loading">Loading people and organizations...</div>
            ` : filteredPeople.length === 0 ? html`
              <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                <div style="font-size: 16px; font-weight: 600; color: #111827; margin-bottom: 6px;">No people or organizations found</div>
                <div style="font-size: 13px; color: #6b7280;">Create your first entry to get started</div>
              </div>
            ` : html`
              <div class="table-shell">
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Instagram URL</th>
                        <th>Images Tagged</th>
                        <th>Created</th>
                        <th>Updated</th>
                        ${this.readOnly ? html`` : html`<th>Actions</th>`}
                      </tr>
                    </thead>
                    <tbody>
                      ${filteredPeople.map((person) => html`
                        <tr>
                          <td class="name-cell">${person.name || '—'}</td>
                          <td class="url-cell">
                            ${person.instagram_url ? html`
                              <a href="${person.instagram_url}" target="_blank" rel="noopener noreferrer">${person.instagram_url}</a>
                            ` : html`—`}
                          </td>
                          <td class="count-cell">${person.tag_count || 0}</td>
                          <td class="date-cell">${this._formatDate(person.created_at)}</td>
                          <td class="date-cell">${this._formatDate(person.updated_at)}</td>
                          ${this.readOnly ? html`` : html`
                            <td>
                              <div class="row-actions">
                                <button class="btn-small" @click="${() => this._openEditEditor(person)}">Edit</button>
                              </div>
                            </td>
                          `}
                        </tr>
                      `)}
                    </tbody>
                  </table>
                </div>
              </div>
            `}
	          ` : html`
	            <div class="editor-form">
	              <h2 class="editor-title">${this.selectedPersonId ? 'Edit Entry' : 'Create New Entry'}</h2>

              <div class="form-group">
                <label class="form-label">Name *</label>
                <input
                  type="text"
                  class="form-input"
                  placeholder="e.g., Alice Smith"
                  .value="${this.formData.name || ''}"
                  @input="${(e) => { this.formData = { ...this.formData, name: e.target.value }; }}"
                />
              </div>

              <div class="form-group">
                <label class="form-label">Instagram URL</label>
                <input
                  type="url"
                  class="form-input"
                  placeholder="https://instagram.com/username"
                  .value="${this.formData.instagram_url || ''}"
                  @input="${(e) => { this.formData = { ...this.formData, instagram_url: e.target.value }; }}"
                />
                <div class="form-hint">Optional. Include the full URL starting with https://</div>
              </div>

	              <div class="form-actions">
                <div>
                  ${!this.readOnly && this.selectedPersonId ? html`
                    <button class="btn-danger" @click="${() => this.deletePerson(this.selectedPersonId)}" ?disabled="${this.loading}">
                      ${this.loading ? 'Deleting...' : 'Delete'}
                    </button>
                  ` : html``}
                </div>
                <div class="form-actions-right">
                  <button class="btn-secondary" @click="${() => { this.view = 'list'; this.error = ''; }}" ?disabled="${this.loading}">
                    Cancel
                  </button>
                  <button class="btn-primary" @click="${() => this.savePerson()}" ?disabled="${this.loading}">
                    ${this.loading ? 'Saving...' : 'Save'}
                  </button>
	                </div>
	              </div>

                <div class="references-section">
                  <h3 class="references-title">Reference Photos</h3>
                  ${this.selectedPersonId ? html`
                    <div class="references-summary">
                      <span><strong>Active:</strong> ${referenceSummary.activeCount}</span>
                      <span><strong>Total:</strong> ${referenceSummary.totalCount}</span>
                      <span><strong>Last updated:</strong> ${referenceSummary.lastUpdatedLabel}</span>
                    </div>
                    ${this.referencesError ? html`
                      <div class="error-message">${this.referencesError}</div>
                    ` : html``}
                    <div class="references-grid">
                      <div class="reference-card">
                        <div class="reference-card-title">Upload New Photo</div>
                        <div class="reference-row">
                          <input
                            type="file"
                            accept="image/*"
                            @change=${(e) => this._handleReferenceFileInput(e)}
                            ?disabled=${this.referenceUploadBusy}
                          />
                          <button
                            class="btn-small"
                            @click=${() => this._uploadReferenceFile()}
                            ?disabled=${this.referenceUploadBusy || !this.referenceUploadFile}
                          >
                            ${this.referenceUploadBusy ? 'Uploading…' : 'Upload and Add'}
                          </button>
                        </div>
                        ${this.referenceUploadFile ? html`
                          <div class="reference-file-name">Selected: ${this.referenceUploadFile.name}</div>
                        ` : html``}
                      </div>
                      <div class="reference-card">
                        <div class="reference-card-title">Add Existing Asset</div>
                        <div class="reference-row">
                          <input
                            type="text"
                            class="form-input"
                            style="flex: 1 1 220px;"
                            placeholder="Search by filename..."
                            .value=${this.referenceSearchQuery}
                            @input=${(e) => { this.referenceSearchQuery = e.target.value; }}
                            @keydown=${(e) => { if (e.key === 'Enter') this._searchAssetsForReference(); }}
                            ?disabled=${this.referenceSearchLoading}
                          />
                          <button
                            class="btn-small"
                            @click=${() => this._searchAssetsForReference()}
                            ?disabled=${this.referenceSearchLoading || !String(this.referenceSearchQuery || '').trim()}
                          >
                            ${this.referenceSearchLoading ? 'Searching…' : 'Search'}
                          </button>
                        </div>
                        ${this.referenceSearchResults.length ? html`
                          <div class="asset-search-results">
                            ${this.referenceSearchResults.map((img) => {
                              const busyKey = `asset:${img.asset_id}`;
                              return html`
                                <div class="asset-search-item">
                                  <div class="asset-search-left">
                                    <img class="asset-search-thumb" src=${img.thumbnail_url || ''} alt="" />
                                    <div class="asset-search-text">
                                      <strong>${img.filename || 'Untitled'}</strong>
                                      <span>#${img.id} · ${img.source_key || '—'}</span>
                                    </div>
                                  </div>
                                  <button
                                    class="btn-small"
                                    @click=${() => this._attachExistingAsset(img.asset_id)}
                                    ?disabled=${this.referenceActionBusyKey === busyKey}
                                  >
                                    ${this.referenceActionBusyKey === busyKey ? 'Adding…' : 'Use'}
                                  </button>
                                </div>
                              `;
                            })}
                          </div>
                        ` : html``}
                      </div>
                    </div>
                    ${this.referencesLoading ? html`
                      <div class="loading">Loading references…</div>
                    ` : this.references.length === 0 ? html`
                      <div class="form-hint">No reference photos yet.</div>
                    ` : html`
                      <div class="reference-list">
                        ${this.references.map((reference) => {
                          const busyKey = `ref:${reference.id}`;
                          return html`
                            <div class="reference-list-item">
                              <div class="reference-meta">
                                <strong>${reference.source_type === 'asset' ? 'Asset reference' : 'Uploaded reference'}</strong>
                                <span>${this._truncateReferenceKey(reference)}</span>
                                <span>Updated: ${this._formatDate(reference.updated_at || reference.created_at)}</span>
                              </div>
                              <button
                                class="btn-small"
                                @click=${() => this._deleteReference(reference.id)}
                                ?disabled=${this.referenceActionBusyKey === busyKey}
                              >
                                ${this.referenceActionBusyKey === busyKey ? 'Removing…' : 'Remove'}
                              </button>
                            </div>
                          `;
                        })}
                      </div>
                    `}
                  ` : html`
                    <div class="form-hint">Save this person first, then add reference photos.</div>
                  `}
                </div>
	            </div>
	          `}
        </div>
      </div>
    `;
  }
}

customElements.define('person-manager', PersonManager);
