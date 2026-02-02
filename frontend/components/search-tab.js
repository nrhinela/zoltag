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
import { createSelectionHandlers } from './shared/selection-handlers.js';
import { renderResultsPagination } from './shared/pagination-controls.js';
import './shared/widgets/filter-chips.js';
import './shared/widgets/image-card.js';
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
 * - Explore by Tag: Browse images grouped by keywords
 *
 * @property {String} tenant - Current tenant ID
 * @property {String} searchSubTab - Active subtab ('home' or 'explore-by-tag')
 * @property {Array} searchChipFilters - Current filter chip selections
 * @property {Array} searchDropboxOptions - Dropbox folder options
 * @property {Array} searchImages - Images from filter panel
 * @property {Set} searchSelectedImages - Selected image IDs
 * @property {Array} searchLists - Available lists
 * @property {String} searchListId - Currently selected list ID
 * @property {String} searchListTitle - Draft list title
 * @property {Array} searchSavedImages - Images saved to current list
 * @property {Object} exploreByTagData - Tag exploration data
 * @property {Array} exploreByTagKeywords - Keywords for exploration
 * @property {Boolean} exploreByTagLoading - Loading state for explore
 * @property {Number} curateThumbSize - Thumbnail size
 * @property {Object} tagStatsBySource - Tag statistics
 * @property {Array} keywords - Flat keyword list for faster dropdowns
 * @property {String} activeCurateTagSource - Active tag source
 * @property {Object} imageStats - Image statistics
 * @property {String} curateOrderBy - Sort field
 * @property {String} curateDateOrder - Date sort order
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
    searchSavedImages: { type: Array },
    exploreByTagData: { type: Object },
    exploreByTagKeywords: { type: Array },
    exploreByTagLoading: { type: Boolean },
    exploreByTagOffset: { type: Number, state: true },
    exploreByTagLimit: { type: Number, state: true },
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
    curateThumbSize: { type: Number },
    tagStatsBySource: { type: Object },
    activeCurateTagSource: { type: String },
    keywords: { type: Array },
    imageStats: { type: Object },
    curateOrderBy: { type: String },
    curateDateOrder: { type: String },
    renderCurateRatingWidget: { type: Object },
    renderCurateRatingStatic: { type: Object },
    formatCurateDate: { type: Object },
    searchDragSelection: { type: Array },
    searchDragSelecting: { type: Boolean },
    searchDragStartIndex: { type: Number },
    searchDragEndIndex: { type: Number },
    searchSavedDragTarget: { type: Boolean },
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
    this.searchSavedImages = [];
    this.exploreByTagData = {};
    this.exploreByTagKeywords = [];
    this.exploreByTagLoading = false;
    this.exploreByTagOffset = 0;
    this.exploreByTagLimit = 100;
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
    this.curateThumbSize = 120;
    this.tagStatsBySource = {};
    this.activeCurateTagSource = 'permatags';
    this.keywords = [];
    this.imageStats = null;
    this.curateOrderBy = 'rating';
    this.curateDateOrder = 'desc';
    this.renderCurateRatingWidget = null;
    this.renderCurateRatingStatic = null;
    this.formatCurateDate = null;
    this.searchDragSelection = [];
    this.searchDragSelecting = false;
    this.searchDragStartIndex = null;
    this.searchDragEndIndex = null;
    this.searchSavedDragTarget = false;
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
    this._exploreInitialLoadComplete = false;
    this._exploreInitialLoadPending = false;
    this._searchExploreOrder = null;
    this._searchExploreGroupKey = null;
    this._searchBrowseOrder = null;
    this._searchBrowseGroupKey = null;
    this._searchFilterPanelHandlers = null;
    this._folderBrowserPanelHandlers = null;
    this._searchDropboxFetchTimer = null;
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
        if (this.searchSubTab === 'explore-by-tag') {
          return this._searchExploreOrder || [];
        }
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
      if (this.searchSubTab === 'explore-by-tag') {
        tasks.push(this._loadExploreByTagData(true));
      }
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
  }

  updated(changedProps) {
    if (changedProps.has('tenant') && this.folderBrowserPanel) {
      this.folderBrowserPanel.setTenant(this.tenant);
    }
    if (changedProps.has('searchFilterPanel')) {
      this._teardownSearchFilterPanel(changedProps.get('searchFilterPanel'));
      this._setupSearchFilterPanel(this.searchFilterPanel);
      this._maybeStartInitialRefresh();
    }

    if (changedProps.has('searchSubTab')) {
      if (this.searchSubTab === 'explore-by-tag') {
        this.exploreByTagOffset = 0;
        if (this.exploreByTagLoading || (!this._exploreInitialLoadComplete && !(this.exploreByTagKeywords || []).length)) {
          this._startExploreRefresh();
        }
      } else {
        if (this._exploreInitialLoadPending) {
          this._finishExploreRefresh();
        }
        this._maybeStartInitialRefresh();
      }
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
      && (changedProps.has('curateOrderBy') || changedProps.has('curateDateOrder'))
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

    if (changedProps.has('exploreByTagLoading') && this.searchSubTab === 'explore-by-tag') {
      if (this.exploreByTagLoading) {
        this._startExploreRefresh();
      } else {
        this._finishExploreRefresh();
      }
    }

    if (changedProps.has('exploreByTagKeywords') && this.searchSubTab === 'explore-by-tag') {
      if (this._exploreInitialLoadPending && !(this.exploreByTagKeywords || []).length) {
        return;
      }
      if (this._exploreInitialLoadPending) {
        this._finishExploreRefresh();
      } else if (!this._exploreInitialLoadComplete && (this.exploreByTagKeywords || []).length > 0) {
        this._exploreInitialLoadComplete = true;
      }
    }

    if (changedProps.has('exploreByTagKeywords')) {
      const total = (this.exploreByTagKeywords || []).length;
      if (this.exploreByTagOffset >= total && total > 0) {
        this.exploreByTagOffset = 0;
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
    if (now - this._lastListFetchTime < this._listFetchDebounceMs) {
      return;
    }

    this._lastListFetchTime = now;
    try {
    this.searchLists = await getLists(this.tenant, { force });
    } catch (error) {
      console.error('Error fetching search lists:', error);
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
    if (!this.exploreByTagData || typeof this.exploreByTagData !== 'object') {
      if (!this.browseByFolderData || typeof this.browseByFolderData !== 'object') {
        return null;
      }
    }
    const sources = [];
    if (this.exploreByTagData && typeof this.exploreByTagData === 'object') {
      sources.push(...Object.values(this.exploreByTagData));
    }
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
    const query = event.detail?.query || '';
    this._searchDropboxQuery = query;
    if (this._searchDropboxFetchTimer) {
      clearTimeout(this._searchDropboxFetchTimer);
    }
    if (query.length < 2) {
      this.searchDropboxOptions = [];
      return;
    }
    this._searchDropboxFetchTimer = setTimeout(() => {
      this._fetchDropboxFolders(query);
    }, 500);
  }

  async _fetchDropboxFolders(query) {
    if (!this.tenant) return;
    try {
      const response = await getDropboxFolders(this.tenant, { query });
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
    this.searchSubTab = nextTab;
    this.dispatchEvent(new CustomEvent('search-subtab-changed', {
      detail: { subtab: nextTab },
      bubbles: true,
      composed: true
    }));

    if (nextTab === 'explore-by-tag') {
      this._loadExploreByTagData(false);
    }
  }

  _setupSearchFilterPanel(panel) {
    if (!panel) return;
    if (this._searchFilterPanelHandlers?.panel === panel) {
      return;
    }
    if (this._searchFilterPanelHandlers?.panel) {
      this._teardownSearchFilterPanel(this._searchFilterPanelHandlers.panel);
    }
    const handleLoaded = (detail) => {
      if (detail?.tabId !== 'search') return;
      this._finishInitialRefresh();
    };
    const handleError = (detail) => {
      if (detail?.tabId !== 'search') return;
      this._finishInitialRefresh();
    };
    this._searchFilterPanelHandlers = { panel, handleLoaded, handleError };
    panel.on('images-loaded', handleLoaded);
    panel.on('error', handleError);
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
    this._searchFilterPanelHandlers = null;
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

  _startExploreRefresh() {
    if (this._exploreInitialLoadPending) return;
    this._exploreInitialLoadPending = true;
    this.searchRefreshing = true;
  }

  _finishExploreRefresh() {
    if (!this._exploreInitialLoadPending) return;
    this._exploreInitialLoadPending = false;
    this._exploreInitialLoadComplete = true;
    if (!this._searchInitialLoadPending) {
      this.searchRefreshing = false;
    }
  }

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

  async _loadExploreByTagData(force = false) {
    // TODO: Implement explore by tag data loading
    // This will need to be connected to the parent's data loading logic
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
    const nextDateOrder = this.curateOrderBy === field
      ? (this.curateDateOrder === 'desc' ? 'asc' : 'desc')
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
    if (this.curateOrderBy !== field) return '';
    return this.curateDateOrder === 'desc' ? '↓' : '↑';
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

  _renderSearchPermatagSummary(image) {
    const permatags = Array.isArray(image?.permatags) ? image.permatags : [];
    const positives = permatags.filter((tag) => tag.signum === 1 && tag.keyword);
    if (!positives.length) return html``;
    const unique = Array.from(new Set(positives.map((tag) => tag.keyword).filter(Boolean)));
    if (!unique.length) return html``;
    return html`<div class="curate-thumb-rating">Tags: ${unique.join(', ')}</div>`;
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
      sortOrder: 'desc',
      orderBy: 'photo_creation',
      hideZeroRating: true,
      keywords: {},
      operators: {},
      categoryFilterSource: 'permatags',
    };

    // Apply each chip filter to the filter object
    chips.forEach(chip => {
      switch (chip.type) {
        case 'keyword':
          if (chip.value === '__untagged__') {
            searchFilters.permatagPositiveMissing = true;
          } else {
            // Merge into keywords object instead of replacing it
            if (!searchFilters.keywords[chip.category]) {
              searchFilters.keywords[chip.category] = new Set();
            }
            searchFilters.keywords[chip.category].add(chip.value);
          }
          break;
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
          searchFilters.dropboxPathPrefix = chip.value;
          break;
      }
    });

    // Update filter panel with the complete filter object
    if (this.searchFilterPanel) {
      this.searchFilterPanel.updateFilters(searchFilters);
      this.searchFilterPanel.fetchImages();
    }
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

  _handleExploreByTagPointerDown(event, index, imageId, order, groupKey) {
    this._searchExploreOrder = order;
    this._searchExploreGroupKey = groupKey;
    return this._handleSearchPointerDown(event, index, imageId);
  }

  _handleExploreByTagSelectHover(index, groupKey) {
    if (this._searchExploreGroupKey !== groupKey) {
      return;
    }
    return this._handleSearchSelectHover(index);
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
    event.dataTransfer.setData('application/x-photocat-source', 'search-available');
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

  _getExplorePaginationState() {
    const total = (this.exploreByTagKeywords || []).length;
    const offset = Number(this.exploreByTagOffset) || 0;
    const limit = Number(this.exploreByTagLimit) || 100;
    const count = Math.max(0, Math.min(limit, total - offset));
    return { total, offset, limit, count };
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

  _handleExploreByTagPagePrev() {
    const { offset, limit } = this._getExplorePaginationState();
    this.exploreByTagOffset = Math.max(0, offset - limit);
  }

  _handleExploreByTagPageNext() {
    const { offset, limit, total } = this._getExplorePaginationState();
    const nextOffset = offset + limit < total ? offset + limit : offset;
    this.exploreByTagOffset = nextOffset;
  }

  _handleExploreByTagPageLimitChange(event) {
    const nextLimit = parseInt(event.target.value, 10);
    if (!Number.isFinite(nextLimit)) return;
    this.exploreByTagLimit = nextLimit;
    this.exploreByTagOffset = 0;
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
    const explorePagination = this.searchSubTab === 'explore-by-tag'
      ? (() => {
        const { offset, limit, total, count } = this._getExplorePaginationState();
        return renderResultsPagination({
          offset,
          limit,
          total,
          count,
          onPrev: () => this._handleExploreByTagPagePrev(),
          onNext: () => this._handleExploreByTagPageNext(),
          onLimitChange: (event) => this._handleExploreByTagPageLimitChange(event),
          disabled: this.exploreByTagLoading,
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
    const exploreKeywordsPage = (this.exploreByTagKeywords || [])
      .slice(this.exploreByTagOffset, this.exploreByTagOffset + this.exploreByTagLimit);
    const browseFoldersPage = (appliedFolders || [])
      .slice(this.browseByFolderOffset, this.browseByFolderOffset + this.browseByFolderLimit);
    const browseByFolderBlurStyle = this.browseByFolderLoading
      ? 'filter: blur(2px); opacity: 0.6; pointer-events: none;'
      : '';
    const savedPane = html`
      <div class="curate-pane utility-targets search-saved-pane ${this.searchSavedDragTarget ? 'drag-active' : ''}">
        <div class="curate-pane-header">
          <div class="curate-pane-header-row">
            <span class="text-sm font-semibold">Lists</span>
          </div>
        </div>
        <div
          class="curate-pane-body flex flex-col"
          @dragover=${this._handleSearchSavedDragOver}
          @dragleave=${this._handleSearchSavedDragLeave}
          @drop=${this._handleSearchSavedDrop}
        >
          <!-- List Management Controls -->
          <div class="p-3 bg-gray-50 border-t">
            <label class="block text-xs font-semibold text-gray-700 mb-2">Current List:</label>
            <select
              class="w-full p-2 border rounded text-sm mb-2"
              @change=${this._handleSearchListSelect}
              .value=${this.searchListId || ''}
            >
              <option value="">New list</option>
              ${this.searchLists.map(list => html`
                <option value=${list.id}>${list.title}</option>
              `)}
            </select>

            ${!this.searchListId ? html`
              <label class="block text-xs font-semibold text-gray-700 mb-2">New list name:</label>
              <input
                id="search-list-title-input"
                type="text"
                placeholder="List title..."
                .value=${this.searchListTitle || ''}
                @input=${this._handleSearchListTitleChange}
                class="w-full p-2 border rounded text-sm mb-2"
              >
            ` : ''}

            <button
              class="w-full bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
              @click=${this._handleSaveToList}
              ?disabled=${(!this.searchListId && (!this.searchListTitle || this._isDuplicateListTitle(this.searchListTitle)))
                || (this.searchListId && (this.searchSavedImages || []).length === 0)}
            >
              ${this.searchListId ? 'Save' : 'Save new'} (${(this.searchSavedImages || []).length})
            </button>
            ${this.searchListError ? html`
              <div class="mt-2 text-xs font-semibold text-red-600">
                ${this.searchListError}
              </div>
            ` : ''}
          </div>

          <!-- Combined Area: Existing List Items + Drag Target for New Images -->
          <div class="flex-1">
            ${this.searchListId && (this.searchListItems || []).length > 0 ? html`
              <div class="p-2 border-b">
                <div class="text-xs font-semibold text-gray-600 mb-2">
                  ${this.searchListTitle} (${this.searchListItems.length} items)
                </div>
                <div class="search-saved-grid max-h-48 overflow-y-auto">
                  ${this.searchListItems.map(item => html`
                    <div class="search-saved-item">
                      <img
                        src=${item.photo?.thumbnail_url || `/api/v1/images/${item.photo_id}/thumbnail`}
                        alt=${item.photo?.filename || ''}
                        class="search-saved-thumb opacity-75"
                      >
                    </div>
                  `)}
                </div>
              </div>
            ` : ''}

            ${(this.searchSavedImages || []).length > 0 ? html`
              <div class="p-2">
                <div class="text-xs font-semibold text-gray-600 mb-2">
                  To be added (${this.searchSavedImages.length})
                </div>
                <div class="search-saved-grid">
                  ${this.searchSavedImages.map(image => html`
                    <div class="search-saved-item">
                      <img
                        src=${image.thumbnail_url || `/api/v1/images/${image.id}/thumbnail`}
                        alt=${image.filename}
                        class="search-saved-thumb"
                        draggable="true"
                        @dragstart=${(e) => this._handleSearchSavedDragStart(e, image)}
                      >
                      <button
                        class="search-saved-remove"
                        @click=${() => this._handleSearchRemoveSaved(image.id)}
                        title="Remove"
                      >×</button>
                    </div>
                  `)}
                </div>
              </div>
            ` : !this.searchListId || !(this.searchListItems || []).length ? html`
              <div class="p-4 text-center text-gray-500 text-sm">
                Drag images here to save to a list
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    return html`
      <div class="container">
        <!-- Search Tab Header -->
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
              class="curate-subtab ${this.searchSubTab === 'explore-by-tag' ? 'active' : ''}"
              @click=${() => this._handleSearchSubTabChange('explore-by-tag')}
            >
              Explore by Tag
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
              @filters-changed=${this._handleChipFiltersChanged}
              @folder-search=${this._handleSearchDropboxInput}
            ></filter-chips>

            <!-- Image Grid Layout -->
            <div class="curate-layout search-layout mt-4" style="--curate-thumb-size: ${this.curateThumbSize}px; ${browseByFolderBlurStyle}">
              <!-- Left Pane: Available Images -->
              <div class="curate-pane" @dragover=${this._handleSearchAvailableDragOver} @drop=${this._handleSearchAvailableDrop}>
                <div class="curate-pane-header">
                  <div class="curate-pane-header-row">
                    <span class="text-sm font-semibold">Available Images</span>
                  </div>
                </div>
                <div class="curate-pane-body">
                  <div class="p-2">
                    ${searchPagination}
                  </div>
                  ${this.searchImages && this.searchImages.length > 0 ? html`
                    <div class="curate-grid">
                      <!-- ⭐ REFERENCE: Standardized image rendering pattern -->
                      <!-- This template shows the complete pattern for images with: -->
                      <!-- - Long-press multi-select (pointerdown/move/enter handlers) -->
                      <!-- - Drag & drop (dragstart handler checks selectingProperty) -->
                      <!-- - Rating widgets (renderCurateRatingWidget/Static props) -->
                      <!-- - Click to open modal (image-clicked event) -->
                      <!-- - Selection styling (.selected class, flash animation) -->
                      <!-- - Photo date display (formatCurateDate prop) -->
                      <!-- COPY THIS PATTERN when creating image display components! -->
                      ${this.searchImages.map((image, index) => html`
                        <div
                          class="curate-thumb-wrapper ${this.searchDragSelection.includes(image.id) ? 'selected' : ''}"
                          data-image-id="${image.id}"
                          draggable="true"
                          @dragstart=${(event) => this._handleSearchDragStart(event, image)}
                          @click=${(event) => this._handleSearchImageClick(event, image, this.searchImages)}
                        >
                          <img
                            src=${image.thumbnail_url || `/api/v1/images/${image.id}/thumbnail`}
                            alt=${image.filename}
                            class="curate-thumb ${this.searchDragSelection.includes(image.id) ? 'selected' : ''} ${this._searchFlashSelectionIds?.has(image.id) ? 'flash' : ''}"
                            draggable="false"
                            @pointerdown=${(event) => this._handleSearchPointerDown(event, index, image.id)}
                            @pointermove=${(event) => this._handleSearchPointerMove(event)}
                            @pointerenter=${() => this._handleSearchSelectHover(index)}
                          >
                          ${this.renderCurateRatingWidget ? this.renderCurateRatingWidget(image) : ''}
                          ${this.renderCurateRatingStatic ? this.renderCurateRatingStatic(image) : ''}
                          ${this._renderSearchPermatagSummary(image)}
                          ${this.formatCurateDate && this.formatCurateDate(image) ? html`
                            <div class="curate-thumb-date">
                              <span class="curate-thumb-id">#${image.id}</span>
                              <span class="curate-thumb-icon" aria-hidden="true">📷</span>${this.formatCurateDate(image)}
                            </div>
                          ` : ''}
                        </div>
                      `)}
                    </div>
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

        <!-- Explore by Tag Subtab -->
        ${this.searchSubTab === 'explore-by-tag' ? html`
          <div>
            <div class="curate-layout search-layout mt-4" style="--curate-thumb-size: ${this.curateThumbSize}px;">
              <div class="curate-pane" @dragover=${this._handleSearchAvailableDragOver} @drop=${this._handleSearchAvailableDrop}>
                <div class="curate-pane-header">
                  <div class="curate-pane-header-row">
                    <span class="text-sm font-semibold">Explore by Tag</span>
                  </div>
                </div>
                <div class="curate-pane-body">
                  ${this.exploreByTagLoading && !(this.exploreByTagKeywords && this.exploreByTagKeywords.length) ? html`
                    <div class="p-8"></div>
                  ` : this.exploreByTagKeywords && this.exploreByTagKeywords.length > 0 ? html`
                    <div class="p-2">
                      ${explorePagination}
                    </div>
                    <div class="space-y-6">
                      ${exploreKeywordsPage.map(keyword => {
                        const images = this.exploreByTagData[keyword] || [];
                        const order = images.map((image) => image.id);
                        return html`
                          <div>
                            <div class="text-sm font-semibold text-gray-900 mb-3">
                              ${keyword}
                              <span class="text-xs text-gray-500 font-normal">(${images.length} images)</span>
                            </div>
                            <div class="curate-grid">
                              ${images.length ? images.map((image, index) => html`
                                <div
                                  class="curate-thumb-wrapper ${this.searchDragSelection.includes(image.id) ? 'selected' : ''}"
                                  data-image-id="${image.id}"
                                  draggable="true"
                                  @dragstart=${(event) => this._handleSearchDragStart(event, image)}
                                  @click=${(event) => this._handleSearchImageClick(event, image, images)}
                                >
                                  <img
                                    src=${image.thumbnail_url || `/api/v1/images/${image.id}/thumbnail`}
                                    alt=${image.filename}
                                    class="curate-thumb ${this.searchDragSelection.includes(image.id) ? 'selected' : ''} ${this._searchFlashSelectionIds?.has(image.id) ? 'flash' : ''}"
                                    draggable="false"
                                    @pointerdown=${(event) => this._handleExploreByTagPointerDown(event, index, image.id, order, keyword)}
                                    @pointermove=${(event) => this._handleSearchPointerMove(event)}
                                    @pointerenter=${() => this._handleExploreByTagSelectHover(index, keyword)}
                                  >
                                  ${this.renderCurateRatingWidget ? this.renderCurateRatingWidget(image) : ''}
                                  ${this.renderCurateRatingStatic ? this.renderCurateRatingStatic(image) : ''}
                                  ${this._renderSearchPermatagSummary(image)}
                                  ${this.formatCurateDate && this.formatCurateDate(image) ? html`
                                    <div class="curate-thumb-date">
                                      <span class="curate-thumb-id">#${image.id}</span>
                                      <span class="curate-thumb-icon" aria-hidden="true">📷</span>${this.formatCurateDate(image)}
                                    </div>
                                  ` : ''}
                                </div>
                              `) : html`
                                <div class="col-span-full text-xs text-gray-400 py-4 text-center">
                                  No images found.
                                </div>
                              `}
                            </div>
                          </div>
                        `;
                      })}
                    </div>
                    <div class="p-2">
                      ${explorePagination}
                    </div>
                  ` : html`
                    <div class="p-8 text-center text-gray-500">
                      <p class="text-sm">No tagged images found.</p>
                      <p class="text-xs mt-2">Tag some images first to explore by tag.</p>
                    </div>
                  `}
                </div>
              </div>

              ${savedPane}
            </div>
          </div>
        ` : ''}

        <!-- Browse by Folder Subtab -->
        ${this.searchSubTab === 'browse-by-folder' ? html`
          <div>
            <div class="curate-layout search-layout mt-4" style="--curate-thumb-size: ${this.curateThumbSize}px;">
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
                                    class="curate-thumb-wrapper ${this.searchDragSelection.includes(image.id) ? 'selected' : ''}"
                                    data-image-id="${image.id}"
                                    draggable="true"
                                    @dragstart=${(event) => this._handleSearchDragStart(event, image)}
                                    @click=${(event) => this._handleSearchImageClick(event, image, images)}
                                  >
                                    <img
                                      src=${image.thumbnail_url || `/api/v1/images/${image.id}/thumbnail`}
                                      alt=${image.filename}
                                      class="curate-thumb ${this.searchDragSelection.includes(image.id) ? 'selected' : ''} ${this._searchFlashSelectionIds?.has(image.id) ? 'flash' : ''}"
                                      draggable="false"
                                      @pointerdown=${(event) => this._handleBrowseByFolderPointerDown(event, index, image.id, order, folder)}
                                      @pointermove=${(event) => this._handleSearchPointerMove(event)}
                                      @pointerenter=${() => this._handleBrowseByFolderSelectHover(index, folder)}
                                    >
                                    ${this.renderCurateRatingWidget ? this.renderCurateRatingWidget(image) : ''}
                                    ${this.renderCurateRatingStatic ? this.renderCurateRatingStatic(image) : ''}
                                    ${this._renderSearchPermatagSummary(image)}
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
                </div>
              </div>

              ${savedPane}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }
}

customElements.define('search-tab', SearchTab);
