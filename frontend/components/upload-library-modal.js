import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import { getAccessToken } from '../services/supabase.js';

class UploadLibraryModal extends LitElement {
  static properties = {
    active: { type: Boolean, reflect: true },
    tenant: { type: String },
    items: { type: Array },
    isUploading: { type: Boolean },
    dedupPolicy: { type: String },
    error: { type: String },
  };

  static styles = [tailwind, css`
    .modal {
      display: none;
      position: fixed;
      z-index: 55;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      overflow: auto;
      background-color: rgba(0, 0, 0, 0.75);
    }

    .modal.active {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }

    .modal-content {
      background-color: #fefefe;
      margin: auto;
      padding: 24px;
      border: 1px solid #d1d5db;
      width: min(96vw, 980px);
      max-width: 980px;
      border-radius: 0.5rem;
      height: calc(100vh - 48px);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      gap: 12px;
    }

    .close {
      color: #9ca3af;
      font-size: 28px;
      font-weight: bold;
      line-height: 1;
      cursor: pointer;
    }

    .close:hover {
      color: #111827;
    }

    .summary {
      display: flex;
      gap: 16px;
      color: #4b5563;
      font-size: 13px;
    }

    .error {
      color: #b91c1c;
      background: #fee2e2;
      border: 1px solid #fecaca;
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 13px;
    }

    .results {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 12px;
      background: #ffffff;
    }
  `];

  constructor() {
    super();
    this.active = false;
    this.tenant = '';
    this.items = [];
    this.isUploading = false;
    this.dedupPolicy = 'keep_both';
    this.error = '';
    this._activeXhrs = new Map();
  }

  render() {
    const completed = this.items.filter((item) => item.status === 'done').length;
    const failed = this.items.filter((item) => item.status === 'failed').length;
    const uploading = this.items.filter((item) => item.status === 'uploading').length;

    return html`
      <div class="modal ${this.active ? 'active' : ''}" @click=${this._closeModal}>
        <div class="modal-content" @click=${(e) => e.stopPropagation()}>
          <div class="flex items-center justify-between">
            <h2 class="text-2xl font-bold text-gray-800">Upload to Library</h2>
            <span class="close" @click=${this._closeModal}>&times;</span>
          </div>

          ${this.error ? html`<div class="error">${this.error}</div>` : html``}

          <div class="flex items-end gap-3 flex-wrap">
            <div>
              <label class="block text-xs font-semibold text-gray-600 mb-1">Dedupe policy</label>
              <select
                class="border rounded px-2 py-2 text-sm"
                .value=${this.dedupPolicy}
                @change=${(e) => { this.dedupPolicy = e.target.value; }}
                ?disabled=${this.isUploading}
              >
                <option value="keep_both">Keep both</option>
                <option value="skip_duplicate">Skip duplicate</option>
              </select>
            </div>
            <input
              id="library-file-input"
              type="file"
              multiple
              accept="image/*"
              class="hidden"
              @change=${this._handleFileSelect}
            />
            <button
              class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-60"
              @click=${() => this.renderRoot?.querySelector('#library-file-input')?.click()}
              ?disabled=${this.isUploading}
            >
              Select Files
            </button>
            <button
              class="bg-emerald-600 text-white px-4 py-2 rounded hover:bg-emerald-700 disabled:opacity-60"
              @click=${this._startUpload}
              ?disabled=${this.isUploading || !this.items.some((item) => item.status === 'queued')}
            >
              Upload Queued
            </button>
            <button
              class="bg-gray-200 text-gray-800 px-4 py-2 rounded hover:bg-gray-300 disabled:opacity-60"
              @click=${this._cancelUploads}
              ?disabled=${!this.isUploading}
            >
              Cancel Uploads
            </button>
          </div>

          <div class="summary">
            <span>Total: ${this.items.length}</span>
            <span>Uploading: ${uploading}</span>
            <span>Completed: ${completed}</span>
            <span>Failed: ${failed}</span>
          </div>

          <div class="results">
            ${this.items.length === 0 ? html`
              <div class="text-sm text-gray-500">No files selected.</div>
            ` : html`
              <div class="space-y-3">
                ${this.items.map((item) => html`
                  <div class="border rounded p-3">
                    <div class="flex items-center justify-between gap-3">
                      <div class="min-w-0">
                        <div class="text-sm font-semibold text-gray-800 truncate">${item.name}</div>
                        <div class="text-xs text-gray-500">${this._formatBytes(item.size)}</div>
                      </div>
                      <div class="text-xs font-semibold uppercase tracking-wide text-gray-600">${item.status}</div>
                    </div>
                    <div class="mt-2 h-2 bg-gray-200 rounded overflow-hidden">
                      <div class="h-2 bg-blue-600" style="width:${item.progress || 0}%"></div>
                    </div>
                    ${item.message ? html`<div class="mt-2 text-xs text-gray-600">${item.message}</div>` : html``}
                    ${item.status === 'queued' ? html`
                      <div class="mt-2">
                        <button
                          class="text-xs text-red-600 hover:text-red-700"
                          @click=${() => this._removeQueuedItem(item.id)}
                          ?disabled=${this.isUploading}
                        >
                          Remove
                        </button>
                      </div>
                    ` : html``}
                  </div>
                `)}
              </div>
            `}
          </div>
        </div>
      </div>
    `;
  }

  _closeModal() {
    if (this.isUploading) return;
    this.active = false;
    this.error = '';
    this.items = [];
    this.dispatchEvent(new CustomEvent('close'));
  }

  _handleFileSelect(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const additions = files.map((file, index) => ({
      id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      name: file.name,
      size: file.size,
      status: 'queued',
      progress: 0,
      message: '',
    }));
    this.items = [...this.items, ...additions];
    event.target.value = '';
  }

  _removeQueuedItem(id) {
    this.items = this.items.filter((item) => item.id !== id);
  }

  async _startUpload() {
    const queued = this.items.filter((item) => item.status === 'queued');
    if (!queued.length || this.isUploading) return;

    const token = await getAccessToken();
    if (!token) {
      this.error = 'Missing auth token. Please re-authenticate and try again.';
      return;
    }

    this.error = '';
    this.isUploading = true;
    const concurrency = 3;
    const queueIds = queued.map((item) => item.id);
    let cursor = 0;

    const worker = async () => {
      while (cursor < queueIds.length) {
        const nextId = queueIds[cursor++];
        await this._uploadSingle(nextId, token);
      }
    };

    const workers = [];
    for (let i = 0; i < Math.min(concurrency, queueIds.length); i += 1) {
      workers.push(worker());
    }
    await Promise.all(workers);
    this.isUploading = false;

    if (this.items.some((item) => item.status === 'done')) {
      this.dispatchEvent(new CustomEvent('upload-complete', {
        bubbles: true,
        composed: true,
      }));
    }
  }

  _cancelUploads() {
    this._activeXhrs.forEach((xhr) => xhr.abort());
    this._activeXhrs.clear();
    this.isUploading = false;
  }

  async _uploadSingle(itemId, token) {
    const item = this.items.find((entry) => entry.id === itemId);
    if (!item || item.status !== 'queued') return;

    this._updateItem(itemId, { status: 'uploading', progress: 2, message: 'Uploading...' });

    const url = `/api/v1/images/upload-and-ingest?dedup_policy=${encodeURIComponent(this.dedupPolicy)}`;
    const formData = new FormData();
    formData.append('file', item.file);

    await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      this._activeXhrs.set(itemId, xhr);
      xhr.open('POST', url, true);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('X-Tenant-ID', this.tenant);

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const pct = Math.max(2, Math.min(95, Math.round((event.loaded / event.total) * 100)));
        this._updateItem(itemId, { progress: pct });
      };

      xhr.onload = () => {
        this._activeXhrs.delete(itemId);
        let payload = null;
        try {
          payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch (_error) {
          payload = null;
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          const status = payload?.status === 'skipped_duplicate' ? 'done' : 'done';
          const message = payload?.status === 'skipped_duplicate'
            ? 'Duplicate detected; reused existing image.'
            : 'Uploaded and ingested successfully.';
          this._updateItem(itemId, { status, progress: 100, message });
        } else {
          this._updateItem(itemId, {
            status: 'failed',
            progress: 100,
            message: payload?.detail || `Upload failed (HTTP ${xhr.status}).`,
          });
        }
        resolve();
      };

      xhr.onerror = () => {
        this._activeXhrs.delete(itemId);
        this._updateItem(itemId, {
          status: 'failed',
          progress: 100,
          message: 'Network error while uploading.',
        });
        resolve();
      };

      xhr.onabort = () => {
        this._activeXhrs.delete(itemId);
        this._updateItem(itemId, {
          status: 'cancelled',
          progress: 0,
          message: 'Upload cancelled.',
        });
        resolve();
      };

      xhr.send(formData);
    });
  }

  _updateItem(itemId, patch) {
    this.items = this.items.map((item) => (
      item.id === itemId ? { ...item, ...patch } : item
    ));
  }

  _formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
}

customElements.define('upload-library-modal', UploadLibraryModal);
