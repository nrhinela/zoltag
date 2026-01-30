/**
 * API Parameter Building Utilities
 *
 * Consolidates parameter building logic to reduce duplication across API service.
 * Provides helper functions for common parameter patterns.
 */

/**
 * Helper to conditionally append a single parameter
 * @param {URLSearchParams} params - URLSearchParams object
 * @param {string} key - Parameter key
 * @param {any} value - Parameter value
 * @param {boolean} condition - Whether to include this parameter
 */
function appendIf(params, key, value, condition = true) {
  if (condition && value !== undefined && value !== null && value !== '') {
    params.append(key, String(value));
  }
}

/**
 * Build pagination parameters (limit, offset)
 * @param {Object} filters - Filter object containing limit and offset
 * @param {URLSearchParams} params - URLSearchParams to append to
 */
export function addPaginationParams(params, filters = {}) {
  appendIf(params, 'limit', filters.limit, filters.limit !== undefined && filters.limit !== null && filters.limit !== '');
  appendIf(params, 'offset', filters.offset, filters.offset !== undefined && filters.offset !== null && filters.offset !== '');
  appendIf(params, 'anchor_id', filters.anchorId, filters.anchorId !== undefined && filters.anchorId !== null && filters.anchorId !== '');
}

/**
 * Build rating filter parameters
 * @param {Object} filters - Filter object
 * @param {URLSearchParams} params - URLSearchParams to append to
 */
export function addRatingParams(params, filters = {}) {
  if (filters.rating !== undefined && filters.rating !== '') {
    appendIf(params, 'rating', filters.rating);
    appendIf(params, 'rating_operator', filters.ratingOperator);
  } else if (filters.ratingOperator === 'is_null') {
    appendIf(params, 'rating_operator', 'is_null');
  }

  appendIf(params, 'hide_zero_rating', 'true', filters.hideZeroRating);
}

/**
 * Build permatag filter parameters
 * @param {Object} filters - Filter object
 * @param {URLSearchParams} params - URLSearchParams to append to
 */
export function addPermatagParams(params, filters = {}) {
  appendIf(params, 'permatag_keyword', filters.permatagKeyword);
  appendIf(params, 'permatag_category', filters.permatagCategory);
  appendIf(params, 'permatag_signum', filters.permatagSignum, filters.permatagSignum !== undefined && filters.permatagSignum !== null);
  appendIf(params, 'permatag_missing', 'true', filters.permatagMissing);
  appendIf(params, 'permatag_positive_missing', 'true', filters.permatagPositiveMissing);
}

/**
 * Build ML tag filter parameters
 * @param {Object} filters - Filter object
 * @param {URLSearchParams} params - URLSearchParams to append to
 */
export function addMlTagParams(params, filters = {}) {
  appendIf(params, 'ml_keyword', filters.mlKeyword);
  appendIf(params, 'ml_tag_type', filters.mlTagType);
}

/**
 * Build category filter parameters
 * @param {Object} filters - Filter object with keywords and operators
 * @param {URLSearchParams} params - URLSearchParams to append to
 */
export function addCategoryFilterParams(params, filters = {}) {
  if (filters.keywords && Object.keys(filters.keywords).length > 0) {
    const categoryFilters = {};
    for (const [category, keywordsSet] of Object.entries(filters.keywords)) {
      if (keywordsSet.size > 0) {
        categoryFilters[category] = {
          keywords: [...keywordsSet],
          operator: filters.operators[category] || 'OR',
        };
      }
    }
    if (Object.keys(categoryFilters).length > 0) {
      params.append('category_filters', JSON.stringify(categoryFilters));
    }
    appendIf(params, 'category_filter_source', filters.categoryFilterSource);
  }
}

/**
 * Build ordering and sorting parameters
 * @param {Object} filters - Filter object
 * @param {URLSearchParams} params - URLSearchParams to append to
 */
export function addOrderingParams(params, filters = {}) {
  appendIf(params, 'date_order', filters.sortOrder);
  appendIf(params, 'order_by', filters.orderBy);
}

/**
 * Build misc filter parameters (list, dropbox path, review status)
 * @param {Object} filters - Filter object
 * @param {URLSearchParams} params - URLSearchParams to append to
 */
export function addMiscParams(params, filters = {}) {
  appendIf(params, 'list_id', filters.listId);
  appendIf(params, 'reviewed', filters.reviewed, filters.reviewed !== undefined && filters.reviewed !== '');
  appendIf(params, 'dropbox_path_prefix', filters.dropboxPathPrefix);
}
