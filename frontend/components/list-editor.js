import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import { getLists } from '../services/api.js';

class ListEditor extends LitElement {
  static styles = [tailwind, css`
    :host {
      display: block;
    }
    .left-justified-header {
      text-align: left;
    }
  `];

  static properties = {
    tenant: { type: String },
    lists: { type: Array },
  };

  constructor() {
    super();
    this.lists = [];
  }

  connectedCallback() {
    super.connectedCallback();
    this.fetchLists();
  }

  willUpdate(changedProperties) {
    if (changedProperties.has('tenant')) {
      this.fetchLists();
    }
  }

  async fetchLists() {
    if (!this.tenant) {
      console.warn('fetchLists: Tenant ID is not available.');
      return;
    }
    console.log('fetchLists: Fetching lists for tenant:', this.tenant);
    try {
      const fetchedLists = await getLists(this.tenant);
      console.log('fetchLists: Fetched lists:', fetchedLists);
      this.lists = fetchedLists;
    } catch (error) {
      console.error('Error fetching lists:', error);
    }
  }

  _createList() {
    console.log('Add New List button clicked!');
    // Placeholder for opening a new list creation modal/form
  }

  render() {
    return html`
      <div class="p-4">
        <div class="flex justify-between items-center mb-4">
            <h2 class="text-2xl font-bold">Lists Editor</h2>
            <button @click=${this._createList} class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
                <i class="fas fa-plus mr-2"></i>Add New
            </button>
        </div>
        ${this.lists.length === 0
          ? html`<p>No lists found.</p>`
          : html`
            <table class="min-w-full bg-white border border-gray-300">
              <thead>
                <tr>





                  <th class="py-2 px-4 border-b left-justified-header">Active</th>
                  <th class="py-2 px-4 border-b left-justified-header">Item Count</th>
                  <th class="py-2 px-4 border-b left-justified-header">Created At</th>
                  <th class="py-2 px-4 border-b left-justified-header">Description</th>
                  <th class="py-2 px-4 border-b left-justified-header">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${this.lists.map(list => html`
                  <tr>
                    <td class="py-2 px-4 border-b text-center">${list.is_active ? '✅' : '❌'}</td>
                    <td class="py-2 px-4 border-b text-center">${list.item_count}</td>
                    <td class="py-2 px-4 border-b">${new Date(list.created_at).toLocaleDateString()}</td>
                    <td class="py-2 px-4 border-b">${list.notebox}</td>
                    <td class="py-2 px-4 border-b">
                      <button class="bg-blue-500 text-white px-3 py-1 rounded mr-2">View</button>
                      <button class="bg-green-500 text-white px-3 py-1 rounded">Edit</button>
                    </td>
                  </tr>
                `)}
              </tbody>
            </table>
          `}
      </div>
    `;
  }
}

customElements.define('list-editor', ListEditor);

