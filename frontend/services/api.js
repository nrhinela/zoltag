import { getAccessToken } from './supabase.js';
import {
  addPaginationParams,
  addRatingParams,
  addPermatagParams,
  addMlTagParams,
  addCategoryFilterParams,
  addOrderingParams,
  addMiscParams
} from './api-params.js';
import { createCrudOps } from './crud-helper.js';
import { cachedRequest } from './request-cache.js';

// Use relative URL - works in both dev (via Vite proxy) and production
const API_BASE_URL = '/api/v1';
const STATS_CACHE_MS = 10000;
const TENANTS_CACHE_MS = 5 * 60 * 1000;
const LISTS_CACHE_MS = 10000;

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

  // Legacy search parameter
  if (filters.search) {
    // The backend doesn't seem to have a direct text search endpoint,
    // but the old frontend had a client-side search. We will add a 'keywords'
    // parameter for now, which is a deprecated feature of the API, but might work.
    params.append('keywords', filters.search);
  }

  // Add parameters by category
  addMiscParams(params, filters);
  addRatingParams(params, filters);
  addPaginationParams(params, filters);
  addCategoryFilterParams(params, filters);
  addOrderingParams(params, filters);
  addPermatagParams(params, filters);
  addMlTagParams(params, filters);

  const url = `/images?${params.toString()}`;
  return fetchWithAuth(url, {
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
  const cacheKey = `imageStats:${tenantId}:${includeRatings ? 'full' : 'summary'}`;
  return cachedRequest(
    cacheKey,
    () => fetchWithAuth(`/images/stats${suffix}`, { tenantId }),
    { ttlMs: STATS_CACHE_MS, force }
  );
}

export async function getFullImage(tenantId, imageId, { signal } = {}) {
  return fetchWithAuth(`/images/${imageId}/full`, {
    tenantId,
    responseType: 'blob',
    signal,
  });
}

export async function getTagStats(tenantId, { force = false } = {}) {
  return cachedRequest(
    `tagStats:${tenantId}`,
    () => fetchWithAuth(`/tag-stats`, { tenantId }),
    { ttlMs: STATS_CACHE_MS, force }
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
  return cachedRequest(
    `mlTrainingStats:${tenantId}`,
    () => fetchWithAuth(`/ml-training/stats`, { tenantId }),
    { ttlMs: STATS_CACHE_MS, force }
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

    const url = params.toString() ? `/keywords?${params.toString()}` : `/keywords`;
    const data = await fetchWithAuth(url, { tenantId });
    return data.keywords_by_category || {};
}

export async function getTenants({ force = false } = {}) {
    return cachedRequest('tenants:admin', async () => {
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
    }, { ttlMs: TENANTS_CACHE_MS, force });
}

export async function getTenantsPublic({ force = false } = {}) {
    return cachedRequest('tenants:public', async () => {
        return await fetchWithAuth(`/tenants`);
    }, { ttlMs: TENANTS_CACHE_MS, force });
}

export async function setRating(tenantId, imageId, rating) {
    return fetchWithAuth(`/images/${imageId}/rating`, {
        method: 'PATCH',
        tenantId,
        body: JSON.stringify({ rating }),
    });
}

export async function addToList(tenantId, listId, photoId) {
    return fetchWithAuth(`/lists/${listId}/add-photo`, {
        method: 'POST',
        tenantId,
        body: JSON.stringify({ photo_id: photoId }),
    });
}

export async function addToRecentList(tenantId, photoId) {
    return fetchWithAuth(`/lists/add-photo`, {
        method: 'POST',
        tenantId,
        body: JSON.stringify({ photo_id: photoId }),
    });
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

export async function getLists(tenantId, { force = false } = {}) {
  const data = await cachedRequest(
    `lists:${tenantId}`,
    () => listCrud.list(tenantId),
    { ttlMs: LISTS_CACHE_MS, force }
  );
  return data || [];
}

export async function createList(tenantId, list) {
  return listCrud.create(tenantId, list);
}

export async function deleteList(tenantId, listId) {
  return listCrud.delete(tenantId, listId);
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
  return fetchWithAuth(`/lists/items/${itemId}`, {
    method: 'DELETE',
    tenantId,
  });
}

export async function updateList(tenantId, list) {
  return listCrud.patch(tenantId, list.id, list);
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
    });
}

/**
 * Get system settings
 * @returns {Promise<Object>} System configuration
 */
export async function getSystemSettings() {
    return fetchWithAuth(`/config/system`);
}

/**
 * Update tenant settings
 * @param {string} tenantId - Tenant ID
 * @param {Object} settings - Settings to update
 * @returns {Promise<Object>} Updated settings
 */
export async function updateTenantSettings(tenantId, settings) {
    return fetchWithAuth(`/admin/tenants/${tenantId}/settings`, {
        method: 'PATCH',
        body: JSON.stringify(settings)
    }).catch(error => {
        const err = new Error(error.message);
        throw err;
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

// ============================================================================
// People and Categories Management
// ============================================================================

/**
 * Get all person categories for a tenant
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Array>} List of person categories
 */
export async function getPeopleCategories(tenantId) {
    return fetchWithAuth('/config/people/categories', {
        tenantId
    });
}

/**
 * Get all people for a tenant
 * @param {string} tenantId - Tenant ID
 * @param {Object} options - Query options (limit, person_category)
 * @returns {Promise<Array>} List of people
 */
export async function getPeople(tenantId, options = {}) {
    const params = new URLSearchParams();
    if (options.limit) params.append('limit', options.limit);
    if (options.person_category) params.append('person_category', options.person_category);

    return fetchWithAuth(`/people${params.toString() ? '?' + params.toString() : ''}`, { tenantId });
}

/**
 * Create a new person
 * @param {string} tenantId - Tenant ID
 * @param {Object} data - Person data (name, instagram_url, person_category)
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
