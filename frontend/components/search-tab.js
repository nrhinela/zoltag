import { LitElement, html } from 'lit';
import { enqueueCommand } from '../services/command-queue.js';
import {
  getLists,
  createList,
  updateList,
  addToList,
  getListItems,
  getDropboxFolders
} from '../services/api.js';
import { createHotspotHandlers, parseUtilityKeywordValue } from './shared/hotspot-controls.js';
import {
  getKeywordsByCategory,
  getKeywordsByCategoryFromList,
} from './shared/keyword-utils.js';
import { createSelectionHandlers } from './shared/selection-handlers.js';
import { renderResultsPagination } from './shared/pagination-controls.js';
import { renderImageGrid } from './shared/image-grid.js';
import './shared/widgets/filter-chips.js';
import './shared/widgets/right-panel.js';
import './shared/widgets/list-targets-panel.js';
import './shared/widgets/hotspot-targets-panel.js';
import './shared/widgets/rating-target-panel.js';
import ImageFilterPanel from './shared/state/image-filter-panel.js';
import FolderBrowserPanel from './folder-browser-panel.js';

/**
 * Search Tab Component
 *
 * ⭐ REFERENCE IMPLEMENTATION for standardized image rendering pattern
 * See lines 136-149 (selection handlers), 369-410 (event handlers), 479-507 (template)
 * Copy this pattern when creating components that display images!
 *
 * Provides search functionality with two modes:
 * - Search Home: Filter-based image search with list management
 * - Browse by Folder: Browse images grouped by folder
 * - Natural Search: Experimental NL query flow
 * - Explore: Tag chip based navigation
 *
 * @property {String} tenant - Current tenant ID
 * @property {String} searchSubTab - Active subtab ('home', 'browse-by-folder', 'natural-search', 'chips')
 * @property {Array} searchChipFilters - Current filter chip selections
 * @property {Array} searchDropboxOptions - Dropbox folder options
 * @property {Array} searchImages - Images from filter panel
 * @property {Set} searchSelectedImages - Selected image IDs
 * @property {Array} searchLists - Available lists
 * @property {String} searchListId - Currently selected list ID
 * @property {String} searchListTitle - Draft list title
 * @property {Array} searchSavedImages - Images saved to current list
 * @property {Number} curateThumbSize - Thumbnail size
 * @property {Object} tagStatsBySource - Tag statistics
 * @property {Array} keywords - Flat keyword list for faster dropdowns
 * @property {String} activeCurateTagSource - Active tag source
 * @property {Object} imageStats - Image statistics
 * @property {String} searchOrderBy - Sort field
 * @property {String} searchDateOrder - Date sort order
 *
 * @fires search-subtab-changed - When user changes subtab
 * @fires search-filters-changed - When search filters change
 * @fires search-list-created - When a new list is created
 * @fires search-list-updated - When a list is updated
 * @fires thumb-size-changed - When thumbnail size changes
 * @fires sort-changed - When sort order changes
 * @fires image-selected - When an image is selected
 */
export class SearchTab extends LitElement {
  // Use Light DOM to access Tailwind CSS classes
  createRenderRoot() {
    return this;
  }

  static properties = {
    tenant: { type: String },
    searchSubTab: { type: String },
    searchChipFilters: { type: Array, state: true },  // Internal state - managed by filter-chips component
    searchFilterPanel: { type: Object },
    searchDropboxOptions: { type: Array },
    searchImages: { type: Array },
    searchSelectedImages: { type: Object },
    searchTotal: { type: Number },
    searchLists: { type: Array },
    searchListId: { type: String, state: true },  // Internal state - not controlled by parent
    searchListTitle: { type: String, state: true },  // Internal state - not controlled by parent
    searchListItems: { type: Array, state: true },  // Internal state - not controlled by parent
    searchListError: { type: String, state: true },  // Internal state - not controlled by parent
    searchListExcludeId: { type: [String, Number], state: true },
    searchSavedImages: { type: Array },
    browseByFolderOptions: { type: Array, state: true },
    browseByFolderSelection: { type: Array, state: true },
    browseByFolderAppliedSelection: { type: Array, state: true },
    browseByFolderData: { type: Object, state: true },
    browseByFolderLoading: { type: Boolean, state: true },
    browseByFolderAccordionOpen: { type: Boolean, state: true },
    browseByFolderQuery: { type: String, state: true },
    browseByFolderOffset: { type: Number, state: true },
    browseByFolderLimit: { type: Number, state: true },
    searchRefreshing: { type: Boolean },
    hideSubtabs: { type: Boolean },
    initialExploreSelection: { type: Object },
    curateThumbSize: { type: Number },
    tagStatsBySource: { type: Object },
    activeCurateTagSource: { type: String },
    keywords: { type: Array },
    imageStats: { type: Object },
    searchOrderBy: { type: String },
    searchDateOrder: { type: String },
    renderCurateRatingWidget: { type: Object },
    renderCurateRatingStatic: { type: Object },
    renderCuratePermatagSummary: { type: Object },
    formatCurateDate: { type: Object },
    searchDragSelection: { type: Array },
    searchDragSelecting: { type: Boolean },
    searchDragStartIndex: { type: Number },
    searchDragEndIndex: { type: Number },
    searchSavedDragTarget: { type: Boolean },
    rightPanelTool: { type: String },
    searchHotspotTargets: { type: Array },
    searchHotspotRatingEnabled: { type: Boolean },
    searchHotspotRatingCount: { type: Number },
    searchRatingTargets: { type: Array },
    _searchHotspotDragTarget: { type: String, state: true },
    _searchRatingDragTarget: { type: String, state: true },
    _searchRatingModalActive: { type: Boolean, state: true },
    _searchRatingModalImageIds: { type: Array, state: true },
    _listTargets: { type: Array, state: true },
    _listTargetCounter: { type: Number, state: true },
    _listDragTargetId: { type: String, state: true },
    _listsLoading: { type: Boolean, state: true },
  };

  constructor() {
    super();
    this.tenant = '';
    this.searchSubTab = 'home';
    this.searchChipFilters = [];
    this.searchFilterPanel = null;
    this.searchDropboxOptions = [];
    this.searchImages = [];
    this.searchSelectedImages = new Set();
    this.searchTotal = 0;
    this.searchLists = [];
    this.searchListId = null;
    this.searchListTitle = '';
    this.searchListItems = [];
    this.searchListError = '';
    this.searchListExcludeId = '';
    this.searchSavedImages = [];
    this.browseByFolderOptions = [];
    this.browseByFolderSelection = [];
    this.browseByFolderAppliedSelection = [];
    this.browseByFolderData = {};
    this.browseByFolderLoading = false;
    this.browseByFolderAccordionOpen = true;
    this.browseByFolderQuery = '';
    this.browseByFolderOffset = 0;
    this.browseByFolderLimit = 100;
    this.searchRefreshing = false;
    this.hideSubtabs = false;
    this.initialExploreSelection = null;
    this.curateThumbSize = 120;
    this.tagStatsBySource = {};
    this.activeCurateTagSource = 'permatags';
    this.keywords = [];
    this.imageStats = null;
    this.searchOrderBy = 'photo_creation';
    this.searchDateOrder = 'desc';
    this.renderCurateRatingWidget = null;
    this.renderCurateRatingStatic = null;
    this.renderCuratePermatagSummary = null;
    this.formatCurateDate = null;
    this.searchDragSelection = [];
    this.searchDragSelecting = false;
    this.searchDragStartIndex = null;
    this.searchDragEndIndex = null;
    this.searchSavedDragTarget = false;
    this.rightPanelTool = 'lists';
    this.searchHotspotTargets = [{ id: 1, type: 'keyword', count: 0 }];
    this.searchHotspotRatingEnabled = false;
    this.searchHotspotRatingCount = 0;
    this.searchRatingTargets = [{ id: 'rating-1', rating: '', count: 0 }];
    this._searchRatingNextId = 2;
    this._searchRatingModalActive = false;
    this._searchRatingModalImageIds = [];
    this._searchHotspotDragTarget = null;
    this._searchRatingDragTarget = null;
    this._searchHotspotNextId = 2;
    this._listTargets = [{
      id: 'list-target-1',
      listId: '',
      status: '',
      mode: 'add',
      addedCount: 0,
      isCreating: false,
      draftTitle: '',
      error: '',
      items: [],
      itemsLoading: false,
      itemsError: '',
      itemsListId: '',
    }];
    this._listTargetCounter = 1;
    this._listDragTargetId = null;
    this._listsLoading = false;
    this._searchHotspotHandlers = createHotspotHandlers(this, {
      targetsProperty: 'searchHotspotTargets',
      dragTargetProperty: '_searchHotspotDragTarget',
      nextIdProperty: '_searchHotspotNextId',
      parseKeywordValue: parseUtilityKeywordValue,
      applyRating: (ids, rating) => this._applySearchHotspotRating(ids, rating),
      processTagDrop: (ids, target) => this._processSearchHotspotTagDrop(ids, target),
      removeImages: () => {},
    });
    try {
      const storedTool = localStorage.getItem('rightPanelTool:search');
      if (storedTool && storedTool === 'lists') {
        this.rightPanelTool = storedTool;
      } else {
        this.rightPanelTool = 'lists';
      }
    } catch {
      // ignore storage errors
    }
    this._searchSuppressClick = false;
    this._searchFlashSelectionIds = new Set();
    this._searchPressActive = false;
    this._searchPressStart = null;
    this._searchPressIndex = null;
    this._searchPressImageId = null;
    this._searchPressTimer = null;
    this._searchLongPressTriggered = false;
    this._searchInitialLoadComplete = false;
    this._searchInitialLoadPending = false;
    this._searchBrowseOrder = null;
    this._searchBrowseGroupKey = null;
    this._searchFilterPanelHandlers = null;
    this._folderBrowserPanelHandlers = null;
    this._searchDropboxFetchTimer = null;
    this._searchListDropRefreshTimer = null;
    this._searchDropboxQuery = '';
    this.folderBrowserPanel = new FolderBrowserPanel('search');

    // Debounce tracking for list fetches
    this._lastListFetchTime = 0;
    this._listFetchDebounceMs = 5000; // 5 seconds

    // Prevent conflicts with curate selection handlers
    this.curateDragSelecting = false;
    this.curateAuditDragSelecting = false;

    // ⭐ REFERENCE: Selection handler configuration for long-press multi-select
    // This pattern is REQUIRED for all components displaying images
    // See shared/selection-handlers.js createSelectionHandlers() documentation for details
    this._searchSelectionHandlers = createSelectionHandlers(this, {
      selectionProperty: 'searchDragSelection',
      selectingProperty: 'searchDragSelecting',
      startIndexProperty: 'searchDragStartIndex',
      endIndexProperty: 'searchDragEndIndex',
      pressActiveProperty: '_searchPressActive',
      pressStartProperty: '_searchPressStart',
      pressIndexProperty: '_searchPressIndex',
      pressImageIdProperty: '_searchPressImageId',
      pressTimerProperty: '_searchPressTimer',
      longPressTriggeredProperty: '_searchLongPressTriggered',
      suppressClickProperty: '_searchSuppressClick',
      dragSelectOnMove: true,
      getOrder: () => {
        if (this.searchSubTab === 'browse-by-folder') {
          return this._searchBrowseOrder || [];
        }
        return (this.searchImages || []).map(img => img.id);
      },
      flashSelection: (imageId) => this._flashSearchSelection(imageId),
    });
  }

  async _refreshSearch() {
    if (this.searchRefreshing) return;
    this.searchRefreshing = true;
    try {
      const tasks = [];
      if (this.searchSubTab === 'home') {
        tasks.push(this.searchFilterPanel?.fetchImages());
      }
      if (this.searchSubTab === 'browse-by-folder') {
        tasks.push(this.folderBrowserPanel?.loadFolders({ force: true }));
        const dataPromise = this._refreshBrowseByFolderData({ force: true });
        if (dataPromise) {
          tasks.push(dataPromise);
        }
      }
      tasks.push(this._fetchSearchLists({ force: true }));
      await Promise.allSettled(tasks);
    } finally {
      this.searchRefreshing = false;
    }
  }

  // ========================================
  // Lifecycle Methods
  // ========================================

  connectedCallback() {
    super.connectedCallback();
    if (!this.searchListId && !this.searchListTitle) {
      this._resetSearchListDraft();
    }
    this._fetchSearchLists();
    this._setupSearchFilterPanel(this.searchFilterPanel);
    this._syncChipFiltersFromFilterPanel();
    this._setupFolderBrowserPanel();
    this._maybeStartInitialRefresh();

    // Add global pointer handlers for selection
    this._handleSearchGlobalPointerDown = (event) => {
      if (!this.searchDragSelection.length) return;
      const path = event.composedPath ? event.composedPath() : [];
      const clickedThumb = path.some(node =>
        node.classList && node.classList.contains('curate-thumb-wrapper')
      );
      const clickedSelected = clickedThumb && path.some(node =>
        node.classList && node.classList.contains('selected')
      );
      if (clickedSelected) return;
      this.searchDragSelection = [];
      this._searchSuppressClick = true;
    };

    // Selection end handler - called on pointerup and keyup
    this._handleSearchSelectionEnd = () => {
      if (this.searchDragSelecting) {
        this.searchDragSelecting = false;
        this.searchDragStartIndex = null;
        this.searchDragEndIndex = null;
      }
    };

    document.addEventListener('pointerdown', this._handleSearchGlobalPointerDown);
    window.addEventListener('pointerup', this._handleSearchSelectionEnd);
    window.addEventListener('keyup', this._handleSearchSelectionEnd);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._teardownSearchFilterPanel(this.searchFilterPanel);
    this._teardownFolderBrowserPanel();
    if (this._handleSearchGlobalPointerDown) {
      document.removeEventListener('pointerdown', this._handleSearchGlobalPointerDown);
    }
    if (this._handleSearchSelectionEnd) {
      window.removeEventListener('pointerup', this._handleSearchSelectionEnd);
      window.removeEventListener('keyup', this._handleSearchSelectionEnd);
    }
    // Cancel any active press state
    if (this._searchPressTimer) {
      clearTimeout(this._searchPressTimer);
      this._searchPressTimer = null;
    }
    if (this._searchDropboxFetchTimer) {
      clearTimeout(this._searchDropboxFetchTimer);
      this._searchDropboxFetchTimer = null;
    }
    if (this._searchListDropRefreshTimer) {
      clearTimeout(this._searchListDropRefreshTimer);
      this._searchListDropRefreshTimer = null;
    }
  }

  updated(changedProps) {
    if (changedProps.has('tenant') && this.folderBrowserPanel) {
      this.folderBrowserPanel.setTenant(this.tenant);
    }
    if (changedProps.has('tenant')) {
      this.searchHotspotTargets = [{ id: 1, type: 'keyword', count: 0 }];
      this.searchHotspotRatingEnabled = false;
      this.searchHotspotRatingCount = 0;
      this._searchHotspotDragTarget = null;
      this.searchRatingTargets = [{ id: 'rating-1', rating: '', count: 0 }];
      this._searchRatingDragTarget = null;
      this._searchRatingNextId = 2;
      this._searchRatingModalActive = false;
      this._searchRatingModalImageIds = [];
      this._searchHotspotNextId = 2;
      this._listTargets = [{
        id: 'list-target-1',
        listId: '',
        status: '',
        mode: 'add',
        addedCount: 0,
        isCreating: false,
        draftTitle: '',
        error: '',
        items: [],
        itemsLoading: false,
        itemsError: '',
        itemsListId: '',
      }];
      this._listTargetCounter = 1;
      this._listDragTargetId = null;
      this._lastListFetchTime = 0;
      this.searchLists = [];
      this._fetchSearchLists({ force: true });
    }
    if (changedProps.has('searchFilterPanel')) {
      this._teardownSearchFilterPanel(changedProps.get('searchFilterPanel'));
      this._setupSearchFilterPanel(this.searchFilterPanel);
      this._maybeStartInitialRefresh();
    }
    if (changedProps.has('rightPanelTool')) {
      try {
        localStorage.setItem('rightPanelTool:search', this.rightPanelTool);
      } catch {
        // ignore storage errors
      }
    }

    if (changedProps.has('searchSubTab')) {
      if (this.hideSubtabs && this.searchSubTab !== 'home') {
        this.searchSubTab = 'home';
        return;
      }
      this._maybeStartInitialRefresh();
      if (this.searchSubTab === 'browse-by-folder') {
        this.browseByFolderOffset = 0;
        this.folderBrowserPanel?.loadFolders();
        if (this.browseByFolderAppliedSelection?.length) {
          this._refreshBrowseByFolderData();
        }
      }
    }

    if (
      this.searchSubTab === 'browse-by-folder'
      && (changedProps.has('searchOrderBy') || changedProps.has('searchDateOrder'))
    ) {
      if (this.browseByFolderAppliedSelection?.length) {
        this._refreshBrowseByFolderData();
      }
    }

    if (changedProps.has('searchImages')) {
      const wasUndefined = changedProps.get('searchImages') === undefined;
      if (this._searchInitialLoadPending && !wasUndefined) {
        this._finishInitialRefresh();
      } else if (!this._searchInitialLoadComplete && (this.searchImages || []).length > 0) {
        this._searchInitialLoadComplete = true;
      }
    }

    if (changedProps.has('browseByFolderAppliedSelection')) {
      const total = (this.browseByFolderAppliedSelection || []).length;
      if (this.browseByFolderOffset >= total && total > 0) {
        this.browseByFolderOffset = 0;
      }
    }
  }

  // ========================================
  // Search List Management Methods
  // ========================================

  async _fetchSearchLists({ force = false } = {}) {
    if (!this.tenant) return;

    // Debounce: prevent fetches within 5 seconds of last fetch
    const now = Date.now();
    if (!force && now - this._lastListFetchTime < this._listFetchDebounceMs) {
      return;
    }

    this._lastListFetchTime = now;
    this._listsLoading = true;
    try {
      this.searchLists = await getLists(this.tenant, { force });
      this._syncChipFiltersFromFilterPanel();
    } catch (error) {
      console.error('Error fetching search lists:', error);
    } finally {
      this._listsLoading = false;
    }
  }

  _focusSearchListTitleInput() {
    setTimeout(() => {
      const input = this.querySelector('#search-list-title-input');
      if (input) {
        input.focus();
        input.select();
      }
    }, 100);
  }

  _resetSearchListDraft() {
    this.searchListId = null;
    this.searchListTitle = this._buildNewListTitle();
    this.searchListItems = [];
    this.searchSavedImages = [];
    this.searchListError = '';
  }

  async _handleSearchListSelect(event) {
    const listId = event.target.value;
    if (!listId) {
      this._resetSearchListDraft();
      this.searchListItems = [];
      return;
    }
    this.searchListError = '';
    const selectedList = this.searchLists.find((l) => l.id === parseInt(listId, 10));
    if (selectedList) {
      this.searchListId = selectedList.id;
      this.searchListTitle = selectedList.title || '';

      // Fetch list items
      try {
        this.searchListItems = await getListItems(this.tenant, this.searchListId);
      } catch (error) {
        console.error('Error fetching list items:', error);
        this.searchListItems = [];
      }

      this.dispatchEvent(new CustomEvent('search-list-updated', {
        detail: { list: selectedList },
        bubbles: true,
        composed: true
      }));
    }
  }

  _handleRightPanelToolChange(tool) {
    this.rightPanelTool = tool;
    if (tool === 'lists' && !(this.searchLists || []).length) {
      this._fetchSearchLists();
    }
  }

  _handleSearchRatingChange(targetId, value) {
    this.searchRatingTargets = (this.searchRatingTargets || []).map((entry) => (
      entry.id === targetId ? { ...entry, rating: value, count: entry.count || 0 } : entry
    ));
  }

  _handleSearchRatingAddTarget() {
    const nextId = `rating-${this._searchRatingNextId++}`;
    this.searchRatingTargets = [
      ...(this.searchRatingTargets || []),
      { id: nextId, rating: '', count: 0 },
    ];
  }

  _handleSearchRatingRemoveTarget(targetId) {
    this.searchRatingTargets = (this.searchRatingTargets || []).filter((entry) => entry.id !== targetId);
  }

  _handleSearchRatingDragOver(event, targetId) {
    event.preventDefault();
    this._searchRatingDragTarget = targetId;
  }

  _handleSearchRatingDragLeave(event) {
    if (event && event.currentTarget !== event.target) return;
    this._searchRatingDragTarget = null;
  }

  _handleSearchRatingDrop(event, targetId) {
    event.preventDefault();
    this._searchRatingDragTarget = null;
    const target = (this.searchRatingTargets || []).find((entry) => entry.id === targetId);
    let rating = Number.parseInt(target?.rating ?? '', 10);
    const raw = event.dataTransfer?.getData('text/plain') || '';
    const ids = raw
      .split(',')
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (!ids.length) return;
    if (!Number.isFinite(rating)) {
      this._openSearchRatingModal(ids);
      this.searchRatingTargets = (this.searchRatingTargets || []).map((entry) => (
        entry.id === targetId ? { ...entry, count: (entry.count || 0) + ids.length } : entry
      ));
      return;
    }
    this.searchRatingTargets = (this.searchRatingTargets || []).map((entry) => (
      entry.id === targetId ? { ...entry, count: (entry.count || 0) + ids.length } : entry
    ));
    this._applySearchHotspotRating(ids, rating);
  }

  _openSearchRatingModal(imageIds) {
    this._searchRatingModalImageIds = imageIds;
    this._searchRatingModalActive = true;
  }

  _closeSearchRatingModal() {
    this._searchRatingModalActive = false;
    this._searchRatingModalImageIds = [];
  }

  _handleSearchRatingModalClick(rating) {
    const ids = this._searchRatingModalImageIds || [];
    if (!ids.length) {
      this._closeSearchRatingModal();
      return;
    }
    this._closeSearchRatingModal();
    this._applySearchHotspotRating(ids, rating);
  }

  _getSearchKeywordsByCategory() {
    if (this.keywords && this.keywords.length) {
      return getKeywordsByCategoryFromList(this.keywords);
    }
    return getKeywordsByCategory(this.tagStatsBySource, this.activeCurateTagSource);
  }

  _applySearchHotspotRating(ids, rating) {
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
    this.searchImages = (this.searchImages || []).map((image) => (
      uniqueIds.includes(image.id) ? { ...image, rating } : image
    ));
    uniqueIds.forEach((id) => this.applyRatingUpdate(id, rating));
    this.searchHotspotRatingCount += uniqueIds.length;
  }

  _processSearchHotspotTagDrop(ids, target) {
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
      description: `search hotspot · ${operations.length} updates`,
    });
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
      this._applyListExcludeFilter(selectedValue);
    }
  }

  _applyListExcludeFilter(listId) {
    const resolvedId = listId ? String(listId) : '';
    if (!resolvedId) return;
    const list = (this.searchLists || []).find((entry) => String(entry.id) === resolvedId);
    const title = list?.title || `List ${resolvedId}`;
    const nextFilters = (this.searchChipFilters || []).filter((filter) => filter.type !== 'list');
    nextFilters.push({
      type: 'list',
      value: resolvedId,
      mode: 'exclude',
      displayLabel: 'List',
      displayValue: `Not in ${title}`,
    });
    this._handleChipFiltersChanged({ detail: { filters: nextFilters } });
    if (this.searchSubTab === 'browse-by-folder') {
      this._refreshBrowseByFolderData({ force: true });
    }
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
        this.searchLists = [...(this.searchLists || []), newList];
      } else {
        await this._fetchSearchLists({ force: true });
      }
      if (resolvedId === null || resolvedId === undefined) {
        const match = (this.searchLists || []).find((list) => {
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
      this._applyListExcludeFilter(resolvedId);
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
    const ids = this._parseSearchDragIds(event);
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
        isCreating: false,
        draftTitle: '',
        error: '',
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
    this.searchLists = (this.searchLists || []).map((list) => {
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

    // When viewing "not in list X", optimistically remove dropped items immediately.
    this._excludeAddedImagesFromVisibleResults(listId, uniqueIds);
    this._scheduleSearchRefreshAfterListDrop(listId);
  }

  _excludeAddedImagesFromVisibleResults(_listId, ids) {
    const removeSet = new Set((ids || []).map((id) => Number(id)).filter(Number.isFinite));
    if (!removeSet.size) {
      return;
    }
    const removedIds = Array.from(removeSet);

    if (Array.isArray(this.searchImages) && this.searchImages.length) {
      const before = this.searchImages.length;
      this.searchImages = this.searchImages.filter((image) => !removeSet.has(Number(image?.id)));
      const removedCount = before - this.searchImages.length;
      if (removedCount > 0 && Number.isFinite(this.searchTotal)) {
        this.searchTotal = Math.max(0, Number(this.searchTotal) - removedCount);
      }
    }

    if (this.browseByFolderData && typeof this.browseByFolderData === 'object') {
      const nextData = {};
      for (const [folder, images] of Object.entries(this.browseByFolderData)) {
        nextData[folder] = Array.isArray(images)
          ? images.filter((image) => !removeSet.has(Number(image?.id)))
          : images;
      }
      this.browseByFolderData = nextData;
    }

    this.searchDragSelection = (this.searchDragSelection || []).filter((id) => !removeSet.has(Number(id)));
    this.searchSavedImages = (this.searchSavedImages || []).filter((image) => !removeSet.has(Number(image?.id)));

    // Mirror the optimistic change into parent-owned search state so it survives parent re-renders.
    this.dispatchEvent(new CustomEvent('search-images-optimistic-remove', {
      detail: { ids: removedIds },
      bubbles: true,
      composed: true,
    }));
  }

  _scheduleSearchRefreshAfterListDrop(listId) {
    if (this._searchListDropRefreshTimer) {
      clearTimeout(this._searchListDropRefreshTimer);
      this._searchListDropRefreshTimer = null;
    }

    this._searchListDropRefreshTimer = setTimeout(() => {
      this._searchListDropRefreshTimer = null;
      if (this.searchSubTab === 'browse-by-folder') {
        this._refreshBrowseByFolderData({ force: true });
      } else {
        this.searchFilterPanel?.fetchImages?.();
      }
    }, 1200);
  }

  _parseSearchDragIds(event) {
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

  _handleSearchListTitleChange(event) {
    this.searchListTitle = event.target.value;
    if (this.searchListError) {
      this.searchListError = '';
    }
  }

  // ========================================
  // Search Drag & Drop Methods
  // ========================================

  _parseSearchDragIds(event) {
    const dataString = event.dataTransfer?.getData('image-ids');
    if (!dataString) return [];
    try {
      return JSON.parse(dataString);
    } catch {
      return [];
    }
  }

  _addSearchSavedImagesByIds(ids) {
    if (!ids || !ids.length) return;

    const currentSavedIds = new Set(this.searchSavedImages.map((img) => img.id));
    const newSavedImages = [];

    for (const id of ids) {
      if (currentSavedIds.has(id)) continue;
      const found = this._findSearchImageById(id);
      if (found) {
        newSavedImages.push(found);
      }
    }

    if (newSavedImages.length > 0) {
      this.searchSavedImages = [...this.searchSavedImages, ...newSavedImages];
    }
  }

  _findSearchImageById(id) {
    const searchFound = this.searchImages.find((img) => img.id === id);
    if (searchFound) {
      return searchFound;
    }
    if (!this.browseByFolderData || typeof this.browseByFolderData !== 'object') {
      return null;
    }
    const sources = [];
    if (this.browseByFolderData && typeof this.browseByFolderData === 'object') {
      sources.push(...Object.values(this.browseByFolderData));
    }
    for (const images of sources) {
      const match = (images || []).find((img) => img.id === id);
      if (match) {
        return match;
      }
    }
    return null;
  }

  _handleSearchRemoveSaved(id) {
    this.searchSavedImages = this.searchSavedImages.filter((img) => img.id !== id);
  }

  _handleSearchSavedDragStart(event, image) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('image-ids', JSON.stringify([image.id]));
  }

  _handleSearchSavedDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    this.searchSavedDragTarget = true;
  }

  _handleSearchSavedDragLeave(event) {
    if (event && event.currentTarget !== event.target) {
      return;
    }
    this.searchSavedDragTarget = false;
  }

  _handleSearchSavedDrop(event) {
    event.preventDefault();
    this.searchSavedDragTarget = false;
    const ids = this._parseSearchDragIds(event);
    this._addSearchSavedImagesByIds(ids);
    // Clear selection after successful drop
    this.searchDragSelection = [];
  }

  _handleSearchAvailableDragOver(event) {
    event.preventDefault();
  }

  _handleSearchAvailableDrop(event) {
    event.preventDefault();
    const ids = this._parseSearchDragIds(event);
    this.searchSavedImages = this.searchSavedImages.filter(
      (img) => !ids.includes(img.id)
    );
  }

  // ========================================
  // Search Dropbox Integration Methods
  // ========================================

  _handleSearchDropboxInput(event) {
    const query = event.detail?.query ?? '';
    const limit = event.detail?.limit;
    this._searchDropboxQuery = query;
    if (this._searchDropboxFetchTimer) {
      clearTimeout(this._searchDropboxFetchTimer);
    }
    if (query.trim().length === 0) {
      this._fetchDropboxFolders('', limit);
      return;
    }
    if (query.length < 2) {
      this.searchDropboxOptions = [];
      return;
    }
    this._searchDropboxFetchTimer = setTimeout(() => {
      this._fetchDropboxFolders(query, limit);
    }, 500);
  }

  async _fetchDropboxFolders(query, limit) {
    if (!this.tenant) return;
    try {
      const response = await getDropboxFolders(this.tenant, { query, limit });
      this.searchDropboxOptions = response?.folders || [];
    } catch (error) {
      console.error('Error fetching Dropbox folders:', error);
      this.searchDropboxOptions = [];
    }
  }

  _handleSearchDropboxFocus() {
    // Handle focus event if needed
  }

  _handleSearchDropboxBlur() {
    // Handle blur event if needed
  }

  _handleSearchDropboxSelect(event) {
    const folder = event.detail?.folder;
    if (folder) {
      this._handleSearchDropboxPick(folder);
    }
  }

  _handleSearchDropboxPick(folder) {
    this.dispatchEvent(new CustomEvent('search-filters-changed', {
      detail: { filters: { ...this.searchChipFilters, dropbox_folder: folder } },
      bubbles: true,
      composed: true
    }));
  }

  _handleSearchDropboxClear() {
    const { dropbox_folder, ...rest } = this.searchChipFilters;
    this.dispatchEvent(new CustomEvent('search-filters-changed', {
      detail: { filters: rest },
      bubbles: true,
      composed: true
    }));
  }

  _handleBrowseByFolderToggle(folder, event) {
    const checked = event?.target?.checked;
    this.folderBrowserPanel?.toggleFolder(folder, checked);
  }

  _handleBrowseByFolderApply() {
    const appliedSelection = [...(this.browseByFolderSelection || [])];
    this.browseByFolderAppliedSelection = appliedSelection;
    this.browseByFolderOffset = 0;
    this.folderBrowserPanel?.setSelection(appliedSelection);
    this.browseByFolderAccordionOpen = false;
    this._refreshBrowseByFolderData({ force: true });
  }

  _handleBrowseByFolderCancel() {
    this.browseByFolderSelection = [...(this.browseByFolderAppliedSelection || [])];
    this.browseByFolderAccordionOpen = false;
  }

  _handleBrowseByFolderMultiSelectChange(event) {
    const selected = Array.from(event.target.selectedOptions || []).map(option => option.value);
    this.browseByFolderSelection = selected;
  }

  async _handleSaveToList() {
    if (!this.searchListId && !this.searchListTitle) return;

    try {
      let listId = this.searchListId;

      // Create new list if needed
      if (!listId) {
        const trimmedTitle = (this.searchListTitle || '').trim();
        if (this._isDuplicateListTitle(trimmedTitle)) {
          this.searchListError = 'LIST TITLE ALREADY EXISTS.';
          this._focusSearchListTitleInput();
          return;
        }
        const newList = await createList(this.tenant, {
          title: trimmedTitle,
          notebox: '',
        });
        listId = newList.id;
        await this._fetchSearchLists({ force: true });

        // Keep the newly created list selected
        this.searchListId = listId;
        const selectedList = this.searchLists.find((l) => l.id === listId);
        if (selectedList) {
          this.searchListTitle = selectedList.title || '';
        }
        this.searchListError = '';
      }

      // Add images to list
      for (const image of this.searchSavedImages) {
        await addToList(this.tenant, listId, image.id);
      }

      // Clear saved images but keep list selected
      this.searchSavedImages = [];

      // Refresh list items to show newly added images
      try {
        this.searchListItems = await getListItems(this.tenant, listId);
      } catch (error) {
        console.error('Error fetching list items:', error);
        this.searchListItems = [];
      }

      // Notify parent
      this.dispatchEvent(new CustomEvent('search-list-created', {
        detail: { listId },
        bubbles: true,
        composed: true
      }));
    } catch (error) {
      console.error('Error saving to list:', error);
      alert('Failed to save to list. Please try again.');
    }
  }

  // ========================================
  // Search Tab Navigation
  // ========================================

  _handleSearchSubTabChange(nextTab) {
    if (this.hideSubtabs) return;
    this.searchSubTab = nextTab;
    this.dispatchEvent(new CustomEvent('search-subtab-changed', {
      detail: { subtab: nextTab },
      bubbles: true,
      composed: true
    }));
  }

  _setupSearchFilterPanel(panel) {
    if (!panel) return;
    if (this._searchFilterPanelHandlers?.panel === panel) {
      return;
    }
    if (this._searchFilterPanelHandlers?.panel) {
      this._teardownSearchFilterPanel(this._searchFilterPanelHandlers.panel);
    }
    const handleLoaded = () => {
      this._finishInitialRefresh();
    };
    const handleError = () => {
      this._finishInitialRefresh();
    };
    const handleFiltersChanged = (detail) => {
      if (!detail?.filters) return;
      this._syncChipFiltersFromFilterState(detail.filters);
    };
    this._searchFilterPanelHandlers = { panel, handleLoaded, handleError, handleFiltersChanged };
    panel.on('images-loaded', handleLoaded);
    panel.on('error', handleError);
    panel.on('filters-changed', handleFiltersChanged);
    this._syncChipFiltersFromFilterPanel();
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
    const handleFoldersLoading = () => {
      this._syncBrowseByFolderLoading();
    };
    const handleDataLoading = () => {
      this._syncBrowseByFolderLoading();
    };
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

  _teardownSearchFilterPanel(panel) {
    if (!panel || !this._searchFilterPanelHandlers) return;
    panel.off('images-loaded', this._searchFilterPanelHandlers.handleLoaded);
    panel.off('error', this._searchFilterPanelHandlers.handleError);
    panel.off('filters-changed', this._searchFilterPanelHandlers.handleFiltersChanged);
    this._searchFilterPanelHandlers = null;
  }

  _syncChipFiltersFromFilterPanel() {
    const filters = this.searchFilterPanel?.getState?.() || this.searchFilterPanel?.filters;
    if (!filters || typeof filters !== 'object') return;
    this._syncChipFiltersFromFilterState(filters);
  }

  _syncChipFiltersFromFilterState(filters) {
    const nextChips = [];

    if (filters.permatagPositiveMissing) {
      nextChips.push({
        type: 'keyword',
        untagged: true,
        displayLabel: 'Keywords',
        displayValue: 'Untagged',
      });
    } else if (filters.keywords && typeof filters.keywords === 'object' && Object.keys(filters.keywords).length > 0) {
      const keywordsByCategory = {};
      for (const [category, rawValues] of Object.entries(filters.keywords)) {
        const values = Array.isArray(rawValues)
          ? rawValues
          : (rawValues instanceof Set ? [...rawValues] : Array.from(rawValues || []));
        const normalizedValues = values.filter(Boolean);
        if (normalizedValues.length) {
          keywordsByCategory[category] = normalizedValues;
        }
      }
      if (Object.keys(keywordsByCategory).length > 0) {
        const operator = filters.categoryFilterOperator
          || (() => {
            const ops = Object.values(filters.operators || {}).filter(Boolean);
            const unique = [...new Set(ops)];
            return unique.length === 1 ? unique[0] : 'OR';
          })();
        nextChips.push({
          type: 'keyword',
          keywordsByCategory,
          operator: operator || 'OR',
          displayLabel: 'Keywords',
          displayValue: 'Multiple',
        });
      }
    }

    if (filters.ratingOperator === 'is_null') {
      nextChips.push({
        type: 'rating',
        value: 'unrated',
        displayLabel: 'Rating',
        displayValue: 'Unrated',
      });
    } else if (filters.rating !== undefined && filters.rating !== null && filters.rating !== '') {
      const numericRating = Number(filters.rating);
      nextChips.push({
        type: 'rating',
        value: Number.isFinite(numericRating) ? numericRating : filters.rating,
        displayLabel: 'Rating',
        displayValue: Number.isFinite(numericRating) && numericRating > 0 ? `${numericRating}+` : String(filters.rating),
      });
    }

    const folder = (filters.dropboxPathPrefix || '').trim();
    if (folder) {
      nextChips.push({
        type: 'folder',
        value: folder,
        displayLabel: 'Folder',
        displayValue: folder,
      });
    }

    const filenameQuery = (filters.filenameQuery || '').trim();
    if (filenameQuery) {
      nextChips.push({
        type: 'filename',
        value: filenameQuery,
        displayLabel: 'Filename',
        displayValue: filenameQuery,
      });
    }

    if (filters.listExcludeId !== undefined && filters.listExcludeId !== null && filters.listExcludeId !== '') {
      const listExcludeValue = Number(filters.listExcludeId);
      const listId = Number.isFinite(listExcludeValue) ? listExcludeValue : filters.listExcludeId;
      const list = (this.searchLists || []).find((entry) => String(entry.id) === String(listId));
      const listTitle = list?.title || `List ${listId}`;
      nextChips.push({
        type: 'list',
        value: listId,
        mode: 'exclude',
        displayLabel: 'List',
        displayValue: `Not in ${listTitle}`,
      });
    } else if (filters.listId !== undefined && filters.listId !== null && filters.listId !== '') {
      const listValue = Number(filters.listId);
      const listId = Number.isFinite(listValue) ? listValue : filters.listId;
      const list = (this.searchLists || []).find((entry) => String(entry.id) === String(listId));
      const listTitle = list?.title || `List ${listId}`;
      nextChips.push({
        type: 'list',
        value: listId,
        mode: 'include',
        displayLabel: 'List',
        displayValue: listTitle,
      });
    }

    this.searchChipFilters = nextChips;
  }

  _maybeStartInitialRefresh() {
    if (this._searchInitialLoadComplete || this._searchInitialLoadPending) return;
    if (this.searchSubTab !== 'home') return;
    if (!this.searchFilterPanel) return;
    if ((this.searchImages || []).length > 0) {
      this._searchInitialLoadComplete = true;
      return;
    }
    this._searchInitialLoadPending = true;
    this._refreshSearch();
  }

  _finishInitialRefresh() {
    if (!this._searchInitialLoadPending) return;
    this._searchInitialLoadPending = false;
    this._searchInitialLoadComplete = true;
    this.searchRefreshing = false;
  }

  _refreshBrowseByFolderData({ force = false, orderBy, sortOrder } = {}) {
    if (!this.folderBrowserPanel) return;
    const resolvedOrderBy = orderBy || this.searchOrderBy || 'photo_creation';
    const resolvedSortOrder = sortOrder || this.searchDateOrder || 'desc';
    const appliedSelection = this.browseByFolderAppliedSelection || [];
    if (appliedSelection.length) {
      this.folderBrowserPanel.setSelection(appliedSelection);
    }
    return this.folderBrowserPanel.loadData({
      orderBy: resolvedOrderBy,
      sortOrder: resolvedSortOrder,
      limit: 0,
      listExcludeId: this.searchListExcludeId || '',
      force
    });
  }

  refreshBrowseByFolder({ force = false, orderBy, sortOrder } = {}) {
    return this._refreshBrowseByFolderData({ force, orderBy, sortOrder });
  }

  applyRatingUpdate(imageId, rating) {
    if (!imageId) return false;
    if (!this.browseByFolderData || typeof this.browseByFolderData !== 'object') {
      return false;
    }
    let updated = false;
    const nextData = {};
    for (const [folder, images] of Object.entries(this.browseByFolderData)) {
      if (!Array.isArray(images)) {
        nextData[folder] = images;
        continue;
      }
      let folderUpdated = false;
      const nextImages = images.map((image) => {
        if (image?.id === imageId && image.rating !== rating) {
          folderUpdated = true;
          updated = true;
          return { ...image, rating };
        }
        return image;
      });
      nextData[folder] = folderUpdated ? nextImages : images;
    }
    if (updated) {
      this.browseByFolderData = nextData;
    }
    return updated;
  }

  // ========================================
  // Event Handlers for Parent Communication
  // ========================================

  _handleCurateThumbSizeChange(event) {
    const size = parseInt(event.target.value, 10);
    this.dispatchEvent(new CustomEvent('thumb-size-changed', {
      detail: { size },
      bubbles: true,
      composed: true
    }));
  }

  _handleCurateQuickSort(field) {
    const nextOrderBy = field;
    const nextDateOrder = this.searchOrderBy === field
      ? (this.searchDateOrder === 'desc' ? 'asc' : 'desc')
      : 'desc';
    this.dispatchEvent(new CustomEvent('sort-changed', {
      detail: { orderBy: nextOrderBy, dateOrder: nextDateOrder },
      bubbles: true,
      composed: true
    }));
    if (this.searchSubTab === 'browse-by-folder') {
      this._refreshBrowseByFolderData({
        force: true,
        orderBy: nextOrderBy,
        sortOrder: nextDateOrder
      });
    }
  }

  _getCurateQuickSortArrow(field) {
    if (this.searchOrderBy !== field) return '';
    return this.searchDateOrder === 'desc' ? '↓' : '↑';
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
    const field = this.searchOrderBy || 'photo_creation';
    const direction = this.searchDateOrder === 'asc' ? 1 : -1;
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

  _renderSearchPermatagSummary(image) {
    const permatags = Array.isArray(image?.permatags) ? image.permatags : [];
    const positives = permatags.filter((tag) => tag.signum === 1 && tag.keyword);
    const unique = Array.from(new Set(positives.map((tag) => tag.keyword).filter(Boolean)));
    const variantCount = Number(image?.variant_count || 0);
    const hasVariants = Number.isFinite(variantCount) && variantCount > 0;
    if (!unique.length && !hasVariants) return html``;
    const label = unique.length ? unique.join(', ') : 'none';
    const variantTitle = hasVariants
      ? `${variantCount} variant${variantCount === 1 ? '' : 's'}`
      : '';
    return html`
      <div class="curate-thumb-rating ${hasVariants ? 'has-variant' : ''}">
        ${hasVariants ? html`
          <span class="curate-thumb-variant-count" title=${variantTitle}>V${variantCount}</span>
        ` : html``}
        <span class="curate-thumb-rating-label">Tags: ${label}</span>
      </div>
    `;
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
    const appliedSet = new Set(applied);
    return pending.some((folder) => !appliedSet.has(folder));
  }

  _handleChipFiltersChanged(event) {
    const chips = event.detail.filters;

    // Store the chip filters for UI state
    this.searchChipFilters = chips;

    // Build filter object from chip filters
    const searchFilters = {
      limit: 100,
      offset: 0,
      sortOrder: this.searchDateOrder || 'desc',
      orderBy: this.searchOrderBy || 'photo_creation',
      hideZeroRating: true,
      keywords: {},
      operators: {},
      categoryFilterOperator: undefined,
      categoryFilterSource: 'permatags',
      dropboxPathPrefix: '',
      filenameQuery: '',
      listId: undefined,
      listExcludeId: undefined,
    };

    // Apply each chip filter to the filter object
    chips.forEach(chip => {
      switch (chip.type) {
        case 'keyword': {
          if (chip.untagged || chip.value === '__untagged__') {
            searchFilters.permatagPositiveMissing = true;
            break;
          }
          const keywordsByCategory = chip.keywordsByCategory && typeof chip.keywordsByCategory === 'object'
            ? chip.keywordsByCategory
            : (chip.category && chip.value ? { [chip.category]: [chip.value] } : {});
          const operator = chip.operator || 'OR';
          searchFilters.categoryFilterOperator = operator;
          Object.entries(keywordsByCategory).forEach(([category, values]) => {
            const list = Array.isArray(values) ? values : Array.from(values || []);
            if (!list.length) return;
            if (!searchFilters.keywords[category]) {
              searchFilters.keywords[category] = new Set();
            }
            list.forEach((value) => searchFilters.keywords[category].add(value));
            searchFilters.operators[category] = operator;
          });
          break;
        }
        case 'rating':
          if (chip.value === 'unrated') {
            searchFilters.rating = undefined;
            searchFilters.ratingOperator = 'is_null';
            searchFilters.hideZeroRating = true;
          } else {
            searchFilters.rating = chip.value;
            searchFilters.ratingOperator = chip.value === 0 ? 'eq' : 'gte';
            searchFilters.hideZeroRating = false;
          }
          break;
        case 'folder':
          searchFilters.dropboxPathPrefix = chip.value || '';
          break;
        case 'list':
          if (chip.mode === 'exclude') {
            searchFilters.listExcludeId = chip.value;
          } else {
            searchFilters.listId = chip.value;
          }
          break;
        case 'filename':
          searchFilters.filenameQuery = chip.value || '';
          break;
      }
    });

    this.searchListExcludeId = searchFilters.listExcludeId || '';

    // Update filter panel with the complete filter object
    if (this.searchFilterPanel) {
      this.searchFilterPanel.updateFilters(searchFilters);
      this.searchFilterPanel.fetchImages();
    }
  }

  _handleSearchListsRequested() {
    this._fetchSearchLists();
  }

  // ========================================
  // Helper Methods
  // ========================================

  _isDuplicateListTitle(title) {
    if (!title) return false;
    const normalized = title.trim().toLowerCase();
    return this.searchLists.some(
      (list) => list.title.trim().toLowerCase() === normalized
    );
  }

  _buildNewListTitle() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
      `:${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    return `${stamp} new list`;
  }

  // ========================================
  // Selection Helper Methods
  // ========================================

  _flashSearchSelection(imageId) {
    this._searchFlashSelectionIds.add(imageId);
    this.requestUpdate();
    setTimeout(() => {
      this._searchFlashSelectionIds.delete(imageId);
      this.requestUpdate();
    }, 300);
  }

  _handleSearchPointerDown(event, index, imageId) {
    return this._searchSelectionHandlers.handlePointerDown(event, index, imageId);
  }

  _handleSearchPointerMove(event) {
    return this._searchSelectionHandlers.handlePointerMove(event);
  }

  _handleSearchSelectHover(index) {
    return this._searchSelectionHandlers.handleSelectHover(index);
  }

  _handleBrowseByFolderPointerDown(event, index, imageId, order, groupKey) {
    this._searchBrowseOrder = order;
    this._searchBrowseGroupKey = groupKey;
    return this._handleSearchPointerDown(event, index, imageId);
  }

  _handleBrowseByFolderSelectHover(index, groupKey) {
    if (this._searchBrowseGroupKey !== groupKey) {
      return;
    }
    return this._handleSearchSelectHover(index);
  }

  _handleSearchImageClick(event, image, imageSet) {
    if (event.defaultPrevented) return;
    if (this._searchSuppressClick || this.searchDragSelection.length) {
      this._searchSuppressClick = false;
      return;
    }
    this.dispatchEvent(new CustomEvent('image-clicked', {
      detail: { event, image, imageSet },
      bubbles: true,
      composed: true
    }));
  }

  _handleSearchDragStart(event, image) {
    // Prevent dragging during selection mode
    if (this.searchDragSelecting) {
      event.preventDefault();
      return;
    }

    let ids = [image.id];
    if (this.searchDragSelection.length && this.searchDragSelection.includes(image.id)) {
      ids = this.searchDragSelection;
    } else if (this.searchDragSelection.length) {
      this.searchDragSelection = [image.id];
    }
    event.dataTransfer.setData('text/plain', ids.join(','));
    event.dataTransfer.setData('application/x-zoltag-source', 'search-available');
    event.dataTransfer.setData('image-ids', JSON.stringify(ids));
  }

  _getSearchPaginationState() {
    const filters = this.searchFilterPanel?.getState?.() || this.searchFilterPanel?.filters || {};
    return {
      offset: Number(filters.offset) || 0,
      limit: Number(filters.limit) || 100,
      total: Number(this.searchTotal) || 0,
      count: (this.searchImages || []).length,
    };
  }

  _getBrowseByFolderPaginationState() {
    const total = (this.browseByFolderAppliedSelection || []).length;
    const offset = Number(this.browseByFolderOffset) || 0;
    const limit = Number(this.browseByFolderLimit) || 100;
    const count = Math.max(0, Math.min(limit, total - offset));
    return { total, offset, limit, count };
  }

  _handleSearchPagePrev() {
    if (!this.searchFilterPanel) return;
    const { offset, limit } = this._getSearchPaginationState();
    const nextOffset = Math.max(0, offset - limit);
    this.searchFilterPanel.setOffset(nextOffset);
    this.searchFilterPanel.fetchImages();
  }

  _handleSearchPageNext() {
    if (!this.searchFilterPanel) return;
    const { offset, limit, total } = this._getSearchPaginationState();
    const nextOffset = offset + limit < total ? offset + limit : offset;
    this.searchFilterPanel.setOffset(nextOffset);
    this.searchFilterPanel.fetchImages();
  }

  _handleSearchPageLimitChange(event) {
    if (!this.searchFilterPanel) return;
    const nextLimit = parseInt(event.target.value, 10);
    if (!Number.isFinite(nextLimit)) return;
    this.searchFilterPanel.setLimit(nextLimit);
    this.searchFilterPanel.fetchImages();
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

  // ========================================
  // Render Method
  // ========================================

  render() {
    const trimmedSearchListTitle = (this.searchListTitle || '').trim();
    const hasSearchListTitle = !!trimmedSearchListTitle;
    const folderQuery = (this.browseByFolderQuery || '').trim().toLowerCase();
    const filteredFolders = folderQuery
      ? (this.browseByFolderOptions || []).filter((folder) => folder.toLowerCase().includes(folderQuery))
      : (this.browseByFolderOptions || []);
    const selectedFolders = this.browseByFolderSelection || [];
    const appliedFolders = this.browseByFolderAppliedSelection || [];
    const folderOptions = Array.from(new Set([...filteredFolders, ...selectedFolders]))
      .sort((a, b) => a.localeCompare(b));
    const showBrowseByFolderOverlay = this.browseByFolderAccordionOpen || this._hasPendingBrowseByFolderSelection();
    const searchPagination = this.searchSubTab === 'home'
      ? (() => {
        const { offset, limit, total, count } = this._getSearchPaginationState();
        return renderResultsPagination({
          offset,
          limit,
          total,
          count,
          onPrev: () => this._handleSearchPagePrev(),
          onNext: () => this._handleSearchPageNext(),
          onLimitChange: (event) => this._handleSearchPageLimitChange(event),
          disabled: this.searchRefreshing,
        });
      })()
      : html``;
    const browsePagination = this.searchSubTab === 'browse-by-folder'
      ? (() => {
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
      })()
      : html``;
    const browseFoldersPage = (appliedFolders || [])
      .slice(this.browseByFolderOffset, this.browseByFolderOffset + this.browseByFolderLimit);
    const browseByFolderBlurStyle = this.browseByFolderLoading
      ? 'filter: blur(2px); opacity: 0.6; pointer-events: none;'
      : '';
    const ratingModal = this._searchRatingModalActive ? html`
      <div class="curate-rating-modal-overlay" @click=${this._closeSearchRatingModal}>
        <div class="curate-rating-modal-content" @click=${(e) => e.stopPropagation()}>
          <div class="curate-rating-modal-title">Rate images</div>
          <div class="curate-rating-modal-subtitle">${this._searchRatingModalImageIds?.length || 0} image(s)</div>
          <div class="curate-rating-modal-options">
            <div class="curate-rating-option" @click=${() => this._handleSearchRatingModalClick(0)}>
              <div class="curate-rating-option-icon">🗑️</div>
              <div class="curate-rating-option-label">Garbage</div>
            </div>
            <div class="curate-rating-option" @click=${() => this._handleSearchRatingModalClick(1)}>
              <div class="curate-rating-option-icon">⭐</div>
              <div class="curate-rating-option-label">1</div>
            </div>
            <div class="curate-rating-option" @click=${() => this._handleSearchRatingModalClick(2)}>
              <div class="curate-rating-option-icon">⭐</div>
              <div class="curate-rating-option-label">2</div>
            </div>
            <div class="curate-rating-option" @click=${() => this._handleSearchRatingModalClick(3)}>
              <div class="curate-rating-option-icon">⭐</div>
              <div class="curate-rating-option-label">3</div>
            </div>
          </div>
          <div class="curate-rating-modal-buttons">
            <button class="curate-rating-modal-cancel" @click=${this._closeSearchRatingModal}>Cancel</button>
          </div>
        </div>
      </div>
    ` : html``;

    const savedPane = html`
      <right-panel
        .tools=${[
          { id: 'lists', label: 'Lists' },
        ]}
        .activeTool=${this.rightPanelTool}
        @tool-changed=${(event) => this._handleRightPanelToolChange(event.detail.tool)}
      >
        <list-targets-panel
          slot="tool-lists"
          .listsLoading=${this._listsLoading}
          .listTargets=${this._listTargets}
          .lists=${this.searchLists}
          .listDragTargetId=${this._listDragTargetId}
          .renderCurateRatingWidget=${this.renderCurateRatingWidget}
          .renderCuratePermatagSummary=${this.renderCuratePermatagSummary || this._renderSearchPermatagSummary.bind(this)}
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
      </right-panel>
    `;

    return html`
      ${ratingModal}
      <div class="container">
        <!-- Search Tab Header -->
        ${this.hideSubtabs ? html`` : html`
          <div class="flex items-center justify-between mb-4">
            <div class="curate-subtabs">
              <button
                class="curate-subtab ${this.searchSubTab === 'home' ? 'active' : ''}"
                @click=${() => this._handleSearchSubTabChange('home')}
              >
                Search Home
              </button>
              <button
                class="curate-subtab ${this.searchSubTab === 'browse-by-folder' ? 'active' : ''}"
                @click=${() => this._handleSearchSubTabChange('browse-by-folder')}
              >
                Browse by Folder
              </button>
              <button
                class="curate-subtab ${this.searchSubTab === 'natural-search' ? 'active' : ''}"
                @click=${() => this._handleSearchSubTabChange('natural-search')}
              >
                Natural Search
              </button>
              <button
                class="curate-subtab ${this.searchSubTab === 'chips' ? 'active' : ''}"
                @click=${() => this._handleSearchSubTabChange('chips')}
              >
                Explore
              </button>
            </div>

            <div class="ml-auto flex items-center gap-4 text-xs text-gray-600 mr-4">
              <label class="font-semibold text-gray-600">Thumb</label>
              <input
                type="range"
                min="80"
                max="220"
                step="10"
                .value=${String(this.curateThumbSize)}
                @input=${this._handleCurateThumbSizeChange}
                class="w-24"
              >
              <span class="w-12 text-right text-xs">${this.curateThumbSize}px</span>
            </div>

            <button
              class="inline-flex items-center gap-2 border rounded-lg px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
              ?disabled=${this.searchRefreshing}
              @click=${this._refreshSearch}
              title="Refresh"
            >
              ${this.searchRefreshing ? html`<span class="curate-spinner"></span>` : html`<span aria-hidden="true">↻</span>`}
              ${this.searchRefreshing ? 'Refreshing' : 'Refresh'}
            </button>
          </div>
        `}

        ${this.searchRefreshing ? html`
          <div class="curate-loading-overlay" aria-label="Loading">
            <span class="curate-spinner large"></span>
          </div>
        ` : html``}

        <!-- Search Home Subtab -->
        ${this.searchSubTab === 'home' ? html`
          <div>
            <!-- Filter Chips Component -->
            <filter-chips
              .tenant=${this.tenant}
              .tagStatsBySource=${this.tagStatsBySource}
              .activeCurateTagSource=${this.activeCurateTagSource || 'permatags'}
              .keywords=${this.keywords}
              .imageStats=${this.imageStats}
              .activeFilters=${this.searchChipFilters}
              .dropboxFolders=${this.searchDropboxOptions || []}
              .lists=${this.searchLists}
              .renderSortControls=${() => html`
                <div class="flex items-center gap-2">
                  <span class="text-sm font-semibold text-gray-700">Sort:</span>
                  <div class="curate-audit-toggle">
                    <button
                      class=${this.searchOrderBy === 'rating' ? 'active' : ''}
                      @click=${() => this._handleCurateQuickSort('rating')}
                    >
                      Rating ${this._getCurateQuickSortArrow('rating')}
                    </button>
                    <button
                      class=${this.searchOrderBy === 'photo_creation' ? 'active' : ''}
                      @click=${() => this._handleCurateQuickSort('photo_creation')}
                    >
                      Photo Date ${this._getCurateQuickSortArrow('photo_creation')}
                    </button>
                    <button
                      class=${this.searchOrderBy === 'processed' ? 'active' : ''}
                      @click=${() => this._handleCurateQuickSort('processed')}
                    >
                      Process Date ${this._getCurateQuickSortArrow('processed')}
                    </button>
                  </div>
                </div>
              `}
              @filters-changed=${this._handleChipFiltersChanged}
              @folder-search=${this._handleSearchDropboxInput}
              @lists-requested=${this._handleSearchListsRequested}
            ></filter-chips>

            <!-- Image Grid Layout -->
            <div class="curate-layout search-layout mt-3" style="--curate-thumb-size: ${this.curateThumbSize}px; ${browseByFolderBlurStyle}">
              <div class="curate-pane" @dragover=${this._handleSearchAvailableDragOver} @drop=${this._handleSearchAvailableDrop}>
                <div class="curate-pane-body">
                  <div class="p-2">
                    ${searchPagination}
                  </div>
                  ${this.searchImages && this.searchImages.length > 0 ? html`
                    ${renderImageGrid({
                      images: this.searchImages,
                      selection: this.searchDragSelection,
                      flashSelectionIds: this._searchFlashSelectionIds,
                      selectionHandlers: this._searchSelectionHandlers,
                      renderFunctions: {
                        renderCurateRatingWidget: this.renderCurateRatingWidget,
                        renderCurateRatingStatic: this.renderCurateRatingStatic,
                        renderCuratePermatagSummary: this.renderCuratePermatagSummary || this._renderSearchPermatagSummary.bind(this),
                        formatCurateDate: this.formatCurateDate,
                      },
                      eventHandlers: {
                        onImageClick: (event, image) => this._handleSearchImageClick(event, image, this.searchImages),
                        onDragStart: (event, image) => this._handleSearchDragStart(event, image),
                        onPointerDown: (event, index, imageId) => this._handleSearchPointerDown(event, index, imageId),
                        onPointerMove: (event) => this._handleSearchPointerMove(event),
                        onPointerEnter: (index) => this._handleSearchSelectHover(index),
                      },
                      options: {
                        enableReordering: false,
                        showPermatags: true,
                        showAiScore: false,
                        emptyMessage: 'No images found. Adjust filters to search.',
                      },
                    })}
                  ` : html`
                    <div class="p-4 text-center text-gray-500 text-sm">
                      No images found. Adjust filters to search.
                    </div>
                  `}
                  <div class="p-2">
                    ${searchPagination}
                  </div>
                </div>
              </div>

              ${savedPane}
            </div>
          </div>
        ` : ''}

        <!-- Browse by Folder Subtab -->
        ${this.searchSubTab === 'browse-by-folder' ? html`
          <div>
            <div class="curate-layout search-layout mt-3" style="--curate-thumb-size: ${this.curateThumbSize}px;">
              <div class="curate-pane" @dragover=${this._handleSearchAvailableDragOver} @drop=${this._handleSearchAvailableDrop}>
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

                    ${this.browseByFolderAccordionOpen || !(this.browseByFolderAppliedSelection || []).length ? '' : html`
                      <div class="mt-3 flex items-center gap-2">
                        <span class="text-sm font-semibold text-gray-700">Sort:</span>
                        <div class="curate-audit-toggle">
                          <button
                            class=${this.searchOrderBy === 'rating' ? 'active' : ''}
                            @click=${() => this._handleCurateQuickSort('rating')}
                          >
                            Rating ${this._getCurateQuickSortArrow('rating')}
                          </button>
                          <button
                            class=${this.searchOrderBy === 'photo_creation' ? 'active' : ''}
                            @click=${() => this._handleCurateQuickSort('photo_creation')}
                          >
                            Photo Date ${this._getCurateQuickSortArrow('photo_creation')}
                          </button>
                          <button
                            class=${this.searchOrderBy === 'processed' ? 'active' : ''}
                            @click=${() => this._handleCurateQuickSort('processed')}
                          >
                            Process Date ${this._getCurateQuickSortArrow('processed')}
                          </button>
                        </div>
                      </div>
                    `}
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
                              ${sortedImages.length ? renderImageGrid({
                                images: sortedImages,
                                selection: this.searchDragSelection,
                                flashSelectionIds: this._searchFlashSelectionIds,
                                selectionHandlers: this._searchSelectionHandlers,
                                renderFunctions: {
                                  renderCurateRatingWidget: this.renderCurateRatingWidget,
                                  renderCurateRatingStatic: this.renderCurateRatingStatic,
                                  renderCuratePermatagSummary: this.renderCuratePermatagSummary || this._renderSearchPermatagSummary.bind(this),
                                  formatCurateDate: this.formatCurateDate,
                                },
                                eventHandlers: {
                                  onImageClick: (event, image) => this._handleSearchImageClick(event, image, sortedImages),
                                  onDragStart: (event, image) => this._handleSearchDragStart(event, image),
                                  onPointerDown: (event, index, imageId) => this._handleBrowseByFolderPointerDown(event, index, imageId, order, folder),
                                  onPointerMove: (event) => this._handleSearchPointerMove(event),
                                  onPointerEnter: (index) => this._handleBrowseByFolderSelectHover(index, folder),
                                },
                                options: {
                                  enableReordering: false,
                                  showPermatags: true,
                                  showAiScore: false,
                                  emptyMessage: 'No images available.',
                                },
                              }) : html`
                                <div class="col-span-full flex items-center justify-center py-6">
                                  <span class="curate-spinner large" aria-hidden="true"></span>
                                </div>
                              `}
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
                </div>
              </div>

              ${savedPane}
            </div>
          </div>
        ` : ''}

        ${this.searchSubTab === 'natural-search' ? html`
          <lab-tab
            .tenant=${this.tenant}
            .tagStatsBySource=${this.tagStatsBySource}
            .activeCurateTagSource=${this.activeCurateTagSource}
            .keywords=${this.keywords}
            .imageStats=${this.imageStats}
            .curateOrderBy=${this.searchOrderBy}
            .curateDateOrder=${this.searchDateOrder}
            .renderCurateRatingWidget=${this.renderCurateRatingWidget}
            .renderCurateRatingStatic=${this.renderCurateRatingStatic}
            .formatCurateDate=${this.formatCurateDate}
            @image-clicked=${(event) => this._handleSearchImageClick(event.detail.event, event.detail.image, event.detail.imageSet)}
            @image-selected=${(event) => this._handleSearchImageClick(null, event.detail.image, event.detail.imageSet)}
          ></lab-tab>
        ` : html``}

        ${this.searchSubTab === 'chips' ? html`
          <home-chips-tab
            .tenant=${this.tenant}
            .initialSelection=${this.initialExploreSelection}
            .tagStatsBySource=${this.tagStatsBySource}
            .activeCurateTagSource=${this.activeCurateTagSource}
            .keywords=${this.keywords}
            .imageStats=${this.imageStats}
            .curateOrderBy=${this.searchOrderBy}
            .curateDateOrder=${this.searchDateOrder}
            .renderCurateRatingWidget=${this.renderCurateRatingWidget}
            .renderCurateRatingStatic=${this.renderCurateRatingStatic}
            .formatCurateDate=${this.formatCurateDate}
            @image-clicked=${(event) => this._handleSearchImageClick(event.detail.event, event.detail.image, event.detail.imageSet)}
            @image-selected=${(event) => this._handleSearchImageClick(null, event.detail.image, event.detail.imageSet)}
          ></home-chips-tab>
        ` : html``}
      </div>
    `;
  }
}

customElements.define('search-tab', SearchTab);
