import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import { getPeopleCategories, getPeople, createPerson, deletePerson } from '../services/api.js';

class PersonManager extends LitElement {
  static properties = {
    tenant: { type: String },
    view: { type: String }, // 'list' or 'editor'
    people: { type: Array },
    categories: { type: Array },
    selectedPersonId: { type: Number },
    loading: { type: Boolean },
    error: { type: String },
    formData: { type: Object },
    searchQuery: { type: String },
    filterCategory: { type: String },
  };

  static styles = [tailwind, css`
    :host {
      display: block;
      min-height: 400px;
    }
    .container {
      display: flex;
      flex-direction: column;
      min-height: 400px;
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
      margin-bottom: 12px;
    }
    .header-controls {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .search-box {
      flex: 1;
      max-width: 300px;
      padding: 8px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 13px;
    }
    .filter-select {
      padding: 8px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 13px;
      background: #ffffff;
    }
    .btn-primary {
      padding: 10px 16px;
      background: #3b82f6;
      color: #ffffff;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
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
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-secondary:hover {
      background: #d1d5db;
    }
    .content {
      flex: 1;
      overflow: auto;
      padding: 20px;
    }
    .list-view {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 16px;
    }
    .person-card {
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
      transition: box-shadow 0.2s;
    }
    .person-card:hover {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }
    .person-card-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 16px;
      color: #ffffff;
    }
    .person-name {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .person-category {
      font-size: 12px;
      opacity: 0.9;
    }
    .person-card-body {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .stat {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 13px;
      color: #6b7280;
    }
    .stat-label {
      font-weight: 500;
    }
    .stat-value {
      font-weight: 600;
      color: #111827;
    }
    .instagram-link {
      color: #3b82f6;
      text-decoration: none;
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .instagram-link:hover {
      text-decoration: underline;
    }
    .card-actions {
      display: flex;
      gap: 8px;
    }
    .btn-small {
      flex: 1;
      padding: 8px;
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
    .btn-small.delete {
      background: #fee2e2;
      color: #dc2626;
      border-color: #fecaca;
    }
    .btn-small.delete:hover {
      background: #fecaca;
    }
    .editor-form {
      max-width: 500px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 8px;
      padding: 24px;
      border: 1px solid #e5e7eb;
    }
    .form-group {
      margin-bottom: 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .form-label {
      font-size: 13px;
      font-weight: 600;
      color: #111827;
    }
    .form-input {
      padding: 10px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 13px;
      font-family: inherit;
    }
    .form-input:focus {
      outline: none;
      border-color: #3b82f6;
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
    }
    .form-hint {
      font-size: 12px;
      color: #6b7280;
    }
    .form-actions {
      display: flex;
      gap: 12px;
      margin-top: 24px;
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
    this.view = 'list';
    this.people = [];
    this.categories = [];
    this.selectedPersonId = null;
    this.loading = false;
    this.error = '';
    this.formData = { name: '', instagram_url: '', person_category: 'people_in_scene' };
    this.searchQuery = '';
    this.filterCategory = '';
  }

  async connectedCallback() {
    super.connectedCallback();
    console.log('[PersonManager] connectedCallback, tenant:', this.tenant);
    await this.loadData();
  }

  async loadData() {
    console.log('[PersonManager] loadData starting');
    this.loading = true;
    this.error = '';
    try {
      await this.loadCategories();
      console.log('[PersonManager] categories loaded:', this.categories);
      await this.loadPeople();
      console.log('[PersonManager] people loaded:', this.people);
    } catch (err) {
      console.error('[PersonManager] loadData error:', err);
      this.error = err.message || 'Failed to load data';
    } finally {
      this.loading = false;
    }
  }

  async loadCategories() {
    const tenantId = this.tenant || localStorage.getItem('tenantId') || 'default';
    this.categories = await getPeopleCategories(tenantId);
  }

  async loadPeople() {
    const tenantId = this.tenant || localStorage.getItem('tenantId') || 'default';
    let data = await getPeople(tenantId, {
      limit: 500,
      person_category: this.filterCategory || undefined
    });

    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase();
      data = data.filter(p =>
        p.name.toLowerCase().includes(query) ||
        (p.instagram_url && p.instagram_url.toLowerCase().includes(query))
      );
    }

    this.people = data;
  }

  async createPerson() {
    if (!this.formData.name.trim()) {
      this.error = 'Please enter a name';
      return;
    }

    this.loading = true;
    this.error = '';
    try {
      const tenantId = this.tenant || localStorage.getItem('tenantId') || 'default';
      await createPerson(tenantId, this.formData);

      this.formData = { name: '', instagram_url: '', person_category: 'people_in_scene' };
      this.view = 'list';
      await this.loadPeople();
    } catch (err) {
      this.error = err.message;
    } finally {
      this.loading = false;
    }
  }

  async deletePerson(personId) {
    if (!confirm('Delete this person? This will remove all tags.')) return;

    this.loading = true;
    this.error = '';
    try {
      const tenantId = this.tenant || localStorage.getItem('tenantId') || 'default';
      await deletePerson(tenantId, personId);
      await this.loadPeople();
    } catch (err) {
      this.error = err.message;
    } finally {
      this.loading = false;
    }
  }

  getFilteredPeople() {
    return this.people;
  }

  render() {
    return html`
      <div class="container">
        <div class="header">
          <div class="header-title">👥 People Management</div>
          <div class="header-controls">
            ${this.view === 'list' ? html`
              <input
                type="text"
                class="search-box"
                placeholder="Search people..."
                .value="${this.searchQuery}"
                @input="${(e) => { this.searchQuery = e.target.value; this.loadPeople(); }}"
              />
              <select
                class="filter-select"
                .value="${this.filterCategory}"
                @change="${(e) => { this.filterCategory = e.target.value; this.loadPeople(); }}"
              >
                <option value="">All Categories</option>
                ${this.categories.map(cat => html`
                  <option value="${cat.name}">${cat.display_name}</option>
                `)}
              </select>
              <button class="btn-primary" @click="${() => { this.view = 'editor'; this.formData = { name: '', instagram_url: '', person_category: 'people_in_scene' }; }}">
                + Add Person
              </button>
            ` : html`
              <button class="btn-secondary" @click="${() => { this.view = 'list'; }}">
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
              <div class="loading">Loading people...</div>
            ` : this.getFilteredPeople().length === 0 ? html`
              <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                <div style="font-size: 16px; font-weight: 600; color: #111827; margin-bottom: 6px;">No people found</div>
                <div style="font-size: 13px; color: #6b7280;">Create your first person to get started</div>
              </div>
            ` : html`
              <div class="list-view">
                ${this.getFilteredPeople().map(person => html`
                  <div class="person-card">
                    <div class="person-card-header">
                      <div class="person-name">${person.name}</div>
                      <div class="person-category">${person.person_category}</div>
                    </div>
                    <div class="person-card-body">
                      <div class="stat">
                        <span class="stat-label">Images Tagged:</span>
                        <span class="stat-value">${person.tag_count || 0}</span>
                      </div>
                      ${person.instagram_url ? html`
                        <a href="${person.instagram_url}" target="_blank" class="instagram-link">
                          📸 ${new URL(person.instagram_url).hostname}
                        </a>
                      ` : ''}
                      <div style="font-size: 11px; color: #9ca3af;">
                        Created ${new Date(person.created_at).toLocaleDateString()}
                      </div>
                      <div class="card-actions">
                        <button class="btn-small" @click="${() => { this.view = 'editor'; this.selectedPersonId = person.id; this.formData = { ...person }; }}">
                          Edit
                        </button>
                        <button class="btn-small delete" @click="${() => this.deletePerson(person.id)}">
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                `)}
              </div>
            `}
          ` : html`
            <div class="editor-form">
              <h2 style="margin-bottom: 24px; font-size: 18px; font-weight: 600; color: #111827;">
                ${this.selectedPersonId ? 'Edit Person' : 'Create New Person'}
              </h2>

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

              <div class="form-group">
                <label class="form-label">Category</label>
                <select
                  class="form-input"
                  .value="${this.formData.person_category || 'people_in_scene'}"
                  @change="${(e) => { this.formData = { ...this.formData, person_category: e.target.value }; }}"
                >
                  ${this.categories.map(cat => html`
                    <option value="${cat.name}">${cat.display_name}</option>
                  `)}
                </select>
              </div>

              <div class="form-actions">
                <button class="btn-primary" @click="${() => this.createPerson()}" ?disabled="${this.loading}">
                  ${this.loading ? 'Saving...' : 'Save Person'}
                </button>
                <button class="btn-secondary" @click="${() => { this.view = 'list'; }}" ?disabled="${this.loading}">
                  Cancel
                </button>
              </div>
            </div>
          `}
        </div>
      </div>
    `;
  }
}

customElements.define('person-manager', PersonManager);
