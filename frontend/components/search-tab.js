import { LitElement, html } from 'lit';
import { enqueueCommand } from '../services/command-queue.js';
import {
  getLists,
  createList,
  updateList,
  addToList,
  getListItems,
  getDropboxFolders,
  getKeywordGalleryPreviews,
} from '../services/api.js';
import { createHotspotHandlers, parseUtilityKeywordValue } from './shared/hotspot-controls.js';
import {
  getKeywordsByCategory,
  getKeywordsByCategoryFromList,
} from './shared/keyword-utils.js';
import { formatStatNumber } from './shared/formatting.js';
import { renderCanonicalListDetails } from './shared/image-grid.js';
import { createSelectionHandlers } from './shared/selection-handlers.js';
import { renderResultsPagination } from './shared/pagination-controls.js';
import { renderSelectableImageGrid } from './shared/selectable-image-grid.js';
import { renderSimilarityModeHeader } from './shared/similarity-mode-header.js';
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
import { migrateLocalStorageKey } from '../services/app-storage.js';
import './shared/widgets/filter-chips.js';
import './shared/widgets/right-panel.js';
import './shared/widgets/list-targets-panel.js';
import './shared/widgets/hotspot-targets-panel.js';
import './shared/widgets/rating-target-panel.js';
import ImageFilterPanel from './shared/state/image-filter-panel.js';
import FolderBrowserPanel from './folder-browser-panel.js';

const VECTORSTORE_DEFAULT_LEXICAL_WEIGHT = 1.0;
const SEARCH_RIGHT_PANEL_TOOL_STORAGE_KEY = 'zoltan:app:rightPanelTool:search';
const LEGACY_SEARCH_RIGHT_PANEL_TOOL_STORAGE_KEYS = ['rightPanelTool:search'];
const SEARCH_RESULTS_LAYOUT_STORAGE_KEY = 'zoltag:app:search:resultsLayout';
const LEGACY_SEARCH_RESULTS_LAYOUT_STORAGE_KEYS = ['searchResultsLayout'];
const EXPLORE_RIGHT_PANEL_COLLAPSED_STORAGE_KEY = 'zoltag:app:rightPanelCollapsed:explore';

/**
 * Search Tab Component
 *
 * ⭐ REFERENCE IMPLEMENTATION for standardized image rendering pattern
 * See lines 136-149 (selection handlers), 369-410 (event handlers), 479-507 (template)
 * Copy this pattern when creating components that display images!
 *
 * Provides search functionality with two modes:
 * - Search Home: Filter-based image search with list management
 * - Vectorstore: Text-to-vector hybrid retrieval over indexed embeddings/permatags
 * - Browse by Folder: Browse images grouped by folder
 * - Natural Search: Experimental NL query flow
 * - Explore: Tag chip based navigation
 * - Gallery: Collection-style topic entry points
 *
 * @property {String} tenant - Current tenant ID
 * @property {String} searchSubTab - Active subtab ('advanced', 'results', 'browse-by-folder', 'natural-search', 'chips', 'gallery')
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
    searchPinnedImageId: { type: Number },
    searchSimilarityAssetUuid: { type: String },
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
    initialVectorstoreQuery: { type: String },
    initialVectorstoreQueryToken: { type: Number },
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
    rightPanelCollapsed: { type: Boolean, state: true },
    searchResultsLayout: { type: String, state: true },
    canCurate: { type: Boolean },
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
    searchResultsView: { type: String, state: true },
    _searchHotspotHistoryBatches: { type: Array, state: true },
    _searchHotspotHistoryVisibleBatches: { type: Number, state: true },
    vectorstoreQuery: { type: String, state: true },
    vectorstoreLexicalWeight: { type: Number, state: true },
    vectorstoreLoading: { type: Boolean, state: true },
    _showRankingBalance: { type: Boolean, state: true },
    vectorstoreHasSearched: { type: Boolean, state: true },
    galleryCollections: { type: Array, state: true },
    galleryLoading: { type: Boolean, state: true },
    galleryTopicQuery: { type: String, state: true },
    gallerySelectedCategories: { type: Array, state: true },
    galleryTagSortOrder: { type: String, state: true },
    galleryTransitionLoading: { type: Boolean, state: true },
  };

  constructor() {
    super();
    this.tenant = '';
    this.searchSubTab = 'gallery';
    this.searchChipFilters = [];
    this.searchFilterPanel = null;
    this.searchDropboxOptions = [];
    this.searchImages = [];
    this.searchSelectedImages = new Set();
    this.searchTotal = 0;
    this.searchPinnedImageId = null;
    this.searchSimilarityAssetUuid = null;
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
    this.initialVectorstoreQuery = '';
    this.initialVectorstoreQueryToken = 0;
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
    this.rightPanelCollapsed = false;
    this.searchResultsLayout = 'thumb';
    this.canCurate = true;
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
    this.searchResultsView = 'results';
    this._searchHotspotHistoryBatches = [];
    this._searchHotspotHistoryVisibleBatches = 1;
    this.vectorstoreQuery = '';
    this.vectorstoreLexicalWeight = VECTORSTORE_DEFAULT_LEXICAL_WEIGHT;
    this.vectorstoreLoading = false;
    this.vectorstoreHasSearched = false;
    this._showRankingBalance = false;
    this.galleryCollections = [];
    this.galleryLoading = false;
    this.galleryTopicQuery = '';
    this.gallerySelectedCategories = [];
    this.galleryTagSortOrder = 'asc';
    this.galleryTransitionLoading = false;
    this._galleryCategorySelectionTouched = false;
    this._galleryTopicFocused = false;
    this._galleryLoadToken = 0;
    this._suppressNextAdvancedInitialRefresh = false;
    this._searchHotspotHandlers = createHotspotHandlers(this, {
      targetsProperty: 'searchHotspotTargets',
      dragTargetProperty: '_searchHotspotDragTarget',
      nextIdProperty: '_searchHotspotNextId',
      parseKeywordValue: parseUtilityKeywordValue,
      applyRating: (ids, rating) => this._applySearchHotspotRating(ids, rating),
      processTagDrop: (ids, target) => this._processSearchHotspotTagDrop(ids, target),
      removeImages: () => {},
    });
    migrateLocalStorageKey(
      SEARCH_RIGHT_PANEL_TOOL_STORAGE_KEY,
      LEGACY_SEARCH_RIGHT_PANEL_TOOL_STORAGE_KEYS,
    );
    migrateLocalStorageKey(
      SEARCH_RESULTS_LAYOUT_STORAGE_KEY,
      LEGACY_SEARCH_RESULTS_LAYOUT_STORAGE_KEYS,
    );
    try {
      const storedTool = localStorage.getItem(SEARCH_RIGHT_PANEL_TOOL_STORAGE_KEY);
      this.rightPanelTool = this._resolveRightPanelTool(storedTool);
      const storedLayout = localStorage.getItem(SEARCH_RESULTS_LAYOUT_STORAGE_KEY);
      this.searchResultsLayout = this._normalizeSearchResultsLayout(storedLayout);
      this.rightPanelCollapsed = localStorage.getItem(EXPLORE_RIGHT_PANEL_COLLAPSED_STORAGE_KEY) === 'true';
    } catch {
      this.rightPanelTool = this._resolveRightPanelTool(this.rightPanelTool);
      this.searchResultsLayout = this._normalizeSearchResultsLayout(this.searchResultsLayout);
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
    this._searchHistoryOrder = null;
    this._searchHistoryGroupKey = null;
    this._searchFilterPanelHandlers = null;
    this._searchAdvancedFiltersState = null;
    this._searchResultsFiltersState = null;
    this._appliedInitialVectorstoreQueryToken = 0;
    this._folderBrowserPanelHandlers = null;
    this._searchDropboxFetchTimer = null;
    this._searchListDropRefreshTimer = null;
    this._searchDropboxQuery = '';
    this._searchLoadingCount = 0;
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
        if (this.searchResultsView === 'history') {
          return this._searchHistoryOrder || [];
        }
        if (this.searchSubTab === 'browse-by-folder') {
          return this._searchBrowseOrder || [];
        }
        return (this.searchImages || []).map(img => img.id);
      },
      flashSelection: (imageId) => this._flashSearchSelection(imageId),
    });
  }

  _createDefaultSearchFilters(overrides = {}) {
    return {
      limit: 100,
      offset: 0,
      sortOrder: 'desc',
      orderBy: 'photo_creation',
      hideZeroRating: true,
      keywords: {},
      operators: {},
      categoryFilterOperator: undefined,
      rating: undefined,
      ratingOperator: undefined,
      dropboxPathPrefix: '',
      filenameQuery: '',
      textQuery: '',
      mediaType: 'all',
      sourceProvider: '',
      permatagPositiveMissing: false,
      noPermatagCategories: [],
      noPermatagUntagged: false,
      noPermatagOperator: 'AND',
      listId: undefined,
      listExcludeId: undefined,
      hybridVectorWeight: undefined,
      hybridLexicalWeight: undefined,
      ...overrides,
    };
  }

  _cloneKeywordFilters(rawKeywords) {
    if (!rawKeywords || typeof rawKeywords !== 'object') return {};
    const cloned = {};
    Object.entries(rawKeywords).forEach(([category, values]) => {
      if (values instanceof Set) {
        cloned[category] = new Set(values);
        return;
      }
      if (Array.isArray(values)) {
        cloned[category] = new Set(values.filter(Boolean));
        return;
      }
      if (values && typeof values[Symbol.iterator] === 'function') {
        cloned[category] = new Set(Array.from(values).filter(Boolean));
      }
    });
    return cloned;
  }

  _cloneSearchFilters(filters = {}) {
    const normalized = this._createDefaultSearchFilters(filters || {});
    return {
      ...normalized,
      keywords: this._cloneKeywordFilters(normalized.keywords),
      operators: { ...(normalized.operators || {}) },
      noPermatagCategories: Array.isArray(normalized.noPermatagCategories)
        ? [...normalized.noPermatagCategories]
        : [],
      noPermatagUntagged: Boolean(
        normalized.noPermatagUntagged
        ?? normalized.permatagPositiveMissing
      ),
      noPermatagOperator: String(normalized.noPermatagOperator || 'AND').trim().toUpperCase() === 'OR'
        ? 'OR'
        : 'AND',
    };
  }

  _buildIsolatedResultsFilters(baseFilters = {}) {
    const base = this._cloneSearchFilters(baseFilters || {});
    return this._createDefaultSearchFilters({
      limit: base.limit,
      sortOrder: base.sortOrder,
      orderBy: base.orderBy,
      hideZeroRating: base.hideZeroRating,
      mediaType: base.mediaType || 'all',
      sourceProvider: base.sourceProvider || '',
    });
  }

  async _refreshSearch() {
    if (this.searchRefreshing) return;
    this._startSearchLoading();
    try {
      const tasks = [];
      if (this.searchSubTab === 'advanced' || (this.searchSubTab === 'results' && this.vectorstoreHasSearched)) {
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
      this._finishSearchLoading();
    }
  }

  _startSearchLoading() {
    this._searchLoadingCount = (this._searchLoadingCount || 0) + 1;
    this.searchRefreshing = true;
  }

  _finishSearchLoading() {
    this._searchLoadingCount = Math.max(0, (this._searchLoadingCount || 1) - 1);
    this.searchRefreshing = this._searchLoadingCount > 0;
    if (!this.searchRefreshing && this.galleryTransitionLoading) {
      this.galleryTransitionLoading = false;
    }
  }

  // ========================================
  // Lifecycle Methods
  // ========================================

  connectedCallback() {
    super.connectedCallback();
    this._restoreSearchHistorySessionState();
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
      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
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
      const hadLongPress = this._searchLongPressTriggered;
      this._searchBrowseGroupKey = null;
      this._searchHistoryGroupKey = null;
      this._searchSelectionHandlers.cancelPressState();
      if (hadLongPress) {
        this._searchSuppressClick = true;
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
      this._searchAdvancedFiltersState = null;
      this._searchResultsFiltersState = null;
      this.searchLists = [];
      this.galleryCollections = [];
      this.galleryLoading = false;
      this.galleryTopicQuery = '';
      this.gallerySelectedCategories = [];
      this.galleryTagSortOrder = 'asc';
      this.galleryTransitionLoading = false;
      this._galleryCategorySelectionTouched = false;
      this._galleryLoadToken += 1;
      this._restoreSearchHistorySessionState();
      this._fetchSearchLists({ force: true });
    }
    if (changedProps.has('searchFilterPanel')) {
      this._teardownSearchFilterPanel(changedProps.get('searchFilterPanel'));
      this._setupSearchFilterPanel(this.searchFilterPanel);
      this._maybeStartInitialRefresh();
      void this._maybeApplyInitialVectorstoreQuery();
    }
    if (changedProps.has('rightPanelTool')) {
      try {
        localStorage.setItem(SEARCH_RIGHT_PANEL_TOOL_STORAGE_KEY, this.rightPanelTool);
      } catch {
        // ignore storage errors
      }
    }
    if (changedProps.has('searchResultsLayout')) {
      try {
        localStorage.setItem(SEARCH_RESULTS_LAYOUT_STORAGE_KEY, this.searchResultsLayout);
      } catch {
        // ignore storage errors
      }
    }
    if (changedProps.has('rightPanelCollapsed')) {
      try {
        localStorage.setItem(EXPLORE_RIGHT_PANEL_COLLAPSED_STORAGE_KEY, String(this.rightPanelCollapsed));
      } catch {
        // ignore storage errors
      }
    }

    if (changedProps.has('canCurate')) {
      const normalizedTool = this._resolveRightPanelTool(this.rightPanelTool);
      if (normalizedTool !== this.rightPanelTool) {
        this.rightPanelTool = normalizedTool;
      }
    }

    if (changedProps.has('searchSubTab')) {
      if (this.hideSubtabs && this.searchSubTab !== 'advanced') {
        this.searchSubTab = 'advanced';
        return;
      }
      const previousSubTab = changedProps.get('searchSubTab');
      if (this.searchSubTab === 'gallery' && previousSubTab !== 'gallery') {
        this._clearFiltersForGalleryEntry();
      }
      const currentFilters = this.searchFilterPanel?.getState?.() || this.searchFilterPanel?.filters || {};
      if (previousSubTab === 'results') {
        this._searchResultsFiltersState = this._cloneSearchFilters(currentFilters);
      } else {
        this._searchAdvancedFiltersState = this._cloneSearchFilters(currentFilters);
      }

      if (this.searchSubTab === 'results') {
        if (previousSubTab !== 'results') {
          this.vectorstoreHasSearched = false;
        }
        if (!this._searchResultsFiltersState) {
          const base = this._searchAdvancedFiltersState || currentFilters;
          this._searchResultsFiltersState = this._buildIsolatedResultsFilters(base);
        }
        if (this.searchFilterPanel) {
          const nextResultsFilters = this._cloneSearchFilters(this._searchResultsFiltersState);
          this.searchFilterPanel.updateFilters(nextResultsFilters);
          this._syncChipFiltersFromFilterState(nextResultsFilters);
        }
        const resultsFilters = this._searchResultsFiltersState || {};
        this.vectorstoreQuery = String(resultsFilters.textQuery || '');
        const vectorstoreWeights = this._readVectorstoreWeights(resultsFilters);
        this.vectorstoreLexicalWeight = vectorstoreWeights.lexicalWeight;
      } else if (previousSubTab === 'results' && this.searchFilterPanel) {
        const nextAdvancedFilters = this._cloneSearchFilters(
          this._searchAdvancedFiltersState || this._createDefaultSearchFilters()
        );
        this.searchFilterPanel.updateFilters(nextAdvancedFilters);
        this._syncChipFiltersFromFilterState(nextAdvancedFilters);
        if (this.searchSubTab === 'advanced') {
          this.searchFilterPanel.fetchImages();
        }
      }
      if (this.searchSubTab === 'advanced' && this._suppressNextAdvancedInitialRefresh) {
        this._suppressNextAdvancedInitialRefresh = false;
      } else {
        this._maybeStartInitialRefresh();
      }
      if (this.searchSubTab === 'browse-by-folder') {
        this.browseByFolderOffset = 0;
        this.folderBrowserPanel?.loadFolders();
        if (this.browseByFolderAppliedSelection?.length) {
          this._refreshBrowseByFolderData();
        }
      }
      if (this.searchSubTab === 'landing' && !this.browseByFolderOptions?.length) {
        this.folderBrowserPanel?.loadFolders();
      }
      if (this.searchSubTab === 'gallery') {
        this._loadGalleryCollections();
      }
    }

    if ((changedProps.has('keywords') || changedProps.has('tenant')) && this.searchSubTab === 'gallery') {
      this._loadGalleryCollections();
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

    if (changedProps.has('searchSimilarityAssetUuid')) {
      this._syncChipFiltersFromFilterPanel();
      const previousValue = String(changedProps.get('searchSimilarityAssetUuid') || '').trim();
      const currentValue = String(this.searchSimilarityAssetUuid || '').trim();
      if (currentValue && currentValue !== previousValue) {
        this._scrollToTopForSimilarityMode();
      }
    }

    if (changedProps.has('browseByFolderAppliedSelection')) {
      const total = (this.browseByFolderAppliedSelection || []).length;
      if (this.browseByFolderOffset >= total && total > 0) {
        this.browseByFolderOffset = 0;
      }
    }

    if (
      changedProps.has('tenant')
      || changedProps.has('searchResultsView')
      || changedProps.has('_searchHotspotHistoryBatches')
      || changedProps.has('_searchHotspotHistoryVisibleBatches')
    ) {
      this._persistSearchHistorySessionState();
    }

    if (
      changedProps.has('initialVectorstoreQuery')
      || changedProps.has('initialVectorstoreQueryToken')
      || (changedProps.has('vectorstoreLoading') && !this.vectorstoreLoading)
    ) {
      void this._maybeApplyInitialVectorstoreQuery();
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
    this.rightPanelTool = this._resolveRightPanelTool(tool);
    if (this.rightPanelTool === 'lists' && !(this.searchLists || []).length) {
      this._fetchSearchLists();
    }
  }

  _handleRightPanelCollapseChanged(collapsed) {
    this.rightPanelCollapsed = Boolean(collapsed);
    try {
      localStorage.setItem(EXPLORE_RIGHT_PANEL_COLLAPSED_STORAGE_KEY, String(this.rightPanelCollapsed));
    } catch {
      // ignore storage errors
    }
  }

  _getRightPanelTools() {
    if (this.canCurate) {
      return [
        { id: 'tags', label: 'Tag' },
        { id: 'ratings', label: 'Ratings' },
        { id: 'lists', label: 'Lists' },
      ];
    }
    return [{ id: 'lists', label: 'Lists' }];
  }

  _resolveRightPanelTool(candidateTool) {
    const tools = this._getRightPanelTools();
    const allowed = new Set(tools.map((tool) => tool.id));
    const nextTool = String(candidateTool || '').trim();
    if (nextTool && allowed.has(nextTool)) {
      return nextTool;
    }
    return tools[0]?.id || 'lists';
  }

  _normalizeSearchResultsLayout(candidateMode) {
    return String(candidateMode || '').trim().toLowerCase() === 'list' ? 'list' : 'thumb';
  }

  _setSearchResultsLayout(nextMode) {
    this.searchResultsLayout = this._normalizeSearchResultsLayout(nextMode);
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
    if (typeof this.renderCurateRatingWidget !== 'function') return;
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
    const list = (this.searchLists || []).find((entry) => String(entry.id) === String(target.listId));
    const batch = createHotspotHistoryBatch({
      ids,
      dragImages: readDragImagePayload(event?.dataTransfer),
      imageSets: [this.searchImages || []],
      target: {
        type: 'list',
        keyword: list?.title || `List ${target.listId}`,
        category: 'List',
        action: 'add',
      },
      sourceLabel: this.searchSubTab === 'browse-by-folder' ? 'Search Browse' : 'Search Results',
    });
    if (batch) {
      this._searchHotspotHistoryBatches = prependHistoryBatch(this._searchHotspotHistoryBatches, batch);
      if (this._searchHotspotHistoryVisibleBatches < 1) {
        this._searchHotspotHistoryVisibleBatches = 1;
      }
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
    if (nextTab === 'gallery') {
      this._clearFiltersForGalleryEntry();
    }
    this.dispatchEvent(new CustomEvent('search-subtab-changed', {
      detail: { subtab: nextTab },
      bubbles: true,
      composed: true
    }));
  }

  _clearFiltersForGalleryEntry() {
    this.vectorstoreQuery = '';
    this.vectorstoreHasSearched = false;
    this.galleryTransitionLoading = false;
    this.searchChipFilters = [];
    this.searchListExcludeId = '';
    this.searchPinnedImageId = null;
    if (this.searchSimilarityAssetUuid) {
      this.searchSimilarityAssetUuid = null;
      this.dispatchEvent(new CustomEvent('search-similarity-context-changed', {
        detail: { assetUuid: null },
        bubbles: true,
        composed: true,
      }));
    }

    const nextAdvancedFilters = this._cloneSearchFilters(this._createDefaultSearchFilters({
      limit: 100,
      offset: 0,
      sortOrder: this.searchDateOrder || 'desc',
      orderBy: this.searchOrderBy || 'photo_creation',
      hideZeroRating: true,
    }));
    this._searchAdvancedFiltersState = nextAdvancedFilters;
    this._searchResultsFiltersState = this._buildIsolatedResultsFilters(nextAdvancedFilters);
    if (this.searchFilterPanel) {
      this.searchFilterPanel.updateFilters(nextAdvancedFilters);
    }
  }

  _resolveThumbnailUrl(image) {
    if (!image) return '';
    if (image.thumbnail_url) return image.thumbnail_url;
    if (image.thumbnailUrl) return image.thumbnailUrl;
    if (image?.photo?.thumbnail_url) return image.photo.thumbnail_url;
    const imageId = Number(image.id ?? image.photo_id ?? image.image_id ?? image?.photo?.id);
    return Number.isFinite(imageId) ? `/api/v1/images/${imageId}/thumbnail` : '';
  }

  _getGalleryTopicSuggestions(limit = 10) {
    const normalizedLimit = Math.max(1, Number(limit) || 10);
    const query = String(this.galleryTopicQuery || '').trim().toLowerCase();
    const topics = (this.galleryCollections || []).flatMap((section) => (
      (section?.items || [])
        .filter((item) => item?.keyword && item?.category)
        .map((item) => ({
          category: String(item.category),
          keyword: String(item.keyword),
          count: Number(item.count) || 0,
          searchable: `${String(item.keyword).toLowerCase()} ${String(item.category).toLowerCase()}`,
        }))
    ));
    if (!topics.length) return [];

    const filtered = query
      ? topics.filter((topic) => topic.searchable.includes(query))
      : topics;

    return filtered
      .sort((a, b) => {
        const aStarts = query && a.keyword.toLowerCase().startsWith(query) ? 1 : 0;
        const bStarts = query && b.keyword.toLowerCase().startsWith(query) ? 1 : 0;
        if (aStarts !== bStarts) return bStarts - aStarts;
        const countDiff = (b.count || 0) - (a.count || 0);
        if (countDiff !== 0) return countDiff;
        const categoryCompare = a.category.localeCompare(b.category);
        if (categoryCompare !== 0) return categoryCompare;
        return a.keyword.localeCompare(b.keyword);
      })
      .slice(0, normalizedLimit);
  }

  _handleGalleryTopicInput(event) {
    this.galleryTopicQuery = event?.target?.value || '';
  }

  _handleGalleryTopicFocus() {
    this._galleryTopicFocused = true;
    this.requestUpdate();
  }

  _handleGalleryTopicBlur() {
    setTimeout(() => {
      this._galleryTopicFocused = false;
      this.requestUpdate();
    }, 120);
  }

  _submitExploreTextSearch(rawQuery) {
    const query = String(rawQuery || '').trim();
    if (!query) return;
    this.vectorstoreQuery = query;
    this._handleSearchSubTabChange('results');
    this._runVectorstoreSearch();
  }

  _handleGalleryTopicSubmit(event) {
    event?.preventDefault?.();
    this._submitExploreTextSearch(this.galleryTopicQuery);
  }

  _handleGalleryTopicSelect(topic) {
    if (!topic?.category || !topic?.keyword) return;
    this.galleryTopicQuery = topic.keyword;
    this._galleryTopicFocused = false;
    this._handleGalleryCollectionSelect(topic.category, topic.keyword);
  }

  _applyGalleryTagViewDefaultSort() {
    this.searchOrderBy = 'rating';
    this.searchDateOrder = 'desc';
    this.dispatchEvent(new CustomEvent('sort-changed', {
      detail: { orderBy: 'rating', dateOrder: 'desc', suppressFetch: true },
      bubbles: true,
      composed: true,
    }));
  }

  _startGalleryTransitionLoading() {
    this.galleryTransitionLoading = true;
  }

  _handleGalleryChipFiltersChanged(event) {
    const nextFilters = Array.isArray(event?.detail?.filters) ? event.detail.filters : [];
    if (nextFilters.length) {
      this._startGalleryTransitionLoading();
    }
    if (nextFilters.some((filter) => filter?.type === 'keyword')) {
      this._applyGalleryTagViewDefaultSort();
    }
    this._handleChipFiltersChanged(event);
    if (!nextFilters.length) return;
    this._suppressNextAdvancedInitialRefresh = true;
    this._handleSearchSubTabChange('advanced');
  }

  _toggleGalleryTagSort() {
    this.galleryTagSortOrder = this.galleryTagSortOrder === 'desc' ? 'asc' : 'desc';
  }

  _getGalleryTagSortArrow() {
    return this.galleryTagSortOrder === 'desc' ? '↓' : '↑';
  }

  _galleryCategorySectionId(category) {
    const normalized = String(category || '').trim().toLowerCase();
    if (!normalized) return 'gallery-category-uncategorized';
    const slug = normalized
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `gallery-category-${slug || 'uncategorized'}`;
  }

  _scrollGalleryToCategory(category) {
    const sectionId = this._galleryCategorySectionId(category);
    if (!sectionId) return;
    const section = this.querySelector(`#${sectionId}`);
    if (!section) return;
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  _setGallerySelectedCategories(nextCategories = [], markTouched = true) {
    const available = new Set(
      (this.galleryCollections || [])
        .map((section) => String(section?.category || '').trim())
        .filter(Boolean)
    );
    const normalized = Array.from(new Set(
      (nextCategories || [])
        .map((category) => String(category || '').trim())
        .filter((category) => category && available.has(category))
    )).sort((a, b) => a.localeCompare(b));
    if (markTouched) this._galleryCategorySelectionTouched = true;
    this.gallerySelectedCategories = normalized;
  }

  _syncGalleryCategorySelection() {
    const categories = (this.galleryCollections || [])
      .map((section) => String(section?.category || '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    if (!categories.length) {
      this.gallerySelectedCategories = [];
      return;
    }

    if (!this._galleryCategorySelectionTouched) {
      this.gallerySelectedCategories = categories;
      return;
    }

    const allowed = new Set(categories);
    const retained = (this.gallerySelectedCategories || [])
      .map((category) => String(category || '').trim())
      .filter((category) => allowed.has(category));
    this.gallerySelectedCategories = Array.from(new Set(retained)).sort((a, b) => a.localeCompare(b));
  }

  _toggleGalleryCategory(category) {
    const normalized = String(category || '').trim();
    if (!normalized) return;
    const next = new Set((this.gallerySelectedCategories || []).map((value) => String(value || '').trim()).filter(Boolean));
    if (next.has(normalized)) {
      next.delete(normalized);
    } else {
      next.add(normalized);
    }
    this._setGallerySelectedCategories(Array.from(next));
  }

  _selectAllGalleryCategories() {
    const categories = (this.galleryCollections || [])
      .map((section) => String(section?.category || '').trim())
      .filter(Boolean);
    this._setGallerySelectedCategories(categories);
  }

  _clearGalleryCategories() {
    this._setGallerySelectedCategories([]);
  }

  _renderGallerySearchControls() {
    return html`
      <filter-chips
        .tenant=${this.tenant}
        .tagStatsBySource=${this.tagStatsBySource}
        .activeCurateTagSource=${this.activeCurateTagSource || 'permatags'}
        .keywords=${this.keywords}
        .imageStats=${this.imageStats}
        .activeFilters=${this.searchChipFilters}
        .availableFilterTypes=${['keyword', 'rating', 'source', 'media', 'folder', 'list', 'tag_coverage', 'filename', 'text_search']}
        .dropboxFolders=${this.searchDropboxOptions || []}
        .lists=${this.searchLists}
        .renderSortControls=${() => html`
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold text-gray-700">Sort:</span>
            <div class="curate-audit-toggle">
              <button type="button" class="active" @click=${() => this._toggleGalleryTagSort()}>
                Tag ${this._getGalleryTagSortArrow()}
              </button>
            </div>
          </div>
        `}
        @filters-changed=${this._handleGalleryChipFiltersChanged}
        @folder-search=${this._handleSearchDropboxInput}
        @lists-requested=${this._handleSearchListsRequested}
      ></filter-chips>
    `;
  }

  async _loadGalleryCollections() {
    this.galleryCollections = [];
    if (!this.tenant) {
      this.galleryLoading = false;
      return;
    }
    const token = ++this._galleryLoadToken;
    this.galleryLoading = true;
    try {
      const response = await getKeywordGalleryPreviews(this.tenant, {
        previewCount: 1,
      });
      if (token !== this._galleryLoadToken) return;

      const rows = (Array.isArray(response?.previews) ? response.previews : []).filter((row) => {
        const count = Number(row?.count);
        return Number.isFinite(count) && count > 0 && row?.category && row?.keyword;
      });

      const groupedByCategory = new Map();
      rows.forEach((row) => {
        const category = String(row.category || '');
        if (!groupedByCategory.has(category)) {
          groupedByCategory.set(category, []);
        }
        const previews = (row?.images || [])
          .map((image) => {
            const id = Number(image?.id ?? image?.image_id);
            const thumbnail = image?.thumbnail_url || (Number.isFinite(id) ? `/api/v1/images/${id}/thumbnail` : '');
            if (!Number.isFinite(id) && !thumbnail) return null;
            return { id, thumbnail_url: thumbnail };
          })
          .filter(Boolean);
        groupedByCategory.get(category).push({
          id: `${category}::${row.keyword}`,
          category,
          keyword: row.keyword,
          count: Number(row.count) || 0,
          previews,
        });
      });

      this.galleryCollections = Array.from(groupedByCategory.entries())
        .map(([category, items]) => ({
          category,
          totalCount: items.reduce((sum, item) => sum + (Number(item.count) || 0), 0),
          items: items.sort((a, b) => {
            return String(a.keyword || '').localeCompare(String(b.keyword || ''));
          }),
        }))
        .sort((a, b) => {
          const countDiff = (b.totalCount || 0) - (a.totalCount || 0);
          if (countDiff !== 0) return countDiff;
          return String(a.category || '').localeCompare(String(b.category || ''));
        })
        .map(({ category, items }) => ({ category, items }));
      this._syncGalleryCategorySelection();
    } catch (error) {
      if (token !== this._galleryLoadToken) return;
      console.error('Gallery preview fetch failed:', error);
      this.galleryCollections = [];
      this.gallerySelectedCategories = [];
    } finally {
      if (token === this._galleryLoadToken) {
        this.galleryLoading = false;
      }
    }
  }

  _handleGalleryCollectionSelect(category, keyword) {
    this._startGalleryTransitionLoading();
    this._applyGalleryTagViewDefaultSort();
    const nextFilters = [{
      type: 'keyword',
      category,
      value: keyword,
      displayLabel: 'Keywords',
      displayValue: keyword,
    }];
    this._suppressNextAdvancedInitialRefresh = true;
    this._handleSearchSubTabChange('advanced');
    this._handleChipFiltersChanged({ detail: { filters: nextFilters } });
  }

  _renderGalleryCollectionCard(item) {
    const previews = Array.isArray(item?.previews) ? item.previews : [];
    const front = this._resolveThumbnailUrl(previews[0]);
    const middle = this._resolveThumbnailUrl(previews[1] || previews[0]);
    const back = this._resolveThumbnailUrl(previews[2] || previews[1] || previews[0]);
    const shellStyle = 'position:relative; margin:0 auto; width:100%; max-width:210px; aspect-ratio:4 / 5;';
    const stackLayer = (url, style) => html`
      <div
        style=${style + (url
          ? ` background-image:url('${url}'); background-size:cover; background-position:center;`
          : ' background: linear-gradient(145deg, #e2e8f0, #cbd5e1);')}
      ></div>
    `;
    const backStyle = 'position:absolute; inset:0; transform:translate(8px, 8px) rotate(1.8deg); border-radius:8px; border:2px solid #fff; box-shadow:0 6px 14px rgba(15, 23, 42, 0.16);';
    const middleStyle = 'position:absolute; inset:0; transform:translate(-4px, 4px) rotate(-1.2deg); border-radius:8px; border:2px solid #fff; box-shadow:0 6px 14px rgba(15, 23, 42, 0.16);';
    const frontStyle = 'position:relative; height:100%; width:100%; border-radius:8px; border:4px solid #fff; box-shadow:0 10px 20px rgba(15, 23, 42, 0.2); overflow:hidden; background:#cbd5e1;';
    return html`
      <button
        type="button"
        class="group w-full text-left"
        @click=${() => this._handleGalleryCollectionSelect(item.category, item.keyword)}
        title=${`Open ${item.category}: ${item.keyword}`}
      >
        <div style=${shellStyle}>
          ${stackLayer(back, backStyle)}
          ${stackLayer(middle, middleStyle)}
          <div style=${frontStyle}>
            ${front
              ? html`<img src=${front} alt=${`${item.keyword} preview`} style="display:block; width:100%; height:100%; object-fit:cover;" loading="lazy">`
              : html`<div style="height:100%; width:100%; background:linear-gradient(145deg, #e2e8f0, #cbd5e1);"></div>`}
          </div>
        </div>
        <div class="mt-3 text-center">
          <div class="text-sm font-semibold text-slate-900">${item.keyword}</div>
          <div class="text-xs text-slate-500">${item.count} items</div>
        </div>
      </button>
    `;
  }

  _renderGalleryTransitionSkeleton() {
    const cards = Array.from({ length: 12 });
    return html`
      <div class="p-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-5">
        ${cards.map(() => html`
          <div class="rounded-lg border border-gray-200 bg-white p-2 animate-pulse">
            <div class="w-full rounded-md bg-gray-200" style="aspect-ratio:4 / 5;"></div>
            <div class="mt-3 h-3 w-2/3 mx-auto rounded bg-gray-200"></div>
            <div class="mt-2 h-2 w-1/3 mx-auto rounded bg-gray-200"></div>
          </div>
        `)}
      </div>
    `;
  }

  _renderGalleryInitialSkeleton() {
    const sections = Array.from({ length: 3 });
    const cards = Array.from({ length: 4 });
    const categoryRows = Array.from({ length: 8 });
    return html`
      <div
        class="curate-layout search-layout results-hotspot-layout ${this.rightPanelCollapsed ? 'right-panel-layout-collapsed' : ''}"
        style="--curate-thumb-size: ${this.curateThumbSize}px;"
        aria-live="polite"
        aria-busy="true"
      >
        <div class="space-y-4">
          ${sections.map(() => html`
            <section class="bg-white rounded-xl border border-gray-200 p-4 animate-pulse">
              <div class="mb-4 h-4 w-44 rounded bg-slate-200"></div>
              <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-5">
                ${cards.map(() => html`
                  <div class="rounded-lg border border-gray-200 bg-white p-2">
                    <div class="w-full rounded-md bg-gray-200" style="aspect-ratio:4 / 5;"></div>
                    <div class="mt-3 h-3 w-2/3 mx-auto rounded bg-gray-200"></div>
                    <div class="mt-2 h-2 w-1/3 mx-auto rounded bg-gray-200"></div>
                  </div>
                `)}
              </div>
            </section>
          `)}
        </div>
        <right-panel
          .tools=${[]}
          .activeTool=${''}
          .collapsible=${true}
          .collapsed=${this.rightPanelCollapsed}
          @collapse-changed=${(event) => this._handleRightPanelCollapseChanged(event.detail.collapsed)}
        >
          <div slot="default" class="curate-utility-panel animate-pulse">
            ${categoryRows.map(() => html`
              <div class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2">
                <div class="flex items-center justify-between gap-2">
                  <span class="h-3 w-24 rounded bg-slate-200"></span>
                  <span class="h-4 w-8 rounded-full bg-slate-200"></span>
                </div>
              </div>
            `)}
          </div>
        </right-panel>
      </div>
    `;
  }

  _renderGallerySubtab() {
    const sections = this.galleryCollections || [];
    const categoryRows = sections.map((section) => ({
      category: String(section?.category || ''),
      keywordCount: Number((section?.items || []).length) || 0,
    }));
    const direction = this.galleryTagSortOrder === 'desc' ? -1 : 1;
    const visibleSections = sections
      .map((section) => ({
        ...section,
        items: [...(section.items || [])].sort((a, b) => (
          String(a?.keyword || '').localeCompare(String(b?.keyword || '')) * direction
        )),
      }));
    if (!sections.length) {
      if (this.galleryLoading) {
        return html`
          <div class="space-y-6">
            ${this._renderGallerySearchControls()}
            ${this._renderGalleryInitialSkeleton()}
          </div>
        `;
      }
      return html`
        <div class="space-y-4">
          ${this._renderGallerySearchControls()}
          <div class="bg-white rounded-xl border border-gray-200 p-6 text-sm text-gray-500">
            ${this.galleryLoading ? 'Building gallery collections...' : 'No keyword collections available yet.'}
          </div>
        </div>
      `;
    }
    return html`
      <div class="space-y-6">
        ${this._renderGallerySearchControls()}
        <div class="curate-layout search-layout results-hotspot-layout ${this.rightPanelCollapsed ? 'right-panel-layout-collapsed' : ''}" style="--curate-thumb-size: ${this.curateThumbSize}px;">
          <div class="space-y-4">
            ${visibleSections.map((section) => html`
              <section
                id=${this._galleryCategorySectionId(section.category)}
                class="bg-white rounded-xl border border-gray-200 p-4"
              >
                <div class="mb-4">
                  <h3 class="text-sm font-semibold uppercase tracking-wide text-slate-600">${section.category}</h3>
                </div>
                <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-5">
                  ${section.items.map((item) => this._renderGalleryCollectionCard(item))}
                </div>
              </section>
            `)}
          </div>
          <right-panel
            .tools=${[]}
            .activeTool=${''}
            .collapsible=${true}
            .collapsed=${this.rightPanelCollapsed}
            @collapse-changed=${(event) => this._handleRightPanelCollapseChanged(event.detail.collapsed)}
          >
            <div slot="default" class="curate-utility-panel">
              ${categoryRows.map((row) => {
                return html`
                  <button
                    type="button"
                    class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-slate-700 transition-colors hover:bg-slate-50"
                    @click=${() => this._scrollGalleryToCategory(row.category)}
                  >
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-xs font-medium truncate">${row.category}</span>
                      <span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">${row.keywordCount}</span>
                    </div>
                  </button>
                `;
              })}
            </div>
          </right-panel>
        </div>
      </div>
    `;
  }

  _handleVectorstoreQueryInput(event) {
    this.vectorstoreQuery = event?.target?.value || '';
  }

  _normalizeVectorstoreLexicalWeight(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return VECTORSTORE_DEFAULT_LEXICAL_WEIGHT;
    return Math.max(0, Math.min(1, numeric));
  }

  _readVectorstoreWeights(filters = {}) {
    const lexicalRaw = filters?.hybridLexicalWeight;
    const vectorRaw = filters?.hybridVectorWeight;
    const lexical = lexicalRaw === undefined || lexicalRaw === null || lexicalRaw === ''
      ? null
      : Number(lexicalRaw);
    const vector = vectorRaw === undefined || vectorRaw === null || vectorRaw === ''
      ? null
      : Number(vectorRaw);
    if (!Number.isFinite(lexical) && !Number.isFinite(vector)) {
      return {
        lexicalWeight: VECTORSTORE_DEFAULT_LEXICAL_WEIGHT,
        vectorWeight: 1 - VECTORSTORE_DEFAULT_LEXICAL_WEIGHT,
      };
    }
    if (!Number.isFinite(lexical)) {
      const normalizedVector = this._normalizeVectorstoreLexicalWeight(vector);
      return {
        lexicalWeight: 1 - normalizedVector,
        vectorWeight: normalizedVector,
      };
    }
    if (!Number.isFinite(vector)) {
      const normalizedLexical = this._normalizeVectorstoreLexicalWeight(lexical);
      return {
        lexicalWeight: normalizedLexical,
        vectorWeight: 1 - normalizedLexical,
      };
    }
    const boundedLexical = Math.max(0, lexical);
    const boundedVector = Math.max(0, vector);
    const total = boundedLexical + boundedVector;
    if (total <= 0) {
      return {
        lexicalWeight: VECTORSTORE_DEFAULT_LEXICAL_WEIGHT,
        vectorWeight: 1 - VECTORSTORE_DEFAULT_LEXICAL_WEIGHT,
      };
    }
    return {
      lexicalWeight: boundedLexical / total,
      vectorWeight: boundedVector / total,
    };
  }

  _handleVectorstoreWeightInput(event) {
    const nextPercent = Number(event?.target?.value);
    if (!Number.isFinite(nextPercent)) return;
    this.vectorstoreLexicalWeight = this._normalizeVectorstoreLexicalWeight(nextPercent / 100);
  }

  _handleVectorstoreQueryKeydown(event) {
    if (event?.key !== 'Enter') return;
    event.preventDefault();
    this._runVectorstoreSearch();
  }

  _scrollToTopForSimilarityMode() {
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      try {
        window.scrollTo({ top: 0, behavior: 'auto' });
      } catch {
        window.scrollTo(0, 0);
      }
    });
  }

  async _maybeApplyInitialVectorstoreQuery() {
    const token = Number(this.initialVectorstoreQueryToken || 0);
    const query = String(this.initialVectorstoreQuery || '').trim();
    if (!token || !query) return;
    if (token === this._appliedInitialVectorstoreQueryToken) return;
    if (!this.searchFilterPanel || this.vectorstoreLoading) return;

    this._appliedInitialVectorstoreQueryToken = token;
    this.vectorstoreQuery = query;
    this._ux1Query = query;

    if (this.searchSubTab !== 'results') {
      this.searchSubTab = 'results';
      this.dispatchEvent(new CustomEvent('search-subtab-changed', {
        detail: { subtab: 'results' },
        bubbles: true,
        composed: true,
      }));
      await this.updateComplete;
    }

    await this._runVectorstoreSearch();
    this.dispatchEvent(new CustomEvent('vectorstore-query-applied', {
      detail: { token, query },
      bubbles: true,
      composed: true,
    }));
  }

  async _runVectorstoreSearch() {
    if (!this.searchFilterPanel) return;
    if (this.vectorstoreLoading) return;
    const query = (this.vectorstoreQuery || '').trim();
    const currentFilters = this.searchFilterPanel.getState?.() || this.searchFilterPanel.filters || {};
    const lexicalWeight = this._normalizeVectorstoreLexicalWeight(this.vectorstoreLexicalWeight);
    const vectorWeight = this._normalizeVectorstoreLexicalWeight(1 - lexicalWeight);
    this.vectorstoreLoading = true;
    try {
      this.searchFilterPanel.updateFilters({
        ...currentFilters,
        textQuery: query,
        hybridVectorWeight: vectorWeight,
        hybridLexicalWeight: lexicalWeight,
        offset: 0,
      });
      await this.searchFilterPanel.fetchImages();
      this.vectorstoreHasSearched = true;
    } catch (error) {
      console.error('Vectorstore search failed:', error);
    } finally {
      this.vectorstoreLoading = false;
    }
  }

  _clearVectorstoreSearch() {
    if (!this.searchFilterPanel) return;
    this.vectorstoreQuery = '';
    this.vectorstoreLexicalWeight = VECTORSTORE_DEFAULT_LEXICAL_WEIGHT;
    this.vectorstoreHasSearched = false;
    const currentFilters = this.searchFilterPanel.getState?.() || this.searchFilterPanel.filters || {};
    this.searchFilterPanel.updateFilters({
      ...currentFilters,
      textQuery: '',
      hybridVectorWeight: undefined,
      hybridLexicalWeight: undefined,
      offset: 0,
    });
    this.searchFilterPanel.fetchImages();
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
    const handleLoadingStart = (detail) => {
      if (detail?.tabId !== 'search') return;
      this._startSearchLoading();
    };
    const handleLoadingEnd = (detail) => {
      if (detail?.tabId !== 'search') return;
      this._finishSearchLoading();
    };
    const handleFiltersChanged = (detail) => {
      if (!detail?.filters) return;
      const snapshot = this._cloneSearchFilters(detail.filters);
      if (this.searchSubTab === 'results') {
        this._searchResultsFiltersState = snapshot;
      } else {
        this._searchAdvancedFiltersState = snapshot;
      }
      this._syncChipFiltersFromFilterState(detail.filters);
    };
    this._searchFilterPanelHandlers = {
      panel,
      handleLoaded,
      handleError,
      handleLoadingStart,
      handleLoadingEnd,
      handleFiltersChanged,
    };
    panel.on('images-loaded', handleLoaded);
    panel.on('error', handleError);
    panel.on('loading-start', handleLoadingStart);
    panel.on('loading-end', handleLoadingEnd);
    panel.on('filters-changed', handleFiltersChanged);

    const currentFilters = panel.getState?.() || panel.filters || {};
    if (!this._searchAdvancedFiltersState) {
      this._searchAdvancedFiltersState = this._cloneSearchFilters(currentFilters);
    }
    if (!this._searchResultsFiltersState) {
      this._searchResultsFiltersState = this._buildIsolatedResultsFilters(this._searchAdvancedFiltersState);
    }

    if (this.searchSubTab === 'results') {
      panel.updateFilters(this._cloneSearchFilters(this._searchResultsFiltersState));
    } else {
      panel.updateFilters(this._cloneSearchFilters(this._searchAdvancedFiltersState));
    }
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
    panel.off('loading-start', this._searchFilterPanelHandlers.handleLoadingStart);
    panel.off('loading-end', this._searchFilterPanelHandlers.handleLoadingEnd);
    panel.off('filters-changed', this._searchFilterPanelHandlers.handleFiltersChanged);
    this._searchFilterPanelHandlers = null;
  }

  _syncChipFiltersFromFilterPanel() {
    const filters = this.searchFilterPanel?.getState?.() || this.searchFilterPanel?.filters;
    if (!filters || typeof filters !== 'object') return;
    if (this.searchSubTab === 'results') {
      this.vectorstoreQuery = String(filters.textQuery || '');
    }
    this._syncChipFiltersFromFilterState(filters);
  }

  _normalizeSourceProviderFilter(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized || normalized === 'all') return '';
    if (normalized === 'google') return 'gdrive';
    if (normalized === 'google-drive' || normalized === 'google_drive' || normalized === 'drive') return 'gdrive';
    if (normalized === 'yt') return 'youtube';
    return normalized;
  }

  _formatSourceProviderLabel(value) {
    const normalized = this._normalizeSourceProviderFilter(value);
    if (!normalized) return '';
    if (normalized === 'dropbox') return 'Dropbox';
    if (normalized === 'gdrive') return 'Google Drive';
    if (normalized === 'youtube') return 'YouTube';
    if (normalized === 'managed') return 'Managed Uploads';
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  _syncChipFiltersFromFilterState(filters) {
    const nextChips = [];
    if (this.searchSubTab === 'results') {
      this.vectorstoreQuery = String(filters.textQuery || '');
      const vectorstoreWeights = this._readVectorstoreWeights(filters || {});
      this.vectorstoreLexicalWeight = vectorstoreWeights.lexicalWeight;
    }
    const mediaType = String(filters.mediaType || filters.media_type || 'all').trim().toLowerCase();

    if (filters.keywords && typeof filters.keywords === 'object' && Object.keys(filters.keywords).length > 0) {
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

    const noPermatagCategories = Array.isArray(filters.noPermatagCategories)
      ? Array.from(new Set(filters.noPermatagCategories.map((value) => String(value || '').trim()).filter(Boolean)))
      : [];
    const noPermatagUntagged = Boolean(
      filters.noPermatagUntagged
      ?? filters.permatagPositiveMissing
    );
    const noPermatagOperator = String(filters.noPermatagOperator || 'AND').trim().toUpperCase() === 'OR'
      ? 'OR'
      : 'AND';
    if (noPermatagCategories.length || noPermatagUntagged) {
      const displayValues = [];
      if (noPermatagUntagged) displayValues.push('Untagged');
      displayValues.push(...noPermatagCategories.map((category) => `No ${category} tags`));
      nextChips.push({
        type: 'tag_coverage',
        noPermatagCategories,
        includeUntagged: noPermatagUntagged,
        operator: noPermatagOperator,
        displayLabel: 'Tag Coverage',
        displayValue: displayValues.length <= 2
          ? displayValues.join(', ')
          : `${displayValues.length} rules`,
      });
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

    const textQuery = (filters.textQuery || '').trim();
    if (textQuery) {
      nextChips.push({
        type: 'text_search',
        value: textQuery,
        displayLabel: 'Text search',
        displayValue: textQuery,
      });
    }

    if (mediaType === 'image' || mediaType === 'video') {
      nextChips.push({
        type: 'media',
        value: mediaType,
        displayLabel: 'Media',
        displayValue: mediaType === 'video' ? 'Videos' : 'Photos',
      });
    }

    const sourceProvider = this._normalizeSourceProviderFilter(
      filters.sourceProvider
      ?? filters.source_provider
      ?? filters.source
    );
    if (sourceProvider) {
      nextChips.push({
        type: 'source',
        value: sourceProvider,
        displayLabel: 'Source',
        displayValue: this._formatSourceProviderLabel(sourceProvider),
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

    const similarityAssetUuid = String(this.searchSimilarityAssetUuid || '').trim();
    if (similarityAssetUuid) {
      nextChips.push({
        type: 'similarity',
        value: similarityAssetUuid,
        displayLabel: 'Similarity',
        displayValue: similarityAssetUuid,
      });
    }

    this.searchChipFilters = nextChips;
  }

  _maybeStartInitialRefresh() {
    if (this._searchInitialLoadComplete || this._searchInitialLoadPending) return;
    if (this.searchSubTab !== 'advanced') return;
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

  _renderSearchListDetails(image) {
    return renderCanonicalListDetails(image);
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
    const chips = event.detail.filters || [];
    const currentFilters = this.searchFilterPanel?.getState?.() || this.searchFilterPanel?.filters || {};
    const preserveVectorstoreQuery = this.searchSubTab === 'results';
    const hasTextSearchChip = chips.some((chip) => chip?.type === 'text_search');
    const shouldPreserveTextSearch = preserveVectorstoreQuery && hasTextSearchChip;

    // Store the chip filters for UI state
    this.searchChipFilters = chips;
    const similarityChip = chips.find((chip) => chip?.type === 'similarity');
    const nextSimilarityAssetUuid = String(similarityChip?.value || '').trim() || null;
    if ((this.searchSimilarityAssetUuid || null) !== nextSimilarityAssetUuid) {
      this.searchSimilarityAssetUuid = nextSimilarityAssetUuid;
      this.dispatchEvent(new CustomEvent('search-similarity-context-changed', {
        detail: { assetUuid: nextSimilarityAssetUuid },
        bubbles: true,
        composed: true,
      }));
    }

    // Build filter object from chip filters
    const searchFilters = {
      limit: 100,
      offset: 0,
      sortOrder: this.searchDateOrder || 'desc',
      orderBy: this.searchOrderBy || 'photo_creation',
      mediaType: 'all',
      hideZeroRating: true,
      keywords: {},
      operators: {},
      categoryFilterOperator: undefined,
      categoryFilterSource: 'permatags',
      dropboxPathPrefix: '',
      filenameQuery: '',
      textQuery: shouldPreserveTextSearch
        ? String(currentFilters.textQuery || this.vectorstoreQuery || '').trim()
        : '',
      sourceProvider: '',
      noPermatagCategories: [],
      noPermatagUntagged: false,
      noPermatagOperator: 'AND',
      hybridVectorWeight: shouldPreserveTextSearch ? currentFilters.hybridVectorWeight : undefined,
      hybridLexicalWeight: shouldPreserveTextSearch ? currentFilters.hybridLexicalWeight : undefined,
      listId: undefined,
      listExcludeId: undefined,
    };

    // Apply each chip filter to the filter object
    chips.forEach(chip => {
      switch (chip.type) {
        case 'keyword': {
          if (chip.untagged || chip.value === '__untagged__') {
            searchFilters.noPermatagUntagged = true;
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
        case 'text_search':
          searchFilters.textQuery = chip.value || '';
          break;
        case 'media':
          searchFilters.mediaType = chip.value === 'video' ? 'video' : (chip.value === 'image' ? 'image' : 'all');
          break;
        case 'source':
          searchFilters.sourceProvider = this._normalizeSourceProviderFilter(chip.value);
          break;
        case 'tag_coverage': {
          const categories = Array.isArray(chip.noPermatagCategories)
            ? chip.noPermatagCategories
            : (chip.category ? [chip.category] : []);
          searchFilters.noPermatagCategories = Array.from(
            new Set(categories.map((value) => String(value || '').trim()).filter(Boolean))
          );
          searchFilters.noPermatagUntagged = Boolean(chip.includeUntagged || chip.untagged || chip.value === '__untagged__');
          searchFilters.noPermatagOperator = String(chip.operator || 'AND').trim().toUpperCase() === 'OR'
            ? 'OR'
            : 'AND';
          break;
        }
        case 'similarity':
          break;
      }
    });

    this.searchListExcludeId = searchFilters.listExcludeId || '';

    // Update filter panel with the complete filter object
    if (this.searchFilterPanel) {
      this.searchFilterPanel.updateFilters(searchFilters);
      this.searchFilterPanel.fetchImages();
    } else if (this.galleryTransitionLoading) {
      this.galleryTransitionLoading = false;
    }
  }

  _continueFromSimilarityMode() {
    const nextChips = (this.searchChipFilters || []).filter((chip) => chip?.type !== 'similarity');
    this.searchPinnedImageId = null;
    this.searchSimilarityAssetUuid = null;
    this._handleChipFiltersChanged({ detail: { filters: nextChips } });
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

  _handleBrowseByFolderSelectHover(index, _order, groupKey) {
    if (this._searchBrowseGroupKey !== groupKey) {
      return;
    }
    return this._handleSearchSelectHover(index);
  }

  _handleSearchHistoryPointerDown(event, index, imageId, order, groupKey) {
    this._searchHistoryOrder = order;
    this._searchHistoryGroupKey = groupKey;
    return this._handleSearchPointerDown(event, index, imageId);
  }

  _handleSearchHistorySelectHover(index, _order, groupKey) {
    if (this._searchHistoryGroupKey !== groupKey) {
      return;
    }
    return this._handleSearchSelectHover(index);
  }

  _handleSearchImageClick(event, image, imageSet) {
    const order = (imageSet || this.searchImages || [])
      .map((entry) => entry?.id)
      .filter((id) => id !== null && id !== undefined);
    const clickedId = image?.id;
    const index = order.findIndex((id) => String(id) === String(clickedId));
    const selectionResult = this._searchSelectionHandlers.handleClickSelection(event, {
      imageId: clickedId,
      index: index >= 0 ? index : null,
      order,
    });
    if (selectionResult.handled) {
      return;
    }
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

  _handleSearchDragStart(event, image, imageSet = null) {
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
    setDragImagePayload(event.dataTransfer, ids, [imageSet || this.searchImages || []]);
  }

  _getSearchHistorySessionKey() {
    return buildHotspotHistorySessionKey('search', this.tenant);
  }

  _restoreSearchHistorySessionState() {
    const state = loadHotspotHistorySessionState(this._getSearchHistorySessionKey(), {
      fallbackView: 'results',
    });
    this.searchResultsView = state.view;
    this._searchHotspotHistoryBatches = state.batches;
    this._searchHotspotHistoryVisibleBatches = state.visibleCount;
  }

  _persistSearchHistorySessionState() {
    saveHotspotHistorySessionState(this._getSearchHistorySessionKey(), {
      view: this.searchResultsView,
      batches: this._searchHotspotHistoryBatches,
      visibleCount: this._searchHotspotHistoryVisibleBatches,
    });
  }

  _setSearchResultsView(nextView) {
    this.searchResultsView = nextView === 'history' ? 'history' : 'results';
    this.searchDragSelection = [];
    if (this.searchResultsView !== 'history') {
      this._searchHistoryOrder = null;
      this._searchHistoryGroupKey = null;
    }
    if (this.searchResultsView === 'history' && this._searchHotspotHistoryVisibleBatches < 1) {
      this._searchHotspotHistoryVisibleBatches = 1;
    }
  }

  _recordSearchHotspotHistory(event, targetId, { sourceLabel = 'Search Results' } = {}) {
    const target = (this.searchHotspotTargets || []).find((entry) => entry.id === targetId);
    const ids = parseDraggedImageIds(event?.dataTransfer);
    if (!target || !ids.length) return;
    if (target.type === 'rating') {
      const rating = Number.parseInt(String(target.rating ?? ''), 10);
      if (!Number.isFinite(rating)) return;
    } else if (!target.keyword) {
      return;
    }
    const dragImages = readDragImagePayload(event?.dataTransfer);
    const browseImages = Object.values(this.browseByFolderData || {})
      .flatMap((images) => (Array.isArray(images) ? images : []));
    const batch = createHotspotHistoryBatch({
      ids,
      dragImages,
      imageSets: [this.searchImages || [], browseImages],
      target,
      sourceLabel,
    });
    if (!batch) return;
    this._searchHotspotHistoryBatches = prependHistoryBatch(this._searchHotspotHistoryBatches, batch);
    if (this._searchHotspotHistoryVisibleBatches < 1) {
      this._searchHotspotHistoryVisibleBatches = 1;
    }
  }

  _handleSearchHotspotDrop(event, targetId) {
    this._recordSearchHotspotHistory(event, targetId, {
      sourceLabel: this.searchSubTab === 'browse-by-folder' ? 'Search Browse' : 'Search Results',
    });
    this._searchHotspotHandlers.handleDrop(event, targetId);
  }

  _loadPreviousSearchHistoryBatches() {
    const total = this._searchHotspotHistoryBatches.length;
    if (!total) return;
    const next = loadPreviousHistoryBatchCount(this._searchHotspotHistoryVisibleBatches, 5);
    this._searchHotspotHistoryVisibleBatches = Math.min(total, next);
  }

  _renderSearchHistoryPane() {
    const visibleBatches = getVisibleHistoryBatches(
      this._searchHotspotHistoryBatches,
      this._searchHotspotHistoryVisibleBatches
    );
    if (!visibleBatches.length) {
      return html`
        <div class="p-6 text-center text-sm text-gray-500">
          No hotspot history yet. Drag images to a hotspot, then open Hotspot History.
        </div>
      `;
    }
    const canLoadPrevious = visibleBatches.length < this._searchHotspotHistoryBatches.length;
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
              selection: this.searchDragSelection,
              flashSelectionIds: this._searchFlashSelectionIds,
              selectionHandlers: this._searchSelectionHandlers,
              renderFunctions: {
                renderCurateRatingWidget: this.renderCurateRatingWidget,
                renderCurateRatingStatic: this.renderCurateRatingStatic,
                renderCuratePermatagSummary: this.renderCuratePermatagSummary || this._renderSearchPermatagSummary.bind(this),
                formatCurateDate: this.formatCurateDate,
              },
              onImageClick: (dragEvent, image) => this._handleSearchImageClick(dragEvent, image, batch.images),
              onDragStart: (dragEvent, image) => this._handleSearchDragStart(dragEvent, image, batch.images),
              selectionEvents: {
                pointerDown: (dragEvent, itemIndex, imageId, imageOrder, groupKey) =>
                  this._handleSearchHistoryPointerDown(dragEvent, itemIndex, imageId, imageOrder, groupKey),
                pointerMove: (dragEvent) => this._handleSearchPointerMove(dragEvent),
                pointerEnter: (itemIndex, imageOrder, groupKey) =>
                  this._handleSearchHistorySelectHover(itemIndex, imageOrder, groupKey),
                order,
                groupKey: batch.batchId,
              },
              options: {
                enableReordering: false,
                showPermatags: true,
                showAiScore: false,
                viewMode: this.searchResultsLayout,
                renderListDetails: (image) => this._renderSearchListDetails(image),
                emptyMessage: 'No images in this batch.',
              },
            })}
          </div>
        `;
        })}
        <div class="hotspot-history-footer">
          <button
            class="curate-pane-action secondary"
            @click=${this._loadPreviousSearchHistoryBatches}
            ?disabled=${!canLoadPrevious}
          >
            Previous
          </button>
        </div>
      </div>
    `;
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
  // UX1 Landing
  // ========================================

  _renderUx1Landing() {
    const searchFocused = this._ux1SearchFocused || false;
    const imageStats = this.imageStats || {};
    const keywordCount = formatStatNumber(imageStats.keyword_count);
    const ratedCount = formatStatNumber(imageStats.rated_image_count);
    const tagCount = formatStatNumber(imageStats.positive_permatag_count);
    const folderCount = formatStatNumber((this.browseByFolderOptions || []).length);

    const navRows = [
      {
        key: 'advanced',
        label: 'Explore',
        subtitle: 'Filter by keyword, rating, list, media type, date, and more. The fastest way to find exactly what you need.',
        accentClass: 'home-cta-search',
        glyphChar: 'F',
        iconSvg: html`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"></circle><line x1="16" y1="16" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line></svg>`,
        metrics: [
          { label: 'Tags', value: tagCount },
          { label: 'Rated', value: ratedCount },
        ],
      },
      {
        key: 'browse-by-folder',
        label: 'Browse Folders',
        subtitle: 'Zoltag tracks the source of each file. This view allows you to view files by their location.',
        accentClass: 'home-cta-upload',
        glyphChar: 'B',
        iconSvg: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.2a2.2 2.2 0 0 1 2.2-2.2h4.1l1.9 2h5.8A2.2 2.2 0 0 1 20.2 10v7.8A2.2 2.2 0 0 1 18 20H6.2A2.2 2.2 0 0 1 4 17.8z" fill="none" stroke="currentColor" stroke-width="1.8"></path><path d="M12 10.4v5.2M9.4 13h5.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path></svg>`,
        metrics: [
          { label: 'Folders', value: folderCount },
        ],
      },
      {
        key: 'chips',
        label: 'Browse Tags',
        subtitle: 'See your entire tag vocabulary at a glance. Click any tag to explore all images with that tag.',
        accentClass: 'home-cta-keywords',
        glyphChar: 'K',
        iconSvg: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.2 7.2h15.6M6.5 12h11M8.6 16.8h6.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path><circle cx="5.2" cy="7.2" r="1" fill="currentColor"></circle><circle cx="7.6" cy="12" r="1" fill="currentColor"></circle><circle cx="9.7" cy="16.8" r="1" fill="currentColor"></circle></svg>`,
        metrics: [
          { label: 'Tags', value: keywordCount },
        ],
      },
    ];

    return html`
      <div class="container">

        <!-- Search bar — same classes as home -->
        <form class="home-vectorstore-launch" @submit=${(e) => { e.preventDefault(); this._ux1SubmitSearch(); }}>
          <div class="home-vectorstore-launch-row">
            <input
              type="text"
              class="home-vectorstore-launch-input"
              placeholder="Search..."
              .value=${this._ux1Query || ''}
              @input=${(e) => { this._ux1Query = e.target.value; this.requestUpdate(); }}
              @keydown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); this._ux1SubmitSearch(); } }}
              @focus=${() => { this._ux1SearchFocused = true; this.requestUpdate(); }}
              @blur=${() => {
                setTimeout(() => { this._ux1SearchFocused = false; this.requestUpdate(); }, 150);
              }}
            >
            <button
              type="submit"
              class="home-vectorstore-launch-button"
              ?disabled=${!(this._ux1Query || '').trim()}
            >
              Search
            </button>
          </div>
        </form>

        <!-- Nav cards — hidden while search input is focused -->
        ${!searchFocused ? html`
          <div class="home-cta-grid">
            ${navRows.map((row) => html`
              <button
                type="button"
                class="home-cta-card ${row.accentClass}"
                @click=${() => this._handleSearchSubTabChange(row.key)}
              >
                <div class="home-cta-backdrop" aria-hidden="true"></div>
                <div class="home-cta-glyph" aria-hidden="true">
                  <span class="home-cta-glyph-char">${row.glyphChar}</span>
                </div>
                <div class="home-cta-icon-wrap" aria-hidden="true">
                  ${row.iconSvg}
                </div>
                <div class="home-cta-content">
                  <div class="home-cta-title">${row.label}</div>
                  <div class="home-cta-subtitle">${row.subtitle}</div>
                  <div class="home-cta-metrics">
                    ${row.metrics.map((m) => html`
                      <div class="home-cta-metric">
                        <span class="home-cta-metric-label">${m.label}</span>
                        <span class="home-cta-metric-value">${m.value}</span>
                      </div>
                    `)}
                  </div>
                </div>
                <div class="home-cta-arrow" aria-hidden="true">
                  <span class="home-cta-arrow-char">&#8594;</span>
                </div>
              </button>
            `)}
          </div>
        ` : html``}

      </div>
    `;
  }

  _ux1SubmitSearch() {
    this._submitExploreTextSearch(this._ux1Query);
  }

  _ux1ApplyKeyword(keyword) {
    this._handleSearchSubTabChange('chips');
    this.dispatchEvent(new CustomEvent('ux1-keyword-selected', {
      detail: { keyword },
      bubbles: true,
      composed: true,
    }));
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
    const activeFilterState = this.searchFilterPanel?.getState?.() || this.searchFilterPanel?.filters || {};
    const activeVectorstoreQuery = String(activeFilterState.textQuery || this.vectorstoreQuery || '').trim();
    const shouldShowVectorstoreResults = this.searchSubTab !== 'results' || this.vectorstoreHasSearched;
    const visibleSearchImages = shouldShowVectorstoreResults ? (this.searchImages || []) : [];
    const searchPaginationTop = (this.searchSubTab === 'advanced' || this.searchSubTab === 'results')
      ? (() => {
        if (this.searchSubTab === 'results' && !this.vectorstoreHasSearched) {
          return html``;
        }
        const { offset, limit, total, count } = this._getSearchPaginationState();
        return renderResultsPagination({
          offset,
          limit,
          total,
          count,
          onPrev: () => this._handleSearchPagePrev(),
          onNext: () => this._handleSearchPageNext(),
          onLimitChange: (event) => this._handleSearchPageLimitChange(event),
          viewMode: this.searchResultsLayout,
          onViewModeChange: (mode) => this._setSearchResultsLayout(mode),
          showViewModeToggle: true,
          disabled: this.searchRefreshing,
        });
      })()
      : html``;
    const searchPaginationBottom = (this.searchSubTab === 'advanced' || this.searchSubTab === 'results')
      ? (() => {
        if (this.searchSubTab === 'results' && !this.vectorstoreHasSearched) {
          return html``;
        }
        const { offset, limit, total, count } = this._getSearchPaginationState();
        return renderResultsPagination({
          offset,
          limit,
          total,
          count,
          onPrev: () => this._handleSearchPagePrev(),
          onNext: () => this._handleSearchPageNext(),
          onLimitChange: (event) => this._handleSearchPageLimitChange(event),
          viewMode: this.searchResultsLayout,
          onViewModeChange: (mode) => this._setSearchResultsLayout(mode),
          showViewModeToggle: false,
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
          viewMode: this.searchResultsLayout,
          onViewModeChange: (mode) => this._setSearchResultsLayout(mode),
          showViewModeToggle: true,
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

    const rightPanelTools = this._getRightPanelTools();
    const savedPane = html`
      <right-panel
        .tools=${rightPanelTools}
        .activeTool=${this.rightPanelTool}
        .collapsible=${true}
        .collapsed=${this.rightPanelCollapsed}
        @tool-changed=${(event) => this._handleRightPanelToolChange(event.detail.tool)}
        @collapse-changed=${(event) => this._handleRightPanelCollapseChanged(event.detail.collapsed)}
      >
        ${this.canCurate ? html`
          <div slot="header-right" class="curate-rating-checkbox">
            <input
              type="checkbox"
              id="history-checkbox-search"
              .checked=${this.searchResultsView === 'history'}
              @change=${(event) => this._setSearchResultsView(event.target.checked ? 'history' : 'results')}
            />
            <label for="history-checkbox-search">History</label>
          </div>
        ` : html``}
        ${this.canCurate ? html`
          <hotspot-targets-panel
            slot="tool-tags"
            mode="tags"
            .targets=${this.searchHotspotTargets}
            .keywordsByCategory=${this._getSearchKeywordsByCategory()}
            .lists=${this._lists || []}
            .dragTargetId=${this._searchHotspotDragTarget}
            @hotspot-keyword-change=${(event) => this._searchHotspotHandlers.handleKeywordChange({ target: { value: event.detail.value } }, event.detail.targetId)}
            @hotspot-action-change=${(event) => this._searchHotspotHandlers.handleActionChange({ target: { value: event.detail.value } }, event.detail.targetId)}
            @hotspot-type-change=${(event) => this._searchHotspotHandlers.handleTypeChange({ target: { value: event.detail.value } }, event.detail.targetId)}
            @hotspot-add=${() => this._searchHotspotHandlers.handleAddTarget()}
            @hotspot-remove=${(event) => this._searchHotspotHandlers.handleRemoveTarget(event.detail.targetId)}
            @hotspot-dragover=${(event) => this._searchHotspotHandlers.handleDragOver(event.detail.event, event.detail.targetId)}
            @hotspot-dragleave=${() => this._searchHotspotHandlers.handleDragLeave()}
            @hotspot-drop=${(event) => this._handleSearchHotspotDrop(event.detail.event, event.detail.targetId)}
          ></hotspot-targets-panel>
        ` : html``}
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
        ${this.canCurate ? html`
          <rating-target-panel
            slot="tool-ratings"
            .targets=${this.searchRatingTargets}
            .dragTargetId=${this._searchRatingDragTarget}
            @rating-change=${(event) => this._handleSearchRatingChange(event.detail.targetId, event.detail.value)}
            @rating-add=${() => this._handleSearchRatingAddTarget()}
            @rating-remove=${(event) => this._handleSearchRatingRemoveTarget(event.detail.targetId)}
            @rating-dragover=${(event) => this._handleSearchRatingDragOver(event.detail.event, event.detail.targetId)}
            @rating-dragleave=${(event) => this._handleSearchRatingDragLeave(event.detail.event)}
            @rating-drop=${(event) => {
              event.stopPropagation();
              this._handleSearchRatingDrop(event.detail.event, event.detail.targetId);
            }}
          ></rating-target-panel>
        ` : html``}
      </right-panel>
    `;

    return html`
      ${ratingModal}
      <div class="container">
        <!-- Search Tab Header -->
        ${this.hideSubtabs ? html`` : html`
          <div class="subnav-strip mb-4">
            <div class="curate-subtabs">
              <button
                class="curate-subtab ${this.searchSubTab === 'gallery' ? 'active' : ''}"
                @click=${() => this._handleSearchSubTabChange('gallery')}
              >
                Gallery
              </button>
              <button
                class="curate-subtab ${this.searchSubTab === 'browse-by-folder' ? 'active' : ''}"
                @click=${() => this._handleSearchSubTabChange('browse-by-folder')}
              >
                Browse by Source Folder
              </button>
              <button
                class="curate-subtab ${this.searchSubTab === 'chips' ? 'active' : ''}"
                @click=${() => this._handleSearchSubTabChange('chips')}
              >
                Browse by Tag
              </button>
              <button
                class="curate-subtab ${this.searchSubTab === 'results' ? 'active' : ''}"
                @click=${() => this._handleSearchSubTabChange('results')}
              >
                Text Search
              </button>
              <button
                class="curate-subtab ${this.searchSubTab === 'landing' ? 'active' : ''}"
                @click=${() => this._handleSearchSubTabChange('landing')}
              >
                Help
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

        <!-- Search Home / Vectorstore Subtab -->
        ${(this.searchSubTab === 'advanced' || this.searchSubTab === 'results') ? html`
          <div>
            ${this.searchSubTab === 'results' ? html`
              <div class="bg-white rounded-lg p-4">
                <div class="flex flex-wrap items-center gap-2">
                  ${this._showRankingBalance ? html`
                  <div class="curate-audit-toggle">
                    <button
                      class=${(this._searchResultsMode || 'vector') === 'vector' ? 'active' : ''}
                      @click=${() => { this._searchResultsMode = 'vector'; this.requestUpdate(); }}
                    >Vector</button>
                    <button
                      class=${this._searchResultsMode === 'llm' ? 'active' : ''}
                      @click=${() => { this._searchResultsMode = 'llm'; this.requestUpdate(); }}
                    >LLM</button>
                  </div>
                  ` : html``}
                </div>
                ${this._searchResultsMode === 'llm' ? html`
                  <div class="mt-3">
                    <lab-tab
                      .tenant=${this.tenant}
                      .canCurate=${this.canCurate}
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
                  </div>
                ` : html`
                <form class="home-vectorstore-launch" style="margin-bottom:0;" @submit=${(e) => { e.preventDefault(); this._runVectorstoreSearch(); }}>
                  <div class="home-vectorstore-launch-row" style="align-items: flex-start;">
                    <input
                      class="home-vectorstore-launch-input"
                      placeholder="Search for files by : tag, list names, file folder, filename."
                      .value=${this.vectorstoreQuery}
                      @input=${this._handleVectorstoreQueryInput}
                      @keydown=${this._handleVectorstoreQueryKeydown}
                    >
                    <div class="flex flex-col items-end gap-1 self-start">
                      <button
                        type="submit"
                        class="home-vectorstore-launch-button"
                        ?disabled=${!this.vectorstoreQuery.trim() || this.vectorstoreLoading}
                      >
                        ${this.vectorstoreLoading ? 'Thinking...' : 'Search'}
                      </button>
                      <button
                        class="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2"
                        type="button"
                        @click=${() => {
                          this._showRankingBalance = !this._showRankingBalance;
                          if (!this._showRankingBalance && this._searchResultsMode === 'llm') {
                            this._searchResultsMode = 'vector';
                          }
                          this.requestUpdate();
                        }}
                      >
                        ${this._showRankingBalance ? 'Hide options' : 'Advanced'}
                      </button>
                    </div>
                  </div>
                </form>
                ${this._showRankingBalance ? html`
                <div class="mt-4 border-t border-gray-100 pt-3">
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <div class="text-xs font-semibold text-gray-700">Ranking Balance</div>
                    <div class="text-xs text-gray-500">
                      Text index ${Math.round(this.vectorstoreLexicalWeight * 100)}% · Vector ${Math.round((1 - this.vectorstoreLexicalWeight) * 100)}%
                    </div>
                  </div>
                  <div class="mt-2 flex items-center gap-3">
                    <span class="text-xs text-gray-500 min-w-[72px]">Vector</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      .value=${String(Math.round(this.vectorstoreLexicalWeight * 100))}
                      @input=${this._handleVectorstoreWeightInput}
                      class="flex-1"
                      aria-label="Vectorstore ranking balance"
                    >
                    <span class="text-xs text-gray-500 min-w-[72px] text-right">Text index</span>
                  </div>
                  <div class="mt-1 text-[11px] text-gray-500">
                    Move right to favor text index matches; move left to favor embedding similarity.
                  </div>
                </div>
                ` : html``}
                `}
              </div>
            ` : html``}
            ${(this.searchSubTab !== 'results' || this.vectorstoreHasSearched) ? html`
	            <!-- Filter Chips Component -->
	            <filter-chips
	              .tenant=${this.tenant}
              .tagStatsBySource=${this.tagStatsBySource}
              .activeCurateTagSource=${this.activeCurateTagSource || 'permatags'}
              .keywords=${this.keywords}
              .imageStats=${this.imageStats}
              .activeFilters=${this.searchChipFilters}
              .availableFilterTypes=${['keyword', 'rating', 'source', 'media', 'folder', 'list', 'tag_coverage', 'filename', 'text_search']}
              .hideFiltersSection=${Boolean(this.searchSimilarityAssetUuid)}
              .dropboxFolders=${this.searchDropboxOptions || []}
              .lists=${this.searchLists}
              .renderSortControls=${() => this.searchSimilarityAssetUuid
                ? renderSimilarityModeHeader({
                  onContinue: () => this._continueFromSimilarityMode(),
                })
                : html`
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
            <div class="curate-layout search-layout results-hotspot-layout ${this.rightPanelCollapsed ? 'right-panel-layout-collapsed' : ''}" style="--curate-thumb-size: ${this.curateThumbSize}px; ${browseByFolderBlurStyle}">
              <div class="curate-pane" @dragover=${this._handleSearchAvailableDragOver} @drop=${this._handleSearchAvailableDrop}>
                ${this.searchRefreshing && !this.galleryTransitionLoading ? html`
                  <div class="curate-loading-overlay" aria-label="Loading">
                    <span class="curate-spinner large"></span>
                  </div>
                ` : html``}
                <div class="curate-pane-body">
                    ${this.searchResultsView === 'history' ? html`
                    ${this._renderSearchHistoryPane()}
                  ` : this.galleryTransitionLoading ? html`
                    ${this._renderGalleryTransitionSkeleton()}
                  ` : html`
                    <div class="p-2">
                      ${searchPaginationTop}
                    </div>
                    ${visibleSearchImages && visibleSearchImages.length > 0 ? html`
                      ${renderSelectableImageGrid({
                        images: visibleSearchImages,
                        selection: this.searchDragSelection,
                        flashSelectionIds: this._searchFlashSelectionIds,
                        selectionHandlers: this._searchSelectionHandlers,
                        renderFunctions: {
                          renderCurateRatingWidget: this.renderCurateRatingWidget,
                          renderCurateRatingStatic: this.renderCurateRatingStatic,
                          renderCuratePermatagSummary: this.renderCuratePermatagSummary || this._renderSearchPermatagSummary.bind(this),
                          formatCurateDate: this.formatCurateDate,
                        },
                        onImageClick: (event, image) => this._handleSearchImageClick(event, image, visibleSearchImages),
                        onDragStart: (event, image) => this._handleSearchDragStart(event, image, visibleSearchImages),
                        selectionEvents: {
                          pointerDown: (event, index, imageId) => this._handleSearchPointerDown(event, index, imageId),
                          pointerMove: (event) => this._handleSearchPointerMove(event),
                          pointerEnter: (index) => this._handleSearchSelectHover(index),
                        },
                        options: {
                          enableReordering: false,
                          showPermatags: true,
                          showAiScore: false,
                          viewMode: this.searchResultsLayout,
                          renderListDetails: (image) => this._renderSearchListDetails(image),
                          pinnedImageIds: Number.isFinite(Number(this.searchPinnedImageId))
                            ? new Set([Number(this.searchPinnedImageId)])
                            : null,
                          pinnedLabel: 'Source',
                          emptyMessage: 'No images found. Adjust filters to search.',
                        },
                      })}
                    ` : html`
                      <div class="p-4 text-center text-gray-500 text-sm">
                        ${this.searchSubTab === 'results' && !activeVectorstoreQuery
                          ? 'Enter a query above to run vectorstore search.'
                          : 'No images found. Adjust filters to search.'}
                      </div>
                    `}
                    <div class="p-2">
                      ${searchPaginationBottom}
                    </div>
                  `}
                </div>
              </div>

	              ${savedPane}
	            </div>
	            ` : html``}
	          </div>
	        ` : ''}

        <!-- Browse by Folder Subtab -->
        ${this.searchSubTab === 'browse-by-folder' ? html`
          <div>
            <div class="curate-layout search-layout results-hotspot-layout ${this.rightPanelCollapsed ? 'right-panel-layout-collapsed' : ''}" style="--curate-thumb-size: ${this.curateThumbSize}px;">
              <div class="curate-pane" @dragover=${this._handleSearchAvailableDragOver} @drop=${this._handleSearchAvailableDrop}>
                <div class="curate-pane-header">
                  <div class="curate-pane-header-row">
                    <span class="text-sm font-semibold">Browse by Source Folder</span>
                  </div>
                </div>
                <div class="curate-pane-body">
                  ${this.searchResultsView === 'history' ? html`
                    <div class="p-3">
                      ${this._renderSearchHistoryPane()}
                    </div>
                  ` : html`
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
                    <div class="p-2 border-b bg-white">
                      ${browsePagination}
                    </div>
                  `}

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
                              ${sortedImages.length ? renderSelectableImageGrid({
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
                                onImageClick: (event, image) => this._handleSearchImageClick(event, image, sortedImages),
                                onDragStart: (event, image) => this._handleSearchDragStart(event, image, sortedImages),
                                selectionEvents: {
                                  pointerDown: (event, index, imageId, imageOrder, groupKey) =>
                                    this._handleBrowseByFolderPointerDown(event, index, imageId, imageOrder, groupKey),
                                  pointerMove: (event) => this._handleSearchPointerMove(event),
                                  pointerEnter: (index, imageOrder, groupKey) =>
                                    this._handleBrowseByFolderSelectHover(index, imageOrder, groupKey),
                                  order,
                                  groupKey: folder,
                                },
                                options: {
                                  enableReordering: false,
                                  showPermatags: true,
                                  showAiScore: false,
                                  viewMode: this.searchResultsLayout,
                                  renderListDetails: (image) => this._renderSearchListDetails(image),
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
                  `}
                </div>
              </div>

              ${savedPane}
            </div>
          </div>
        ` : ''}

        ${this.searchSubTab === 'chips' ? html`
          <home-chips-tab
            .tenant=${this.tenant}
            .canCurate=${this.canCurate}
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

        ${this.searchSubTab === 'gallery' ? html`
          ${this._renderGallerySubtab()}
        ` : html``}

        ${this.searchSubTab === 'landing' ? html`
          ${this._renderUx1Landing()}
        ` : html``}
      </div>
    `;
  }
}

customElements.define('search-tab', SearchTab);
