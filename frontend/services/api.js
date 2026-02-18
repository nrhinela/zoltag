import { getAccessToken } from './supabase.js';
import {
  addPaginationParams,
  addRatingParams,
  addPermatagParams,
  addMlTagParams,
  addCategoryFilterParams,
  addOrderingParams,
  addMiscParams,
  addMediaTypeParams
} from './api-params.js';
import { createCrudOps } from './crud-helper.js';
import { invalidateQueries, queryRequest } from './request-cache.js';

// Use relative URL - works in both dev (via Vite proxy) and production
const API_BASE_URL = '/api/v1';
const STATS_CACHE_MS = 10000;
const TENANTS_CACHE_MS = 5 * 60 * 1000;
const LISTS_CACHE_MS = 10000;
const KEYWORDS_CACHE_MS = 10000;
const SYSTEM_SETTINGS_CACHE_MS = 5 * 60 * 1000;
const INTEGRATION_STATUS_CACHE_MS = 10000;

/**
 * Fetch with authentication headers
 *
 * Automatically adds:
 * - Authorization: Bearer <JWT> (from Supabase session)
 * - X-Tenant-ID: <tenant_id> (if provided in options.tenantId)
 * - Content-Type: application/json
 *
 * Handles common errors:
 * - 401: Redirects to login
 * - 403: Shows access denied error
 * - Other errors: Shows error message
 *
 * @param {string} url - API endpoint URL (relative to /api/v1)
 * @param {Object} options - Fetch options (method, body, headers, tenantId, etc.)
 * @returns {Promise<Object>} Parsed JSON response or blob for image downloads
 * @throws {Error} If request fails
 */
export async function fetchWithAuth(url, options = {}) {
  const token = await getAccessToken();

  // Don't set Content-Type for FormData - let browser set it
  const isFormData = options.body instanceof FormData;
  let headers = isFormData ? {} : { 'Content-Type': 'application/json' };

  if (options.headers) {
    headers = { ...headers, ...options.headers };
  }

  // Add Authorization header with JWT token
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Add X-Tenant-ID header if provided
  if (options.tenantId) {
    headers['X-Tenant-ID'] = options.tenantId;
  }

  // Remove tenantId and responseType from options before passing to fetch
  const { tenantId, responseType, ...fetchOptions } = options;

  const response = await fetch(`${API_BASE_URL}${url}`, {
    ...fetchOptions,
    headers,
  });

  // Handle 401 Unauthorized (redirect to login)
  if (response.status === 401) {
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  // Handle 403 Forbidden (access denied)
  if (response.status === 403) {
    const error = await response.json().catch(() => ({ detail: 'Access denied' }));
    throw new Error(error.detail);
  }

  // Handle other errors
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Request failed' }));
    throw new Error(error.detail || 'Request failed');
  }

  // Return blob for image downloads, otherwise return JSON
  if (responseType === 'blob') {
    return response.blob();
  }

  return response.json();
}

export async function getImages(tenantId, filters = {}) {
  const params = new URLSearchParams();

  // Add parameters by category
  addMiscParams(params, filters);
  addRatingParams(params, filters);
  addPaginationParams(params, filters);
  addCategoryFilterParams(params, filters);
  addOrderingParams(params, filters);
  addPermatagParams(params, filters);
  addMlTagParams(params, filters);
  addMediaTypeParams(params, filters);

  const url = `/images?${params.toString()}`;
  return fetchWithAuth(url, {
    tenantId,
  });
}

export async function getDuplicateImages(
  tenantId,
  {
    limit = 100,
    offset = 0,
    sortOrder = 'desc',
    includeTotal = false,
    filenameQuery = '',
  } = {}
) {
  const params = new URLSearchParams();
  params.append('limit', String(limit));
  params.append('offset', String(offset));
  params.append('date_order', sortOrder === 'asc' ? 'asc' : 'desc');
  if (filenameQuery) {
    params.append('filename_query', filenameQuery);
  }
  if (includeTotal) {
    params.append('include_total', 'true');
  }
  return fetchWithAuth(`/images/duplicates?${params.toString()}`, {
    tenantId,
  });
}

export async function getDropboxFolders(tenantId, { query = '', limit } = {}) {
  const params = new URLSearchParams();
  if (query) {
    params.append('q', query);
  }
  if (limit) {
    params.append('limit', String(limit));
  }
  return fetchWithAuth(`/images/dropbox-folders${params.toString() ? '?' + params.toString() : ''}`, { tenantId });
}

export async function getImageStats(tenantId, { force = false, includeRatings = false } = {}) {
  const params = new URLSearchParams();
  if (includeRatings) {
    params.append('include_ratings', 'true');
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return queryRequest(
    ['imageStats', tenantId, includeRatings ? 'full' : 'summary'],
    () => fetchWithAuth(`/images/stats${suffix}`, { tenantId }),
    { staleTimeMs: STATS_CACHE_MS, force }
  );
}

export async function getFullImage(tenantId, imageId, { signal } = {}) {
  return fetchWithAuth(`/images/${imageId}/full`, {
    tenantId,
    responseType: 'blob',
    signal,
  });
}

export async function getImagePlayback(tenantId, imageId, { signal } = {}) {
  return fetchWithAuth(`/images/${imageId}/playback`, {
    tenantId,
    signal,
  });
}

export async function getImagePlaybackStream(tenantId, imageId, { signal } = {}) {
  return fetchWithAuth(`/images/${imageId}/playback/stream`, {
    tenantId,
    responseType: 'blob',
    signal,
  });
}

export async function getTagStats(tenantId, { force = false } = {}) {
  return queryRequest(
    ['tagStats', tenantId],
    () => fetchWithAuth(`/tag-stats`, { tenantId }),
    { staleTimeMs: STATS_CACHE_MS, force }
  );
}

export async function getMlTrainingImages(tenantId, { limit = 50, offset = 0, refresh = false } = {}) {
  const params = new URLSearchParams();
  if (limit !== undefined && limit !== null) {
    params.append('limit', String(limit));
  }
  if (offset) {
    params.append('offset', String(offset));
  }
  if (refresh) {
    params.append('refresh', 'true');
  }
  return fetchWithAuth(`/ml-training/images${params.toString() ? '?' + params.toString() : ''}`, { tenantId });
}

export async function getMlTrainingStats(tenantId, { force = false } = {}) {
  return queryRequest(
    ['mlTrainingStats', tenantId],
    () => fetchWithAuth(`/ml-training/stats`, { tenantId }),
    { staleTimeMs: STATS_CACHE_MS, force }
  );
}

export async function getKeywords(tenantId, filters = {}) {
    const params = new URLSearchParams();

    // Pass filter parameters to match the images endpoint
    addRatingParams(params, filters);
    addMiscParams(params, filters);

    // Keywords endpoint specific parameter
    if (filters.source) {
      params.append('source', filters.source);
    }
    if (filters.includePeople) {
      params.append('include_people', 'true');
    }

    const url = params.toString() ? `/keywords?${params.toString()}` : `/keywords`;
    const data = await queryRequest(
      ['keywords', tenantId, params.toString()],
      () => fetchWithAuth(url, { tenantId }),
      { staleTimeMs: KEYWORDS_CACHE_MS, force: !!filters.force }
    );
    return data.keywords_by_category || {};
}

export async function getNlSearchFilters(tenantId, payload) {
  return fetchWithAuth(`/search/nl`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
    tenantId,
  });
}

export async function getTenants({ force = false } = {}) {
    return queryRequest(['tenants', 'admin'], async () => {
        // Use admin endpoint for complete tenant data (includes settings, dropbox config, etc)
        try {
            return await fetchWithAuth(`/admin/tenants?details=true`);
        } catch (error) {
            // Fallback to non-admin endpoint if admin endpoint not available
            try {
                return await fetchWithAuth(`/tenants`);
            } catch (fallbackError) {
                throw new Error('Failed to fetch tenants');
            }
        }
    }, { staleTimeMs: TENANTS_CACHE_MS, force });
}

export async function getTenantsPublic({ force = false } = {}) {
    return queryRequest(['tenants', 'public'], async () => {
        return await fetchWithAuth(`/tenants`);
    }, { staleTimeMs: TENANTS_CACHE_MS, force });
}

export async function setRating(tenantId, imageId, rating) {
    return fetchWithAuth(`/images/${imageId}/rating`, {
        method: 'PATCH',
        tenantId,
        body: JSON.stringify({ rating }),
    });
}

export async function deleteImage(tenantId, imageId) {
    return fetchWithAuth(`/images/${imageId}`, {
        method: 'DELETE',
        tenantId,
    });
}

export async function addToList(tenantId, listId, photoId) {
    const result = await fetchWithAuth(`/lists/${listId}/add-photo`, {
        method: 'POST',
        tenantId,
        body: JSON.stringify({ photo_id: photoId }),
    });
    invalidateQueries(['lists', tenantId]);
    return result;
}

export async function addToRecentList(tenantId, photoId) {
    const result = await fetchWithAuth(`/lists/add-photo`, {
        method: 'POST',
        tenantId,
        body: JSON.stringify({ photo_id: photoId }),
    });
    invalidateQueries(['lists', tenantId]);
    return result;
}

export async function retagImage(tenantId, imageId) {
    return fetchWithAuth(`/images/${imageId}/retag`, {
        method: 'POST',
        tenantId,
    });
}

export async function sync(tenantId) {
    return fetchWithAuth(`/sync`, {
        method: 'POST',
        tenantId,
    });
}

export async function retagAll(tenantId) {
    return fetchWithAuth(`/retag`, {
        method: 'POST',
        tenantId,
    });
}

export async function getImageDetails(tenantId, imageId) {
    return fetchWithAuth(`/images/${imageId}`, { tenantId });
}

export async function getSimilarImages(tenantId, imageId, { limit = 40, minScore, sameMediaType = true } = {}) {
  const params = new URLSearchParams();
  if (limit !== undefined && limit !== null) {
    params.append('limit', String(limit));
  }
  if (minScore !== undefined && minScore !== null && minScore !== '') {
    params.append('min_score', String(minScore));
  }
  params.append('same_media_type', sameMediaType ? 'true' : 'false');
  const query = params.toString();
  return fetchWithAuth(`/images/${imageId}/similar${query ? `?${query}` : ''}`, { tenantId });
}

export async function listAssetVariants(tenantId, imageId) {
  return fetchWithAuth(`/images/${imageId}/asset-variants`, { tenantId });
}

export async function uploadAssetVariant(tenantId, imageId, { file, variant } = {}) {
  const formData = new FormData();
  if (file) {
    formData.append('file', file);
  }
  if (variant !== undefined && variant !== null && String(variant).trim()) {
    formData.append('variant', String(variant).trim());
  }
  return fetchWithAuth(`/images/${imageId}/asset-variants`, {
    method: 'POST',
    tenantId,
    body: formData,
    headers: {},
  });
}

export async function updateAssetVariant(tenantId, imageId, variantId, payload = {}) {
  return fetchWithAuth(`/images/${imageId}/asset-variants/${variantId}`, {
    method: 'PATCH',
    tenantId,
    body: JSON.stringify(payload),
  });
}

export async function deleteAssetVariant(tenantId, imageId, variantId) {
  return fetchWithAuth(`/images/${imageId}/asset-variants/${variantId}`, {
    method: 'DELETE',
    tenantId,
  });
}

export async function getAssetVariantContent(tenantId, imageId, variantId, { signal } = {}) {
  return fetchWithAuth(`/images/${imageId}/asset-variants/${variantId}/content`, {
    tenantId,
    responseType: 'blob',
    signal,
  });
}

export async function inspectAssetVariant(tenantId, imageId, variantId) {
  return fetchWithAuth(`/images/${imageId}/asset-variants/${variantId}/inspect`, {
    tenantId,
  });
}

export async function refreshImageMetadata(tenantId, imageId) {
    return fetchWithAuth(`/images/${imageId}/refresh-metadata`, {
        method: 'POST',
        tenantId,
    });
}

export async function propagateDropboxTags(tenantId, imageId) {
    return fetchWithAuth(`/images/${imageId}/dropbox-tags`, {
        method: 'POST',
        tenantId,
    });
}

export async function uploadImages(tenantId, files) {
    const formData = new FormData();
    for (let file of files) {
        formData.append('files', file);
    }
    return fetchWithAuth(`/images/upload`, {
        method: 'POST',
        tenantId,
        body: formData,
        headers: {
            // Don't set Content-Type - let browser set it with boundary for FormData
        },
    });
}

export async function getActiveList(tenantId) {
    const data = await fetchWithAuth(`/lists/active`, { tenantId });
    return data || {};
}

export async function freezePermatags(tenantId, imageId) {
    return fetchWithAuth(`/images/${imageId}/permatags/freeze`, {
        method: 'POST',
        tenantId,
    });
}

export async function addPermatag(tenantId, imageId, keyword, category, signum) {
    return fetchWithAuth(`/images/${imageId}/permatags`, {
        method: 'POST',
        tenantId,
        body: JSON.stringify({ keyword, category, signum }),
    });
}

export async function bulkPermatags(tenantId, operations) {
    return fetchWithAuth(`/images/permatags/bulk`, {
        method: 'POST',
        tenantId,
        body: JSON.stringify({ operations }),
    });
}

export async function deletePermatag(tenantId, imageId, permatagId) {
    return fetchWithAuth(`/images/${imageId}/permatags/${permatagId}`, {
        method: 'DELETE',
        tenantId,
    });
}

export async function getPermatags(tenantId, imageId) {
    const data = await fetchWithAuth(`/images/${imageId}/permatags`, { tenantId });
    return data || [];
}

// ============================================================================
// CRUD Operations for Common Resources
// ============================================================================

// Keyword category CRUD
const keywordCategoryCrud = createCrudOps('/admin/keywords/categories');

export async function getKeywordCategories(tenantId) {
  const data = await keywordCategoryCrud.list(tenantId);
  return data || [];
}

export async function createKeywordCategory(tenantId, payload) {
  return keywordCategoryCrud.create(tenantId, payload);
}

export async function updateKeywordCategory(tenantId, categoryId, payload) {
  return keywordCategoryCrud.update(tenantId, categoryId, payload);
}

export async function deleteKeywordCategory(tenantId, categoryId) {
  return keywordCategoryCrud.delete(tenantId, categoryId);
}

export async function getKeywordsInCategory(tenantId, categoryId) {
  const data = await fetchWithAuth(`/admin/keywords/categories/${categoryId}/keywords`, { tenantId });
  return data || [];
}

// Keyword CRUD
const keywordCrud = createCrudOps('/admin/keywords');

export async function createKeyword(tenantId, categoryId, payload) {
  return fetchWithAuth(`/admin/keywords/categories/${categoryId}/keywords`, {
    method: 'POST',
    tenantId,
    body: JSON.stringify(payload),
  });
}

export async function updateKeyword(tenantId, keywordId, payload) {
  return keywordCrud.update(tenantId, keywordId, payload);
}

export async function deleteKeyword(tenantId, keywordId) {
  return keywordCrud.delete(tenantId, keywordId);
}

// List CRUD
const listCrud = createCrudOps('/lists');

export async function getLists(tenantId, { force = false, visibilityScope = 'default' } = {}) {
  const normalizedVisibilityScope = String(visibilityScope || 'default').trim().toLowerCase() || 'default';
  const data = await queryRequest(
    ['lists', tenantId, normalizedVisibilityScope],
    () => listCrud.list(tenantId, { visibility_scope: normalizedVisibilityScope }),
    { staleTimeMs: LISTS_CACHE_MS, force }
  );
  return data || [];
}

export async function createList(tenantId, list) {
  const result = await listCrud.create(tenantId, list);
  invalidateQueries(['lists', tenantId]);
  return result;
}

export async function deleteList(tenantId, listId) {
  const result = await listCrud.delete(tenantId, listId);
  invalidateQueries(['lists', tenantId]);
  return result;
}

export async function getListItems(tenantId, listId, { idsOnly = false } = {}) {
  const params = new URLSearchParams();
  if (idsOnly) {
    params.append('ids_only', 'true');
  }
  const url = `/lists/${listId}/items${params.toString() ? '?' + params.toString() : ''}`;
  const data = await fetchWithAuth(url, { tenantId });
  return data || [];
}

export async function deleteListItem(tenantId, itemId) {
  const result = await fetchWithAuth(`/lists/items/${itemId}`, {
    method: 'DELETE',
    tenantId,
  });
  invalidateQueries(['lists', tenantId]);
  return result;
}

export async function updateList(tenantId, list) {
  const result = await listCrud.patch(tenantId, list.id, list);
  invalidateQueries(['lists', tenantId]);
  return result;
}

// ============================================================================
// Admin endpoints
// ============================================================================

/**
 * Create a new tenant
 * @param {Object} data - Tenant data (id, name, active)
 * @returns {Promise<Object>} Created tenant
 */
export async function createTenant(data) {
    return fetchWithAuth(`/admin/tenants`, {
        method: 'POST',
        body: JSON.stringify(data)
    }).catch(error => {
        const err = new Error(error.message);
        throw err;
    }).finally(() => {
        invalidateQueries(['tenants']);
    });
}

/**
 * Update an existing tenant
 * @param {string} tenantId - Tenant ID
 * @param {Object} data - Tenant data to update
 * @returns {Promise<Object>} Updated tenant
 */
export async function updateTenant(tenantId, data) {
    return fetchWithAuth(`/admin/tenants/${tenantId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }).catch(error => {
        const err = new Error(error.message);
        throw err;
    }).finally(() => {
        invalidateQueries(['tenants']);
    });
}

/**
 * Delete a tenant
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<void>}
 */
export async function deleteTenant(tenantId) {
    return fetchWithAuth(`/admin/tenants/${tenantId}`, {
        method: 'DELETE'
    }).catch(error => {
        const err = new Error(error.message);
        throw err;
    }).finally(() => {
        invalidateQueries(['tenants']);
    });
}

/**
 * Get system settings
 * @returns {Promise<Object>} System configuration
 */
export async function getSystemSettings() {
    return queryRequest(
        ['systemSettings'],
        () => fetchWithAuth(`/config/system`),
        { staleTimeMs: SYSTEM_SETTINGS_CACHE_MS }
    );
}

/**
 * Get integration status/config for current tenant (tenant admin scope)
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Object>} Integration status payload
 */
export async function getIntegrationStatus(tenantId) {
  return queryRequest(
    ['integrationStatus', tenantId],
    () => fetchWithAuth('/admin/integrations/status', { tenantId }),
    { staleTimeMs: INTEGRATION_STATUS_CACHE_MS }
  );
}

/**
 * Start provider OAuth connection for current tenant (tenant admin scope)
 * @param {string} tenantId - Tenant ID
 * @param {'dropbox'|'gdrive'} provider - Provider id
 * @param {string} returnTo - Same-origin return path after OAuth
 * @param {string} redirectOrigin - Browser origin for callback
 * @returns {Promise<Object>} OAuth authorize URL payload
 */
export async function startIntegrationConnect(
  tenantId,
  provider,
  returnTo = '/app?tab=library&subTab=providers',
  redirectOrigin = ''
) {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  if (!normalizedProvider || !['dropbox', 'gdrive'].includes(normalizedProvider)) {
    throw new Error('Invalid provider');
  }
  const result = await fetchWithAuth(`/admin/integrations/${normalizedProvider}/connect`, {
    method: 'POST',
    tenantId,
    body: JSON.stringify({
      return_to: returnTo,
      redirect_origin: redirectOrigin,
    }),
  });
  invalidateQueries(['integrationStatus', tenantId]);
  return result;
}

/**
 * Disconnect provider integration for current tenant (tenant admin scope)
 * @param {string} tenantId - Tenant ID
 * @param {'dropbox'|'gdrive'} provider - Provider id
 * @returns {Promise<Object>} Disconnect result
 */
export async function disconnectIntegration(tenantId, provider) {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  if (!normalizedProvider || !['dropbox', 'gdrive'].includes(normalizedProvider)) {
    throw new Error('Invalid provider');
  }
  const result = await fetchWithAuth(`/admin/integrations/${normalizedProvider}/connection`, {
    method: 'DELETE',
    tenantId,
  });
  invalidateQueries(['integrationStatus', tenantId]);
  return result;
}

/**
 * Update integration config for tenant-admin provider settings
 * @param {string} tenantId - Tenant ID
 * @param {{provider?: string, syncFolders?: string[], defaultSourceProvider?: string}} payload
 * @returns {Promise<Object>} Updated config
 */
export async function updateIntegrationConfig(tenantId, payload = {}) {
  const body = {};
  if (payload.provider !== undefined) {
    body.provider = payload.provider;
  }
  if (payload.syncFolders !== undefined) {
    body.sync_folders = payload.syncFolders;
  }
  if (payload.defaultSourceProvider !== undefined) {
    body.default_source_provider = payload.defaultSourceProvider;
  }
  const result = await fetchWithAuth('/admin/integrations/dropbox/config', {
    method: 'PATCH',
    tenantId,
    body: JSON.stringify(body),
  });
  invalidateQueries(['integrationStatus', tenantId]);
  return result;
}

/**
 * List jobs for a tenant
 * @param {string} tenantId
 * @param {{status?: string, source?: string, limit?: number, offset?: number, createdAfter?: string, createdBefore?: string}} options
 * @returns {Promise<Object>}
 */
export async function getJobs(tenantId, options = {}) {
  const params = new URLSearchParams();
  if (options.status) params.append('status', String(options.status));
  if (options.source) params.append('source', String(options.source));
  if (options.limit !== undefined && options.limit !== null) params.append('limit', String(options.limit));
  if (options.offset !== undefined && options.offset !== null) params.append('offset', String(options.offset));
  if (options.createdAfter) params.append('created_after', String(options.createdAfter));
  if (options.createdBefore) params.append('created_before', String(options.createdBefore));
  const query = params.toString();
  return fetchWithAuth(`/jobs${query ? `?${query}` : ''}`, { tenantId });
}

/**
 * Queue summary for a tenant
 * @param {string} tenantId
 * @returns {Promise<Object>}
 */
export async function getJobsSummary(tenantId) {
  return fetchWithAuth('/jobs/summary', { tenantId });
}

/**
 * Enqueue a job for a tenant
 * @param {string} tenantId
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
export async function enqueueJob(tenantId, payload) {
  return fetchWithAuth('/jobs', {
    method: 'POST',
    tenantId,
    body: JSON.stringify(payload || {}),
  });
}

/**
 * Cancel a job
 * @param {string} tenantId
 * @param {string} jobId
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
export async function cancelJob(tenantId, jobId, payload = {}) {
  return fetchWithAuth(`/jobs/${jobId}/cancel`, {
    method: 'POST',
    tenantId,
    body: JSON.stringify(payload || {}),
  });
}

/**
 * Retry a job
 * @param {string} tenantId
 * @param {string} jobId
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
export async function retryJob(tenantId, jobId, payload = {}) {
  return fetchWithAuth(`/jobs/${jobId}/retry`, {
    method: 'POST',
    tenantId,
    body: JSON.stringify(payload || {}),
  });
}

/**
 * Delete a job
 * @param {string} tenantId
 * @param {string} jobId
 * @returns {Promise<Object>}
 */
export async function deleteJob(tenantId, jobId) {
  return fetchWithAuth(`/jobs/${jobId}`, {
    method: 'DELETE',
    tenantId,
  });
}

/**
 * List attempts for a job
 * @param {string} tenantId
 * @param {string} jobId
 * @param {{limit?: number, offset?: number}} options
 * @returns {Promise<Object>}
 */
export async function getJobAttempts(tenantId, jobId, options = {}) {
  const params = new URLSearchParams();
  if (options.limit !== undefined && options.limit !== null) params.append('limit', String(options.limit));
  if (options.offset !== undefined && options.offset !== null) params.append('offset', String(options.offset));
  const query = params.toString();
  return fetchWithAuth(`/jobs/${jobId}/attempts${query ? `?${query}` : ''}`, { tenantId });
}

/**
 * List active job definitions (super-admin endpoint)
 * @param {string} tenantId
 * @param {{includeInactive?: boolean}} options
 * @returns {Promise<Object>}
 */
export async function getJobDefinitions(tenantId, options = {}) {
  const params = new URLSearchParams();
  if (options.includeInactive) params.append('include_inactive', 'true');
  const query = params.toString();
  return fetchWithAuth(`/jobs/definitions${query ? `?${query}` : ''}`, { tenantId });
}

/**
 * List active definitions available to a tenant admin for enqueue actions
 * @param {string} tenantId
 * @returns {Promise<Object>}
 */
export async function getTenantJobCatalog(tenantId) {
  return fetchWithAuth('/jobs/catalog', { tenantId });
}

/**
 * List global job definitions (super-admin)
 * @param {{includeInactive?: boolean}} options
 * @returns {Promise<Object>}
 */
export async function getGlobalJobDefinitions(options = {}) {
  return getJobDefinitions(undefined, options);
}

/**
 * Create job definition (super-admin)
 * @param {string} tenantId
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
export async function createJobDefinition(tenantId, payload) {
  return fetchWithAuth('/jobs/definitions', {
    method: 'POST',
    tenantId,
    body: JSON.stringify(payload || {}),
  });
}

/**
 * Create global job definition (super-admin)
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
export async function createGlobalJobDefinition(payload) {
  return createJobDefinition(undefined, payload);
}

/**
 * Update job definition (super-admin)
 * @param {string} tenantId
 * @param {string} definitionId
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
export async function updateJobDefinition(tenantId, definitionId, payload) {
  return fetchWithAuth(`/jobs/definitions/${definitionId}`, {
    method: 'PATCH',
    tenantId,
    body: JSON.stringify(payload || {}),
  });
}

/**
 * Update global job definition (super-admin)
 * @param {string} definitionId
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
export async function updateGlobalJobDefinition(definitionId, payload) {
  return updateJobDefinition(undefined, definitionId, payload);
}

/**
 * Delete job definition (super-admin)
 * @param {string} tenantId
 * @param {string} definitionId
 * @returns {Promise<Object>}
 */
export async function deleteJobDefinition(tenantId, definitionId) {
  return fetchWithAuth(`/jobs/definitions/${definitionId}`, {
    method: 'DELETE',
    tenantId,
  });
}

/**
 * Delete global job definition (super-admin)
 * @param {string} definitionId
 * @returns {Promise<Object>}
 */
export async function deleteGlobalJobDefinition(definitionId) {
  return deleteJobDefinition(undefined, definitionId);
}

/**
 * List job triggers
 * @param {string} tenantId
 * @param {{includeDisabled?: boolean}} options
 * @returns {Promise<Object>}
 */
export async function getJobTriggers(tenantId, options = {}) {
  const params = new URLSearchParams();
  if (options.includeDisabled) params.append('include_disabled', 'true');
  const query = params.toString();
  return fetchWithAuth(`/jobs/triggers${query ? `?${query}` : ''}`, { tenantId });
}

/**
 * List global job triggers (super-admin)
 * @param {{includeDisabled?: boolean}} options
 * @returns {Promise<Object>}
 */
export async function getGlobalJobTriggers(options = {}) {
  return getJobTriggers(undefined, options);
}

/**
 * Create job trigger
 * @param {string} tenantId
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
export async function createJobTrigger(tenantId, payload) {
  return fetchWithAuth('/jobs/triggers', {
    method: 'POST',
    tenantId,
    body: JSON.stringify(payload || {}),
  });
}

/**
 * Create global job trigger (super-admin)
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
export async function createGlobalJobTrigger(payload) {
  return createJobTrigger(undefined, payload);
}

/**
 * Update job trigger
 * @param {string} tenantId
 * @param {string} triggerId
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
export async function updateJobTrigger(tenantId, triggerId, payload) {
  return fetchWithAuth(`/jobs/triggers/${triggerId}`, {
    method: 'PATCH',
    tenantId,
    body: JSON.stringify(payload || {}),
  });
}

/**
 * Update global job trigger (super-admin)
 * @param {string} triggerId
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
export async function updateGlobalJobTrigger(triggerId, payload) {
  return updateJobTrigger(undefined, triggerId, payload);
}

/**
 * Delete job trigger
 * @param {string} tenantId
 * @param {string} triggerId
 * @returns {Promise<Object>}
 */
export async function deleteJobTrigger(tenantId, triggerId) {
  return fetchWithAuth(`/jobs/triggers/${triggerId}`, {
    method: 'DELETE',
    tenantId,
  });
}

/**
 * Delete global job trigger (super-admin)
 * @param {string} triggerId
 * @returns {Promise<Object>}
 */
export async function deleteGlobalJobTrigger(triggerId) {
  return deleteJobTrigger(undefined, triggerId);
}

/**
 * List workflow definitions (super-admin)
 * @param {{includeInactive?: boolean}} options
 * @returns {Promise<Object>}
 */
export async function getGlobalWorkflowDefinitions(options = {}) {
  const params = new URLSearchParams();
  if (options.includeInactive) params.append('include_inactive', 'true');
  const query = params.toString();
  return fetchWithAuth(`/jobs/workflows${query ? `?${query}` : ''}`);
}

/**
 * Create workflow definition (super-admin)
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
export async function createGlobalWorkflowDefinition(payload) {
  return fetchWithAuth('/jobs/workflows', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

/**
 * Update workflow definition (super-admin)
 * @param {string} workflowId
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
export async function updateGlobalWorkflowDefinition(workflowId, payload) {
  return fetchWithAuth(`/jobs/workflows/${workflowId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload || {}),
  });
}

/**
 * Delete workflow definition (super-admin)
 * @param {string} workflowId
 * @returns {Promise<Object>}
 */
export async function deleteGlobalWorkflowDefinition(workflowId) {
  return fetchWithAuth(`/jobs/workflows/${workflowId}`, {
    method: 'DELETE',
  });
}

/**
 * List active workflow catalog for tenant
 * @param {string} tenantId
 * @returns {Promise<Object>}
 */
export async function getTenantWorkflowCatalog(tenantId) {
  return fetchWithAuth('/jobs/workflows/catalog', { tenantId });
}

/**
 * Enqueue workflow run for tenant
 * @param {string} tenantId
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
export async function enqueueWorkflowRun(tenantId, payload) {
  return fetchWithAuth('/jobs/workflows/runs', {
    method: 'POST',
    tenantId,
    body: JSON.stringify(payload || {}),
  });
}

/**
 * List workflow runs for tenant
 * @param {string} tenantId
 * @param {{status?: string, limit?: number, offset?: number, includeSteps?: boolean}} options
 * @returns {Promise<Object>}
 */
export async function getWorkflowRuns(tenantId, options = {}) {
  const params = new URLSearchParams();
  if (options.status) params.append('status', String(options.status));
  if (options.limit !== undefined && options.limit !== null) params.append('limit', String(options.limit));
  if (options.offset !== undefined && options.offset !== null) params.append('offset', String(options.offset));
  if (options.includeSteps) params.append('include_steps', 'true');
  const query = params.toString();
  return fetchWithAuth(`/jobs/workflows/runs${query ? `?${query}` : ''}`, { tenantId });
}

/**
 * Cancel workflow run for tenant
 * @param {string} tenantId
 * @param {string} workflowRunId
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
export async function cancelWorkflowRun(tenantId, workflowRunId, payload = {}) {
  return fetchWithAuth(`/jobs/workflows/runs/${workflowRunId}/cancel`, {
    method: 'POST',
    tenantId,
    body: JSON.stringify(payload || {}),
  });
}

/**
 * Delete workflow run for tenant
 * @param {string} tenantId
 * @param {string} workflowRunId
 * @returns {Promise<Object>}
 */
export async function deleteWorkflowRun(tenantId, workflowRunId) {
  return fetchWithAuth(`/jobs/workflows/runs/${workflowRunId}`, {
    method: 'DELETE',
    tenantId,
  });
}

/**
 * Get tenant photo count (for deletion validation)
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<number>} Number of photos owned by tenant
 */
export async function getTenantPhotoCount(tenantId) {
    try {
        const data = await fetchWithAuth(`/admin/tenants/${tenantId}/photo_count`);
        return data.count || 0;
    } catch (error) {
        console.warn(`Error fetching photo count for tenant ${tenantId}:`, error);
        return 0;
    }
}

/**
 * Disable a user account
 * @param {string} supabaseUid - User UUID to disable
 * @returns {Promise<Object>} Success message
 */
export async function disableUser(supabaseUid) {
    return fetchWithAuth(`/admin/users/${supabaseUid}/disable`, {
        method: 'POST'
    });
}

/**
 * Enable a disabled user account
 * @param {string} supabaseUid - User UUID to enable
 * @returns {Promise<Object>} Success message
 */
export async function enableUser(supabaseUid) {
    return fetchWithAuth(`/admin/users/${supabaseUid}/enable`, {
        method: 'POST'
    });
}

/**
 * Set super admin status for a user
 * @param {string} supabaseUid - User UUID to modify
 * @param {boolean} isSuperAdmin - Whether user should be super admin
 * @returns {Promise<Object>} Success message with updated status
 */
export async function setSuperAdminStatus(supabaseUid, isSuperAdmin) {
    return fetchWithAuth(`/admin/users/${supabaseUid}/set-super-admin`, {
        method: 'POST',
        body: JSON.stringify({ is_super_admin: isSuperAdmin })
    });
}

/**
 * Update a user's role in a specific tenant membership
 * @param {string} supabaseUid - User UUID
 * @param {string} tenantId - Tenant ID
 * @param {'user'|'editor'|'admin'} role - Updated role value
 * @returns {Promise<Object>} Success payload
 */
export async function updateUserTenantRole(supabaseUid, tenantId, role) {
    return fetchWithAuth(`/admin/users/${supabaseUid}/tenant-memberships/${tenantId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role })
    });
}

/**
 * Remove a tenant assignment from a user
 * @param {string} supabaseUid - User UUID
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Object>} Success payload
 */
export async function removeUserTenantAssignment(supabaseUid, tenantId) {
    return fetchWithAuth(`/admin/users/${supabaseUid}/tenant-memberships/${tenantId}`, {
        method: 'DELETE'
    });
}

/**
 * List users assigned to a tenant (tenant admin scope)
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Array>} Tenant users
 */
export async function getTenantUsers(tenantId) {
    return fetchWithAuth('/admin/tenant-users', {
        tenantId
    });
}

/**
 * Update user role in the current tenant (tenant admin scope)
 * @param {string} tenantId - Tenant ID
 * @param {string} supabaseUid - User UUID
 * @param {string|Object} roleOrAssignment - Legacy role string or RBAC assignment payload
 * @returns {Promise<Object>} Success payload
 */
export async function updateTenantUserRole(tenantId, supabaseUid, roleOrAssignment) {
    const payload = (typeof roleOrAssignment === 'string')
        ? { role: roleOrAssignment }
        : { ...(roleOrAssignment || {}) };
    return fetchWithAuth(`/admin/tenant-users/${supabaseUid}/role`, {
        method: 'PATCH',
        tenantId,
        body: JSON.stringify(payload)
    });
}

/**
 * List active RBAC permission catalog entries for tenant role configuration
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Object>} Permission catalog payload
 */
export async function getTenantPermissionCatalog(tenantId) {
    return fetchWithAuth('/admin/permissions/catalog', { tenantId });
}

/**
 * List tenant RBAC roles
 * @param {string} tenantId - Tenant ID
 * @param {Object} options - Query options
 * @param {boolean} options.includeInactive - Include inactive roles
 * @returns {Promise<Object>} Role list payload
 */
export async function getTenantRoles(tenantId, options = {}) {
    const params = new URLSearchParams();
    if (options.includeInactive) params.append('include_inactive', 'true');
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return fetchWithAuth(`/admin/roles${suffix}`, { tenantId });
}

/**
 * Create a custom tenant role
 * @param {string} tenantId - Tenant ID
 * @param {Object} payload - Role payload
 * @returns {Promise<Object>} Created role
 */
export async function createTenantRole(tenantId, payload) {
    return fetchWithAuth('/admin/roles', {
        method: 'POST',
        tenantId,
        body: JSON.stringify(payload || {})
    });
}

/**
 * Update tenant role metadata
 * @param {string} tenantId - Tenant ID
 * @param {string} roleId - Role UUID
 * @param {Object} payload - Partial update payload
 * @returns {Promise<Object>} Updated role
 */
export async function updateTenantRole(tenantId, roleId, payload) {
    return fetchWithAuth(`/admin/roles/${roleId}`, {
        method: 'PATCH',
        tenantId,
        body: JSON.stringify(payload || {})
    });
}

/**
 * Replace tenant role permissions
 * @param {string} tenantId - Tenant ID
 * @param {string} roleId - Role UUID
 * @param {Array<string>} permissionKeys - Permission keys
 * @returns {Promise<Object>} Updated role
 */
export async function replaceTenantRolePermissions(tenantId, roleId, permissionKeys = []) {
    return fetchWithAuth(`/admin/roles/${roleId}/permissions`, {
        method: 'PUT',
        tenantId,
        body: JSON.stringify({ permission_keys: permissionKeys })
    });
}

/**
 * Delete a tenant role
 * @param {string} tenantId - Tenant ID
 * @param {string} roleId - Role UUID
 * @returns {Promise<Object>} Delete result
 */
export async function deleteTenantRole(tenantId, roleId) {
    return fetchWithAuth(`/admin/roles/${roleId}`, {
        method: 'DELETE',
        tenantId
    });
}

/**
 * Remove user membership from the current tenant (tenant admin scope)
 * @param {string} tenantId - Tenant ID
 * @param {string} supabaseUid - User UUID
 * @returns {Promise<Object>} Success payload
 */
export async function removeTenantUserMembership(tenantId, supabaseUid) {
    return fetchWithAuth(`/admin/tenant-users/${supabaseUid}`, {
        method: 'DELETE',
        tenantId
    });
}

/**
 * Create a tenant invitation for a user with pre-assigned role
 * @param {string} tenantId - Tenant ID
 * @param {string} email - Invitee email
 * @param {'user'|'editor'|'admin'} role - Intended tenant role after acceptance
 * @returns {Promise<Object>} Invitation payload (includes token)
 */
export async function createTenantInvitation(tenantId, email, role = 'user') {
    return fetchWithAuth('/admin/invitations', {
        method: 'POST',
        tenantId,
        body: JSON.stringify({
            email,
            tenant_id: tenantId,
            role
        })
    });
}

/**
 * List invitations for the tenant
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Array>} Invitations
 */
export async function getTenantInvitations(tenantId) {
    const params = new URLSearchParams();
    params.append('tenant_id', tenantId);
    return fetchWithAuth(`/admin/invitations?${params.toString()}`, { tenantId });
}

/**
 * Cancel a pending invitation
 * @param {string} tenantId - Tenant ID
 * @param {string} invitationId - Invitation UUID
 * @returns {Promise<Object>} Success payload
 */
export async function cancelTenantInvitation(tenantId, invitationId) {
    return fetchWithAuth(`/admin/invitations/${invitationId}`, {
        method: 'DELETE',
        tenantId
    });
}

// ============================================================================
// People and Categories Management
// ============================================================================

/**
 * Get all people for a tenant
 * @param {string} tenantId - Tenant ID
 * @param {Object} options - Query options (limit)
 * @returns {Promise<Array>} List of people
 */
export async function getPeople(tenantId, options = {}) {
    const params = new URLSearchParams();
    if (options.limit) params.append('limit', options.limit);

    return fetchWithAuth(`/people${params.toString() ? '?' + params.toString() : ''}`, { tenantId });
}

/**
 * Create a new person
 * @param {string} tenantId - Tenant ID
 * @param {Object} data - Person data (name, instagram_url)
 * @returns {Promise<Object>} Created person
 */
export async function createPerson(tenantId, data) {
    return fetchWithAuth('/people', {
        method: 'POST',
        body: JSON.stringify(data),
        tenantId
    });
}

/**
 * Update an existing person
 * @param {string} tenantId - Tenant ID
 * @param {number} personId - Person ID
 * @param {Object} data - Fields to update (name, instagram_url)
 * @returns {Promise<Object>} Updated person
 */
export async function updatePerson(tenantId, personId, data) {
    return fetchWithAuth(`/people/${personId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
        tenantId
    });
}

/**
 * Delete a person
 * @param {string} tenantId - Tenant ID
 * @param {number} personId - Person ID
 * @returns {Promise<Object>} Success message
 */
export async function deletePerson(tenantId, personId) {
    return fetchWithAuth(`/people/${personId}`, {
        method: 'DELETE',
        tenantId
    });
}

/**
 * Get all people tags for an image
 * @param {string} tenantId - Tenant ID
 * @param {number} imageId - Image ID
 * @returns {Promise<Object>} People tags for the image
 */
export async function getImagePeopleTags(tenantId, imageId) {
    return fetchWithAuth(`/images/${imageId}/people`, {
        tenantId
    });
}

/**
 * Add a person tag to an image
 * @param {string} tenantId - Tenant ID
 * @param {number} imageId - Image ID
 * @param {Object} data - Tag data (person_id, confidence)
 * @returns {Promise<Object>} Created tag
 */
export async function addImagePersonTag(tenantId, imageId, data) {
    return fetchWithAuth(`/images/${imageId}/people`, {
        method: 'POST',
        body: JSON.stringify(data),
        tenantId
    });
}

/**
 * Remove a person tag from an image
 * @param {string} tenantId - Tenant ID
 * @param {number} imageId - Image ID
 * @param {number} personId - Person ID to remove
 * @returns {Promise<Object>} Success message
 */
export async function removeImagePersonTag(tenantId, imageId, personId) {
    return fetchWithAuth(`/images/${imageId}/people/${personId}`, {
        method: 'DELETE',
        tenantId
    });
}

export async function getAssetNote(tenantId, imageId, noteType) {
    return fetchWithAuth(`/images/${imageId}/notes/${noteType}`, { tenantId });
}

export async function upsertAssetNote(tenantId, imageId, noteType, body) {
    return fetchWithAuth(`/images/${imageId}/notes/${noteType}`, {
        method: 'PUT',
        tenantId,
        body: JSON.stringify({ body }),
    });
}
