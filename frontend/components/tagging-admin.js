import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import {
  getKeywordCategories,
  createKeywordCategory,
  updateKeywordCategory,
  deleteKeywordCategory,
  getKeywordsInCategory,
  createKeyword,
  updateKeyword,
  deleteKeyword,
  getPeople,
} from '../services/api.js';

class TaggingAdmin extends LitElement {
  static styles = [tailwind, css`
    :host {
      display: block;
    }
    .modal-backdrop {
      background: rgba(15, 23, 42, 0.45);
    }
    .category-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      cursor: pointer;
      background: #f8fafc;
      transition: background 0.15s ease, box-shadow 0.15s ease;
    }
    .category-row:hover {
      background: #eef2f7;
    }
    .category-row:focus {
      outline: none;
      box-shadow: inset 0 0 0 2px #93c5fd;
    }
    .category-caret {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 999px;
      background: #e2e8f0;
      color: #1f2937;
      font-size: 12px;
      transition: transform 0.15s ease, background 0.15s ease;
    }
    .category-caret.open {
      transform: rotate(90deg);
      background: #dbeafe;
      color: #1d4ed8;
    }
    .category-title {
      display: inline-flex;
      align-items: center;
      gap: 10px;
    }
    .category-count {
      font-size: 12px;
      color: #6b7280;
    }
    .help-panel {
      background: #f0f7ff;
      border: 1px solid #dbeafe;
      color: #1d4ed8;
      border-radius: 8px;
      padding: 12px 16px;
    }
    .help-panel summary {
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      list-style: none;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .help-panel summary::-webkit-details-marker {
      display: none;
    }
    .help-panel summary::before {
      content: "▸";
      display: inline-block;
      transition: transform 0.15s ease;
    }
    .help-panel[open] summary::before {
      transform: rotate(90deg);
    }
    .help-panel p {
      margin-top: 10px;
      font-size: 13px;
      color: #1e3a8a;
      line-height: 1.5;
    }
  `];

  static properties = {
    tenant: { type: String },
    categories: { type: Array },
    keywordsByCategory: { type: Object },
    expandedCategories: { type: Object },
    isLoading: { type: Boolean },
    peopleOptions: { type: Array },
    peopleLoading: { type: Boolean },
    isSavingCategory: { type: Boolean },
    dialog: { type: Object },
    error: { type: String },
  };

  constructor() {
    super();
    this.tenant = '';
    this.categories = [];
    this.keywordsByCategory = {};
    this.expandedCategories = new Set();
    this.isLoading = false;
    this.peopleOptions = [];
    this.peopleLoading = false;
    this.isSavingCategory = false;
    this.dialog = null;
    this.error = '';
  }

  updated(changedProperties) {
    if (changedProperties.has('tenant')) {
      this.loadCategories();
    }
  }

  async loadCategories(options = {}) {
    if (!this.tenant) return;
    this.isLoading = true;
    this.error = '';
    try {
      const categories = await getKeywordCategories(this.tenant);
      this.categories = categories || [];
      if (!options.preserveExpanded) {
        this.keywordsByCategory = {};
        this.expandedCategories = new Set();
      }
    } catch (error) {
      console.error('Failed to load keyword categories:', error);
      this.error = 'Failed to load categories.';
    } finally {
      this.isLoading = false;
    }
  }

  async toggleCategory(categoryId) {
    if (this.expandedCategories.has(categoryId)) {
      this.expandedCategories.delete(categoryId);
      this.expandedCategories = new Set(this.expandedCategories);
      return;
    }
    try {
      const keywords = await getKeywordsInCategory(this.tenant, categoryId);
      this.keywordsByCategory = {
        ...this.keywordsByCategory,
        [categoryId]: keywords || [],
      };
      this.expandedCategories.add(categoryId);
      this.expandedCategories = new Set(this.expandedCategories);
    } catch (error) {
      console.error('Failed to load keywords:', error);
      this.error = 'Failed to load keywords.';
    }
  }

  openCategoryDialog(mode, category = null) {
    this.dialog = {
      type: 'category',
      mode,
      categoryId: category?.id || null,
      name: category?.name || '',
      slug: category?.slug || '',
      parentId: category?.parent_id ?? '',
      sortOrder: category?.sort_order ?? '',
      isPeopleCategory: category?.is_people_category || false,
      isAttribution: category?.is_attribution || false,
    };
  }

  async loadPeopleOptions() {
    if (!this.tenant) return;
    this.peopleLoading = true;
    try {
      const tenantId = this.tenant || localStorage.getItem('tenantId') || 'default';
      const people = await getPeople(tenantId, { limit: 500 });
      this.peopleOptions = people || [];
    } catch (error) {
      console.error('Failed to load people:', error);
      this.peopleOptions = [];
      this.error = 'Failed to load people.';
    } finally {
      this.peopleLoading = false;
    }
  }

  async openKeywordDialog(mode, category, keyword = null) {
    const isPeopleCategory = !!category.is_people_category;
    if (isPeopleCategory) {
      await this.loadPeopleOptions();
    }
    const personSelection = keyword?.person_id ? String(keyword.person_id) : '';
    let personName = keyword?.person_name || '';
    let personInstagramUrl = keyword?.person_instagram_url || '';
    if (isPeopleCategory && personSelection) {
      const matched = (this.peopleOptions || []).find((person) => String(person.id) === personSelection);
      if (matched) {
        personName = matched.name || personName;
        personInstagramUrl = matched.instagram_url || personInstagramUrl;
      } else if (keyword?.person_name) {
        this.peopleOptions = [
          ...this.peopleOptions,
          {
            id: Number(personSelection),
            name: keyword.person_name,
            instagram_url: keyword.person_instagram_url || '',
          },
        ];
      }
    }

    this.dialog = {
      type: 'keyword',
      mode,
      categoryId: category.id,
      categoryName: category.name,
      isPeopleCategory,
      keywordId: keyword?.id || null,
      keyword: keyword?.keyword || '',
      prompt: keyword?.prompt || '',
      personSelection,
      personName,
      personInstagramUrl,
    };
  }

  openConfirmDialog(action, payload) {
    this.dialog = {
      type: 'confirm',
      action,
      payload,
    };
  }

  closeDialog() {
    this.dialog = null;
  }

  async handleCategorySubmit(e) {
    e.preventDefault();
    const payload = {
      name: this.dialog?.name?.trim(),
      slug: this.dialog?.slug?.trim() || null,
      parent_id: this.dialog?.parentId === '' ? null : Number(this.dialog?.parentId),
      sort_order: this.dialog?.sortOrder === '' ? undefined : Number(this.dialog?.sortOrder),
      is_people_category: !!this.dialog?.isPeopleCategory,
      is_attribution: !!this.dialog?.isAttribution,
    };
    if (!payload.name) return;
    this.isSavingCategory = true;
    try {
      if (this.dialog.mode === 'create') {
        await createKeywordCategory(this.tenant, payload);
      } else if (this.dialog.mode === 'edit') {
        await updateKeywordCategory(this.tenant, this.dialog.categoryId, payload);
      }
      await this.loadCategories({ preserveExpanded: this.dialog.mode === 'edit' });
      if (this.dialog.mode === 'create') {
        this.closeDialog();
      }
    } catch (error) {
      console.error('Failed to save category:', error);
      this.error = 'Failed to save category.';
    } finally {
      this.isSavingCategory = false;
    }
  }

  async handleKeywordSubmit(e) {
    e.preventDefault();
    const payload = {
      keyword: this.dialog?.keyword?.trim(),
      prompt: this.dialog?.prompt?.trim() || '',
    };
    if (!payload.keyword) return;
    if (this.dialog?.isPeopleCategory) {
      const selection = this.dialog.personSelection || '';
      if (!selection) {
        payload.person = null;
      } else {
        const name = this.dialog.personName?.trim() || '';
        if (!name) {
          this.error = 'Person name is required when linking a person.';
          return;
        }
        const instagramUrl = (this.dialog.personInstagramUrl || '').trim();
        if (selection === 'new') {
          payload.person = {
            name,
            instagram_url: instagramUrl || null,
          };
        } else {
          payload.person = {
            id: Number(selection),
            name,
            instagram_url: instagramUrl || null,
          };
        }
      }
    }
    try {
      if (this.dialog.mode === 'create') {
        await createKeyword(this.tenant, this.dialog.categoryId, payload);
      } else if (this.dialog.mode === 'edit') {
        await updateKeyword(this.tenant, this.dialog.keywordId, payload);
      }
      const keywords = await getKeywordsInCategory(this.tenant, this.dialog.categoryId);
      this.keywordsByCategory = {
        ...this.keywordsByCategory,
        [this.dialog.categoryId]: keywords || [],
      };
      await this.loadCategories({ preserveExpanded: true });
      this.expandedCategories.add(this.dialog.categoryId);
      this.expandedCategories = new Set(this.expandedCategories);
      if (this.dialog.mode === 'create') {
        this.dialog = {
          ...this.dialog,
          keyword: '',
          prompt: '',
        };
      }
      this.error = '';
    } catch (error) {
      console.error('Failed to save keyword:', error);
      this.error = 'Failed to save keyword.';
    }
  }

  async handleConfirm() {
    if (!this.dialog) return;
    const { action, payload } = this.dialog;
    try {
      if (action === 'delete-category') {
        await deleteKeywordCategory(this.tenant, payload.categoryId);
        await this.loadCategories();
      }
      if (action === 'delete-keyword') {
        await deleteKeyword(this.tenant, payload.keywordId);
        const keywords = await getKeywordsInCategory(this.tenant, payload.categoryId);
        this.keywordsByCategory = {
          ...this.keywordsByCategory,
          [payload.categoryId]: keywords || [],
        };
        await this.loadCategories();
      }
      this.closeDialog();
    } catch (error) {
      console.error('Failed to delete item:', error);
      this.error = 'Failed to delete item.';
    }
  }

  renderDialog() {
    if (!this.dialog) return null;

    if (this.dialog.type === 'confirm') {
      const message = this.dialog.action === 'delete-category'
        ? 'Delete this category and all keywords?'
        : 'Delete this keyword?';
      return html`
        <div class="fixed inset-0 z-50 flex items-center justify-center modal-backdrop">
          <div class="bg-white rounded-lg shadow-xl w-full max-w-6xl mx-4 p-6">
            <h3 class="text-lg font-semibold text-gray-800 mb-2">Confirm Delete</h3>
            <p class="text-sm text-gray-600 mb-6">${message}</p>
            <div class="flex justify-end gap-3">
              <button class="px-4 py-2 border rounded-lg" @click=${this.closeDialog}>Cancel</button>
              <button class="px-4 py-2 bg-red-600 text-white rounded-lg" @click=${this.handleConfirm}>Delete</button>
            </div>
          </div>
        </div>
      `;
    }

    if (this.dialog.type === 'category') {
      const availableParents = (this.categories || []).filter((cat) => cat.id !== this.dialog.categoryId);
      return html`
        <div class="fixed inset-0 z-50 flex items-center justify-center modal-backdrop">
          <div class="bg-white rounded-lg shadow-xl w-full max-w-6xl mx-4 p-6">
            <h3 class="text-lg font-semibold text-gray-800 mb-4">
              ${this.dialog.mode === 'create' ? 'New Category' : 'Edit Category'}
            </h3>
            <form @submit=${this.handleCategorySubmit}>
              <label class="block text-sm font-semibold text-gray-700 mb-2">Category Name</label>
              <input
                class="w-full border rounded-lg px-3 py-2 mb-6"
                .value=${this.dialog.name}
                @input=${(e) => { this.dialog = { ...this.dialog, name: e.target.value }; }}
                placeholder="e.g. Circus Skills"
                required
              />
              <label class="block text-sm font-semibold text-gray-700 mb-2">Slug</label>
              <input
                class="w-full border rounded-lg px-3 py-2 mb-6"
                .value=${this.dialog.slug}
                @input=${(e) => { this.dialog = { ...this.dialog, slug: e.target.value }; }}
                placeholder="e.g. circus"
              />
              <label class="block text-sm font-semibold text-gray-700 mb-2">Parent Category</label>
              <select
                class="w-full border rounded-lg px-3 py-2 mb-4"
                .value=${String(this.dialog.parentId ?? '')}
                @change=${(e) => { this.dialog = { ...this.dialog, parentId: e.target.value }; }}
              >
                <option value="">None</option>
                ${availableParents.map((cat) => html`
                  <option value=${cat.id}>${cat.name}</option>
                `)}
              </select>
              <label class="block text-sm font-semibold text-gray-700 mb-2">Sort Order</label>
              <input
                class="w-full border rounded-lg px-3 py-2 mb-4"
                type="number"
                .value=${this.dialog.sortOrder}
                @input=${(e) => { this.dialog = { ...this.dialog, sortOrder: e.target.value }; }}
                placeholder="0"
                min="0"
              />
              <div class="flex flex-wrap gap-6 mb-4">
                <label class="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    class="rounded border-gray-300"
                    .checked=${this.dialog.isPeopleCategory}
                    @change=${(e) => { this.dialog = { ...this.dialog, isPeopleCategory: e.target.checked }; }}
                  />
                  People category
                </label>
                <label class="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    class="rounded border-gray-300"
                    .checked=${this.dialog.isAttribution}
                    @change=${(e) => { this.dialog = { ...this.dialog, isAttribution: e.target.checked }; }}
                  />
                  Attribution category
                </label>
              </div>
              <div class="flex justify-between items-center gap-3">
                ${this.dialog.mode === 'edit' ? html`
                  <button
                    type="button"
                    class="px-4 py-2 bg-red-600 text-white rounded-lg"
                    @click=${() => this.openConfirmDialog('delete-category', { categoryId: this.dialog.categoryId })}
                  >
                    Delete
                  </button>
                ` : html`<span></span>`}
                <div class="flex gap-3">
                  <button type="button" class="px-4 py-2 border rounded-lg" @click=${this.closeDialog}>Cancel</button>
                  <button
                    type="submit"
                    class="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-60"
                    ?disabled=${this.isSavingCategory}
                  >
                    ${this.isSavingCategory ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      `;
    }

    if (this.dialog.type === 'keyword') {
      const personSelection = this.dialog.personSelection ? String(this.dialog.personSelection) : '';
      const selectedMissing = !!personSelection
        && personSelection !== 'new'
        && !(this.peopleOptions || []).some((person) => String(person.id) === String(personSelection));
      const selectedLabel = this.dialog.personName
        ? `${this.dialog.personName} (linked)`
        : `Linked person #${personSelection}`;
      return html`
        <div class="fixed inset-0 z-50 flex items-center justify-center modal-backdrop">
          <div class="bg-white rounded-lg shadow-xl w-full max-w-6xl mx-4 p-6">
            <h3 class="text-lg font-semibold text-gray-800 mb-4">
              ${this.dialog.mode === 'create' ? 'Add Keyword' : 'Edit Keyword'}
            </h3>
            <p class="text-sm text-gray-500 mb-4">Category: ${this.dialog.categoryName}</p>
            <form @submit=${this.handleKeywordSubmit}>
              <label class="block text-sm font-semibold text-gray-700 mb-2">Keyword</label>
              <input
                class="w-full border rounded-lg px-3 py-2 mb-4"
                .value=${this.dialog.keyword}
                @input=${(e) => { this.dialog = { ...this.dialog, keyword: e.target.value }; }}
                placeholder="e.g. aerial-silks"
                required
              />
              ${this.dialog.isPeopleCategory ? html`` : html`
                <label class="block text-sm font-semibold text-gray-700 mb-2">Prompt</label>
                <textarea
                  class="w-full border rounded-lg px-3 py-2 mb-6"
                  rows="3"
                  .value=${this.dialog.prompt}
                  @input=${(e) => { this.dialog = { ...this.dialog, prompt: e.target.value }; }}
                  placeholder="Optional prompt for ML tagging"
                ></textarea>
              `}
              ${this.dialog.isPeopleCategory ? html`
                <div class="border-t border-gray-100 pt-4 mt-2 mb-6">
                  <label class="block text-sm font-semibold text-gray-700 mb-2">Linked Person</label>
                  <select
                    class="w-full border rounded-lg px-3 py-2 mb-3"
                    .value=${personSelection}
                    @change=${(e) => {
                      const value = e.target.value;
                      let personName = '';
                      let personInstagramUrl = '';
                      if (value && value !== 'new') {
                        const matched = (this.peopleOptions || []).find((person) => String(person.id) === value);
                        if (matched) {
                          personName = matched.name || '';
                          personInstagramUrl = matched.instagram_url || '';
                        }
                      }
                      this.dialog = {
                        ...this.dialog,
                        personSelection: value,
                        personName,
                        personInstagramUrl,
                      };
                    }}
                  >
                    <option value="">None</option>
                    <option value="new" ?selected=${personSelection === 'new'}>Create new person…</option>
                    ${selectedMissing ? html`
                      <option value=${personSelection} ?selected=${true}>${selectedLabel}</option>
                    ` : ''}
                    ${this.peopleOptions.map((person) => html`
                      <option
                        value=${String(person.id)}
                        ?selected=${personSelection === String(person.id)}
                      >${person.name}</option>
                    `)}
                  </select>
                  ${this.peopleLoading ? html`
                    <div class="text-xs text-gray-500 mb-3">Loading people…</div>
                  ` : ''}
                  ${this.dialog.personSelection ? html`
                    <label class="block text-sm font-semibold text-gray-700 mb-2">Person Name</label>
                    <input
                      class="w-full border rounded-lg px-3 py-2 mb-3"
                      .value=${this.dialog.personName || ''}
                      @input=${(e) => { this.dialog = { ...this.dialog, personName: e.target.value }; }}
                      placeholder="e.g. Kendall Bush"
                      required
                    />
                    <label class="block text-sm font-semibold text-gray-700 mb-2">Instagram URL</label>
                    <input
                      class="w-full border rounded-lg px-3 py-2"
                      type="url"
                      .value=${this.dialog.personInstagramUrl || ''}
                      @input=${(e) => { this.dialog = { ...this.dialog, personInstagramUrl: e.target.value }; }}
                      placeholder="https://instagram.com/username"
                    />
                    <p class="text-xs text-gray-500 mt-2">
                      Changes here update the linked person record.
                    </p>
                  ` : html`
                    <p class="text-xs text-gray-500">No person linked.</p>
                  `}
                </div>
              ` : ''}
              <div class="flex justify-between items-center gap-3">
                ${this.dialog.mode === 'edit' ? html`
                  <button
                    type="button"
                    class="px-4 py-2 bg-red-600 text-white rounded-lg"
                    @click=${() => this.openConfirmDialog('delete-keyword', { categoryId: this.dialog.categoryId, keywordId: this.dialog.keywordId })}
                  >
                    Delete
                  </button>
                ` : html`<span></span>`}
                <div class="flex gap-3">
                  ${this.dialog.mode === 'edit' ? html`
                    <button type="button" class="px-4 py-2 border rounded-lg" @click=${this.closeDialog}>Close</button>
                    <button type="button" class="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg" @click=${this._openUploadModal}>
                      Test
                    </button>
                  ` : html`
                    <button type="button" class="px-4 py-2 border rounded-lg" @click=${this.closeDialog}>Cancel</button>
                  `}
                  <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded-lg">Save</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      `;
    }

    return null;
  }

  renderCategory(category) {
    const isExpanded = this.expandedCategories.has(category.id);
    const isPeopleCategory = !!category.is_people_category;
    const keywords = [...(this.keywordsByCategory[category.id] || [])].sort((a, b) =>
      a.keyword.localeCompare(b.keyword)
    );
    return html`
      <div class="border border-gray-200 rounded-lg bg-white">
        <div
          class="category-row"
          role="button"
          tabindex="0"
          @click=${() => this.toggleCategory(category.id)}
          @keydown=${(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              this.toggleCategory(category.id);
            }
          }}
        >
          <div class="category-title">
            <span class="category-caret ${isExpanded ? 'open' : ''}">▸</span>
            <span class="font-semibold text-gray-800">${category.name}</span>
            <span class="category-count">(${category.keyword_count} keywords)</span>
          </div>
          <button
            class="text-xs text-blue-600 hover:text-blue-700"
            @click=${(e) => { e.stopPropagation(); this.openCategoryDialog('edit', category); }}
          >
            Edit
          </button>
        </div>
        ${isExpanded ? html`
          <div class="border-t border-gray-200 px-4 py-3">
            <div class="mb-3">
              <button class="text-xs text-blue-600 hover:text-blue-700" @click=${() => this.openKeywordDialog('create', category)}>
                + Add keyword
              </button>
            </div>
            ${keywords.length ? html`
              <div class="grid grid-cols-3 gap-2 text-xs font-semibold text-gray-500 mb-2">
                <div>Keyword</div>
                <div>${isPeopleCategory ? 'Person' : 'Prompt'}</div>
                <div class="text-right">Actions</div>
              </div>
              <div class="divide-y divide-gray-100">
                ${keywords.map((kw) => html`
                  <div class="grid grid-cols-3 gap-2 text-sm text-gray-700 items-start py-2">
                    <div class="font-medium">${kw.keyword}</div>
                    <div class="text-gray-500">
                      ${isPeopleCategory
                        ? (kw.person_name || (kw.person_id ? `Linked #${kw.person_id}` : '—'))
                        : (kw.prompt || '—')}
                    </div>
                    <div class="flex items-center justify-end gap-2">
                      <button class="text-xs text-blue-600" @click=${() => this.openKeywordDialog('edit', category, kw)}>Edit</button>
                    </div>
                  </div>
                `)}
              </div>
            ` : html`<div class="text-sm text-gray-500">No keywords yet.</div>`}
          </div>
        ` : ''}
      </div>
    `;
  }

  render() {
    return html`
      <div class="w-full">
        <div class="bg-white rounded-lg border border-gray-200 p-6">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h2 class="text-xl font-semibold text-gray-800">Keywords Configuration</h2>
              <p class="text-sm text-gray-500">Define categories and keywords for image tagging.</p>
            </div>
            <div class="flex items-center gap-3">
              <button class="px-4 py-2 bg-blue-600 text-white rounded-lg" @click=${this._openUploadModal}>
                <i class="fas fa-flask mr-2"></i>Test
              </button>
            </div>
          </div>
          <details class="help-panel mb-6">
            <summary>How keywords and categories work</summary>
            <p>
              Categories group related keywords and define how tagging behaves across the app. Keywords are used
              for search, manual tagging, and zero-shot ML tagging when a prompt is present. Prompts describe the
              visual concept for ML scoring. In People categories, keywords can be linked to a person record and
              are excluded from ML tagging, since they are meant for manual attribution and identity tagging.
              Attribution categories are intended for credits and sources. The order of categories affects display
              order, and prompts in the same category are scored relative to one another.
            </p>
          </details>

          ${this.error ? html`<div class="text-sm text-red-600 mb-4">${this.error}</div>` : ''}
          ${this.isLoading ? html`<div class="text-sm text-gray-500">Loading categories…</div>` : ''}
          <div class="mb-3">
            <button class="text-sm text-blue-600 hover:text-blue-700" @click=${() => this.openCategoryDialog('create')}>
              + New category
            </button>
          </div>
          <div class="space-y-4">
            ${this.categories.map((category) => this.renderCategory(category))}
          </div>
        </div>
      </div>
      ${this.renderDialog()}
    `;
  }

  _openUploadModal() {
    this.dispatchEvent(new CustomEvent('open-upload-modal', { bubbles: true, composed: true }));
  }
}

customElements.define('tagging-admin', TaggingAdmin);
