import { BaseStateController } from './base-state-controller.js';
import {
  buildCurateAuditFilterObject,
  getCurateAuditFetchKey,
} from '../shared/curate-filters.js';
import {
  mergePermatags,
  resolveKeywordCategory,
} from '../shared/keyword-utils.js';
import { enqueueCommand } from '../../services/command-queue.js';

/**
 * Curate Audit State Controller
 *
 * Manages state and behavior for the Curate Audit tab (tag-audit subtab).
 * Handles audit mode selection, AI-enabled ML sorting, hotspot management,
 * and rating functionality.
 *
 * @extends BaseStateController
 */
export class CurateAuditStateController extends BaseStateController {
  constructor(host) {
    super(host);
  }

  // ========================================================================
  // MODE & FILTER MANAGEMENT
  // ========================================================================

  /**
   * Handle audit mode change (missing vs present permatags).
   * @param {string} mode - 'missing' or 'present'
   */
  handleModeChange(mode) {
    this.host.curateAuditMode = mode;
    this.host.curateAuditSelection = [];
    this.host.curateAuditDragSelection = [];
    this.host.curateAuditDragTarget = null;
    this.host.curateAuditOffset = 0;
    this.host.curateAuditTotal = null;
    this.host.curateAuditLoadAll = false;
    this.host.curateAuditPageOffset = 0;
    if (this.host.curateAuditKeyword) {
      this.host._fetchCurateAuditImages();
    }
    this.requestUpdate();
  }

  /**
   * Handle AI-enabled toggle for ML-based sorting.
   * @param {boolean} enabled - Whether AI sorting is enabled
   */
  handleAiEnabledChange(enabled) {
    this.host.curateAuditAiEnabled = enabled;
    if (!this.host.curateAuditAiEnabled) {
      this.host.curateAuditAiModel = '';
    }
    this.host.curateAuditOffset = 0;
    this.host.curateAuditTotal = null;
    this.host.curateAuditLoadAll = false;
    this.host.curateAuditPageOffset = 0;
    if (this.host.curateAuditKeyword && this.host.curateAuditMode === 'missing') {
      this.host._fetchCurateAuditImages();
    }
    this.requestUpdate();
  }

  /**
   * Handle AI model selection change.
   * @param {string} model - Model identifier
   */
  handleAiModelChange(model) {
    this.host.curateAuditAiModel = this.host.curateAuditAiModel === model ? '' : model;
    this.host.curateAuditOffset = 0;
    this.host.curateAuditTotal = null;
    this.host.curateAuditLoadAll = false;
    this.host.curateAuditPageOffset = 0;
    if (this.host.curateAuditKeyword && this.host.curateAuditMode === 'missing') {
      this.host._fetchCurateAuditImages();
    }
    this.requestUpdate();
  }

  /**
   * Handle keyword selection change.
   * @param {string} keywordId - Selected keyword ID
   */
  handleKeywordChange(keywordId, category = null) {
    this.host.curateAuditKeyword = keywordId;
    if (category !== null) {
      this.host.curateAuditCategory = category;
    }
    this.host.curateAuditSelection = [];
    this.host.curateAuditDragSelection = [];
    this.host.curateAuditDragTarget = null;
    this.host.curateAuditOffset = 0;
    this.host.curateAuditTotal = null;
    this.host.curateAuditLoadAll = false;
    this.host.curateAuditPageOffset = 0;
    if (!keywordId) {
      this.host.curateAuditImages = [];
      this.requestUpdate();
      return;
    }
    this.fetchCurateAuditImages();
    this.requestUpdate();
  }

  /**
   * Handle keyword change event from filter chips/dropdown.
   * @param {CustomEvent} e - Event detail with keywords map
   */
  handleKeywordEvent(e) {
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

    return this.handleKeywordChange(nextKeyword, nextCategory);
  }

  /**
   * Handle hide deleted toggle.
   * @param {boolean} checked - Whether to hide deleted images
   */
  handleHideDeletedChange(checked) {
    this.setHostProperty('curateAuditHideDeleted', checked);
    const keyword = this.getHostProperty('curateAuditKeyword');
    if (keyword) {
      this.fetchCurateAuditImages();
    }
  }

  /**
   * Handle minimum rating filter change.
   * @param {number|string|null} value - Rating value
   */
  handleMinRatingChange(value) {
    const currentRating = this.getHostProperty('curateAuditMinRating');
    const newRating = (currentRating === value) ? null : value;
    this.setHostProperty('curateAuditMinRating', newRating);

    const keyword = this.getHostProperty('curateAuditKeyword');
    if (keyword) {
      this.fetchCurateAuditImages();
    }
  }

  /**
   * Handle no positive permatags toggle.
   * @param {boolean} checked - Whether to filter by no positive permatags
   */
  handleNoPositivePermatagsChange(checked) {
    this.setHostProperty('curateAuditNoPositivePermatags', checked);
    const keyword = this.getHostProperty('curateAuditKeyword');
    if (keyword) {
      this.fetchCurateAuditImages();
    }
  }

  /**
   * Handle filter-chip changes for Curate Audit panel.
   * @param {CustomEvent} event - Event containing chip filters
   */
  handleChipFiltersChanged(event) {
    const chips = event.detail?.filters || [];
    const keywordChip = chips.find((chip) => chip.type === 'keyword');
    let nextKeyword = '';
    let nextCategory = '';
    if (keywordChip) {
      if (keywordChip.untagged || keywordChip.value === '__untagged__') {
        nextKeyword = '';
        nextCategory = '';
      } else if (
        keywordChip.keywordsByCategory &&
        typeof keywordChip.keywordsByCategory === 'object'
      ) {
        const entries = Object.entries(keywordChip.keywordsByCategory);
        if (entries.length) {
          const [category, values] = entries[0];
          const list = Array.isArray(values) ? values : Array.from(values || []);
          if (list.length) {
            nextCategory = category;
            nextKeyword = list[0];
          }
        }
      } else if (keywordChip.value) {
        nextKeyword = keywordChip.value;
        nextCategory = keywordChip.category || '';
      }
    }

    let nextMinRating = null;
    let nextHideDeleted = true;
    let nextDropboxPathPrefix = '';

    chips.forEach((chip) => {
      switch (chip.type) {
        case 'rating':
          if (chip.value === 'unrated') {
            nextMinRating = 'unrated';
            nextHideDeleted = true;
          } else {
            nextMinRating = chip.value;
            nextHideDeleted = false;
          }
          break;
        case 'folder':
          nextDropboxPathPrefix = chip.value || '';
          break;
        default:
          break;
      }
    });

    nextCategory = resolveKeywordCategory(nextKeyword, {
      fallbackCategory: nextCategory,
      keywords: this.host.keywords,
      tagStatsBySource: this.host.tagStatsBySource,
      activeTagSource: this.host.activeCurateTagSource,
    });

    const keywordChanged =
      nextKeyword !== this.host.curateAuditKeyword ||
      nextCategory !== this.host.curateAuditCategory;

    this.host.curateAuditKeyword = nextKeyword;
    this.host.curateAuditCategory = nextCategory;
    this.host.curateAuditMinRating = nextMinRating;
    this.host.curateAuditHideDeleted = nextHideDeleted;
    this.host.curateAuditDropboxPathPrefix = nextDropboxPathPrefix;
    this.host.curateAuditPageOffset = 0;
    this.host.curateAuditOffset = 0;
    this.host.curateAuditLoadAll = false;

    const defaultAction = this.host.curateAuditMode === 'existing' ? 'remove' : 'add';
    const [firstTarget, ...restTargets] = this.host.curateAuditTargets || [];
    const primaryType = firstTarget?.type || 'keyword';
    const primaryId = firstTarget?.id || 1;
    this.host.curateAuditTargets = [
      {
        ...firstTarget,
        id: primaryId,
        type: primaryType,
        category: nextKeyword ? nextCategory : '',
        keyword: nextKeyword,
        action: defaultAction,
        count: 0,
      },
      ...restTargets,
    ];

    if (keywordChanged) {
      this.host.curateAuditSelection = [];
      this.host.curateAuditDragSelection = [];
      this.host.curateAuditDragTarget = null;
      this.host.curateAuditDragSelecting = false;
      this.host.curateAuditDragStartIndex = null;
      this.host.curateAuditDragEndIndex = null;
    }

    this.syncHotspotPrimary();

    if (!this.host.curateAuditKeyword) {
      this.host.curateAuditImages = [];
      this.host.curateAuditTotal = null;
      this.requestUpdate();
      return;
    }

    this.fetchCurateAuditImages();
  }

  // ========================================================================
  // HOTSPOT MANAGEMENT
  // ========================================================================

  /**
   * Handle hotspot configuration change (unified handler).
   * @param {Object} event - Event with change details
   */
  handleHotspotChanged(event) {
    const { changeType, targetId, value } = event.detail;

    switch (changeType) {
      case 'keyword':
        return this.handleHotspotKeywordChange(value, targetId);
      case 'action':
        return this.handleHotspotActionChange(value, targetId);
      case 'type':
        return this.handleHotspotTypeChange(value, targetId);
      case 'rating':
        return this.handleHotspotRatingChange(value, targetId);
      case 'add':
        return this.handleHotspotAddTarget();
      case 'remove':
        return this.handleHotspotRemoveTarget(targetId);
      case 'drop':
        return this.handleHotspotDrop(event.detail.event, targetId);
      default:
        console.warn('Unknown hotspot change type:', changeType);
    }
  }

  /**
   * Handle hotspot keyword selection change.
   * @param {string} value - Keyword value
   * @param {string} targetId - Target hotspot ID
   */
  handleHotspotKeywordChange(value, targetId) {
    const targets = this.getHostProperty('curateAuditTargets') || [];
    const updated = targets.map((target) =>
      target.id === targetId ? { ...target, keyword: value } : target
    );
    this.setHostProperty('curateAuditTargets', updated);
    this.syncHotspotPrimary();
  }

  /**
   * Handle hotspot action change (add/remove).
   * @param {string} value - Action value
   * @param {string} targetId - Target hotspot ID
   */
  handleHotspotActionChange(value, targetId) {
    const targets = this.getHostProperty('curateAuditTargets') || [];
    const updated = targets.map((target) =>
      target.id === targetId ? { ...target, action: value } : target
    );
    this.setHostProperty('curateAuditTargets', updated);
  }

  /**
   * Handle hotspot type change (tags/rating).
   * @param {string} value - Type value
   * @param {string} targetId - Target hotspot ID
   */
  handleHotspotTypeChange(value, targetId) {
    const targets = this.getHostProperty('curateAuditTargets') || [];
    const updated = targets.map((target) =>
      target.id === targetId ? { ...target, type: value } : target
    );
    this.setHostProperty('curateAuditTargets', updated);
  }

  /**
   * Handle hotspot rating selection change.
   * @param {string} value - Rating value
   * @param {string} targetId - Target hotspot ID
   */
  handleHotspotRatingChange(value, targetId) {
    const targets = this.getHostProperty('curateAuditTargets') || [];
    const updated = targets.map((target) =>
      target.id === targetId ? { ...target, rating: value } : target
    );
    this.setHostProperty('curateAuditTargets', updated);
  }

  /**
   * Add a new hotspot target.
   */
  handleHotspotAddTarget() {
    const targets = this.getHostProperty('curateAuditTargets') || [];
    const newTarget = {
      id: `audit-hotspot-${Date.now()}`,
      type: 'tags',
      keyword: '',
      action: 'add',
      rating: null,
      count: 0,
    };
    this.setHostProperty('curateAuditTargets', [...targets, newTarget]);
  }

  /**
   * Remove a hotspot target.
   * @param {string} targetId - Target hotspot ID to remove
   */
  handleHotspotRemoveTarget(targetId) {
    const targets = this.getHostProperty('curateAuditTargets') || [];
    const filtered = targets.filter((target) => target.id !== targetId);
    this.setHostProperty('curateAuditTargets', filtered);
  }

  /**
   * Handle drag over hotspot.
   * @param {DragEvent} event - Drag event
   * @param {string} targetId - Target hotspot ID
   */
  handleHotspotDragOver(event, targetId) {
    event.preventDefault();
    this.setHostProperty('_curateAuditHotspotDragTarget', targetId);
    this.requestUpdate();
  }

  /**
   * Handle drag leave hotspot.
   */
  handleHotspotDragLeave() {
    this.setHostProperty('_curateAuditHotspotDragTarget', null);
    this.requestUpdate();
  }

  /**
   * Handle drop on hotspot.
   * @param {DragEvent} event - Drop event
   * @param {string} targetId - Target hotspot ID
   */
  handleHotspotDrop(event, targetId) {
    event.preventDefault();
    this.setHostProperty('_curateAuditHotspotDragTarget', null);

    const targets = this.getHostProperty('curateAuditTargets') || [];
    const target = targets.find((t) => t.id === targetId);

    if (!target) {
      this.handleHotspotDragLeave();
      return;
    }

    // Extract image IDs from drag data
    const raw = event.dataTransfer?.getData('text/plain') || '';
    const ids = raw
      .split(',')
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value) && value > 0);

    if (!ids.length) {
      this.handleHotspotDragLeave();
      return;
    }

    // Update count
    const updated = targets.map((t) =>
      t.id === targetId ? { ...t, count: (t.count || 0) + ids.length } : t
    );
    this.setHostProperty('curateAuditTargets', updated);

    // Process based on hotspot type
    if (target.type === 'rating') {
      if (!target.rating) {
        this.handleHotspotDragLeave();
        return;
      }
      this.host._applyAuditRating(ids, Number.parseInt(target.rating, 10));
    } else if (target.type === 'tags') {
      if (!target.keyword) {
        this.handleHotspotDragLeave();
        return;
      }
      this.processTagDrop(ids, target);
    }

    this.handleHotspotDragLeave();
  }

  /**
   * Sync primary hotspot keyword with audit keyword filter.
   */
  syncHotspotPrimary() {
    const defaultAction = this.host.curateAuditMode === 'existing' ? 'remove' : 'add';
    const keyword = this.host.curateAuditKeyword || '';
    let category = '';

    if (keyword) {
      category = this.host.curateAuditCategory || '';
      if (!category) {
        const match = (this.host.keywords || []).find((kw) => kw?.keyword === keyword);
        category = match?.category || '';
      }
      if (!category) {
        category = 'Uncategorized';
      }
    }

    if (keyword && category && this.host.curateAuditCategory !== category) {
      this.host.curateAuditCategory = category;
    }

    if (!this.host.curateAuditTargets || !this.host.curateAuditTargets.length) {
      this.host.curateAuditTargets = [
        { id: 1, type: 'keyword', category, keyword, action: defaultAction, count: 0 },
      ];
      this.host._curateAuditHotspotNextId = 2;
      this.requestUpdate();
      return;
    }

    const [first, ...rest] = this.host.curateAuditTargets;
    const nextFirst = {
      ...first,
      type: first?.type || 'keyword',
      category,
      keyword,
      action: defaultAction,
    };
    if (!keyword || first.keyword !== keyword || first.action !== defaultAction) {
      nextFirst.count = 0;
    }
    this.host.curateAuditTargets = [nextFirst, ...rest];
    this.requestUpdate();
  }

  processTagDrop(ids, target) {
    const idSet = new Set(ids);
    const additions = this.host.curateAuditImages.filter((img) => idSet.has(img.id));
    if (!additions.length) {
      return;
    }

    const signum = target.action === 'remove' ? -1 : 1;
    const category = target.category || 'Uncategorized';
    const operations = additions.map((image) => ({
      image_id: image.id,
      keyword: target.keyword,
      category,
      signum,
    }));

    enqueueCommand({
      type: 'bulk-permatags',
      tenantId: this.host.tenant,
      operations,
      description: `tag audit · ${operations.length} updates`,
    });

    additions.forEach((image) => {
      this.applyPermatagChange(image, signum, target.keyword, category);
    });
    this.host.curateAuditImages = this.host.curateAuditImages.filter((img) => !idSet.has(img.id));
    this.host.curateAuditDragSelection = this.host.curateAuditDragSelection.filter((id) => !idSet.has(id));
    this.requestUpdate();
  }

  applyPermatagChange(image, signum, keyword, category) {
    const permatags = Array.isArray(image?.permatags) ? image.permatags : [];
    if (signum === 1) {
      return { ...image, permatags: mergePermatags(permatags, [{ keyword, category }]) };
    }
    const matches = (tag) =>
      tag.keyword === keyword &&
      (tag.category || 'Uncategorized') === (category || 'Uncategorized');
    const next = permatags.filter((tag) => !(tag.signum === 1 && matches(tag)));
    return { ...image, permatags: next };
  }

  refreshAudit() {
    if (this.host.curateAuditLoadAll) {
      this.fetchCurateAuditImages({ loadAll: true });
      return;
    }
    const offset = this.host.curateAuditPageOffset || 0;
    this.fetchCurateAuditImages({ offset });
  }

  // ========================================================================
  // RATING MANAGEMENT
  // ========================================================================

  /**
   * Toggle audit rating mode.
   */
  handleRatingToggle() {
    const enabled = this.getHostProperty('curateAuditRatingEnabled');
    this.setHostProperty('curateAuditRatingEnabled', !enabled);
  }

  /**
   * Handle drag over rating drop zone.
   * @param {DragEvent} event - Drag event
   */
  handleRatingDragOver(event) {
    event.preventDefault();
    this.setHostProperty('_auditRatingDragTarget', true);
    this.requestUpdate();
  }

  /**
   * Handle drag leave rating drop zone.
   */
  handleRatingDragLeave() {
    this.setHostProperty('_auditRatingDragTarget', false);
    this.requestUpdate();
  }

  /**
   * Handle drop on rating zone.
   * @param {DragEvent} event - Drop event
   */
  handleRatingDrop(event) {
    event.preventDefault();
    const raw = event.dataTransfer?.getData('text/plain') || '';
    const ids = raw
      .split(',')
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value) && value > 0);

    if (!ids.length) {
      this.handleRatingDragLeave();
      return;
    }

    // Show rating selection dialog
    this.host._showAuditRatingDialog(ids);
    this.handleRatingDragLeave();
  }

  // ========================================================================
  // IMAGE MANAGEMENT
  // ========================================================================

  /**
   * Remove images by IDs from audit list.
   * @param {Array<number>} ids - Image IDs to remove
   */
  removeImagesByIds(ids) {
    if (!ids?.length) return;

    const removeSet = new Set(ids);
    const keep = (image) => !removeSet.has(image.id);

    // Remove from image list
    const auditImages = this.getHostProperty('curateAuditImages');
    this.setHostProperty('curateAuditImages', auditImages.filter(keep));

    // Remove from selection
    const auditSelection = this.getHostProperty('curateAuditDragSelection');
    this.setHostProperty('curateAuditDragSelection', auditSelection.filter((id) => !removeSet.has(id)));
  }

  // ========================================================================
  // LOADING & DATA FETCHING
  // ========================================================================

  /**
   * Start audit loading indicator.
   */
  startLoading() {
    const currentCount = this.host._curateAuditLoadCount || 0;
    this.host._curateAuditLoadCount = currentCount + 1;
    this.setHostProperty('curateAuditLoading', true);
  }

  /**
   * Finish audit loading indicator.
   */
  finishLoading() {
    const currentCount = this.host._curateAuditLoadCount || 1;
    this.host._curateAuditLoadCount = Math.max(0, currentCount - 1);
    this.setHostProperty('curateAuditLoading', this.host._curateAuditLoadCount > 0);
  }

  /**
   * Fetch curate audit images.
   * @param {Object} options - Fetch options
   * @returns {Promise<void>}
   */
  async fetchCurateAuditImages(options = {}) {
    const curateAuditFilterPanel = this.getHostProperty('curateAuditFilterPanel');
    if (!curateAuditFilterPanel) return;
    if (!this.host.tenant || !this.host.curateAuditKeyword) return;

    const { append = false, loadAll = false, offset = null } = options;
    const useLoadAll = loadAll || this.host.curateAuditLoadAll;
    const resolvedOffset =
      offset !== null && offset !== undefined
        ? offset
        : append
          ? this.host.curateAuditOffset
          : (this.host.curateAuditPageOffset || 0);
    const fetchKey = getCurateAuditFetchKey(this.host, {
      loadAll: useLoadAll,
      offset: resolvedOffset,
    });

    if (this.host.curateAuditMinRating === 0 && this.host.curateAuditHideDeleted) {
      this.host.curateAuditImages = [];
      this.host.curateAuditOffset = 0;
      this.host.curateAuditTotal = 0;
      this.host.curateAuditPageOffset = 0;
      this.host._curateAuditLastFetchKey = fetchKey;
      this.requestUpdate();
      return;
    }

    this.startLoading();
    const existingImages = append ? [...(this.host.curateAuditImages || [])] : null;
    try {
      const filters = buildCurateAuditFilterObject(this.host, {
        loadAll: useLoadAll,
        offset: resolvedOffset,
      });
      curateAuditFilterPanel.updateFilters(filters);
      const result = await curateAuditFilterPanel.fetchImages();

      const images = Array.isArray(result) ? result : (result?.images || []);
      const total = Array.isArray(result)
        ? null
        : (Number.isFinite(result?.total) ? result.total : null);

      if (append) {
        this.host.curateAuditImages = [...(existingImages || []), ...images];
      } else {
        this.host.curateAuditImages = images;
      }

      if (!useLoadAll) {
        this.host.curateAuditPageOffset = resolvedOffset;
        this.host.curateAuditOffset = resolvedOffset + images.length;
        this.host.curateAuditTotal = total;
      } else {
        this.host.curateAuditOffset = images.length;
        this.host.curateAuditTotal = images.length;
      }
      this.host._curateAuditLastFetchKey = fetchKey;
      this.requestUpdate();
    } catch (error) {
      console.error('Error fetching curate audit images:', error);
    } finally {
      this.finishLoading();
    }
  }

  // ========================================================================
  // STATE MANAGEMENT
  // ========================================================================

  /**
   * Get default audit state for initialization.
   * @returns {Object} Default state object
   */
  getDefaultState() {
    return {
      curateAuditMode: 'missing',
      curateAuditKeyword: null,
      curateAuditCategory: null,
      curateAuditAiEnabled: false,
      curateAuditAiModel: null,
      curateAuditHideDeleted: true,
      curateAuditMinRating: null,
      curateAuditNoPositivePermatags: false,
      curateAuditTargets: [],
      curateAuditImages: [],
      curateAuditLoading: false,
      curateAuditDragSelection: [],
      curateAuditRatingEnabled: false,
      _curateAuditHotspotDragTarget: null,
      _auditRatingDragTarget: false,
    };
  }

  /**
   * Snapshot current audit state for restoration later.
   * @returns {Object} Current state snapshot
   */
  snapshotState() {
    const host = this.host;
    return {
      curateAuditMode: host.curateAuditMode,
      curateAuditKeyword: host.curateAuditKeyword,
      curateAuditCategory: host.curateAuditCategory,
      curateAuditAiEnabled: host.curateAuditAiEnabled,
      curateAuditAiModel: host.curateAuditAiModel,
      curateAuditHideDeleted: host.curateAuditHideDeleted,
      curateAuditMinRating: host.curateAuditMinRating,
      curateAuditNoPositivePermatags: host.curateAuditNoPositivePermatags,
      curateAuditTargets: Array.isArray(host.curateAuditTargets) ? [...host.curateAuditTargets] : [],
      curateAuditImages: Array.isArray(host.curateAuditImages) ? [...host.curateAuditImages] : [],
      curateAuditLoading: host.curateAuditLoading,
      curateAuditDragSelection: Array.isArray(host.curateAuditDragSelection) ? [...host.curateAuditDragSelection] : [],
      curateAuditRatingEnabled: host.curateAuditRatingEnabled,
      _curateAuditHotspotDragTarget: host._curateAuditHotspotDragTarget,
      _auditRatingDragTarget: host._auditRatingDragTarget,
    };
  }

  /**
   * Restore audit state from a previous snapshot.
   * @param {Object} snapshot - State snapshot to restore
   */
  restoreState(snapshot) {
    if (!snapshot) return;

    // Restore all properties from snapshot
    Object.entries(snapshot).forEach(([key, value]) => {
      // Deep copy arrays
      if (Array.isArray(value)) {
        this.host[key] = [...value];
      } else if (value && typeof value === 'object') {
        this.host[key] = { ...value };
      } else {
        this.host[key] = value;
      }
    });

    this.requestUpdate();
  }

  /**
   * Reset Curate Audit state when tenant changes.
   */
  resetForTenantChange() {
    this.host.curateAuditMode = 'existing';
    this.host.curateAuditKeyword = '';
    this.host.curateAuditCategory = '';
    this.host.curateAuditImages = [];
    this.host.curateAuditSelection = [];
    this.host.curateAuditDragTarget = null;
    this.host.curateAuditDragSelection = [];
    this.host.curateAuditDragSelecting = false;
    this.host.curateAuditDragStartIndex = null;
    this.host.curateAuditDragEndIndex = null;
    this.host.curateAuditOffset = 0;
    this.host.curateAuditTotal = null;
    this.host.curateAuditLoading = false;
    this.host.curateAuditLoadAll = false;
    this.host.curateAuditPageOffset = 0;
    this.host.curateAuditAiEnabled = false;
    this.host.curateAuditAiModel = '';
    this.host.curateAuditDropboxPathPrefix = '';
    this.requestUpdate();
  }
}
