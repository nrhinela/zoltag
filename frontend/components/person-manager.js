import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import { getPeople, createPerson, updatePerson, deletePerson } from '../services/api.js';

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
    this.view = 'editor';
  }

  _openEditEditor(person) {
    this.selectedPersonId = person.id;
    this.formData = {
      name: person.name || '',
      instagram_url: person.instagram_url || '',
    };
    this.error = '';
    this.view = 'editor';
  }

  render() {
    const filteredPeople = this.getFilteredPeople();
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
            </div>
          `}
        </div>
      </div>
    `;
  }
}

customElements.define('person-manager', PersonManager);
