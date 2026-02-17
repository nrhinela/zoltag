import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import './admin-tabs.js';
import {
  getLists,
  createList,
  updateList,
  deleteList,
  getListItems,
  deleteListItem,
  fetchWithAuth,
  listAssetVariants,
  getAssetVariantContent,
} from '../services/api.js';
import { renderImageGrid } from './shared/image-grid.js';
import { allowByPermissionOrRole } from './shared/tenant-permissions.js';

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
    .list-items-grid {
      --curate-thumb-size: 160px;
    }
    .list-items-grid .curate-grid {
      gap: 12px;
    }
    .list-items-grid .curate-thumb-tile {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .list-items-grid .curate-thumb-footer {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .list-items-grid .curate-thumb {
      cursor: pointer;
    }
    .list-item-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
  `];

  static properties = {
    tenant: { type: String },
    currentUser: { type: Object },
    lists: { type: Array },
    editingList: { type: Object },
    selectedList: { type: Object },
    listItems: { type: Array },
    editingSelectedList: { type: Boolean },
    isDownloading: { type: Boolean },
    downloadIncludeVariants: { type: Boolean },
    isLoadingItems: { type: Boolean },
    isLoadingLists: { type: Boolean },
    listSortKey: { type: String },
    listSortDir: { type: String },
    listVisibilityScope: { type: String },
    initialSelectedListId: { type: [String, Number] },
    initialSelectedListToken: { type: Number },
    thumbSize: { type: Number },
    renderCurateRatingWidget: { type: Object },
    renderCurateRatingStatic: { type: Object },
    renderCuratePermatagSummary: { type: Object },
    formatCurateDate: { type: Object },
  };

  constructor() {
    super();
    this.currentUser = null;
    this.lists = [];
    this.editingList = null;
    this.selectedList = null;
    this.listItems = [];
    this.editingSelectedList = false;
    this.isDownloading = false;
    this.downloadIncludeVariants = true;
    this.isLoadingItems = false;
    this.isLoadingLists = false;
    this.listSortKey = 'title';
    this.listSortDir = 'asc';
    this.listVisibilityScope = 'default';
    this.initialSelectedListId = null;
    this.initialSelectedListToken = 0;
    this.thumbSize = 190;
    this.renderCurateRatingWidget = null;
    this.renderCurateRatingStatic = null;
    this.renderCuratePermatagSummary = null;
    this.formatCurateDate = null;
    this._isVisible = false;
    this._hasRefreshedOnce = false;
    this._lastInitialSelectionKey = '';
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
      this.listVisibilityScope = 'default';
      this.fetchLists();
      this.selectedList = null;
      this.listItems = [];
    }
    if (
      changedProperties.has('initialSelectedListId')
      || changedProperties.has('initialSelectedListToken')
      || changedProperties.has('lists')
    ) {
      this._applyInitialListSelection();
    }
  }

  async _applyInitialListSelection() {
    if (!this.initialSelectedListId) return;
    const selectionKey = `${this.tenant || ''}:${this.initialSelectedListToken}:${this.initialSelectedListId}`;
    if (this._lastInitialSelectionKey === selectionKey) return;

    const list = (this.lists || []).find(
      (entry) => String(entry.id) === String(this.initialSelectedListId)
    );
    if (!list) return;

    this._lastInitialSelectionKey = selectionKey;
    await this._selectList(list);
    this.dispatchEvent(new CustomEvent('initial-list-selection-applied', {
      detail: { listId: list.id },
      bubbles: true,
      composed: true,
    }));
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

  _isTenantAdmin() {
    return allowByPermissionOrRole(
      this.currentUser,
      this.tenant,
      'tenant.settings.manage',
      ['admin'],
    );
  }

  _getListVisibilityTabs() {
    const tabs = [
      { id: 'default', label: 'Default' },
      { id: 'private', label: 'Private' },
    ];
    if (this._isTenantAdmin()) {
      tabs.push({ id: 'all', label: 'All' });
    }
    return tabs;
  }

  _getActiveVisibilityScope() {
    const tabs = this._getListVisibilityTabs();
    const current = String(this.listVisibilityScope || '').trim().toLowerCase();
    if (tabs.some((tab) => tab.id === current)) {
      return current;
    }
    return tabs[0]?.id || 'default';
  }

  async _handleVisibilityTabChanged(event) {
    const tabId = String(event?.detail?.tabId || '').trim().toLowerCase();
    const tabs = this._getListVisibilityTabs();
    if (!tabs.some((tab) => tab.id === tabId)) {
      return;
    }
    if (tabId === this.listVisibilityScope) {
      return;
    }
    this.listVisibilityScope = tabId;
    this._closeListView();
    await this.fetchLists({ force: true });
  }

  async fetchLists({ force = false } = {}) {
    if (!this.tenant) {
      console.warn('fetchLists: Tenant ID is not available.');
      return;
    }
    this.isLoadingLists = true;
    try {
      const activeVisibilityScope = this._getActiveVisibilityScope();
      if (activeVisibilityScope !== this.listVisibilityScope) {
        this.listVisibilityScope = activeVisibilityScope;
      }
      const fetchedLists = await getLists(this.tenant, {
        force,
        visibilityScope: activeVisibilityScope,
      });
      this.lists = fetchedLists;
      if (this.selectedList) {
        const refreshedSelectedList = fetchedLists.find(
          (entry) => String(entry?.id) === String(this.selectedList?.id)
        );
        if (refreshedSelectedList) {
          this.selectedList = refreshedSelectedList;
        } else {
          this._closeListView();
        }
      }
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

  _closeListView() {
    this.selectedList = null;
    this.listItems = [];
    this.editingSelectedList = false;
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

  _handleListItemImageSelected(event, image) {
    event.stopPropagation();
    const selectedImage = event?.detail?.image || image;
    if (!selectedImage) return;
    const imageSet = (this.listItems || [])
      .map((item) => item?.image)
      .filter(Boolean);
    this.dispatchEvent(new CustomEvent('image-selected', {
      detail: { image: selectedImage, imageSet },
      bubbles: true,
      composed: true,
    }));
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
        this.editingSelectedList = false;
      }
      this.requestUpdate();
      this.dispatchEvent(new CustomEvent('lists-updated', { bubbles: true, composed: true }));
    } catch (error) {
      console.error('Error deleting list:', error);
    }
  }

  _startEditingSelectedList() {
    if (!this.selectedList?.can_edit) {
      return;
    }
    this.editingSelectedList = true;
  }

  _cancelEditingSelectedList() {
    this.editingSelectedList = false;
  }

  async _saveSelectedListChanges() {
    if (!this.selectedList?.can_edit) {
      this.editingSelectedList = false;
      return;
    }
    const title = this.querySelector('#edit-list-title')?.value.trim();
    const notebox = this.querySelector('#edit-list-notes')?.value;
    const visibility = this.querySelector('#edit-list-visibility')?.value || this.selectedList.visibility || 'shared';

    if (!title) {
      console.warn('List title cannot be empty');
      return;
    }

    try {
      const updated = await updateList(this.tenant, {
        id: this.selectedList.id,
        title,
        notebox,
        visibility,
      });
      this.selectedList = updated;
      this.editingSelectedList = false;
      await this.fetchLists({ force: true });
      this.dispatchEvent(new CustomEvent('lists-updated', { bubbles: true, composed: true }));
    } catch (error) {
      console.error('Error saving list changes:', error);
    }
  }

  async _ensureDownloadLibraries() {
    if (!window.JSZip) {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/jszip@3/dist/jszip.min.js';
      await new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    if (!window.jspdf) {
      const pdfScript = document.createElement('script');
      pdfScript.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
      await new Promise((resolve, reject) => {
        pdfScript.onload = resolve;
        pdfScript.onerror = reject;
        document.head.appendChild(pdfScript);
      });
    }
  }

  _normalizeFilename(value, fallback) {
    const trimmed = String(value || '').trim();
    const safe = trimmed.replace(/[\\/:*?"<>|]+/g, '_');
    return safe || fallback;
  }

  _sanitizeFolderSegment(value, fallback = 'item') {
    const trimmed = String(value || '').trim();
    const safe = trimmed
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_');
    return safe || fallback;
  }

  _splitFilename(name) {
    const normalized = this._normalizeFilename(name, 'file');
    const dotIndex = normalized.lastIndexOf('.');
    if (dotIndex <= 0 || dotIndex === normalized.length - 1) {
      return { stem: normalized, ext: '' };
    }
    return {
      stem: normalized.slice(0, dotIndex),
      ext: normalized.slice(dotIndex),
    };
  }

  _ensureUniqueZipPath(path, usedPaths) {
    if (!usedPaths.has(path)) {
      usedPaths.add(path);
      return path;
    }
    const slash = path.lastIndexOf('/');
    const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
    const filename = slash >= 0 ? path.slice(slash + 1) : path;
    const { stem, ext } = this._splitFilename(filename);
    let index = 2;
    while (true) {
      const nextPath = `${dir}${stem} (${index})${ext}`;
      if (!usedPaths.has(nextPath)) {
        usedPaths.add(nextPath);
        return nextPath;
      }
      index += 1;
    }
  }

  _getImageSourceUrl(image) {
    const sourcePath = image?.source_key || image?.dropbox_path || '';
    const sourceProvider = String(image?.source_provider || '').trim().toLowerCase();
    const sourceUrlFromApi = String(image?.source_url || '').trim();
    if (sourceUrlFromApi) {
      return sourceUrlFromApi;
    }
    if (sourcePath && sourceProvider === 'dropbox') {
      const encodedPath = sourcePath.split('/').map((part) => encodeURIComponent(part)).join('/');
      return `https://www.dropbox.com/home${encodedPath}`;
    }
    return `${window.location.origin}/api/v1/images/${image.id}/full`;
  }

  async _blobToDataUrl(blob) {
    if (!blob) return '';
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to convert blob to data URL'));
      reader.readAsDataURL(blob);
    });
  }

  _detectPdfImageType(dataUrl) {
    const prefix = String(dataUrl || '').toLowerCase();
    if (prefix.startsWith('data:image/png')) return 'PNG';
    if (prefix.startsWith('data:image/webp')) return 'WEBP';
    return 'JPEG';
  }

  _drawPdfThumbnail(doc, dataUrl, x, y, width, height) {
    if (!dataUrl) {
      doc.setDrawColor(209, 213, 219);
      doc.rect(x, y, width, height);
      doc.setTextColor(156, 163, 175);
      doc.setFontSize(7);
      doc.text('No preview', x + 2, y + height / 2);
      return;
    }
    try {
      doc.addImage(dataUrl, this._detectPdfImageType(dataUrl), x, y, width, height);
    } catch (_error) {
      doc.setDrawColor(209, 213, 219);
      doc.rect(x, y, width, height);
      doc.setTextColor(156, 163, 175);
      doc.setFontSize(7);
      doc.text('Preview error', x + 2, y + height / 2);
    }
  }

  _drawWrappedPdfLink(doc, url, x, y, maxWidth, lineHeight = 4) {
    const linkText = String(url || '').trim();
    if (!linkText) {
      doc.setTextColor(107, 114, 128);
      doc.text('Unavailable', x, y);
      return 1;
    }

    const lines = doc.splitTextToSize(linkText, maxWidth);
    doc.text(lines, x, y);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const baselineY = y + index * lineHeight;
      const lineWidth = Math.min(doc.getTextWidth(line), maxWidth);
      doc.link(x, baselineY - (lineHeight - 0.6), Math.max(lineWidth, 1), lineHeight, { url: linkText });
    }
    return Math.max(1, lines.length);
  }

  _collectAttributionTags(image) {
    const permatags = Array.isArray(image?.permatags) ? image.permatags : [];
    const seen = new Set();
    const tags = [];
    for (const permatag of permatags) {
      if (Number(permatag?.signum) !== 1) continue;
      const category = String(permatag?.category || '').trim().toLowerCase();
      if (!category.includes('attribution')) continue;
      const keyword = String(permatag?.keyword || '').trim();
      if (!keyword) continue;
      const key = keyword.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(keyword);
    }
    return tags;
  }

  _formatAttributionLine(attributionTags) {
    const values = (Array.isArray(attributionTags) ? attributionTags : [])
      .map((tag) => {
        if (typeof tag === 'string') {
          return tag.trim();
        }
        const keyword = String(tag?.keyword || '').trim();
        const instagramUrl = String(tag?.instagram_url || '').trim();
        if (keyword && instagramUrl) {
          return `${keyword} (${instagramUrl})`;
        }
        return keyword || instagramUrl;
      })
      .filter(Boolean);
    if (!values.length) return '';
    return `Attribution: ${values.join(', ')}`;
  }

  async _loadPeopleInstagramMap() {
    const map = new Map();
    if (!this.tenant) {
      return map;
    }

    const pageSize = 500;
    let skip = 0;
    while (true) {
      const people = await fetchWithAuth(`/people?skip=${skip}&limit=${pageSize}`, {
        tenantId: this.tenant,
      });
      if (!Array.isArray(people) || people.length === 0) {
        break;
      }
      for (const person of people) {
        const name = String(person?.name || '').trim().toLowerCase();
        const instagramUrl = String(person?.instagram_url || '').trim();
        if (!name || !instagramUrl || map.has(name)) continue;
        map.set(name, instagramUrl);
      }
      if (people.length < pageSize) {
        break;
      }
      skip += people.length;
    }

    return map;
  }

  _attachAttributionInstagramUrls(attributionTags, peopleInstagramByName) {
    const seen = new Set();
    const tags = [];
    for (const tag of (Array.isArray(attributionTags) ? attributionTags : [])) {
      const keyword = String(tag || '').trim();
      if (!keyword) continue;
      const key = keyword.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push({
        keyword,
        instagram_url: peopleInstagramByName.get(key) || null,
      });
    }
    return tags;
  }

  _estimateReadmeEntryHeight(doc, entry, textWidth) {
    const lineHeight = 4;
    let height = 6;
    const filenameLines = doc.splitTextToSize(entry.filename || 'Untitled', textWidth);
    height += filenameLines.length * lineHeight + 2;
    const sourceLines = doc.splitTextToSize(entry.sourceUrl || '', textWidth);
    height += Math.max(1, sourceLines.length) * lineHeight + 3;
    height += lineHeight;
    if (entry.attributionTags?.length) {
      const attributionText = this._formatAttributionLine(entry.attributionTags);
      const attributionLines = doc.splitTextToSize(attributionText, textWidth);
      height += Math.max(1, attributionLines.length) * lineHeight + 2;
    }
    if (entry.variants?.length) {
      for (const variant of entry.variants) {
        const variantNameLines = doc.splitTextToSize(variant.filename || 'variant', textWidth - 12);
        const variantUrlLines = doc.splitTextToSize(variant.url || '', textWidth - 12);
        const textBlock = (variantNameLines.length + variantUrlLines.length) * lineHeight + 2;
        height += Math.max(12, textBlock) + 2;
      }
    }
    return Math.max(30, height);
  }

  _renderReadmePdf(entries) {
    const jsPDF = window.jspdf.jsPDF;
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 12;
    const contentWidth = pageWidth - margin * 2;
    const thumbWidth = 24;
    const variantThumb = 9;
    const textStart = margin + thumbWidth + 5;
    const textWidth = contentWidth - thumbWidth - 8;
    let y = 15;

    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text(this.selectedList?.title || 'List Export', margin, y);
    y += 7;

    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.text(`Author: ${this.selectedList?.created_by_name || 'Unknown'}`, margin, y);
    y += 4.5;
    doc.text(`Created: ${new Date(this.selectedList?.created_at || Date.now()).toLocaleString()}`, margin, y);
    y += 4.5;
    doc.text(`Items: ${entries.length}`, margin, y);
    y += 4.5;
    doc.text(`Include variants in ZIP: ${this.downloadIncludeVariants ? 'Yes' : 'No'}`, margin, y);
    y += 6;

    if (this.selectedList?.notebox) {
      doc.setFont(undefined, 'bold');
      doc.text('Notes', margin, y);
      y += 4;
      doc.setFont(undefined, 'normal');
      const notesLines = doc.splitTextToSize(this.selectedList.notebox, contentWidth);
      doc.text(notesLines, margin, y);
      y += notesLines.length * 4 + 4;
    }

    for (const entry of entries) {
      const rowHeight = this._estimateReadmeEntryHeight(doc, entry, textWidth);
      if (y + rowHeight > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }

      doc.setDrawColor(209, 213, 219);
      doc.rect(margin, y, contentWidth, rowHeight);

      this._drawPdfThumbnail(doc, entry.thumbnailDataUrl, margin + 2, y + 2, thumbWidth - 4, thumbWidth - 4);

      let textY = y + 4;
      doc.setFontSize(10);
      doc.setFont(undefined, 'bold');
      const filenameLines = doc.splitTextToSize(entry.filename || 'Untitled', textWidth);
      doc.text(filenameLines, textStart, textY);
      textY += filenameLines.length * 4 + 1;

      doc.setFontSize(8);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(75, 85, 99);
      doc.text(`Image ID: #${entry.imageId}`, textStart, textY);
      textY += 4;

      if (entry.attributionTags?.length) {
        doc.setFont(undefined, 'normal');
        doc.setFontSize(8);
        doc.setTextColor(75, 85, 99);
        const attributionText = this._formatAttributionLine(entry.attributionTags);
        const attributionLines = doc.splitTextToSize(
          attributionText,
          textWidth,
        );
        doc.text(attributionLines, textStart, textY);
        textY += attributionLines.length * 4 + 1.5;
      }

      doc.text('URL:', textStart, textY);
      textY += 3.5;
      doc.setTextColor(29, 78, 216);
      const sourceLineCount = this._drawWrappedPdfLink(doc, entry.sourceUrl || '', textStart, textY, textWidth, 4);
      textY += sourceLineCount * 4 + 2;
      doc.setTextColor(17, 24, 39);

      if (entry.variants.length) {
        doc.setFont(undefined, 'bold');
        doc.text(`Variants (${entry.variants.length})`, textStart, textY);
        textY += 4;
        doc.setFont(undefined, 'normal');
        doc.setFontSize(8);

        for (const variant of entry.variants) {
          this._drawPdfThumbnail(doc, variant.thumbnailDataUrl, textStart, textY - 1.5, variantThumb, variantThumb);
          const variantTextX = textStart + variantThumb + 3;
          const variantTextWidth = textWidth - variantThumb - 3;

          doc.setFont(undefined, 'bold');
          doc.setTextColor(17, 24, 39);
          const variantNameLines = doc.splitTextToSize(variant.filename || 'variant', variantTextWidth);
          doc.text(variantNameLines, variantTextX, textY + 1.5);
          let variantY = textY + variantNameLines.length * 3.8 + 1;

          doc.setFont(undefined, 'normal');
          doc.setTextColor(29, 78, 216);
          const variantUrlLineCount = this._drawWrappedPdfLink(
            doc,
            variant.url || '',
            variantTextX,
            variantY,
            variantTextWidth,
            3.8,
          );
          variantY += variantUrlLineCount * 3.8;

          textY = Math.max(textY + variantThumb + 1, variantY + 1);
        }
      }

      y += rowHeight + 3;
      doc.setTextColor(17, 24, 39);
    }

    return doc.output('blob');
  }

  async _downloadListImages() {
    if (!this.listItems || this.listItems.length === 0) {
      alert('No items to download');
      return;
    }

    this.isDownloading = true;

    try {
      await this._ensureDownloadLibraries();

      const zip = new window.JSZip();
      const usedZipPaths = new Set();
      const readmeEntries = [];
      let peopleInstagramByName = new Map();
      try {
        peopleInstagramByName = await this._loadPeopleInstagramMap();
      } catch (error) {
        console.error('Failed to load people Instagram URLs for README attribution export:', error);
      }

      // Download each image and add to zip
      for (const item of this.listItems) {
        const image = item?.image;
        if (!image?.id) continue;
        const imageId = Number(image.id);
        const fallbackFilename = `image_${imageId}.jpg`;
        const filename = this._normalizeFilename(image.filename, fallbackFilename);
        const sourceUrl = this._getImageSourceUrl(image);
        const attributionTags = this._attachAttributionInstagramUrls(
          this._collectAttributionTags(image),
          peopleInstagramByName,
        );
        const variantsData = [];
        const parentStem = this._splitFilename(filename).stem;
        const variantFolder = `${this._sanitizeFolderSegment(parentStem, `image_${imageId}`)}_${imageId}__variants`;

        // Fetch variants so README can include them regardless of zip option.
        let variants = [];
        try {
          const variantPayload = await listAssetVariants(this.tenant, imageId);
          variants = Array.isArray(variantPayload?.variants) ? variantPayload.variants : [];
        } catch (error) {
          console.error(`Error loading variants for image ${imageId}:`, error);
        }

        try {
          const originalBlob = await fetchWithAuth(`/images/${imageId}/full`, {
            tenantId: this.tenant,
            responseType: 'blob',
          });
          const originalZipPath = this._ensureUniqueZipPath(filename, usedZipPaths);
          zip.file(originalZipPath, originalBlob);
        } catch (error) {
          console.error(`Error downloading ${filename}:`, error);
        }

        let thumbnailDataUrl = '';
        try {
          const thumbBlob = await fetchWithAuth(`/images/${imageId}/thumbnail`, {
            tenantId: this.tenant,
            responseType: 'blob',
          });
          thumbnailDataUrl = await this._blobToDataUrl(thumbBlob);
        } catch (_error) {
          thumbnailDataUrl = '';
        }

        for (const variant of variants) {
          const variantId = String(variant?.id || '').trim();
          if (!variantId) continue;
          const variantFilename = this._normalizeFilename(
            variant.filename,
            `variant_${variantId}`
          );
          const variantUrl = variant.public_url
            || `${window.location.origin}${variant.content_url || `/api/v1/images/${imageId}/asset-variants/${variantId}/content`}`;

          let variantBlob = null;
          let variantThumbDataUrl = '';
          try {
            variantBlob = await getAssetVariantContent(this.tenant, imageId, variantId);
            variantThumbDataUrl = await this._blobToDataUrl(variantBlob);
          } catch (error) {
            console.error(`Error fetching variant ${variantId} for image ${imageId}:`, error);
          }

          if (this.downloadIncludeVariants && variantBlob) {
            const variantZipPath = this._ensureUniqueZipPath(
              `${variantFolder}/${variantFilename}`,
              usedZipPaths
            );
            zip.file(variantZipPath, variantBlob);
          }

          variantsData.push({
            id: variantId,
            filename: variantFilename,
            url: variantUrl,
            thumbnailDataUrl: variantThumbDataUrl,
          });
        }

        readmeEntries.push({
          imageId,
          filename,
          sourceUrl,
          attributionTags,
          thumbnailDataUrl,
          variants: variantsData,
        });
      }

      const readmeBlob = this._renderReadmePdf(readmeEntries);
      zip.file('README.pdf', readmeBlob);

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

  _handleListSort(key) {
    if (!key) return;
    if (this.listSortKey === key) {
      this.listSortDir = this.listSortDir === 'asc' ? 'desc' : 'asc';
      return;
    }
    this.listSortKey = key;
    this.listSortDir = 'asc';
  }

  _getSortedLists() {
    const lists = Array.isArray(this.lists) ? [...this.lists] : [];
    const key = this.listSortKey || 'title';
    const dir = this.listSortDir === 'desc' ? -1 : 1;
    const normalize = (value) => {
      if (value === null || value === undefined) return '';
      return String(value).toLowerCase();
    };
    lists.sort((a, b) => {
      let left = '';
      let right = '';
      if (key === 'id') {
        left = Number(a.id) || 0;
        right = Number(b.id) || 0;
      } else if (key === 'item_count') {
        left = Number(a.item_count) || 0;
        right = Number(b.item_count) || 0;
      } else if (key === 'created_at') {
        left = new Date(a.created_at).getTime() || 0;
        right = new Date(b.created_at).getTime() || 0;
      } else if (key === 'title') {
        left = normalize(a.title);
        right = normalize(b.title);
      } else if (key === 'created_by_name') {
        left = normalize(a.created_by_name);
        right = normalize(b.created_by_name);
      } else if (key === 'notebox') {
        left = normalize(a.notebox);
        right = normalize(b.notebox);
      } else if (key === 'visibility') {
        left = normalize(a.visibility);
        right = normalize(b.visibility);
      }
      if (left < right) return -1 * dir;
      if (left > right) return 1 * dir;
      return 0;
    });
    return lists;
  }

  _renderSortLabel(label, key) {
    const isActive = this.listSortKey === key;
    const arrow = isActive ? (this.listSortDir === 'asc' ? '↑' : '↓') : '';
    return html`${label} ${arrow}`;
  }

  _handleThumbSizeChange(event) {
    const nextSize = Number(event.target.value);
    if (!Number.isFinite(nextSize)) return;
    this.thumbSize = nextSize;
  }

  render() {
    // Check visibility on each render to detect when tab becomes active
    this._checkVisibility();
    const sortedLists = this._getSortedLists();
    const visibilityTabs = this._getListVisibilityTabs();
    const selectedVisibilityScope = this._getActiveVisibilityScope();
    const selectedVisibilityLabel = selectedVisibilityScope === 'private'
      ? 'Private'
      : (selectedVisibilityScope === 'all' ? 'All' : 'Default');
    const selectedVisibilityDescription = selectedVisibilityScope === 'private'
      ? 'Only your private lists'
      : (selectedVisibilityScope === 'all' ? 'All tenant lists (admin only)' : 'Shared lists and your own private lists');

    return html`
      <div class="p-4">
        <div class="flex justify-between items-center mb-6">
            <h2 class="text-lg font-semibold text-gray-900">Lists</h2>
            <div class="ml-auto flex items-center gap-4 text-sm text-gray-600">
              ${this.selectedList ? html`
                <label class="font-semibold text-gray-600">Thumb</label>
                <input
                  type="range"
                  min="80"
                  max="220"
                  step="10"
                  .value=${String(this.thumbSize)}
                  @input=${this._handleThumbSizeChange}
                  class="w-24"
                >
                <span class="w-12 text-right text-sm">${this.thumbSize}px</span>
              ` : html``}
              <div class="flex items-center gap-2">
                <button
                  @click=${this._createList}
                  class="inline-flex items-center gap-2 border rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
                >
                  <span aria-hidden="true">+</span>
                  Add New List
                </button>
                <button
                  @click=${() => this.fetchLists({ force: true })}
                  class="inline-flex items-center gap-2 border rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
                  title="Refresh"
                  ?disabled=${this.isLoadingLists}
                  aria-busy=${this.isLoadingLists ? 'true' : 'false'}
                >
                  <span aria-hidden="true" class=${this.isLoadingLists ? 'animate-spin' : ''}>↻</span>
                  ${this.isLoadingLists ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
            </div>
        </div>
        <div class="mb-4">
          <admin-tabs
            .tabs=${visibilityTabs}
            .activeTab=${selectedVisibilityScope}
            @tab-changed=${this._handleVisibilityTabChanged}
          ></admin-tabs>
          <div class="text-xs text-gray-600 -mt-3">
            <span class="font-semibold">${selectedVisibilityLabel}:</span> ${selectedVisibilityDescription}
          </div>
        </div>
        ${this.selectedList ? html`
          <div class="mb-6">
            <button @click=${this._closeListView} class="text-sm text-blue-600 hover:underline mb-4">← Back to lists</button>
            ${this.isLoadingItems ? html`
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
                </div>
              </div>
            ` : html`
              <div class="flex justify-between items-start mb-6">
                <div class="flex-1">
                  <h3 class="text-2xl font-bold text-gray-900 mb-1">${this.selectedList.title}</h3>
                  <div class="flex gap-4 text-sm text-gray-600 mb-2">
                    <div>
                      <span class="font-semibold">Author:</span> ${this.selectedList.created_by_name || 'Unknown'}
                    </div>
                    <div>
                      <span class="font-semibold">Created:</span> ${new Date(this.selectedList.created_at).toLocaleDateString()}
                    </div>
                    <div>
                      <span class="font-semibold">Visibility:</span> ${this.selectedList.visibility === 'private' ? 'Private' : 'Shared'}
                    </div>
                  </div>
                  ${this.selectedList.notebox ? html`
                    <p class="text-sm text-gray-600">${this.selectedList.notebox}</p>
                  ` : html``}
                </div>
                <div class="flex gap-2">
                  <label class="inline-flex items-center gap-2 text-xs text-gray-700 border border-gray-200 rounded px-3 py-1 bg-white">
                    <input
                      type="checkbox"
                      .checked=${this.downloadIncludeVariants}
                      @change=${(event) => {
                        this.downloadIncludeVariants = !!event.target.checked;
                      }}
                    >
                    <span>Include variants when downloading ZIP</span>
                  </label>
                  <button @click=${this._downloadListImages} ?disabled=${this.isDownloading} class="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1">
                    ${this.isDownloading ? html`<span class="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span>` : ''}
                    Download
                  </button>
                  ${this.selectedList.can_edit ? html`
                    <button @click=${this._startEditingSelectedList} class="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700">Edit</button>
                  ` : html``}
                </div>
              </div>

              <div class="text-sm font-semibold text-gray-700 mb-3">List Items (${this.listItems.length})</div>
              ${this.listItems.length === 0 ? html`
                <p class="text-base text-gray-500">No items in this list yet.</p>
              ` : (() => {
                const items = Array.isArray(this.listItems) ? this.listItems : [];
                const images = items
                  .map((item) => item.image || item.photo || {})
                  .filter((image) => image?.id);
                const itemByImageId = new Map();
                items.forEach((item) => {
                  const photo = item.image || item.photo || {};
                  const imageId = Number(photo.id ?? item.photo_id ?? item.id);
                  if (Number.isFinite(imageId)) {
                    itemByImageId.set(imageId, item);
                  }
                });
                return html`
                  <div class="list-items-grid" style="--curate-thumb-size: ${this.thumbSize}px;">
                    ${renderImageGrid({
                      images,
                      selection: [],
                      flashSelectionIds: new Set(),
                      renderFunctions: {
                        renderCurateRatingWidget: this.renderCurateRatingWidget,
                        renderCurateRatingStatic: this.renderCurateRatingStatic,
                        renderCuratePermatagSummary: this.renderCuratePermatagSummary,
                        formatCurateDate: this.formatCurateDate,
                      },
                      eventHandlers: {
                        onImageClick: (event, image) => this._handleListItemImageSelected(event, image),
                        onDragStart: (event) => event.preventDefault(),
                      },
                      options: {
                        emptyMessage: 'No items in this list yet.',
                        showPermatags: true,
                        renderItemFooter: (image) => {
                          const item = itemByImageId.get(Number(image.id));
                          const addedAt = item?.added_at ? new Date(item.added_at).toLocaleString() : '';
                          return html`
                            <div class="text-sm font-semibold text-gray-900 truncate">${image.filename || `#${image.id}`}</div>
                            <div class="list-item-meta">
                              <div class="text-[11px] text-gray-500">${addedAt ? `Added: ${addedAt}` : ''}</div>
                              ${item ? html`
                                <button @click=${() => this._removeListItem(item.id)} class="text-sm text-red-600 border border-red-200 rounded-lg px-2 py-1 hover:bg-red-50">Remove</button>
                              ` : ''}
                            </div>
                          `;
                        },
                      },
                    })}
                  </div>
                `;
              })()}
            `}
          </div>
        ` : (this.lists.length === 0
          ? html`<p class="text-base text-gray-600">No lists found.</p>`
          : html`
            <table class="min-w-full bg-white border border-gray-300">
              <thead>
                <tr class="bg-gray-50">
                  <th class="py-2 px-4 border-b left-justified-header text-sm font-semibold text-gray-700">
                    <button class="hover:underline text-left w-full" @click=${() => this._handleListSort('id')}>
                      ${this._renderSortLabel('ID', 'id')}
                    </button>
                  </th>
                  <th class="py-2 px-4 border-b left-justified-header text-sm font-semibold text-gray-700">
                    <button class="hover:underline text-left w-full" @click=${() => this._handleListSort('title')}>
                      ${this._renderSortLabel('Title', 'title')}
                    </button>
                  </th>
                  <th class="py-2 px-4 border-b left-justified-header text-sm font-semibold text-gray-700">
                    <button class="hover:underline text-left w-full" @click=${() => this._handleListSort('item_count')}>
                      ${this._renderSortLabel('Item Count', 'item_count')}
                    </button>
                  </th>
                  <th class="py-2 px-4 border-b left-justified-header text-sm font-semibold text-gray-700">
                    <button class="hover:underline text-left w-full" @click=${() => this._handleListSort('created_at')}>
                      ${this._renderSortLabel('Created At', 'created_at')}
                    </button>
                  </th>
                  <th class="py-2 px-4 border-b left-justified-header text-sm font-semibold text-gray-700">
                    <button class="hover:underline text-left w-full" @click=${() => this._handleListSort('created_by_name')}>
                      ${this._renderSortLabel('Author', 'created_by_name')}
                    </button>
                  </th>
                  <th class="py-2 px-4 border-b left-justified-header text-sm font-semibold text-gray-700">
                    <button class="hover:underline text-left w-full" @click=${() => this._handleListSort('notebox')}>
                      ${this._renderSortLabel('Notes', 'notebox')}
                    </button>
                  </th>
                  <th class="py-2 px-4 border-b left-justified-header text-sm font-semibold text-gray-700">
                    <button class="hover:underline text-left w-full" @click=${() => this._handleListSort('visibility')}>
                      ${this._renderSortLabel('Visibility', 'visibility')}
                    </button>
                  </th>
                  <th class="py-2 px-4 border-b left-justified-header text-sm font-semibold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${sortedLists.map(list => html`
                  <tr class="hover:bg-gray-50 border-b">
                    <td class="py-2 px-4 text-sm text-gray-700">${list.id}</td>
                    <td class="py-2 px-4 text-sm text-gray-900">${list.title}</td>
                    <td class="py-2 px-4 text-sm text-gray-700">${list.item_count}</td>
                    <td class="py-2 px-4 text-sm text-gray-700">${new Date(list.created_at).toLocaleDateString()}</td>
                    <td class="py-2 px-4 text-sm text-gray-600">${list.created_by_name || '—'}</td>
                    <td class="py-2 px-4 text-sm text-gray-600">${list.notebox || '—'}</td>
                    <td class="py-2 px-4 text-sm text-gray-700">${list.visibility === 'private' ? 'Private' : 'Shared'}</td>
                    <td class="py-2 px-4 text-left">
                      <button @click=${() => this._selectList(list)} class="bg-slate-900 text-white px-3 py-1 rounded text-sm hover:bg-slate-800 mr-2">View</button>
                    </td>
                  </tr>
                `)}
              </tbody>
            </table>
          `)}
      </div>

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
                  <p class="text-sm font-semibold text-gray-700 mb-1">Author</p>
                  <p class="text-sm text-gray-900">${this.selectedList.created_by_name || 'Unknown'}</p>
                </div>
                <div>
                  <p class="text-sm font-semibold text-gray-700 mb-1">Created</p>
                  <p class="text-sm text-gray-900">${new Date(this.selectedList.created_at).toLocaleDateString()}</p>
                </div>
              </div>

              <div class="mb-4">
                <label class="block text-sm font-semibold text-gray-700 mb-2">Title</label>
                <input
                  id="edit-list-title"
                  type="text"
                  .value=${this.selectedList.title || ''}
                  class="w-full p-2 border border-gray-300 rounded text-sm"
                >
              </div>

              <div class="mb-4">
                <label class="block text-sm font-semibold text-gray-700 mb-2">Notes</label>
                <textarea
                  id="edit-list-notes"
                  .value=${this.selectedList.notebox || ''}
                  class="w-full p-2 border border-gray-300 rounded text-sm"
                  rows="4"
                ></textarea>
              </div>

              <div class="mb-4">
                <label class="block text-sm font-semibold text-gray-700 mb-2">Visibility</label>
                <select
                  id="edit-list-visibility"
                  class="w-full p-2 border border-gray-300 rounded text-sm"
                >
                  <option value="shared" ?selected=${String(this.selectedList.visibility || 'shared') === 'shared'}>Shared</option>
                  <option value="private" ?selected=${String(this.selectedList.visibility || 'shared') === 'private'}>Private</option>
                </select>
              </div>
            </div>

            <div class="flex items-center justify-between gap-2">
              <button
                @click=${() => this._deleteList(this.selectedList)}
                class="border border-red-300 text-red-700 px-4 py-2 rounded text-sm hover:bg-red-50"
              >
                Delete list
              </button>
              <div class="flex gap-2">
                <button @click=${this._cancelEditingSelectedList} class="border border-gray-400 text-gray-700 px-4 py-2 rounded text-sm hover:bg-gray-100">Cancel</button>
                <button @click=${this._saveSelectedListChanges} class="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">Save</button>
              </div>
            </div>
          </div>
        </div>
      ` : ''}
    `;
  }
}

customElements.define('list-editor', ListEditor);
