import { LitElement, html, css } from 'lit';
import './app-header.js';
import './image-gallery.js';
import './filter-controls.js';
import './image-modal.js';
import './upload-modal.js';
import './tab-container.js'; // Import the new tab container
import './list-editor.js'; // Import the new list editor
import './permatag-editor.js';
import './tagging-admin.js';
import './ml-training.js';
import './image-editor.js';

import { tailwind } from './tailwind-lit.js';
import { getLists, getActiveList, getListItems, updateList, getKeywords, getImageStats, getMlTrainingStats, getTagStats, getImages } from '../services/api.js';
import { enqueueCommand, subscribeQueue, retryFailedCommand } from '../services/command-queue.js';

class PhotoCatApp extends LitElement {
  static styles = [tailwind, css`
    :host {
      display: block;
    }
    .container {
        max-width: 1280px;
        margin: 0 auto;
        padding: 16px;
    }
    .home-top-row {
        display: grid;
        grid-template-columns: 1fr;
        gap: 16px;
        margin-bottom: 16px;
        align-items: stretch;
    }
    @media (min-width: 1024px) {
        .home-top-row {
            grid-template-columns: 1fr 1fr;
            align-items: stretch;
        }
    }
    .home-panel {
        height: 100%;
        display: flex;
        flex-direction: column;
        min-height: 0;
    }
    .home-panel-right {
        overflow: hidden;
    }
    .tag-carousel {
        display: flex;
        gap: 12px;
        overflow-x: auto;
        overflow-y: auto;
        padding-bottom: 4px;
        -webkit-overflow-scrolling: touch;
        flex: 1;
        align-items: stretch;
        min-height: 0;
    }
    .tag-card {
        min-width: 180px;
        height: 100%;
        display: flex;
        flex-direction: column;
    }
    .tag-card-body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
    }
    .tag-bar {
        height: 6px;
        border-radius: 9999px;
        background: #e5e7eb;
        overflow: hidden;
    }
    .tag-bar-fill {
        height: 100%;
        background: #2563eb;
    }
    .home-nav-grid {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(1, minmax(0, 1fr));
    }
    @media (min-width: 768px) {
        .home-nav-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }
    @media (min-width: 1024px) {
        .home-nav-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
        }
    }
    .home-nav-button {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 20px;
        border-radius: 12px;
        border: 1px solid #e5e7eb;
        background: #ffffff;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        transition: transform 0.15s ease, box-shadow 0.15s ease;
        text-align: left;
    }
    .home-nav-button:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 16px rgba(0, 0, 0, 0.08);
    }
    .curate-subtabs {
        display: inline-flex;
        gap: 6px;
        padding: 4px;
        border-radius: 999px;
        background: #f3f4f6;
        border: 1px solid #e5e7eb;
    }
    .curate-subtab {
        border: none;
        background: transparent;
        color: #6b7280;
        font-size: 12px;
        font-weight: 600;
        padding: 6px 12px;
        border-radius: 999px;
        cursor: pointer;
    }
    .curate-subtab.active {
        background: #2563eb;
        color: #ffffff;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
    }
    .curate-audit-toggle {
        display: inline-flex;
        gap: 6px;
        padding: 4px;
        border-radius: 10px;
        background: #f8fafc;
        border: 1px solid #e5e7eb;
    }
    .curate-audit-toggle button {
        border: none;
        background: transparent;
        color: #6b7280;
        font-size: 12px;
        font-weight: 600;
        padding: 6px 12px;
        border-radius: 8px;
        cursor: pointer;
    }
    .curate-audit-toggle button.active {
        background: #111827;
        color: #ffffff;
    }
    .curate-layout {
        display: grid;
        grid-template-columns: 1fr;
        gap: 16px;
        min-height: 520px;
    }
    @media (min-width: 1024px) {
        .curate-layout {
            grid-template-columns: 2fr 1fr;
        }
    }
    .curate-pane {
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        background: #ffffff;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        min-height: 520px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
    }
    .curate-pane-header {
        padding: 10px 12px;
        border-bottom: 1px solid #e5e7eb;
        font-size: 12px;
        font-weight: 600;
        color: #6b7280;
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }
    .curate-pane-header-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }
    .curate-pane-header-actions {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .curate-pane-action {
        border: 1px solid #2563eb;
        background: #2563eb;
        color: #ffffff;
        font-size: 11px;
        padding: 4px 8px;
        border-radius: 6px;
        text-transform: none;
        letter-spacing: 0;
    }
    .curate-pane-action.secondary {
        background: #ffffff;
        color: #2563eb;
    }
    .curate-pane-action:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }
    .curate-pane-body {
        padding: 4px;
        flex: 1;
        overflow: auto;
    }
    .curate-grid {
        display: grid;
        gap: 2px;
        grid-template-columns: repeat(auto-fill, minmax(var(--curate-thumb-size, 110px), 1fr));
        user-select: none;
    }
    .curate-thumb {
        width: 100%;
        aspect-ratio: 1 / 1;
        object-fit: cover;
        border-radius: 8px;
        border: 1px solid #e5e7eb;
        background: #f3f4f6;
        cursor: grab;
    }
    .curate-thumb-wrapper {
        position: relative;
    }
    .curate-thumb-date {
        position: absolute;
        left: 6px;
        right: 6px;
        bottom: 6px;
        font-size: 10px;
        color: #f9fafb;
        background: rgba(17, 24, 39, 0.65);
        padding: 2px 6px;
        border-radius: 6px;
        text-align: center;
        pointer-events: none;
    }
    .curate-thumb-rating {
        position: absolute;
        left: 6px;
        right: 6px;
        bottom: 26px;
        font-size: 10px;
        color: #f9fafb;
        background: rgba(17, 24, 39, 0.65);
        padding: 2px 6px;
        border-radius: 6px;
        text-align: center;
        pointer-events: none;
    }
    .curate-thumb-info {
        position: absolute;
        left: 4px;
        right: auto;
        bottom: 4px;
        background: rgba(17, 24, 39, 0.85);
        color: #f9fafb;
        font-size: 11px;
        line-height: 1.35;
        padding: 6px 8px;
        border-radius: 6px;
        min-width: 200px;
        max-width: min(70vw, 300px);
        width: max-content;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.15s ease;
        transition-delay: 0s;
        z-index: 10;
        box-shadow: 0 8px 18px rgba(0, 0, 0, 0.25);
    }
    .curate-thumb-wrapper:hover .curate-thumb-info {
        opacity: 1;
        transition-delay: 0.5s;
    }
    .curate-thumb-line {
        display: block;
        white-space: normal;
        overflow: visible;
        word-break: break-word;
    }
    .curate-thumb.selected {
        outline: 3px solid #2563eb;
        outline-offset: -2px;
    }
    .curate-drop {
        border: 2px dashed #cbd5f5;
        border-radius: 12px;
        padding: 12px;
        color: #9ca3af;
        font-size: 14px;
        text-align: center;
        margin: 6px;
        flex: 1;
        display: flex;
        align-items: flex-start;
        justify-content: flex-start;
    }
    .curate-drop.active {
        border-color: #2563eb;
        color: #1d4ed8;
        background: #eff6ff;
    }
    .curate-tags-panel {
        display: flex;
        flex-direction: column;
        gap: 10px;
        height: 100%;
        padding: 8px;
    }
    .curate-tags-search {
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 6px 8px;
        font-size: 12px;
        color: #374151;
    }
    .curate-tags-list {
        flex: 1;
        overflow: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 0;
    }
    .curate-tag-category {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .curate-tag-category-title {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #6b7280;
    }
    .curate-tag-options {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .curate-tag-option {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        font-size: 12px;
        color: #374151;
    }
    .curate-tag-option-label {
        font-weight: 500;
        color: #374151;
    }
    .curate-tag-choice {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        font-size: 11px;
        color: #6b7280;
    }
    .curate-tag-choice label {
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }
    .curate-tags-actions {
        display: flex;
        gap: 8px;
        align-items: center;
        justify-content: flex-end;
    }
    .curate-tags-status {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: #6b7280;
        margin-right: auto;
    }
    .curate-spinner {
        width: 12px;
        height: 12px;
        border-radius: 9999px;
        border: 2px solid rgba(37, 99, 235, 0.3);
        border-top-color: #2563eb;
        animation: curate-spin 0.8s linear infinite;
    }
    @keyframes curate-spin {
        to {
            transform: rotate(360deg);
        }
    }
    .curate-tags-apply {
        border: 1px solid #2563eb;
        background: #2563eb;
        color: #ffffff;
        font-size: 12px;
        padding: 6px 10px;
        border-radius: 8px;
    }
    .curate-tags-apply:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }
    .curate-tags-cancel {
        border: 1px solid #d1d5db;
        background: #ffffff;
        color: #6b7280;
        font-size: 12px;
        padding: 6px 10px;
        border-radius: 8px;
    }
    .curate-process-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .curate-process-item {
        display: flex;
        gap: 10px;
        padding: 6px;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        background: #ffffff;
        align-items: flex-start;
    }
    .curate-process-thumb {
        width: var(--curate-thumb-size, 110px);
        height: var(--curate-thumb-size, 110px);
        object-fit: cover;
        border-radius: 8px;
        border: 1px solid #e5e7eb;
        flex-shrink: 0;
    }
    .curate-process-tags {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 12px;
        color: #374151;
        line-height: 1.4;
        word-break: break-word;
    }
    .curate-process-tag-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .curate-process-tag-label {
        font-weight: 600;
        color: #6b7280;
    }
    .curate-process-tag-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .curate-process-tag-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: #f3f4f6;
        color: #374151;
        padding: 4px 6px;
        border-radius: 8px;
        font-size: 12px;
    }
    .curate-process-tag-remove {
        color: #dc2626;
        font-size: 14px;
        line-height: 1;
    }
    .curate-process-tag-remove:hover {
        color: #b91c1c;
    }
  `];

  static properties = {
      filters: { type: Object },
      tenant: { type: String },
      selectedImage: { type: Object },
      showUploadModal: { type: Boolean },
      activeTab: { type: String }, // New property for active tab
      lists: { type: Array },
      activeListId: { type: String },
      activeListName: { type: String },
      activeListItemIds: { type: Object },
      keywords: { type: Array },
      queueState: { type: Object },
      showQueuePanel: { type: Boolean },
      displayMode: { type: String },
      imageStats: { type: Object },
      mlTrainingStats: { type: Object },
      tagStatsBySource: { type: Object },
      activeTagSource: { type: String },
      curateFilters: { type: Object },
      curateLimit: { type: Number },
      curateOrderBy: { type: String },
      curateOrderDirection: { type: String },
      curateHideDeleted: { type: Boolean },
      curateMinRating: { type: Number },
      curateKeywordFilters: { type: Object },
      curateKeywordOperators: { type: Object },
      curateImages: { type: Array },
      curateSelection: { type: Array },
      curateDragTarget: { type: String },
      curateDragSelection: { type: Array },
      curateDragSelecting: { type: Boolean },
      curateDragStartIndex: { type: Number },
      curateDragEndIndex: { type: Number },
      curateThumbSize: { type: Number },
      curateTagMode: { type: Boolean },
      curateTagChoices: { type: Object },
      curateTagFilter: { type: String },
      curateApplyStatus: { type: String },
      curateApplyTotal: { type: Number },
      curateApplyPending: { type: Number },
      curateEditorImage: { type: Object },
      curateEditorOpen: { type: Boolean },
      curateSubTab: { type: String },
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
  }

  constructor() {
      super();
      this.filters = {};
      this.tenant = 'bcg'; // Default tenant
      this.selectedImage = null;
      this.showUploadModal = false;
      this.activeTab = 'home'; // Default to home tab
      this.lists = [];
      this.activeListId = '';
      this.activeListName = '';
      this.activeListItemIds = new Set();
      this.keywords = [];
      this.queueState = { queuedCount: 0, inProgressCount: 0, failedCount: 0 };
      this._unsubscribeQueue = null;
      this.showQueuePanel = false;
      this.displayMode = 'grid';
      this.imageStats = null;
      this.mlTrainingStats = null;
      this.tagStatsBySource = {};
      this.activeTagSource = 'zero_shot';
      this.curateLimit = 50;
      this.curateOrderBy = 'photo_creation';
      this.curateOrderDirection = 'desc';
      this.curateHideDeleted = true;
      this.curateMinRating = null;
      this.curateKeywordFilters = {};
      this.curateKeywordOperators = {};
      this.curateFilters = this._buildCurateFilters();
      this.curateImages = [];
      this.curateSelection = [];
      this.curateDragTarget = null;
      this.curateDragSelection = [];
      this.curateDragSelecting = false;
      this.curateDragStartIndex = null;
      this.curateDragEndIndex = null;
      this.curateThumbSize = 190;
      this.curateTagMode = false;
      this.curateTagChoices = {};
      this.curateTagFilter = '';
      this.curateApplyStatus = 'apply';
      this.curateApplyTotal = 0;
      this.curateApplyPending = 0;
      this._pendingCurateApplyIds = new Set();
      this.curateEditorImage = null;
      this.curateEditorOpen = false;
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
      this.curateAuditLimit = 50;
      this.curateAuditOffset = 0;
      this.curateAuditTotal = null;
      this.curateAuditLoading = false;
      this.curateAuditLoadAll = false;
      this.curateAuditPageOffset = 0;
      this._listsLoaded = false;
      this._queueRefreshTimer = null;
      this._statsRefreshTimer = null;
      this._homePanelObserver = null;
      this._homePanelLeftEl = null;
      this._homePanelRightEl = null;
      this._handleWindowResize = () => {
        this._syncHomePanelHeights();
      };
      this._handleQueueCommandComplete = (event) => {
        const detail = event?.detail;
        if (!detail) return;
        if (detail.id && this._pendingCurateApplyIds?.has(detail.id)) {
          this._pendingCurateApplyIds.delete(detail.id);
          this.curateApplyPending = this._pendingCurateApplyIds.size;
          if (this._pendingCurateApplyIds.size === 0 && this.curateApplyStatus === 'applying') {
            this.curateApplyStatus = 'saved';
          }
        }
        if (
          detail.type === 'retag' ||
          detail.type === 'add-positive-permatag' ||
          detail.type === 'add-negative-permatag'
        ) {
          this._scheduleGalleryRefresh();
          this._scheduleStatsRefresh();
        }
      };
      this._handleQueueCommandFailed = (event) => {
        const detail = event?.detail;
        if (!detail?.id) return;
        if (this._pendingCurateApplyIds?.has(detail.id)) {
          this._pendingCurateApplyIds.delete(detail.id);
          this.curateApplyPending = this._pendingCurateApplyIds.size;
          if (this._pendingCurateApplyIds.size === 0 && this.curateApplyStatus === 'applying') {
            this.curateApplyStatus = 'saved';
          }
        }
      };
      this._handleQueueToggle = () => {
        this.showQueuePanel = !this.showQueuePanel;
      };
      this._handleCurateSelectionEnd = () => {
        if (this.curateDragSelecting) {
          this.curateDragSelecting = false;
          this.curateDragStartIndex = null;
          this.curateDragEndIndex = null;
        }
        if (this.curateAuditDragSelecting) {
          this.curateAuditDragSelecting = false;
          this.curateAuditDragStartIndex = null;
          this.curateAuditDragEndIndex = null;
        }
      };
  }

  connectedCallback() {
      super.connectedCallback();
      this.fetchKeywords();
      this.fetchStats();
      this._fetchCurateImages();
      this._unsubscribeQueue = subscribeQueue((state) => {
        this.queueState = state;
      });
      window.addEventListener('queue-command-complete', this._handleQueueCommandComplete);
      window.addEventListener('queue-command-failed', this._handleQueueCommandFailed);
      window.addEventListener('resize', this._handleWindowResize);
      window.addEventListener('pointerup', this._handleCurateSelectionEnd);
      window.addEventListener('keyup', this._handleCurateSelectionEnd);
  }

  disconnectedCallback() {
      if (this._unsubscribeQueue) {
        this._unsubscribeQueue();
      }
      window.removeEventListener('queue-command-complete', this._handleQueueCommandComplete);
      window.removeEventListener('queue-command-failed', this._handleQueueCommandFailed);
      window.removeEventListener('resize', this._handleWindowResize);
      window.removeEventListener('pointerup', this._handleCurateSelectionEnd);
      window.removeEventListener('keyup', this._handleCurateSelectionEnd);
      if (this._statsRefreshTimer) {
        clearTimeout(this._statsRefreshTimer);
        this._statsRefreshTimer = null;
      }
      if (this._homePanelObserver) {
        this._homePanelObserver.disconnect();
        this._homePanelObserver = null;
      }
      super.disconnectedCallback();
  }

  _handleFilterChange(e) {
      this.filters = e.detail;
  }

  _handleCurateFilterChange(e) {
      const nextFilters = { ...(e.detail || {}) };
      if (nextFilters.limit === undefined || nextFilters.limit === null || nextFilters.limit === '') {
          nextFilters.limit = 50;
      }
      this.curateFilters = nextFilters;
      this._fetchCurateImages();
  }

  _buildCurateFilters() {
      const filters = {
          limit: this.curateLimit,
          sortOrder: this.curateOrderDirection,
      };
      if (this.curateHideDeleted) {
          filters.hideZeroRating = true;
      }
      if (this.curateMinRating !== null && this.curateMinRating !== undefined) {
          filters.rating = this.curateMinRating;
          filters.ratingOperator = this.curateMinRating === 0 ? 'eq' : 'gte';
      }
      if (this.curateOrderBy) {
          filters.orderBy = this.curateOrderBy;
      }
      if (this.curateKeywordFilters && Object.keys(this.curateKeywordFilters).length) {
          const hasSelections = Object.values(this.curateKeywordFilters)
              .some((keywordsSet) => keywordsSet && keywordsSet.size > 0);
          if (hasSelections) {
              filters.keywords = this.curateKeywordFilters;
              filters.operators = this.curateKeywordOperators || {};
          }
      }
      return filters;
  }

  _applyCurateFilters() {
      this.curateFilters = this._buildCurateFilters();
      if (this.curateMinRating === 0 && this.curateHideDeleted) {
          this.curateImages = [];
          return;
      }
      this._fetchCurateImages();
  }

  _handleCurateLimitChange(e) {
      const parsed = Number.parseInt(e.target.value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
          this.curateLimit = 50;
      } else {
          this.curateLimit = parsed;
      }
      this._applyCurateFilters();
  }

  _handleCurateOrderByChange(e) {
      this.curateOrderBy = e.target.value;
      this._applyCurateFilters();
  }

  _handleCurateOrderDirectionChange(e) {
      this.curateOrderDirection = e.target.value;
      this._applyCurateFilters();
  }

  _handleCurateKeywordFilterChange(e) {
      const detail = e.detail || {};
      const nextKeywords = {};
      Object.entries(detail.keywords || {}).forEach(([category, keywordsSet]) => {
          nextKeywords[category] = keywordsSet ? new Set(keywordsSet) : new Set();
      });
      this.curateKeywordFilters = nextKeywords;
      this.curateKeywordOperators = { ...(detail.operators || {}) };
      this._applyCurateFilters();
  }

  _handleCurateHideDeletedChange(e) {
      this.curateHideDeleted = e.target.checked;
      this._applyCurateFilters();
  }

  _handleCurateMinRating(value) {
      if (this.curateMinRating === value) {
          this.curateMinRating = null;
      } else {
          this.curateMinRating = value;
      }
      this._applyCurateFilters();
  }

  _handleTenantChange(e) {
      this.tenant = e.detail;
      this._listsLoaded = false;
      this.fetchKeywords();
      this.fetchStats();
      this.curateHideDeleted = true;
      this.curateMinRating = null;
      this.curateKeywordFilters = {};
      this.curateKeywordOperators = {};
      this.curateFilters = this._buildCurateFilters();
      this._fetchCurateImages();
      this.curateSelection = [];
      this.curateDragSelection = [];
      this.curateTagMode = false;
      this.curateTagChoices = {};
      this.curateTagFilter = '';
      this.curateApplyStatus = 'apply';
      this.curateApplyTotal = 0;
      this.curateApplyPending = 0;
      if (this._pendingCurateApplyIds) {
        this._pendingCurateApplyIds.clear();
      }
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
      this.curateAuditOffset = 0;
      this.curateAuditTotal = null;
      this.curateAuditLoading = false;
      this.curateAuditLoadAll = false;
      this.curateAuditPageOffset = 0;
      this._maybeFetchListsForTab(this.activeTab);
  }

  _handleImageSelected(e) {
      console.log('Image selected:', e.detail);
      this.selectedImage = e.detail;
  }

  _handleCloseModal() {
      this.selectedImage = null;
  }

  _handleOpenUploadModal() {
      this.showUploadModal = true;
  }

    _handleCloseUploadModal() {
        this.showUploadModal = false;
    }
    
    _handleUploadComplete() {
        this.shadowRoot.querySelector('tab-container').querySelector('image-gallery').fetchImages();
        this.fetchStats();
        this.showUploadModal = false;
    }

  async _fetchCurateImages() {
      if (!this.tenant) return;
      try {
          const result = await getImages(this.tenant, this.curateFilters);
          this.curateImages = Array.isArray(result) ? result : (result.images || []);
      } catch (error) {
          console.error('Error fetching curate images:', error);
      }
  }

  _handleCurateDragStart(event, image) {
      if (this.curateDragSelecting) {
          event.preventDefault();
          return;
      }
      let ids = [image.id];
      if (this.curateDragSelection.length && this.curateDragSelection.includes(image.id)) {
          ids = this.curateDragSelection;
      } else if (this.curateDragSelection.length) {
          this.curateDragSelection = [image.id];
      }
      event.dataTransfer.setData('text/plain', ids.join(','));
      event.dataTransfer.effectAllowed = 'move';
  }

  _handleCurateDragOver(event, target) {
      event.preventDefault();
      if (this.curateDragTarget !== target) {
          this.curateDragTarget = target;
      }
  }

  _handleCurateDragLeave(target) {
      if (this.curateDragTarget === target) {
          this.curateDragTarget = null;
      }
  }

  _handleCurateDrop(event, target) {
      event.preventDefault();
      const raw = event.dataTransfer.getData('text/plain') || '';
      const ids = raw
          .split(',')
          .map((value) => Number(value.trim()))
          .filter((value) => Number.isFinite(value) && value > 0);
      if (!ids.length) return;
      const selectedIds = new Set(this.curateSelection.map((img) => img.id));
      if (target === 'right') {
          const additions = [];
          ids.forEach((id) => {
              if (selectedIds.has(id)) return;
              const image = this.curateImages.find((img) => img.id === id)
                  || this.curateSelection.find((img) => img.id === id);
              if (image) {
                  additions.push(image);
                  selectedIds.add(id);
              }
          });
          if (additions.length) {
              this.curateSelection = [...this.curateSelection, ...additions];
              this.curateDragSelection = this.curateDragSelection.filter((id) => !selectedIds.has(id));
          }
      } else if (target === 'left') {
          if (ids.some((id) => selectedIds.has(id))) {
              const removeSet = new Set(ids);
              this.curateSelection = this.curateSelection.filter((img) => !removeSet.has(img.id));
          }
      }
      this.curateDragTarget = null;
  }

  _handleCurateThumbSizeChange(event) {
      this.curateThumbSize = Number(event.target.value);
  }

  _handleCurateProcess() {
      if (!this.curateSelection.length) return;
      this.curateTagMode = true;
      this.curateTagChoices = {};
      this.curateTagFilter = '';
      this.curateApplyStatus = 'apply';
      this.curateApplyTotal = 0;
      this.curateApplyPending = 0;
      if (this._pendingCurateApplyIds) {
        this._pendingCurateApplyIds.clear();
      }
      this.curateDragSelection = [];
      this.curateDragTarget = null;
  }

  _handleCurateClearSelection() {
      this.curateSelection = [];
      this.curateDragSelection = [];
      this.curateDragTarget = null;
      this.curateTagMode = false;
      this.curateTagChoices = {};
      this.curateTagFilter = '';
      this.curateApplyStatus = 'apply';
      this.curateApplyTotal = 0;
      this.curateApplyPending = 0;
      if (this._pendingCurateApplyIds) {
        this._pendingCurateApplyIds.clear();
      }
  }

  _handleCurateTagCancel() {
      this.curateTagMode = false;
      this.curateTagChoices = {};
      this.curateTagFilter = '';
      this.curateApplyStatus = 'apply';
      this.curateApplyTotal = 0;
      this.curateApplyPending = 0;
      if (this._pendingCurateApplyIds) {
        this._pendingCurateApplyIds.clear();
      }
  }

  _handleCurateTagFilterChange(event) {
      this.curateTagFilter = event.target.value;
  }

  _handleCurateSubTabChange(nextTab) {
      if (!nextTab || this.curateSubTab === nextTab) {
          return;
      }
      this.curateSubTab = nextTab;
      if (nextTab === 'tag-audit' && this.curateAuditKeyword) {
          this._fetchCurateAuditImages();
      }
  }

  _handleCurateAuditModeChange(valueOrEvent) {
      const nextValue = typeof valueOrEvent === 'string'
          ? valueOrEvent
          : valueOrEvent.target.value;
      this.curateAuditMode = nextValue;
      this.curateAuditSelection = [];
      this.curateAuditDragSelection = [];
      this.curateAuditDragTarget = null;
      this.curateAuditOffset = 0;
      this.curateAuditTotal = null;
      this.curateAuditLoadAll = false;
      this.curateAuditPageOffset = 0;
      if (this.curateAuditKeyword) {
          this._fetchCurateAuditImages();
      }
  }

  _handleCurateAuditKeywordChange(e) {
      const detail = e.detail || {};
      let nextKeyword = '';
      let nextCategory = '';
      for (const [category, keywordsSet] of Object.entries(detail.keywords || {})) {
          if (keywordsSet && keywordsSet.size > 0) {
              const [keyword] = Array.from(keywordsSet);
              if (keyword) {
                  nextKeyword = keyword.trim();
                  nextCategory = category;
                  break;
              }
          }
      }
      this.curateAuditKeyword = nextKeyword;
      this.curateAuditCategory = nextCategory;
      this.curateAuditSelection = [];
      this.curateAuditDragSelection = [];
      this.curateAuditDragTarget = null;
      this.curateAuditOffset = 0;
      this.curateAuditTotal = null;
      this.curateAuditLoadAll = false;
      this.curateAuditPageOffset = 0;
      if (!nextKeyword) {
          this.curateAuditImages = [];
          return;
      }
      this._fetchCurateAuditImages();
  }

  _handleCurateAuditLimitChange(e) {
      const parsed = Number.parseInt(e.target.value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
          this.curateAuditLimit = 50;
      } else {
          this.curateAuditLimit = parsed;
      }
      this.curateAuditOffset = 0;
      this.curateAuditTotal = null;
      this.curateAuditLoadAll = false;
      this.curateAuditPageOffset = 0;
      if (this.curateAuditKeyword) {
          this._fetchCurateAuditImages();
      }
  }

  _handleCurateAuditLoadMore() {
      if (this.curateAuditLoading) return;
      this._fetchCurateAuditImages({ append: true });
  }

  _handleCurateAuditLoadAll() {
      if (this.curateAuditLoading || !this.curateAuditKeyword) return;
      this.curateAuditOffset = 0;
      this.curateAuditTotal = null;
      this.curateAuditLoadAll = true;
      this.curateAuditPageOffset = 0;
      this._fetchCurateAuditImages({ loadAll: true });
  }

  _handleCurateAuditPagePrev() {
      if (this.curateAuditLoading) return;
      const nextOffset = Math.max(0, (this.curateAuditPageOffset || 0) - this.curateAuditLimit);
      this.curateAuditLoadAll = false;
      this._fetchCurateAuditImages({ offset: nextOffset });
  }

  _handleCurateAuditPageNext() {
      if (this.curateAuditLoading) return;
      const nextOffset = (this.curateAuditPageOffset || 0) + this.curateAuditLimit;
      this.curateAuditLoadAll = false;
      this._fetchCurateAuditImages({ offset: nextOffset });
  }

  async _fetchCurateAuditImages({ append = false, loadAll = false, offset = null } = {}) {
      if (!this.tenant || !this.curateAuditKeyword) return;
      this.curateAuditLoading = true;
      try {
          const useLoadAll = loadAll || this.curateAuditLoadAll;
          const resolvedOffset = offset !== null && offset !== undefined
              ? offset
              : append
                ? this.curateAuditOffset
                : (this.curateAuditPageOffset || 0);
          const filters = {
              sortOrder: this.curateOrderDirection,
              orderBy: this.curateOrderBy,
              permatagKeyword: this.curateAuditKeyword,
              permatagSignum: 1,
              permatagMissing: this.curateAuditMode === 'missing',
          };
          if (!useLoadAll) {
              filters.limit = this.curateAuditLimit;
              filters.offset = resolvedOffset;
          }
          const result = await getImages(this.tenant, filters);
          const images = Array.isArray(result) ? result : (result.images || []);
          const total = Array.isArray(result)
              ? null
              : Number.isFinite(result.total)
                ? result.total
                : null;
          if (append) {
              this.curateAuditImages = [...this.curateAuditImages, ...images];
          } else {
              this.curateAuditImages = images;
          }
          if (!useLoadAll) {
              this.curateAuditPageOffset = resolvedOffset;
              this.curateAuditOffset = resolvedOffset + images.length;
              this.curateAuditTotal = total;
          } else {
              this.curateAuditOffset = images.length;
              this.curateAuditTotal = images.length;
          }
      } catch (error) {
          console.error('Error fetching curate audit images:', error);
      } finally {
          this.curateAuditLoading = false;
      }
  }

  _handleCurateAuditDragStart(event, image) {
      if (this.curateAuditDragSelecting) {
          event.preventDefault();
          return;
      }
      let ids = [image.id];
      if (this.curateAuditDragSelection.length && this.curateAuditDragSelection.includes(image.id)) {
          ids = this.curateAuditDragSelection;
      } else if (this.curateAuditDragSelection.length) {
          this.curateAuditDragSelection = [image.id];
      }
      event.dataTransfer.setData('text/plain', ids.join(','));
      event.dataTransfer.effectAllowed = 'move';
  }

  _handleCurateAuditDragOver(event) {
      event.preventDefault();
      if (this.curateAuditDragTarget !== 'right') {
          this.curateAuditDragTarget = 'right';
      }
  }

  _handleCurateAuditDragLeave() {
      if (this.curateAuditDragTarget) {
          this.curateAuditDragTarget = null;
      }
  }

  _handleCurateAuditDrop(event) {
      event.preventDefault();
      if (!this.curateAuditKeyword) return;
      const raw = event.dataTransfer.getData('text/plain') || '';
      const ids = raw
          .split(',')
          .map((value) => Number(value.trim()))
          .filter((value) => Number.isFinite(value) && value > 0);
      if (!ids.length) return;
      const idSet = new Set(ids);
      const additions = this.curateAuditImages.filter((img) => idSet.has(img.id));
      if (!additions.length) return;
      const signum = this.curateAuditMode === 'existing' ? -1 : 1;
      const category = this.curateAuditCategory || 'Uncategorized';
      const operations = additions.map((image) => ({
          image_id: image.id,
          keyword: this.curateAuditKeyword,
          category,
          signum,
      }));
      enqueueCommand({
          type: 'bulk-permatags',
          tenantId: this.tenant,
          operations,
          description: `tag audit · ${operations.length} updates`,
      });
      const updatedAdditions = additions.map((image) => (
          this._applyAuditPermatagChange(image, signum, this.curateAuditKeyword, category)
      ));
      this.curateAuditSelection = [...this.curateAuditSelection, ...updatedAdditions];
      this.curateAuditImages = this.curateAuditImages.filter((img) => !idSet.has(img.id));
      this.curateAuditDragSelection = this.curateAuditDragSelection.filter((id) => !idSet.has(id));
      this.curateAuditDragTarget = null;
  }

  _handleCurateAuditSelectStart(event, index, imageId) {
      if (this.curateAuditDragSelection.includes(imageId)) {
          return;
      }
      event.preventDefault();
      this.curateAuditDragSelecting = true;
      this.curateAuditDragStartIndex = index;
      this.curateAuditDragEndIndex = index;
      this._updateCurateAuditDragSelection();
  }

  _handleCurateAuditSelectHover(index) {
      if (!this.curateAuditDragSelecting) return;
      if (this.curateAuditDragEndIndex !== index) {
          this.curateAuditDragEndIndex = index;
          this._updateCurateAuditDragSelection();
      }
  }

  _updateCurateAuditDragSelection() {
      if (!this._curateAuditLeftOrder || this.curateAuditDragStartIndex === null || this.curateAuditDragEndIndex === null) {
          return;
      }
      const start = Math.min(this.curateAuditDragStartIndex, this.curateAuditDragEndIndex);
      const end = Math.max(this.curateAuditDragStartIndex, this.curateAuditDragEndIndex);
      const ids = this._curateAuditLeftOrder.slice(start, end + 1);
      this.curateAuditDragSelection = ids;
  }

  _handleCurateAuditClearSelection() {
      this.curateAuditSelection = [];
  }

  _applyAuditPermatagChange(image, signum, keyword, category) {
      const permatags = Array.isArray(image?.permatags) ? image.permatags : [];
      if (signum === 1) {
          return { ...image, permatags: this._mergePermatags(permatags, [{ keyword, category }]) };
      }
      const matches = (tag) => tag.keyword === keyword && (tag.category || 'Uncategorized') === (category || 'Uncategorized');
      const next = permatags.filter((tag) => !(tag.signum === 1 && matches(tag)));
      return { ...image, permatags: next };
  }

  _handleCurateImageClick(event, image) {
      if (this.curateTagMode || this.curateDragSelecting || this.curateAuditDragSelecting) {
          return;
      }
      if (event.defaultPrevented) {
          return;
      }
      this.curateEditorImage = image;
      this.curateEditorOpen = true;
  }

  _handleCurateEditorClose() {
      this.curateEditorOpen = false;
      this.curateEditorImage = null;
  }

  _setCurateTagChoice(category, keyword, choice) {
      const key = `${category}::${keyword}`;
      const next = { ...(this.curateTagChoices || {}) };
      if (!choice || choice === 'skip') {
          delete next[key];
      } else {
          next[key] = choice;
      }
      this.curateTagChoices = next;
      this.curateApplyStatus = 'apply';
      this.curateApplyTotal = 0;
      this.curateApplyPending = 0;
      if (this._pendingCurateApplyIds) {
        this._pendingCurateApplyIds.clear();
      }
  }

  _applyCurateTags() {
      if (!this.curateSelection.length) return;
      const { applyTags, removeTags } = this._splitCurateTagChoices();
      if (!applyTags.length && !removeTags.length) return;
      this.curateApplyStatus = 'applying';
      if (this._pendingCurateApplyIds) {
        this._pendingCurateApplyIds.clear();
      }
      const selectedIds = this.curateSelection.map((image) => image.id);
      const operations = [];
      this.curateSelection.forEach((image) => {
          applyTags.forEach((tag) => {
            operations.push({
              image_id: image.id,
              keyword: tag.keyword,
              category: tag.category,
              signum: 1,
            });
          });
          removeTags.forEach((tag) => {
            operations.push({
              image_id: image.id,
              keyword: tag.keyword,
              category: tag.category,
              signum: -1,
            });
          });
      });
      const commandId = enqueueCommand({
        type: 'bulk-permatags',
        tenantId: this.tenant,
        operations,
        description: `bulk permatags · ${operations.length} updates`,
      });
      if (commandId) {
        this._pendingCurateApplyIds?.add(commandId);
      }
      this.curateApplyTotal = this._pendingCurateApplyIds?.size || 0;
      this.curateApplyPending = this._pendingCurateApplyIds?.size || 0;
      if (applyTags.length) {
        this._updateCuratePermatags(selectedIds, applyTags);
      }
      if (removeTags.length) {
        this._updateCuratePermatagRemovals(selectedIds, removeTags);
      }
  }

  _handleCurateSelectStart(event, index, imageId) {
      if (this.curateDragSelection.includes(imageId)) {
          return;
      }
      event.preventDefault();
      this.curateDragSelecting = true;
      this.curateDragStartIndex = index;
      this.curateDragEndIndex = index;
      this._updateCurateDragSelection();
  }

  _handleCurateSelectHover(index) {
      if (!this.curateDragSelecting) return;
      if (this.curateDragEndIndex !== index) {
          this.curateDragEndIndex = index;
          this._updateCurateDragSelection();
      }
  }

  _updateCurateDragSelection() {
      if (!this._curateLeftOrder || this.curateDragStartIndex === null || this.curateDragEndIndex === null) {
          return;
      }
      const start = Math.min(this.curateDragStartIndex, this.curateDragEndIndex);
      const end = Math.max(this.curateDragStartIndex, this.curateDragEndIndex);
      const ids = this._curateLeftOrder.slice(start, end + 1);
      this.curateDragSelection = ids;
  }

  _renderCurateFilters({ mode = 'main' } = {}) {
    const isTagAudit = mode === 'tag-audit';
    return html`
      <div class="bg-white rounded-lg shadow p-4 mb-4">
        <div class="grid grid-cols-1 lg:grid-cols-[3fr_1fr] gap-4 items-start">
          <div class="min-w-0">
            <div class="flex flex-wrap md:flex-nowrap items-end gap-4">
              <div class="flex-[1] min-w-[90px]">
                <label class="block text-xs font-semibold text-gray-600 mb-1">Limit</label>
                <input
                  type="number"
                  min="1"
                  class="w-full px-2 py-1 border rounded-lg text-xs"
                  .value=${String(this.curateLimit)}
                  @input=${this._handleCurateLimitChange}
                >
              </div>
              <div class="flex-[2] min-w-[180px]">
                <label class="block text-xs font-semibold text-gray-600 mb-1">Order by</label>
                <div class="grid grid-cols-2 gap-2">
                  <select
                    class="w-full px-2 py-1 border rounded-lg text-xs"
                    .value=${this.curateOrderBy}
                    @change=${this._handleCurateOrderByChange}
                  >
                    <option value="photo_creation">Photo creation</option>
                    <option value="image_id">Image ID</option>
                  </select>
                  <select
                    class="w-full px-2 py-1 border rounded-lg text-xs"
                    .value=${this.curateOrderDirection}
                    @change=${this._handleCurateOrderDirectionChange}
                  >
                    <option value="desc">Desc</option>
                    <option value="asc">Asc</option>
                  </select>
                </div>
              </div>
              <div class="flex-[2] min-w-[200px]">
                <label class="block text-xs font-semibold text-gray-600 mb-1">Rating</label>
                <div class="flex flex-wrap items-center gap-2">
                  <label class="inline-flex items-center gap-2 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      class="h-4 w-4"
                      .checked=${this.curateHideDeleted}
                      @change=${this._handleCurateHideDeletedChange}
                    >
                    <span class="inline-flex items-center gap-2">
                      <i class="fas fa-trash"></i>
                      hide deleted
                    </span>
                  </label>
                  <div class="flex items-center gap-1">
                    ${[0, 1, 2, 3].map((value) => {
                      const label = value === 0 ? '0' : `${value}+`;
                      const title = value === 0 ? 'Quality = 0' : `Quality >= ${value}`;
                      return html`
                        <button
                          class="inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs ${this.curateMinRating === value ? 'bg-yellow-100 text-yellow-800 border-yellow-200' : 'bg-gray-100 text-gray-500 border-gray-200'}"
                          title=${title}
                          @click=${() => this._handleCurateMinRating(value)}
                        >
                          <i class="fas fa-star"></i>
                          <span>${label}</span>
                        </button>
                      `;
                    })}
                  </div>
                </div>
              </div>
              <div class="flex-[1] min-w-[160px]">
                <label class="block text-xs font-semibold text-gray-600 mb-1">Thumbnail size</label>
                <div class="flex items-center gap-3 text-xs text-gray-600">
                  <input
                    type="range"
                    min="80"
                    max="220"
                    step="10"
                    .value=${String(this.curateThumbSize)}
                    @input=${this._handleCurateThumbSizeChange}
                    class="flex-1"
                  >
                  <span class="w-8 text-right text-xs">${this.curateThumbSize}px</span>
                </div>
              </div>
            </div>
          </div>
          <div class="min-w-0">
            <div class="w-1/2">
              <filter-controls
                .tenant=${this.tenant}
                .keywordsOnly=${true}
                .embedded=${true}
                .singleSelect=${isTagAudit}
                .ratingFilter=${this.curateMinRating !== null && this.curateMinRating !== undefined ? String(this.curateMinRating) : ''}
                .ratingOperator=${this.curateMinRating === 0 ? 'eq' : 'gte'}
                .hideZeroRating=${this.curateHideDeleted}
                @filter-change=${isTagAudit ? this._handleCurateAuditKeywordChange : this._handleCurateKeywordFilterChange}
              ></filter-controls>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  render() {
    const fallbackActive = this.lists.find((list) => list.is_active);
    const activeId = this.activeListId || (fallbackActive ? String(fallbackActive.id) : '');
    const activeName = this.activeListName || (fallbackActive ? fallbackActive.title : 'None');
    const imageCount = this._formatStatNumber(this.imageStats?.image_count);
    const reviewedCount = this._formatStatNumber(this.imageStats?.reviewed_image_count);
    const mlTagCount = this._formatStatNumber(this.imageStats?.ml_tag_count);
    const trainedTagCount = this._formatStatNumber(this.mlTrainingStats?.trained_image_count);
    const sourceStats = this.tagStatsBySource?.[this.activeTagSource] || {};
    const categoryCards = Object.entries(sourceStats)
      .map(([category, keywords]) => {
        const keywordRows = (keywords || [])
          .filter((kw) => (kw.count || 0) > 0)
          .sort((a, b) => (b.count || 0) - (a.count || 0));
        if (!keywordRows.length) {
          return null;
        }
        const maxCount = keywordRows.reduce((max, kw) => Math.max(max, kw.count || 0), 0);
        const totalCount = keywordRows.reduce((sum, kw) => sum + (kw.count || 0), 0);
        return { category, keywordRows, maxCount, totalCount };
      })
      .filter(Boolean)
      .sort((a, b) => b.totalCount - a.totalCount);
    const navCards = [
      { key: 'search', label: 'Search', subtitle: 'Find and filter images', icon: 'fa-search' },
      { key: 'curate', label: 'Curate', subtitle: 'Build selections and stories', icon: 'fa-star' },
      { key: 'lists', label: 'Lists', subtitle: 'Organize saved sets', icon: 'fa-list' },
      { key: 'tagging', label: 'Tagging', subtitle: 'Manage keywords and labels', icon: 'fa-tags' },
      { key: 'ml-training', label: 'ML Training', subtitle: 'Inspect training data', icon: 'fa-brain' },
    ];
    const curatedIds = new Set(this.curateSelection.map((img) => img.id));
    const leftImages = this.curateTagMode
      ? this.curateSelection
      : this.curateImages.filter((img) => !curatedIds.has(img.id));
    this._curateLeftOrder = leftImages.map((img) => img.id);
    const leftPaneLabel = this.curateTagMode ? 'Selected' : 'Available';
    const rightPaneLabel = this.curateTagMode ? 'Apply Tags' : 'Selection';
    const tagFilter = (this.curateTagFilter || '').trim().toLowerCase();
    const tagGroups = {};
    this.keywords.forEach((tag) => {
      const category = tag.category || 'Uncategorized';
      const keyword = tag.keyword || '';
      if (!keyword) return;
      if (tagFilter) {
        const matchesKeyword = keyword.toLowerCase().includes(tagFilter);
        const matchesCategory = category.toLowerCase().includes(tagFilter);
        if (!matchesKeyword && !matchesCategory) return;
      }
      if (!tagGroups[category]) {
        tagGroups[category] = [];
      }
      tagGroups[category].push(keyword);
    });
    const tagCategories = Object.entries(tagGroups)
      .map(([category, keywords]) => ({
        category,
        keywords: keywords.sort((a, b) => a.localeCompare(b)),
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
    const tagChoices = this.curateTagChoices || {};
    const tagChoiceKeys = Object.keys(tagChoices);
    const applyCount = tagChoiceKeys.filter((key) => tagChoices[key] === 'apply').length;
    const removeCount = tagChoiceKeys.filter((key) => tagChoices[key] === 'remove').length;
    const applyLabel = this.curateApplyStatus === 'applying'
      ? 'Applying'
      : this.curateApplyStatus === 'saved'
        ? 'Saved'
        : 'Apply';
    const applyTotal = this.curateApplyTotal || 0;
    const applyPending = this.curateApplyPending || 0;
    const applyCompleted = applyTotal > 0 ? Math.max(applyTotal - applyPending, 0) : 0;
    const queueQueued = this.queueState?.queuedCount || 0;
    const queueRunning = this.queueState?.inProgressCount || 0;
    const queueSize = queueQueued + queueRunning;
    const auditActionVerb = this.curateAuditMode === 'existing' ? 'remove' : 'add';
    const auditLeftLabel = this.curateAuditKeyword
      ? (this.curateAuditMode === 'existing' ? `Has ${this.curateAuditKeyword}` : `Missing ${this.curateAuditKeyword}`)
      : 'Select a keyword';
    const auditRightLabel = this.curateAuditKeyword
      ? `${auditActionVerb} ${this.curateAuditKeyword}`
      : `${auditActionVerb} keyword`;
    const auditDropLabel = this.curateAuditKeyword
      ? `drag photos here to ${auditActionVerb} ${this.curateAuditKeyword}`
      : 'select a keyword to start';
    const auditLeftImages = this.curateAuditImages;
    this._curateAuditLeftOrder = auditLeftImages.map((img) => img.id);
    const auditLoadAll = this.curateAuditLoadAll;
    const auditTotalCount = auditLoadAll
      ? auditLeftImages.length
      : Number.isFinite(this.curateAuditTotal)
        ? this.curateAuditTotal
        : null;
    const auditPageStart = auditLeftImages.length
      ? (auditLoadAll ? 1 : (this.curateAuditPageOffset || 0) + 1)
      : 0;
    const auditPageEnd = auditLeftImages.length
      ? (auditLoadAll
        ? auditLeftImages.length
        : (this.curateAuditPageOffset || 0) + auditLeftImages.length)
      : 0;
    const auditCountLabel = auditTotalCount !== null
      ? (auditPageEnd === 0
        ? `0 of ${auditTotalCount}`
        : `${auditPageStart}-${auditPageEnd} of ${auditTotalCount}`)
      : `${auditLeftImages.length} loaded`;
    const auditHasMore = !auditLoadAll && auditTotalCount !== null
      && auditPageEnd < auditTotalCount;
    const auditHasPrev = !auditLoadAll && (this.curateAuditPageOffset || 0) > 0;

    return html`
        <app-header
            .tenant=${this.tenant}
            @tenant-change=${this._handleTenantChange}
            @open-upload-modal=${this._handleOpenUploadModal}
            .activeTab=${this.activeTab}
            .queueCount=${(this.queueState?.queuedCount || 0) + (this.queueState?.inProgressCount || 0) + (this.queueState?.failedCount || 0)}
            @tab-change=${(e) => this.activeTab = e.detail}
            @sync-progress=${this._handleSyncProgress}
            @sync-complete=${this._handleSyncComplete}
            @sync-error=${this._handleSyncError}
        ></app-header>
        
        <tab-container .activeTab=${this.activeTab}>
            <div slot="home" class="container">
                <div class="flex flex-wrap gap-4 mb-6">
                    <div class="flex-1 min-w-[200px] border border-gray-200 rounded-lg p-3 bg-white shadow">
                        <div class="text-xs text-gray-500 uppercase">Images</div>
                        <div class="text-2xl font-semibold text-gray-900">${imageCount}</div>
                    </div>
                    <div class="flex-1 min-w-[200px] border border-gray-200 rounded-lg p-3 bg-white shadow">
                        <div class="text-xs text-gray-500 uppercase">Reviewed</div>
                        <div class="text-2xl font-semibold text-gray-900">${reviewedCount}</div>
                    </div>
                    <div class="flex-1 min-w-[200px] border border-gray-200 rounded-lg p-3 bg-white shadow">
                        <div class="text-xs text-gray-500 uppercase">Zero-Shot</div>
                        <div class="text-2xl font-semibold text-gray-900">${mlTagCount}</div>
                    </div>
                    <div class="flex-1 min-w-[200px] border border-gray-200 rounded-lg p-3 bg-white shadow">
                        <div class="text-xs text-gray-500 uppercase">Keyword-Model</div>
                        <div class="text-2xl font-semibold text-gray-900">${trainedTagCount}</div>
                    </div>
                </div>
                <div class="home-nav-grid">
                  ${navCards.map((card) => html`
                    <button
                      class="home-nav-button"
                      type="button"
                      @click=${() => { this.activeTab = card.key; }}
                    >
                      <div>
                        <div class="text-lg font-semibold text-gray-900">${card.label}</div>
                        <div class="text-sm text-gray-500">${card.subtitle}</div>
                      </div>
                      <span class="text-2xl text-blue-600"><i class="fas ${card.icon}"></i></span>
                    </button>
                  `)}
                </div>
            </div>
            <div slot="curate" class="container">
                <div class="flex items-center justify-between mb-4">
                    <div class="curate-subtabs">
                        <button
                          class="curate-subtab ${this.curateSubTab === 'main' ? 'active' : ''}"
                          @click=${() => this._handleCurateSubTabChange('main')}
                        >
                          Main
                        </button>
                        <button
                          class="curate-subtab ${this.curateSubTab === 'tag-audit' ? 'active' : ''}"
                          @click=${() => this._handleCurateSubTabChange('tag-audit')}
                        >
                          Tag audit
                        </button>
                    </div>
                </div>
                <div ?hidden=${this.curateSubTab !== 'main'}>
                  ${this._renderCurateFilters({ mode: 'main' })}
                  <div class="curate-layout" style="--curate-thumb-size: ${this.curateThumbSize}px;">
                    <div
                      class="curate-pane"
                      @dragover=${this.curateTagMode ? null : (e) => this._handleCurateDragOver(e, 'left')}
                      @dragleave=${this.curateTagMode ? null : () => this._handleCurateDragLeave('left')}
                      @drop=${this.curateTagMode ? null : (e) => this._handleCurateDrop(e, 'left')}
                    >
                        <div class="curate-pane-header">
                            <div class="curate-pane-header-row">
                                <span>${leftPaneLabel}</span>
                            </div>
                        </div>
                        <div class="curate-pane-body">
                            ${leftImages.length ? html`
                              ${this.curateTagMode ? html`
                                <div class="curate-process-list">
                                  ${leftImages.map((image) => {
                                    const groups = this._getCuratePermatagGroups(image);
                                    return html`
                                    <div class="curate-process-item">
                                      <img
                                        src=${image.thumbnail_url || `/api/v1/images/${image.id}/thumbnail`}
                                        alt=${image.filename}
                                        class="curate-process-thumb"
                                      >
                                      <div class="curate-process-tags">
                                        ${groups.length ? groups.map((group) => html`
                                          <div class="curate-process-tag-group">
                                            <div class="curate-process-tag-label">${group.category.replace(/_/g, ' ')}</div>
                                            <div class="curate-process-tag-list">
                                              ${group.keywords.map((keyword) => html`
                                                <span class="curate-process-tag-chip">
                                                  <span>${keyword}</span>
                                                  <button
                                                    type="button"
                                                    class="curate-process-tag-remove"
                                                    title="Remove tag"
                                                    @click=${(event) => this._removeCuratePermatag(event, image, keyword, group.category)}
                                                  >
                                                    ❌
                                                  </button>
                                                </span>
                                              `)}
                                            </div>
                                          </div>
                                        `) : html`
                                          <span class="text-xs text-gray-400">No permatags</span>
                                        `}
                                      </div>
                                    </div>
                                  `;
                                  })}
                                </div>
                              ` : html`
                                <div class="curate-grid">
                                    ${leftImages.map((image, index) => html`
                                      <div class="curate-thumb-wrapper" @click=${(event) => this._handleCurateImageClick(event, image)}>
                                        <img
                                          src=${image.thumbnail_url || `/api/v1/images/${image.id}/thumbnail`}
                                          alt=${image.filename}
                                          class="curate-thumb ${this.curateDragSelection.includes(image.id) ? 'selected' : ''}"
                                          draggable=${this.curateTagMode ? 'false' : 'true'}
                                          @dragstart=${this.curateTagMode ? null : (event) => this._handleCurateDragStart(event, image)}
                                          @pointerdown=${this.curateTagMode ? null : (event) => this._handleCurateSelectStart(event, index, image.id)}
                                          @pointerenter=${this.curateTagMode ? null : () => this._handleCurateSelectHover(index)}
                                        >
                                        ${image.rating !== null && image.rating !== undefined && image.rating !== '' ? html`
                                          <div class="curate-thumb-rating">Rating ${image.rating}</div>
                                        ` : html``}
                                        <div class="curate-thumb-date">${this._formatCurateDate(image)}</div>
                                        <div class="curate-thumb-info">
                                          ${this._getCurateHoverLines(image).map((line) => html`
                                            <span class="curate-thumb-line">${line}</span>
                                          `)}
                                        </div>
                                      </div>
                                    `)}
                                </div>
                              `}
                            ` : html`
                              <div class="curate-drop">
                                ${this.curateTagMode ? 'No images selected.' : 'No images available.'}
                              </div>
                            `}
                        </div>
                    </div>
                    <div
                      class="curate-pane"
                      @dragover=${this.curateTagMode ? null : (e) => this._handleCurateDragOver(e, 'right')}
                      @dragleave=${this.curateTagMode ? null : () => this._handleCurateDragLeave('right')}
                      @drop=${this.curateTagMode ? null : (e) => this._handleCurateDrop(e, 'right')}
                    >
                        <div class="curate-pane-header">
                            <div class="curate-pane-header-row">
                                <span>${rightPaneLabel}</span>
                                <div class="curate-pane-header-actions">
                                  ${!this.curateTagMode ? html`
                                    <button
                                      class="curate-pane-action"
                                      ?disabled=${!this.curateSelection.length}
                                      @click=${this._handleCurateProcess}
                                    >
                                      Process
                                    </button>
                                  ` : html``}
                                  ${!this.curateTagMode ? html`
                                    <button
                                      class="curate-pane-action secondary"
                                      ?disabled=${!this.curateSelection.length}
                                      @click=${this._handleCurateClearSelection}
                                    >
                                      Clear
                                    </button>
                                  ` : html``}
                                </div>
                            </div>
                        </div>
                        ${this.curateTagMode ? html`
                          <div class="curate-pane-body">
                            <div class="curate-tags-panel">
                              <div class="text-xs text-gray-500">
                                ${this.curateSelection.length} selected · apply ${applyCount} · remove ${removeCount}
                              </div>
                              <div class="curate-tags-actions">
                                ${this.curateApplyStatus === 'applying' ? html`
                                  <div class="curate-tags-status">
                                    <span class="curate-spinner"></span>
                                    <span>Applying ${applyCompleted}/${applyTotal}</span>
                                    <span>• Queue ${queueSize}</span>
                                  </div>
                                ` : html``}
                                <button
                                  class="curate-tags-cancel"
                                  ?disabled=${this.curateApplyStatus === 'applying'}
                                  @click=${this._handleCurateClearSelection}
                                >
                                  Continue
                                </button>
                                <button
                                  class="curate-tags-apply"
                                  ?disabled=${!applyCount && !removeCount}
                                  @click=${this._applyCurateTags}
                                >
                                  ${applyLabel}
                                </button>
                              </div>
                              <input
                                type="text"
                                class="curate-tags-search"
                                placeholder="Search tags"
                                .value=${this.curateTagFilter}
                                @input=${this._handleCurateTagFilterChange}
                              >
                              <div class="curate-tags-list">
                                ${tagCategories.length ? tagCategories.map((group) => html`
                                  <div class="curate-tag-category">
                                    <div class="curate-tag-category-title">${group.category}</div>
                                    <div class="curate-tag-options">
                                      ${group.keywords.map((keyword) => {
                                        const key = `${group.category}::${keyword}`;
                                        const choice = tagChoices[key] || '';
                                        return html`
                                          <div class="curate-tag-option">
                                            <span class="curate-tag-option-label">${keyword}</span>
                                            <div class="curate-tag-choice">
                                              <label>
                                                <input
                                                  type="radio"
                                                  name=${`tag-${key}`}
                                                  value="apply"
                                                  ?checked=${choice === 'apply'}
                                                  @change=${() => this._setCurateTagChoice(group.category, keyword, 'apply')}
                                                >
                                                Apply
                                              </label>
                                              <label>
                                                <input
                                                  type="radio"
                                                  name=${`tag-${key}`}
                                                  value="remove"
                                                  ?checked=${choice === 'remove'}
                                                  @change=${() => this._setCurateTagChoice(group.category, keyword, 'remove')}
                                                >
                                                Remove
                                              </label>
                                            </div>
                                          </div>
                                        `;
                                      })}
                                    </div>
                                  </div>
                                `) : html`
                                  <div class="text-xs text-gray-400">No tags available.</div>
                                `}
                              </div>
                            </div>
                          </div>
                        ` : html`
                          ${this.curateSelection.length ? html`
                            <div class="curate-pane-body">
                                <div class="curate-grid">
                                    ${this.curateSelection.map((image) => html`
                                    <div class="curate-thumb-wrapper">
                                      <img
                                        src=${image.thumbnail_url || `/api/v1/images/${image.id}/thumbnail`}
                                        alt=${image.filename}
                                        class="curate-thumb"
                                        draggable="true"
                                        @dragstart=${(event) => this._handleCurateDragStart(event, image)}
                                      >
                                      ${image.rating !== null && image.rating !== undefined && image.rating !== '' ? html`
                                        <div class="curate-thumb-rating">Rating ${image.rating}</div>
                                      ` : html``}
                                      <div class="curate-thumb-date">${this._formatCurateDate(image)}</div>
                                      <div class="curate-thumb-info">
                                        ${this._getCurateHoverLines(image).map((line) => html`
                                          <span class="curate-thumb-line">${line}</span>
                                        `)}
                                      </div>
                                    </div>
                                  `)}
                                </div>
                            </div>
                          ` : html`
                            <div class="curate-drop ${this.curateDragTarget === 'right' ? 'active' : ''}">
                                select and drag photos here. to edit tags
                            </div>
                          `}
                        `}
                    </div>
                </div>
                </div>
                <div ?hidden=${this.curateSubTab !== 'tag-audit'}>
                    ${this._renderCurateFilters({ mode: 'tag-audit' })}
                    <div class="bg-white rounded-lg shadow p-4 mb-4">
                        <div class="flex flex-wrap items-center gap-4">
                            <div>
                                <div class="text-xs font-semibold text-gray-600 mb-1">Audit mode</div>
                                <div class="curate-audit-toggle">
                                    <button
                                      class=${this.curateAuditMode === 'existing' ? 'active' : ''}
                                      @click=${() => this._handleCurateAuditModeChange('existing')}
                                    >
                                      Audit Existing
                                    </button>
                                    <button
                                      class=${this.curateAuditMode === 'missing' ? 'active' : ''}
                                      @click=${() => this._handleCurateAuditModeChange('missing')}
                                    >
                                      Audit Missing
                                    </button>
                                </div>
                            </div>
                            <div>
                                <div class="text-xs font-semibold text-gray-600 mb-1">Limit</div>
                                <input
                                  type="number"
                                  min="1"
                                  class="w-24 px-2 py-1 border rounded-lg text-xs"
                                  .value=${String(this.curateAuditLimit)}
                                  @input=${this._handleCurateAuditLimitChange}
                                >
                            </div>
                            <div class="text-xs text-gray-500">
                                Select one keyword and drag images to ${auditActionVerb} it.
                            </div>
                        </div>
                    </div>
                    <div class="curate-layout" style="--curate-thumb-size: ${this.curateThumbSize}px;">
                        <div class="curate-pane">
                            <div class="curate-pane-header">
                                <div class="curate-pane-header-row">
                                    <span>${auditLeftLabel}</span>
                                    <div class="curate-pane-header-actions">
                                        ${this.curateAuditKeyword ? html`
                                          <span class="text-xs text-gray-400">${auditCountLabel}</span>
                                        ` : html``}
                                        ${this.curateAuditKeyword && !auditLoadAll ? html`
                                          <button
                                            class="curate-pane-action secondary"
                                            ?disabled=${this.curateAuditLoading}
                                            @click=${this._handleCurateAuditLoadAll}
                                          >
                                            ${this.curateAuditLoading ? 'Loading' : 'Load all'}
                                          </button>
                                        ` : html``}
                                    </div>
                                </div>
                            </div>
                            <div class="curate-pane-body">
                                ${auditLeftImages.length ? html`
                                  <div class="curate-grid">
                                    ${auditLeftImages.map((image, index) => html`
                                      <div class="curate-thumb-wrapper" @click=${(event) => this._handleCurateImageClick(event, image)}>
                                        <img
                                          src=${image.thumbnail_url || `/api/v1/images/${image.id}/thumbnail`}
                                          alt=${image.filename}
                                          class="curate-thumb ${this.curateAuditDragSelection.includes(image.id) ? 'selected' : ''}"
                                          draggable="true"
                                          @dragstart=${(event) => this._handleCurateAuditDragStart(event, image)}
                                          @pointerdown=${(event) => this._handleCurateAuditSelectStart(event, index, image.id)}
                                          @pointerenter=${() => this._handleCurateAuditSelectHover(index)}
                                        >
                                        ${image.rating !== null && image.rating !== undefined && image.rating !== '' ? html`
                                          <div class="curate-thumb-rating">Rating ${image.rating}</div>
                                        ` : html``}
                                        <div class="curate-thumb-date">${this._formatCurateDate(image)}</div>
                                        <div class="curate-thumb-info">
                                          ${this._getCurateHoverLines(image).map((line) => html`
                                            <span class="curate-thumb-line">${line}</span>
                                          `)}
                                        </div>
                                      </div>
                                    `)}
                                  </div>
                                ` : html`
                                  <div class="curate-drop">
                                    ${this.curateAuditKeyword ? 'No images available.' : 'Choose a keyword to start.'}
                                  </div>
                                `}
                                ${this.curateAuditKeyword ? html`
                                  <div class="flex items-center justify-between text-xs text-gray-500 mt-3">
                                    <span>${auditCountLabel}</span>
                                    ${auditLoadAll ? html`` : html`
                                      <div class="flex items-center gap-2">
                                        <button
                                          class="curate-pane-action secondary"
                                          ?disabled=${!auditHasPrev || this.curateAuditLoading}
                                          @click=${this._handleCurateAuditPagePrev}
                                        >
                                          Prev
                                        </button>
                                        <button
                                          class="curate-pane-action secondary"
                                          ?disabled=${!auditHasMore || this.curateAuditLoading}
                                          @click=${this._handleCurateAuditPageNext}
                                        >
                                          Next
                                        </button>
                                      </div>
                                    `}
                                  </div>
                                ` : html``}
                            </div>
                        </div>
                        <div
                          class="curate-pane"
                          @dragover=${(e) => this._handleCurateAuditDragOver(e)}
                          @dragleave=${() => this._handleCurateAuditDragLeave()}
                          @drop=${(e) => this._handleCurateAuditDrop(e)}
                        >
                            <div class="curate-pane-header">
                                <div class="curate-pane-header-row">
                                    <span>${auditRightLabel}</span>
                                    <div class="curate-pane-header-actions">
                                        <button
                                          class="curate-pane-action secondary"
                                          ?disabled=${!this.curateAuditSelection.length}
                                          @click=${this._handleCurateAuditClearSelection}
                                        >
                                          Clear
                                        </button>
                                    </div>
                                </div>
                            </div>
                            ${this.curateAuditSelection.length ? html`
                              <div class="curate-pane-body">
                                <div class="curate-grid">
                                  ${this.curateAuditSelection.map((image) => html`
                                    <div class="curate-thumb-wrapper">
                                      <img
                                        src=${image.thumbnail_url || `/api/v1/images/${image.id}/thumbnail`}
                                        alt=${image.filename}
                                        class="curate-thumb"
                                      >
                                      ${image.rating !== null && image.rating !== undefined && image.rating !== '' ? html`
                                        <div class="curate-thumb-rating">Rating ${image.rating}</div>
                                      ` : html``}
                                      <div class="curate-thumb-date">${this._formatCurateDate(image)}</div>
                                      <div class="curate-thumb-info">
                                        ${this._getCurateHoverLines(image).map((line) => html`
                                          <span class="curate-thumb-line">${line}</span>
                                        `)}
                                      </div>
                                    </div>
                                  `)}
                                </div>
                              </div>
                            ` : html`
                              <div class="curate-drop ${this.curateAuditDragTarget === 'right' ? 'active' : ''}">
                                ${auditDropLabel}
                              </div>
                            `}
                        </div>
                    </div>
                </div>
            </div>
            <div slot="search" class="container">
                <div class="home-top-row">
                    <div class="home-panel home-panel-left border border-gray-200 rounded-lg p-3 bg-white shadow">
                        <div class="text-xs text-gray-500 uppercase font-semibold mb-2">Search</div>
                        <filter-controls
                          .tenant=${this.tenant}
                          .lists=${this.lists}
                          @filter-change=${this._handleFilterChange}
                        ></filter-controls>
                    </div>
                    <div class="home-panel home-panel-right border border-gray-200 rounded-lg p-3 bg-white shadow">
                        <div class="text-xs text-gray-500 uppercase font-semibold mb-2">Tag Counts</div>
                        <div class="flex items-center gap-2 mb-3 text-xs font-semibold text-gray-600">
                          ${[
                            { key: 'permatags', label: 'Permatags' },
                            { key: 'keyword_model', label: 'Keyword-Model' },
                            { key: 'zero_shot', label: 'Zero-Shot' },
                          ].map((tab) => html`
                            <button
                              class="px-2 py-1 rounded border ${this.activeTagSource === tab.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}"
                              @click=${() => this.activeTagSource = tab.key}
                            >
                              ${tab.label}
                            </button>
                          `)}
                        </div>
                        ${categoryCards.length ? html`
                          <div class="tag-carousel">
                            ${categoryCards.map((item) => {
                              const label = item.category.replace(/_/g, ' ');
                              return html`
                                <div class="tag-card border border-gray-200 rounded-lg p-2">
                                  <div class="text-xs font-semibold text-gray-700 truncate" title=${label}>${label}</div>
                                  <div class="tag-card-body mt-2 space-y-2">
                                    ${item.keywordRows.map((kw) => {
                                      const width = item.maxCount
                                        ? Math.round((kw.count / item.maxCount) * 100)
                                        : 0;
                                      return html`
                                        <div>
                                          <div class="flex items-center justify-between gap-2 text-xs text-gray-600">
                                            <span class="truncate" title=${kw.keyword}>${kw.keyword}</span>
                                            <span class="text-gray-500">${this._formatStatNumber(kw.count)}</span>
                                          </div>
                                          <div class="tag-bar mt-1">
                                            <div class="tag-bar-fill" style="width: ${width}%"></div>
                                          </div>
                                        </div>
                                      `;
                                    })}
                                  </div>
                                </div>
                              `;
                            })}
                          </div>
                        ` : html`
                          <div class="text-xs text-gray-400">No tag data yet.</div>
                        `}
                    </div>
                </div>
                <div class="flex items-center gap-3 mb-4">
                    <div class="text-sm text-gray-700 font-semibold">
                        Active List: ${activeName}
                    </div>
                    <div class="ml-4">
                        <select class="px-3 py-2 border rounded-lg" .value=${activeId} @change=${this._handleActiveListChange}>
                        <option value="">None</option>
                        ${this.lists.map((list) => html`
                            <option value=${String(list.id)} ?selected=${String(list.id) === activeId}>${list.title}</option>
                        `)}
                        </select>
                    </div>
                    <div class="ml-4 flex items-center gap-2 text-xs text-gray-600">
                        <span>Display:</span>
                        <button
                          class="px-2 py-1 border rounded ${this.displayMode === 'grid' ? 'bg-gray-200' : 'bg-white'}"
                          @click=${() => this.displayMode = 'grid'}
                          title="Grid view"
                        >
                          ⬛
                        </button>
                        <button
                          class="px-2 py-1 border rounded ${this.displayMode === 'list' ? 'bg-gray-200' : 'bg-white'}"
                          @click=${() => this.displayMode = 'list'}
                          title="List view"
                        >
                          ☰
                        </button>
                    </div>
                <div class="ml-auto text-xs text-gray-500"></div>
                </div>
                <image-gallery
                    .tenant=${this.tenant}
                    .filters=${this.filters}
                    .activeListName=${this.activeListName}
                    .activeListItemIds=${this.activeListItemIds}
                    .keywords=${this.keywords}
                    .displayMode=${this.displayMode}
                    @image-selected=${this._handleImageSelected}
                    @list-item-added=${this._handleListItemAdded}
                    @image-retagged=${this._handleImageRetagged}
                    @image-rating-updated=${this._handleImageRatingUpdated}
                ></image-gallery>
            </div>
            <div slot="lists" class="container p-4">
                <list-editor .tenant=${this.tenant} @lists-updated=${this._handleListsUpdated}></list-editor>
            </div>
            <div slot="tagging" class="container p-4">
                <tagging-admin .tenant=${this.tenant} @open-upload-modal=${this._handleOpenUploadModal}></tagging-admin>
            </div>
            <div slot="ml-training" class="container p-4">
                <ml-training .tenant=${this.tenant}></ml-training>
            </div>
            <div slot="queue" class="container p-4">
                <div class="border border-gray-200 rounded-lg p-4 bg-white text-sm text-gray-600 space-y-3">
                    <div class="font-semibold text-gray-700">Work Queue</div>
                    <div class="text-xs text-gray-500">
                        ${this.queueState.inProgressCount || 0} active · ${this.queueState.queuedCount || 0} queued · ${this.queueState.failedCount || 0} failed
                    </div>
                    ${this.queueState.inProgress?.length ? html`
                      <div>
                        <div class="font-semibold text-gray-600 mb-1">In Progress</div>
                        ${this.queueState.inProgress.map((item) => html`
                          <div>${this._formatQueueItem(item)}</div>
                        `)}
                      </div>
                    ` : html``}
                    ${this.queueState.queue?.length ? html`
                      <div>
                        <div class="font-semibold text-gray-600 mb-1">Queued</div>
                        ${this.queueState.queue.map((item) => html`
                          <div>${this._formatQueueItem(item)}</div>
                        `)}
                      </div>
                    ` : html``}
                    ${this.queueState.failed?.length ? html`
                      <div>
                        <div class="font-semibold text-red-600 mb-1">Failed</div>
                        ${this.queueState.failed.map((item) => html`
                          <div class="flex items-center justify-between">
                            <span>${this._formatQueueItem(item)}</span>
                            <button
                              class="text-xs text-blue-600 hover:text-blue-700"
                              @click=${() => retryFailedCommand(item.id)}
                            >
                              Retry
                            </button>
                          </div>
                        `)}
                      </div>
                    ` : html`<div class="text-gray-400">No failed commands.</div>`}
                </div>
            </div>
        </tab-container>

        ${this.selectedImage ? html`
          <image-modal
            .image=${this.selectedImage}
            .tenant=${this.tenant}
            .active=${true}
            @close=${this._handleCloseModal}
            @image-retagged=${this._handleImageRetagged}
          ></image-modal>
        ` : ''}
        ${this.showUploadModal ? html`<upload-modal .tenant=${this.tenant} @close=${this._handleCloseUploadModal} @upload-complete=${this._handleUploadComplete} active></upload-modal>` : ''}
        ${this.curateEditorImage ? html`
          <image-editor
            .tenant=${this.tenant}
            .image=${this.curateEditorImage}
            .open=${this.curateEditorOpen}
            @close=${this._handleCurateEditorClose}
          ></image-editor>
        ` : ''}
    `;
  }

  async fetchLists() {
      if (!this.tenant) return;
      try {
          const results = await Promise.allSettled([
              getLists(this.tenant),
              getActiveList(this.tenant),
          ]);
          const listsResult = results[0];
          const activeResult = results[1];
          if (listsResult.status === 'fulfilled') {
              this.lists = listsResult.value;
          } else {
              console.error('Error fetching lists:', listsResult.reason);
              this.lists = [];
          }
          if (activeResult.status === 'fulfilled') {
              this.activeListId = activeResult.value?.id ? String(activeResult.value.id) : '';
          } else {
              console.error('Error fetching active list:', activeResult.reason);
              this.activeListId = '';
          }
          if (!this.activeListId && this.lists.length > 0) {
              const activeList = this.lists.find((list) => list.is_active);
              this.activeListId = activeList ? String(activeList.id) : '';
          }
          const activeList = this.lists.find((list) => String(list.id) === this.activeListId);
          this.activeListName = activeList ? activeList.title : '';
          await this.fetchActiveListItems();
          this._listsLoaded = true;
      } catch (error) {
          console.error('Error fetching lists:', error);
          this._listsLoaded = false;
      }
  }

  async fetchKeywords() {
      if (!this.tenant) return;
      try {
          const keywordsByCategory = await getKeywords(this.tenant);
          const flat = [];
          Object.entries(keywordsByCategory || {}).forEach(([category, list]) => {
              list.forEach((kw) => {
                  flat.push({ keyword: kw.keyword, category, count: kw.count || 0 });
              });
          });
          this.keywords = flat.sort((a, b) => a.keyword.localeCompare(b.keyword));
      } catch (error) {
          console.error('Error fetching keywords:', error);
          this.keywords = [];
      }
  }

  async fetchActiveListItems() {
      if (!this.activeListId) {
          this.activeListItemIds = new Set();
          return;
      }
      try {
          const items = await getListItems(this.tenant, this.activeListId, { idsOnly: true });
          this.activeListItemIds = new Set(items.map((item) => item.photo_id));
      } catch (error) {
          console.error('Error fetching active list items:', error);
          this.activeListItemIds = new Set();
      }
  }

  async fetchStats() {
      if (!this.tenant) return;
      const results = await Promise.allSettled([
          getImageStats(this.tenant),
          getMlTrainingStats(this.tenant),
          getTagStats(this.tenant),
      ]);
      const imageResult = results[0];
      const mlResult = results[1];
      const tagResult = results[2];
      if (imageResult.status === 'fulfilled') {
          this.imageStats = imageResult.value;
      } else {
          console.error('Error fetching image stats:', imageResult.reason);
          this.imageStats = null;
      }
      if (mlResult.status === 'fulfilled') {
          this.mlTrainingStats = mlResult.value;
      } else {
          console.error('Error fetching ML training stats:', mlResult.reason);
          this.mlTrainingStats = null;
      }
      if (tagResult.status === 'fulfilled') {
          this.tagStatsBySource = tagResult.value?.sources || {};
      } else {
          console.error('Error fetching tag stats:', tagResult.reason);
          this.tagStatsBySource = {};
      }
  }

  async _handleActiveListChange(e) {
      const selectedId = e.target.value;
      const previousActiveId = this.activeListId;
      this.activeListId = selectedId;
      const selectedList = this.lists.find((list) => String(list.id) === selectedId);
      this.activeListName = selectedList ? selectedList.title : '';
      this.activeListItemIds = new Set();
      try {
          if (!selectedId && previousActiveId) {
              await updateList(this.tenant, { id: previousActiveId, is_active: false });
          } else if (selectedId) {
              await updateList(this.tenant, { id: selectedId, is_active: true });
          }
          await this.fetchLists();
      } catch (error) {
          console.error('Error updating active list:', error);
      }
  }

  async _handleListItemAdded() {
      await this.fetchActiveListItems();
  }

  async _handleListsUpdated() {
      await this.fetchLists();
  }

  async _handleImageRetagged() {
      const gallery = this.shadowRoot.querySelector('image-gallery');
      if (gallery && typeof gallery.fetchImages === 'function') {
          await gallery.fetchImages();
      }
  }

  async _handleImageRatingUpdated(e) {
      const gallery = this.shadowRoot.querySelector('image-gallery');
      if (gallery && typeof gallery.applyRatingUpdate === 'function') {
          const hideZero = Boolean(this.filters?.hideZeroRating);
          gallery.applyRatingUpdate(e.detail.imageId, e.detail.rating, hideZero);
          return;
      }
      if (gallery && typeof gallery.fetchImages === 'function') {
          await gallery.fetchImages();
      }
  }

  _handleSyncProgress(e) {
      console.log(`Sync progress: ${e.detail.count} images processed`);
      // Refresh gallery on each sync progress to show new images
      this._refreshGallery();
  }

  _handleSyncComplete(e) {
      console.log(`Sync complete: ${e.detail.count} total images processed`);
      this._refreshGallery();
      this.fetchStats();
  }

  _handleSyncError(e) {
      console.error('Sync error:', e.detail.error);
      // Could show a toast/notification here
  }

  _refreshGallery() {
      const tabContainer = this.shadowRoot.querySelector('tab-container');
      if (tabContainer) {
          const gallery = tabContainer.querySelector('image-gallery');
          if (gallery && typeof gallery.fetchImages === 'function') {
              gallery.fetchImages();
          }
      }
  }

  _scheduleGalleryRefresh() {
      if (this._queueRefreshTimer) {
          clearTimeout(this._queueRefreshTimer);
      }
      this._queueRefreshTimer = setTimeout(() => {
          this._queueRefreshTimer = null;
          this._refreshGallery();
      }, 400);
  }

  _scheduleStatsRefresh() {
      if (this._statsRefreshTimer) {
          clearTimeout(this._statsRefreshTimer);
      }
      this._statsRefreshTimer = setTimeout(() => {
          this._statsRefreshTimer = null;
          this.fetchStats();
      }, 400);
  }

  _formatStatNumber(value) {
      if (value === null || value === undefined) return '--';
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) return '--';
      return numericValue.toLocaleString();
  }

  _formatDateTime(value) {
      if (!value) return 'Unknown';
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return 'Unknown';
      return date.toLocaleString();
  }

  _formatRating(value) {
      if (value === null || value === undefined || value === '') {
          return 'Unrated';
      }
      return String(value);
  }

  _formatDropboxPath(path) {
      if (!path) return 'Unknown';
      return path.replace(/_/g, '_\u200b');
  }

  _formatQueueItem(item) {
      if (!item) return '';
      if (item.description) return item.description;
      if (item.imageId) return `${item.type} · image ${item.imageId}`;
      return item.type || 'queue item';
  }

  _formatCurateDate(image) {
      const value = image?.capture_timestamp || image?.modified_time;
      if (!value) return '';
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      const pad = (num) => String(num).padStart(2, '0');
      const year = date.getFullYear();
      const month = pad(date.getMonth() + 1);
      const day = pad(date.getDate());
      const hours = pad(date.getHours());
      const minutes = pad(date.getMinutes());
      const seconds = pad(date.getSeconds());
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  _getCurateHoverLines(image) {
      const lines = [];
      const path = this._formatDropboxPath(image?.dropbox_path);
      if (path && path !== 'Unknown') {
          lines.push(path);
      } else {
          lines.push('Unknown');
      }
      const permatags = Array.isArray(image?.permatags) ? image.permatags : [];
      const positive = permatags.filter((tag) => tag.signum === 1);
      if (!positive.length) {
          return lines;
      }
      const byCategory = {};
      positive.forEach((tag) => {
          const category = tag.category || 'Uncategorized';
          if (!byCategory[category]) {
              byCategory[category] = [];
          }
          byCategory[category].push(tag.keyword);
      });
      Object.entries(byCategory)
          .map(([category, keywords]) => ({
              category,
              keywords: keywords.filter(Boolean).sort((a, b) => a.localeCompare(b)),
          }))
          .sort((a, b) => a.category.localeCompare(b.category))
          .forEach((group) => {
              if (!group.keywords.length) return;
              const label = group.category.replace(/_/g, ' ');
              lines.push(`${label}: ${group.keywords.join(', ')}`);
          });
      return lines;
  }

  _getCuratePermatagGroups(image) {
      const permatags = Array.isArray(image?.permatags) ? image.permatags : [];
      const positive = permatags.filter((tag) => tag.signum === 1 && tag.keyword);
      if (!positive.length) {
          return [];
      }
      const byCategory = {};
      positive.forEach((tag) => {
          const category = tag.category || 'Uncategorized';
          if (!byCategory[category]) {
              byCategory[category] = [];
          }
          byCategory[category].push(tag.keyword);
      });
      return Object.entries(byCategory)
          .map(([category, keywords]) => ({
              category,
              keywords: keywords.filter(Boolean).sort((a, b) => a.localeCompare(b)),
          }))
          .sort((a, b) => a.category.localeCompare(b.category));
  }

  _removeCuratePermatag(event, image, keyword, category) {
      event.stopPropagation();
      enqueueCommand({
          type: 'add-negative-permatag',
          tenantId: this.tenant,
          imageId: image.id,
          keyword,
          category,
      });
      this._updateCuratePermatagRemoval(image.id, keyword, category);
  }

  _updateCuratePermatagRemoval(imageId, keyword, category) {
      const matches = (tag) => tag.keyword === keyword && (tag.category || 'Uncategorized') === (category || 'Uncategorized');
      const removePositive = (image) => {
          const permatags = Array.isArray(image.permatags) ? image.permatags : [];
          const next = permatags.filter((tag) => !(tag.signum === 1 && matches(tag)));
          return { ...image, permatags: next };
      };
      this.curateSelection = this.curateSelection.map((image) => (
          image.id === imageId ? removePositive(image) : image
      ));
      this.curateImages = this.curateImages.map((image) => (
          image.id === imageId ? removePositive(image) : image
      ));
  }

  _mergePermatags(existing, additions) {
      const map = new Map();
      (existing || []).forEach((tag) => {
          if (!tag?.keyword) return;
          const key = `${tag.category || 'Uncategorized'}::${tag.keyword}`;
          map.set(key, { ...tag });
      });
      (additions || []).forEach((tag) => {
          if (!tag?.keyword) return;
          const category = tag.category || 'Uncategorized';
          const key = `${category}::${tag.keyword}`;
          map.set(key, { keyword: tag.keyword, category, signum: 1 });
      });
      return Array.from(map.values());
  }

  _splitCurateTagChoices() {
      const choices = this.curateTagChoices || {};
      const applyTags = [];
      const removeTags = [];
      Object.entries(choices).forEach(([key, choice]) => {
          const [category, keyword] = key.split('::');
          if (!keyword) return;
          if (choice === 'apply') {
              applyTags.push({ category, keyword });
          } else if (choice === 'remove') {
              removeTags.push({ category, keyword });
          }
      });
      return { applyTags, removeTags };
  }

  _updateCuratePermatagRemovals(imageIds, tags) {
      if (!imageIds?.length || !tags?.length) return;
      const targetIds = new Set(imageIds);
      const removeSet = new Set(tags.map((tag) => `${tag.category || 'Uncategorized'}::${tag.keyword}`));
      const prune = (image) => {
          const permatags = Array.isArray(image.permatags) ? image.permatags : [];
          const next = permatags.filter((tag) => {
              if (tag.signum !== 1) return true;
              const key = `${tag.category || 'Uncategorized'}::${tag.keyword}`;
              return !removeSet.has(key);
          });
          return { ...image, permatags: next };
      };
      this.curateSelection = this.curateSelection.map((image) => (
          targetIds.has(image.id) ? prune(image) : image
      ));
      this.curateImages = this.curateImages.map((image) => (
          targetIds.has(image.id) ? prune(image) : image
      ));
  }

  _updateCuratePermatags(imageIds, tags) {
      if (!imageIds?.length || !tags?.length) return;
      const targetIds = new Set(imageIds);
      this.curateSelection = this.curateSelection.map((image) => {
          if (!targetIds.has(image.id)) return image;
          const permatags = this._mergePermatags(image.permatags, tags);
          return { ...image, permatags };
      });
      this.curateImages = this.curateImages.map((image) => {
          if (!targetIds.has(image.id)) return image;
          const permatags = this._mergePermatags(image.permatags, tags);
          return { ...image, permatags };
      });
  }

  firstUpdated() {
      this._ensureHomePanelSync();
  }

  updated(changedProperties) {
      this._ensureHomePanelSync();
      if (changedProperties.has('activeTab')) {
          this._maybeFetchListsForTab(this.activeTab);
      }
  }

  _maybeFetchListsForTab(tab) {
      if (!tab) return;
      if (this._listsLoaded) return;
      if (tab === 'search' || tab === 'lists' || tab === 'curate') {
          this.fetchLists();
      }
  }

  _ensureHomePanelSync() {
      const leftPanel = this.shadowRoot?.querySelector('.home-panel-left');
      const rightPanel = this.shadowRoot?.querySelector('.home-panel-right');
      if (!leftPanel || !rightPanel) return;
      if (this._homePanelLeftEl !== leftPanel || this._homePanelRightEl !== rightPanel) {
          if (this._homePanelObserver) {
              this._homePanelObserver.disconnect();
          }
          this._homePanelLeftEl = leftPanel;
          this._homePanelRightEl = rightPanel;
          this._homePanelObserver = new ResizeObserver(() => {
              this._syncHomePanelHeights();
          });
          this._homePanelObserver.observe(leftPanel);
      }
      this._syncHomePanelHeights();
  }

  _syncHomePanelHeights() {
      if (!this._homePanelLeftEl || !this._homePanelRightEl) return;
      const isWide = window.matchMedia('(min-width: 1024px)').matches;
      if (!isWide) {
          this._homePanelRightEl.style.height = '';
          return;
      }
      const height = this._homePanelLeftEl.getBoundingClientRect().height;
      this._homePanelRightEl.style.height = height ? `${height}px` : '';
  }
}

customElements.define('photocat-app', PhotoCatApp);
