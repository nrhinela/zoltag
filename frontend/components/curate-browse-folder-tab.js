import { LitElement, html } from 'lit';
import { enqueueCommand } from '../services/command-queue.js';
import { getLists, createList, getListItems } from '../services/api.js';
import { createSelectionHandlers } from './shared/selection-handlers.js';
import { createHotspotHandlers, parseUtilityKeywordValue } from './shared/hotspot-controls.js';
import {
  getKeywordsByCategory,
  getKeywordsByCategoryFromList,
} from './shared/keyword-utils.js';
import { renderResultsPagination } from './shared/pagination-controls.js';
import FolderBrowserPanel from './folder-browser-panel.js';
import './shared/widgets/filter-chips.js';
import './shared/widgets/right-panel.js';
import './shared/widgets/list-targets-panel.js';
import './shared/widgets/hotspot-targets-panel.js';
import './shared/widgets/rating-target-panel.js';

/**
 * Curate Browse By Folder Tab
 *
 * Mirrors Search -> Browse by Folder with Curate right-panel tools.
 */
export class CurateBrowseFolderTab extends LitElement {
  // Use Light DOM to access Tailwind CSS classes
  createRenderRoot() {
    return this;
  }

  static properties = {
    tenant: { type: String },
    thumbSize: { type: Number },
    curateOrderBy: { type: String },
    curateDateOrder: { type: String },
    renderCurateRatingWidget: { type: Object },
    renderCurateRatingStatic: { type: Object },
    renderCuratePermatagSummary: { type: Object },
    formatCurateDate: { type: Object },
    tagStatsBySource: { type: Object },
    activeCurateTagSource: { type: String },
    keywords: { type: Array },

    browseByFolderOptions: { type: Array, state: true },
    browseByFolderSelection: { type: Array, state: true },
    browseByFolderAppliedSelection: { type: Array, state: true },
    browseByFolderData: { type: Object, state: true },
    browseByFolderLoading: { type: Boolean, state: true },
    browseByFolderAccordionOpen: { type: Boolean, state: true },
    browseByFolderQuery: { type: String, state: true },
    browseByFolderOffset: { type: Number, state: true },
    browseByFolderLimit: { type: Number, state: true },
    browseChipFilters: { type: Array, state: true },
    browseFilterParams: { type: Object, state: true },
    listExcludeId: { type: [String, Number], state: true },

    browseDragSelection: { type: Array },
    browseDragSelecting: { type: Boolean },
    browseDragStartIndex: { type: Number },
    browseDragEndIndex: { type: Number },

    rightPanelTool: { type: String },
    browseHotspotTargets: { type: Array },
    browseRatingTargets: { type: Array },

    _browseHotspotDragTarget: { type: String, state: true },
    _browseRatingDragTarget: { type: String, state: true },
    _listTargets: { type: Array, state: true },
    _lists: { type: Array, state: true },
    _listsLoading: { type: Boolean, state: true },
    _listDragTargetId: { type: String, state: true },
    _browseRatingModalActive: { type: Boolean, state: true },
    _browseRatingModalImageIds: { type: Array, state: true },
  };

  constructor() {
    super();
    this.tenant = '';
    this.thumbSize = 120;
    this.curateOrderBy = 'photo_creation';
    this.curateDateOrder = 'desc';
    this.renderCurateRatingWidget = null;
    this.renderCurateRatingStatic = null;
    this.renderCuratePermatagSummary = null;
    this.formatCurateDate = null;
    this.tagStatsBySource = {};
    this.activeCurateTagSource = 'permatags';
    this.keywords = [];

    this.browseByFolderOptions = [];
    this.browseByFolderSelection = [];
    this.browseByFolderAppliedSelection = [];
    this.browseByFolderData = {};
    this.browseByFolderLoading = false;
    this.browseByFolderAccordionOpen = true;
    this.browseByFolderQuery = '';
    this.browseByFolderOffset = 0;
    this.browseByFolderLimit = 100;
    this.browseChipFilters = [];
    this.browseFilterParams = {
      hideZeroRating: true,
      keywords: {},
      operators: {},
      categoryFilterOperator: undefined,
      categoryFilterSource: 'permatags',
    };
    this.listExcludeId = '';

    this.browseDragSelection = [];
    this.browseDragSelecting = false;
    this.browseDragStartIndex = null;
    this.browseDragEndIndex = null;

    this.rightPanelTool = 'tags';
    this.browseHotspotTargets = [{ id: 1, type: 'keyword', count: 0 }];
    this.browseRatingTargets = [{ id: 'rating-1', rating: '', count: 0 }];
    this._browseHotspotNextId = 2;
    this._browseRatingNextId = 2;
    this._browseHotspotDragTarget = null;
    this._browseRatingDragTarget = null;
    this._browseRatingModalActive = false;
    this._browseRatingModalImageIds = [];

    this._listTargets = [{
      id: 'list-target-1',
      listId: '',
      status: '',
      mode: 'add',
      addedCount: 0,
      items: [],
      itemsLoading: false,
      itemsError: '',
      itemsListId: '',
    }];
    this._lists = [];
    this._listsLoading = false;
    this._listDragTargetId = null;
    this._listTargetCounter = 1;

    this._browseFlashSelectionIds = new Set();
    this._browseOrder = null;
    this._browseGroupKey = null;
    this._browsePressActive = false;
    this._browsePressStart = null;
    this._browsePressIndex = null;
    this._browsePressImageId = null;
    this._browsePressTimer = null;
    this._browseLongPressTriggered = false;
    this._browseSuppressClick = false;

    this.folderBrowserPanel = new FolderBrowserPanel('curate-browse');
    this._folderBrowserPanelHandlers = null;

    this._browseSelectionHandlers = createSelectionHandlers(this, {
      selectionProperty: 'browseDragSelection',
      selectingProperty: 'browseDragSelecting',
      startIndexProperty: 'browseDragStartIndex',
      endIndexProperty: 'browseDragEndIndex',
      pressActiveProperty: '_browsePressActive',
      pressStartProperty: '_browsePressStart',
      pressIndexProperty: '_browsePressIndex',
      pressImageIdProperty: '_browsePressImageId',
      pressTimerProperty: '_browsePressTimer',
      longPressTriggeredProperty: '_browseLongPressTriggered',
      suppressClickProperty: '_browseSuppressClick',
      dragSelectOnMove: true,
      getOrder: () => this._browseOrder || [],
      flashSelection: (imageId) => this._flashBrowseSelection(imageId),
    });

    this._browseHotspotHandlers = createHotspotHandlers(this, {
      targetsProperty: 'browseHotspotTargets',
      dragTargetProperty: '_browseHotspotDragTarget',
      nextIdProperty: '_browseHotspotNextId',
      parseKeywordValue: parseUtilityKeywordValue,
      applyRating: (ids, rating) => this._applyBrowseRating(ids, rating),
      processTagDrop: (ids, target) => this._processBrowseHotspotTagDrop(ids, target),
      removeImages: () => {},
    });

    try {
      const storedTool = localStorage.getItem('rightPanelTool:curate-browse');
      if (storedTool) {
        this.rightPanelTool = storedTool;
      }
    } catch {
      // ignore storage errors
    }
  }

  connectedCallback() {
    super.connectedCallback();
    this._setupFolderBrowserPanel();
    if (this.tenant) {
      this.folderBrowserPanel.setTenant(this.tenant);
      this.folderBrowserPanel.loadFolders({ force: true });
    }
    this._fetchLists();

    this._handleBrowseGlobalPointerDown = (event) => {
      if (!this.browseDragSelection.length) return;
      const path = event.composedPath ? event.composedPath() : [];
      const clickedThumb = path.some(node =>
        node.classList && node.classList.contains('curate-thumb-wrapper')
      );
      const clickedSelected = clickedThumb && path.some(node =>
        node.classList && node.classList.contains('selected')
      );
      if (clickedSelected) return;
      this.browseDragSelection = [];
      this._browseSuppressClick = true;
    };

    this._handleBrowseSelectionEnd = () => {
      if (this.browseDragSelecting) {
        this.browseDragSelecting = false;
        this.browseDragStartIndex = null;
        this.browseDragEndIndex = null;
      }
    };

    document.addEventListener('pointerdown', this._handleBrowseGlobalPointerDown);
    window.addEventListener('pointerup', this._handleBrowseSelectionEnd);
    window.addEventListener('keyup', this._handleBrowseSelectionEnd);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._teardownFolderBrowserPanel();
    if (this._handleBrowseGlobalPointerDown) {
      document.removeEventListener('pointerdown', this._handleBrowseGlobalPointerDown);
    }
    if (this._handleBrowseSelectionEnd) {
      window.removeEventListener('pointerup', this._handleBrowseSelectionEnd);
      window.removeEventListener('keyup', this._handleBrowseSelectionEnd);
    }
    if (this._browsePressTimer) {
      clearTimeout(this._browsePressTimer);
      this._browsePressTimer = null;
    }
  }

  updated(changedProps) {
    if (changedProps.has('tenant')) {
      this.browseByFolderOptions = [];
      this.browseByFolderSelection = [];
      this.browseByFolderAppliedSelection = [];
      this.browseByFolderData = {};
      this.folderBrowserPanel?.setTenant(this.tenant);
      this.folderBrowserPanel?.loadFolders({ force: true });
      this._lists = [];
      this._fetchLists({ force: true });
    }
    if (changedProps.has('browseByFolderAppliedSelection')) {
      const total = (this.browseByFolderAppliedSelection || []).length;
      if (this.browseByFolderOffset >= total && total > 0) {
        this.browseByFolderOffset = 0;
      }
    }
  }

  refresh() {
    this._refreshBrowseByFolderData({ force: true });
  }

  _setupFolderBrowserPanel() {
    const panel = this.folderBrowserPanel;
    if (!panel || this._folderBrowserPanelHandlers) return;
    const handleFoldersLoaded = (detail) => {
      this.browseByFolderOptions = [...(detail?.folders || [])].sort((a, b) => a.localeCompare(b));
    };
    const handleDataLoaded = (detail) => {
      this.browseByFolderData = detail?.data || {};
    };
    const handleSelectionChanged = (detail) => {
      const selection = detail?.selection || [];
      this.browseByFolderAppliedSelection = selection;
      this.browseByFolderSelection = selection;
    };
    const handleFoldersLoading = () => this._syncBrowseByFolderLoading();
    const handleDataLoading = () => this._syncBrowseByFolderLoading();
    this._folderBrowserPanelHandlers = {
      handleFoldersLoaded,
      handleDataLoaded,
      handleSelectionChanged,
      handleFoldersLoading,
      handleDataLoading,
    };
    panel.on('folders-loaded', handleFoldersLoaded);
    panel.on('data-loaded', handleDataLoaded);
    panel.on('selection-changed', handleSelectionChanged);
    panel.on('folders-loading', handleFoldersLoading);
    panel.on('data-loading', handleDataLoading);
    if (this.tenant) {
      panel.setTenant(this.tenant);
    }
  }

  _teardownFolderBrowserPanel() {
    const panel = this.folderBrowserPanel;
    if (!panel || !this._folderBrowserPanelHandlers) return;
    panel.off('folders-loaded', this._folderBrowserPanelHandlers.handleFoldersLoaded);
    panel.off('data-loaded', this._folderBrowserPanelHandlers.handleDataLoaded);
    panel.off('selection-changed', this._folderBrowserPanelHandlers.handleSelectionChanged);
    panel.off('folders-loading', this._folderBrowserPanelHandlers.handleFoldersLoading);
    panel.off('data-loading', this._folderBrowserPanelHandlers.handleDataLoading);
    this._folderBrowserPanelHandlers = null;
  }

  _syncBrowseByFolderLoading() {
    const panel = this.folderBrowserPanel;
    if (!panel) return;
    this.browseByFolderLoading = !!(panel.loadingFolders || panel.loadingData);
  }

  async _fetchLists({ force = false } = {}) {
    if (!this.tenant) return;
    if (this._listsLoading) return;
    this._listsLoading = true;
    try {
      this._lists = await getLists(this.tenant, { force });
    } catch (error) {
      console.error('Error fetching lists:', error);
      this._lists = [];
    } finally {
      this._listsLoading = false;
    }
  }

  _handleRightPanelToolChange(tool) {
    this.rightPanelTool = tool;
    try {
      localStorage.setItem('rightPanelTool:curate-browse', tool);
    } catch {
      // ignore storage errors
    }
    if (tool === 'lists' && !(this._lists || []).length) {
      this._fetchLists();
    }
  }

  _handleBrowseRatingChange(targetId, value) {
    this.browseRatingTargets = (this.browseRatingTargets || []).map((entry) => (
      entry.id === targetId ? { ...entry, rating: value, count: entry.count || 0 } : entry
    ));
  }

  _handleBrowseRatingAddTarget() {
    const nextId = `rating-${this._browseRatingNextId++}`;
    this.browseRatingTargets = [
      ...(this.browseRatingTargets || []),
      { id: nextId, rating: '', count: 0 },
    ];
  }

  _handleBrowseRatingRemoveTarget(targetId) {
    this.browseRatingTargets = (this.browseRatingTargets || []).filter((entry) => entry.id !== targetId);
  }

  _handleBrowseRatingDragOver(event, targetId) {
    event.preventDefault();
    this._browseRatingDragTarget = targetId;
  }

  _handleBrowseRatingDragLeave(event) {
    if (event && event.currentTarget !== event.target) return;
    this._browseRatingDragTarget = null;
  }

  _handleBrowseRatingDrop(event, targetId) {
    event.preventDefault();
    this._browseRatingDragTarget = null;
    const target = (this.browseRatingTargets || []).find((entry) => entry.id === targetId);
    let rating = Number.parseInt(target?.rating ?? '', 10);
    const raw = event.dataTransfer?.getData('text/plain') || '';
    const ids = raw
      .split(',')
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (!ids.length) return;
    if (!Number.isFinite(rating)) {
      this._openBrowseRatingModal(ids);
      this.browseRatingTargets = (this.browseRatingTargets || []).map((entry) => (
        entry.id === targetId ? { ...entry, count: (entry.count || 0) + ids.length } : entry
      ));
      return;
    }
    this.browseRatingTargets = (this.browseRatingTargets || []).map((entry) => (
      entry.id === targetId ? { ...entry, count: (entry.count || 0) + ids.length } : entry
    ));
    this._applyBrowseRating(ids, rating);
  }

  _openBrowseRatingModal(imageIds) {
    this._browseRatingModalImageIds = imageIds;
    this._browseRatingModalActive = true;
  }

  _closeBrowseRatingModal() {
    this._browseRatingModalActive = false;
    this._browseRatingModalImageIds = [];
  }

  _handleBrowseRatingModalClick(rating) {
    const ids = this._browseRatingModalImageIds || [];
    if (!ids.length) {
      this._closeBrowseRatingModal();
      return;
    }
    this._closeBrowseRatingModal();
    this._applyBrowseRating(ids, rating);
  }

  _applyBrowseRating(ids, rating) {
    const uniqueIds = [...new Set(ids)].filter((id) => Number.isFinite(Number(id)));
    if (!uniqueIds.length) return;
    uniqueIds.forEach((id) => {
      enqueueCommand({
        type: 'set-rating',
        tenantId: this.tenant,
        imageId: id,
        rating,
      });
    });
    this.applyRatingUpdate(uniqueIds, rating);
  }

  applyRatingUpdate(ids, rating) {
    if (!Array.isArray(ids)) return;
    if (!this.browseByFolderData || typeof this.browseByFolderData !== 'object') return;
    const idSet = new Set(ids);
    const nextData = {};
    Object.entries(this.browseByFolderData).forEach(([folder, images]) => {
      if (!Array.isArray(images)) {
        nextData[folder] = images;
        return;
      }
      let updated = false;
      const nextImages = images.map((image) => {
        if (idSet.has(image.id)) {
          updated = true;
          return { ...image, rating };
        }
        return image;
      });
      nextData[folder] = updated ? nextImages : images;
    });
    this.browseByFolderData = nextData;
  }

  _processBrowseHotspotTagDrop(ids, target) {
    const uniqueIds = [...new Set(ids)].filter((id) => Number.isFinite(Number(id)));
    if (!uniqueIds.length) return;
    if (!target?.keyword) return;
    const signum = target.action === 'remove' ? -1 : 1;
    const category = target.category || 'Uncategorized';
    const operations = uniqueIds.map((imageId) => ({
      image_id: imageId,
      keyword: target.keyword,
      category,
      signum,
    }));
    enqueueCommand({
      type: 'bulk-permatags',
      tenantId: this.tenant,
      operations,
      description: `browse by folder · ${operations.length} updates`,
    });
  }

  _handleBrowsePointerDown(event, index, imageId, order, groupKey) {
    this._browseOrder = order;
    this._browseGroupKey = groupKey;
    return this._browseSelectionHandlers.handlePointerDown(event, index, imageId);
  }

  _handleBrowseSelectHover(index, groupKey) {
    if (this._browseGroupKey !== groupKey) {
      return;
    }
    return this._browseSelectionHandlers.handleSelectHover(index);
  }

  _flashBrowseSelection(imageId) {
    if (!imageId) return;
    this._browseFlashSelectionIds.add(imageId);
    this.requestUpdate();
    setTimeout(() => {
      this._browseFlashSelectionIds.delete(imageId);
      this.requestUpdate();
    }, 300);
  }

  _handleBrowseImageClick(event, image, imageSet) {
    if (event.defaultPrevented) return;
    if (this._browseSuppressClick || this.browseDragSelection.length) {
      this._browseSuppressClick = false;
      return;
    }
    this.dispatchEvent(new CustomEvent('image-clicked', {
      detail: { event, image, imageSet },
      bubbles: true,
      composed: true
    }));
  }

  _handleBrowseDragStart(event, image) {
    if (this.browseDragSelecting) {
      event.preventDefault();
      return;
    }
    let ids = [image.id];
    if (this.browseDragSelection.length && this.browseDragSelection.includes(image.id)) {
      ids = this.browseDragSelection;
    } else if (this.browseDragSelection.length) {
      this.browseDragSelection = [image.id];
    }
    event.dataTransfer.setData('text/plain', ids.join(','));
    event.dataTransfer.setData('application/x-photocat-source', 'curate-browse');
    event.dataTransfer.setData('image-ids', JSON.stringify(ids));
  }

  _handleBrowsePointerMove(event) {
    return this._browseSelectionHandlers.handlePointerMove(event);
  }

  _handleBrowsePointerDownStart(event, index, imageId) {
    return this._browseSelectionHandlers.handlePointerDown(event, index, imageId);
  }

  _handleBrowseSelectStart(event, index, imageId) {
    return this._browseSelectionHandlers.handleSelectStart(event, index, imageId);
  }

  _handleBrowseSelectHover(index) {
    return this._browseSelectionHandlers.handleSelectHover(index);
  }

  _getBrowseByFolderPaginationState() {
    const total = (this.browseByFolderAppliedSelection || []).length;
    const offset = Number(this.browseByFolderOffset) || 0;
    const limit = Number(this.browseByFolderLimit) || 100;
    const count = Math.max(0, Math.min(limit, total - offset));
    return { total, offset, limit, count };
  }

  _handleBrowseByFolderPagePrev() {
    const { offset, limit } = this._getBrowseByFolderPaginationState();
    this.browseByFolderOffset = Math.max(0, offset - limit);
  }

  _handleBrowseByFolderPageNext() {
    const { offset, limit, total } = this._getBrowseByFolderPaginationState();
    const nextOffset = offset + limit < total ? offset + limit : offset;
    this.browseByFolderOffset = nextOffset;
  }

  _handleBrowseByFolderPageLimitChange(event) {
    const nextLimit = parseInt(event.target.value, 10);
    if (!Number.isFinite(nextLimit)) return;
    this.browseByFolderLimit = nextLimit;
    this.browseByFolderOffset = 0;
  }

  _handleBrowseByFolderMultiSelectChange(event) {
    const selected = Array.from(event.target.selectedOptions).map((option) => option.value);
    this.browseByFolderSelection = selected;
  }

  _handleBrowseByFolderApply = () => {
    const appliedSelection = [...(this.browseByFolderSelection || [])];
    this.browseByFolderAppliedSelection = appliedSelection;
    this.browseByFolderOffset = 0;
    this.folderBrowserPanel?.setSelection(appliedSelection);
    this._refreshBrowseByFolderData({ force: true });
    this.browseByFolderAccordionOpen = false;
  };

  _handleBrowseByFolderCancel = () => {
    this.browseByFolderSelection = [...(this.browseByFolderAppliedSelection || [])];
    this.browseByFolderAccordionOpen = false;
  };

  _refreshBrowseByFolderData({ force = false, orderBy, sortOrder } = {}) {
    if (!this.folderBrowserPanel) return;
    const resolvedOrderBy = orderBy || this.curateOrderBy || 'photo_creation';
    const resolvedSortOrder = sortOrder || this.curateDateOrder || 'desc';
    const appliedSelection = this.browseByFolderAppliedSelection || [];
    if (appliedSelection.length) {
      this.folderBrowserPanel.setSelection(appliedSelection);
    }
    return this.folderBrowserPanel.loadData({
      orderBy: resolvedOrderBy,
      sortOrder: resolvedSortOrder,
      limit: 0,
      listExcludeId: this.listExcludeId || '',
      filters: this.browseFilterParams,
      force
    });
  }

  _getBrowseByFolderSortValue(image, field) {
    if (!image) return null;
    if (field === 'rating') {
      return image.rating ?? null;
    }
    if (field === 'processed') {
      return image.last_processed || image.created_at || image.processed || image.processed_at || null;
    }
    if (field === 'photo_creation') {
      return image.photo_creation || image.capture_timestamp || image.modified_time || image.created_at || null;
    }
    return null;
  }

  _normalizeBrowseByFolderSortValue(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    return null;
  }

  _sortBrowseByFolderImages(images) {
    if (!Array.isArray(images) || images.length < 2) {
      return images || [];
    }
    const field = this.curateOrderBy || 'photo_creation';
    const direction = this.curateDateOrder === 'asc' ? 1 : -1;
    const sorted = [...images];
    sorted.sort((a, b) => {
      const rawA = this._getBrowseByFolderSortValue(a, field);
      const rawB = this._getBrowseByFolderSortValue(b, field);
      const valueA = this._normalizeBrowseByFolderSortValue(rawA);
      const valueB = this._normalizeBrowseByFolderSortValue(rawB);
      if (valueA === null && valueB === null) return 0;
      if (valueA === null) return 1;
      if (valueB === null) return -1;
      if (valueA === valueB) return 0;
      return valueA > valueB ? direction : -direction;
    });
    return sorted;
  }

  _buildDropboxHref(path) {
    if (!path) return '';
    const encodedPath = path.split('/').map((part) => encodeURIComponent(part)).join('/');
    return `https://www.dropbox.com/home${encodedPath}`;
  }

  _hasPendingBrowseByFolderSelection() {
    const pending = this.browseByFolderSelection || [];
    const applied = this.browseByFolderAppliedSelection || [];
    if (pending.length !== applied.length) return true;
    const pendingSet = new Set(pending);
    return applied.some((folder) => !pendingSet.has(folder));
  }

  _handleCurateQuickSort(field) {
    const nextOrderBy = field;
    const nextDateOrder = this.curateOrderBy === field
      ? (this.curateDateOrder === 'desc' ? 'asc' : 'desc')
      : 'desc';
    this.dispatchEvent(new CustomEvent('sort-changed', {
      detail: { orderBy: nextOrderBy, dateOrder: nextDateOrder },
      bubbles: true,
      composed: true
    }));
    this._refreshBrowseByFolderData({
      force: true,
      orderBy: nextOrderBy,
      sortOrder: nextDateOrder
    });
  }

  _getCurateQuickSortArrow(field) {
    if (this.curateOrderBy !== field) return '';
    return this.curateDateOrder === 'desc' ? '↓' : '↑';
  }

  _getBrowseByFolderPagination() {
    const { offset, limit, total, count } = this._getBrowseByFolderPaginationState();
    return renderResultsPagination({
      offset,
      limit,
      total,
      count,
      onPrev: () => this._handleBrowseByFolderPagePrev(),
      onNext: () => this._handleBrowseByFolderPageNext(),
      onLimitChange: (event) => this._handleBrowseByFolderPageLimitChange(event),
      disabled: this.browseByFolderLoading,
    });
  }

  _getKeywordsByCategory() {
    if (this.keywords && this.keywords.length) {
      return getKeywordsByCategoryFromList(this.keywords);
    }
    return getKeywordsByCategory(this.tagStatsBySource, this.activeCurateTagSource);
  }

  _buildNewListTitle() {
    const now = new Date();
    const iso = now.toISOString().replace('T', ':').split('.')[0];
    return `${iso} new list`;
  }

  _isDuplicateListTitle(title) {
    const trimmed = (title || '').trim().toLowerCase();
    return (this._lists || []).some((list) => (list.title || '').trim().toLowerCase() === trimmed);
  }

  _startInlineListCreate(targetId) {
    const defaultTitle = this._buildNewListTitle();
    this._listTargets = this._listTargets.map((target) => (
      target.id === targetId
        ? {
            ...target,
            listId: '',
            status: '',
            isCreating: true,
            draftTitle: defaultTitle,
            error: '',
            addedCount: 0,
          }
        : target
    ));
  }

  _handleListTargetSelect(targetId, selectedValue) {
    if (selectedValue === '__new__') {
      this._startInlineListCreate(targetId);
      return;
    }
    this._listTargets = this._listTargets.map((target) => (
      target.id === targetId
        ? {
            ...target,
            listId: String(selectedValue),
            status: '',
            isCreating: false,
            error: '',
          }
        : target
    ));
    if (selectedValue) {
      this._fetchListTargetItems(targetId, String(selectedValue));
      this._applyListExcludeFilter(selectedValue);
    }
  }

  _applyListExcludeFilter(listId) {
    const resolvedId = listId ? String(listId) : '';
    if (!resolvedId) return;
    const list = (this._lists || []).find((entry) => String(entry.id) === resolvedId);
    const title = list?.title || `List ${resolvedId}`;
    const nextFilters = (this.browseChipFilters || []).filter((filter) => filter.type !== 'list');
    nextFilters.push({
      type: 'list',
      value: resolvedId,
      mode: 'exclude',
      displayLabel: 'List',
      displayValue: `Not in ${title}`,
    });
    this._handleBrowseChipFiltersChanged({ detail: { filters: nextFilters } });
  }

  _handleBrowseChipFiltersChanged(event) {
    const chips = event.detail?.filters || [];
    this.browseChipFilters = chips;

    const nextFilters = {
      hideZeroRating: true,
      keywords: {},
      operators: {},
      categoryFilterSource: 'permatags',
      filenameQuery: '',
      listId: undefined,
      listExcludeId: undefined,
      rating: undefined,
      ratingOperator: undefined,
      permatagPositiveMissing: false,
    };

    chips.forEach((chip) => {
      switch (chip.type) {
        case 'keyword': {
          if (chip.untagged || chip.value === '__untagged__') {
            nextFilters.permatagPositiveMissing = true;
            break;
          }
          const keywordsByCategory = chip.keywordsByCategory && typeof chip.keywordsByCategory === 'object'
            ? chip.keywordsByCategory
            : (chip.category && chip.value ? { [chip.category]: [chip.value] } : {});
          const operator = chip.operator || 'OR';
          nextFilters.categoryFilterOperator = operator;
          Object.entries(keywordsByCategory).forEach(([category, values]) => {
            const list = Array.isArray(values) ? values : Array.from(values || []);
            if (!list.length) return;
            if (!nextFilters.keywords[category]) {
              nextFilters.keywords[category] = new Set();
            }
            list.forEach((value) => nextFilters.keywords[category].add(value));
            nextFilters.operators[category] = operator;
          });
          break;
        }
        case 'rating':
          if (chip.value === 'unrated') {
            nextFilters.ratingOperator = 'is_null';
            nextFilters.hideZeroRating = true;
          } else {
            nextFilters.rating = chip.value;
            nextFilters.ratingOperator = chip.value === 0 ? 'eq' : 'gte';
            nextFilters.hideZeroRating = false;
          }
          break;
        case 'list':
          if (chip.mode === 'exclude') {
            nextFilters.listExcludeId = chip.value;
          } else {
            nextFilters.listId = chip.value;
          }
          break;
        case 'filename':
          nextFilters.filenameQuery = chip.value || '';
          break;
      }
    });

    this.listExcludeId = nextFilters.listExcludeId || '';
    this.browseFilterParams = nextFilters;
    this._refreshBrowseByFolderData({ force: true });
  }

  _handleBrowseListsRequested() {
    this._fetchLists({ force: true });
  }

  _handleListTargetDraftChange(targetId, nextValue) {
    this._listTargets = this._listTargets.map((target) => (
      target.id === targetId ? { ...target, draftTitle: nextValue, error: '' } : target
    ));
  }

  _handleListTargetCreateCancel(targetId) {
    this._listTargets = this._listTargets.map((target) => (
      target.id === targetId
        ? { ...target, isCreating: false, draftTitle: '', error: '', status: '' }
        : target
    ));
  }

  _handleListTargetModeChange(targetId, mode) {
    const target = this._listTargets.find((entry) => entry.id === targetId);
    const nextMode = target?.mode === mode ? 'add' : mode;
    this._listTargets = this._listTargets.map((entry) => (
      entry.id === targetId ? { ...entry, mode: nextMode } : entry
    ));
    if (nextMode === 'view' && target?.listId) {
      this._fetchListTargetItems(targetId, target.listId);
    }
  }

  _handleListTargetItemClick(event, targetId, index) {
    const target = this._listTargets.find((entry) => entry.id === targetId);
    const items = target?.items || [];
    if (!items.length) return;
    const imageSet = items.map((item) => {
      const photo = item?.photo || {};
      const id = photo.id ?? item.photo_id ?? item.id;
      return {
        ...photo,
        id,
        thumbnail_url: photo.thumbnail_url || (id ? `/api/v1/images/${id}/thumbnail` : undefined),
        filename: photo.filename || item?.filename || '',
      };
    }).filter((image) => image?.id);
    const image = imageSet[index];
    if (!image) return;
    this.dispatchEvent(new CustomEvent('image-clicked', {
      detail: { event, image, imageSet },
      bubbles: true,
      composed: true
    }));
  }

  async _handleListTargetCreateSave(targetId) {
    const target = this._listTargets.find((entry) => entry.id === targetId);
    const trimmedTitle = (target?.draftTitle || '').trim();
    if (!trimmedTitle) {
      this._listTargets = this._listTargets.map((entry) => (
        entry.id === targetId ? { ...entry, error: 'List name cannot be empty.' } : entry
      ));
      return;
    }
    if (this._isDuplicateListTitle(trimmedTitle)) {
      this._listTargets = this._listTargets.map((entry) => (
        entry.id === targetId ? { ...entry, error: 'List name already exists.' } : entry
      ));
      return;
    }
    try {
      const newList = await createList(this.tenant, { title: trimmedTitle, notebox: '' });
      this._lists = [...(this._lists || []), newList];
      const resolvedId = newList?.id ? String(newList.id) : '';
      this._listTargets = this._listTargets.map((entry) => (
        entry.id === targetId
          ? {
              ...entry,
              listId: resolvedId,
              isCreating: false,
              draftTitle: '',
              error: '',
              status: '',
            }
          : entry
      ));
      if (resolvedId) {
        this._fetchListTargetItems(targetId, resolvedId, { force: true });
        this._applyListExcludeFilter(resolvedId);
      }
    } catch (error) {
      console.error('Error creating list:', error);
      this._listTargets = this._listTargets.map((entry) => (
        entry.id === targetId ? { ...entry, error: 'Failed to create list.' } : entry
      ));
    }
  }

  _handleListTargetDragOver(targetId) {
    this._listDragTargetId = targetId;
  }

  _handleListTargetDragLeave(targetId) {
    if (this._listDragTargetId === targetId) {
      this._listDragTargetId = null;
    }
  }

  _handleListTargetDrop(event, targetId) {
    this._listDragTargetId = null;
    const target = this._listTargets.find((entry) => entry.id === targetId);
    if (!target?.listId) return;
    const raw = event.dataTransfer?.getData('text/plain') || '';
    const ids = raw
      .split(',')
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (!ids.length) return;
    this._addImagesToListTarget(targetId, target.listId, ids);
  }

  _handleAddListTarget = () => {
    const nextId = `list-target-${++this._listTargetCounter}`;
    this._listTargets = [
      ...this._listTargets,
      {
        id: nextId,
        listId: '',
        status: '',
        mode: 'add',
        addedCount: 0,
        items: [],
        itemsLoading: false,
        itemsError: '',
        itemsListId: '',
      },
    ];
  };

  _handleRemoveListTarget(targetId) {
    if (this._listTargets.length <= 1) return;
    this._listTargets = this._listTargets.filter((target) => target.id !== targetId);
  }

  async _fetchListTargetItems(targetId, listId, { force = false } = {}) {
    if (!this.tenant || !listId) return;
    const target = this._listTargets.find((entry) => entry.id === targetId);
    if (!target || target.itemsLoading) return;
    if (!force && target.itemsListId === String(listId) && (target.items || []).length) {
      return;
    }
    this._listTargets = this._listTargets.map((entry) => (
      entry.id === targetId
        ? { ...entry, itemsLoading: true, itemsError: '' }
        : entry
    ));
    try {
      const items = await getListItems(this.tenant, listId);
      this._listTargets = this._listTargets.map((entry) => (
        entry.id === targetId
          ? {
              ...entry,
              items: items || [],
              itemsLoading: false,
              itemsError: '',
              itemsListId: String(listId),
            }
          : entry
      ));
    } catch (error) {
      console.error('Error fetching list items:', error);
      this._listTargets = this._listTargets.map((entry) => (
        entry.id === targetId
          ? { ...entry, itemsLoading: false, itemsError: 'Failed to load list items.' }
          : entry
      ));
    }
  }

  _addImagesToListTarget(targetId, listId, ids) {
    const uniqueIds = [...new Set(ids)].filter((id) => Number.isFinite(Number(id)));
    if (!uniqueIds.length) return;
    uniqueIds.forEach((id) => {
      enqueueCommand({
        type: 'add-to-list',
        tenantId: this.tenant,
        imageId: id,
        listId: Number.parseInt(listId, 10),
      });
    });
    this._listTargets = this._listTargets.map((entry) => (
      entry.id === targetId ? { ...entry, addedCount: (entry.addedCount || 0) + uniqueIds.length } : entry
    ));
    this._lists = (this._lists || []).map((list) => (
      String(list.id) === String(listId)
        ? { ...list, item_count: (list.item_count || 0) + uniqueIds.length }
        : list
    ));
  }

  render() {
    const folderQuery = (this.browseByFolderQuery || '').trim().toLowerCase();
    const filteredFolders = folderQuery
      ? (this.browseByFolderOptions || []).filter((folder) => folder.toLowerCase().includes(folderQuery))
      : (this.browseByFolderOptions || []);
    const selectedFolders = this.browseByFolderSelection || [];
    const appliedFolders = this.browseByFolderAppliedSelection || [];
    const folderOptions = Array.from(new Set([...filteredFolders, ...selectedFolders]))
      .sort((a, b) => a.localeCompare(b));
    const showBrowseByFolderOverlay = this.browseByFolderAccordionOpen || this._hasPendingBrowseByFolderSelection();
    const browsePagination = this._getBrowseByFolderPagination();
    const browseFoldersPage = (appliedFolders || [])
      .slice(this.browseByFolderOffset, this.browseByFolderOffset + this.browseByFolderLimit);

    const ratingModal = this._browseRatingModalActive ? html`
      <div class="curate-rating-modal-overlay" @click=${this._closeBrowseRatingModal}>
        <div class="curate-rating-modal-content" @click=${(e) => e.stopPropagation()}>
          <div class="curate-rating-modal-title">Rate images</div>
          <div class="curate-rating-modal-subtitle">${this._browseRatingModalImageIds?.length || 0} image(s)</div>
          <div class="curate-rating-modal-options">
            <div class="curate-rating-option" @click=${() => this._handleBrowseRatingModalClick(0)}>
              <div class="curate-rating-option-icon">🗑️</div>
              <div class="curate-rating-option-label">Garbage</div>
            </div>
            <div class="curate-rating-option" @click=${() => this._handleBrowseRatingModalClick(1)}>
              <div class="curate-rating-option-icon">⭐</div>
              <div class="curate-rating-option-label">1</div>
            </div>
            <div class="curate-rating-option" @click=${() => this._handleBrowseRatingModalClick(2)}>
              <div class="curate-rating-option-icon">⭐</div>
              <div class="curate-rating-option-label">2</div>
            </div>
            <div class="curate-rating-option" @click=${() => this._handleBrowseRatingModalClick(3)}>
              <div class="curate-rating-option-icon">⭐</div>
              <div class="curate-rating-option-label">3</div>
            </div>
          </div>
          <div class="curate-rating-modal-buttons">
            <button class="curate-rating-modal-cancel" @click=${this._closeBrowseRatingModal}>Cancel</button>
          </div>
        </div>
      </div>
    ` : html``;

    return html`
      ${ratingModal}
      <div class="curate-header-layout search-header-layout mb-4">
        <div class="w-full">
          <filter-chips
            .tenant=${this.tenant}
            .tagStatsBySource=${this.tagStatsBySource}
            .activeCurateTagSource=${this.activeCurateTagSource || 'permatags'}
            .keywords=${this.keywords}
            .activeFilters=${this.browseChipFilters}
            .lists=${this._lists}
            .availableFilterTypes=${['keyword', 'rating', 'list', 'filename']}
            .renderSortControls=${() => html`
              <div class="flex items-center gap-2">
                <span class="text-sm font-semibold text-gray-700">Sort:</span>
                <div class="curate-audit-toggle">
                  <button
                    class=${this.curateOrderBy === 'rating' ? 'active' : ''}
                    @click=${() => this._handleCurateQuickSort('rating')}
                  >
                    Rating ${this._getCurateQuickSortArrow('rating')}
                  </button>
                  <button
                    class=${this.curateOrderBy === 'photo_creation' ? 'active' : ''}
                    @click=${() => this._handleCurateQuickSort('photo_creation')}
                  >
                    Photo Date ${this._getCurateQuickSortArrow('photo_creation')}
                  </button>
                  <button
                    class=${this.curateOrderBy === 'processed' ? 'active' : ''}
                    @click=${() => this._handleCurateQuickSort('processed')}
                  >
                    Process Date ${this._getCurateQuickSortArrow('processed')}
                  </button>
                </div>
              </div>
            `}
            @filters-changed=${this._handleBrowseChipFiltersChanged}
            @lists-requested=${this._handleBrowseListsRequested}
          ></filter-chips>
        </div>
      </div>
      <div class="curate-layout search-layout mt-3" style="--curate-thumb-size: ${this.thumbSize}px;">
        <div class="curate-pane">
          <div class="curate-pane-header">
            <div class="curate-pane-header-row">
              <span class="text-sm font-semibold">Browse by Folder</span>
            </div>
          </div>
          <div class="curate-pane-body">
            <div class="p-3 border-b bg-white">
              <button
                class="w-full flex items-center justify-between text-sm font-semibold text-gray-900 px-3 py-2 rounded-lg border transition-colors ${this.browseByFolderAccordionOpen ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}"
                type="button"
                @click=${() => { this.browseByFolderAccordionOpen = !this.browseByFolderAccordionOpen; }}
              >
                <span>Select Folders</span>
                <span class="text-xs text-gray-500">
                  ${Array.isArray(this.browseByFolderSelection) ? this.browseByFolderSelection.length : 0} selected
                  <span class="ml-2">${this.browseByFolderAccordionOpen ? '▾' : '▸'}</span>
                </span>
              </button>

              ${this.browseByFolderAccordionOpen ? html`
                <div class="mt-3 space-y-3">
                  <input
                    type="text"
                    class="w-full px-3 py-2 border rounded-lg text-sm"
                    placeholder="Filter folders..."
                    .value=${this.browseByFolderQuery}
                    @input=${(event) => { this.browseByFolderQuery = event.target.value; }}
                  >
                  ${this.browseByFolderLoading ? html`
                    <div class="p-3 text-sm font-semibold text-gray-700 border rounded-lg flex items-center justify-center gap-2 bg-blue-50">
                      <span class="curate-spinner" aria-hidden="true"></span>
                      <span>Loading folders. Please wait...</span>
                    </div>
                  ` : ''}
                  <div class="max-h-96 overflow-y-auto">
                    ${folderOptions.length ? html`
                      <select
                        class="w-full p-2 border rounded-lg text-sm"
                        multiple
                        size=${Math.min(10, Math.max(6, folderOptions.length))}
                        @change=${this._handleBrowseByFolderMultiSelectChange}
                      >
                        ${folderOptions.map((folder) => html`
                          <option value=${folder} ?selected=${(this.browseByFolderSelection || []).includes(folder)}>
                            ${folder}
                          </option>
                        `)}
                      </select>
                    ` : html`
                      <div class="p-4 text-sm font-semibold text-gray-700 border rounded-lg flex items-center justify-center gap-2">
                        ${this.browseByFolderLoading ? '' : html`No folders match your search.`}
                      </div>
                    `}
                  </div>
                  <div class="flex items-center justify-end gap-3">
                    <button
                      class="px-3 py-2 text-xs font-semibold text-gray-600 border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-60"
                      type="button"
                      @click=${this._handleBrowseByFolderCancel}
                      ?disabled=${!this._hasPendingBrowseByFolderSelection()}
                    >
                      Cancel
                    </button>
                    <button
                      class="px-3 py-2 text-xs font-semibold text-blue-600 border border-blue-200 rounded hover:bg-blue-50 disabled:opacity-60"
                      type="button"
                      @click=${this._handleBrowseByFolderApply}
                      ?disabled=${!(this.browseByFolderSelection || []).length}
                    >
                      Apply selection
                    </button>
                  </div>
                </div>
              ` : ''}

              ${this.browseByFolderAccordionOpen || !(this.browseByFolderAppliedSelection || []).length ? '' : html``}
            </div>

            ${this.browseByFolderAccordionOpen ? '' : html`
            <div class="relative">
              ${showBrowseByFolderOverlay ? html`
                <div class="absolute inset-0 z-10 bg-white/80 backdrop-blur-sm"></div>
              ` : ''}
              ${appliedFolders && appliedFolders.length > 0 ? html`
                <div class="p-4 space-y-6 ${showBrowseByFolderOverlay ? 'pointer-events-none blur-sm' : ''}">
                  ${browseFoldersPage.map((folder) => {
                    const images = this.browseByFolderData?.[folder] || [];
                    const sortedImages = this._sortBrowseByFolderImages(images);
                    const order = sortedImages.map((image) => image.id);
                    return html`
                      <div>
                        <div class="text-sm font-semibold text-gray-900 mb-3">
                          ${this._buildDropboxHref(folder) ? html`
                            <a
                              class="text-blue-600 hover:text-blue-700 break-all"
                              href=${this._buildDropboxHref(folder)}
                              target="dropbox"
                              rel="noopener noreferrer"
                            >
                              ${folder}
                            </a>
                          ` : folder}
                          <span class="text-xs text-gray-500 font-normal">(${images.length} images)</span>
                        </div>
                        <div class="curate-grid">
                          ${sortedImages.length ? sortedImages.map((image, index) => html`
                            <div
                              class="curate-thumb-wrapper ${this.browseDragSelection.includes(image.id) ? 'selected' : ''}"
                              data-image-id="${image.id}"
                              draggable="true"
                              @dragstart=${(event) => this._handleBrowseDragStart(event, image)}
                              @click=${(event) => this._handleBrowseImageClick(event, image, images)}
                            >
                              <img
                                src=${image.thumbnail_url || `/api/v1/images/${image.id}/thumbnail`}
                                alt=${image.filename}
                                class="curate-thumb ${this.browseDragSelection.includes(image.id) ? 'selected' : ''} ${this._browseFlashSelectionIds?.has(image.id) ? 'flash' : ''}"
                                draggable="false"
                                @pointerdown=${(event) => this._handleBrowsePointerDown(event, index, image.id, order, folder)}
                                @pointermove=${(event) => this._handleBrowsePointerMove(event)}
                                @pointerenter=${() => this._handleBrowseSelectHover(index, folder)}
                              >
                              ${this.renderCurateRatingWidget ? this.renderCurateRatingWidget(image) : ''}
                              ${this.renderCurateRatingStatic ? this.renderCurateRatingStatic(image) : ''}
                              ${this.formatCurateDate && this.formatCurateDate(image) ? html`
                                <div class="curate-thumb-date">
                                  <span class="curate-thumb-id">#${image.id}</span>
                                  <span class="curate-thumb-icon" aria-hidden="true">📷</span>${this.formatCurateDate(image)}
                                </div>
                              ` : ''}
                            </div>
                          `) : html`
                            <div class="col-span-full flex items-center justify-center py-6">
                              <span class="curate-spinner large" aria-hidden="true"></span>
                            </div>
                          `}
                        </div>
                      </div>
                    `;
                  })}
                </div>
              ` : html`
                <div class="p-8 text-center text-gray-500 ${showBrowseByFolderOverlay ? 'pointer-events-none blur-sm' : ''}">
                  <p class="text-sm">Select folders and apply to browse images.</p>
                </div>
              `}
            </div>
            `}
            <div class="p-2">
              ${browsePagination}
            </div>
          </div>
        </div>

        <right-panel
          .tools=${[
            { id: 'tags', label: 'Tags' },
            { id: 'lists', label: 'Lists' },
            { id: 'ratings', label: 'Ratings' },
          ]}
          .activeTool=${this.rightPanelTool}
          @tool-changed=${(event) => this._handleRightPanelToolChange(event.detail.tool)}
        >
          <hotspot-targets-panel
            slot="tool-tags"
            mode="tags"
            .targets=${this.browseHotspotTargets}
            .keywordsByCategory=${this._getKeywordsByCategory()}
            .dragTargetId=${this._browseHotspotDragTarget}
            @hotspot-keyword-change=${(event) => this._browseHotspotHandlers.handleKeywordChange({ target: { value: event.detail.value } }, event.detail.targetId)}
            @hotspot-action-change=${(event) => this._browseHotspotHandlers.handleActionChange({ target: { value: event.detail.value } }, event.detail.targetId)}
            @hotspot-add=${() => this._browseHotspotHandlers.handleAddTarget()}
            @hotspot-remove=${(event) => this._browseHotspotHandlers.handleRemoveTarget(event.detail.targetId)}
            @hotspot-dragover=${(event) => this._browseHotspotHandlers.handleDragOver(event.detail.event, event.detail.targetId)}
            @hotspot-dragleave=${() => this._browseHotspotHandlers.handleDragLeave()}
            @hotspot-drop=${(event) => this._browseHotspotHandlers.handleDrop(event.detail.event, event.detail.targetId)}
          ></hotspot-targets-panel>
          <list-targets-panel
            slot="tool-lists"
            .listsLoading=${this._listsLoading}
            .listTargets=${this._listTargets}
            .lists=${this._lists}
            .listDragTargetId=${this._listDragTargetId}
            .renderCurateRatingWidget=${this.renderCurateRatingWidget}
            .renderCurateRatingStatic=${this.renderCurateRatingStatic}
            .renderCuratePermatagSummary=${this.renderCuratePermatagSummary}
            .formatCurateDate=${this.formatCurateDate}
            @list-target-select=${(event) => this._handleListTargetSelect(event.detail.targetId, event.detail.value)}
            @list-target-remove=${(event) => this._handleRemoveListTarget(event.detail.targetId)}
            @list-target-mode=${(event) => this._handleListTargetModeChange(event.detail.targetId, event.detail.mode)}
            @list-target-draft-change=${(event) => this._handleListTargetDraftChange(event.detail.targetId, event.detail.value)}
            @list-target-create-save=${(event) => this._handleListTargetCreateSave(event.detail.targetId)}
            @list-target-create-cancel=${(event) => this._handleListTargetCreateCancel(event.detail.targetId)}
            @list-target-dragover=${(event) => this._handleListTargetDragOver(event.detail.targetId)}
            @list-target-dragleave=${(event) => this._handleListTargetDragLeave(event.detail.targetId)}
            @list-target-drop=${(event) => this._handleListTargetDrop(event.detail.event, event.detail.targetId)}
            @list-target-item-click=${(event) => this._handleListTargetItemClick(event.detail.event, event.detail.targetId, event.detail.index)}
            @list-target-add=${this._handleAddListTarget}
          ></list-targets-panel>
          <rating-target-panel
            slot="tool-ratings"
            .targets=${this.browseRatingTargets}
            .dragTargetId=${this._browseRatingDragTarget}
            @rating-change=${(event) => this._handleBrowseRatingChange(event.detail.targetId, event.detail.value)}
            @rating-add=${this._handleBrowseRatingAddTarget}
            @rating-remove=${(event) => this._handleBrowseRatingRemoveTarget(event.detail.targetId)}
            @rating-dragover=${(event) => this._handleBrowseRatingDragOver(event.detail.event, event.detail.targetId)}
            @rating-dragleave=${(event) => this._handleBrowseRatingDragLeave(event.detail.event)}
            @rating-drop=${(event) => this._handleBrowseRatingDrop(event.detail.event, event.detail.targetId)}
          ></rating-target-panel>
        </right-panel>
      </div>
    `;
  }
}

customElements.define('curate-browse-folder-tab', CurateBrowseFolderTab);
