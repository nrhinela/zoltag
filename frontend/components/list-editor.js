import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import { getLists, createList, updateList, deleteList, getListItems, deleteListItem, fetchWithAuth } from '../services/api.js';
import './image-card.js';

class ListEditor extends LitElement {
  static styles = [tailwind, css`
    :host {
      display: block;
    }
    .left-justified-header {
      text-align: left;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    .animate-spin {
      animation: spin 1s linear infinite;
    }
    @keyframes skeleton-loading {
      0% {
        background-color: #e5e7eb;
      }
      50% {
        background-color: #f3f4f6;
      }
      100% {
        background-color: #e5e7eb;
      }
    }
    .skeleton {
      animation: skeleton-loading 1.5s infinite;
      border-radius: 0.375rem;
    }
    .skeleton-text {
      height: 1rem;
      margin-bottom: 0.5rem;
    }
    .skeleton-title {
      height: 1.75rem;
      margin-bottom: 1rem;
    }
    .skeleton-row {
      height: 2.5rem;
      margin-bottom: 0.5rem;
    }
  `];

  static properties = {
    tenant: { type: String },
    lists: { type: Array },
    editingList: { type: Object },
    selectedList: { type: Object },
    listItems: { type: Array },
    editingSelectedList: { type: Boolean },
    isDownloading: { type: Boolean },
    isLoadingItems: { type: Boolean },
    isLoadingLists: { type: Boolean },
  };

  constructor() {
    super();
    this.lists = [];
    this.editingList = null;
    this.selectedList = null;
    this.listItems = [];
    this.editingSelectedList = false;
    this.isDownloading = false;
    this.isLoadingItems = false;
    this.isLoadingLists = false;
    this._isVisible = false;
    this._hasRefreshedOnce = false;
  }

  // Use Light DOM instead of Shadow DOM to access Tailwind CSS classes
  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.fetchLists();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
    }
  }

  willUpdate(changedProperties) {
    if (changedProperties.has('tenant')) {
      this.fetchLists();
      this.selectedList = null;
      this.listItems = [];
    }
  }

  // Refresh data when component becomes visible (tab is clicked)
  _checkVisibility() {
    const isNowVisible = this.offsetParent !== null;

    // If component just became visible and we haven't refreshed yet, refresh the data
    if (isNowVisible && !this._isVisible && !this._hasRefreshedOnce) {
      this._isVisible = true;
      this._hasRefreshedOnce = true;

      if (this._refreshTimer) {
        clearTimeout(this._refreshTimer);
      }
      this._refreshTimer = setTimeout(() => {
        this.fetchLists();
        if (this.selectedList) {
          this._fetchListItems(this.selectedList.id);
        }
      }, 100);
    }

    this._isVisible = isNowVisible;
  }

  async fetchLists({ force = false } = {}) {
    if (!this.tenant) {
      console.warn('fetchLists: Tenant ID is not available.');
      return;
    }
    console.log('fetchLists: Fetching lists for tenant:', this.tenant);
    this.isLoadingLists = true;
    try {
      const fetchedLists = await getLists(this.tenant, { force });
      console.log('fetchLists: Fetched lists:', fetchedLists);
      this.lists = fetchedLists;
      this.dispatchEvent(new CustomEvent('lists-updated', { bubbles: true, composed: true }));
    } catch (error) {
      console.error('Error fetching lists:', error);
    } finally {
      this.isLoadingLists = false;
    }
  }

  _createList() {
    console.log('Add New List button clicked!');
    this.editingList = { title: '', notebox: '' };
  }

  _editList(list) {
    this.selectedList = list;
    this._fetchListItems(list.id);
    this.editingSelectedList = true;
  }

  async _selectList(list) {
    this.selectedList = list;
    this.isLoadingItems = true;
    await this._fetchListItems(list.id);
  }

  async _fetchListItems(listId) {
    try {
      this.listItems = await getListItems(this.tenant, listId);
    } catch (error) {
      console.error('Error fetching list items:', error);
      this.listItems = [];
    } finally {
      this.isLoadingItems = false;
    }
  }

  async _removeListItem(itemId) {
    try {
      await deleteListItem(this.tenant, itemId);
      if (this.selectedList) {
        await this._fetchListItems(this.selectedList.id);
      }
      await this.fetchLists({ force: true });
    } catch (error) {
      console.error('Error deleting list item:', error);
    }
  }

  async _deleteList(list) {
    const confirmed = window.confirm(`Delete list "${list.title}"?`);
    if (!confirmed) {
      return;
    }
    try {
      await deleteList(this.tenant, list.id);
      this.lists = this.lists.filter((entry) => entry.id !== list.id);
      if (this.selectedList && this.selectedList.id === list.id) {
        this.selectedList = null;
        this.listItems = [];
      }
      this.requestUpdate();
      this.dispatchEvent(new CustomEvent('lists-updated', { bubbles: true, composed: true }));
    } catch (error) {
      console.error('Error deleting list:', error);
    }
  }

  _startEditingSelectedList() {
    this.editingSelectedList = true;
  }

  _cancelEditingSelectedList() {
    this.editingSelectedList = false;
  }

  async _saveSelectedListChanges() {
    const title = this.querySelector('#edit-list-title')?.value.trim();
    const notebox = this.querySelector('#edit-list-notes')?.value;

    if (!title) {
      console.warn('List title cannot be empty');
      return;
    }

    try {
      const updated = await updateList(this.tenant, {
        id: this.selectedList.id,
        title,
        notebox,
      });
      this.selectedList = updated;
      this.editingSelectedList = false;
      await this.fetchLists({ force: true });
      this.dispatchEvent(new CustomEvent('lists-updated', { bubbles: true, composed: true }));
    } catch (error) {
      console.error('Error saving list changes:', error);
    }
  }

  async _downloadListImages() {
    if (!this.listItems || this.listItems.length === 0) {
      alert('No items to download');
      return;
    }

    this.isDownloading = true;

    try {
      // Load JSZip library from CDN if not already loaded
      if (!window.JSZip) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/jszip@3/dist/jszip.min.js';
        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }

      // Load jsPDF library for README generation
      if (!window.jspdf) {
        const pdfScript = document.createElement('script');
        pdfScript.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
        await new Promise((resolve, reject) => {
          pdfScript.onload = resolve;
          pdfScript.onerror = reject;
          document.head.appendChild(pdfScript);
        });
      }

      const zip = new window.JSZip();

      // Create README.pdf with list information
      const jsPDF = window.jspdf.jsPDF;
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      let yPosition = 20;
      const lineHeight = 7;
      const margin = 20;
      const maxWidth = pageWidth - 2 * margin;

      // Title
      doc.setFontSize(18);
      doc.setFont(undefined, 'bold');
      doc.text(this.selectedList.title, margin, yPosition);
      yPosition += lineHeight * 2;

      // Metadata
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      doc.text(`Author: ${this.selectedList.created_by_name || 'Unknown'}`, margin, yPosition);
      yPosition += lineHeight;
      doc.text(`Created: ${new Date(this.selectedList.created_at).toLocaleDateString()}`, margin, yPosition);
      yPosition += lineHeight * 1.5;

      // Notes
      if (this.selectedList.notebox) {
        doc.setFont(undefined, 'bold');
        doc.text('Notes:', margin, yPosition);
        yPosition += lineHeight;
        doc.setFont(undefined, 'normal');
        const notesLines = doc.splitTextToSize(this.selectedList.notebox, maxWidth);
        doc.text(notesLines, margin, yPosition);
        yPosition += notesLines.length * lineHeight + lineHeight;
      }

      // Items list
      doc.setFont(undefined, 'bold');
      doc.text(`List Items (${this.listItems.length})`, margin, yPosition);
      yPosition += lineHeight * 1.5;

      doc.setFontSize(9);
      doc.setFont(undefined, 'normal');

      // Add table headers
      doc.setFont(undefined, 'bold');
      doc.text('URL', margin, yPosition);
      yPosition += lineHeight;

      // Add items
      doc.setFont(undefined, 'normal');
      for (const item of this.listItems) {
        const encodedPath = item.image.dropbox_path.split('/').map(part => encodeURIComponent(part)).join('/');
        const dropboxUrl = `https://www.dropbox.com/home${encodedPath}`;

        // Wrap long URLs to fit the page width
        const urlLines = doc.splitTextToSize(dropboxUrl, maxWidth);
        const itemHeight = urlLines.length * lineHeight;

        // Check if we need a new page
        if (yPosition + itemHeight > pageHeight - margin) {
          doc.addPage();
          yPosition = margin;
        }

        doc.text(urlLines, margin, yPosition);
        yPosition += itemHeight + lineHeight * 0.25;
      }

      // Add PDF to zip
      const pdfBlob = doc.output('blob');
      zip.file('README.pdf', pdfBlob);

      // Download each image and add to zip
      for (const item of this.listItems) {
        const filename = item.image.filename || `image_${item.image.id}`;

        try {
          // Fetch image from Dropbox using authenticated request
          const blob = await fetchWithAuth(`/images/${item.image.id}/full`, {
            tenantId: this.tenant,
            responseType: 'blob'
          });

          zip.file(filename, blob);
        } catch (error) {
          console.error(`Error downloading ${filename}:`, error);
        }
      }

      // Generate zip file
      const zipBlob = await zip.generateAsync({ type: 'blob' });

      // Create download link
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${this.selectedList.title || 'list'}_images.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error creating zip file:', error);
      alert('Failed to download images. Please try again.');
    } finally {
      this.isDownloading = false;
    }
  }

  render() {
    // Check visibility on each render to detect when tab becomes active
    this._checkVisibility();

    return html`
      <div class="p-4">
        <div class="flex justify-between items-center mb-6">
            <h2 class="text-lg font-semibold text-gray-900">Lists</h2>
            <div class="ml-auto flex items-center gap-2">
              <button
                @click=${this._createList}
                class="inline-flex items-center gap-2 border rounded-lg px-4 py-2 text-xs text-gray-600 hover:bg-gray-50"
              >
                <span aria-hidden="true">+</span>
                Add New List
              </button>
              <button
                @click=${() => this.fetchLists({ force: true })}
                class="inline-flex items-center gap-2 border rounded-lg px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
                title="Refresh"
                ?disabled=${this.isLoadingLists}
                aria-busy=${this.isLoadingLists ? 'true' : 'false'}
              >
                <span aria-hidden="true" class=${this.isLoadingLists ? 'animate-spin' : ''}>↻</span>
                ${this.isLoadingLists ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
        </div>
        ${this.lists.length === 0
          ? html`<p class="text-base text-gray-600">No lists found.</p>`
          : html`
            <table class="min-w-full bg-white border border-gray-300">
              <thead>
                <tr class="bg-gray-50">
                  <th class="py-2 px-4 border-b left-justified-header text-xs font-semibold text-gray-700">Title</th>
                  <th class="py-2 px-4 border-b left-justified-header text-xs font-semibold text-gray-700">Item Count</th>
                  <th class="py-2 px-4 border-b left-justified-header text-xs font-semibold text-gray-700">Created At</th>
                  <th class="py-2 px-4 border-b left-justified-header text-xs font-semibold text-gray-700">Author</th>
                  <th class="py-2 px-4 border-b left-justified-header text-xs font-semibold text-gray-700">Notes</th>
                  <th class="py-2 px-4 border-b left-justified-header text-xs font-semibold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${this.lists.map(list => html`
                  <tr class="hover:bg-gray-50 border-b">
                    <td class="py-2 px-4 text-xs text-gray-900">${list.title}</td>
                    <td class="py-2 px-4 text-center text-xs text-gray-700">${list.item_count}</td>
                    <td class="py-2 px-4 text-xs text-gray-700">${new Date(list.created_at).toLocaleDateString()}</td>
                    <td class="py-2 px-4 text-xs text-gray-600">${list.created_by_name || '—'}</td>
                    <td class="py-2 px-4 text-xs text-gray-600">${list.notebox || '—'}</td>
                    <td class="py-2 px-4 text-left">
                      <button @click=${() => this._selectList(list)} class="bg-green-600 text-white px-3 py-1 rounded text-xs hover:bg-green-700 mr-2">Edit</button>
                      <button @click=${() => this._deleteList(list)} class="bg-red-600 text-white px-3 py-1 rounded text-xs hover:bg-red-700">Delete</button>
                    </td>
                  </tr>
                `)}
              </tbody>
            </table>
          `}
      </div>

      ${this.selectedList ? html`
        <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div class="bg-white rounded-lg shadow-lg w-full max-w-4xl mx-4 max-h-90vh overflow-auto p-6">
            ${this.isLoadingItems ? html`
              <!-- Skeleton Loading State -->
              <div class="flex justify-between items-start mb-6">
                <div class="flex-1">
                  <div class="skeleton skeleton-title w-1/3 mb-2"></div>
                  <div class="skeleton skeleton-text w-1/2 mb-2"></div>
                  <div class="flex gap-4 mb-4">
                    <div class="skeleton skeleton-text w-32"></div>
                    <div class="skeleton skeleton-text w-32"></div>
                  </div>
                </div>
                <div class="flex gap-2">
                  <div class="skeleton skeleton-text w-20"></div>
                  <div class="skeleton skeleton-text w-16"></div>
                  <div class="skeleton skeleton-text w-8"></div>
                </div>
              </div>

              <div class="skeleton skeleton-text w-32 mb-4"></div>

              <div class="border border-gray-300 rounded overflow-hidden">
                <div class="bg-gray-50 border-b border-gray-300 px-4 py-2 flex gap-4">
                  <div class="skeleton skeleton-text w-1/2"></div>
                  <div class="skeleton skeleton-text w-1/4"></div>
                </div>
                ${[...Array(5)].map(() => html`
                  <div class="border-b border-gray-200 px-4 py-3 flex gap-4">
                    <div class="skeleton skeleton-text w-1/2"></div>
                    <div class="skeleton skeleton-text w-1/4"></div>
                  </div>
                `)}
              </div>
            ` : html`
              <!-- Loaded Content -->
              <div class="flex justify-between items-start mb-6">
                <div class="flex-1">
                  <h3 class="text-2xl font-bold text-gray-900 mb-1">${this.selectedList.title}</h3>
                  <p class="text-base text-gray-600 mb-2">${this.selectedList.notebox || 'No notes.'}</p>
                  <div class="flex gap-4 text-xs text-gray-600 mb-4">
                    <div>
                      <span class="font-semibold">Author:</span> ${this.selectedList.created_by_name || 'Unknown'}
                    </div>
                    <div>
                      <span class="font-semibold">Created:</span> ${new Date(this.selectedList.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div class="flex gap-2">
                  <button @click=${this._downloadListImages} ?disabled=${this.isDownloading} class="bg-blue-600 text-white px-3 py-1 rounded text-xs hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1">
                    ${this.isDownloading ? html`<span class="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span>` : ''}
                    Download
                  </button>
                  <button @click=${this._startEditingSelectedList} class="bg-green-600 text-white px-3 py-1 rounded text-xs hover:bg-green-700">Edit</button>
                  <button @click=${() => { this.selectedList = null; this.listItems = []; this.editingSelectedList = false; }} class="text-gray-500 hover:text-gray-700 text-2xl">×</button>
                </div>
              </div>

              <h4 class="text-sm font-semibold text-gray-900 mb-4">List Items (${this.listItems.length})</h4>

              ${this.listItems.length === 0 ? html`
                <p class="text-base text-gray-500">No items in this list yet.</p>
              ` : html`
                <div class="border border-gray-300 rounded overflow-hidden">
                  <div class="divide-y divide-gray-300 overflow-x-auto">
                    ${this.listItems.map(item => {
                      const encodedPath = item.image.dropbox_path.split('/').map(part => encodeURIComponent(part)).join('/');
                      const dropboxUrl = `https://www.dropbox.com/home${encodedPath}`;
                      return html`
                        <div class="px-4 py-3 hover:bg-gray-50 whitespace-nowrap">
                          <a href="${dropboxUrl}" target="dropbox" rel="noopener noreferrer" class="text-blue-600 hover:text-blue-700 underline text-xs">${dropboxUrl}</a>
                        </div>
                      `;
                    })}
                  </div>
                </div>
              `}
            `}

          </div>
        </div>
      ` : ''}

      ${this.editingSelectedList && this.selectedList ? html`
        <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div class="bg-white rounded-lg shadow-lg w-full max-w-2xl mx-4 max-h-90vh overflow-auto p-6">
            <div class="flex justify-between items-center mb-6">
              <h3 class="text-xl font-bold text-gray-900">Edit List</h3>
              <button @click=${this._cancelEditingSelectedList} class="text-gray-500 hover:text-gray-700 text-2xl">×</button>
            </div>

            <div class="mb-6">
              <div class="grid grid-cols-2 gap-4 mb-6 pb-6 border-b border-gray-200">
                <div>
                  <p class="text-xs font-semibold text-gray-700 mb-1">Author</p>
                  <p class="text-sm text-gray-900">${this.selectedList.created_by_name || 'Unknown'}</p>
                </div>
                <div>
                  <p class="text-xs font-semibold text-gray-700 mb-1">Created</p>
                  <p class="text-sm text-gray-900">${new Date(this.selectedList.created_at).toLocaleDateString()}</p>
                </div>
              </div>

              <div class="mb-4">
                <label class="block text-xs font-semibold text-gray-700 mb-2">Title</label>
                <input
                  id="edit-list-title"
                  type="text"
                  .value=${this.selectedList.title || ''}
                  class="w-full p-2 border border-gray-300 rounded text-sm"
                >
              </div>

              <div class="mb-4">
                <label class="block text-xs font-semibold text-gray-700 mb-2">Notes</label>
                <textarea
                  id="edit-list-notes"
                  .value=${this.selectedList.notebox || ''}
                  class="w-full p-2 border border-gray-300 rounded text-sm"
                  rows="4"
                ></textarea>
              </div>
            </div>

            <div class="flex justify-end gap-2">
              <button @click=${this._cancelEditingSelectedList} class="border border-gray-400 text-gray-700 px-4 py-2 rounded text-sm hover:bg-gray-100">Cancel</button>
              <button @click=${this._saveSelectedListChanges} class="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">Save</button>
            </div>
          </div>
        </div>
      ` : ''}
    `;
  }
}

customElements.define('list-editor', ListEditor);
