import { LitElement, html } from 'lit';
import { enqueueCommand } from '../services/command-queue.js';
import { getDropboxFolders, getLists, createList, getListItems } from '../services/api.js';
import { createSelectionHandlers } from './shared/selection-handlers.js';
import { renderResultsPagination } from './shared/pagination-controls.js';
import { renderSelectableImageGrid } from './shared/selectable-image-grid.js';
import {
  buildHotspotHistorySessionKey,
  createHotspotHistoryBatch,
  getVisibleHistoryBatches,
  loadHotspotHistorySessionState,
  loadPreviousHistoryBatchCount,
  parseDraggedImageIds,
  prependHistoryBatch,
  readDragImagePayload,
  saveHotspotHistorySessionState,
  setDragImagePayload,
} from './shared/hotspot-history.js';
import {
  getKeywordsByCategory,
  getCategoryCount,
  getKeywordsByCategoryFromList,
  getCategoryCountFromList,
} from './shared/keyword-utils.js';
import './shared/widgets/filter-chips.js';
import './shared/widgets/right-panel.js';
import './shared/widgets/list-targets-panel.js';
import './shared/widgets/hotspot-targets-panel.js';
import './shared/widgets/rating-target-panel.js';

/**
 * Curate Explore Tab Component
 *
 * Main curate workflow interface with:
 * - Image grid with rating and permatag overlays
 * - Multi-select via long-press and drag
 * - "Hotspots" feature for quick drag & drop rating/tagging
 * - Advanced filtering integration
 * - Pagination controls
 * - Reordering via drag & drop
 *
 * @property {String} tenant - Current tenant ID
 * @property {Array} images - Filtered/paginated image list
 * @property {Number} thumbSize - Thumbnail size (80-220px)
 * @property {String} orderBy - Sort field ('photo_creation', 'processed', 'rating')
 * @property {String} dateOrder - Date sort order ('asc', 'desc')
 * @property {Number} limit - Items per page
 * @property {Number} offset - Pagination offset
 * @property {Number} total - Total image count
 * @property {Boolean} loading - Loading state
 * @property {Array} dragSelection - Selected image IDs
 * @property {Boolean} dragSelecting - Multi-select mode active
 * @property {Object} renderCurateRatingWidget - Rating widget renderer (from parent)
 * @property {Object} renderCurateRatingStatic - Static rating renderer (from parent)
 * @property {Object} formatCurateDate - Date formatter (from parent)
 * @property {Object} imageStats - Image statistics
 * @property {Object} curateCategoryCards - Category card data
 * @property {String} selectedKeywordValueMain - Selected keyword filter
 * @property {String|Number} minRating - Active rating filter value
 * @property {String} dropboxPathPrefix - Active Dropbox folder filter
 * @property {Array} dropboxFolders - Dropbox folder options
 * @property {Array} curateExploreTargets - Hotspot targets
 * @property {Boolean} curateExploreRatingEnabled - Rating hotspot enabled
 * @property {Number} curateExploreRatingCount - Rating hotspot count
 *
 * @fires images-loaded - When images are loaded
 * @fires image-clicked - When user clicks an image
 * @fires rating-changed - When image rating changes
 * @fires permatag-changed - When permatag is added/removed
 * @fires selection-changed - When drag selection changes
 * @fires thumb-size-changed - When thumbnail size changes
 * @fires sort-changed - When sort order changes
 * @fires advanced-toggled - When advanced filter panel is toggled
 * @fires pagination-changed - When pagination changes
 * @fires refresh-requested - When refresh is requested
 * @fires keyword-selected - When keyword filter changes
 * @fires hotspot-changed - When hotspot configuration changes
 * @fires rating-drop - When images dropped on rating zone
 * @fires curate-filters-changed - When filter chips change
 */
export class CurateExploreTab extends LitElement {
  // Use Light DOM to access Tailwind CSS classes
  createRenderRoot() {
    return this;
  }

  static properties = {
    tenant: { type: String },
    images: { type: Array },
    thumbSize: { type: Number },
    orderBy: { type: String },
    dateOrder: { type: String },
    limit: { type: Number },
    offset: { type: Number },
    total: { type: Number },
    loading: { type: Boolean },
    dragSelection: { type: Array },
    dragSelecting: { type: Boolean },
    dragStartIndex: { type: Number },
    dragEndIndex: { type: Number },
    renderCurateRatingWidget: { type: Object },
    renderCurateRatingStatic: { type: Object },
    renderCuratePermatagSummary: { type: Object },
    renderCurateAiMLScore: { type: Object },
    formatCurateDate: { type: Object },
    imageStats: { type: Object },
    curateCategoryCards: { type: Array },
    selectedKeywordValueMain: { type: String },
    curateKeywordFilters: { type: Object },
    curateKeywordOperators: { type: Object },
    curateNoPositivePermatags: { type: Boolean },
    minRating: { type: Object },
    dropboxPathPrefix: { type: String },
    filenameQuery: { type: String },
    listFilterId: { type: [String, Number] },
    listFilterMode: { type: String },
    dropboxFolders: { type: Array },
    tagStatsBySource: { type: Object },
    activeCurateTagSource: { type: String },
    keywords: { type: Array },
    curateExploreTargets: { type: Array },
    curateExploreRatingEnabled: { type: Boolean },
    curateExploreRatingCount: { type: Number },
    curateExploreRatingTargets: { type: Array },
    rightPanelTool: { type: String },
    _listTargets: { type: Array, state: true },
    _lists: { type: Array, state: true },
    _listsLoading: { type: Boolean, state: true },
    _listDragTargetId: { type: String, state: true },

    // Internal state properties
    _curatePressActive: { type: Boolean, state: true },
    _curatePressStart: { type: Object, state: true },
    _curatePressIndex: { type: Number, state: true },
    _curatePressImageId: { type: Number, state: true },
    _curatePressTimer: { type: Number, state: true },
    _curateLongPressTriggered: { type: Boolean, state: true },
    _curateFlashSelectionIds: { type: Object, state: true },
    _curateExploreHotspotDragTarget: { type: String, state: true },
    _curateExploreRatingDragTarget: { type: String, state: true },
    _curateReorderDraggedId: { type: Number, state: true },
    _curateLeftOrder: { type: Array, state: true },
    _curateSuppressClick: { type: Boolean, state: true },
    curateResultsView: { type: String, state: true },
    _curateHotspotHistoryBatches: { type: Array, state: true },
    _curateHotspotHistoryVisibleBatches: { type: Number, state: true },
  };

  constructor() {
    super();
    this.tenant = '';
    this.images = [];
    this.thumbSize = 120;
    this.orderBy = 'photo_creation';
    this.dateOrder = 'desc';
    this.limit = 100;
    this.offset = 0;
    this.total = 0;
    this.loading = false;
    this.dragSelection = [];
    this.dragSelecting = false;
    this.dragStartIndex = null;
    this.dragEndIndex = null;
    this.renderCurateRatingWidget = null;
    this.renderCurateRatingStatic = null;
    this.renderCuratePermatagSummary = null;
    this.renderCurateAiMLScore = null;
    this.formatCurateDate = null;
    this.imageStats = null;
    this.curateCategoryCards = [];
    this.selectedKeywordValueMain = '';
    this.curateKeywordFilters = {};
    this.curateKeywordOperators = {};
    this.curateNoPositivePermatags = false;
    this.minRating = null;
    this.dropboxPathPrefix = '';
    this.filenameQuery = '';
    this.listFilterId = '';
    this.listFilterMode = 'include';
    this.dropboxFolders = [];
    this.tagStatsBySource = {};
    this.activeCurateTagSource = '';
    this.keywords = [];
    this.curateExploreTargets = [{ id: '1', type: 'keyword', count: 0 }];
    this.curateExploreRatingEnabled = false;
    this.curateExploreRatingCount = 0;
    this.curateExploreRatingTargets = [{ id: 'rating-1', rating: '', count: 0 }];
    this._curateExploreRatingNextId = 2;
    this.rightPanelTool = 'tags';
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
    this._curateDropboxFetchTimer = null;
    this._curateDropboxQuery = '';

    try {
      const storedTool = localStorage.getItem('rightPanelTool:curate-explore');
      if (storedTool) {
        this.rightPanelTool = storedTool === 'hotspots' ? 'tags' : storedTool;
      }
    } catch {
      // ignore storage errors
    }

    // Internal state
    this._curatePressActive = false;
    this._curatePressStart = null;
    this._curatePressIndex = null;
    this._curatePressImageId = null;
    this._curatePressTimer = null;
    this._curateLongPressTriggered = false;
    this._curateFlashSelectionIds = new Set();
    this._curateExploreHotspotDragTarget = null;
    this._curateExploreRatingDragTarget = null;
    this._curateReorderDraggedId = null;
    this._curateLeftOrder = [];
    this._curateHistoryGroupKey = null;
    this._curateSuppressClick = false;
    this.curateResultsView = 'results';
    this._curateHotspotHistoryBatches = [];
    this._curateHotspotHistoryVisibleBatches = 1;

    // Configure selection handlers
    this._curateSelectionHandlers = createSelectionHandlers(this, {
      selectionProperty: 'dragSelection',
      selectingProperty: 'dragSelecting',
      startIndexProperty: 'dragStartIndex',
      endIndexProperty: 'dragEndIndex',
      pressActiveProperty: '_curatePressActive',
      pressStartProperty: '_curatePressStart',
      pressIndexProperty: '_curatePressIndex',
      pressImageIdProperty: '_curatePressImageId',
      pressTimerProperty: '_curatePressTimer',
      longPressTriggeredProperty: '_curateLongPressTriggered',
      getOrder: () => this._curateLeftOrder || [],
      flashSelection: (imageId) => this._flashCurateSelection(imageId),
    });
    const originalUpdateSelection = this._curateSelectionHandlers.updateSelection.bind(this._curateSelectionHandlers);
    const originalClearSelection = this._curateSelectionHandlers.clearSelection.bind(this._curateSelectionHandlers);
    this._curateSelectionHandlers.updateSelection = () => {
      const before = Array.isArray(this.dragSelection) ? [...this.dragSelection] : [];
      originalUpdateSelection();
      const after = Array.isArray(this.dragSelection) ? [...this.dragSelection] : [];
      if (before.length !== after.length || before.some((id, idx) => id !== after[idx])) {
        this._emitSelectionChanged(after);
      }
    };
    this._curateSelectionHandlers.clearSelection = () => {
      const before = Array.isArray(this.dragSelection) ? [...this.dragSelection] : [];
      originalClearSelection();
      if (before.length) {
        this._emitSelectionChanged([]);
      }
    };

    // Bind selection end handler for window events
    this._handleCurateSelectionEnd = () => {
      if (this.dragSelecting) {
        this.dragSelecting = false;
        this.dragStartIndex = null;
        this.dragEndIndex = null;
      }
      const hadLongPress = this._curateLongPressTriggered;
      this._curateHistoryGroupKey = null;
      this._curateSelectionHandlers.cancelPressState();
      if (hadLongPress) {
        this._curateSuppressClick = true;
      }
    };
  }

  connectedCallback() {
    super.connectedCallback();
    this._restoreCurateHistorySessionState();
    // Listen for pointer/key release to end selection
    window.addEventListener('pointerup', this._handleCurateSelectionEnd);
    window.addEventListener('keyup', this._handleCurateSelectionEnd);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Remove window event listeners
    window.removeEventListener('pointerup', this._handleCurateSelectionEnd);
    window.removeEventListener('keyup', this._handleCurateSelectionEnd);

    // Cancel any active press timers
    if (this._curatePressTimer) {
      clearTimeout(this._curatePressTimer);
    }
  }

  // ========================================
  // Selection Handlers
  // ========================================

  _flashCurateSelection(imageId) {
    this._curateFlashSelectionIds.add(imageId);
    this.requestUpdate();
    setTimeout(() => {
      this._curateFlashSelectionIds.delete(imageId);
      this.requestUpdate();
    }, 300);
  }

  _handleCuratePointerDownWithOrder(event, index, imageId, order) {
    this._curateLeftOrder = order;
    this._curateSelectionHandlers.handlePointerDown(event, index, imageId);
  }

  _handleCuratePointerMove(event) {
    this._curateSelectionHandlers.handlePointerMove(event);
  }

  _handleCurateSelectHoverWithOrder(index, order) {
    this._curateLeftOrder = order;
    this._curateSelectionHandlers.handleSelectHover(index);
  }

  _handleCurateHistoryPointerDown(event, index, imageId, order, groupKey) {
    this._curateHistoryGroupKey = groupKey;
    this._handleCuratePointerDownWithOrder(event, index, imageId, order);
  }

  _handleCurateHistorySelectHover(index, order, groupKey) {
    if (this._curateHistoryGroupKey !== groupKey) {
      return;
    }
    this._handleCurateSelectHoverWithOrder(index, order);
  }

  _handleCurateImageClick(event, image, imageSet) {
    // Don't open modal if we're in selection mode or if long-press was triggered
    if (this.dragSelecting || this._curateLongPressTriggered) {
      event.preventDefault();
      return;
    }
    const order = (imageSet || this.images || [])
      .map((entry) => entry?.id)
      .filter((id) => id !== null && id !== undefined);
    const clickedId = image?.id;
    const index = order.findIndex((id) => String(id) === String(clickedId));
    const selectionResult = this._curateSelectionHandlers.handleClickSelection(event, {
      imageId: clickedId,
      index: index >= 0 ? index : null,
      order,
    });
    if (selectionResult.handled) {
      if (selectionResult.changed) {
        this._emitSelectionChanged(selectionResult.selection);
      }
      return;
    }
    if (event.defaultPrevented) {
      return;
    }
    if (this._curateSuppressClick) {
      this._curateSuppressClick = false;
      return;
    }
    if (this.dragSelection?.length) {
      this.dispatchEvent(new CustomEvent('selection-changed', {
        detail: { selection: [] },
        bubbles: true,
        composed: true
      }));
      return;
    }

    this.dispatchEvent(new CustomEvent('image-clicked', {
      detail: {
        event,
        image,
        imageSet: imageSet || this.images || []
      },
      bubbles: true,
      composed: true
    }));
  }

  _emitSelectionChanged(selection) {
    this.dispatchEvent(new CustomEvent('selection-changed', {
      detail: { selection },
      bubbles: true,
      composed: true
    }));
  }

  // ========================================
  // Selection State Management
  // ========================================

  _cancelCuratePressState() {
    return this._curateSelectionHandlers.cancelPressState();
  }

  // ========================================
  // Reordering Handlers
  // ========================================

  _handleCurateExploreReorderStart(event, image, imageSet = null) {
    if (this.dragSelecting) {
      event.preventDefault();
      return;
    }
    if (this._curatePressActive) {
      this._cancelCuratePressState();
    }

    // Handle dragging selection or single image
    let ids = [image.id];
    if (this.dragSelection.length && this.dragSelection.includes(image.id)) {
      ids = this.dragSelection;
    } else if (this.dragSelection.length) {
      // Clear selection if dragging non-selected image
      this.dispatchEvent(new CustomEvent('selection-changed', {
        detail: { selection: [image.id] },
        bubbles: true,
        composed: true
      }));
    }

    this._curateReorderDraggedId = image.id;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', ids.join(','));
    event.dataTransfer.setData('application/x-zoltag-source', 'available');
    setDragImagePayload(event.dataTransfer, ids, [imageSet || this.images || []]);
  }

  _handleCurateExploreReorderOver(event, targetImageId) {
    if (!this._curateReorderDraggedId) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    // TODO: Visual feedback for reorder target
  }

  _handleCurateExploreReorderEnd(event) {
    this._curateReorderDraggedId = null;
  }

  // ========================================
  // UI Control Handlers
  // ========================================

  _handleCurateQuickSort(orderBy) {
    const newDateOrder = this.orderBy === orderBy
      ? (this.dateOrder === 'asc' ? 'desc' : 'asc')
      : 'desc';

    this.dispatchEvent(new CustomEvent('sort-changed', {
      detail: { orderBy, dateOrder: newDateOrder },
      bubbles: true,
      composed: true
    }));
  }

  _getCurateQuickSortArrow(orderBy) {
    if (this.orderBy !== orderBy) return '';
    return this.dateOrder === 'asc' ? '↑' : '↓';
  }

  _handleCurateKeywordSelect(event, mode) {
    // Pass the original event so parent can access event.target.value
    this.dispatchEvent(new CustomEvent('keyword-selected', {
      detail: { event, mode },
      bubbles: true,
      composed: true
    }));
  }

  _handleCurateChipFiltersChanged(event) {
    const filters = event.detail?.filters || [];
    this.dispatchEvent(new CustomEvent('curate-filters-changed', {
      detail: { filters },
      bubbles: true,
      composed: true
    }));
  }

  _handleListsRequested() {
    this._ensureListsLoaded();
  }

  _handleCurateDropboxInput(event) {
    const query = event.detail?.query ?? '';
    const limit = event.detail?.limit;
    this._curateDropboxQuery = query;
    if (this._curateDropboxFetchTimer) {
      clearTimeout(this._curateDropboxFetchTimer);
    }
    if (query.trim().length === 0) {
      this._fetchDropboxFolders('', limit);
      return;
    }
    if (query.length < 2) {
      this.dropboxFolders = [];
      return;
    }
    this._curateDropboxFetchTimer = setTimeout(() => {
      this._fetchDropboxFolders(query, limit);
    }, 500);
  }

  _handleRightPanelToolChange(tool) {
    this.rightPanelTool = tool;
    try {
      localStorage.setItem('rightPanelTool:curate-explore', tool);
    } catch {
      // ignore storage errors
    }
    if (tool === 'lists') {
      this._ensureListsLoaded();
    }
  }

  updated(changedProperties) {
    if (changedProperties.has('tenant')) {
      this._lists = [];
      this._listsLoading = false;
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
      this._listTargetCounter = 1;
      this.curateExploreRatingTargets = [{ id: 'rating-1', rating: '', count: 0 }];
      this._curateExploreRatingNextId = 2;
      this._curateExploreRatingDragTarget = null;
      this._restoreCurateHistorySessionState();
      if (this.rightPanelTool === 'lists') {
        this._ensureListsLoaded({ force: true });
      }
    }
    if (changedProperties.has('rightPanelTool') && this.rightPanelTool === 'lists') {
      this._ensureListsLoaded();
    }
    if (
      changedProperties.has('tenant')
      || changedProperties.has('curateResultsView')
      || changedProperties.has('_curateHotspotHistoryBatches')
      || changedProperties.has('_curateHotspotHistoryVisibleBatches')
    ) {
      this._persistCurateHistorySessionState();
    }
  }

  async _fetchDropboxFolders(query, limit) {
    if (!this.tenant) return;
    try {
      const response = await getDropboxFolders(this.tenant, { query, limit });
      this.dropboxFolders = response?.folders || [];
    } catch (error) {
      console.error('Error fetching Dropbox folders:', error);
      this.dropboxFolders = [];
    }
  }

  async _ensureListsLoaded({ force = false } = {}) {
    if (!this.tenant) return;
    if (this._listsLoading) return;
    if (!force && this._lists.length) return;
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
            draftTitle: '',
            error: '',
            addedCount: 0,
            items: [],
            itemsError: '',
            itemsListId: '',
          }
        : target
    ));
    const target = this._listTargets.find((entry) => entry.id === targetId);
    if (target?.mode === 'view' && target.listId) {
      this._fetchListTargetItems(targetId, target.listId, { force: true });
    }
    if (selectedValue) {
      this._notifyListFilterExclude(selectedValue);
    }
  }

  _notifyListFilterExclude(listId) {
    const resolvedId = listId ? String(listId) : '';
    if (!resolvedId) return;
    this.dispatchEvent(new CustomEvent('list-filter-exclude', {
      detail: { listId: resolvedId },
      bubbles: true,
      composed: true,
    }));
  }

  _buildNewListTitle() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
      `:${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    return `${stamp} new list`;
  }

  _isDuplicateListTitle(title) {
    if (!title) return false;
    const normalized = title.trim().toLowerCase();
    return (this._lists || []).some(
      (list) => (list.title || '').trim().toLowerCase() === normalized
    );
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
      let resolvedId = newList?.id ?? newList?.list_id ?? newList?.listId ?? null;
      if (newList && resolvedId !== null && resolvedId !== undefined) {
        this._lists = [...(this._lists || []), newList];
      } else {
        await this._ensureListsLoaded({ force: true });
      }
      if (resolvedId === null || resolvedId === undefined) {
        const match = (this._lists || []).find((list) => {
          const title = (list.title || '').trim().toLowerCase();
          return title === trimmedTitle.toLowerCase();
        });
        resolvedId = match?.id ?? match?.list_id ?? match?.listId ?? null;
      }
      if (resolvedId === null || resolvedId === undefined) {
        this._listTargets = this._listTargets.map((entry) => (
          entry.id === targetId
            ? { ...entry, error: 'List created but could not select it.' }
            : entry
        ));
        return;
      }
      this._listTargets = this._listTargets.map((entry) => (
        entry.id === targetId
          ? {
              ...entry,
              listId: String(resolvedId),
              status: '',
              isCreating: false,
              draftTitle: '',
              error: '',
              addedCount: 0,
              items: [],
              itemsError: '',
              itemsListId: String(resolvedId),
            }
          : entry
      ));
      const updated = this._listTargets.find((entry) => entry.id === targetId);
      if (updated?.mode === 'view') {
        this._fetchListTargetItems(targetId, String(resolvedId), { force: true });
      }
      this._notifyListFilterExclude(resolvedId);
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
    if (this._listDragTargetId === targetId) {
      this._listDragTargetId = null;
    }
    const target = this._listTargets.find((entry) => entry.id === targetId);
    if (!target?.listId) {
      this._updateListTargetStatus(targetId, 'Select a list first.');
      return;
    }
    const ids = this._parseCurateDragIds(event);
    if (!ids.length) {
      this._updateListTargetStatus(targetId, 'No images found to add.');
      return;
    }
    this._addImagesToListTarget(targetId, target.listId, ids);
  }

  _handleAddListTarget() {
    const nextId = `list-target-${this._listTargetCounter + 1}`;
    this._listTargetCounter += 1;
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
  }

  _handleRemoveListTarget(targetId) {
    if (this._listTargets.length <= 1) return;
    this._listTargets = this._listTargets.filter((target) => target.id !== targetId);
  }

  _updateListTargetStatus(targetId, status) {
    this._listTargets = this._listTargets.map((target) => (
      target.id === targetId ? { ...target, status } : target
    ));
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

  async _addImagesToListTarget(targetId, listId, ids) {
    const uniqueIds = [...new Set(ids)].filter((id) => Number.isFinite(Number(id)));
    if (!uniqueIds.length) return;
    this._updateListTargetStatus(
      targetId,
      `Queued ${uniqueIds.length} image${uniqueIds.length === 1 ? '' : 's'}.`
    );
    uniqueIds.forEach((id) => {
      enqueueCommand({
        type: 'add-to-list',
        tenantId: this.tenant,
        imageId: id,
        listId,
        description: `list · ${id} → ${listId}`,
      });
    });
    this._lists = (this._lists || []).map((list) => {
      if (String(list.id) !== String(listId)) return list;
      const nextCount = Number.isFinite(list.item_count)
        ? list.item_count + uniqueIds.length
        : undefined;
      return nextCount !== undefined ? { ...list, item_count: nextCount } : list;
    });
    this._listTargets = this._listTargets.map((entry) => {
      if (entry.id !== targetId) return entry;
      const nextItems = entry.itemsListId && String(entry.itemsListId) === String(listId)
        ? [
            ...(entry.items || []),
            ...uniqueIds.map((id) => ({
              photo_id: id,
              photo: {
                id,
                thumbnail_url: `/api/v1/images/${id}/thumbnail`,
              },
            })),
          ]
        : entry.items;
      return {
        ...entry,
        addedCount: (entry.addedCount || 0) + uniqueIds.length,
        items: nextItems,
      };
    });
  }

  _parseCurateDragIds(event) {
    const jsonData = event.dataTransfer?.getData('image-ids');
    if (jsonData) {
      try {
        return JSON.parse(jsonData).map((value) => Number(value)).filter(Number.isFinite);
      } catch {
        return [];
      }
    }
    const textData = event.dataTransfer?.getData('text/plain');
    if (!textData) return [];
    return textData
      .split(',')
      .map((value) => Number(value.trim()))
      .filter(Number.isFinite);
  }

  _buildActiveFiltersFromSelection() {
    const filters = [];

    // Build keyword filter from modern curateKeywordFilters (multi-select support)
    if (this.curateNoPositivePermatags) {
      filters.push({
        type: 'keyword',
        untagged: true,
        displayLabel: 'Keywords',
        displayValue: 'Untagged',
      });
    } else if (this.curateKeywordFilters && Object.keys(this.curateKeywordFilters).length > 0) {
      // Convert Map<category, Set<keyword>> to filter format
      const keywordsByCategory = {};
      Object.entries(this.curateKeywordFilters).forEach(([category, keywords]) => {
        const keywordArray = Array.isArray(keywords) ? keywords : Array.from(keywords || []);
        if (keywordArray.length > 0) {
          keywordsByCategory[category] = keywordArray;
        }
      });

      if (Object.keys(keywordsByCategory).length > 0) {
        // Get operator - use first category's operator or default to 'OR'
        const firstCategory = Object.keys(keywordsByCategory)[0];
        const operator = this.curateKeywordOperators?.[firstCategory] || 'OR';

        filters.push({
          type: 'keyword',
          keywordsByCategory,
          operator,
          displayLabel: 'Keywords',
          displayValue: 'Multiple',
        });
      }
    }

    if (this.minRating !== null && this.minRating !== undefined && this.minRating !== '') {
      const displayValue = this.minRating === 'unrated'
        ? 'Unrated'
        : (this.minRating === 0
          ? html`<span class="text-gray-600" title="Rating 0" aria-label="Trash">🗑</span>`
          : `${this.minRating}+`);
      filters.push({
        type: 'rating',
        value: this.minRating,
        displayLabel: 'Rating',
        displayValue,
      });
    }

    if (this.dropboxPathPrefix) {
      filters.push({
        type: 'folder',
        value: this.dropboxPathPrefix,
        displayLabel: 'Folder',
        displayValue: this.dropboxPathPrefix,
      });
    }

    if (this.filenameQuery) {
      filters.push({
        type: 'filename',
        value: this.filenameQuery,
        displayLabel: 'Filename',
        displayValue: this.filenameQuery,
      });
    }

    if (this.listFilterId) {
      const lists = this._lists || [];
      const match = lists.find((list) => String(list.id) === String(this.listFilterId));
      const title = match?.title || `List ${this.listFilterId}`;
      const mode = this.listFilterMode === 'exclude' ? 'exclude' : 'include';
      const displayValue = mode === 'exclude' ? `Not in ${title}` : title;
      filters.push({
        type: 'list',
        value: this.listFilterId,
        mode,
        displayLabel: 'List',
        displayValue,
      });
    }

    return filters;
  }

  _handleThumbSizeChange(event) {
    const nextSize = Number(event.target.value);
    if (!Number.isFinite(nextSize)) return;
    this.thumbSize = nextSize;
    this.dispatchEvent(new CustomEvent('thumb-size-changed', {
      detail: { size: nextSize },
      bubbles: true,
      composed: true
    }));
  }

  _handleCurateLimitChange = (newLimit) => {
    this.dispatchEvent(new CustomEvent('pagination-changed', {
      detail: { offset: 0, limit: newLimit },
      bubbles: true,
      composed: true
    }));
  };

  _handleCuratePagePrev = () => {
    const newOffset = Math.max(0, this.offset - this.limit);
    this.dispatchEvent(new CustomEvent('pagination-changed', {
      detail: { offset: newOffset, limit: this.limit },
      bubbles: true,
      composed: true
    }));
  };

  _handleCuratePageNext = () => {
    const newOffset = this.offset + this.limit;
    this.dispatchEvent(new CustomEvent('pagination-changed', {
      detail: { offset: newOffset, limit: this.limit },
      bubbles: true,
      composed: true
    }));
  };

  // ========================================
  // Hotspot Handlers
  // ========================================

  _handleCurateExploreRatingDragOver(event, targetId) {
    event.preventDefault();
    this._curateExploreRatingDragTarget = targetId;
  }

  _handleCurateExploreRatingDragLeave(event) {
    if (event && event.currentTarget !== event.target) return;
    this._curateExploreRatingDragTarget = null;
  }

  _handleCurateExploreRatingDrop(event, targetId) {
    event.preventDefault();
    this._curateExploreRatingDragTarget = null;
    const target = (this.curateExploreRatingTargets || []).find((entry) => entry.id === targetId);
    const rating = target?.rating ?? '';
    const raw = event.dataTransfer?.getData('text/plain') || '';
    const ids = raw
      .split(',')
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value) && value > 0);

    if (ids.length && rating !== '') {
      // Update count for this target
      this.curateExploreRatingTargets = (this.curateExploreRatingTargets || []).map((entry) => (
        entry.id === targetId ? { ...entry, count: (entry.count || 0) + ids.length } : entry
      ));
    }

    // Only dispatch event to parent - parent will handle whether to show dialog or apply directly
    this.dispatchEvent(new CustomEvent('rating-drop', {
      detail: { event, rating },
      bubbles: true,
      composed: true
    }));
  }

  _handleCurateExploreRatingChange(event, targetId) {
    this.curateExploreRatingTargets = (this.curateExploreRatingTargets || []).map((entry) => (
      entry.id === targetId ? { ...entry, rating: event.detail.value, count: entry.count || 0 } : entry
    ));
  }

  _handleCurateExploreRatingAddTarget() {
    const nextId = `rating-${this._curateExploreRatingNextId++}`;
    this.curateExploreRatingTargets = [
      ...(this.curateExploreRatingTargets || []),
      { id: nextId, rating: '', count: 0 },
    ];
  }

  _handleCurateExploreRatingRemoveTarget(targetId) {
    this.curateExploreRatingTargets = (this.curateExploreRatingTargets || []).filter((entry) => entry.id !== targetId);
  }

  _handleCurateExploreHotspotDragOver(event, targetId) {
    event.preventDefault();
    this._curateExploreHotspotDragTarget = targetId;
  }

  _handleCurateExploreHotspotDragLeave(event) {
    this._curateExploreHotspotDragTarget = null;
  }

  _handleCurateExploreHotspotDrop(event, targetId) {
    event.preventDefault();
    this._curateExploreHotspotDragTarget = null;
    this._recordCurateHotspotHistory(event, targetId);

    this.dispatchEvent(new CustomEvent('hotspot-changed', {
      detail: { type: 'hotspot-drop', targetId, event },
      bubbles: true,
      composed: true
    }));
  }

  _handleCurateExploreHotspotTypeChange(event, targetId) {
    const type = event.target.value;
    this.dispatchEvent(new CustomEvent('hotspot-changed', {
      detail: { type: 'type-change', targetId, value: type },
      bubbles: true,
      composed: true
    }));
  }

  _handleCurateExploreHotspotRatingChange(event, targetId) {
    const rating = event.target.value;
    this.dispatchEvent(new CustomEvent('hotspot-changed', {
      detail: { type: 'rating-change', targetId, value: rating },
      bubbles: true,
      composed: true
    }));
  }

  _handleCurateExploreHotspotKeywordChange(event, targetId) {
    const keyword = event.target.value;
    this.dispatchEvent(new CustomEvent('hotspot-changed', {
      detail: { type: 'keyword-change', targetId, value: keyword },
      bubbles: true,
      composed: true
    }));
  }

  _handleCurateExploreHotspotActionChange(event, targetId) {
    const action = event.target.value;
    this.dispatchEvent(new CustomEvent('hotspot-changed', {
      detail: { type: 'action-change', targetId, value: action },
      bubbles: true,
      composed: true
    }));
  }

  _handleCurateExploreHotspotRemoveTarget(targetId) {
    this.dispatchEvent(new CustomEvent('hotspot-changed', {
      detail: { type: 'remove-target', targetId },
      bubbles: true,
      composed: true
    }));
  }

  _handleCurateExploreHotspotAddTarget() {
    this.dispatchEvent(new CustomEvent('hotspot-changed', {
      detail: { type: 'add-target' },
      bubbles: true,
      composed: true
    }));
  }

  _getCurateHistorySessionKey() {
    return buildHotspotHistorySessionKey('curate-explore', this.tenant);
  }

  _restoreCurateHistorySessionState() {
    const state = loadHotspotHistorySessionState(this._getCurateHistorySessionKey(), {
      fallbackView: 'results',
    });
    this.curateResultsView = state.view;
    this._curateHotspotHistoryBatches = state.batches;
    this._curateHotspotHistoryVisibleBatches = state.visibleCount;
  }

  _persistCurateHistorySessionState() {
    saveHotspotHistorySessionState(this._getCurateHistorySessionKey(), {
      view: this.curateResultsView,
      batches: this._curateHotspotHistoryBatches,
      visibleCount: this._curateHotspotHistoryVisibleBatches,
    });
  }

  _setCurateResultsView(nextView) {
    this.curateResultsView = nextView === 'history' ? 'history' : 'results';
    this.dragSelection = [];
    if (this.curateResultsView !== 'history') {
      this._curateHistoryGroupKey = null;
    }
    if (this.curateResultsView === 'history' && this._curateHotspotHistoryVisibleBatches < 1) {
      this._curateHotspotHistoryVisibleBatches = 1;
    }
  }

  _recordCurateHotspotHistory(event, targetId) {
    const target = (this.curateExploreTargets || []).find((entry) => entry.id === targetId);
    const ids = parseDraggedImageIds(event?.dataTransfer);
    if (!target || !ids.length) return;
    if (target.type === 'rating') {
      const rating = Number.parseInt(String(target.rating ?? ''), 10);
      if (!Number.isFinite(rating)) return;
    } else if (!target.keyword) {
      return;
    }
    const batch = createHotspotHistoryBatch({
      ids,
      dragImages: readDragImagePayload(event?.dataTransfer),
      imageSets: [this.images || []],
      target,
      sourceLabel: 'Curate Results',
    });
    if (!batch) return;
    this._curateHotspotHistoryBatches = prependHistoryBatch(this._curateHotspotHistoryBatches, batch);
    if (this._curateHotspotHistoryVisibleBatches < 1) {
      this._curateHotspotHistoryVisibleBatches = 1;
    }
  }

  _loadPreviousCurateHistoryBatches() {
    const total = this._curateHotspotHistoryBatches.length;
    if (!total) return;
    const next = loadPreviousHistoryBatchCount(this._curateHotspotHistoryVisibleBatches, 5);
    this._curateHotspotHistoryVisibleBatches = Math.min(total, next);
  }

  _renderCurateHistoryPane() {
    const visibleBatches = getVisibleHistoryBatches(
      this._curateHotspotHistoryBatches,
      this._curateHotspotHistoryVisibleBatches
    );
    if (!visibleBatches.length) {
      return html`
        <div class="p-6 text-center text-sm text-gray-500">
          No hotspot history yet. Drag images to a hotspot, then open Hotspot History.
        </div>
      `;
    }
    const canLoadPrevious = visibleBatches.length < this._curateHotspotHistoryBatches.length;
    return html`
      <div class="hotspot-history-pane">
        ${visibleBatches.map((batch, index) => {
          const order = (batch.images || []).map((image) => image.id);
          return html`
          <div class="hotspot-history-batch" data-history-batch-id=${batch.batchId}>
            <div class="hotspot-history-batch-header">
              <span class="hotspot-history-batch-title">${index === 0 ? 'Latest Batch' : `Batch ${index + 1}`}</span>
              <span class="hotspot-history-batch-meta">${batch.images.length} items · ${batch.targetLabel}</span>
            </div>
            ${renderSelectableImageGrid({
              images: batch.images,
              selection: this.dragSelection,
              flashSelectionIds: this._curateFlashSelectionIds,
              selectionHandlers: this._curateSelectionHandlers,
              renderFunctions: {
                renderCurateRatingWidget: this.renderCurateRatingWidget,
                renderCurateRatingStatic: this.renderCurateRatingStatic,
                renderCuratePermatagSummary: this.renderCuratePermatagSummary,
                renderCurateAiMLScore: this.renderCurateAiMLScore,
                formatCurateDate: this.formatCurateDate,
              },
              onImageClick: (dragEvent, image) => this._handleCurateImageClick(dragEvent, image, batch.images),
              onDragStart: (dragEvent, image) => this._handleCurateExploreReorderStart(dragEvent, image, batch.images),
              selectionEvents: {
                pointerDown: (dragEvent, itemIndex, imageId, imageOrder, groupKey) =>
                  this._handleCurateHistoryPointerDown(dragEvent, itemIndex, imageId, imageOrder, groupKey),
                pointerMove: (dragEvent) => this._handleCuratePointerMove(dragEvent),
                pointerEnter: (itemIndex, imageOrder, groupKey) =>
                  this._handleCurateHistorySelectHover(itemIndex, imageOrder, groupKey),
                order,
                groupKey: batch.batchId,
              },
              options: {
                enableReordering: false,
                showPermatags: true,
                showAiScore: true,
                emptyMessage: 'No images in this batch.',
              },
            })}
          </div>
        `;
        })}
        <div class="hotspot-history-footer">
          <button
            class="curate-pane-action secondary"
            @click=${this._loadPreviousCurateHistoryBatches}
            ?disabled=${!canLoadPrevious}
          >
            Previous
          </button>
        </div>
      </div>
    `;
  }

  // ========================================
  // Helper Methods
  // ========================================

  _getKeywordsByCategory() {
    if (this.keywords && this.keywords.length) {
      return getKeywordsByCategoryFromList(this.keywords);
    }
    return getKeywordsByCategory(this.tagStatsBySource, this.activeCurateTagSource);
  }

  _getCategoryCount(category) {
    if (this.keywords && this.keywords.length) {
      return getCategoryCountFromList(this.keywords, category);
    }
    return getCategoryCount(this.tagStatsBySource, category, this.activeCurateTagSource);
  }

  // ========================================
  // Render
  // ========================================

  render() {
    const leftImages = (this.images || []).filter((image) => image && image.id);
    const offset = this.offset ?? 0;
    const limit = this.limit ?? 100;
    const total = this.total ?? 0;
    const totalFormatted = total.toLocaleString('en-US');
    const leftPaneLabel = `Images (${total})`;
    const totalLabel = `${totalFormatted} ITEMS`;
    const curateCountLabel = `${offset + 1}-${Math.min(offset + limit, total)} OF ${totalFormatted}`;
    const curateHasPrev = offset > 0;
    const curateHasMore = offset + limit < total;
    const activeFilters = this._buildActiveFiltersFromSelection();
    // Update left order for selection
    this._curateLeftOrder = leftImages.map(img => img.id);

    return html`
      <div>
        <div class="curate-header-layout search-header-layout">
          <div class="w-full">
            <filter-chips
              .tenant=${this.tenant}
              .tagStatsBySource=${this.tagStatsBySource}
              .activeCurateTagSource=${this.activeCurateTagSource || 'permatags'}
              .keywords=${this.keywords}
              .imageStats=${this.imageStats}
              .activeFilters=${activeFilters}
              .dropboxFolders=${this.dropboxFolders || []}
              .lists=${this._lists}
              .renderSortControls=${() => html`
                <div class="flex items-center gap-2">
                  <span class="text-sm font-semibold text-gray-700">Sort:</span>
                  <div class="curate-audit-toggle">
                    <button
                      class=${this.orderBy === 'rating' ? 'active' : ''}
                      @click=${() => this._handleCurateQuickSort('rating')}
                    >
                      Rating ${this._getCurateQuickSortArrow('rating')}
                    </button>
                    <button
                      class=${this.orderBy === 'photo_creation' ? 'active' : ''}
                      @click=${() => this._handleCurateQuickSort('photo_creation')}
                    >
                      Photo Date ${this._getCurateQuickSortArrow('photo_creation')}
                    </button>
                    <button
                      class=${this.orderBy === 'processed' ? 'active' : ''}
                      @click=${() => this._handleCurateQuickSort('processed')}
                    >
                      Process Date ${this._getCurateQuickSortArrow('processed')}
                    </button>
                  </div>
                </div>
              `}
              @filters-changed=${this._handleCurateChipFiltersChanged}
              @folder-search=${this._handleCurateDropboxInput}
              @lists-requested=${this._handleListsRequested}
            ></filter-chips>
          </div>
          <div></div>
        </div>

        <div class="curate-layout mt-4" style="--curate-thumb-size: ${this.thumbSize}px;">
          <div class="curate-pane">
              <div class="curate-pane-header" style="padding: 4px;">
                  <div class="curate-pane-header-row">
                    <div class="curate-audit-toggle">
                      <button
                        class=${this.curateResultsView === 'results' ? 'active' : ''}
                        @click=${() => this._setCurateResultsView('results')}
                      >
                        Results
                      </button>
                      <button
                        class=${this.curateResultsView === 'history' ? 'active' : ''}
                        @click=${() => this._setCurateResultsView('history')}
                      >
                        Hotspot History
                      </button>
                    </div>
                    ${this.curateResultsView === 'results' ? renderResultsPagination({
                      total,
                      offset,
                      limit,
                      count: leftImages.length,
                      onPrev: this._handleCuratePagePrev,
                      onNext: this._handleCuratePageNext,
                      onLimitChange: (e) => this._handleCurateLimitChange(Number(e.target.value)),
                      disabled: this.loading,
                    }) : html``}
                  </div>
              </div>
              ${this.loading ? html`
                <div class="curate-loading-overlay" aria-label="Loading">
                  <span class="curate-spinner large"></span>
                </div>
              ` : html``}
              <div class="curate-pane-body">
                  ${this.curateResultsView === 'history' ? html`
                    ${this._renderCurateHistoryPane()}
                  ` : html`
                    ${renderSelectableImageGrid({
                      images: leftImages,
                      selection: this.dragSelection,
                      flashSelectionIds: this._curateFlashSelectionIds,
                      selectionHandlers: this._curateSelectionHandlers,
                      renderFunctions: {
                        renderCurateRatingWidget: this.renderCurateRatingWidget,
                        renderCurateRatingStatic: this.renderCurateRatingStatic,
                        renderCuratePermatagSummary: this.renderCuratePermatagSummary,
                        renderCurateAiMLScore: this.renderCurateAiMLScore,
                        formatCurateDate: this.formatCurateDate,
                      },
                      onImageClick: (event, image) => this._handleCurateImageClick(event, image, leftImages),
                      onDragStart: (event, image) => this._handleCurateExploreReorderStart(event, image, leftImages),
                      dragHandlers: {
                        onDragOver: (event, targetImageId) => this._handleCurateExploreReorderOver(event, targetImageId),
                        onDragEnd: (event) => this._handleCurateExploreReorderEnd(event),
                      },
                      selectionEvents: {
                        pointerDown: (event, index, imageId, imageOrder) =>
                          this._handleCuratePointerDownWithOrder(event, index, imageId, imageOrder),
                        pointerMove: (event) => this._handleCuratePointerMove(event),
                        pointerEnter: (index, imageOrder) => this._handleCurateSelectHoverWithOrder(index, imageOrder),
                        order: this._curateLeftOrder,
                      },
                      options: {
                        enableReordering: true,
                        showPermatags: true,
                        showAiScore: true,
                        emptyMessage: 'No images available.',
                      },
                    })}
                    ${renderResultsPagination({
                      total,
                      offset,
                      limit,
                      count: leftImages.length,
                      onPrev: this._handleCuratePagePrev,
                      onNext: this._handleCuratePageNext,
                      onLimitChange: (e) => this._handleCurateLimitChange(Number(e.target.value)),
                      disabled: this.loading,
                    })}
                  `}
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
              .targets=${this.curateExploreTargets}
              .keywordsByCategory=${this._getKeywordsByCategory()}
              .dragTargetId=${this._curateExploreHotspotDragTarget}
              @hotspot-keyword-change=${(event) => this._handleCurateExploreHotspotKeywordChange({ target: { value: event.detail.value } }, event.detail.targetId)}
              @hotspot-action-change=${(event) => this._handleCurateExploreHotspotActionChange({ target: { value: event.detail.value } }, event.detail.targetId)}
              @hotspot-add=${this._handleCurateExploreHotspotAddTarget}
              @hotspot-remove=${(event) => this._handleCurateExploreHotspotRemoveTarget(event.detail.targetId)}
              @hotspot-dragover=${(event) => this._handleCurateExploreHotspotDragOver(event.detail.event, event.detail.targetId)}
              @hotspot-dragleave=${this._handleCurateExploreHotspotDragLeave}
              @hotspot-drop=${(event) => this._handleCurateExploreHotspotDrop(event.detail.event, event.detail.targetId)}
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
              .targets=${this.curateExploreRatingTargets}
              .dragTargetId=${this._curateExploreRatingDragTarget}
              @rating-change=${(event) => this._handleCurateExploreRatingChange(event, event.detail.targetId)}
              @rating-add=${this._handleCurateExploreRatingAddTarget}
              @rating-remove=${(event) => this._handleCurateExploreRatingRemoveTarget(event.detail.targetId)}
              @rating-dragover=${(event) => this._handleCurateExploreRatingDragOver(event.detail.event, event.detail.targetId)}
              @rating-dragleave=${(event) => this._handleCurateExploreRatingDragLeave(event.detail.event)}
              @rating-drop=${(event) => {
                event.stopPropagation(); // Prevent original event from bubbling to parent
                this._handleCurateExploreRatingDrop(event.detail.event, event.detail.targetId);
              }}
            ></rating-target-panel>
          </right-panel>
        </div>
      </div>
    `;
  }
}

customElements.define('curate-explore-tab', CurateExploreTab);
