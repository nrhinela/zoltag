// Use relative URL - works in both dev (via Vite proxy) and production
const API_BASE_URL = '/api/v1';

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


  const response = await fetch(`${API_BASE_URL}/images?${params.toString()}`, {
    headers: {
      'X-Tenant-ID': tenantId,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch images');
  }

  const data = await response.json();
  return data;
}

export async function getImageStats(tenantId) {
  const response = await fetch(`${API_BASE_URL}/images/stats`, {
    headers: {
      'X-Tenant-ID': tenantId,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch image stats');
  }

  return await response.json();
}

export async function getFullImage(tenantId, imageId) {
  const response = await fetch(`${API_BASE_URL}/images/${imageId}/full`, {
    headers: {
      'X-Tenant-ID': tenantId,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch full image');
  }

  return await response.blob();
}

export async function getTagStats(tenantId) {
  const response = await fetch(`${API_BASE_URL}/tag-stats`, {
    headers: {
      'X-Tenant-ID': tenantId,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch tag stats');
  }

  return await response.json();
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
    ? `${API_BASE_URL}/ml-training/images?${params.toString()}`
    : `${API_BASE_URL}/ml-training/images`;

  const response = await fetch(url, {
    headers: {
      'X-Tenant-ID': tenantId,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch ML training images');
  }

  return await response.json();
}

export async function getMlTrainingStats(tenantId) {
  const response = await fetch(`${API_BASE_URL}/ml-training/stats`, {
    headers: {
      'X-Tenant-ID': tenantId,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch ML training stats');
  }

  return await response.json();
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

    const url = params.toString() ? `${API_BASE_URL}/keywords?${params.toString()}` : `${API_BASE_URL}/keywords`;
    const response = await fetch(url, {
        headers: {
        'X-Tenant-ID': tenantId,
        },
    });

    if (!response.ok) {
        throw new Error('Failed to fetch keywords');
    }

    const data = await response.json();
    return data.keywords_by_category || {};
}

export async function getTenants() {
    // Use admin endpoint for complete tenant data (includes settings, dropbox config, etc)
    const response = await fetch(`${API_BASE_URL}/admin/tenants`);

    if (!response.ok) {
        // Fallback to non-admin endpoint if admin endpoint not available
        const fallbackResponse = await fetch(`${API_BASE_URL}/tenants`);
        if (!fallbackResponse.ok) {
            throw new Error('Failed to fetch tenants');
        }
        const data = await fallbackResponse.json();
        return data || [];
    }

    const data = await response.json();
    return data || [];
}

export async function setRating(tenantId, imageId, rating) {
    const response = await fetch(`${API_BASE_URL}/images/${imageId}/rating`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'X-Tenant-ID': tenantId,
        },
        body: JSON.stringify({ rating }),
    });

    if (!response.ok) {
        throw new Error('Failed to set rating');
    }

    const data = await response.json();
    return data;
}

export async function addToList(tenantId, photoId) {
    const response = await fetch(`${API_BASE_URL}/lists/add-photo`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Tenant-ID': tenantId,
        },
        body: JSON.stringify({ photo_id: photoId }),
    });

    if (!response.ok) {
        throw new Error('Failed to add to list');
    }

    const data = await response.json();
    return data;
}

export async function retagImage(tenantId, imageId) {
    const response = await fetch(`${API_BASE_URL}/images/${imageId}/retag`, {
        method: 'POST',
        headers: {
            'X-Tenant-ID': tenantId,
        },
    });

    if (!response.ok) {
        throw new Error('Failed to retag image');
    }

    const data = await response.json();
    return data;
}

export async function sync(tenantId) {
    const response = await fetch(`${API_BASE_URL}/sync`, {
        method: 'POST',
        headers: {
            'X-Tenant-ID': tenantId,
        },
    });

    if (!response.ok) {
        throw new Error('Failed to sync');
    }

    const data = await response.json();
    return data;
}

export async function retagAll(tenantId) {
    const response = await fetch(`${API_BASE_URL}/retag`, {
        method: 'POST',
        headers: {
            'X-Tenant-ID': tenantId,
        },
    });

    if (!response.ok) {
        throw new Error('Failed to retag all images');
    }

    const data = await response.json();
    return data;
}

export async function getImageDetails(tenantId, imageId) {
    const response = await fetch(`${API_BASE_URL}/images/${imageId}`, {
        headers: {
            'X-Tenant-ID': tenantId,
        },
    });

    if (!response.ok) {
        throw new Error('Failed to fetch image details');
    }

    const data = await response.json();
    return data;
}

export async function uploadImages(tenantId, files) {
    const formData = new FormData();
    for (let file of files) {
        formData.append('files', file);
    }
    const response = await fetch(`${API_BASE_URL}/images/upload`, {
        method: 'POST',
        headers: {
            'X-Tenant-ID': tenantId,
        },
        body: formData,
    });

    if (!response.ok) {
        throw new Error('Failed to upload images');
    }

    const data = await response.json();
    return data;
}

export async function getLists(tenantId) {
    const response = await fetch(`${API_BASE_URL}/lists`, {
        headers: {
            'X-Tenant-ID': tenantId,
        },
    });

    if (!response.ok) {
        throw new Error('Failed to fetch lists');
    }

    const data = await response.json();
    return data || []; // Return the data directly, or an empty array if data is null/undefined
}

export async function getActiveList(tenantId) {
    const response = await fetch(`${API_BASE_URL}/lists/active`, {
        headers: {
            'X-Tenant-ID': tenantId,
        },
    });

    if (!response.ok) {
        throw new Error('Failed to fetch active list');
    }

    const data = await response.json();
    return data || {};
}

export async function getKeywordCategories(tenantId) {
    const response = await fetch(`${API_BASE_URL}/admin/keywords/categories`, {
        headers: {
            'X-Tenant-ID': tenantId,
        },
    });

    if (!response.ok) {
        throw new Error('Failed to fetch keyword categories');
    }

    const data = await response.json();
    return data || [];
}

export async function createKeywordCategory(tenantId, payload) {
    const response = await fetch(`${API_BASE_URL}/admin/keywords/categories`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Tenant-ID': tenantId,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error('Failed to create keyword category');
    }

    return await response.json();
}

export async function updateKeywordCategory(tenantId, categoryId, payload) {
    const response = await fetch(`${API_BASE_URL}/admin/keywords/categories/${categoryId}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'X-Tenant-ID': tenantId,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error('Failed to update keyword category');
    }

    return await response.json();
}

export async function deleteKeywordCategory(tenantId, categoryId) {
    const response = await fetch(`${API_BASE_URL}/admin/keywords/categories/${categoryId}`, {
        method: 'DELETE',
        headers: {
            'X-Tenant-ID': tenantId,
        },
    });

    if (!response.ok) {
        throw new Error('Failed to delete keyword category');
    }

    return await response.json();
}

export async function getKeywordsInCategory(tenantId, categoryId) {
    const response = await fetch(`${API_BASE_URL}/admin/keywords/categories/${categoryId}/keywords`, {
        headers: {
            'X-Tenant-ID': tenantId,
        },
    });

    if (!response.ok) {
        throw new Error('Failed to fetch keywords');
    }

    const data = await response.json();
    return data || [];
}

export async function createKeyword(tenantId, categoryId, payload) {
    const response = await fetch(`${API_BASE_URL}/admin/keywords/categories/${categoryId}/keywords`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Tenant-ID': tenantId,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error('Failed to create keyword');
    }

    return await response.json();
}

export async function updateKeyword(tenantId, keywordId, payload) {
    const response = await fetch(`${API_BASE_URL}/admin/keywords/${keywordId}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'X-Tenant-ID': tenantId,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error('Failed to update keyword');
    }

    return await response.json();
}

export async function deleteKeyword(tenantId, keywordId) {
    const response = await fetch(`${API_BASE_URL}/admin/keywords/${keywordId}`, {
        method: 'DELETE',
        headers: {
            'X-Tenant-ID': tenantId,
        },
    });

    if (!response.ok) {
        throw new Error('Failed to delete keyword');
    }

    return await response.json();
}

export async function createList(tenantId, list) {
    const response = await fetch(`${API_BASE_URL}/lists`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Tenant-ID': tenantId,
        },
        body: JSON.stringify(list),
    });

    if (!response.ok) {
        throw new Error('Failed to create list');
    }

    return response.json();
}

export async function deleteList(tenantId, listId) {
    const response = await fetch(`${API_BASE_URL}/lists/${listId}`, {
        method: 'DELETE',
        headers: {
            'X-Tenant-ID': tenantId,
        },
    });

    if (!response.ok) {
        throw new Error('Failed to delete list');
    }

    return response.json();
}

export async function getListItems(tenantId, listId, { idsOnly = false } = {}) {
    const params = new URLSearchParams();
    if (idsOnly) {
        params.append('ids_only', 'true');
    }
    const url = params.toString()
        ? `${API_BASE_URL}/lists/${listId}/items?${params.toString()}`
        : `${API_BASE_URL}/lists/${listId}/items`;
    const response = await fetch(url, {
        headers: {
            'X-Tenant-ID': tenantId,
        },
    });

    if (!response.ok) {
        throw new Error('Failed to fetch list items');
    }

    const data = await response.json();
    return data || [];
}

export async function deleteListItem(tenantId, itemId) {
    const response = await fetch(`${API_BASE_URL}/lists/items/${itemId}`, {
        method: 'DELETE',
        headers: {
            'X-Tenant-ID': tenantId,
        },
    });

    if (!response.ok) {
        throw new Error('Failed to delete list item');
    }

    return response.json();
}

export async function freezePermatags(tenantId, imageId) {
    const response = await fetch(`${API_BASE_URL}/images/${imageId}/permatags/freeze`, {
        method: 'POST',
        headers: {
            'X-Tenant-ID': tenantId,
        },
    });

    if (!response.ok) {
        throw new Error('Failed to freeze permatags');
    }

    return response.json();
}

export async function addPermatag(tenantId, imageId, keyword, category, signum) {
    const response = await fetch(`${API_BASE_URL}/images/${imageId}/permatags`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Tenant-ID': tenantId,
        },
        body: JSON.stringify({ keyword, category, signum }),
    });

    if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Failed to add permanent tag');
    }

    return response.json();
};

export async function bulkPermatags(tenantId, operations) {
    const response = await fetch(`${API_BASE_URL}/images/permatags/bulk`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Tenant-ID': tenantId,
        },
        body: JSON.stringify({ operations }),
    });

    if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Failed to update permatags');
    }

    return response.json();
}

export async function deletePermatag(tenantId, imageId, permatagId) {
    const response = await fetch(`${API_BASE_URL}/images/${imageId}/permatags/${permatagId}`, {
        method: 'DELETE',
        headers: {
            'X-Tenant-ID': tenantId,
        },
    });

    if (!response.ok) {
        throw new Error('Failed to remove permanent tag');
    }

    // DELETE requests typically return a 204 No Content, so no data to parse
    return null;
}
export async function getPermatags(tenantId, imageId) {
    const response = await fetch(`${API_BASE_URL}/images/${imageId}/permatags`, {
        headers: {
            'X-Tenant-ID': tenantId,
        },
    });

    if (!response.ok) {
        throw new Error('Failed to fetch permanent tags');
    }

    const data = await response.json();
    return data || []; // Return the data directly, or an empty array if data is null/undefined
}

export async function updateList(tenantId, list) {
    const response = await fetch(`${API_BASE_URL}/lists/${list.id}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'X-Tenant-ID': tenantId,
        },
        body: JSON.stringify(list),
    });

    if (!response.ok) {
        throw new Error('Failed to update list');
    }

    const data = await response.json();
    return data;
}

// Admin endpoints

/**
 * Create a new tenant
 * @param {Object} data - Tenant data (id, name, active)
 * @returns {Promise<Object>} Created tenant
 */
export async function createTenant(data) {
    const response = await fetch(`${API_BASE_URL}/admin/tenants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });

    if (!response.ok) {
        const error = await response.json();
        const err = new Error(error.detail || 'Failed to create tenant');
        err.response = error;
        throw err;
    }

    return await response.json();
}

/**
 * Update an existing tenant
 * @param {string} tenantId - Tenant ID
 * @param {Object} data - Tenant data to update
 * @returns {Promise<Object>} Updated tenant
 */
export async function updateTenant(tenantId, data) {
    const response = await fetch(`${API_BASE_URL}/admin/tenants/${tenantId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });

    if (!response.ok) {
        const error = await response.json();
        const err = new Error(error.detail || 'Failed to update tenant');
        err.response = error;
        throw err;
    }

    return await response.json();
}

/**
 * Delete a tenant
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<void>}
 */
export async function deleteTenant(tenantId) {
    const response = await fetch(`${API_BASE_URL}/admin/tenants/${tenantId}`, {
        method: 'DELETE'
    });

    if (!response.ok) {
        const error = await response.json();
        const err = new Error(error.detail || 'Failed to delete tenant');
        err.response = error;
        throw err;
    }
}

/**
 * Get system settings
 * @returns {Promise<Object>} System configuration
 */
export async function getSystemSettings() {
    const response = await fetch(`${API_BASE_URL}/config/system`);

    if (!response.ok) {
        throw new Error('Failed to fetch system settings');
    }

    return await response.json();
}

/**
 * Update tenant settings
 * @param {string} tenantId - Tenant ID
 * @param {Object} settings - Settings to update
 * @returns {Promise<Object>} Updated settings
 */
export async function updateTenantSettings(tenantId, settings) {
    const response = await fetch(`${API_BASE_URL}/admin/tenants/${tenantId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
    });

    if (!response.ok) {
        const error = await response.json();
        const err = new Error(error.detail || 'Failed to update tenant settings');
        err.response = error;
        throw err;
    }

    return await response.json();
}

/**
 * Get tenant photo count (for deletion validation)
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<number>} Number of photos owned by tenant
 */
export async function getTenantPhotoCount(tenantId) {
    try {
        const response = await fetch(`${API_BASE_URL}/admin/tenants/${tenantId}/photo_count`);
        if (!response.ok) {
            console.warn(`Could not fetch photo count for tenant ${tenantId}:`, response.status);
            return 0;
        }
        const data = await response.json();
        return data.count || 0;
    } catch (error) {
        console.warn(`Error fetching photo count for tenant ${tenantId}:`, error);
        return 0;
    }
}
