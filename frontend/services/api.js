import { getAccessToken } from './supabase.js';

// Use relative URL - works in both dev (via Vite proxy) and production
const API_BASE_URL = '/api/v1';

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
  const headers = isFormData ? {} : { 'Content-Type': 'application/json' };

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


  if (filters.search) {
      // The backend doesn't seem to have a direct text search endpoint,
      // but the old frontend had a client-side search. We will add a 'keywords'
      // parameter for now, which is a deprecated feature of the API, but might work.
      params.append('keywords', filters.search);
  }

  if (filters.sort) {
    // The backend seems to sort by relevance score when keywords are provided,
    // and by ID desc otherwise. We will ignore this for now.
  }
  
  if (filters.date) {
    // The backend doesn't seem to have a date filter.
  }

  if (filters.listId) {
    params.append('list_id', filters.listId);
  }

  if (filters.rating !== undefined && filters.rating !== '') {
    params.append('rating', filters.rating);
    if (filters.ratingOperator) {
      params.append('rating_operator', filters.ratingOperator);
    }
  }

  if (filters.hideZeroRating) {
    params.append('hide_zero_rating', 'true');
  }

  if (filters.reviewed !== undefined && filters.reviewed !== '') {
    params.append('reviewed', filters.reviewed);
  }

  if (filters.limit !== undefined && filters.limit !== null && filters.limit !== '') {
    params.append('limit', String(filters.limit));
  }

  if (filters.offset !== undefined && filters.offset !== null && filters.offset !== '') {
    params.append('offset', String(filters.offset));
  }
  if (filters.anchorId !== undefined && filters.anchorId !== null && filters.anchorId !== '') {
    params.append('anchor_id', String(filters.anchorId));
  }

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
      if (filters.categoryFilterSource) {
        params.append('category_filter_source', filters.categoryFilterSource);
      }
  }

  if (filters.sortOrder) {
    params.append('date_order', filters.sortOrder);
  }
  if (filters.orderBy) {
    params.append('order_by', filters.orderBy);
  }
  if (filters.permatagKeyword) {
    params.append('permatag_keyword', filters.permatagKeyword);
  }
  if (filters.permatagCategory) {
    params.append('permatag_category', filters.permatagCategory);
  }
  if (filters.permatagSignum !== undefined && filters.permatagSignum !== null) {
    params.append('permatag_signum', String(filters.permatagSignum));
  }
  if (filters.permatagMissing) {
    params.append('permatag_missing', 'true');
  }
  if (filters.permatagPositiveMissing) {
    params.append('permatag_positive_missing', 'true');
  }
  if (filters.mlKeyword) {
    params.append('ml_keyword', filters.mlKeyword);
  }
  if (filters.mlTagType) {
    params.append('ml_tag_type', filters.mlTagType);
  }
  if (filters.dropboxPathPrefix) {
    params.append('dropbox_path_prefix', filters.dropboxPathPrefix);
  }


  return fetchWithAuth(`/images?${params.toString()}`, {
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
  const url = params.toString()
    ? `/images/dropbox-folders?${params.toString()}`
    : `/images/dropbox-folders`;
  return fetchWithAuth(url, { tenantId });
}

export async function getImageStats(tenantId) {
  return fetchWithAuth(`/images/stats`, { tenantId });
}

export async function getFullImage(tenantId, imageId) {
  return fetchWithAuth(`/images/${imageId}/full`, {
    tenantId,
    responseType: 'blob',
  });
}

export async function getTagStats(tenantId) {
  return fetchWithAuth(`/tag-stats`, { tenantId });
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
  const url = params.toString()
    ? `/ml-training/images?${params.toString()}`
    : `/ml-training/images`;
  return fetchWithAuth(url, { tenantId });
}

export async function getMlTrainingStats(tenantId) {
  return fetchWithAuth(`/ml-training/stats`, { tenantId });
}

export async function getKeywords(tenantId, filters = {}) {
    const params = new URLSearchParams();

    // Pass filter parameters to match the images endpoint
    if (filters.rating !== undefined && filters.rating !== '') {
        params.append('rating', filters.rating);
        if (filters.ratingOperator) {
            params.append('rating_operator', filters.ratingOperator);
        }
    }

    if (filters.hideZeroRating) {
        params.append('hide_zero_rating', 'true');
    }

    if (filters.listId) {
        params.append('list_id', filters.listId);
    }

    if (filters.reviewed !== undefined && filters.reviewed !== '') {
        params.append('reviewed', filters.reviewed);
    }
    if (filters.source) {
        params.append('source', filters.source);
    }

    const url = params.toString() ? `/keywords?${params.toString()}` : `/keywords`;
    const data = await fetchWithAuth(url, { tenantId });
    return data.keywords_by_category || {};
}

export async function getTenants() {
    // Use admin endpoint for complete tenant data (includes settings, dropbox config, etc)
    try {
        return await fetchWithAuth(`/admin/tenants`);
    } catch (error) {
        // Fallback to non-admin endpoint if admin endpoint not available
        try {
            return await fetchWithAuth(`/tenants`);
        } catch (fallbackError) {
            throw new Error('Failed to fetch tenants');
        }
    }
}

export async function setRating(tenantId, imageId, rating) {
    return fetchWithAuth(`/images/${imageId}/rating`, {
        method: 'PATCH',
        tenantId,
        body: JSON.stringify({ rating }),
    });
}

export async function addToList(tenantId, photoId) {
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

export async function getLists(tenantId) {
    const data = await fetchWithAuth(`/lists`, { tenantId });
    return data || [];
}

export async function getActiveList(tenantId) {
    const data = await fetchWithAuth(`/lists/active`, { tenantId });
    return data || {};
}

export async function getKeywordCategories(tenantId) {
    const data = await fetchWithAuth(`/admin/keywords/categories`, { tenantId });
    return data || [];
}

export async function createKeywordCategory(tenantId, payload) {
    return fetchWithAuth(`/admin/keywords/categories`, {
        method: 'POST',
        tenantId,
        body: JSON.stringify(payload),
    });
}

export async function updateKeywordCategory(tenantId, categoryId, payload) {
    return fetchWithAuth(`/admin/keywords/categories/${categoryId}`, {
        method: 'PUT',
        tenantId,
        body: JSON.stringify(payload),
    });
}

export async function deleteKeywordCategory(tenantId, categoryId) {
    return fetchWithAuth(`/admin/keywords/categories/${categoryId}`, {
        method: 'DELETE',
        tenantId,
    });
}

export async function getKeywordsInCategory(tenantId, categoryId) {
    const data = await fetchWithAuth(`/admin/keywords/categories/${categoryId}/keywords`, { tenantId });
    return data || [];
}

export async function createKeyword(tenantId, categoryId, payload) {
    return fetchWithAuth(`/admin/keywords/categories/${categoryId}/keywords`, {
        method: 'POST',
        tenantId,
        body: JSON.stringify(payload),
    });
}

export async function updateKeyword(tenantId, keywordId, payload) {
    return fetchWithAuth(`/admin/keywords/${keywordId}`, {
        method: 'PUT',
        tenantId,
        body: JSON.stringify(payload),
    });
}

export async function deleteKeyword(tenantId, keywordId) {
    return fetchWithAuth(`/admin/keywords/${keywordId}`, {
        method: 'DELETE',
        tenantId,
    });
}

export async function createList(tenantId, list) {
    return fetchWithAuth(`/lists`, {
        method: 'POST',
        tenantId,
        body: JSON.stringify(list),
    });
}

export async function deleteList(tenantId, listId) {
    return fetchWithAuth(`/lists/${listId}`, {
        method: 'DELETE',
        tenantId,
    });
}

export async function getListItems(tenantId, listId, { idsOnly = false } = {}) {
    const params = new URLSearchParams();
    if (idsOnly) {
        params.append('ids_only', 'true');
    }
    const url = params.toString()
        ? `/lists/${listId}/items?${params.toString()}`
        : `/lists/${listId}/items`;
    const data = await fetchWithAuth(url, { tenantId });
    return data || [];
}

export async function deleteListItem(tenantId, itemId) {
    return fetchWithAuth(`/lists/items/${itemId}`, {
        method: 'DELETE',
        tenantId,
    });
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

export async function updateList(tenantId, list) {
    return fetchWithAuth(`/lists/${list.id}`, {
        method: 'PATCH',
        tenantId,
        body: JSON.stringify(list),
    });
}

// Admin endpoints

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

    const url = `/people${params.toString() ? '?' + params.toString() : ''}`;
    return fetchWithAuth(url, {
        tenantId
    });
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
