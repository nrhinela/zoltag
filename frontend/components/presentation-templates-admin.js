import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import {
  getPresentationTemplates,
  uploadPresentationTemplate,
  updatePresentationTemplate,
  deletePresentationTemplate,
} from '../services/api.js';

export class PresentationTemplatesAdmin extends LitElement {
  static properties = {
    tenant: { type: String },
    templates: { type: Array },
    loading: { type: Boolean },
    error: { type: String },
    uploadName: { type: String },
    uploadVisibility: { type: String },
    uploadFileName: { type: String },
    uploading: { type: Boolean },
    rowBusyById: { type: Object },
    draftsById: { type: Object },
  };

  static styles = [
    tailwind,
    css`
      :host {
        display: block;
      }

      .card {
        border: 1px solid #d1d5db;
        border-radius: 12px;
        background: white;
      }

      .card-header {
        padding: 20px;
        border-bottom: 1px solid #e5e7eb;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
      }

      .card-title {
        margin: 0;
        font-size: 30px;
        font-weight: 700;
        color: #111827;
      }

      .card-subtitle {
        margin: 4px 0 0;
        font-size: 15px;
        color: #6b7280;
      }

      .card-content {
        padding: 20px;
      }
    `,
  ];

  constructor() {
    super();
    this.tenant = '';
    this.templates = [];
    this.loading = false;
    this.error = '';
    this.uploadName = '';
    this.uploadVisibility = 'private';
    this.uploadFileName = '';
    this.uploading = false;
    this.rowBusyById = {};
    this.draftsById = {};
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadTemplates();
  }

  willUpdate(changedProperties) {
    if (changedProperties.has('tenant')) {
      this._loadTemplates();
    }
  }

  _formatDate(value) {
    if (!value) return 'Unknown';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Unknown';
    return parsed.toLocaleString();
  }

  _ownerLabel(template) {
    return String(template?.created_by_name || '').trim()
      || String(template?.created_by_uid || '').trim()
      || 'Unknown';
  }

  _visibilityLabel(value) {
    return String(value || '').trim().toLowerCase() === 'shared' ? 'Shared' : 'Private';
  }

  _isBusy(templateId) {
    return !!this.rowBusyById[String(templateId || '')];
  }

  _setBusy(templateId, busy) {
    const key = String(templateId || '');
    this.rowBusyById = {
      ...this.rowBusyById,
      [key]: !!busy,
    };
  }

  _setDraft(templateId, field, value) {
    const key = String(templateId || '');
    const existing = this.draftsById[key] || {};
    this.draftsById = {
      ...this.draftsById,
      [key]: {
        ...existing,
        [field]: value,
      },
    };
  }

  _draftValue(template, field) {
    const key = String(template?.id || '');
    const draft = this.draftsById[key] || {};
    if (field in draft) {
      return draft[field];
    }
    return template?.[field] ?? '';
  }

  async _loadTemplates() {
    if (!this.tenant) {
      this.templates = [];
      this.loading = false;
      this.error = 'No tenant selected.';
      return;
    }
    this.loading = true;
    this.error = '';
    try {
      const rows = await getPresentationTemplates(this.tenant);
      this.templates = Array.isArray(rows) ? rows : [];
      this.draftsById = {};
    } catch (error) {
      console.error('Failed to load presentation templates:', error);
      this.error = error?.message || 'Failed to load templates';
      this.templates = [];
    } finally {
      this.loading = false;
    }
  }

  _handleUploadFileChange(event) {
    const file = event?.target?.files?.[0] || null;
    this._uploadFile = file;
    this.uploadFileName = file?.name || '';
  }

  async _handleUploadTemplate() {
    if (this.uploading) return;
    const file = this._uploadFile;
    if (!file) {
      alert('Select a .pptx file to upload.');
      return;
    }
    this.uploading = true;
    this.error = '';
    try {
      await uploadPresentationTemplate(this.tenant, {
        file,
        name: this.uploadName,
        visibility: this.uploadVisibility,
      });
      this.uploadName = '';
      this.uploadVisibility = 'private';
      this.uploadFileName = '';
      this._uploadFile = null;
      const input = this.renderRoot?.querySelector('[data-template-upload-input]');
      if (input) input.value = '';
      await this._loadTemplates();
    } catch (error) {
      console.error('Failed to upload template:', error);
      this.error = error?.message || 'Failed to upload template';
    } finally {
      this.uploading = false;
    }
  }

  async _handleSaveTemplate(template) {
    const templateId = String(template?.id || '');
    if (!templateId || this._isBusy(templateId)) return;
    const nextName = String(this._draftValue(template, 'name') || '').trim();
    const nextVisibility = String(this._draftValue(template, 'visibility') || 'private').trim().toLowerCase();
    if (!nextName) {
      alert('Template name is required.');
      return;
    }
    if (!['shared', 'private'].includes(nextVisibility)) {
      alert('Visibility must be Shared or Private.');
      return;
    }
    this._setBusy(templateId, true);
    this.error = '';
    try {
      await updatePresentationTemplate(this.tenant, templateId, {
        name: nextName,
        visibility: nextVisibility,
      });
      await this._loadTemplates();
    } catch (error) {
      console.error('Failed to update template:', error);
      this.error = error?.message || 'Failed to save template changes';
    } finally {
      this._setBusy(templateId, false);
    }
  }

  async _handleDeleteTemplate(template) {
    const templateId = String(template?.id || '');
    if (!templateId || this._isBusy(templateId)) return;
    const templateName = String(template?.name || '').trim() || 'this template';
    if (!window.confirm(`Delete "${templateName}"? This cannot be undone.`)) return;
    this._setBusy(templateId, true);
    this.error = '';
    try {
      await deletePresentationTemplate(this.tenant, templateId);
      await this._loadTemplates();
    } catch (error) {
      console.error('Failed to delete template:', error);
      this.error = error?.message || 'Failed to delete template';
    } finally {
      this._setBusy(templateId, false);
    }
  }

  render() {
    return html`
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Presentation Templates</h2>
            <p class="card-subtitle">
              Upload reusable PPTX templates for this tenant. Owner and visibility control sharing.
            </p>
          </div>
          <button
            class="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-60"
            ?disabled=${this.loading}
            @click=${() => this._loadTemplates()}
          >
            ${this.loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <div class="card-content space-y-4">
          ${this.error ? html`
            <div class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              ${this.error}
            </div>
          ` : html``}

          <div class="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div class="mb-3 text-sm font-semibold text-gray-800">Upload Template</div>
            <div class="grid gap-3 md:grid-cols-4">
              <div class="md:col-span-2">
                <input
                  class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                  type="text"
                  placeholder="Template name (optional)"
                  .value=${this.uploadName}
                  @input=${(event) => { this.uploadName = event.target.value; }}
                >
              </div>
              <div>
                <select
                  class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                  .value=${this.uploadVisibility}
                  @change=${(event) => { this.uploadVisibility = event.target.value; }}
                >
                  <option value="private">Private</option>
                  <option value="shared">Shared</option>
                </select>
              </div>
              <div>
                <input
                  data-template-upload-input
                  class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                  type="file"
                  accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                  @change=${this._handleUploadFileChange}
                >
              </div>
            </div>
            <div class="mt-3 flex items-center justify-between gap-3">
              <div class="text-xs text-gray-600">${this.uploadFileName ? `Selected: ${this.uploadFileName}` : 'Select a .pptx file'}</div>
              <button
                class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                ?disabled=${this.uploading || !this._uploadFile}
                @click=${this._handleUploadTemplate}
              >
                ${this.uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </div>

          ${this.loading ? html`
            <div class="rounded-lg border border-gray-200 bg-white px-4 py-6 text-sm text-gray-600">Loading templates…</div>
          ` : this.templates.length === 0 ? html`
            <div class="rounded-lg border border-gray-200 bg-white px-4 py-6 text-sm text-gray-600">
              No templates uploaded yet.
            </div>
          ` : html`
            <div class="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <table class="min-w-full divide-y divide-gray-200 text-sm">
                <thead class="bg-gray-50 text-left">
                  <tr>
                    <th class="px-3 py-2 font-semibold text-gray-700">Name</th>
                    <th class="px-3 py-2 font-semibold text-gray-700">Owner</th>
                    <th class="px-3 py-2 font-semibold text-gray-700">Visibility</th>
                    <th class="px-3 py-2 font-semibold text-gray-700">Uploaded</th>
                    <th class="px-3 py-2 font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                  ${this.templates.map((template) => {
                    const rowBusy = this._isBusy(template.id);
                    return html`
                      <tr>
                        <td class="px-3 py-2">
                          <input
                            class="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                            type="text"
                            .value=${String(this._draftValue(template, 'name') || '')}
                            @input=${(event) => this._setDraft(template.id, 'name', event.target.value)}
                          >
                          <div class="mt-1 text-xs text-gray-500">${template.original_filename || ''}</div>
                        </td>
                        <td class="px-3 py-2 text-gray-700">${this._ownerLabel(template)}</td>
                        <td class="px-3 py-2">
                          <select
                            class="rounded border border-gray-300 px-2 py-1 text-sm"
                            .value=${String(this._draftValue(template, 'visibility') || 'private')}
                            @change=${(event) => this._setDraft(template.id, 'visibility', event.target.value)}
                          >
                            <option value="private">Private</option>
                            <option value="shared">Shared</option>
                          </select>
                          <div class="mt-1 text-xs text-gray-500">${this._visibilityLabel(template.visibility)}</div>
                        </td>
                        <td class="px-3 py-2 text-gray-700">${this._formatDate(template.created_at)}</td>
                        <td class="px-3 py-2">
                          <div class="flex items-center gap-2">
                            <button
                              class="rounded border border-blue-300 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-60"
                              ?disabled=${rowBusy}
                              @click=${() => this._handleSaveTemplate(template)}
                            >
                              Save
                            </button>
                            <button
                              class="rounded border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                              ?disabled=${rowBusy}
                              @click=${() => this._handleDeleteTemplate(template)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    `;
                  })}
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>
    `;
  }
}

customElements.define('presentation-templates-admin', PresentationTemplatesAdmin);
