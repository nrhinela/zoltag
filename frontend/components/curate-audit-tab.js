import { LitElement, html } from 'lit';
import { enqueueCommand } from '../services/command-queue.js';
import { getDropboxFolders } from '../services/api.js';
import { createSelectionHandlers } from './shared/selection-handlers.js';
import { renderResultsPagination } from './shared/pagination-controls.js';
import { renderSelectableImageGrid } from './shared/selectable-image-grid.js';
import { getKeywordsByCategory, getKeywordsByCategoryFromList } from './shared/keyword-utils.js';
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
import './shared/widgets/filter-chips.js';

/**
 * Curate Audit Tab Component
 *
 * Tag auditing interface with two modes:
 * - Verify Existing Tags: Review images already tagged with a keyword
 * - Find Missing Tags: Discover images that should have the keyword
 *
 * Features:
 * - Mode toggle (existing vs missing)
 * - AI-powered suggestions (zero-shot and trained models)
 * - Image grid with rating and permatag overlays
 * - Multi-select via long-press and drag
 * - Hotspots for quick rating/tagging
 * - Pagination controls
 *
 * @fires audit-mode-changed - When audit mode changes (existing/missing)
 * @fires audit-ai-enabled-changed - When AI assistance is toggled
 * @fires audit-ai-model-changed - When AI model selection changes
 * @fires pagination-changed - When pagination changes
 * @fires image-clicked - When image is clicked
 * @fires selection-changed - When drag selection changes
 * @fires hotspot-changed - When hotspot configuration changes
 * @fires rating-drop - When images dropped on rating zone
 * @fires curate-audit-filters-changed - When filter chips change
 */
export class CurateAuditTab extends LitElement {
  // Use Light DOM to access Tailwind CSS classes
  createRenderRoot() {
    return this;
  }

  static properties = {
    tenant: { type: String },
    keyword: { type: String },
    mode: { type: String }, // 'existing' or 'missing'
    aiEnabled: { type: Boolean },
    aiModel: { type: String }, // 'siglip' or 'trained'
    images: { type: Array },
    thumbSize: { type: Number },
    keywordCategory: { type: String },
    keywords: { type: Array },
    minRating: { type: Object },
    dropboxPathPrefix: { type: String },
    filenameQuery: { type: String },
    dropboxFolders: { type: Array },
    offset: { type: Number },
    limit: { type: Number },
    total: { type: Number },
    loading: { type: Boolean },
    loadAll: { type: Boolean },
    dragSelection: { type: Array },
    dragSelecting: { type: Boolean },
    dragStartIndex: { type: Number },
    dragEndIndex: { type: Number },
    renderCurateRatingWidget: { type: Object },
    renderCurateRatingStatic: { type: Object },
    renderCurateAiMLScore: { type: Object },
    renderCuratePermatagSummary: { type: Object },
    formatCurateDate: { type: Object },
    tagStatsBySource: { type: Object },
    activeCurateTagSource: { type: String },
    targets: { type: Array }, // Hotspot targets
    ratingEnabled: { type: Boolean },
    ratingCount: { type: Number },

    // Internal state properties
    _auditPressActive: { type: Boolean, state: true },
    _auditPressStart: { type: Object, state: true },
    _auditPressIndex: { type: Number, state: true },
    _auditPressImageId: { type: Number, state: true },
    _auditPressTimer: { type: Number, state: true },
    _auditLongPressTriggered: { type: Boolean, state: true },
    _auditFlashSelectionIds: { type: Object, state: true },
    _auditHotspotDragTarget: { type: String, state: true },
    _auditRatingDragTarget: { type: Boolean, state: true },
    _auditLeftOrder: { type: Array, state: true },
    _auditSuppressClick: { type: Boolean, state: true },
    auditResultsView: { type: String, state: true },
    _auditHotspotHistoryBatches: { type: Array, state: true },
    _auditHotspotHistoryVisibleBatches: { type: Number, state: true },
  };

  constructor() {
    super();
    this.tenant = '';
    this.keyword = '';
    this.mode = 'existing';
    this.aiEnabled = false;
    this.aiModel = 'siglip';
    this.images = [];
    this.thumbSize = 120;
    this.keywordCategory = '';
    this.keywords = [];
    this.minRating = null;
    this.dropboxPathPrefix = '';
    this.filenameQuery = '';
    this.dropboxFolders = [];
    this.offset = 0;
    this.limit = 100;
    this.total = 0;
    this.loading = false;
    this.loadAll = false;
    this.dragSelection = [];
    this.dragSelecting = false;
    this.dragStartIndex = null;
    this.dragEndIndex = null;
    this.renderCurateRatingWidget = null;
    this.renderCurateRatingStatic = null;
    this.renderCurateAiMLScore = null;
    this.renderCuratePermatagSummary = null;
    this.formatCurateDate = null;
    this.tagStatsBySource = {};
    this.activeCurateTagSource = '';
    this.targets = [{ id: '1', type: 'keyword', count: 0 }];
    this.ratingEnabled = false;
    this.ratingCount = 0;
    this._auditDropboxFetchTimer = null;
    this._auditDropboxQuery = '';

    // Internal state
    this._auditPressActive = false;
    this._auditPressStart = null;
    this._auditPressIndex = null;
    this._auditPressImageId = null;
    this._auditPressTimer = null;
    this._auditLongPressTriggered = false;
    this._auditFlashSelectionIds = new Set();
    this._auditHotspotDragTarget = null;
    this._auditRatingDragTarget = false;
    this._auditLeftOrder = [];
    this._auditHistoryGroupKey = null;
    this._auditSuppressClick = false;
    this.auditResultsView = 'results';
    this._auditHotspotHistoryBatches = [];
    this._auditHotspotHistoryVisibleBatches = 1;

    // Configure selection handlers
    this._auditSelectionHandlers = createSelectionHandlers(this, {
      selectionProperty: 'dragSelection',
      selectingProperty: 'dragSelecting',
      startIndexProperty: 'dragStartIndex',
      endIndexProperty: 'dragEndIndex',
      pressActiveProperty: '_auditPressActive',
      pressStartProperty: '_auditPressStart',
      pressIndexProperty: '_auditPressIndex',
      pressImageIdProperty: '_auditPressImageId',
      pressTimerProperty: '_auditPressTimer',
      longPressTriggeredProperty: '_auditLongPressTriggered',
      getOrder: () => this._auditLeftOrder || [],
      flashSelection: (imageId) => this._flashAuditSelection(imageId),
    });

    // Wrap updateSelection and clearSelection to emit events
    const originalUpdateSelection = this._auditSelectionHandlers.updateSelection.bind(this._auditSelectionHandlers);
    const originalClearSelection = this._auditSelectionHandlers.clearSelection.bind(this._auditSelectionHandlers);

    this._auditSelectionHandlers.updateSelection = () => {
      const before = Array.isArray(this.dragSelection) ? [...this.dragSelection] : [];
      originalUpdateSelection();
      const after = Array.isArray(this.dragSelection) ? [...this.dragSelection] : [];
      if (before.length !== after.length || before.some((id, idx) => id !== after[idx])) {
        this._emitSelectionChanged(after);
      }
    };

    this._auditSelectionHandlers.clearSelection = () => {
      const before = Array.isArray(this.dragSelection) ? [...this.dragSelection] : [];
      originalClearSelection();
      if (before.length) {
        this._emitSelectionChanged([]);
      }
    };

    // Bind selection end handler for window events
    this._handleAuditSelectionEnd = () => {
      if (this.dragSelecting) {
        this.dragSelecting = false;
        this.dragStartIndex = null;
        this.dragEndIndex = null;
      }
      const hadLongPress = this._auditLongPressTriggered;
      this._auditHistoryGroupKey = null;
      this._auditSelectionHandlers.cancelPressState();
      if (hadLongPress) {
        this._auditSuppressClick = true;
      }
    };
  }

  connectedCallback() {
    super.connectedCallback();
    this._restoreAuditHistorySessionState();
    // Listen for pointer/key release to end selection
    window.addEventListener('pointerup', this._handleAuditSelectionEnd);
    window.addEventListener('keyup', this._handleAuditSelectionEnd);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Remove window event listeners
    window.removeEventListener('pointerup', this._handleAuditSelectionEnd);
    window.removeEventListener('keyup', this._handleAuditSelectionEnd);

    // Cancel any active press timers
    if (this._auditPressTimer) {
      clearTimeout(this._auditPressTimer);
    }
    if (this._auditDropboxFetchTimer) {
      clearTimeout(this._auditDropboxFetchTimer);
    }
  }

  updated(changedProperties) {
    if (changedProperties.has('tenant')) {
      this._restoreAuditHistorySessionState();
    }
    if (
      changedProperties.has('tenant')
      || changedProperties.has('auditResultsView')
      || changedProperties.has('_auditHotspotHistoryBatches')
      || changedProperties.has('_auditHotspotHistoryVisibleBatches')
    ) {
      this._persistAuditHistorySessionState();
    }
    if (changedProperties.has('tenant')) {
      this.dragSelection = [];
    }
    if (!changedProperties.has('targets')
      && !changedProperties.has('keywords')
      && !changedProperties.has('tagStatsBySource')
      && !changedProperties.has('activeCurateTagSource')) {
      return;
    }
    const primary = (this.targets || [])[0];
    if (!primary || primary.type === 'rating') {
      return;
    }
    const keyword = primary.keyword;
    if (!keyword) {
      return;
    }
    const resolvedCategory = this._resolveCategoryForKeyword(keyword);
    if (!resolvedCategory) {
      return;
    }
    const currentCategory = primary.category || '';
    if (resolvedCategory === currentCategory) {
      return;
    }
    const value = `${encodeURIComponent(resolvedCategory)}::${encodeURIComponent(keyword)}`;
    this.dispatchEvent(new CustomEvent('hotspot-changed', {
      detail: { type: 'keyword-change', targetId: primary.id, value },
      bubbles: true,
      composed: true
    }));
  }

  // ========================================
  // Selection Handlers
  // ========================================

  _handleAuditPointerDownWithOrder(event, index, imageId, order) {
    this._auditLeftOrder = order;
    this._auditSelectionHandlers.handlePointerDown(event, index, imageId);
  }

  _handleAuditPointerMove(event) {
    this._auditSelectionHandlers.handlePointerMove(event);
  }

  _handleAuditSelectHoverWithOrder(index, order) {
    this._auditLeftOrder = order;
    this._auditSelectionHandlers.handleSelectHover(index);
  }

  _handleAuditHistoryPointerDown(event, index, imageId, order, groupKey) {
    this._auditHistoryGroupKey = groupKey;
    this._handleAuditPointerDownWithOrder(event, index, imageId, order);
  }

  _handleAuditHistorySelectHover(index, order, groupKey) {
    if (this._auditHistoryGroupKey !== groupKey) {
      return;
    }
    this._handleAuditSelectHoverWithOrder(index, order);
  }

  _handleAuditImageClick(event, image, imageSet) {
    // Don't open modal if we're in selection mode or if long-press was triggered
    if (this.dragSelecting || this._auditLongPressTriggered) {
      event.preventDefault();
      return;
    }
    const order = (imageSet || this.images || [])
      .map((entry) => entry?.id)
      .filter((id) => id !== null && id !== undefined);
    const clickedId = image?.id;
    const index = order.findIndex((id) => String(id) === String(clickedId));
    const selectionResult = this._auditSelectionHandlers.handleClickSelection(event, {
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
    if (this._auditSuppressClick) {
      this._auditSuppressClick = false;
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

  _flashAuditSelection(imageId) {
    this._auditFlashSelectionIds = new Set([...this._auditFlashSelectionIds, imageId]);
    setTimeout(() => {
      const newSet = new Set(this._auditFlashSelectionIds);
      newSet.delete(imageId);
      this._auditFlashSelectionIds = newSet;
    }, 300);
  }

  // ========================================
  // Mode & AI Controls
  // ========================================

  _handleModeChange(newMode) {
    this.dispatchEvent(new CustomEvent('audit-mode-changed', {
      detail: { mode: newMode },
      bubbles: true,
      composed: true
    }));
  }

  _handleAiEnabledChange(event) {
    const enabled = event.target.checked;
    this.dispatchEvent(new CustomEvent('audit-ai-enabled-changed', {
      detail: { enabled },
      bubbles: true,
      composed: true
    }));
  }

  _handleAiModelChange(model) {
    this.dispatchEvent(new CustomEvent('audit-ai-model-changed', {
      detail: { model },
      bubbles: true,
      composed: true
    }));
  }

  // ========================================
  // Pagination Handlers
  // ========================================

  _handlePagePrev = () => {
    const newOffset = Math.max(0, this.offset - this.limit);
    this.dispatchEvent(new CustomEvent('pagination-changed', {
      detail: { offset: newOffset, limit: this.limit },
      bubbles: true,
      composed: true
    }));
  };

  _handlePageNext = () => {
    const newOffset = this.offset + this.limit;
    this.dispatchEvent(new CustomEvent('pagination-changed', {
      detail: { offset: newOffset, limit: this.limit },
      bubbles: true,
      composed: true
    }));
  };

  _handleLimitChange = (event) => {
    const newLimit = Number(event.target.value);
    this.dispatchEvent(new CustomEvent('pagination-changed', {
      detail: { offset: 0, limit: newLimit },
      bubbles: true,
      composed: true
    }));
  };

  // ========================================
  // Drag & Drop Handlers
  // ========================================

  _handleAuditDragStart(event, image, imageSet = null) {
    if (this.dragSelecting) {
      event.preventDefault();
      return;
    }
    if (this._auditPressActive) {
      this._auditSelectionHandlers.cancelPressState();
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

    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', ids.join(','));
    event.dataTransfer.setData('application/x-zoltag-source', 'audit-available');
    setDragImagePayload(event.dataTransfer, ids, [imageSet || this.images || []]);
  }

  // ========================================
  // Hotspot Handlers
  // ========================================

  _handleHotspotDragOver(event, targetId) {
    event.preventDefault();
    this._auditHotspotDragTarget = targetId;
  }

  _handleHotspotDragLeave = () => {
    this._auditHotspotDragTarget = null;
  };

  _handleHotspotDrop(event, targetId) {
    event.preventDefault();
    this._auditHotspotDragTarget = null;
    this._recordAuditHotspotHistory(event, targetId);

    this.dispatchEvent(new CustomEvent('hotspot-changed', {
      detail: {
        type: 'hotspot-drop',
        targetId,
        event
      },
      bubbles: true,
      composed: true
    }));
  }

  _getAuditHistorySessionKey() {
    return buildHotspotHistorySessionKey('curate-audit', this.tenant);
  }

  _restoreAuditHistorySessionState() {
    const state = loadHotspotHistorySessionState(this._getAuditHistorySessionKey(), {
      fallbackView: 'results',
    });
    this.auditResultsView = state.view;
    this._auditHotspotHistoryBatches = state.batches;
    this._auditHotspotHistoryVisibleBatches = state.visibleCount;
  }

  _persistAuditHistorySessionState() {
    saveHotspotHistorySessionState(this._getAuditHistorySessionKey(), {
      view: this.auditResultsView,
      batches: this._auditHotspotHistoryBatches,
      visibleCount: this._auditHotspotHistoryVisibleBatches,
    });
  }

  _setAuditResultsView(nextView) {
    this.auditResultsView = nextView === 'history' ? 'history' : 'results';
    this.dragSelection = [];
    if (this.auditResultsView !== 'history') {
      this._auditHistoryGroupKey = null;
    }
    if (this.auditResultsView === 'history' && this._auditHotspotHistoryVisibleBatches < 1) {
      this._auditHotspotHistoryVisibleBatches = 1;
    }
  }

  _recordAuditHotspotHistory(event, targetId) {
    const target = (this.targets || []).find((entry) => entry.id === targetId);
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
      sourceLabel: 'Curate Audit',
    });
    if (!batch) return;
    this._auditHotspotHistoryBatches = prependHistoryBatch(this._auditHotspotHistoryBatches, batch);
    if (this._auditHotspotHistoryVisibleBatches < 1) {
      this._auditHotspotHistoryVisibleBatches = 1;
    }
  }

  _loadPreviousAuditHistoryBatches() {
    const total = this._auditHotspotHistoryBatches.length;
    if (!total) return;
    const next = loadPreviousHistoryBatchCount(this._auditHotspotHistoryVisibleBatches, 5);
    this._auditHotspotHistoryVisibleBatches = Math.min(total, next);
  }

  _renderAuditHistoryPane() {
    const visibleBatches = getVisibleHistoryBatches(
      this._auditHotspotHistoryBatches,
      this._auditHotspotHistoryVisibleBatches
    );
    if (!visibleBatches.length) {
      return html`
        <div class="p-6 text-center text-sm text-gray-500">
          No hotspot history yet. Drag images to a hotspot, then open Hotspot History.
        </div>
      `;
    }
    const canLoadPrevious = visibleBatches.length < this._auditHotspotHistoryBatches.length;
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
              flashSelectionIds: this._auditFlashSelectionIds,
              selectionHandlers: this._auditSelectionHandlers,
              renderFunctions: {
                renderCurateRatingWidget: this.renderCurateRatingWidget,
                renderCurateRatingStatic: this.renderCurateRatingStatic,
                renderCurateAiMLScore: this.renderCurateAiMLScore,
                renderCuratePermatagSummary: this.renderCuratePermatagSummary,
                formatCurateDate: this.formatCurateDate,
              },
              onImageClick: (dragEvent, image) => this._handleAuditImageClick(dragEvent, image, batch.images),
              onDragStart: (dragEvent, image) => this._handleAuditDragStart(dragEvent, image, batch.images),
              selectionEvents: {
                pointerDown: (dragEvent, itemIndex, imageId, imageOrder, groupKey) =>
                  this._handleAuditHistoryPointerDown(dragEvent, itemIndex, imageId, imageOrder, groupKey),
                pointerMove: (dragEvent) => this._handleAuditPointerMove(dragEvent),
                pointerEnter: (itemIndex, imageOrder, groupKey) =>
                  this._handleAuditHistorySelectHover(itemIndex, imageOrder, groupKey),
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
            @click=${this._loadPreviousAuditHistoryBatches}
            ?disabled=${!canLoadPrevious}
          >
            Previous
          </button>
        </div>
      </div>
    `;
  }

  _handleHotspotKeywordChange(event, targetId) {
    this.dispatchEvent(new CustomEvent('hotspot-changed', {
      detail: {
        type: 'keyword-change',
        targetId,
        value: event.target.value
      },
      bubbles: true,
      composed: true
    }));
  }

  _handleHotspotActionChange(event, targetId) {
    this.dispatchEvent(new CustomEvent('hotspot-changed', {
      detail: {
        type: 'action-change',
        targetId,
        value: event.target.value
      },
      bubbles: true,
      composed: true
    }));
  }

  _handleHotspotTypeChange(event, targetId) {
    this.dispatchEvent(new CustomEvent('hotspot-changed', {
      detail: {
        type: 'type-change',
        targetId,
        value: event.target.value
      },
      bubbles: true,
      composed: true
    }));
  }

  _handleHotspotRatingChange(event, targetId) {
    this.dispatchEvent(new CustomEvent('hotspot-changed', {
      detail: {
        type: 'rating-change',
        targetId,
        value: event.target.value
      },
      bubbles: true,
      composed: true
    }));
  }

  _handleHotspotAddTarget = () => {
    this.dispatchEvent(new CustomEvent('hotspot-changed', {
      detail: { type: 'add-target' },
      bubbles: true,
      composed: true
    }));
  };

  _handleHotspotRemoveTarget(targetId) {
    this.dispatchEvent(new CustomEvent('hotspot-changed', {
      detail: {
        type: 'remove-target',
        targetId
      },
      bubbles: true,
      composed: true
    }));
  }

  // ========================================
  // Rating Drop Zone Handlers
  // ========================================

  _handleRatingToggle = () => {
    this.dispatchEvent(new CustomEvent('rating-toggle', {
      detail: { enabled: !this.ratingEnabled },
      bubbles: true,
      composed: true
    }));
  };

  _handleRatingDragOver(event) {
    event.preventDefault();
    this._auditRatingDragTarget = true;
  }

  _handleRatingDragLeave = () => {
    this._auditRatingDragTarget = false;
  };

  _handleRatingDrop(event) {
    event.preventDefault();
    this._auditRatingDragTarget = false;

    this.dispatchEvent(new CustomEvent('rating-drop', {
      detail: { event },
      bubbles: true,
      composed: true
    }));
  }

  _handleAuditChipFiltersChanged(event) {
    const filters = event.detail?.filters || [];
    this.dispatchEvent(new CustomEvent('curate-audit-filters-changed', {
      detail: { filters },
      bubbles: true,
      composed: true
    }));
  }

  _handleAuditDropboxInput(event) {
    const query = event.detail?.query ?? '';
    const limit = event.detail?.limit;
    this._auditDropboxQuery = query;
    if (this._auditDropboxFetchTimer) {
      clearTimeout(this._auditDropboxFetchTimer);
    }
    if (query.trim().length === 0) {
      this._fetchDropboxFolders('', limit);
      return;
    }
    if (query.length < 2) {
      this.dropboxFolders = [];
      return;
    }
    this._auditDropboxFetchTimer = setTimeout(() => {
      this._fetchDropboxFolders(query, limit);
    }, 500);
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

  // ========================================
  // Helper Methods
  // ========================================

  _getKeywordsByCategory() {
    if (this.keywords && this.keywords.length) {
      return getKeywordsByCategoryFromList(this.keywords);
    }
    return getKeywordsByCategory(this.tagStatsBySource, this.activeCurateTagSource);
  }

  _buildActiveFilters() {
    const filters = [];
    if (this.keyword) {
      filters.push({
        type: 'keyword',
        category: this.keywordCategory || 'Uncategorized',
        value: this.keyword,
        displayLabel: 'Keywords',
        displayValue: this.keyword,
      });
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

    return filters;
  }

  _resolveCategoryForKeyword(keyword) {
    const categories = this._getKeywordsByCategory();
    for (const [category, keywords] of categories) {
      if ((keywords || []).some((kw) => kw?.keyword === keyword)) {
        return category;
      }
    }
    return '';
  }

  _getOptionValueForKeyword(keyword) {
    if (!keyword) return null;
    const categories = this._getKeywordsByCategory();
    for (const [category, keywords] of categories) {
      if ((keywords || []).some((kw) => kw?.keyword === keyword)) {
        return {
          category,
          value: `${encodeURIComponent(category)}::${encodeURIComponent(keyword)}`,
        };
      }
    }
    return null;
  }

  // ========================================
  // Render
  // ========================================

  render() {
    const leftImages = (this.images || []).filter((image) => image && image.id);
    const offset = this.offset ?? 0;
    const limit = this.limit ?? 100;
    const total = this.total ?? 0;
    const paginationTotal = this.loadAll ? leftImages.length : total;
    const leftLabel = this.keyword
      ? (this.mode === 'missing'
        ? `Possible matches for "${this.keyword}"`
        : `Images with "${this.keyword}"`)
      : 'Select a keyword';
    const activeFilters = this._buildActiveFilters();

    // Update left order for selection
    this._auditLeftOrder = leftImages.map(img => img.id);

    return html`
      <div>
        <div class="curate-header-layout search-header-layout mb-4">
          <div class="w-full">
            <filter-chips
              .tenant=${this.tenant}
              .tagStatsBySource=${this.tagStatsBySource}
              .activeCurateTagSource=${this.activeCurateTagSource || 'permatags'}
              .keywords=${this.keywords}
              .activeFilters=${activeFilters}
              .dropboxFolders=${this.dropboxFolders || []}
              .availableFilterTypes=${['keyword', 'rating', 'folder', 'filename']}
              .keywordMultiSelect=${false}
              @filters-changed=${this._handleAuditChipFiltersChanged}
              @folder-search=${this._handleAuditDropboxInput}
            ></filter-chips>
          </div>
        </div>

        ${this.keyword ? html`
          <div class="text-center text-xl font-semibold text-gray-800 mb-3">
            Auditing tag : ${this.keyword}
          </div>
        ` : html``}

        ${this.keyword ? html`
          <div class="bg-white rounded-lg shadow p-4 mb-4">
            <div class="flex flex-wrap items-center gap-4">
              <div>
                <div class="curate-audit-toggle">
                  <button
                    class=${this.mode === 'existing' ? 'active' : ''}
                    @click=${() => this._handleModeChange('existing')}
                  >
                    Verify Existing Tags
                  </button>
                  <button
                    class=${this.mode === 'missing' ? 'active' : ''}
                    @click=${() => this._handleModeChange('missing')}
                  >
                    Find Missing Tags
                  </button>
                </div>
              </div>
              ${this.mode === 'missing' ? html`
                <div>
                  <div class="curate-ai-toggle text-xs text-gray-600 flex items-center">
                    <label class="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        class="h-4 w-4"
                        .checked=${this.aiEnabled}
                        @change=${this._handleAiEnabledChange}
                      >
                      <span>Find with AI</span>
                    </label>
                    ${this.aiEnabled ? html`
                      <div class="flex items-center gap-2">
                        ${[
                          { key: 'siglip', label: 'Zero-shot' },
                          { key: 'trained', label: 'Keyword model' },
                        ].map((model) => html`
                          <button
                            class="px-2 py-1 rounded border text-xs ${this.aiModel === model.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}"
                            aria-pressed=${this.aiModel === model.key ? 'true' : 'false'}
                            @click=${() => this._handleAiModelChange(model.key)}
                          >
                            ${model.label}
                          </button>
                        `)}
                      </div>
                    ` : html``}
                  </div>
                </div>
              ` : html``}
            </div>
          </div>

          <div class="curate-layout" style="--curate-thumb-size: ${this.thumbSize}px;">
            <div class="curate-pane">
              <div class="curate-pane-header">
                <div class="curate-pane-header-row">
                  <span>${this.auditResultsView === 'history' ? 'Hotspot History' : leftLabel}</span>
                  <div class="curate-audit-toggle">
                    <button
                      class=${this.auditResultsView === 'results' ? 'active' : ''}
                      @click=${() => this._setAuditResultsView('results')}
                    >
                      Results
                    </button>
                    <button
                      class=${this.auditResultsView === 'history' ? 'active' : ''}
                      @click=${() => this._setAuditResultsView('history')}
                    >
                      Hotspot History
                    </button>
                  </div>
                  <div class="curate-pane-header-actions">
                    ${this.auditResultsView === 'results' && this.keyword && !this.loadAll ? html`
                      ${renderResultsPagination({
                        total: paginationTotal,
                        offset,
                        limit,
                        count: leftImages.length,
                        onPrev: this._handlePagePrev,
                        onNext: this._handlePageNext,
                        onLimitChange: this._handleLimitChange,
                        disabled: this.loading,
                      })}
                    ` : html``}
                  </div>
                </div>
              </div>
              ${this.loading ? html`
                <div class="curate-loading-overlay" aria-label="Loading">
                  <span class="curate-spinner large"></span>
                </div>
              ` : html``}
              <div class="curate-pane-body">
                ${this.auditResultsView === 'history' ? html`
                  ${this._renderAuditHistoryPane()}
                ` : html`
                  ${renderSelectableImageGrid({
                    images: leftImages,
                    selection: this.dragSelection,
                    flashSelectionIds: this._auditFlashSelectionIds,
                    selectionHandlers: this._auditSelectionHandlers,
                    renderFunctions: {
                      renderCurateRatingWidget: this.renderCurateRatingWidget,
                      renderCurateRatingStatic: this.renderCurateRatingStatic,
                      renderCurateAiMLScore: this.renderCurateAiMLScore,
                      renderCuratePermatagSummary: this.renderCuratePermatagSummary,
                      formatCurateDate: this.formatCurateDate,
                    },
                    onImageClick: (event, image) => this._handleAuditImageClick(event, image, leftImages),
                    onDragStart: (event, image) => this._handleAuditDragStart(event, image, leftImages),
                    selectionEvents: {
                      pointerDown: (event, index, imageId, imageOrder) =>
                        this._handleAuditPointerDownWithOrder(event, index, imageId, imageOrder),
                      pointerMove: (event) => this._handleAuditPointerMove(event),
                      pointerEnter: (index, imageOrder) => this._handleAuditSelectHoverWithOrder(index, imageOrder),
                      order: this._auditLeftOrder,
                    },
                    options: {
                      enableReordering: false,
                      showPermatags: true,
                      showAiScore: true,
                      emptyMessage: this.keyword ? 'No images available.' : 'Choose a keyword to start.',
                    },
                  })}
                  ${this.keyword && !this.loadAll ? html`
                    <div class="mt-3">
                      ${renderResultsPagination({
                        total: paginationTotal,
                        offset,
                        limit,
                        count: leftImages.length,
                        onPrev: this._handlePagePrev,
                        onNext: this._handlePageNext,
                        onLimitChange: this._handleLimitChange,
                        disabled: this.loading,
                        showPageSize: false,
                      })}
                    </div>
                  ` : html``}
                `}
              </div>
            </div>

            <div class="curate-pane utility-targets">
              <div class="curate-pane-header">
                <div class="curate-pane-header-row">
                  <span>Hotspots</span>
                  <div class="curate-rating-checkbox" style="margin-left: auto;">
                    <input
                      type="checkbox"
                      id="rating-checkbox-audit"
                      .checked=${this.ratingEnabled}
                      @change=${this._handleRatingToggle}
                    />
                    <label for="rating-checkbox-audit">Rating</label>
                  </div>
                </div>
              </div>
              <div class="curate-pane-body">
                ${this.ratingEnabled ? html`
                  <div
                    class="curate-rating-drop-zone ${this._auditRatingDragTarget ? 'active' : ''}"
                    @dragover=${(event) => this._handleRatingDragOver(event)}
                    @dragleave=${this._handleRatingDragLeave}
                    @drop=${(event) => this._handleRatingDrop(event)}
                  >
                    <div class="curate-rating-drop-zone-star">⭐</div>
                    <div class="curate-rating-drop-zone-content">
                      <div class="curate-rating-drop-hint">Drop to rate</div>
                      <div class="curate-rating-count">${this.ratingCount || 0} rated</div>
                    </div>
                  </div>
                ` : html``}
                <div class="curate-utility-panel">
                  ${(this.targets || []).map((target) => {
                    const isPrimary = (this.targets?.[0]?.id === target.id);
                    const isRating = target.type === 'rating';
                    const optionMatch = target.keyword ? this._getOptionValueForKeyword(target.keyword) : null;
                    const fallbackCategory = target.category || this._resolveCategoryForKeyword(target.keyword) || 'Uncategorized';
                    const selectedValue = target.keyword
                      ? (optionMatch?.value || `${encodeURIComponent(fallbackCategory)}::${encodeURIComponent(target.keyword)}`)
                      : '';
                    const keywordOptions = this._getKeywordsByCategory();
                    let hasSelectedOption = false;
                    return html`
                      <div
                        class="curate-utility-box ${this._auditHotspotDragTarget === target.id ? 'active' : ''}"
                        @dragover=${(event) => this._handleHotspotDragOver(event, target.id)}
                        @dragleave=${this._handleHotspotDragLeave}
                        @drop=${(event) => this._handleHotspotDrop(event, target.id)}
                      >
                        <div class="curate-utility-controls">
                          <select
                            class="curate-utility-type-select"
                            .value=${target.type || 'keyword'}
                            ?disabled=${isPrimary}
                            @change=${(event) => this._handleHotspotTypeChange(event, target.id)}
                          >
                            <option value="keyword">Keyword</option>
                            <option value="rating">Rating</option>
                          </select>
                          ${isRating ? html`
                            <select
                              class="curate-utility-select"
                              .value=${target.rating ?? ''}
                              ?disabled=${isPrimary}
                              @change=${(event) => this._handleHotspotRatingChange(event, target.id)}
                            >
                              <option value="">Select rating…</option>
                              <option value="0">🗑️ Garbage</option>
                              <option value="1">⭐ 1 Star</option>
                              <option value="2">⭐⭐ 2 Stars</option>
                              <option value="3">⭐⭐⭐ 3 Stars</option>
                            </select>
                          ` : html`
                            <select
                              class="curate-utility-select ${selectedValue ? 'selected' : ''}"
                              .value=${selectedValue}
                              ?disabled=${isPrimary}
                              @change=${(event) => this._handleHotspotKeywordChange(event, target.id)}
                            >
                              <option value="" ?selected=${!selectedValue}>Select keyword…</option>
                              ${keywordOptions.map(([category, keywords]) => html`
                                <optgroup label="${category}">
                                  ${keywords.map((kw) => html`
                                    ${(() => {
                                      const optionValue = `${encodeURIComponent(category)}::${encodeURIComponent(kw.keyword)}`;
                                      const isSelected = optionValue === selectedValue;
                                      if (isSelected) {
                                        hasSelectedOption = true;
                                      }
                                      return html`
                                        <option value=${optionValue} ?selected=${isSelected}>
                                          ${kw.keyword}
                                        </option>
                                      `;
                                    })()}
                                  `)}
                                </optgroup>
                              `)}
                              ${(() => {
                                if (!isPrimary || !target.keyword) return html``;
                                if (hasSelectedOption) return html``;
                                return html``;
                              })()}
                            </select>
                            <select
                              class="curate-utility-action"
                              .value=${target.action || 'add'}
                              ?disabled=${isPrimary}
                              @change=${(event) => this._handleHotspotActionChange(event, target.id)}
                            >
                              <option value="add">Add</option>
                              <option value="remove">Remove</option>
                            </select>
                          `}
                        </div>
                        ${!isPrimary ? html`
                          <button
                            type="button"
                            class="curate-utility-remove"
                            title="Remove box"
                            @click=${() => this._handleHotspotRemoveTarget(target.id)}
                          >
                            ×
                          </button>
                        ` : html``}
                        <div class="curate-utility-count">${target.count || 0}</div>
                        <div class="curate-utility-drop-hint">Drop images here</div>
                      </div>
                    `;
                  })}
                  <button class="curate-utility-add" @click=${this._handleHotspotAddTarget}>
                    +
                  </button>
                </div>
              </div>
            </div>
          </div>
        ` : html`
          <div class="bg-white rounded-lg shadow p-6 text-sm text-gray-600">
            This screen lets you scan your collection for all images tagged to a Keyword. You can verify existing images, and look for images that should have it. Select a keyword to proceed.
          </div>
        `}
      </div>
    `;
  }
}

customElements.define('curate-audit-tab', CurateAuditTab);
