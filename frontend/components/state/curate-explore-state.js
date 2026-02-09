import { BaseStateController } from './base-state-controller.js';
import { getImages } from '../../services/api.js';
import { enqueueCommand } from '../../services/command-queue.js';
import { buildCurateFilterObject } from '../shared/curate-filters.js';
import { mergePermatags } from '../shared/keyword-utils.js';

/**
 * Curate Explore State Controller
 *
 * Manages explore-tab specific hotspot/rating behavior and
 * explore-by-tag loading + selection state.
 */
export class CurateExploreStateController extends BaseStateController {
  constructor(host) {
    super(host);
  }

  handleHotspotKeywordChange(event, targetId) {
    return this.host._exploreHotspotHandlers.handleKeywordChange(event, targetId);
  }

  handleHotspotActionChange(event, targetId) {
    return this.host._exploreHotspotHandlers.handleActionChange(event, targetId);
  }

  handleHotspotTypeChange(event, targetId) {
    return this.host._exploreHotspotHandlers.handleTypeChange(event, targetId);
  }

  handleHotspotRatingChange(event, targetId) {
    return this.host._exploreHotspotHandlers.handleRatingChange(event, targetId);
  }

  handleHotspotAddTarget() {
    return this.host._exploreHotspotHandlers.handleAddTarget();
  }

  handleHotspotRemoveTarget(targetId) {
    return this.host._exploreHotspotHandlers.handleRemoveTarget(targetId);
  }

  handleHotspotDrop(event, targetId) {
    return this.host._exploreHotspotHandlers.handleDrop(event, targetId);
  }

  handleHotspotChanged(event) {
    const { type, targetId, value } = event.detail;
    switch (type) {
      case 'keyword-change':
        return this.handleHotspotKeywordChange({ target: { value } }, targetId);
      case 'action-change':
        return this.handleHotspotActionChange({ target: { value } }, targetId);
      case 'type-change':
        return this.handleHotspotTypeChange({ target: { value } }, targetId);
      case 'rating-change':
        return this.handleHotspotRatingChange({ target: { value } }, targetId);
      case 'add-target':
        return this.handleHotspotAddTarget();
      case 'remove-target':
        return this.handleHotspotRemoveTarget(targetId);
      case 'rating-toggle':
        return this.handleRatingToggle({ target: { checked: event.detail.enabled } });
      case 'hotspot-drop':
        return this.handleHotspotDrop(event.detail.event, targetId);
      default:
        console.warn('Unknown hotspot event type:', type);
        return undefined;
    }
  }

  processTagDrop(ids, target) {
    const signum = target.action === 'remove' ? -1 : 1;
    const category = target.category || 'Uncategorized';
    const operations = ids.map((imageId) => ({
      image_id: imageId,
      keyword: target.keyword,
      category,
      signum,
    }));
    enqueueCommand({
      type: 'bulk-permatags',
      tenantId: this.host.tenant,
      operations,
      description: `hotspot · ${operations.length} updates`,
    });

    const tags = [{ keyword: target.keyword, category }];
    if (signum === 1) {
      this.updateCuratePermatags(ids, tags);
    } else {
      this.updateCuratePermatagRemovals(ids, tags);
    }
    this.host._removeCurateImagesByIds(ids);
  }

  updateCuratePermatagRemovals(imageIds, tags) {
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

    this.host.curateImages = this.host.curateImages.map((image) => (
      targetIds.has(image.id) ? prune(image) : image
    ));
  }

  updateCuratePermatags(imageIds, tags) {
    if (!imageIds?.length || !tags?.length) return;

    const targetIds = new Set(imageIds);
    this.host.curateImages = this.host.curateImages.map((image) => {
      if (!targetIds.has(image.id)) return image;
      const permatags = mergePermatags(image.permatags, tags);
      return { ...image, permatags };
    });
  }

  handleRatingToggle(event) {
    if (event && typeof event.target?.checked === 'boolean') {
      this.host.curateExploreRatingEnabled = event.target.checked;
      return undefined;
    }
    return this.host._exploreRatingHandlers.handleToggle();
  }

  handleRatingDrop(event, ratingValue = null) {
    const rating = Number.parseInt(ratingValue, 10);
    if (Number.isFinite(rating)) {
      const raw = event?.dataTransfer?.getData('text/plain') || '';
      const ids = raw
        .split(',')
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((value) => Number.isFinite(value) && value > 0);
      if (ids.length) {
        this.host._applyExploreRating(ids, rating);
        return undefined;
      }
    }
    return this.host._exploreRatingHandlers.handleDrop(event);
  }

  async handleZoomToPhoto(event) {
    const imageId = event?.detail?.imageId;
    if (!imageId) return;

    this.host.activeTab = 'curate';
    this.host.curateSubTab = 'main';
    this.host.curateOrderBy = 'photo_creation';
    this.host.curateOrderDirection = 'desc';
    this.host.curatePageOffset = 0;
    this.host.curateDragSelection = [];
    this.host.curateKeywordFilters = {};
    this.host.curateKeywordOperators = {};
    this.host.curateNoPositivePermatags = false;
    this.host.curateMinRating = null;
    this.host.curateDropboxPathPrefix = '';
    this.host.curateListId = '';
    this.host.curateListExcludeId = '';
    this.host.curateFilters = buildCurateFilterObject(this.host);

    const curateFilters = {
      ...buildCurateFilterObject(this.host, { resetOffset: true }),
      anchorId: imageId,
    };
    this.host.curateHomeFilterPanel.updateFilters(curateFilters);

    await this.host._fetchCurateHomeImages();
    await this.host.updateComplete;
    this.scrollCurateThumbIntoView(imageId);
  }

  scrollCurateThumbIntoView(imageId) {
    const selector = `[data-image-id="${imageId}"]`;
    const target = this.host.shadowRoot?.querySelector(selector);
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }
  }

  applyCurateRating(imageId, rating) {
    const update = (image) => (image.id === imageId ? { ...image, rating } : image);
    const hideZero = this.host.curateHideDeleted && rating === 0;

    if (hideZero) {
      const keep = (image) => image.id !== imageId;
      this.host.curateImages = this.host.curateImages.filter(keep);
      this.host.curateAuditImages = this.host.curateAuditImages.filter(keep);
      this.host.curateAuditSelection = this.host.curateAuditSelection.filter(keep);
      this.host.curateDragSelection = this.host.curateDragSelection.filter((id) => id !== imageId);
      this.host.curateAuditDragSelection = this.host.curateAuditDragSelection.filter((id) => id !== imageId);
    } else {
      this.host.curateImages = this.host.curateImages.map(update);
      this.host.curateAuditImages = this.host.curateAuditImages.map(update);
      this.host.curateAuditSelection = this.host.curateAuditSelection.map(update);
    }

    if (Array.isArray(this.host.searchImages)) {
      this.host.searchImages = this.host.searchImages.map(update);
    }

    if (this.host.exploreByTagData && typeof this.host.exploreByTagData === 'object') {
      const nextExplore = {};
      let updated = false;

      Object.entries(this.host.exploreByTagData).forEach(([keyword, images]) => {
        if (!Array.isArray(images)) {
          nextExplore[keyword] = images;
          return;
        }
        let keywordUpdated = false;
        const nextImages = images.map((image) => {
          if (image?.id === imageId && image.rating !== rating) {
            keywordUpdated = true;
            updated = true;
            return { ...image, rating };
          }
          return image;
        });
        nextExplore[keyword] = keywordUpdated ? nextImages : images;
      });

      if (updated) {
        this.host.exploreByTagData = nextExplore;
      }
    }

    const searchTab = this.host.shadowRoot?.querySelector('search-tab');
    if (searchTab?.applyRatingUpdate) {
      searchTab.applyRatingUpdate(imageId, rating);
    }
  }

  handleCurateRating(event, image, rating) {
    event.preventDefault();
    event.stopPropagation();
    if (!image?.id) return;

    this.triggerCurateRatingBurst(image.id);
    this.applyCurateRating(image.id, rating);

    enqueueCommand({
      type: 'set-rating',
      tenantId: this.host.tenant,
      imageId: image.id,
      rating,
    });
  }

  triggerCurateRatingBurst(imageId) {
    if (!this.host._curateRatingBurstIds) {
      this.host._curateRatingBurstIds = new Set();
    }
    if (!this.host._curateRatingBurstTimers) {
      this.host._curateRatingBurstTimers = new Map();
    }

    const existing = this.host._curateRatingBurstTimers.get(imageId);
    if (existing) {
      clearTimeout(existing);
    }

    this.host._curateRatingBurstIds.add(imageId);
    this.host.requestUpdate();

    const timer = setTimeout(() => {
      this.host._curateRatingBurstIds.delete(imageId);
      this.host._curateRatingBurstTimers.delete(imageId);
      this.host.requestUpdate();
    }, 700);

    this.host._curateRatingBurstTimers.set(imageId, timer);
  }

  async loadExploreByTagData(forceRefresh = false) {
    if (!this.host.tenant) return;
    this.host.exploreByTagLoading = true;

    if (
      !this.host.imageStats?.rating_by_category ||
      !Object.keys(this.host.imageStats.rating_by_category || {}).length
    ) {
      if (!this.host._exploreByTagStatsPromise) {
        this.host._exploreByTagStatsPromise = this.host.fetchStats({
          includeRatings: true,
          includeMlStats: false,
          includeTagStats: false,
        })
          .catch((error) => {
            console.error('Error fetching explore-by-tag stats:', error);
          })
          .finally(() => {
            this.host._exploreByTagStatsPromise = null;
          });

        this.host._exploreByTagStatsPromise.then(() => {
          if (
            !this.host.imageStats?.rating_by_category ||
            !Object.keys(this.host.imageStats.rating_by_category || {}).length
          ) {
            this.host.exploreByTagLoading = false;
            return;
          }
          this.loadExploreByTagData(forceRefresh);
        });
      }
      return;
    }

    try {
      const keywordsByRating = {};
      const imageStats = this.host.imageStats;

      if (imageStats?.rating_by_category) {
        Object.entries(imageStats.rating_by_category).forEach(([category, categoryData]) => {
          Object.entries(categoryData.keywords || {}).forEach(([keyword, keywordData]) => {
            const twoStarPlus = (keywordData.stars_2 || 0) + (keywordData.stars_3 || 0);
            if (twoStarPlus > 0) {
              const keywordName = `${category} - ${keyword}`;
              keywordsByRating[keywordName] = { category, keyword, twoStarPlus };
            }
          });
        });
      }

      const sortedKeywords = Object.entries(keywordsByRating).sort(([a], [b]) =>
        a.localeCompare(b)
      );
      const exploreByTagData = {};
      const exploreByTagKeywords = [];

      for (const [keywordName, data] of sortedKeywords) {
        const cacheKey = `exploreByTag_${keywordName}`;
        let cachedImages = this.host[cacheKey];
        if (forceRefresh || !Array.isArray(cachedImages)) {
          try {
            const result = await getImages(this.host.tenant, {
              permatagKeyword: data.keyword,
              permatagCategory: data.category,
              permatagSignum: 1,
              rating: 2,
              ratingOperator: 'gte',
              limit: 10,
              orderBy: 'rating',
              sortOrder: 'desc',
            });
            const images = Array.isArray(result) ? result : (result?.images || []);
            cachedImages = images.filter((img) => img && img.id);
            this.host[cacheKey] = cachedImages;
          } catch (error) {
            console.error(`Error loading images for keyword "${keywordName}":`, error);
            cachedImages = [];
          }
        }
        exploreByTagData[keywordName] = cachedImages || [];
        exploreByTagKeywords.push(keywordName);
      }

      this.host.exploreByTagData = exploreByTagData;
      this.host.exploreByTagKeywords = exploreByTagKeywords;
    } finally {
      this.host.exploreByTagLoading = false;
    }
  }

  handleExploreByTagPointerDown(event, index, imageId, cachedImages) {
    if (this.host.curateDragSelecting || this.host.curateAuditDragSelecting) return;
    if (event.button !== 0) return;
    if (
      this.host.curateDragSelection.length &&
      this.host.curateDragSelection.includes(imageId)
    ) {
      this.host._curateSuppressClick = true;
      return;
    }

    this.host._curateSuppressClick = false;
    this.host._curatePressActive = true;
    this.host._curatePressStart = { x: event.clientX, y: event.clientY };
    this.host._curatePressIndex = index;
    this.host._curatePressImageId = imageId;
    this.host._exploreByTagCachedImages = cachedImages;
    this.host._curatePressTimer = setTimeout(() => {
      if (this.host._curatePressActive) {
        this.startExploreByTagSelection(index, imageId, cachedImages);
      }
    }, 250);
  }

  handleExploreByTagSelectHover(index, cachedImages) {
    if (!this.host.curateDragSelecting) return;
    if (this.host.curateDragEndIndex !== index) {
      this.host.curateDragEndIndex = index;
      this.updateExploreByTagDragSelection(cachedImages);
    }
  }

  startExploreByTagSelection(index, imageId, cachedImages) {
    if (this.host.curateDragSelection.includes(imageId)) return;
    this.host._cancelCuratePressState();
    this.host._curateLongPressTriggered = true;
    this.host.curateDragSelecting = true;
    this.host.curateDragStartIndex = index;
    this.host.curateDragEndIndex = index;
    this.host._curateSuppressClick = true;
    this.host._flashCurateSelection(imageId);
    this.updateExploreByTagDragSelection(cachedImages);
  }

  updateExploreByTagDragSelection(cachedImages) {
    if (
      !cachedImages ||
      this.host.curateDragStartIndex === null ||
      this.host.curateDragEndIndex === null
    ) {
      return;
    }

    const start = Math.min(this.host.curateDragStartIndex, this.host.curateDragEndIndex);
    const end = Math.max(this.host.curateDragStartIndex, this.host.curateDragEndIndex);
    this.host.curateDragSelection = cachedImages.slice(start, end + 1).map((img) => img.id);
  }

  handleSubTabChange(nextTab) {
    if (!nextTab || this.host.curateSubTab === nextTab) {
      return;
    }

    const prevTab = this.host.curateSubTab;
    if (prevTab === 'main') {
      this.host._curateSubTabState[prevTab] = this.host._snapshotCurateState();
      this.host._curateActiveWorkingTab = prevTab;
    }

    this.host.curateSubTab = nextTab;

    if (nextTab === 'main') {
      const saved = this.host._curateSubTabState[nextTab];
      if (saved) {
        this.host._restoreCurateState(saved);
      } else {
        this.host._restoreCurateState(this.host._getCurateDefaultState());
        this.host._curateSubTabState[nextTab] = this.host._snapshotCurateState();
      }
      if (!this.host.curateImages.length && !this.host.curateLoading) {
        const curateFilters = this.host._buildCurateFilters();
        this.host.curateHomeFilterPanel.updateFilters(curateFilters);
        this.host._fetchCurateHomeImages();
      }
    }

    if (nextTab === 'home') {
      const fetchKey = this.host._getCurateHomeFetchKey();
      if (!this.host._curateHomeLastFetchKey || this.host._curateHomeLastFetchKey !== fetchKey) {
        this.host.fetchStats({ includeRatings: true }).finally(() => {
          this.host._curateHomeLastFetchKey = fetchKey;
        });
      }
      if (this.host._shouldAutoRefreshCurateStats()) {
        this.host._curateStatsAutoRefreshDone = true;
        this.host._refreshCurateHome();
      }
    }

    if (nextTab === 'tag-audit' && this.host.curateAuditKeyword) {
      const fetchKey = this.host._getCurateAuditFetchKey({
        loadAll: this.host.curateAuditLoadAll,
        offset: this.host.curateAuditPageOffset || 0,
      });
      if (!this.host._curateAuditLastFetchKey || this.host._curateAuditLastFetchKey !== fetchKey) {
        this.host._fetchCurateAuditImages();
      }
    }
  }

  initializeCurateTab() {
    this.host.fetchKeywords();
    this.host.fetchStats({ includeTagStats: this.host.curateSubTab === 'home' }).finally(() => {
      this.host._curateHomeLastFetchKey = this.host._getCurateHomeFetchKey();
    });

    if (this.host.curateSubTab === 'main') {
      const curateFilters = this.host._buildCurateFilters();
      this.host.curateHomeFilterPanel.updateFilters(curateFilters);
      if (!this.host.curateImages?.length && !this.host.curateLoading) {
        this.host._fetchCurateHomeImages();
      }
    } else if (this.host.curateSubTab === 'tag-audit' && this.host.curateAuditKeyword) {
      const fetchKey = this.host._getCurateAuditFetchKey({
        loadAll: this.host.curateAuditLoadAll,
        offset: this.host.curateAuditPageOffset || 0,
      });
      if (!this.host._curateAuditLastFetchKey || this.host._curateAuditLastFetchKey !== fetchKey) {
        this.host._fetchCurateAuditImages();
      }
    }
  }
}
