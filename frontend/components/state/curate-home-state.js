import { BaseStateController } from './base-state-controller.js';
import {
  buildCurateFilterObject,
  getCurateHomeFetchKey,
} from '../shared/curate-filters.js';
import {
  buildCategoryCards,
  getCategoryCount,
  getKeywordsByCategory,
} from '../shared/keyword-utils.js';

/**
 * Curate Home State Controller
 *
 * Manages state and handlers for the Curate Home tab (Explore mode).
 * This includes:
 * - Filter state (keywords, ratings, sorting, date ranges)
 * - Selection handlers (drag, multi-select)
 * - Image loading and pagination
 * - Flash selection animations
 *
 * Migration Status: Slice 1 (Filter State) - IN PROGRESS
 */
export class CurateHomeStateController extends BaseStateController {
  constructor(host) {
    super(host);
  }

  // ========================================================================
  // SLICE 1: FILTER STATE METHODS
  // ========================================================================

  /**
   * Handle keyword selection from the filter dropdown.
   * Updates curateKeywordFilters and triggers image refresh.
   *
   * @param {Event} event - The change event from the select element
   * @param {string} mode - The mode ('tag-audit' or normal curate)
   */
  handleKeywordSelect(event, mode) {
    const rawValue = event.target.value || '';

    // Clear filters if no value selected
    if (!rawValue) {
      if (mode === 'tag-audit') {
        // Audit mode - clear audit-specific state
        this.setHostProperties({
          curateAuditKeyword: '',
          curateAuditCategory: '',
          curateAuditSelection: [],
          curateAuditDragSelection: [],
          curateAuditDragTarget: null,
          curateAuditOffset: 0,
          curateAuditTotal: null,
          curateAuditLoadAll: false,
          curateAuditPageOffset: 0,
          curateAuditImages: [],
        });
      } else {
        // Curate Home mode - clear filters and refresh
        this.setHostProperties({
          curateKeywordFilters: {},
          curateKeywordOperators: {},
          curateNoPositivePermatags: false,
        });
        this.applyCurateFilters();
      }
      return;
    }

    // Handle special __untagged__ filter
    if (mode !== 'tag-audit' && rawValue === '__untagged__') {
      this.setHostProperties({
        curateKeywordFilters: {},
        curateKeywordOperators: {},
        curateNoPositivePermatags: true,
      });
      this.applyCurateFilters({ resetOffset: true });
      return;
    }

    // Parse category and keyword from encoded value
    const [encodedCategory, ...encodedKeywordParts] = rawValue.split('::');
    const category = decodeURIComponent(encodedCategory || '');
    const keyword = decodeURIComponent(encodedKeywordParts.join('::') || '');

    if (mode === 'tag-audit') {
      // Audit mode - update audit state and fetch audit images
      this.setHostProperties({
        curateAuditKeyword: keyword,
        curateAuditCategory: category,
        curateAuditSelection: [],
        curateAuditDragSelection: [],
        curateAuditDragTarget: null,
        curateAuditOffset: 0,
        curateAuditTotal: null,
        curateAuditLoadAll: false,
        curateAuditPageOffset: 0,
      });

      if (!keyword) {
        this.setHostProperty('curateAuditImages', []);
        return;
      }

      // Fetch audit images (delegated back to main app for now)
      this.host._fetchCurateAuditImages();
      return;
    }

    // Curate Home mode - update keyword filters
    const nextKeywords = {};
    if (keyword) {
      nextKeywords[category || 'Uncategorized'] = new Set([keyword]);
    }

    this.setHostProperties({
      curateKeywordFilters: nextKeywords,
      curateKeywordOperators: keyword
        ? { [category || 'Uncategorized']: 'OR' }
        : {},
      curateNoPositivePermatags: false,
    });

    this.applyCurateFilters({ resetOffset: true });
  }

  /**
   * Handle tag source change (permatags vs machine tags).
   * @param {CustomEvent} e - Event with source detail
   */
  handleTagSourceChange(e) {
    const source = e.detail?.source || 'permatags';
    this.setHostProperty('activeCurateTagSource', source);
    this.updateCurateCategoryCards();
  }

  /**
   * Handle "Hide Deleted" checkbox change.
   * @param {Event} e - The checkbox change event
   */
  handleHideDeletedChange(e) {
    this.setHostProperty('curateHideDeleted', e.target.checked);
    this.applyCurateFilters({ resetOffset: true });
  }

  /**
   * Handle "No Positive Permatags" checkbox change.
   * Shows only images without any positive permatags.
   * @param {Event} e - The checkbox change event
   */
  handleNoPositivePermatagsChange(e) {
    this.setHostProperty('curateNoPositivePermatags', e.target.checked);

    // Refresh the currently active tab only
    const curateSubTab = this.getHostProperty('curateSubTab');
    if (curateSubTab === 'main') {
      const curateFilters = buildCurateFilterObject(this.host, { resetOffset: true });
      const curateHomeFilterPanel = this.getHostProperty('curateHomeFilterPanel');
      if (curateHomeFilterPanel) {
        curateHomeFilterPanel.updateFilters(curateFilters);
        this.fetchCurateHomeImages();
      }
    } else if (curateSubTab === 'tag-audit') {
      const curateAuditKeyword = this.getHostProperty('curateAuditKeyword');
      if (curateAuditKeyword) {
        this.host._fetchCurateAuditImages();
      }
    }
  }

  /**
   * Handle minimum rating filter change.
   * Toggle behavior: clicking the same rating clears the filter.
   * @param {number|null} value - The rating value (1-5) or null
   */
  handleMinRating(value) {
    const currentRating = this.getHostProperty('curateMinRating');
    const newRating = currentRating === value ? null : value;

    this.setHostProperty('curateMinRating', newRating);

    // Refresh the currently active tab only
    const curateSubTab = this.getHostProperty('curateSubTab');
    if (curateSubTab === 'main') {
      const curateFilters = buildCurateFilterObject(this.host, {
        rating: newRating,
        resetOffset: true,
      });
      const curateHomeFilterPanel = this.getHostProperty('curateHomeFilterPanel');
      if (curateHomeFilterPanel) {
        curateHomeFilterPanel.updateFilters(curateFilters);
        this.fetchCurateHomeImages();
      }
    } else if (curateSubTab === 'tag-audit') {
      const curateAuditKeyword = this.getHostProperty('curateAuditKeyword');
      if (curateAuditKeyword) {
        this.host._fetchCurateAuditImages();
      }
    }
  }

  /**
   * Handle filter-chip changes from Curate Explore panel.
   * @param {CustomEvent} event - Event containing filter chips
   */
  handleChipFiltersChanged(event) {
    const chips = event.detail?.filters || [];
    const nextKeywords = {};
    const nextOperators = {};
    let nextMinRating = null;
    let nextNoPositivePermatags = false;
    let nextDropboxPathPrefix = '';
    let nextFilenameQuery = '';
    let nextMediaType = 'all';
    let nextHideDeleted = true;
    let nextListId = '';
    let nextListExcludeId = '';
    let nextCategoryFilterOperator = undefined;

    chips.forEach((chip) => {
      switch (chip.type) {
        case 'keyword': {
          if (chip.untagged || chip.value === '__untagged__') {
            nextNoPositivePermatags = true;
            break;
          }
          const keywordsByCategory =
            chip.keywordsByCategory && typeof chip.keywordsByCategory === 'object'
              ? chip.keywordsByCategory
              : (chip.category && chip.value ? { [chip.category]: [chip.value] } : {});
          const operator = chip.operator || 'OR';
          nextCategoryFilterOperator = operator;
          Object.entries(keywordsByCategory).forEach(([category, values]) => {
            const list = Array.isArray(values) ? values : Array.from(values || []);
            if (!list.length) return;
            if (!nextKeywords[category]) {
              nextKeywords[category] = new Set();
            }
            list.forEach((value) => nextKeywords[category].add(value));
            nextOperators[category] = operator;
          });
          break;
        }
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
        case 'filename':
          nextFilenameQuery = chip.value || '';
          break;
        case 'media':
          nextMediaType = chip.value === 'video' ? 'video' : (chip.value === 'image' ? 'image' : 'all');
          break;
        case 'list':
          if (chip.mode === 'exclude') {
            nextListExcludeId = chip.value || '';
          } else {
            nextListId = chip.value || '';
          }
          break;
        default:
          break;
      }
    });

    if (nextNoPositivePermatags) {
      Object.keys(nextKeywords).forEach((key) => delete nextKeywords[key]);
      Object.keys(nextOperators).forEach((key) => delete nextOperators[key]);
      nextCategoryFilterOperator = undefined;
    }

    this.setHostProperties({
      curateKeywordFilters: nextKeywords,
      curateKeywordOperators: nextOperators,
      curateNoPositivePermatags: nextNoPositivePermatags,
      curateMinRating: nextMinRating,
      curateHideDeleted: nextHideDeleted,
      curateMediaType: nextMediaType,
      curateDropboxPathPrefix: nextDropboxPathPrefix,
      curateFilenameQuery: nextFilenameQuery,
      curateListId: nextListId,
      curateListExcludeId: nextListExcludeId,
      curateCategoryFilterOperator: nextCategoryFilterOperator,
    });

    this.applyCurateFilters({ resetOffset: true });
  }

  /**
   * Exclude a list from Curate results from right-panel action.
   * @param {CustomEvent} event - Event with listId
   */
  handleListExcludeFromRightPanel(event) {
    const listId = event?.detail?.listId ? String(event.detail.listId) : '';
    if (!listId) return;
    this.setHostProperties({
      curateListId: '',
      curateListExcludeId: listId,
    });
    this.applyCurateFilters({ resetOffset: true });
  }

  /**
   * Apply current curate filters and fetch images.
   * @param {Object} options - Options for filter application
   * @param {boolean} options.resetOffset - Whether to reset pagination offset
   */
  applyCurateFilters(options = {}) {
    const curateHomeFilterPanel = this.getHostProperty('curateHomeFilterPanel');
    if (!curateHomeFilterPanel) return;

    // Preserve existing behavior: hide deleted + rating 0 means empty result.
    if (this.host.curateMinRating === 0 && this.host.curateHideDeleted) {
      this.host.curateImages = [];
      this.host.curateTotal = 0;
      if (options.resetOffset) {
        this.host.curatePageOffset = 0;
      }
      this.requestUpdate();
      return;
    }

    const filters = buildCurateFilterObject(this.host, options);
    curateHomeFilterPanel.updateFilters(filters);
    this.fetchCurateHomeImages();

    // Keep local filter mirror for UI state.
    if (options.resetOffset) {
      this.host.curatePageOffset = 0;
    }
    this.host.curateFilters = { ...filters };
    this.requestUpdate();
  }

  // ========================================================================
  // SLICE 2: SORTING METHODS
  // ========================================================================

  /**
   * Handle order by (sort field) change.
   * @param {Event} e - The select change event
   */
  handleOrderByChange(e) {
    this.setHostProperty('curateOrderBy', e.target.value);

    // Refresh the currently active tab only
    const curateSubTab = this.getHostProperty('curateSubTab');
    if (curateSubTab === 'main') {
      const curateFilters = buildCurateFilterObject(this.host, { resetOffset: true });
      const curateHomeFilterPanel = this.getHostProperty('curateHomeFilterPanel');
      if (curateHomeFilterPanel) {
        curateHomeFilterPanel.updateFilters(curateFilters);
        this.fetchCurateHomeImages();
      }
    } else if (curateSubTab === 'tag-audit') {
      const curateAuditKeyword = this.getHostProperty('curateAuditKeyword');
      if (curateAuditKeyword) {
        this.host._fetchCurateAuditImages();
      }
    }
  }

  /**
   * Handle order direction (asc/desc) change.
   * @param {Event} e - The select change event
   */
  handleOrderDirectionChange(e) {
    this.setHostProperty('curateOrderDirection', e.target.value);

    // Refresh the currently active tab only
    const curateSubTab = this.getHostProperty('curateSubTab');
    if (curateSubTab === 'main') {
      const curateFilters = buildCurateFilterObject(this.host, { resetOffset: true });
      const curateHomeFilterPanel = this.getHostProperty('curateHomeFilterPanel');
      if (curateHomeFilterPanel) {
        curateHomeFilterPanel.updateFilters(curateFilters);
        this.fetchCurateHomeImages();
      }
    } else if (curateSubTab === 'tag-audit') {
      const curateAuditKeyword = this.getHostProperty('curateAuditKeyword');
      if (curateAuditKeyword) {
        this.host._fetchCurateAuditImages();
      }
    }
  }

  /**
   * Handle quick sort - click on a column header to sort by that field.
   * Toggles direction if already sorted by that field.
   * @param {string} orderBy - The field to sort by
   */
  handleQuickSort(orderBy) {
    const currentOrderBy = this.getHostProperty('curateOrderBy');
    const currentOrderDirection = this.getHostProperty('curateOrderDirection');

    if (currentOrderBy === orderBy) {
      // Toggle direction if already sorting by this field
      const newDirection = currentOrderDirection === 'desc' ? 'asc' : 'desc';
      this.setHostProperty('curateOrderDirection', newDirection);
    } else {
      // New field - default to descending
      this.setHostProperties({
        curateOrderBy: orderBy,
        curateOrderDirection: 'desc',
      });
    }

    // Refresh the currently active tab only
    const curateSubTab = this.getHostProperty('curateSubTab');
    if (curateSubTab === 'main') {
      const curateFilters = buildCurateFilterObject(this.host, { resetOffset: true });
      const curateHomeFilterPanel = this.getHostProperty('curateHomeFilterPanel');
      if (curateHomeFilterPanel) {
        curateHomeFilterPanel.updateFilters(curateFilters);
        this.fetchCurateHomeImages();
      }
    } else if (curateSubTab === 'tag-audit') {
      const curateAuditKeyword = this.getHostProperty('curateAuditKeyword');
      if (curateAuditKeyword) {
        this.host._fetchCurateAuditImages();
      }
    }
  }

  // ========================================================================
  // SLICE 3: STATE MANAGEMENT METHODS
  // ========================================================================

  /**
   * Get default curate state for initialization.
   * @returns {Object} Default state object
   */
  getDefaultState() {
    return {
      curateLimit: 100,
      curateOrderBy: 'photo_creation',
      curateOrderDirection: 'desc',
      curateMediaType: 'all',
      curateHideDeleted: true,
      curateMinRating: null,
      curateKeywordFilters: {},
      curateKeywordOperators: {},
      curateDropboxPathPrefix: '',
      curateFilenameQuery: '',
      curateListId: '',
      curateListExcludeId: '',
      curateFilters: buildCurateFilterObject(this.host),
      curateImages: [],
      curatePageOffset: 0,
      curateTotal: null,
      curateLoading: false,
      curateDragSelection: [],
      curateDragSelecting: false,
      curateDragStartIndex: null,
      curateDragEndIndex: null,
      curateNoPositivePermatags: false,
      _curateLeftOrder: [],
      _curateRightOrder: [],
      _curateFlashSelectionIds: null,
    };
  }

  /**
   * Snapshot current curate state for restoration later.
   * @returns {Object} Current state snapshot
   */
  snapshotState() {
    const host = this.host;
    return {
      curateLimit: host.curateLimit,
      curateOrderBy: host.curateOrderBy,
      curateOrderDirection: host.curateOrderDirection,
      curateMediaType: host.curateMediaType,
      curateHideDeleted: host.curateHideDeleted,
      curateMinRating: host.curateMinRating,
      curateKeywordFilters: { ...(host.curateKeywordFilters || {}) },
      curateKeywordOperators: { ...(host.curateKeywordOperators || {}) },
      curateDropboxPathPrefix: host.curateDropboxPathPrefix,
      curateFilenameQuery: host.curateFilenameQuery,
      curateListId: host.curateListId,
      curateListExcludeId: host.curateListExcludeId,
      curateFilters: { ...(host.curateFilters || {}) },
      curateImages: Array.isArray(host.curateImages) ? [...host.curateImages] : [],
      curatePageOffset: host.curatePageOffset,
      curateTotal: host.curateTotal,
      curateLoading: host.curateLoading,
      curateDragSelection: Array.isArray(host.curateDragSelection) ? [...host.curateDragSelection] : [],
      curateDragSelecting: host.curateDragSelecting,
      curateDragStartIndex: host.curateDragStartIndex,
      curateDragEndIndex: host.curateDragEndIndex,
      curateNoPositivePermatags: host.curateNoPositivePermatags,
      _curateLeftOrder: Array.isArray(host._curateLeftOrder) ? [...host._curateLeftOrder] : [],
      _curateRightOrder: Array.isArray(host._curateRightOrder) ? [...host._curateRightOrder] : [],
      _curateFlashSelectionIds: host._curateFlashSelectionIds ? new Set(host._curateFlashSelectionIds) : null,
    };
  }

  /**
   * Restore curate state from a previous snapshot.
   * @param {Object} snapshot - State snapshot to restore
   */
  restoreState(snapshot) {
    if (!snapshot) return;

    // Restore all properties from snapshot
    Object.entries(snapshot).forEach(([key, value]) => {
      // Deep copy arrays and sets
      if (Array.isArray(value)) {
        this.host[key] = [...value];
      } else if (value instanceof Set) {
        this.host[key] = new Set(value);
      } else if (value && typeof value === 'object') {
        this.host[key] = { ...value };
      } else {
        this.host[key] = value;
      }
    });

    this.requestUpdate();
  }

  // ========================================================================
  // HELPER METHODS
  // ========================================================================

  /**
   * Update category cards based on current tag source.
   */
  updateCurateCategoryCards() {
    const tagStatsBySource = this.getHostProperty('tagStatsBySource');
    const activeCurateTagSource = this.getHostProperty('activeCurateTagSource');
    const sourceStats = tagStatsBySource?.[activeCurateTagSource] || {};
    const curateCategoryCards = buildCategoryCards(sourceStats, true);
    this.setHostProperty('curateCategoryCards', curateCategoryCards);
  }

  /**
   * Get keywords organized by category.
   * @returns {Object} Keywords grouped by category
   */
  getKeywordsByCategory() {
    const tagStatsBySource = this.getHostProperty('tagStatsBySource');
    const activeCurateTagSource = this.getHostProperty('activeCurateTagSource');
    return getKeywordsByCategory(tagStatsBySource, activeCurateTagSource);
  }

  /**
   * Get count of images for a specific category.
   * @param {string} category - The category name
   * @returns {number} Count of images
   */
  getCategoryCount(category) {
    const tagStatsBySource = this.getHostProperty('tagStatsBySource');
    const activeCurateTagSource = this.getHostProperty('activeCurateTagSource');
    return getCategoryCount(tagStatsBySource, category, activeCurateTagSource);
  }

  /**
   * Start curate loading indicator.
   */
  startLoading() {
    const currentCount = this.host._curateLoadCount || 0;
    this.host._curateLoadCount = currentCount + 1;
    this.setHostProperty('curateLoading', true);
  }

  /**
   * Finish curate loading indicator.
   */
  finishLoading() {
    const currentCount = this.host._curateLoadCount || 1;
    this.host._curateLoadCount = Math.max(0, currentCount - 1);
    this.setHostProperty('curateLoading', this.host._curateLoadCount > 0);
  }

  /**
   * Fetch curate home images (Explore tab).
   * @returns {Promise<void>}
   */
  async fetchCurateHomeImages() {
    const curateHomeFilterPanel = this.getHostProperty('curateHomeFilterPanel');
    if (!curateHomeFilterPanel) return;

    this.startLoading();
    try {
      return await curateHomeFilterPanel.fetchImages();
    } finally {
      this.finishLoading();
    }
  }

  // ========================================================================
  // SLICE 4: SELECTION & IMAGE MANAGEMENT
  // ========================================================================

  /**
   * Remove images by IDs from curate list.
   * @param {Array<number>} ids - Image IDs to remove
   */
  removeImagesByIds(ids) {
    if (!ids?.length) return;

    const removeSet = new Set(ids);
    const keep = (image) => !removeSet.has(image.id);

    // Remove from image list
    const curateImages = this.getHostProperty('curateImages');
    this.setHostProperty('curateImages', curateImages.filter(keep));

    // Remove from selection
    const curateDragSelection = this.getHostProperty('curateDragSelection');
    this.setHostProperty('curateDragSelection', curateDragSelection.filter((id) => !removeSet.has(id)));
  }

  handleCurateImageClick(event, image, imageSet) {
    if (this.host.curateDragSelecting || this.host.curateAuditDragSelecting) {
      return;
    }
    if (event && event.defaultPrevented) {
      return;
    }
    if (this.host._curateSuppressClick || this.host.curateDragSelection.length) {
      this.host._curateSuppressClick = false;
      return;
    }

    const nextSet = Array.isArray(imageSet) && imageSet.length
      ? [...imageSet]
      : (Array.isArray(this.host.curateImages) ? [...this.host.curateImages] : []);

    this.host.curateEditorImage = image;
    this.host.curateEditorImageSet = nextSet;
    this.host.curateEditorImageIndex = this.host.curateEditorImageSet.findIndex((img) => img.id === image.id);
    this.host.curateEditorOpen = true;
  }

  handleCurateEditorClose() {
    this.host.curateEditorOpen = false;
    this.host.curateEditorImage = null;
    this.host.curateDragSelection = [];
  }

  handleImageNavigate(event) {
    const { index } = event.detail;
    if (index >= 0 && index < this.host.curateEditorImageSet.length) {
      const nextImage = this.host.curateEditorImageSet[index];
      this.host.curateEditorImage = nextImage;
      this.host.curateEditorImageIndex = index;
    }
  }

  /**
   * Reset Curate Home state when tenant changes.
   */
  resetForTenantChange() {
    this.host.curateMediaType = 'all';
    this.host.curateHideDeleted = true;
    this.host.curateMinRating = null;
    this.host.curateNoPositivePermatags = false;
    this.host.curateKeywordFilters = {};
    this.host.curateKeywordOperators = {};
    this.host.curateDropboxPathPrefix = '';
    this.host.curateFilenameQuery = '';
    this.host.curateListId = '';
    this.host.curateListExcludeId = '';
    this.host.curateFilters = buildCurateFilterObject(this.host, { resetOffset: true });
    this.host.curatePageOffset = 0;
    this.host.curateTotal = null;
    this.host.curateImages = [];
    const curateFilters = buildCurateFilterObject(this.host, { resetOffset: true });
    this.host.curateHomeFilterPanel.updateFilters(curateFilters);
    this.host.curateDragSelection = [];
    this.requestUpdate();
  }

  async refreshCurateHome() {
    if (this.host.curateHomeRefreshing) return;
    this.host.curateHomeRefreshing = true;
    try {
      await this.host.fetchStats({ force: true, includeTagStats: true });
      this.host._curateHomeLastFetchKey = getCurateHomeFetchKey(this.host);
    } finally {
      this.host.curateHomeRefreshing = false;
      this.requestUpdate();
    }
  }

  /**
   * Flash selection animation on an image.
   * @param {number} imageId - Image ID to flash
   */
  flashSelection(imageId) {
    // Get or initialize flash tracking
    if (!this.host._curateFlashSelectionIds) {
      this.host._curateFlashSelectionIds = new Set();
    }
    if (!this.host._curateFlashSelectionTimers) {
      this.host._curateFlashSelectionTimers = new Map();
    }

    // Clear existing timer if present
    const existing = this.host._curateFlashSelectionTimers.get(imageId);
    if (existing) {
      clearTimeout(existing);
    }

    // Add to flash set and request update
    this.host._curateFlashSelectionIds.add(imageId);
    this.requestUpdate();

    // Set timer to remove after animation
    const timer = setTimeout(() => {
      this.host._curateFlashSelectionIds.delete(imageId);
      this.host._curateFlashSelectionTimers.delete(imageId);
      this.requestUpdate();
    }, 600);

    this.host._curateFlashSelectionTimers.set(imageId, timer);
  }
}
