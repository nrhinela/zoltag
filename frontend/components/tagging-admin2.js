import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import {
  getKeywordCategories,
  getKeywordsInCategory,
  getPeople,
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
      overflow: visible;
    }
    .category-accordion-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      background: #f8fafc;
      border-bottom: 1px solid #e5e7eb;
      cursor: pointer;
      user-select: none;
    }
    .category-accordion-header:hover {
      background: #f1f5f9;
    }
    .category-accordion-title {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      font-size: 14px;
      font-weight: 700;
      color: #1f2937;
    }
    .category-accordion-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 420px;
    }
    .category-caret {
      color: #64748b;
      font-size: 12px;
      line-height: 1;
      transform: rotate(0deg);
      transition: transform 0.15s ease;
    }
    .category-caret.open {
      transform: rotate(90deg);
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
    .keyword-header.people-mode,
    .keyword-row.people-mode {
      grid-template-columns: 1fr 1.5fr 1fr auto;
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
      cursor: pointer;
      user-select: none;
      padding: 0;
    }
    .category-help-wrap {
      position: relative;
      display: inline-flex;
      align-items: center;
    }
    .category-help-popover {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      width: min(360px, 70vw);
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 12px 28px rgba(15, 23, 42, 0.16);
      padding: 10px 12px;
      z-index: 25;
      color: #334155;
    }
    .category-help-title {
      font-size: 12px;
      font-weight: 700;
      color: #334155;
      margin-bottom: 2px;
    }
    .category-help-text {
      font-size: 12px;
      line-height: 1.4;
      color: #475569;
      margin-bottom: 8px;
    }
    .category-help-text:last-child {
      margin-bottom: 0;
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
    @keyframes tagging-skeleton-shimmer {
      0% { background-position: 100% 0; }
      100% { background-position: -100% 0; }
    }
    .skeleton-box {
      background: linear-gradient(90deg, #e5e7eb 25%, #f1f5f9 37%, #e5e7eb 63%);
      background-size: 400% 100%;
      animation: tagging-skeleton-shimmer 1.25s ease-in-out infinite;
      border-radius: 8px;
    }
    .skeleton-toolbar {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      margin-bottom: 14px;
      align-items: center;
    }
    .skeleton-category {
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      overflow: hidden;
    }
    .skeleton-category-top {
      padding: 12px;
      background: #f8fafc;
      border-bottom: 1px solid #e5e7eb;
      display: grid;
      gap: 8px;
    }
    .skeleton-category-tags {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .skeleton-keyword {
      padding: 10px 12px 12px;
      display: grid;
      gap: 8px;
    }
    .skeleton-keyword-row {
      display: grid;
      grid-template-columns: 1fr 2fr auto;
      gap: 8px;
      align-items: center;
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
    peopleRecords: { type: Array },
    busyCategory: { type: Object },
    busyKeyword: { type: Object },
    expandedCategories: { type: Object },
    openCategoryHelpId: { type: String },
    initialLoadComplete: { type: Boolean },
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
    this.peopleRecords = [];
    this.busyCategory = {};
    this.busyKeyword = {};
    this.expandedCategories = new Set();
    this.openCategoryHelpId = '';
    this.initialLoadComplete = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this._handleDocumentClick = () => {
      if (!this.openCategoryHelpId) return;
      this.openCategoryHelpId = '';
    };
    document.addEventListener('click', this._handleDocumentClick);
  }

  disconnectedCallback() {
    document.removeEventListener('click', this._handleDocumentClick);
    super.disconnectedCallback();
  }

  updated(changed) {
    if (changed.has('tenant')) {
      this.expandedCategories = new Set();
      this.initialLoadComplete = false;
      this._loadAll();
    }
  }

  _toggleCategoryExpanded(categoryId) {
    const key = String(categoryId || '');
    if (!key) return;
    const current = this.expandedCategories instanceof Set ? this.expandedCategories : new Set();
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.expandedCategories = next;
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

  _categoryHelpSections() {
    return [
      {
        title: 'People category',
        text: 'Links tags in this category to people or organizations.',
      },
      {
        title: 'Attribution category',
        text: 'Marks tags used for crediting creators, sources, or ownership. Marking this surfaces these tags on exports so photo attribution is straightforward.',
      },
    ];
  }

  _toggleCategoryHelp(categoryId, event) {
    event?.stopPropagation?.();
    const key = String(categoryId || '');
    if (!key) return;
    this.openCategoryHelpId = this.openCategoryHelpId === key ? '' : key;
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

  _extractKeywordPersonId(keyword) {
    const candidates = [keyword?.person_id, keyword?.personId, keyword?.person?.id];
    for (const candidate of candidates) {
      if (candidate === null || candidate === undefined || candidate === '') continue;
      const parsed = Number.parseInt(String(candidate), 10);
      if (Number.isFinite(parsed)) return String(parsed);
    }
    return '';
  }

  _extractKeywordPersonName(keyword) {
    return String(keyword?.person_name ?? keyword?.personName ?? keyword?.person?.name ?? '').trim();
  }

  _findPersonIdByName(name) {
    const target = String(name || '').trim().toLowerCase();
    if (!target) return '';
    const match = (this.peopleRecords || []).find((person) =>
      String(person?.name || '').trim().toLowerCase() === target
    );
    return match?.id === null || match?.id === undefined ? '' : String(match.id);
  }

  _normalizePersonLookupValue(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _findPersonIdByKeywordId(keywordId) {
    const normalizedKeywordId = String(keywordId || '').trim();
    if (!normalizedKeywordId) return '';
    const match = (this.peopleRecords || []).find((person) => {
      const personKeywordId = person?.keyword_id ?? person?.keywordId;
      return String(personKeywordId || '').trim() === normalizedKeywordId;
    });
    return match?.id === null || match?.id === undefined ? '' : String(match.id);
  }

  _findPersonIdByKeywordLabel(keywordLabel) {
    const normalizedKeywordLabel = this._normalizePersonLookupValue(keywordLabel);
    if (!normalizedKeywordLabel) return '';
    const normalizedPeople = (this.peopleRecords || []).map((person) => ({
      id: person?.id,
      normalizedName: this._normalizePersonLookupValue(person?.name),
    })).filter((entry) => entry.normalizedName);

    const exact = normalizedPeople.find((entry) => entry.normalizedName === normalizedKeywordLabel);
    if (exact?.id !== null && exact?.id !== undefined) return String(exact.id);

    const boundaryMatches = normalizedPeople.filter((entry) => {
      const personName = entry.normalizedName;
      return personName.startsWith(`${normalizedKeywordLabel} `)
        || personName.endsWith(` ${normalizedKeywordLabel}`)
        || personName.includes(` ${normalizedKeywordLabel} `)
        || normalizedKeywordLabel.startsWith(`${personName} `)
        || normalizedKeywordLabel.endsWith(` ${personName}`)
        || normalizedKeywordLabel.includes(` ${personName} `);
    });
    if (boundaryMatches.length === 1) {
      const matchId = boundaryMatches[0]?.id;
      if (matchId !== null && matchId !== undefined) return String(matchId);
    }

    return '';
  }

  _resolveKeywordPersonRecordId(keyword, draftValue) {
    const linkedPersonId = this._extractKeywordPersonId(keyword);
    const linkedKeywordId = String(keyword?.id || '').trim();
    const normalizedDraft = draftValue === null || draftValue === undefined ? '' : String(draftValue);
    if (normalizedDraft) {
      if (normalizedDraft !== 'none') return normalizedDraft;
      if (linkedPersonId) return linkedPersonId;
    }
    if (linkedPersonId) return linkedPersonId;
    if (linkedKeywordId) {
      const idByKeywordId = this._findPersonIdByKeywordId(linkedKeywordId);
      if (idByKeywordId) return idByKeywordId;
    }
    const linkedPersonName = this._extractKeywordPersonName(keyword);
    if (linkedPersonName) {
      const idByName = this._findPersonIdByName(linkedPersonName);
      if (idByName) return idByName;
    }
    const idByKeywordLabel = this._findPersonIdByKeywordLabel(keyword?.keyword);
    if (idByKeywordLabel) return idByKeywordLabel;
    return 'none';
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
        personRecordId: this._resolveKeywordPersonRecordId(kw),
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
      const [categories, people] = await Promise.all([
        getKeywordCategories(this.tenant),
        getPeople(this.tenant, { limit: 500 }).catch((error) => {
          console.warn('Failed to load people records for tagging setup:', error);
          return [];
        }),
      ]);
      const safeCategories = Array.isArray(categories) ? categories : [];
      const safePeople = Array.isArray(people) ? people : [];
      this.categories = safeCategories;
      this.peopleRecords = safePeople;
      const validCategoryIds = new Set(
        safeCategories.map((category) => String(category?.id || '')).filter(Boolean)
      );
      const currentExpanded = this.expandedCategories instanceof Set ? this.expandedCategories : new Set();
      this.expandedCategories = new Set(
        [...currentExpanded].filter((categoryId) => validCategoryIds.has(String(categoryId)))
      );
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
      this.initialLoadComplete = true;
    }
  }

  renderSkeleton() {
    const categories = Array.from({ length: 3 });
    const keywordRows = Array.from({ length: 4 });
    return html`
      <div class="w-full">
        <div class="bg-white rounded-lg border border-gray-200 p-6">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h2 class="text-xl font-semibold text-gray-800">Tagging Setup</h2>
            </div>
          </div>
          <div class="skeleton-box" style="height: 68px; margin-bottom: 14px;"></div>
          <div class="skeleton-toolbar">
            <div class="skeleton-box" style="height: 40px;"></div>
            <div class="skeleton-box" style="height: 40px; width: 140px;"></div>
          </div>
          <div class="list-grid">
            ${categories.map(() => html`
              <div class="skeleton-category">
                <div class="skeleton-category-top">
                  <div class="skeleton-box" style="height: 18px; width: 190px;"></div>
                  <div class="skeleton-box" style="height: 36px;"></div>
                  <div class="skeleton-category-tags">
                    <div class="skeleton-box" style="height: 24px; width: 110px;"></div>
                    <div class="skeleton-box" style="height: 24px; width: 130px;"></div>
                    <div class="skeleton-box" style="height: 24px; width: 70px;"></div>
                  </div>
                </div>
                <div class="skeleton-keyword">
                  <div class="skeleton-box" style="height: 16px; width: 110px;"></div>
                  ${keywordRows.map(() => html`
                    <div class="skeleton-keyword-row">
                      <div class="skeleton-box" style="height: 38px;"></div>
                      <div class="skeleton-box" style="height: 38px;"></div>
                      <div class="skeleton-box" style="height: 32px; width: 88px;"></div>
                    </div>
                  `)}
                </div>
              </div>
            `)}
          </div>
        </div>
      </div>
    `;
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
      const savedCategory = await updateKeywordCategory(this.tenant, categoryId, {
        name,
        slug: String(draft.slug || '').trim() || null,
        sort_order: sortOrder,
        is_people_category: Boolean(draft.isPeopleCategory),
        is_attribution: Boolean(draft.isAttribution),
      });
      const normalizedSavedCategory = savedCategory && typeof savedCategory === 'object'
        ? savedCategory
        : {
          id: categoryId,
          name,
          slug: String(draft.slug || '').trim() || null,
          sort_order: sortOrder,
          is_people_category: Boolean(draft.isPeopleCategory),
          is_attribution: Boolean(draft.isAttribution),
        };

      this.categories = (this.categories || []).map((category) =>
        String(category?.id || '') === key
          ? { ...category, ...normalizedSavedCategory }
          : category
      );

      this.categoryDrafts = {
        ...this.categoryDrafts,
        [key]: {
          ...this.categoryDrafts?.[key],
          name: String(normalizedSavedCategory?.name ?? name),
          slug: String(
            (normalizedSavedCategory?.slug ?? String(draft.slug || '').trim()) || ''
          ),
          sortOrder: normalizedSavedCategory?.sort_order === null || normalizedSavedCategory?.sort_order === undefined
            ? ''
            : String(normalizedSavedCategory.sort_order),
          isPeopleCategory: Boolean(
            normalizedSavedCategory?.is_people_category ?? draft.isPeopleCategory
          ),
          isAttribution: Boolean(
            normalizedSavedCategory?.is_attribution ?? draft.isAttribution
          ),
        },
      };
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
        [key]: { keyword: '', prompt: '', personRecordId: 'none' },
      };
    }
  }

  _updateNewKeywordDraft(categoryId, field, value) {
    const key = String(categoryId);
    const current = this.newKeywordDrafts?.[key] || { keyword: '', prompt: '', personRecordId: 'none' };
    this.newKeywordDrafts = {
      ...this.newKeywordDrafts,
      [key]: { ...current, [field]: value },
    };
  }

  _isPeopleCategory(categoryId) {
    const key = String(categoryId);
    const draft = this.categoryDrafts?.[key];
    if (draft && typeof draft.isPeopleCategory === 'boolean') {
      return Boolean(draft.isPeopleCategory);
    }
    const category = (this.categories || []).find((entry) => String(entry?.id || '') === key);
    return Boolean(category?.is_people_category);
  }

  async _addKeyword(categoryId) {
    if (this.readOnly) return;
    const key = String(categoryId);
    const draft = this.newKeywordDrafts?.[key] || {};
    const keyword = String(draft.keyword || '').trim();
    if (!keyword) return;
    const isPeopleCategory = this._isPeopleCategory(categoryId);
    const selectedPersonRecord = String(draft.personRecordId || 'none');
    const personId = Number.parseInt(selectedPersonRecord, 10);
    try {
      const payload = {
        keyword,
        prompt: String(draft.prompt || '').trim() || '',
      };
      if (isPeopleCategory) {
        if (selectedPersonRecord === 'new') {
          payload.person = { name: keyword };
        } else if (selectedPersonRecord === 'none') {
          payload.person = null;
        } else if (Number.isFinite(personId)) {
          payload.person = { id: personId };
        } else {
          payload.person = null;
        }
      }
      await createKeyword(this.tenant, categoryId, payload);
      this.newKeywordDrafts = {
        ...this.newKeywordDrafts,
        [key]: { keyword: '', prompt: '', personRecordId: 'none' },
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
    const keywordRow = (this.keywordsByCategory?.[categoryKey] || []).find(
      (entry) => String(entry?.id || '') === keywordKey
    );
    const keyword = String(draft.keyword || '').trim();
    if (!keyword) return;
    const isPeopleCategory = this._isPeopleCategory(categoryId);
    const selectedPersonRecord = this._resolveKeywordPersonRecordId(keywordRow, draft.personRecordId);
    const personId = Number.parseInt(selectedPersonRecord, 10);
    this._setKeywordBusy(keywordId, true);
    try {
      const payload = {
        keyword,
        prompt: String(draft.prompt || '').trim() || '',
      };
      if (isPeopleCategory) {
        if (selectedPersonRecord === 'new') {
          payload.person = { name: keyword };
        } else if (selectedPersonRecord === 'none') {
          payload.person = null;
        } else if (Number.isFinite(personId)) {
          payload.person = { id: personId };
        } else {
          payload.person = null;
        }
      }
      const savedKeyword = await updateKeyword(this.tenant, keywordId, payload);
      const normalizedSavedKeyword = savedKeyword && typeof savedKeyword === 'object'
        ? savedKeyword
        : {
          ...keywordRow,
          keyword,
          prompt: String(draft.prompt || '').trim() || '',
        };

      const currentKeywords = Array.isArray(this.keywordsByCategory?.[categoryKey])
        ? this.keywordsByCategory[categoryKey]
        : [];
      const nextKeywords = currentKeywords.map((entry) =>
        String(entry?.id || '') === keywordKey ? { ...entry, ...normalizedSavedKeyword } : entry
      );
      this.keywordsByCategory = {
        ...this.keywordsByCategory,
        [categoryKey]: nextKeywords,
      };

      const savedPersonId = this._extractKeywordPersonId(normalizedSavedKeyword);
      if (savedPersonId) {
        const personName = this._extractKeywordPersonName(normalizedSavedKeyword) || `Person #${savedPersonId}`;
        const existingPeople = Array.isArray(this.peopleRecords) ? this.peopleRecords : [];
        const existingIndex = existingPeople.findIndex(
          (person) => String(person?.id || '') === savedPersonId
        );
        if (existingIndex >= 0) {
          const existing = existingPeople[existingIndex] || {};
          const merged = {
            ...existing,
            id: existing.id ?? Number.parseInt(savedPersonId, 10),
            name: personName || existing.name,
          };
          const nextPeople = [...existingPeople];
          nextPeople[existingIndex] = merged;
          this.peopleRecords = nextPeople;
        } else {
          this.peopleRecords = [
            ...existingPeople,
            {
              id: Number.parseInt(savedPersonId, 10),
              name: personName,
              keyword_id: normalizedSavedKeyword?.id ?? Number.parseInt(keywordKey, 10),
            },
          ];
        }
      }

      const nextPersonRecordId = this._resolveKeywordPersonRecordId(
        normalizedSavedKeyword,
        savedPersonId || 'none'
      );
      const currentCategoryDrafts = this.keywordDrafts?.[categoryKey] || {};
      this.keywordDrafts = {
        ...this.keywordDrafts,
        [categoryKey]: {
          ...currentCategoryDrafts,
          [keywordKey]: {
            keyword: String(normalizedSavedKeyword?.keyword || keyword),
            prompt: String(normalizedSavedKeyword?.prompt || ''),
            personRecordId: nextPersonRecordId,
          },
        },
      };
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
    const keywords = Array.isArray(this.keywordsByCategory?.[categoryId])
      ? [...this.keywordsByCategory[categoryId]].sort((a, b) =>
        String(a?.keyword || '').localeCompare(String(b?.keyword || ''), undefined, { sensitivity: 'base' })
      )
      : [];
    const isPeopleCategory = Boolean(draft?.isPeopleCategory);
    const hasNoTags = keywords.length === 0;
    const keywordDrafts = this.keywordDrafts?.[categoryId] || {};
    const newKeywordDraft = this.newKeywordDrafts?.[categoryId] || { keyword: '', prompt: '', personRecordId: 'none' };
    const showKeywordAdder = hasNoTags ? true : Boolean(this.keywordAdderOpen?.[categoryId]);
    const categoryBusy = this._isCategoryBusy(categoryId);
    const isExpanded = this.expandedCategories instanceof Set && this.expandedCategories.has(categoryId);
    const isCategoryHelpOpen = this.openCategoryHelpId === categoryId;
    const peopleRecords = [...(this.peopleRecords || [])].sort((a, b) =>
      String(a?.name || '').localeCompare(String(b?.name || ''), undefined, { sensitivity: 'base' })
    );
    const peopleRecordIds = new Set(peopleRecords.map((person) => String(person?.id || '')).filter(Boolean));

    return html`
      <div class="category-group">
        <div
          class="category-accordion-header"
          role="button"
          tabindex="0"
          @click=${() => this._toggleCategoryExpanded(categoryId)}
          @keydown=${(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              this._toggleCategoryExpanded(categoryId);
            }
          }}
        >
          <div class="category-accordion-title">
            <span class="category-caret ${isExpanded ? 'open' : ''}" aria-hidden="true">▸</span>
            <span class="category-accordion-name">${categoryHeadingName}</span>
            <span class="pill">${keywords.length} Tags</span>
          </div>
        </div>
        ${isExpanded ? html`
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
                    <span class="category-help-wrap">
                      <button
                        type="button"
                        class="help-trigger"
                        aria-label="Category help"
                        aria-expanded=${isCategoryHelpOpen ? 'true' : 'false'}
                        @click=${(e) => this._toggleCategoryHelp(categoryId, e)}
                      >
                        ?
                      </button>
                      ${isCategoryHelpOpen ? html`
                        <div class="category-help-popover" role="dialog" aria-label="Category help details">
                          ${this._categoryHelpSections().map((section) => html`
                            <div class="category-help-title">${section.title}</div>
                            <div class="category-help-text">${section.text}</div>
                          `)}
                        </div>
                      ` : html``}
                    </span>
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
            <div class="keyword-header ${isPeopleCategory ? 'people-mode' : ''}">
              <div>
                <div>Tag</div>
                <div class="keyword-header-help">This should be a short, descriptive label. Suggest hyphens instead of spaces.</div>
              </div>
              <div>
                <div>Description / Prompt</div>
                <div class="keyword-header-help">This is used by AI Tagging models to guess categorizations.</div>
              </div>
              ${isPeopleCategory ? html`<div>Person Record</div>` : html``}
              <div class="text-right">Actions</div>
            </div>
            ${keywords.map((kw) => {
              const keywordId = String(kw?.id || '');
              const kwDraft = keywordDrafts?.[keywordId] || {};
              const selectedPersonRecordId = this._resolveKeywordPersonRecordId(kw, kwDraft?.personRecordId);
              const hasSelectedPersonOption = selectedPersonRecordId === 'none' || selectedPersonRecordId === 'new' || peopleRecordIds.has(selectedPersonRecordId);
              const keywordBusy = this._isKeywordBusy(keywordId);
              return html`
                <div class="keyword-row ${isPeopleCategory ? 'people-mode' : ''}">
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
                  ${isPeopleCategory ? html`
                    <select
                      class="w-full border rounded px-2 py-1 text-sm"
                      @change=${(e) => this._updateKeywordDraft(categoryId, keywordId, 'personRecordId', e.target.value)}
                      ?disabled=${this.readOnly || keywordBusy}
                    >
                      <option value="none" ?selected=${selectedPersonRecordId === 'none'}>None</option>
                      <option value="new" ?selected=${selectedPersonRecordId === 'new'}>New Record</option>
                      ${hasSelectedPersonOption ? html`` : html`
                        <option value=${selectedPersonRecordId} selected>${kw?.person_name || `Linked #${selectedPersonRecordId}`}</option>
                      `}
                      ${peopleRecords.map((person) => html`
                        <option
                          value=${String(person?.id || '')}
                          ?selected=${String(person?.id || '') === selectedPersonRecordId}
                        >
                          ${person?.name || `Person #${person?.id}`}
                        </option>
                      `)}
                    </select>
                  ` : html``}
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
              <div class="keyword-row keyword-adder ${isPeopleCategory ? 'people-mode' : ''}">
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
                ${isPeopleCategory ? html`
                  <select
                    class="w-full border rounded px-2 py-1 text-sm"
                    .value=${String(newKeywordDraft?.personRecordId ?? 'none')}
                    @change=${(e) => this._updateNewKeywordDraft(categoryId, 'personRecordId', e.target.value)}
                    ?disabled=${this.readOnly}
                  >
                    <option value="none" ?selected=${String(newKeywordDraft?.personRecordId ?? 'none') === 'none'}>None</option>
                    <option value="new" ?selected=${String(newKeywordDraft?.personRecordId ?? 'none') === 'new'}>New Record</option>
                    ${peopleRecords.map((person) => html`
                      <option
                        value=${String(person?.id || '')}
                        ?selected=${String(person?.id || '') === String(newKeywordDraft?.personRecordId ?? 'none')}
                      >
                        ${person?.name || `Person #${person?.id}`}
                      </option>
                    `)}
                  </select>
                ` : html``}
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
        ` : html``}
      </div>
    `;
  }

  render() {
    if (!this.initialLoadComplete) {
      return this.renderSkeleton();
    }

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
