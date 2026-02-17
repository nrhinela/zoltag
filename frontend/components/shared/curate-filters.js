export function buildCurateFilterObject(state, overrides = {}) {
  const filters = {
    limit: overrides.limit !== undefined ? overrides.limit : state.curateLimit,
    offset: overrides.resetOffset ? 0 : (state.curatePageOffset || 0),
    sortOrder: overrides.sortOrder !== undefined ? overrides.sortOrder : state.curateOrderDirection,
    orderBy: overrides.orderBy !== undefined ? overrides.orderBy : state.curateOrderBy,
    mediaType: overrides.mediaType !== undefined ? overrides.mediaType : (state.curateMediaType || 'all'),
    hideZeroRating: state.curateHideDeleted,
    keywords: overrides.keywords !== undefined ? overrides.keywords : state.curateKeywordFilters,
    operators: overrides.operators !== undefined ? overrides.operators : state.curateKeywordOperators || {},
    categoryFilterOperator: overrides.categoryFilterOperator !== undefined
      ? overrides.categoryFilterOperator
      : state.curateCategoryFilterOperator,
    categoryFilterSource: 'permatags',
    dropboxPathPrefix: overrides.dropboxPathPrefix !== undefined ? overrides.dropboxPathPrefix : state.curateDropboxPathPrefix,
    filenameQuery: overrides.filenameQuery !== undefined ? overrides.filenameQuery : state.curateFilenameQuery,
    textQuery: overrides.textQuery !== undefined ? overrides.textQuery : state.curateTextQuery,
    listId: overrides.listId !== undefined ? overrides.listId : state.curateListId,
    listExcludeId: overrides.listExcludeId !== undefined ? overrides.listExcludeId : state.curateListExcludeId,
  };

  const rating = overrides.rating !== undefined ? overrides.rating : state.curateMinRating;
  if (rating !== null && rating !== undefined) {
    if (rating === 'unrated') {
      filters.ratingOperator = 'is_null';
    } else {
      filters.rating = rating;
      filters.ratingOperator = rating === 0 ? 'eq' : 'gte';
    }
  }

  if (state.activeTab === 'curate' && state.curateNoPositivePermatags) {
    filters.permatagPositiveMissing = true;
  }

  return filters;
}

export function buildCurateAuditFilterObject(state, overrides = {}) {
  const useAiSort = state.curateAuditMode === 'missing'
    && state.curateAuditAiEnabled
    && !!state.curateAuditAiModel;

  const filters = {
    sortOrder: overrides.sortOrder !== undefined ? overrides.sortOrder : state.curateAuditOrderDirection,
    orderBy: useAiSort ? 'ml_score' : (overrides.orderBy !== undefined ? overrides.orderBy : state.curateAuditOrderBy),
    mediaType: overrides.mediaType !== undefined ? overrides.mediaType : (state.curateAuditMediaType || 'all'),
    permatagKeyword: state.curateAuditKeyword,
    permatagCategory: state.curateAuditCategory,
    permatagSignum: 1,
    permatagMissing: state.curateAuditMode === 'missing',
    hideZeroRating: state.curateAuditHideDeleted,
    dropboxPathPrefix: overrides.dropboxPathPrefix !== undefined ? overrides.dropboxPathPrefix : state.curateAuditDropboxPathPrefix,
    filenameQuery: overrides.filenameQuery !== undefined ? overrides.filenameQuery : state.curateAuditFilenameQuery,
    textQuery: overrides.textQuery !== undefined ? overrides.textQuery : state.curateAuditTextQuery,
  };

  if (useAiSort) {
    filters.mlKeyword = state.curateAuditKeyword;
    filters.mlTagType = state.curateAuditAiModel;
  }

  const rating = overrides.rating !== undefined ? overrides.rating : state.curateAuditMinRating;
  if (rating !== null && rating !== undefined) {
    if (rating === 'unrated') {
      filters.ratingOperator = 'is_null';
    } else {
      filters.rating = rating;
      filters.ratingOperator = rating === 0 ? 'eq' : 'gte';
    }
  }

  if (state.curateAuditNoPositivePermatags) {
    filters.permatagPositiveMissing = true;
  }

  const useLoadAll = overrides.loadAll || state.curateAuditLoadAll;
  if (!useLoadAll) {
    filters.limit = overrides.limit !== undefined ? overrides.limit : state.curateAuditLimit;
    filters.offset = overrides.resetOffset
      ? 0
      : (overrides.offset !== undefined ? overrides.offset : (state.curateAuditPageOffset || 0));
  }

  return filters;
}

export function getCurateAuditFetchKey(state, overrides = {}) {
  const filters = buildCurateAuditFilterObject(state, overrides);
  return JSON.stringify(filters);
}

export function getCurateHomeFetchKey(state) {
  return `curate-home:${state.tenant || 'no-tenant'}`;
}

export function getCurateQuickSortArrow(state, orderBy) {
  const direction = state.curateOrderBy === orderBy ? state.curateOrderDirection : 'desc';
  return direction === 'desc' ? '↓' : '↑';
}

export function shouldIncludeRatingStats(state) {
  return state.activeTab === 'curate' && state.curateSubTab === 'home';
}
