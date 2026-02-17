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
 * @param {boolean} condition - Whether to include this parameter (required, no default)
 */
function appendIf(params, key, value, condition) {
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
    appendIf(params, 'rating', filters.rating, true);
    appendIf(params, 'rating_operator', filters.ratingOperator, filters.ratingOperator !== undefined && filters.ratingOperator !== null && filters.ratingOperator !== '');
  } else if (filters.ratingOperator === 'is_null') {
    appendIf(params, 'rating_operator', 'is_null', true);
  }

  appendIf(params, 'hide_zero_rating', 'true', filters.hideZeroRating);
}

/**
 * Build permatag filter parameters
 * @param {Object} filters - Filter object
 * @param {URLSearchParams} params - URLSearchParams to append to
 */
export function addPermatagParams(params, filters = {}) {
  appendIf(params, 'permatag_keyword', filters.permatagKeyword, filters.permatagKeyword !== undefined && filters.permatagKeyword !== null && filters.permatagKeyword !== '');
  appendIf(params, 'permatag_category', filters.permatagCategory, filters.permatagCategory !== undefined && filters.permatagCategory !== null && filters.permatagCategory !== '');
  appendIf(params, 'permatag_signum', filters.permatagSignum, filters.permatagSignum !== undefined && filters.permatagSignum !== null);
  appendIf(params, 'permatag_missing', 'true', filters.permatagMissing === true);
  appendIf(params, 'permatag_positive_missing', 'true', filters.permatagPositiveMissing === true);
}

/**
 * Build ML tag filter parameters
 * @param {Object} filters - Filter object
 * @param {URLSearchParams} params - URLSearchParams to append to
 */
export function addMlTagParams(params, filters = {}) {
  appendIf(params, 'ml_keyword', filters.mlKeyword, filters.mlKeyword !== undefined && filters.mlKeyword !== null && filters.mlKeyword !== '');
  appendIf(params, 'ml_tag_type', filters.mlTagType, filters.mlTagType !== undefined && filters.mlTagType !== null && filters.mlTagType !== '');
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
    appendIf(params, 'category_filter_source', filters.categoryFilterSource, filters.categoryFilterSource !== undefined && filters.categoryFilterSource !== null && filters.categoryFilterSource !== '');
    appendIf(params, 'category_filter_operator', filters.categoryFilterOperator, filters.categoryFilterOperator !== undefined && filters.categoryFilterOperator !== null && filters.categoryFilterOperator !== '');
  }
}

/**
 * Build ordering and sorting parameters
 * @param {Object} filters - Filter object
 * @param {URLSearchParams} params - URLSearchParams to append to
 */
export function addOrderingParams(params, filters = {}) {
  appendIf(params, 'date_order', filters.sortOrder, filters.sortOrder !== undefined && filters.sortOrder !== null && filters.sortOrder !== '');
  appendIf(params, 'order_by', filters.orderBy, filters.orderBy !== undefined && filters.orderBy !== null && filters.orderBy !== '');
}

/**
 * Build misc filter parameters (list, dropbox path, review status)
 * @param {Object} filters - Filter object
 * @param {URLSearchParams} params - URLSearchParams to append to
 */
export function addMiscParams(params, filters = {}) {
  appendIf(params, 'list_id', filters.listId, filters.listId !== undefined && filters.listId !== null && filters.listId !== '');
  appendIf(params, 'list_exclude_id', filters.listExcludeId, filters.listExcludeId !== undefined && filters.listExcludeId !== null && filters.listExcludeId !== '');
  appendIf(params, 'reviewed', filters.reviewed, filters.reviewed !== undefined && filters.reviewed !== '');
  appendIf(params, 'dropbox_path_prefix', filters.dropboxPathPrefix, filters.dropboxPathPrefix !== undefined && filters.dropboxPathPrefix !== null && filters.dropboxPathPrefix !== '');
  appendIf(params, 'filename_query', filters.filenameQuery, filters.filenameQuery !== undefined && filters.filenameQuery !== null && filters.filenameQuery !== '');
  const textQuery = filters.textQuery !== undefined && filters.textQuery !== null && filters.textQuery !== ''
    ? filters.textQuery
    : filters.search;
  appendIf(params, 'text_query', textQuery, textQuery !== undefined && textQuery !== null && textQuery !== '');
  appendIf(
    params,
    'hybrid_vector_weight',
    filters.hybridVectorWeight,
    filters.hybridVectorWeight !== undefined && filters.hybridVectorWeight !== null && filters.hybridVectorWeight !== ''
  );
  appendIf(
    params,
    'hybrid_lexical_weight',
    filters.hybridLexicalWeight,
    filters.hybridLexicalWeight !== undefined && filters.hybridLexicalWeight !== null && filters.hybridLexicalWeight !== ''
  );
}

/**
 * Build media type filter parameter.
 * @param {Object} filters - Filter object
 * @param {URLSearchParams} params - URLSearchParams to append to
 */
export function addMediaTypeParams(params, filters = {}) {
  const raw = String(filters.mediaType ?? '').trim().toLowerCase();
  if (raw === 'image' || raw === 'video') {
    params.append('media_type', raw);
  }
}
