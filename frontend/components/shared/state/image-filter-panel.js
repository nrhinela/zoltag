/**
 * ImageFilterPanel - Reusable filter state container
 *
 * This is a PURE STATE CONTAINER - it manages filter state and logic ONLY.
 * It does NOT render any UI. The parent component handles all rendering.
 *
 * Each instance can be used independently to manage filter state for:
 * - Search tab
 * - Curate Home tab
 * - Curate Audit tab
 * - Any other tab that needs filter state
 *
 * Usage:
 *
 * const filterPanel = new ImageFilterPanel('search');
 * filterPanel.updateFilter('rating', 3);
 * filterPanel.updateFilter('keywords', { 'Circus Skills': new Set(['aerial-lyra']) });
 * const params = filterPanel.buildRequestParams();
 *
 * Features:
 * - Independent state per instance
 * - Methods to update filters
 * - Method to build API parameters
 * - Event emission for state changes
 * - No rendering/UI - pure logic
 */

import { getImages } from '../../../services/api.js';
import {
  addPaginationParams,
  addRatingParams,
  addPermatagParams,
  addMlTagParams,
  addCategoryFilterParams,
  addOrderingParams,
  addMiscParams,
} from '../../../services/api-params.js';

export class ImageFilterPanel {
  constructor(tabId) {
    this.tabId = tabId;
    this.tenant = null;

    // Filter state - can be modified independently per instance
    this.filters = {
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
      permatagPositiveMissing: false,
      listId: undefined,
      listExcludeId: undefined,
    };

    // Event listeners for state changes
    this._listeners = {
      'filters-changed': [],
      'images-loaded': [],
      'error': [],
    };
  }

  /**
   * Update a single filter value
   */
  updateFilter(key, value) {
    this.filters[key] = value;
    this._emit('filters-changed', { tabId: this.tabId, filters: this.filters });
  }

  /**
   * Update multiple filters at once
   */
  updateFilters(updates) {
    // Replace the entire filters object instead of merging
    // This ensures properties not in updates are removed
    this.filters = { ...updates };
    this._emit('filters-changed', { tabId: this.tabId, filters: this.filters });
  }

  /**
   * Reset pagination to first page (useful when filters change)
   */
  resetPagination() {
    this.filters.offset = 0;
  }

  /**
   * Set pagination offset
   */
  setOffset(offset) {
    this.filters.offset = offset;
  }

  /**
   * Set results per page limit
   */
  setLimit(limit) {
    this.filters.limit = limit;
    this.resetPagination();
  }

  /**
   * Build URL parameters for API request based on current filters
   */
  buildRequestParams() {
    const params = new URLSearchParams();

    // Add all parameters using the helper functions
    addPaginationParams(params, this.filters);
    addRatingParams(params, this.filters);
    addPermatagParams(params, this.filters);
    addMlTagParams(params, this.filters);
    addCategoryFilterParams(params, this.filters);
    addOrderingParams(params, this.filters);
    addMiscParams(params, this.filters);

    return params;
  }

  /**
   * Fetch images from API with current filters
   */
  async fetchImages() {
    if (!this.tenant) {
      this._emit('error', { tabId: this.tabId, message: 'Tenant not set' });
      return;
    }

    try {
      // Pass the filter object directly to getImages, which will build the params
      const result = await getImages(this.tenant, this.filters);

      const images = Array.isArray(result) ? result : (result.images || []);
      const total = Array.isArray(result) ? null : (result.total || 0);

      this._emit('images-loaded', {
        tabId: this.tabId,
        images,
        total,
      });

      return { images, total };
    } catch (error) {
      this._emit('error', {
        tabId: this.tabId,
        message: `Failed to fetch images: ${error.message}`,
      });
      throw error;
    }
  }

  /**
   * Register event listener
   */
  on(eventName, callback) {
    if (this._listeners[eventName]) {
      this._listeners[eventName].push(callback);
    }
  }

  /**
   * Remove event listener
   */
  off(eventName, callback) {
    if (this._listeners[eventName]) {
      this._listeners[eventName] = this._listeners[eventName].filter(
        (cb) => cb !== callback
      );
    }
  }

  /**
   * Internal: emit event to all listeners
   */
  _emit(eventName, detail) {
    if (this._listeners[eventName]) {
      this._listeners[eventName].forEach((callback) => {
        try {
          callback(detail);
        } catch (error) {
          console.error(
            `Error in ${eventName} listener for ${this.tabId}:`,
            error
          );
        }
      });
    }
  }

  /**
   * Get current filter state (for debugging/inspection)
   */
  getState() {
    return { ...this.filters };
  }

  /**
   * Reset all filters to defaults
   */
  reset() {
    this.filters = {
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
      permatagPositiveMissing: false,
    };
    this._emit('filters-changed', { tabId: this.tabId, filters: this.filters });
  }

  /**
   * Set tenant for API calls
   */
  setTenant(tenant) {
    this.tenant = tenant;
  }

  /**
   * Serialize state for storage (useful for persistence)
   */
  serialize() {
    // Handle Sets by converting to arrays
    const filters = { ...this.filters };
    if (filters.keywords && typeof filters.keywords === 'object') {
      filters.keywords = Object.fromEntries(
        Object.entries(filters.keywords).map(([key, set]) => [
          key,
          set instanceof Set ? [...set] : set,
        ])
      );
    }
    return JSON.stringify(filters);
  }

  /**
   * Deserialize state from storage
   */
  deserialize(json) {
    try {
      const filters = JSON.parse(json);
      // Convert arrays back to Sets
      if (filters.keywords && typeof filters.keywords === 'object') {
        filters.keywords = Object.fromEntries(
          Object.entries(filters.keywords).map(([key, arr]) => [
            key,
            arr instanceof Set ? arr : new Set(arr || []),
          ])
        );
      }
      if (Array.isArray(filters.dropboxPathPrefix)) {
        filters.dropboxPathPrefix = filters.dropboxPathPrefix[0] || '';
      }
      this.updateFilters(filters);
    } catch (error) {
      console.error(`Error deserializing state for ${this.tabId}:`, error);
    }
  }
}

// Export as both class and singleton for flexibility
export default ImageFilterPanel;
