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
import './shared/widgets/keyword-dropdown.js';

const AUDIT_HELP_VISIBILITY_STORAGE_KEY = 'curate-audit:help-visible';

/**
 * Curate Audit Tab Component
 *
 * Tag auditing interface with two modes:
 * - Verify Existing Tags: Review images already tagged with a keyword
 * - Find Missing Tags: Discover images that should have the keyword
 *
 * Features:
 * - Mode toggle (existing vs missing)
 * - AI-powered suggestions (zero-shot, trained, and similarity models)
 * - Image grid with rating and permatag overlays
 * - Multi-select via long-press and drag
 * - Hotspots for quick rating/tagging
 * - Pagination controls
 *
 * @fires audit-mode-changed - When audit mode changes (existing/missing)
 * @fires audit-ai-model-changed - When AI model selection changes
 * @fires audit-ai-ml-similarity-settings-changed - When ML similarity settings change
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
    aiModel: { type: String }, // 'siglip', 'trained', or 'ml-similarity'
    mlSimilaritySeedCount: { type: Number },
    mlSimilaritySimilarCount: { type: Number },
    mlSimilarityDedupe: { type: Boolean },
    mlSimilarityRandom: { type: Boolean },
    images: { type: Array },
    thumbSize: { type: Number },
    keywordCategory: { type: String },
    keywords: { type: Array },
    minRating: { type: Object },
    mediaType: { type: String },
    dropboxPathPrefix: { type: String },
    filenameQuery: { type: String },
    textQuery: { type: String },
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
    _showAiHelp: { type: Boolean, state: true },
  };

  constructor() {
    super();
    this.tenant = '';
    this.keyword = '';
    this.mode = 'missing';
    this.aiEnabled = false;
    this.aiModel = 'siglip';
    this.mlSimilaritySeedCount = 5;
    this.mlSimilaritySimilarCount = 10;
    this.mlSimilarityDedupe = true;
    this.mlSimilarityRandom = true;
    this.images = [];
    this.thumbSize = 120;
    this.keywordCategory = '';
    this.keywords = [];
    this.minRating = null;
    this.mediaType = 'all';
    this.dropboxPathPrefix = '';
    this.filenameQuery = '';
    this.textQuery = '';
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
    this._showAiHelp = this._loadAiHelpVisibility();

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

  _emitMlSimilaritySettings(settings = {}) {
    this.dispatchEvent(new CustomEvent('audit-ai-ml-similarity-settings-changed', {
      detail: {
        seedCount: Number.isFinite(Number(settings.seedCount))
          ? Math.max(1, Math.min(50, Number(settings.seedCount)))
          : this.mlSimilaritySeedCount,
        similarCount: Number.isFinite(Number(settings.similarCount))
          ? Math.max(1, Math.min(50, Number(settings.similarCount)))
          : this.mlSimilaritySimilarCount,
        dedupe: settings.dedupe !== undefined
          ? Boolean(settings.dedupe)
          : Boolean(this.mlSimilarityDedupe),
        random: settings.random !== undefined
          ? Boolean(settings.random)
          : Boolean(this.mlSimilarityRandom),
      },
      bubbles: true,
      composed: true,
    }));
  }

  _handleMlSimilaritySeedCountChange(event) {
    this._emitMlSimilaritySettings({
      seedCount: event?.target?.value,
      similarCount: this.mlSimilaritySimilarCount,
      dedupe: this.mlSimilarityDedupe,
      random: this.mlSimilarityRandom,
    });
  }

  _handleMlSimilaritySimilarCountChange(event) {
    this._emitMlSimilaritySettings({
      seedCount: this.mlSimilaritySeedCount,
      similarCount: event?.target?.value,
      dedupe: this.mlSimilarityDedupe,
      random: this.mlSimilarityRandom,
    });
  }

  _handleMlSimilarityDedupeChange(event) {
    this._emitMlSimilaritySettings({
      seedCount: this.mlSimilaritySeedCount,
      similarCount: this.mlSimilaritySimilarCount,
      dedupe: event?.target?.checked,
      random: this.mlSimilarityRandom,
    });
  }

  _handleMlSimilarityRandomChange(event) {
    this._emitMlSimilaritySettings({
      seedCount: this.mlSimilaritySeedCount,
      similarCount: this.mlSimilaritySimilarCount,
      dedupe: this.mlSimilarityDedupe,
      random: event?.target?.checked,
    });
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

  _handleAuditKeywordDropdownChange(event) {
    const rawValue = String(event?.detail?.value ?? event?.target?.value ?? '').trim();
    const filters = [];
    if (rawValue && rawValue !== '__untagged__') {
      const [encodedCategory, ...encodedKeywordParts] = rawValue.split('::');
      const category = decodeURIComponent(encodedCategory || '');
      const keyword = decodeURIComponent(encodedKeywordParts.join('::') || '');
      if (category && keyword) {
        filters.push({
          type: 'keyword',
          keywordsByCategory: {
            [category]: [keyword],
          },
          operator: 'OR',
          displayLabel: 'Keywords',
          displayValue: keyword,
        });
      }
    }
    this.dispatchEvent(new CustomEvent('curate-audit-filters-changed', {
      detail: { filters },
      bubbles: true,
      composed: true,
    }));
  }

  _getAuditKeywordDropdownValue() {
    if (!this.keyword) return '';
    const matched = this._getOptionValueForKeyword(this.keyword);
    if (matched?.value) {
      return matched.value;
    }
    if (this.keywordCategory) {
      return `${encodeURIComponent(this.keywordCategory)}::${encodeURIComponent(this.keyword)}`;
    }
    return '';
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

    if (this.textQuery) {
      filters.push({
        type: 'text_search',
        value: this.textQuery,
        displayLabel: 'Text search',
        displayValue: this.textQuery,
      });
    }

    const mediaType = String(this.mediaType || 'all').trim().toLowerCase();
    if (mediaType === 'image' || mediaType === 'video') {
      filters.push({
        type: 'media',
        value: mediaType,
        displayLabel: 'Media',
        displayValue: mediaType === 'video' ? 'Videos' : 'Photos',
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

  _getActiveAiModel() {
    const raw = String(this.aiModel || '').trim().toLowerCase();
    return raw || 'siglip';
  }

  _isMlSimilarityMode() {
    return this.mode === 'missing'
      && this._getActiveAiModel() === 'ml-similarity'
      && !!this.keyword;
  }

  _getAiModeDocumentation() {
    const mode = this._getActiveAiModel();
    if (mode === 'siglip') {
      return {
        title: 'Zero-shot',
        summary: 'Works right away based on keyword descriptions and is not influenced by your existing tagging.',
        bestFor: 'early tagging, especially before you have many (or any) tags.',
        points: [
          'Uses keyword description signals instead of training examples.',
          'Results are ranked by model confidence for the selected keyword.',
          'Strong first-pass model when training data is still sparse.',
        ],
      };
    }
    if (mode === 'trained') {
      return {
        title: 'Trained',
        summary: 'This model analyzes tags you have applied, and infers similar patterns.',
        bestFor: 'ongoing curation after you have built up tagged examples.',
        points: [
          'Directly improves as you tag more images.',
          'Results are ranked by trained model confidence.',
          'Depends on the latest available trained model for this tenant.',
        ],
      };
    }
    if (mode === 'ml-similarity') {
      return {
        title: 'Similarity',
        summary: 'Hybrid model that starts from tagged source images and finds similar images that are not yet tagged.',
        bestFor: 'Best when many photos share the same scene but tags are inconsistent.',
        points: [
          'Sample Size: number of tagged source images to start with.',
          'Candidates: How many similar items to retrieve for each source image.',
          '[ ] dedupe avoids repeating the same candidate across source groups.',
          '[ ] random uses random source selection instead of rating-based order.',
          'Often produces surprisingly strong results on near-duplicate scene sets.',
        ],
      };
    }
    return null;
  }

  _renderAiModeDocumentationPanel() {
    const modeInfo = this._getAiModeDocumentation();
    if (!modeInfo) return html``;
    const activeModel = this._getActiveAiModel();
    const keywordAdminHref = '?tab=library&subTab=keywords&adminSubTab=tagging';
    return html`
      <div class="w-full rounded-md border border-gray-300 bg-gray-50 p-2">
        <div class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Help</div>
        <div class="pt-2">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="rounded border border-gray-200 bg-white p-3">
              <div class="text-sm font-semibold text-gray-800">What is all this?</div>
              <p class="mt-2 text-sm leading-relaxed text-gray-600">
                Zoltag uses different machine learning models to suggest tags for your images. These models are good
                at finding missing tags, but they also produce false positives, so the goal is not to fully automate
                tagging. Instead, we surface strong candidates and make review fast so you can apply the right tags
                quickly using hotspots.
              </p>
              <p class="mt-2 text-sm leading-relaxed text-gray-600">
                Each model works differently: some rely on keyword descriptions, some learn from your existing tags,
                and some use visual similarity. As you tag more images, results generally improve over time, so it is
                worth checking back regularly.
              </p>
            </div>
            <div class="rounded border border-gray-200 bg-white p-3">
              <div class="inline-flex items-center px-2 py-1 rounded border text-sm font-semibold bg-blue-600 text-white border-blue-600">
                ${modeInfo.title}
              </div>
              ${activeModel === 'siglip' ? html`
                <p class="mt-1 text-sm text-gray-600">
                  Works right away based on
                  <a
                    href=${keywordAdminHref}
                    target="zoltag-keyword-admin"
                    rel="noopener noreferrer"
                    class="text-blue-600 underline hover:text-blue-700"
                  >keyword descriptions</a>
                  and is not influenced by your existing tagging.
                </p>
              ` : html`
                <p class="mt-1 text-sm text-gray-600">${modeInfo.summary}</p>
              `}
              <p class="mt-2 text-sm text-gray-700"><span class="font-semibold">Best for:</span> ${modeInfo.bestFor}</p>
              <ul class="mt-2 list-disc pl-4 space-y-1 text-sm text-gray-600">
                ${modeInfo.points.map((point) => html`<li>${point}</li>`)}
              </ul>
            </div>
          </div>
          <div class="mt-3 flex justify-end">
            <button
              type="button"
              class="px-2 py-1 rounded border border-gray-300 bg-white text-sm text-gray-700 hover:bg-gray-100"
              @click=${() => this._hideAiHelp()}
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    `;
  }

  _toggleAiHelpVisibility() {
    this._showAiHelp = !this._showAiHelp;
    this._persistAiHelpVisibility(this._showAiHelp);
  }

  _hideAiHelp() {
    this._showAiHelp = false;
    this._persistAiHelpVisibility(false);
  }

  _loadAiHelpVisibility() {
    try {
      const raw = localStorage.getItem(AUDIT_HELP_VISIBILITY_STORAGE_KEY);
      if (raw === null) return true;
      return raw === '1';
    } catch (_error) {
      return true;
    }
  }

  _persistAiHelpVisibility(visible) {
    try {
      localStorage.setItem(AUDIT_HELP_VISIBILITY_STORAGE_KEY, visible ? '1' : '0');
    } catch (_error) {
      // ignore storage errors in private browsing or restricted environments
    }
  }

  _buildSimilarityGroups(images) {
    const safeImages = Array.isArray(images) ? images : [];
    const hasSimilarityMetadata = safeImages.some((image) => (
      Number.isFinite(Number(image?.similarity_group))
      || image?.similarity_seed === true
      || Number.isFinite(Number(image?.similarity_seed_image_id))
    ));
    if (!hasSimilarityMetadata) {
      return null;
    }
    const groups = [];
    const byGroup = new Map();
    safeImages.forEach((image, index) => {
      const rawGroup = Number(image?.similarity_group);
      const groupId = Number.isFinite(rawGroup) ? rawGroup : index;
      if (!byGroup.has(groupId)) {
        const group = { groupId, images: [], startIndex: index };
        byGroup.set(groupId, group);
        groups.push(group);
      }
      byGroup.get(groupId).images.push(image);
    });
    return groups;
  }

  _renderSimilarityGroups(leftImages) {
    const groups = this._buildSimilarityGroups(leftImages);
    if (groups === null) {
      return renderSelectableImageGrid({
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
      });
    }
    if (!groups.length) {
      return renderSelectableImageGrid({
        images: [],
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
      });
    }

    return html`
      <div class="curate-similarity-groups">
        ${groups.map((group, groupIndex) => {
          const explicitSeed = (group.images || []).find((image) => image?.similarity_seed)?.id;
          const fallbackSeed = (group.images || [])[0]?.id;
          const seedImageId = Number.isFinite(Number(explicitSeed))
            ? Number(explicitSeed)
            : (Number.isFinite(Number(fallbackSeed)) ? Number(fallbackSeed) : null);
          const pinnedImageIds = seedImageId !== null ? new Set([seedImageId]) : null;

          return html`
            <div class="curate-similarity-group">
              ${renderSelectableImageGrid({
                images: group.images,
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
                  pointerDown: (event, index, imageId) =>
                    this._handleAuditPointerDownWithOrder(event, group.startIndex + index, imageId, this._auditLeftOrder),
                  pointerMove: (event) => this._handleAuditPointerMove(event),
                  pointerEnter: (index) =>
                    this._handleAuditSelectHoverWithOrder(group.startIndex + index, this._auditLeftOrder),
                  order: this._auditLeftOrder,
                },
                options: {
                  enableReordering: false,
                  showPermatags: true,
                  showAiScore: true,
                  pinnedImageIds,
                  pinnedLabel: 'Source',
                  emptyMessage: 'No images available.',
                },
              })}
              ${groupIndex < groups.length - 1 ? html`<hr class="my-4 border-gray-200">` : html``}
            </div>
          `;
        })}
      </div>
    `;
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
    const selectedKeywordValue = this._getAuditKeywordDropdownValue();
    const activeAiModel = this._getActiveAiModel();

    // Update left order for selection
    this._auditLeftOrder = leftImages.map(img => img.id);

    return html`
      <div>
        <div class="mb-4">
          <div class="w-full max-w-xl mx-auto">
            <keyword-dropdown
              .value=${selectedKeywordValue}
              .keywords=${this.keywords || []}
              .tagStatsBySource=${this.tagStatsBySource || {}}
              .activeCurateTagSource=${this.activeCurateTagSource || 'permatags'}
              .includeUntagged=${false}
              @keyword-selected=${this._handleAuditKeywordDropdownChange}
              @change=${this._handleAuditKeywordDropdownChange}
            ></keyword-dropdown>
          </div>
        </div>

        ${this.keyword ? html`
          <div class="bg-white rounded-lg shadow p-4 mb-4">
            <div class="flex flex-wrap items-center justify-center gap-4">
              <div>
                <div class="flex flex-col items-center gap-1">
                  <div class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Mode</div>
                  <div class="inline-flex flex-wrap items-center justify-center gap-2 rounded-xl border border-gray-300 bg-gray-50 p-2 shadow-sm">
                    <button
                      class=${this.mode === 'missing'
                        ? 'px-4 py-2 rounded-lg border border-blue-600 bg-blue-600 text-white text-sm font-semibold shadow-sm'
                        : 'px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-semibold hover:bg-gray-100'}
                      aria-pressed=${this.mode === 'missing' ? 'true' : 'false'}
                      @click=${() => this._handleModeChange('missing')}
                    >
                      Find Missing Tags
                    </button>
                    <button
                      class=${this.mode === 'existing'
                        ? 'px-4 py-2 rounded-lg border border-blue-600 bg-blue-600 text-white text-sm font-semibold shadow-sm'
                        : 'px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-semibold hover:bg-gray-100'}
                      aria-pressed=${this.mode === 'existing' ? 'true' : 'false'}
                      @click=${() => this._handleModeChange('existing')}
                    >
                      Verify Existing Tags
                    </button>
                  </div>
                </div>
              </div>
              ${this.mode === 'missing' ? html`
                <div class="w-full">
                  <div class="space-y-3">
                    <fieldset class="relative w-full max-w-2xl mx-auto rounded-md border border-gray-300 bg-gray-50 p-2">
                      <legend class="px-2 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        <span>Select a Model</span>
                        <button
                          type="button"
                          class="inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 bg-white text-[10px] font-semibold text-gray-600 hover:bg-gray-100 normal-case"
                          title=${this._showAiHelp ? 'Hide help' : 'Show help'}
                          aria-label=${this._showAiHelp ? 'Hide help' : 'Show help'}
                          @click=${this._toggleAiHelpVisibility}
                        >
                          ?
                        </button>
                      </legend>
                      <div class="w-full text-xs text-gray-600">
                        <div class="mx-auto flex w-fit flex-wrap items-center justify-center gap-2">
                          ${[
                            { key: 'siglip', label: 'Zero-shot' },
                            { key: 'trained', label: 'Trained' },
                            { key: 'ml-similarity', label: 'Similarity' },
                          ].map((model) => html`
                            <button
                              class="px-2 py-1 rounded border text-xs ${activeAiModel === model.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}"
                              aria-pressed=${activeAiModel === model.key ? 'true' : 'false'}
                              @click=${() => {
                                if (!this.aiEnabled) {
                                  this.dispatchEvent(new CustomEvent('audit-ai-enabled-changed', {
                                    detail: { enabled: true },
                                    bubbles: true,
                                    composed: true,
                                  }));
                                }
                                this._handleAiModelChange(model.key);
                              }}
                            >
                              ${model.label}
                            </button>
                          `)}
                        </div>
                        ${activeAiModel === 'ml-similarity' ? html`
                          <div class="w-full mt-2 flex flex-wrap items-center justify-center gap-3 text-xs text-gray-700">
                            <label class="inline-flex items-center gap-1">
                              <span>Sample Size</span>
                              <input
                                type="number"
                                min="1"
                                max="50"
                                step="1"
                                class="w-16 px-2 py-1 rounded border border-gray-300 text-gray-700 bg-white"
                                .value=${String(this.mlSimilaritySeedCount ?? 5)}
                                @change=${(event) => this._handleMlSimilaritySeedCountChange(event)}
                              >
                            </label>
                            <label class="inline-flex items-center gap-1">
                              <span>Candidates</span>
                              <input
                                type="number"
                                min="1"
                                max="50"
                                step="1"
                                class="w-16 px-2 py-1 rounded border border-gray-300 text-gray-700 bg-white"
                                .value=${String(this.mlSimilaritySimilarCount ?? 10)}
                                @change=${(event) => this._handleMlSimilaritySimilarCountChange(event)}
                              >
                            </label>
                            <label class="inline-flex items-center gap-2">
                              <input
                                type="checkbox"
                                class="h-4 w-4"
                                .checked=${Boolean(this.mlSimilarityDedupe)}
                                @change=${(event) => this._handleMlSimilarityDedupeChange(event)}
                              >
                              <span>dedupe</span>
                            </label>
                            <label class="inline-flex items-center gap-2">
                              <input
                                type="checkbox"
                                class="h-4 w-4"
                                .checked=${Boolean(this.mlSimilarityRandom)}
                                @change=${(event) => this._handleMlSimilarityRandomChange(event)}
                              >
                              <span>random</span>
                            </label>
                          </div>
                        ` : html``}
                      </div>
                    </fieldset>
                    ${this._showAiHelp ? this._renderAiModeDocumentationPanel() : html``}
                  </div>
                </div>
              ` : html``}
            </div>
          </div>

          <div class="curate-layout results-hotspot-layout" style="--curate-thumb-size: ${this.thumbSize}px;">
            <div class="curate-pane">
              <div class="curate-pane-header curate-pane-header--audit">
                <span class="curate-pane-header-title">
                  ${this.auditResultsView === 'history' ? 'Hotspot History' : leftLabel}
                </span>
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
                  ${this.keyword && !this.loadAll ? html`
                    <div class="p-2">
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
                    </div>
                  ` : html``}
                  ${this._isMlSimilarityMode()
                    ? this._renderSimilarityGroups(leftImages)
                    : renderSelectableImageGrid({
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
                    <div class="p-2">
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
                      id="history-checkbox-audit"
                      .checked=${this.auditResultsView === 'history'}
                      @change=${(event) => this._setAuditResultsView(event.target.checked ? 'history' : 'results')}
                    />
                    <label for="history-checkbox-audit">History</label>
                  </div>
                  <div class="curate-rating-checkbox">
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
          <div class="bg-white rounded-lg shadow p-6 text-sm text-gray-600 text-center">
            <p class="max-w-3xl mx-auto">
              This screen lets you scan your collection for all images tagged to a Keyword. You can verify existing images, and look for images that should have it. Select a keyword to proceed.
            </p>
          </div>
        `}
      </div>
    `;
  }
}

customElements.define('curate-audit-tab', CurateAuditTab);
