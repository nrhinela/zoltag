import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import { getPeople, getImagePeopleTags, addImagePersonTag, removeImagePersonTag } from '../services/api.js';

class PeopleTagger extends LitElement {
  static properties = {
    tenant: { type: String },
    imageId: { type: Number },
    imageName: { type: String },
    people: { type: Array },
    peopleTags: { type: Array },
    loading: { type: Boolean },
    error: { type: String },
    selectedPerson: { type: Object },
    confidence: { type: Number },
  };

  static styles = [tailwind, css`
    :host {
      display: block;
    }
    .container {
      background: #ffffff;
      border-radius: 12px;
      border: 1px solid #e5e7eb;
      overflow: hidden;
    }
    .header {
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
      padding: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .title {
      font-size: 16px;
      font-weight: 600;
      color: #111827;
    }
    .subtitle {
      font-size: 12px;
      color: #6b7280;
      margin-top: 4px;
    }
    .body {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .section-title {
      font-size: 13px;
      font-weight: 600;
      color: #374151;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .person-selector {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .person-dropdown {
      flex: 1;
      padding: 8px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 13px;
      background: #ffffff;
      color: #111827;
    }
    .person-dropdown:focus {
      outline: none;
      border-color: #3b82f6;
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
    }
    .confidence-slider {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .slider {
      flex: 1;
      height: 6px;
      -webkit-appearance: none;
      appearance: none;
      background: linear-gradient(to right, #ef4444, #f59e0b, #10b981);
      border-radius: 3px;
      outline: none;
    }
    .slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #ffffff;
      border: 2px solid #3b82f6;
      cursor: pointer;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }
    .slider::-moz-range-thumb {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #ffffff;
      border: 2px solid #3b82f6;
      cursor: pointer;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }
    .confidence-value {
      min-width: 40px;
      text-align: right;
      font-size: 13px;
      font-weight: 600;
      color: #111827;
    }
    .tag-button {
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
    .tag-button:hover:not(:disabled) {
      background: #2563eb;
    }
    .tag-button:disabled {
      background: #d1d5db;
      cursor: not-allowed;
    }
    .tags-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .tag-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px;
      background: #f3f4f6;
      border-radius: 6px;
      border-left: 3px solid #3b82f6;
    }
    .tag-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .tag-name {
      font-size: 13px;
      font-weight: 600;
      color: #111827;
    }
    .tag-category {
      font-size: 11px;
      color: #6b7280;
    }
    .tag-confidence {
      font-size: 11px;
      color: #6b7280;
      padding: 2px 6px;
      background: #ffffff;
      border-radius: 4px;
    }
    .tag-remove {
      padding: 4px 8px;
      background: #fee2e2;
      color: #dc2626;
      border: none;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;
    }
    .tag-remove:hover {
      background: #fecaca;
    }
    .empty-state {
      text-align: center;
      padding: 24px;
      color: #6b7280;
      font-size: 13px;
    }
    .error-message {
      background: #fee2e2;
      border: 1px solid #fecaca;
      border-radius: 6px;
      padding: 12px;
      color: #dc2626;
      font-size: 13px;
    }
    .loading {
      text-align: center;
      padding: 16px;
      color: #6b7280;
      font-size: 13px;
    }
    .confidence-indicator {
      display: inline-block;
      width: 4px;
      height: 4px;
      border-radius: 50%;
      margin-right: 4px;
    }
    .confidence-high {
      background: #10b981;
    }
    .confidence-medium {
      background: #f59e0b;
    }
    .confidence-low {
      background: #ef4444;
    }
  `];

  constructor() {
    super();
    this.imageId = null;
    this.imageName = '';
    this.people = [];
    this.peopleTags = [];
    this.loading = false;
    this.error = '';
    this.selectedPerson = null;
    this.confidence = 1.0;
  }

  async connectedCallback() {
    super.connectedCallback();
    if (this.imageId) {
      await this.loadData();
    }
  }

  async loadData() {
    this.loading = true;
    this.error = '';
    try {
      await this.loadPeople();
      await this.loadImagePeopleTags();
    } catch (err) {
      this.error = err.message || 'Failed to load data';
    } finally {
      this.loading = false;
    }
  }

  async loadPeople() {
    const tenantId = this.tenant || localStorage.getItem('tenantId') || 'default';
    this.people = await getPeople(tenantId, { limit: 500 });
  }

  async loadImagePeopleTags() {
    const tenantId = this.tenant || localStorage.getItem('tenantId') || 'default';
    const data = await getImagePeopleTags(tenantId, this.imageId);
    this.peopleTags = data.people_tags || [];
  }

  async tagPerson() {
    if (!this.selectedPerson) {
      this.error = 'Please select a person';
      return;
    }

    this.loading = true;
    this.error = '';
    try {
      const tenantId = this.tenant || localStorage.getItem('tenantId') || 'default';
      await addImagePersonTag(tenantId, this.imageId, {
        person_id: this.selectedPerson.id,
        confidence: this.confidence
      });

      await this.loadImagePeopleTags();
      this.selectedPerson = null;
      this.confidence = 1.0;
    } catch (err) {
      this.error = err.message;
    } finally {
      this.loading = false;
    }
  }

  async removeTag(personId) {
    if (!confirm('Remove this person tag?')) return;

    this.loading = true;
    this.error = '';
    try {
      const tenantId = this.tenant || localStorage.getItem('tenantId') || 'default';
      await removeImagePersonTag(tenantId, this.imageId, personId);
      await this.loadImagePeopleTags();
    } catch (err) {
      this.error = err.message;
    } finally {
      this.loading = false;
    }
  }

  getConfidenceIndicator(confidence) {
    if (confidence >= 0.8) return 'confidence-high';
    if (confidence >= 0.5) return 'confidence-medium';
    return 'confidence-low';
  }

  render() {
    return html`
      <div class="container">
        <div class="header">
          <div>
            <div class="title">👥 Tag People</div>
            <div class="subtitle">${this.imageName || `Image #${this.imageId}`}</div>
          </div>
        </div>

        <div class="body">
          ${this.error ? html`
            <div class="error-message">${this.error}</div>
          ` : ''}

          ${this.loading && this.peopleTags.length === 0 ? html`
            <div class="loading">Loading...</div>
          ` : html`
            <!-- Tag Input Section -->
            <div class="section">
              <div class="section-title">Add Person Tag</div>

              <div class="person-selector">
                <select
                  class="person-dropdown"
                  @change="${(e) => {
                    const id = parseInt(e.target.value);
                    this.selectedPerson = this.people.find(p => p.id === id) || null;
                  }}"
                  .value="${this.selectedPerson ? this.selectedPerson.id : ''}"
                  ?disabled="${this.loading}"
                >
                  <option value="">Select a person...</option>
                  ${this.people.map(person => html`
                    <option value="${person.id}">
                      ${person.name} (${person.person_category})
                    </option>
                  `)}
                </select>
              </div>

              <div class="confidence-slider">
                <label style="font-size: 12px; color: #6b7280;">Confidence:</label>
                <input
                  type="range"
                  class="slider"
                  min="0"
                  max="1"
                  step="0.1"
                  .value="${this.confidence}"
                  @change="${(e) => { this.confidence = parseFloat(e.target.value); }}"
                  ?disabled="${this.loading}"
                />
                <div class="confidence-value">${(this.confidence * 100).toFixed(0)}%</div>
              </div>

              <button
                class="tag-button"
                @click="${() => this.tagPerson()}"
                ?disabled="${!this.selectedPerson || this.loading}"
              >
                ${this.loading ? 'Adding...' : 'Add Person Tag'}
              </button>
            </div>

            <!-- Current Tags Section -->
            <div class="section">
              <div class="section-title">Tagged People (${this.peopleTags.length})</div>

              ${this.peopleTags.length === 0 ? html`
                <div class="empty-state">No people tagged yet</div>
              ` : html`
                <div class="tags-list">
                  ${this.peopleTags.map(tag => html`
                    <div class="tag-item">
                      <div class="tag-info">
                        <div class="tag-name">
                          <span class="confidence-indicator ${this.getConfidenceIndicator(tag.confidence)}"></span>
                          ${tag.person_name}
                        </div>
                        <div class="tag-category">${tag.person_category}</div>
                      </div>
                      <div style="display: flex; gap: 8px; align-items: center;">
                        <div class="tag-confidence">${(tag.confidence * 100).toFixed(0)}%</div>
                        <button
                          class="tag-remove"
                          @click="${() => this.removeTag(tag.person_id)}"
                          ?disabled="${this.loading}"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  `)}
                </div>
              `}
            </div>
          `}
        </div>
      </div>
    `;
  }
}

customElements.define('people-tagger', PeopleTagger);
