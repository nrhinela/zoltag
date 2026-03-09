import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import {
  getKeywordCategories,
  getKeywordsInCategory,
  createKeywordCategory,
  updateKeywordCategory,
  deleteKeywordCategory,
  createKeyword,
  updateKeyword,
  deleteKeyword,
} from '../services/api.js';

class TaggingAdmin2 extends LitElement {
  static styles = [tailwind, css`
    :host {
      display: block;
      font-size: 16px;
    }
    .toolbar-grid {
      display: grid;
      grid-template-columns: minmax(260px, 1fr) auto;
      gap: 10px;
      align-items: center;
    }
    .category-adder-actions {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      justify-content: flex-end;
    }
    .list-grid {
      display: grid;
      gap: 10px;
    }
    .category-group {
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      background: #fff;
      overflow: hidden;
    }
    .category-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      background: #f8fafc;
      border-bottom: 1px solid #e5e7eb;
      padding: 12px;
    }
    .section-heading {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      color: #334155;
      margin-bottom: 8px;
    }
    .category-fields {
      display: grid;
      grid-template-columns: minmax(200px, 1fr) minmax(400px, 2fr) 120px;
      gap: 10px;
      align-items: start;
    }
    .category-field-label {
      display: block;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #64748b;
      margin-bottom: 4px;
    }
    .category-meta {
      margin-top: 8px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #4b5563;
    }
    .category-actions {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      justify-content: flex-end;
      flex-wrap: wrap;
    }
    .sort-order-input {
      width: 100%;
      min-width: 0;
      text-align: right;
    }
    .keyword-section {
      padding: 10px 12px 12px;
      display: grid;
      gap: 8px;
      background: #ffffff;
    }
    .keyword-header {
      display: grid;
      grid-template-columns: 1fr 2fr auto;
      gap: 8px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #64748b;
      padding: 0 2px;
    }
    .keyword-header-help {
      margin-top: 2px;
      font-size: 11px;
      font-weight: 500;
      text-transform: none;
      letter-spacing: normal;
      color: #64748b;
    }
    .keyword-row {
      display: grid;
      grid-template-columns: 1fr 2fr auto;
      gap: 8px;
      align-items: center;
      border: 1px solid #eef2f7;
      border-radius: 8px;
      padding: 8px;
      background: #fff;
    }
    .tag-cell {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .tag-arrow {
      color: #64748b;
      font-size: 12px;
      line-height: 1;
      flex: 0 0 auto;
    }
    .tag-cell input {
      flex: 1 1 auto;
      min-width: 0;
    }
    .keyword-actions {
      display: inline-flex;
      gap: 6px;
      justify-content: flex-end;
    }
    .keyword-footer {
      display: flex;
      justify-content: flex-end;
      margin-top: 2px;
    }
    .keyword-adder {
      border-style: dashed;
      border-color: #bfdbfe;
      background: #f8fbff;
    }
    .keyword-adder input {
      background: #fef9c3;
      border-color: #facc15;
    }
    .keyword-adder input::placeholder {
      color: #a16207;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      font-size: 11px;
      line-height: 1;
      border-radius: 999px;
      border: 1px solid #cbd5e1;
      color: #475569;
      background: #f8fafc;
      padding: 3px 8px;
    }
    .help-trigger {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 999px;
      border: 1px solid #94a3b8;
      color: #475569;
      background: #f8fafc;
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
      cursor: help;
      user-select: none;
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
    .help-panel ul {
      margin-top: 10px;
      margin-left: 18px;
      list-style: disc;
      font-size: 13px;
      color: #1e3a8a;
      line-height: 1.5;
      display: grid;
      gap: 6px;
    }
  `];

  static properties = {
    tenant: { type: String },
    readOnly: { type: Boolean },
    loading: { type: Boolean },
    error: { type: String },
    categories: { type: Array },
    keywordsByCategory: { type: Object },
    categoryDrafts: { type: Object },
    keywordDrafts: { type: Object },
    newCategoryDraft: { type: Object },
    categoryAdderOpen: { type: Boolean },
    newKeywordDrafts: { type: Object },
    keywordAdderOpen: { type: Object },
    busyCategory: { type: Object },
    busyKeyword: { type: Object },
  };

  constructor() {
    super();
    this.tenant = '';
    this.readOnly = false;
    this.loading = false;
    this.error = '';
    this.categories = [];
    this.keywordsByCategory = {};
    this.categoryDrafts = {};
    this.keywordDrafts = {};
    this.newCategoryDraft = { name: '' };
    this.categoryAdderOpen = false;
    this.newKeywordDrafts = {};
    this.keywordAdderOpen = {};
    this.busyCategory = {};
    this.busyKeyword = {};
  }

  updated(changed) {
    if (changed.has('tenant')) {
      this._loadAll();
    }
  }

  _setCategoryBusy(categoryId, value) {
    this.busyCategory = { ...this.busyCategory, [String(categoryId)]: Boolean(value) };
  }

  _setKeywordBusy(keywordId, value) {
    this.busyKeyword = { ...this.busyKeyword, [String(keywordId)]: Boolean(value) };
  }

  _isCategoryBusy(categoryId) {
    return Boolean(this.busyCategory?.[String(categoryId)]);
  }

  _isKeywordBusy(keywordId) {
    return Boolean(this.busyKeyword?.[String(keywordId)]);
  }

  _categoryHelpText() {
    return [
      'People category',
      'Links tags in this category to people or organizations.',
      '',
      'Attribution category',
      'Marks tags used for crediting creators, sources, or ownership. Marking this surfaces these tags on exports so photo attribution is straightforward.',
    ].join('\n');
  }

  _categoryRows() {
    const rows = [...(this.categories || [])];
    rows.sort((a, b) => {
      const sortA = this._parseSortOrder(a?.sort_order);
      const sortB = this._parseSortOrder(b?.sort_order);
      const hasSortA = Number.isFinite(sortA);
      const hasSortB = Number.isFinite(sortB);
      if (hasSortA && hasSortB && sortA !== sortB) return sortA - sortB;
      if (hasSortA && !hasSortB) return -1;
      if (!hasSortA && hasSortB) return 1;
      return String(a?.name || '').localeCompare(String(b?.name || ''), undefined, { sensitivity: 'base' });
    });
    return rows;
  }

  _parseSortOrder(value) {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return undefined;
    const num = Number.parseInt(trimmed, 10);
    return Number.isFinite(num) ? num : undefined;
  }

  _seedCategoryDrafts(categories = []) {
    const next = {};
    (categories || []).forEach((category) => {
      const id = String(category?.id || '');
      if (!id) return;
      next[id] = {
        name: String(category?.name || ''),
        slug: String(category?.slug || ''),
        sortOrder: category?.sort_order === null || category?.sort_order === undefined
          ? ''
          : String(category.sort_order),
        isPeopleCategory: Boolean(category?.is_people_category),
        isAttribution: Boolean(category?.is_attribution),
      };
    });
    this.categoryDrafts = next;
  }

  _seedKeywordDrafts(categoryId, keywords = []) {
    const nextCategoryDrafts = {};
    (keywords || []).forEach((kw) => {
      const keywordId = String(kw?.id || '');
      if (!keywordId) return;
      nextCategoryDrafts[keywordId] = {
        keyword: String(kw?.keyword || ''),
        prompt: String(kw?.prompt || ''),
      };
    });
    this.keywordDrafts = {
      ...this.keywordDrafts,
      [String(categoryId)]: nextCategoryDrafts,
    };
  }

  async _loadAll() {
    if (!this.tenant) return;
    this.loading = true;
    this.error = '';
    try {
      const categories = await getKeywordCategories(this.tenant);
      const safeCategories = Array.isArray(categories) ? categories : [];
      this.categories = safeCategories;
      this._seedCategoryDrafts(safeCategories);
      this.keywordDrafts = {};
      const keywordPairs = await Promise.all(
        safeCategories.map(async (category) => {
          const keywords = await getKeywordsInCategory(this.tenant, category.id);
          return [String(category.id), Array.isArray(keywords) ? keywords : []];
        })
      );
      const keywordsByCategory = {};
      keywordPairs.forEach(([categoryId, keywords]) => {
        keywordsByCategory[categoryId] = keywords;
        this._seedKeywordDrafts(categoryId, keywords);
      });
      this.keywordsByCategory = keywordsByCategory;
    } catch (error) {
      console.error('Failed to load tagging2 data:', error);
      this.error = 'Failed to load categories and keywords.';
    } finally {
      this.loading = false;
    }
  }

  _updateNewCategoryDraft(field, value) {
    this.newCategoryDraft = {
      ...this.newCategoryDraft,
      [field]: value,
    };
  }

  _openCategoryAdder() {
    this.categoryAdderOpen = true;
  }

  _cancelCategoryAdder() {
    this.categoryAdderOpen = false;
    this.newCategoryDraft = { name: '' };
  }

  async _addCategory() {
    if (this.readOnly) return;
    const name = String(this.newCategoryDraft?.name || '').trim();
    if (!name) return;
    try {
      await createKeywordCategory(this.tenant, {
        name,
      });
      this.newCategoryDraft = { name: '' };
      this.categoryAdderOpen = false;
      await this._loadAll();
    } catch (error) {
      console.error('Failed to add category:', error);
      this.error = 'Failed to add category.';
    }
  }

  _updateCategoryDraft(categoryId, field, value) {
    const key = String(categoryId);
    const current = this.categoryDrafts?.[key] || {};
    this.categoryDrafts = {
      ...this.categoryDrafts,
      [key]: { ...current, [field]: value },
    };
  }

  async _saveCategory(categoryId) {
    if (this.readOnly) return;
    const key = String(categoryId);
    const draft = this.categoryDrafts?.[key];
    if (!draft) return;
    const name = String(draft.name || '').trim();
    if (!name) return;
    const sortOrder = this._parseSortOrder(draft.sortOrder);
    this._setCategoryBusy(categoryId, true);
    try {
      await updateKeywordCategory(this.tenant, categoryId, {
        name,
        slug: String(draft.slug || '').trim() || null,
        sort_order: sortOrder,
        is_people_category: Boolean(draft.isPeopleCategory),
        is_attribution: Boolean(draft.isAttribution),
      });
      await this._loadAll();
    } catch (error) {
      console.error('Failed to save category:', error);
      this.error = 'Failed to save category.';
    } finally {
      this._setCategoryBusy(categoryId, false);
    }
  }

  async _deleteCategory(categoryId) {
    if (this.readOnly) return;
    this._setCategoryBusy(categoryId, true);
    try {
      await deleteKeywordCategory(this.tenant, categoryId);
      await this._loadAll();
    } catch (error) {
      console.error('Failed to delete category:', error);
      this.error = 'Failed to delete category.';
    } finally {
      this._setCategoryBusy(categoryId, false);
    }
  }

  _toggleKeywordAdder(categoryId) {
    const key = String(categoryId);
    const open = Boolean(this.keywordAdderOpen?.[key]);
    this.keywordAdderOpen = {
      ...this.keywordAdderOpen,
      [key]: !open,
    };
    if (!open && !this.newKeywordDrafts?.[key]) {
      this.newKeywordDrafts = {
        ...this.newKeywordDrafts,
        [key]: { keyword: '', prompt: '' },
      };
    }
  }

  _updateNewKeywordDraft(categoryId, field, value) {
    const key = String(categoryId);
    const current = this.newKeywordDrafts?.[key] || { keyword: '', prompt: '' };
    this.newKeywordDrafts = {
      ...this.newKeywordDrafts,
      [key]: { ...current, [field]: value },
    };
  }

  async _addKeyword(categoryId) {
    if (this.readOnly) return;
    const key = String(categoryId);
    const draft = this.newKeywordDrafts?.[key] || {};
    const keyword = String(draft.keyword || '').trim();
    if (!keyword) return;
    try {
      await createKeyword(this.tenant, categoryId, {
        keyword,
        prompt: String(draft.prompt || '').trim() || '',
      });
      this.newKeywordDrafts = {
        ...this.newKeywordDrafts,
        [key]: { keyword: '', prompt: '' },
      };
      await this._loadAll();
    } catch (error) {
      console.error('Failed to add keyword:', error);
      this.error = 'Failed to add keyword.';
    }
  }

  _updateKeywordDraft(categoryId, keywordId, field, value) {
    const categoryKey = String(categoryId);
    const keywordKey = String(keywordId);
    const currentCategory = this.keywordDrafts?.[categoryKey] || {};
    const currentKeyword = currentCategory?.[keywordKey] || {};
    this.keywordDrafts = {
      ...this.keywordDrafts,
      [categoryKey]: {
        ...currentCategory,
        [keywordKey]: {
          ...currentKeyword,
          [field]: value,
        },
      },
    };
  }

  async _saveKeyword(categoryId, keywordId) {
    if (this.readOnly) return;
    const categoryKey = String(categoryId);
    const keywordKey = String(keywordId);
    const draft = this.keywordDrafts?.[categoryKey]?.[keywordKey];
    if (!draft) return;
    const keyword = String(draft.keyword || '').trim();
    if (!keyword) return;
    this._setKeywordBusy(keywordId, true);
    try {
      await updateKeyword(this.tenant, keywordId, {
        keyword,
        prompt: String(draft.prompt || '').trim() || '',
      });
      await this._loadAll();
    } catch (error) {
      console.error('Failed to save keyword:', error);
      this.error = 'Failed to save keyword.';
    } finally {
      this._setKeywordBusy(keywordId, false);
    }
  }

  async _deleteKeyword(keywordId) {
    if (this.readOnly) return;
    this._setKeywordBusy(keywordId, true);
    try {
      await deleteKeyword(this.tenant, keywordId);
      await this._loadAll();
    } catch (error) {
      console.error('Failed to delete keyword:', error);
      this.error = 'Failed to delete keyword.';
    } finally {
      this._setKeywordBusy(keywordId, false);
    }
  }

  renderCategoryRow(category) {
    const categoryId = String(category?.id || '');
    if (!categoryId) return html``;
    const draft = this.categoryDrafts?.[categoryId] || {};
    const categoryHeadingName = String(draft?.name || category?.name || '').trim() || 'Untitled';
    const keywords = Array.isArray(this.keywordsByCategory?.[categoryId]) ? this.keywordsByCategory[categoryId] : [];
    const hasNoTags = keywords.length === 0;
    const keywordDrafts = this.keywordDrafts?.[categoryId] || {};
    const newKeywordDraft = this.newKeywordDrafts?.[categoryId] || { keyword: '', prompt: '' };
    const showKeywordAdder = hasNoTags ? true : Boolean(this.keywordAdderOpen?.[categoryId]);
    const categoryBusy = this._isCategoryBusy(categoryId);

    return html`
      <div class="category-group">
        <div class="category-row">
          <div>
            <div class="section-heading">Category: "${categoryHeadingName}"</div>
            <div class="category-fields">
              <div>
                <label class="category-field-label">Name</label>
                <input
                  class="w-full border rounded px-2 py-1 text-sm"
                  .value=${String(draft?.name || '')}
                  @input=${(e) => this._updateCategoryDraft(categoryId, 'name', e.target.value)}
                  ?disabled=${this.readOnly || categoryBusy}
                  placeholder="Category name"
                />
                <div class="category-meta">
                  <label class="inline-flex items-center gap-1">
                    <input
                      type="checkbox"
                      .checked=${Boolean(draft?.isPeopleCategory)}
                      @change=${(e) => this._updateCategoryDraft(categoryId, 'isPeopleCategory', e.target.checked)}
                      ?disabled=${this.readOnly || categoryBusy}
                    />
                    People
                  </label>
                  <label class="inline-flex items-center gap-1">
                    <input
                      type="checkbox"
                      .checked=${Boolean(draft?.isAttribution)}
                      @change=${(e) => this._updateCategoryDraft(categoryId, 'isAttribution', e.target.checked)}
                      ?disabled=${this.readOnly || categoryBusy}
                    />
                    Attribution
                  </label>
                  <span class="pill">${keywords.length} Tags</span>
                  <span class="help-trigger" tabindex="0" title=${this._categoryHelpText()} aria-label="Category help">?</span>
                </div>
              </div>
              <div>
                <label class="category-field-label">Description</label>
                <input
                  class="w-full border rounded px-2 py-1 text-sm"
                  .value=${String(draft?.slug || '')}
                  @input=${(e) => this._updateCategoryDraft(categoryId, 'slug', e.target.value)}
                  ?disabled=${this.readOnly || categoryBusy}
                  placeholder="Description"
                />
              </div>
              <div>
                <label class="category-field-label">Sort Order</label>
                <input
                  class="sort-order-input border rounded px-2 py-1 text-sm"
                  .value=${String(draft?.sortOrder ?? '')}
                  @input=${(e) => this._updateCategoryDraft(categoryId, 'sortOrder', e.target.value)}
                  ?disabled=${this.readOnly || categoryBusy}
                  placeholder="0"
                  inputmode="numeric"
                />
              </div>
            </div>
          </div>
          <div class="category-actions">
            ${this.readOnly ? html`` : html`
              <button
                class="px-3 py-1.5 text-xs border rounded bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-60"
                ?disabled=${categoryBusy}
                @click=${() => this._saveCategory(categoryId)}
              >
                Save Category
              </button>
              ${keywords.length === 0 ? html`
                <button
                  class="px-3 py-1.5 text-xs border rounded bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-60"
                  ?disabled=${categoryBusy}
                  @click=${() => this._deleteCategory(categoryId)}
                >
                  Delete Category
                </button>
              ` : html``}
            `}
          </div>
        </div>
        <div class="keyword-section">
          <div class="section-heading">Tags</div>
          <div class="keyword-header">
            <div>
              <div>Tag</div>
              <div class="keyword-header-help">This should be a short, descriptive label. Suggest hyphens instead of spaces.</div>
            </div>
            <div>
              <div>Description / Prompt</div>
              <div class="keyword-header-help">This is used by AI Tagging models to guess categorizations.</div>
            </div>
            <div class="text-right">Actions</div>
          </div>
          ${keywords.map((kw) => {
            const keywordId = String(kw?.id || '');
            const kwDraft = keywordDrafts?.[keywordId] || {};
            const keywordBusy = this._isKeywordBusy(keywordId);
            return html`
              <div class="keyword-row">
                <div class="tag-cell">
                  <span class="tag-arrow" aria-hidden="true">▸</span>
                  <input
                    class="w-full border rounded px-2 py-1 text-sm"
                    .value=${String(kwDraft?.keyword || '')}
                    @input=${(e) => this._updateKeywordDraft(categoryId, keywordId, 'keyword', e.target.value)}
                    ?disabled=${this.readOnly || keywordBusy}
                    placeholder="Tag"
                  />
                </div>
                <input
                  class="w-full border rounded px-2 py-1 text-sm"
                  .value=${String(kwDraft?.prompt || '')}
                  @input=${(e) => this._updateKeywordDraft(categoryId, keywordId, 'prompt', e.target.value)}
                  ?disabled=${this.readOnly || keywordBusy}
                  placeholder="Description / prompt"
                />
                <div class="keyword-actions">
                  ${this.readOnly ? html`` : html`
                    <button
                      class="px-2 py-1 text-xs border rounded bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-60"
                      ?disabled=${keywordBusy}
                      @click=${() => this._saveKeyword(categoryId, keywordId)}
                    >
                      Save
                    </button>
                    <button
                      class="px-2 py-1 text-xs border rounded bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-60"
                      ?disabled=${keywordBusy}
                      @click=${() => this._deleteKeyword(keywordId)}
                    >
                      Delete
                    </button>
                  `}
                </div>
              </div>
            `;
          })}
          ${showKeywordAdder ? html`
            <div class="keyword-row keyword-adder">
              <div class="tag-cell">
                <span class="tag-arrow" aria-hidden="true">▸</span>
                <input
                  class="w-full border rounded px-2 py-1 text-sm"
                  .value=${String(newKeywordDraft?.keyword || '')}
                  @input=${(e) => this._updateNewKeywordDraft(categoryId, 'keyword', e.target.value)}
                  ?disabled=${this.readOnly}
                  placeholder="New tag"
                />
              </div>
              <input
                class="w-full border rounded px-2 py-1 text-sm"
                .value=${String(newKeywordDraft?.prompt || '')}
                @input=${(e) => this._updateNewKeywordDraft(categoryId, 'prompt', e.target.value)}
                ?disabled=${this.readOnly}
                placeholder="Description / prompt"
              />
              <div class="keyword-actions">
                <button
                  class="px-2 py-1 text-xs border rounded bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-60"
                  ?disabled=${this.readOnly || !String(newKeywordDraft?.keyword || '').trim()}
                  @click=${() => this._addKeyword(categoryId)}
                >
                  Add
                </button>
                ${hasNoTags ? html`` : html`
                  <button
                    class="px-2 py-1 text-xs border rounded"
                    @click=${() => this._toggleKeywordAdder(categoryId)}
                  >
                    Cancel
                  </button>
                `}
              </div>
            </div>
          ` : html``}
          ${this.readOnly || hasNoTags || showKeywordAdder ? html`` : html`
            <div class="keyword-footer">
              <button
                class="px-3 py-1.5 text-xs border rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                @click=${() => this._toggleKeywordAdder(categoryId)}
              >
                + Tag
              </button>
            </div>
          `}
        </div>
      </div>
    `;
  }

  render() {
    const rows = this._categoryRows();
    return html`
      <div class="w-full">
        <div class="bg-white rounded-lg border border-gray-200 p-6">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h2 class="text-xl font-semibold text-gray-800">Tagging Setup</h2>
            </div>
          </div>

          <details class="help-panel mb-4">
            <summary>How tags and categories work</summary>
            <ul>
              <li>Tags are one of the most important parts of getting the most out of Zoltag.</li>
              <li>Create multiple sets of tags by creating tag categories.</li>
              <li>You can link tags to companies or people by using category attributes.</li>
              <li>Tag prompts help AI systems automatically suggest relevant tags to get started.</li>
            </ul>
          </details>

          ${this.error ? html`<div class="text-sm text-red-600 mb-3">${this.error}</div>` : html``}
          ${this.loading ? html`<div class="text-sm text-gray-500 mb-3">Loading…</div>` : html``}

          ${this.readOnly ? html`` : html`
            ${this.categoryAdderOpen ? html`
              <div class="toolbar-grid mb-4">
                <input
                  class="w-full border rounded px-3 py-2 text-sm"
                  .value=${String(this.newCategoryDraft?.name || '')}
                  @input=${(e) => this._updateNewCategoryDraft('name', e.target.value)}
                  placeholder="Name"
                />
                <div class="category-adder-actions">
                  <button
                    class="px-3 py-2 border rounded bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-60"
                    ?disabled=${!String(this.newCategoryDraft?.name || '').trim()}
                    @click=${() => this._addCategory()}
                    title="Add category"
                  >
                    Add
                  </button>
                  <button
                    class="px-3 py-2 text-sm border rounded"
                    @click=${() => this._cancelCategoryAdder()}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ` : html`
              <div class="mb-4 flex justify-end">
                <button
                  class="px-3 py-2 border rounded bg-blue-600 text-white text-sm hover:bg-blue-700"
                  @click=${() => this._openCategoryAdder()}
                  title="Add category"
                >
                  + Add Category
                </button>
              </div>
            `}
          `}

          <div class="list-grid">
            ${rows.map((category) => this.renderCategoryRow(category))}
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('tagging-admin2', TaggingAdmin2);
