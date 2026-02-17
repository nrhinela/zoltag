import { createSelectionHandlers } from '../shared/selection-handlers.js';
import { createRatingDragHandlers } from '../shared/rating-drag-handlers.js';
import { createHotspotHandlers, parseUtilityKeywordValue } from '../shared/hotspot-controls.js';

function initializeHotspotHandlers(host) {
  host._exploreHotspotHandlers = createHotspotHandlers(host, {
    targetsProperty: 'curateExploreTargets',
    dragTargetProperty: '_curateExploreHotspotDragTarget',
    nextIdProperty: '_curateExploreHotspotNextId',
    parseKeywordValue: parseUtilityKeywordValue,
    applyRating: (ids, rating) => host._applyExploreRating(ids, rating),
    processTagDrop: (ids, target) => host._processExploreTagDrop(ids, target),
    removeImages: (ids) => host._removeCurateImagesByIds(ids),
  });

  host._auditHotspotHandlers = createHotspotHandlers(host, {
    targetsProperty: 'curateAuditTargets',
    dragTargetProperty: '_curateAuditHotspotDragTarget',
    nextIdProperty: '_curateAuditHotspotNextId',
    parseKeywordValue: parseUtilityKeywordValue,
    applyRating: (ids, rating) => host._applyAuditRating(ids, rating),
    processTagDrop: (ids, target) => host._curateAuditState.processTagDrop(ids, target),
    removeImages: (ids) => host._removeAuditImagesByIds(ids),
  });
}

function initializeRatingHandlers(host) {
  host._exploreRatingHandlers = createRatingDragHandlers(host, {
    enabledProperty: 'curateExploreRatingEnabled',
    dragTargetProperty: '_curateExploreRatingDragTarget',
    showRatingDialog: (ids) => host._showExploreRatingDialog(ids),
  });

  host._auditRatingHandlers = createRatingDragHandlers(host, {
    enabledProperty: 'curateAuditRatingEnabled',
    dragTargetProperty: '_curateAuditRatingDragTarget',
    showRatingDialog: (ids) => host._showAuditRatingDialog(ids),
  });
}

function initializeSelectionHandlers(host) {
  host._exploreSelectionHandlers = createSelectionHandlers(host, {
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
    getOrder: () => host._curateDragOrder || host._curateLeftOrder,
    flashSelection: (imageId) => host._flashCurateSelection(imageId),
  });

  host._auditSelectionHandlers = createSelectionHandlers(host, {
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
    getOrder: () => host._curateAuditLeftOrder,
    flashSelection: (imageId) => host._flashCurateSelection(imageId),
  });
}

function wireFilterPanelListeners(host) {
  const normalizeKeywords = (rawKeywords) => {
    if (!rawKeywords || typeof rawKeywords !== 'object') return {};
    const next = {};
    Object.entries(rawKeywords).forEach(([category, values]) => {
      if (values instanceof Set) {
        next[category] = new Set(values);
        return;
      }
      if (Array.isArray(values)) {
        next[category] = new Set(values.filter(Boolean));
        return;
      }
      if (values && typeof values !== 'string' && typeof values[Symbol.iterator] === 'function') {
        next[category] = new Set(Array.from(values).filter(Boolean));
      }
    });
    return next;
  };

  const syncCurateHomeStateFromFilters = (filters = {}) => {
    const mediaType = String(filters.mediaType || 'all').toLowerCase();
    const nextMinRating = filters.ratingOperator === 'is_null'
      ? 'unrated'
      : (filters.rating !== undefined && filters.rating !== null && filters.rating !== '' ? filters.rating : null);
    host.curateMinRating = nextMinRating;
    host.curateHideDeleted = filters.hideZeroRating !== undefined
      ? Boolean(filters.hideZeroRating)
      : host.curateHideDeleted;
    host.curateKeywordFilters = normalizeKeywords(filters.keywords);
    host.curateKeywordOperators = { ...(filters.operators || {}) };
    host.curateNoPositivePermatags = Boolean(filters.permatagPositiveMissing);
    host.curateMediaType = mediaType === 'image' || mediaType === 'video' ? mediaType : 'all';
    host.curateDropboxPathPrefix = filters.dropboxPathPrefix || '';
    host.curateFilenameQuery = filters.filenameQuery || '';
    host.curateListId = filters.listId || '';
    host.curateListExcludeId = filters.listExcludeId || '';
    host.curateCategoryFilterOperator = filters.categoryFilterOperator ?? undefined;
    if (filters.limit !== undefined && filters.limit !== null && filters.limit !== '') {
      host.curateLimit = Number.isFinite(Number(filters.limit)) ? Number(filters.limit) : host.curateLimit;
    }
    if (filters.offset !== undefined && filters.offset !== null && filters.offset !== '') {
      host.curatePageOffset = Number.isFinite(Number(filters.offset)) ? Number(filters.offset) : host.curatePageOffset;
    }
  };

  const syncCurateAuditStateFromFilters = (filters = {}) => {
    const mediaType = String(filters.mediaType || 'all').toLowerCase();
    const nextMinRating = filters.ratingOperator === 'is_null'
      ? 'unrated'
      : (filters.rating !== undefined && filters.rating !== null && filters.rating !== '' ? filters.rating : null);
    host.curateAuditMinRating = nextMinRating;
    host.curateAuditHideDeleted = filters.hideZeroRating !== undefined
      ? Boolean(filters.hideZeroRating)
      : host.curateAuditHideDeleted;
    host.curateAuditMediaType = mediaType === 'image' || mediaType === 'video' ? mediaType : 'all';
    host.curateAuditDropboxPathPrefix = filters.dropboxPathPrefix || '';
    host.curateAuditFilenameQuery = filters.filenameQuery || '';
    if (filters.permatagKeyword !== undefined) {
      host.curateAuditKeyword = filters.permatagKeyword || '';
    }
    if (filters.permatagCategory !== undefined) {
      host.curateAuditCategory = filters.permatagCategory || '';
    }
    if (filters.permatagMissing !== undefined) {
      host.curateAuditMode = filters.permatagMissing ? 'missing' : 'existing';
    }
    if (filters.limit !== undefined && filters.limit !== null && filters.limit !== '') {
      host.curateAuditLimit = Number.isFinite(Number(filters.limit)) ? Number(filters.limit) : host.curateAuditLimit;
    }
    if (filters.offset !== undefined && filters.offset !== null && filters.offset !== '') {
      const nextOffset = Number.isFinite(Number(filters.offset)) ? Number(filters.offset) : host.curateAuditPageOffset;
      host.curateAuditPageOffset = nextOffset;
      host.curateAuditOffset = nextOffset;
    }
  };

  host.searchFilterPanel.on('images-loaded', (detail) => {
    if (detail.tabId === 'search') {
      host.searchImages = [...detail.images];
      host.searchTotal = detail.total || 0;
      host.searchPinnedImageId = null;
      host.searchSimilarityAssetUuid = null;
    }
  });

  host.curateHomeFilterPanel.on('filters-changed', (detail) => {
    if (detail.tabId !== 'curate-home') return;
    syncCurateHomeStateFromFilters(detail.filters || {});
  });
  host.curateHomeFilterPanel.on('images-loaded', (detail) => {
    if (detail.tabId === 'curate-home') {
      host.curateImages = [...detail.images];
      host.curateTotal = detail.total || 0;
      host.curatePinnedImageId = null;
      host.curateSimilarityAssetUuid = null;
    }
  });

  host.curateAuditFilterPanel.on('filters-changed', (detail) => {
    if (detail.tabId !== 'curate-audit') return;
    syncCurateAuditStateFromFilters(detail.filters || {});
  });
  host.curateAuditFilterPanel.on('images-loaded', (detail) => {
    if (detail.tabId === 'curate-audit') {
      host.curateAuditImages = [...detail.images];
      host.curateAuditTotal = detail.total || 0;
    }
  });

  syncCurateHomeStateFromFilters(host.curateHomeFilterPanel.getState?.() || host.curateHomeFilterPanel.filters || {});
  syncCurateAuditStateFromFilters(host.curateAuditFilterPanel.getState?.() || host.curateAuditFilterPanel.filters || {});
}

function wireEventHandlers(host) {
  host._handleQueueCommandComplete = (event) =>
    host._appEventsState.handleQueueCommandComplete(event);
  host._handleQueueCommandFailed = (event) =>
    host._appEventsState.handleQueueCommandFailed(event);
  host._handleCurateGlobalPointerDown = (event) =>
    host._appEventsState.handleCurateGlobalPointerDown(event);
  host._handleCurateSelectionEnd = () =>
    host._appEventsState.handleCurateSelectionEnd();
}

export function initializeAppConstructorWiring(host) {
  initializeHotspotHandlers(host);
  initializeRatingHandlers(host);
  initializeSelectionHandlers(host);
  wireFilterPanelListeners(host);
  wireEventHandlers(host);
}
