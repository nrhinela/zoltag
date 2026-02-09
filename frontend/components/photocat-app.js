import { LitElement, html } from 'lit';
import './app-header.js';
import './tag-histogram.js';
import './upload-modal.js';
import './tab-container.js'; // Import the new tab container
import './list-editor.js'; // Import the new list editor
import './permatag-editor.js';
import './tagging-admin.js';
import './ml-training.js';
import './image-editor.js';
import './cli-commands.js';
import './person-manager.js';
import './people-tagger.js';
import './shared/widgets/filter-chips.js';
import './shared/widgets/keyword-dropdown.js';

import ImageFilterPanel from './shared/state/image-filter-panel.js';
import { CurateHomeStateController } from './state/curate-home-state.js';
import { CurateAuditStateController } from './state/curate-audit-state.js';
import { CurateExploreStateController } from './state/curate-explore-state.js';
import { RatingModalStateController } from './state/rating-modal-state.js';
import { SearchStateController } from './state/search-state.js';
import { AppShellStateController } from './state/app-shell-state.js';
import { AppDataStateController } from './state/app-data-state.js';
import { AppEventsStateController } from './state/app-events-state.js';
import { tailwind } from './tailwind-lit.js';
import { retryFailedCommand } from '../services/command-queue.js';
import { createSelectionHandlers } from './shared/selection-handlers.js';
import { createPaginationHandlers } from './shared/pagination-controls.js';
import { createRatingDragHandlers } from './shared/rating-drag-handlers.js';
import { createHotspotHandlers, parseUtilityKeywordValue } from './shared/hotspot-controls.js';
import {
  buildCurateFilterObject,
  getCurateAuditFetchKey,
  getCurateHomeFetchKey,
} from './shared/curate-filters.js';
import { shouldAutoRefreshCurateStats } from './shared/curate-stats.js';
import {
  formatCurateDate,
  formatQueueItem,
} from './shared/formatting.js';
import './home-tab.js';
import './home-chips-tab.js';
import './home-insights-tab.js';
import './lab-tab.js';
import './curate-home-tab.js';
import './curate-explore-tab.js';
import './curate-browse-folder-tab.js';
import './curate-audit-tab.js';
import './search-tab.js';
import { renderCurateTabContent } from './render/curate-tab-content.js';
import { renderHomeTabContent, renderSearchTabContent } from './render/home-search-tab-content.js';
import { renderAuxTabContent, renderGlobalOverlays, renderRatingModal } from './render/aux-tab-content.js';
import { photocatAppStyles } from './styles/photocat-app-styles.js';

class PhotoCatApp extends LitElement {
  static styles = [tailwind, photocatAppStyles];

  static properties = {
      tenant: { type: String },
      showUploadModal: { type: Boolean },
      activeTab: { type: String }, // New property for active tab
      activeAdminSubTab: { type: String }, // Subtab for admin section (people or tagging)
      activeSystemSubTab: { type: String }, // Subtab for system section (pipeline or cli)
      keywords: { type: Array },
      queueState: { type: Object },
      showQueuePanel: { type: Boolean },
      imageStats: { type: Object },
      mlTrainingStats: { type: Object },
      tagStatsBySource: { type: Object },
      curateFilters: { type: Object },
      curateLimit: { type: Number },
      curateOrderBy: { type: String },
      curateOrderDirection: { type: String },
      curateHideDeleted: { type: Boolean },
      curateMinRating: { type: [Number, String] },
      curateKeywordFilters: { type: Object },
      curateKeywordOperators: { type: Object },
      curateCategoryFilterOperator: { type: String },
      curateDropboxPathPrefix: { type: String },
      curateListId: { type: [Number, String] },
      curateListExcludeId: { type: [Number, String] },
      curateImages: { type: Array },
      curatePageOffset: { type: Number },
      curateTotal: { type: Number },
      curateLoading: { type: Boolean },
      curateDragSelection: { type: Array },
      curateDragSelecting: { type: Boolean },
      curateDragStartIndex: { type: Number },
      curateDragEndIndex: { type: Number },
      curateThumbSize: { type: Number },
      curateEditorImage: { type: Object },
      curateEditorOpen: { type: Boolean },
      curateEditorImageSet: { type: Array },
      curateEditorImageIndex: { type: Number },
      curateSubTab: { type: String, attribute: false },
      curateAuditMode: { type: String },
      curateAuditKeyword: { type: String },
      curateAuditCategory: { type: String },
      curateAuditImages: { type: Array },
      curateAuditSelection: { type: Array },
      curateAuditDragTarget: { type: String },
      curateAuditDragSelection: { type: Array },
      curateAuditDragSelecting: { type: Boolean },
      curateAuditDragStartIndex: { type: Number },
      curateAuditDragEndIndex: { type: Number },
      curateAuditLimit: { type: Number },
      curateAuditOffset: { type: Number },
      curateAuditTotal: { type: Number },
      curateAuditLoading: { type: Boolean },
      curateAuditLoadAll: { type: Boolean },
      curateAuditPageOffset: { type: Number },
      curateAuditAiEnabled: { type: Boolean },
      curateAuditAiModel: { type: String },
      curateAuditOrderBy: { type: String },
      curateAuditOrderDirection: { type: String },
      curateAuditHideDeleted: { type: Boolean },
      curateAuditMinRating: { type: [Number, String] },
      curateAuditNoPositivePermatags: { type: Boolean },
      curateAuditDropboxPathPrefix: { type: String },
      curateHomeRefreshing: { type: Boolean },
      curateStatsLoading: { type: Boolean },
      homeSubTab: { type: String },
      curateAdvancedOpen: { type: Boolean },
      curateNoPositivePermatags: { type: Boolean },
      activeCurateTagSource: { type: String },
      curateCategoryCards: { type: Array },
      curateAuditTargets: { type: Array },
      curateExploreTargets: { type: Array },
      curateExploreRatingEnabled: { type: Boolean },
      curateAuditRatingEnabled: { type: Boolean },
      searchImages: { type: Array },
      searchTotal: { type: Number },
      currentUser: { type: Object },
  }

  constructor() {
      super();
      this.tenant = 'bcg'; // Default tenant
      this.showUploadModal = false;
      this.activeTab = 'home'; // Default to home tab
      this.homeSubTab = 'overview';
      this.activeAdminSubTab = 'tagging'; // Default admin subtab
      this.activeSystemSubTab = 'ml-training'; // Default system subtab

      // Initialize filter state containers for each tab
      this.searchFilterPanel = new ImageFilterPanel('search');
      this.searchFilterPanel.setTenant(this.tenant);
      this.curateHomeFilterPanel = new ImageFilterPanel('curate-home');
      this.curateHomeFilterPanel.setTenant(this.tenant);
      this.curateAuditFilterPanel = new ImageFilterPanel('curate-audit');
      this.curateAuditFilterPanel.setTenant(this.tenant);

      // Initialize state controllers
      // Milestone 1: Curate Home State (Complete)
      this._curateHomeState = new CurateHomeStateController(this);
      // Milestone 2: Curate Audit State (In Progress)
      this._curateAuditState = new CurateAuditStateController(this);
      this._curateExploreState = new CurateExploreStateController(this);
      this._searchState = new SearchStateController(this);
      this._ratingModalState = new RatingModalStateController(this);
      this._appShellState = new AppShellStateController(this);
      this._appDataState = new AppDataStateController(this);
      this._appEventsState = new AppEventsStateController(this);

      this._handleSearchSortChanged = (e) =>
        this._searchState.handleSortChanged(e.detail || {});

      this.keywords = [];
      this.queueState = { queuedCount: 0, inProgressCount: 0, failedCount: 0 };
      this._unsubscribeQueue = null;
      this.showQueuePanel = false;
      this.imageStats = null;
      this.mlTrainingStats = null;
      this.tagStatsBySource = {};
      this.curateLimit = 100;
      this.curateOrderBy = 'photo_creation';
      this.curateOrderDirection = 'desc';
      this.curateHideDeleted = true;
      this.curateMinRating = null;
      this.curateKeywordFilters = {};
      this.curateKeywordOperators = {};
      this.curateCategoryFilterOperator = undefined;
      this.curateDropboxPathPrefix = '';
      this.curateListId = '';
      this.curateListExcludeId = '';
      this.curateFilters = buildCurateFilterObject(this);
      this.curateImages = [];
      this.curatePageOffset = 0;
      this.curateTotal = null;
      this.curateLoading = false;
      this.curateDragSelection = [];
      this.curateDragSelecting = false;
      this.curateDragStartIndex = null;
      this.curateDragEndIndex = null;
      this.curateThumbSize = 190;
      this.curateEditorImage = null;
      this.curateEditorOpen = false;
      this.curateEditorImageSet = [];
      this.curateEditorImageIndex = -1;
      this.curateSubTab = 'main';
      this.curateAuditMode = 'existing';
      this.curateAuditKeyword = '';
      this.curateAuditCategory = '';
      this.curateAuditImages = [];
      this.curateAuditSelection = [];
      this.curateAuditDragTarget = null;
      this.curateAuditDragSelection = [];
      this.curateAuditDragSelecting = false;
      this.curateAuditDragStartIndex = null;
      this.curateAuditDragEndIndex = null;
      this.curateAuditLimit = 100;
      this.curateAuditOffset = 0;
      this.curateAuditTotal = null;
      this.curateAuditLoading = false;
      this.curateAuditLoadAll = false;
      this.curateAuditPageOffset = 0;
      this.curateAuditAiEnabled = false;
      this.curateAuditAiModel = '';
      this.curateAuditOrderBy = 'photo_creation';
      this.curateAuditOrderDirection = 'desc';
      this.curateAuditHideDeleted = true;
      this.curateAuditMinRating = null;
      this.curateAuditNoPositivePermatags = false;
      this.curateAuditDropboxPathPrefix = '';
      this.curateHomeRefreshing = false;
      this.curateStatsLoading = false;
      this.curateAdvancedOpen = false;
      this.curateNoPositivePermatags = false;
      this.activeCurateTagSource = 'permatags';
      this.curateCategoryCards = [];
      this.searchImages = [];
      this.searchTotal = 0;
      this.currentUser = null;
      this.curateExploreTargets = [
        { id: 1, category: '', keyword: '', action: 'add', count: 0 },
      ];
      this._curateExploreHotspotNextId = 2;
      this.curateExploreRatingEnabled = false;
      this.curateExploreRatingCount = 0;
      this._curateExploreRatingPending = null;
      this.curateAuditTargets = [
        { id: 1, category: '', keyword: '', action: 'remove', count: 0 },
      ];
      this._curateAuditHotspotNextId = 2;
      this.curateAuditRatingEnabled = false;
      this.curateAuditRatingCount = 0;
      this._curateAuditRatingPending = null;
      this._curateRatingModalActive = false;
      this._curateRatingModalImageIds = null;
      this._curateRatingModalSource = null;
      this._curateSubTabState = { main: null };
      this._curateActiveWorkingTab = 'main';
      this._curateSubTabState.main = this._snapshotCurateState();
      this._statsRefreshTimer = null;
      this._curateStatsLoadingCount = 0;
      this._curatePressTimer = null;
      this._curatePressActive = false;
      this._curatePressStart = null;
      this._curatePressIndex = null;
      this._curatePressImageId = null;
      this._curateSuppressClick = false;
      this._curateLongPressTriggered = false;
      this._curateAuditPressTimer = null;
      this._curateAuditPressActive = false;
      this._curateAuditPressStart = null;
      this._curateAuditPressIndex = null;
      this._curateAuditPressImageId = null;
      this._curateAuditLongPressTriggered = false;
      this._tabBootstrapped = new Set();
      this._curateRatingBurstIds = new Set();
      this._curateRatingBurstTimers = new Map();
      this._curateStatsAutoRefreshDone = false;
      this._curateFlashSelectionIds = new Set();
      this._curateFlashSelectionTimers = new Map();
      this._curateDragOrder = null;
      this._curateExploreReorderId = null;
      this._curateAuditHotspotDragTarget = null;
      this._curateExploreHotspotDragTarget = null;

      // Initialize hotspot handlers using factory (eliminates 30+ duplicate methods)
      this._exploreHotspotHandlers = createHotspotHandlers(this, {
        targetsProperty: 'curateExploreTargets',
        dragTargetProperty: '_curateExploreHotspotDragTarget',
        nextIdProperty: '_curateExploreHotspotNextId',
        parseKeywordValue: parseUtilityKeywordValue,
        applyRating: (ids, rating) => this._applyExploreRating(ids, rating),
        processTagDrop: (ids, target) => this._processExploreTagDrop(ids, target),
        removeImages: (ids) => this._removeCurateImagesByIds(ids),
      });

      this._auditHotspotHandlers = createHotspotHandlers(this, {
        targetsProperty: 'curateAuditTargets',
        dragTargetProperty: '_curateAuditHotspotDragTarget',
        nextIdProperty: '_curateAuditHotspotNextId',
        parseKeywordValue: parseUtilityKeywordValue,
        applyRating: (ids, rating) => this._applyAuditRating(ids, rating),
        processTagDrop: (ids, target) => this._curateAuditState.processTagDrop(ids, target),
        removeImages: (ids) => this._removeAuditImagesByIds(ids),
      });

      // Initialize rating drag handlers using factory (eliminates 8+ duplicate methods)
      this._exploreRatingHandlers = createRatingDragHandlers(this, {
        enabledProperty: 'curateExploreRatingEnabled',
        dragTargetProperty: '_curateExploreRatingDragTarget',
        showRatingDialog: (ids) => this._showExploreRatingDialog(ids),
      });

      this._auditRatingHandlers = createRatingDragHandlers(this, {
        enabledProperty: 'curateAuditRatingEnabled',
        dragTargetProperty: '_curateAuditRatingDragTarget',
        showRatingDialog: (ids) => this._showAuditRatingDialog(ids),
      });

      // Initialize selection handlers using factory (eliminates 10+ duplicate methods)
      this._exploreSelectionHandlers = createSelectionHandlers(this, {
        selectionProperty: 'curateDragSelection',
        selectingProperty: 'curateDragSelecting',
        startIndexProperty: 'curateDragStartIndex',
        endIndexProperty: 'curateDragEndIndex',
        pressActiveProperty: '_curatePressActive',
        pressStartProperty: '_curatePressStart',
        pressIndexProperty: '_curatePressIndex',
        pressImageIdProperty: '_curatePressImageId',
        pressTimerProperty: '_curatePressTimer',
        longPressTriggeredProperty: '_curateLongPressTriggered',
        getOrder: () => this._curateDragOrder || this._curateLeftOrder,
        flashSelection: (imageId) => this._flashCurateSelection(imageId),
      });

      this._auditSelectionHandlers = createSelectionHandlers(this, {
        selectionProperty: 'curateAuditDragSelection',
        selectingProperty: 'curateAuditDragSelecting',
        startIndexProperty: 'curateAuditDragStartIndex',
        endIndexProperty: 'curateAuditDragEndIndex',
        pressActiveProperty: '_curateAuditPressActive',
        pressStartProperty: '_curateAuditPressStart',
        pressIndexProperty: '_curateAuditPressIndex',
        pressImageIdProperty: '_curateAuditPressImageId',
        pressTimerProperty: '_curateAuditPressTimer',
        longPressTriggeredProperty: '_curateAuditLongPressTriggered',
        getOrder: () => this._curateAuditLeftOrder,
        flashSelection: (imageId) => this._flashCurateSelection(imageId),
      });

      // Initialize pagination handlers using factory (eliminates 6+ duplicate methods)
      this._auditPaginationHandlers = createPaginationHandlers(this, {
        loadingProperty: 'curateAuditLoading',
        offsetProperty: 'curateAuditPageOffset',
        limitProperty: 'curateAuditLimit',
        loadAllProperty: 'curateAuditLoadAll',
        fetchData: (options) => this._fetchCurateAuditImages(options),
      });

      // Wire up filter panel event listeners
      this.searchFilterPanel.on('images-loaded', (detail) => {
        if (detail.tabId === 'search') {
          // Create new array reference so Lit detects the change
          this.searchImages = [...detail.images];
          this.searchTotal = detail.total || 0;
        }
      });
      this.curateHomeFilterPanel.on('images-loaded', (detail) => {
        if (detail.tabId === 'curate-home') {
          this.curateImages = [...detail.images];
          this.curateTotal = detail.total || 0;
        }
      });
      this.curateAuditFilterPanel.on('images-loaded', (detail) => {
        if (detail.tabId === 'curate-audit') {
          this.curateAuditImages = [...detail.images];
          this.curateAuditTotal = detail.total || 0;
        }
      });

      this._handleQueueCommandComplete = (event) =>
        this._appEventsState.handleQueueCommandComplete(event);
      this._handleQueueCommandFailed = (event) =>
        this._appEventsState.handleQueueCommandFailed(event);
      this._handleQueueToggle = () => {
        this.showQueuePanel = !this.showQueuePanel;
      };
      this._handleCurateGlobalPointerDown = (event) =>
        this._appEventsState.handleCurateGlobalPointerDown(event);
      this._handleCurateSelectionEnd = () =>
        this._appEventsState.handleCurateSelectionEnd();
  }

  _getCurateDefaultState() {
      return this._curateHomeState.getDefaultState();
  }

  _snapshotCurateState() {
      return this._curateHomeState.snapshotState();
  }

  _restoreCurateState(state) {
      this._curateHomeState.restoreState(state || this._getCurateDefaultState());
      this._curateDragOrder = null;
      this._cancelCuratePressState();
  }

  // Explore hotspot handlers - now using factory to eliminate duplication
  _handleCurateExploreHotspotKeywordChange(event, targetId) {
      return this._curateExploreState.handleHotspotKeywordChange(event, targetId);
  }

  _handleCurateExploreHotspotActionChange(event, targetId) {
      return this._curateExploreState.handleHotspotActionChange(event, targetId);
  }

  _handleCurateExploreHotspotTypeChange(event, targetId) {
      return this._curateExploreState.handleHotspotTypeChange(event, targetId);
  }

  _handleCurateExploreHotspotRatingChange(event, targetId) {
      return this._curateExploreState.handleHotspotRatingChange(event, targetId);
  }

  _handleCurateExploreHotspotAddTarget() {
      return this._curateExploreState.handleHotspotAddTarget();
  }

  _handleCurateExploreHotspotRemoveTarget(targetId) {
      return this._curateExploreState.handleHotspotRemoveTarget(targetId);
  }

  _handleCurateExploreHotspotDrop(event, targetId) {
      return this._curateExploreState.handleHotspotDrop(event, targetId);
  }

  _handleCurateHotspotChanged(event) {
      return this._curateExploreState.handleHotspotChanged(event);
  }

  _handleCurateAuditHotspotChanged(event) {
      // Transform event detail to match state controller expectations
      const detail = {
          changeType: event.detail.type?.replace('-change', '').replace('-target', '').replace('hotspot-drop', 'drop'),
          targetId: event.detail.targetId,
          value: event.detail.value,
          event: event.detail.event,
      };
      return this._curateAuditState.handleHotspotChanged({ detail });
  }

  _removeCurateImagesByIds(ids) {
      return this._curateHomeState.removeImagesByIds(ids);
  }

  _removeAuditImagesByIds(ids) {
      return this._curateAuditState.removeImagesByIds(ids);
  }

  _processExploreTagDrop(ids, target) {
      return this._curateExploreState.processTagDrop(ids, target);
  }

  _syncAuditHotspotPrimary() {
      return this._curateAuditState.syncHotspotPrimary();
  }

  _handleCurateExploreRatingDrop(event, ratingValue = null) {
      return this._curateExploreState.handleRatingDrop(event, ratingValue);
  }

  _handleCurateAuditRatingDrop(event) {
      return this._auditRatingHandlers.handleDrop(event);
  }

  connectedCallback() {
      super.connectedCallback();
      this._appEventsState.connect();
  }

  async _loadCurrentUser() {
      return await this._appShellState.loadCurrentUser();
  }

  _getTenantRole() {
      return this._appShellState.getTenantRole();
  }

  _canCurate() {
      return this._appShellState.canCurate();
  }

  _handleTabChange(event) {
      return this._appShellState.handleTabChange(event);
  }

  _handleHomeNavigate(event) {
      return this._appShellState.handleHomeNavigate(event);
  }

  _initializeTab(tab, { force = false } = {}) {
      return this._appShellState.initializeTab(tab, { force });
  }

  _showExploreRatingDialog(imageIds) {
      return this._ratingModalState.showExploreRatingDialog(imageIds);
  }

  _showAuditRatingDialog(imageIds) {
      return this._ratingModalState.showAuditRatingDialog(imageIds);
  }

  _handleRatingModalClick(rating) {
      return this._ratingModalState.handleRatingModalClick(rating);
  }

  _closeRatingModal() {
      return this._ratingModalState.closeRatingModal();
  }

  _handleEscapeKey(e) {
      return this._ratingModalState.handleEscapeKey(e);
  }

  async _applyExploreRating(imageIds, rating) {
      return await this._ratingModalState.applyExploreRating(imageIds, rating);
  }

  async _applyAuditRating(imageIds, rating) {
      return await this._ratingModalState.applyAuditRating(imageIds, rating);
  }

  disconnectedCallback() {
      this._appEventsState.disconnect();
      super.disconnectedCallback();
  }

  _applyCurateFilters({ resetOffset = false } = {}) {
      return this._curateHomeState.applyCurateFilters({ resetOffset });
  }

  // Explore selection handlers - now using factory to eliminate duplication
  _cancelCuratePressState() {
      return this._exploreSelectionHandlers.cancelPressState();
  }

  // Audit selection handlers - now using factory to eliminate duplication
  _cancelCurateAuditPressState() {
      return this._auditSelectionHandlers.cancelPressState();
  }

  _handleCuratePointerDown(event, index, imageId) {
      return this._exploreSelectionHandlers.handlePointerDown(event, index, imageId);
  }

  _handleCurateKeywordSelect(event, mode) {
      return this._curateHomeState.handleKeywordSelect(event, mode);
  }

  _updateCurateCategoryCards() {
      return this._curateHomeState.updateCurateCategoryCards();
  }

  async _fetchCurateHomeImages() {
      return await this._curateHomeState.fetchCurateHomeImages();
  }

  _resetSearchListDraft() {
      return this._searchState.resetSearchListDraft();
  }

  async _refreshCurateHome() {
      return await this._curateHomeState.refreshCurateHome();
  }


  _handleTenantChange(e) {
      return this._appShellState.handleTenantChange(e);
  }

  _handleOpenUploadModal() {
      this.showUploadModal = true;
  }

    _handleCloseUploadModal() {
        this.showUploadModal = false;
    }

    _handlePipelineOpenImage(event) {
        const image = event?.detail?.image;
        if (!image?.id) return;
        this.curateEditorImage = image;
        this.curateEditorImageSet = Array.isArray(this.curateImages) ? [...this.curateImages] : [];
        this.curateEditorImageIndex = this.curateEditorImageSet.findIndex(img => img.id === image.id);
        this.curateEditorOpen = true;
    }
    
    _handleUploadComplete() {
        const curateFilters = buildCurateFilterObject(this);
        this.curateHomeFilterPanel.updateFilters(curateFilters);
        this._fetchCurateHomeImages();
        this.fetchStats({
          force: true,
          includeTagStats: this.activeTab === 'curate' && this.curateSubTab === 'home',
        });
        this.showUploadModal = false;
    }

  _handleCurateChipFiltersChanged(event) {
      return this._curateHomeState.handleChipFiltersChanged(event);
  }

  _handleCurateListExcludeFromRightPanel(event) {
      return this._curateHomeState.handleListExcludeFromRightPanel(event);
  }

  _handleCurateAuditChipFiltersChanged(event) {
      return this._curateAuditState.handleChipFiltersChanged(event);
  }

  async _fetchDropboxFolders(query) {
      return await this._searchState.fetchDropboxFolders(query);
  }

  _handleCurateThumbSizeChange(event) {
      this.curateThumbSize = Number(event.target.value);
  }

  _handleCurateSubTabChange(nextTab) {
      return this._curateExploreState.handleSubTabChange(nextTab);
  }

  _buildCurateFilters(options = {}) {
      return buildCurateFilterObject(this, options);
  }

  _getCurateHomeFetchKey() {
      return getCurateHomeFetchKey(this);
  }

  _getCurateAuditFetchKey(options = {}) {
      return getCurateAuditFetchKey(this, options);
  }

  _shouldAutoRefreshCurateStats() {
      return shouldAutoRefreshCurateStats(this);
  }

  async _loadExploreByTagData(forceRefresh = false) {
      return await this._curateExploreState.loadExploreByTagData(forceRefresh);
  }

  _handleCurateAuditModeChange(valueOrEvent) {
      const mode = typeof valueOrEvent === 'string'
          ? valueOrEvent
          : valueOrEvent.target.value;
      return this._curateAuditState.handleModeChange(mode);
  }

  _handleCurateAuditAiEnabledChange(event) {
      return this._curateAuditState.handleAiEnabledChange(event.target.checked);
  }

  _handleCurateAuditAiModelChange(nextModel) {
      return this._curateAuditState.handleAiModelChange(nextModel);
  }

  // Audit pagination handlers - now using factory to eliminate duplication
  async _fetchCurateAuditImages(options = {}) {
      return await this._curateAuditState.fetchCurateAuditImages(options);
  }

  _refreshCurateAudit() {
      return this._curateAuditState.refreshAudit();
  }


  _handleCurateImageClick(event, image, imageSet) {
      return this._curateHomeState.handleCurateImageClick(event, image, imageSet);
  }

  async _handleZoomToPhoto(e) {
      return await this._curateExploreState.handleZoomToPhoto(e);
  }

  _handleCurateEditorClose() {
      return this._curateHomeState.handleCurateEditorClose();
  }

  _handleImageNavigate(event) {
      return this._curateHomeState.handleImageNavigate(event);
  }

  _handleCurateSelectHover(index) {
      return this._exploreSelectionHandlers.handleSelectHover(index);
  }

  _handleExploreByTagPointerDown(event, index, imageId, keywordName, cachedImages) {
      return this._curateExploreState.handleExploreByTagPointerDown(event, index, imageId, cachedImages);
  }

  _handleExploreByTagSelectHover(index, cachedImages) {
      return this._curateExploreState.handleExploreByTagSelectHover(index, cachedImages);
  }


  _flashCurateSelection(imageId) {
      return this._curateHomeState.flashSelection(imageId);
  }

  render() {
    const canCurate = this._canCurate();
    const navCards = [
      { key: 'search', label: 'Search', subtitle: 'Explore and save results', icon: 'fa-magnifying-glass' },
      { key: 'curate', label: 'Curate', subtitle: 'Build stories and sets', icon: 'fa-star' },
      { key: 'lists', label: 'Lists', subtitle: 'Organize saved sets', icon: 'fa-list' },
      { key: 'admin', label: 'Keywords', subtitle: 'Manage configuration', icon: 'fa-cog' },
      { key: 'system', label: 'System', subtitle: 'Manage pipelines and tasks', icon: 'fa-sliders' },
    ].filter((card) => canCurate || card.key !== 'curate');
    this._curateLeftOrder = this.curateImages.map((img) => img.id);
    this._curateRightOrder = [];

    return html`
        ${renderRatingModal(this)}
        <app-header
            .tenant=${this.tenant}
            @tenant-change=${this._handleTenantChange}
            @open-upload-modal=${this._handleOpenUploadModal}
            .activeTab=${this.activeTab}
            .canCurate=${canCurate}
            .queueCount=${(this.queueState?.queuedCount || 0) + (this.queueState?.inProgressCount || 0) + (this.queueState?.failedCount || 0)}
            @tab-change=${this._handleTabChange}
            @sync-progress=${this._handleSyncProgress}
            @sync-complete=${this._handleSyncComplete}
            @sync-error=${this._handleSyncError}
        ></app-header>
        
        <tab-container .activeTab=${this.activeTab}>
            ${this.activeTab === 'home' ? renderHomeTabContent(this, { navCards, formatCurateDate }) : ''}
            ${this.activeTab === 'search' ? renderSearchTabContent(this, { formatCurateDate }) : ''}
            ${this.activeTab === 'curate' ? renderCurateTabContent(this, { formatCurateDate }) : ''}
            ${renderAuxTabContent(this, { formatCurateDate, formatQueueItem, retryFailedCommand })}
        </tab-container>
        ${renderGlobalOverlays(this, { canCurate })}
    `;
  }

  async fetchKeywords() {
      return await this._appDataState.fetchKeywords();
  }

  async fetchStats({ force = false, includeRatings, includeImageStats = true, includeMlStats = true, includeTagStats = true } = {}) {
      return await this._appDataState.fetchStats({
          force,
          includeRatings,
          includeImageStats,
          includeMlStats,
          includeTagStats,
      });
  }

  _handleImageRatingUpdated(e) {
      if (e?.detail?.imageId !== undefined && e?.detail?.rating !== undefined) {
          this._curateExploreState.applyCurateRating(e.detail.imageId, e.detail.rating);
      }
  }

  _handleSyncProgress(e) {
      return this._appDataState.handleSyncProgress(e);
  }

  _handleSyncComplete(e) {
      return this._appDataState.handleSyncComplete(e);
  }

  _handleSyncError(e) {
      return this._appDataState.handleSyncError(e);
  }

  updated(changedProperties) {
      if (changedProperties.has('curateAuditKeyword') || changedProperties.has('curateAuditMode')) {
          this._syncAuditHotspotPrimary();
      }
      if (changedProperties.has('keywords') && this.curateAuditKeyword) {
          this._syncAuditHotspotPrimary();
      }
      this._appShellState.handleUpdated(changedProperties);
  }

}

customElements.define('photocat-app', PhotoCatApp);
