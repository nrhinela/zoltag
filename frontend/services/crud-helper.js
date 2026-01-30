/**
 * Generic CRUD Helper for API Operations
 *
 * Reduces duplication in common CRUD patterns across different resources.
 * Provides factory functions for standard REST operations.
 */

import { fetchWithAuth } from './api.js';

/**
 * Standard CRUD operations factory
 * Creates get, create, update, delete functions for a resource
 *
 * @param {string} endpoint - Base API endpoint (e.g., '/keywords/categories')
 * @param {Object} options - Configuration options
 * @param {boolean} options.requiresTenantId - Whether operations require tenantId
 * @param {Function} options.serializeBody - Custom body serializer
 * @returns {Object} CRUD operation functions
 */
export function createCrudOps(endpoint, options = {}) {
  const { requiresTenantId = true, serializeBody } = options;

  const serialize = serializeBody || ((data) => JSON.stringify(data));

  return {
    /**
     * GET all or single resource
     */
    async list(tenantIdOrUrl, params = {}) {
      const url = typeof tenantIdOrUrl === 'string' && tenantIdOrUrl.startsWith('/')
        ? tenantIdOrUrl
        : endpoint;
      const tenantId = requiresTenantId && typeof tenantIdOrUrl === 'string'
        ? tenantIdOrUrl
        : tenantIdOrUrl?.tenantId;

      const queryStr = new URLSearchParams(params).toString();
      return fetchWithAuth(`${url}${queryStr ? '?' + queryStr : ''}`, { tenantId });
    },

    /**
     * GET single resource by ID
     */
    async get(idOrTenantId, resourceId, options = {}) {
      const tenantId = typeof idOrTenantId === 'string' && !resourceId ? null : idOrTenantId;
      const id = resourceId || idOrTenantId;
      return fetchWithAuth(`${endpoint}/${id}`, { tenantId, ...options });
    },

    /**
     * POST create new resource
     */
    async create(tenantId, data) {
      return fetchWithAuth(endpoint, {
        method: 'POST',
        tenantId,
        body: serialize(data),
      });
    },

    /**
     * PUT update entire resource
     */
    async update(tenantId, resourceId, data) {
      return fetchWithAuth(`${endpoint}/${resourceId}`, {
        method: 'PUT',
        tenantId,
        body: serialize(data),
      });
    },

    /**
     * PATCH partial update
     */
    async patch(tenantId, resourceId, data) {
      return fetchWithAuth(`${endpoint}/${resourceId}`, {
        method: 'PATCH',
        tenantId,
        body: serialize(data),
      });
    },

    /**
     * DELETE resource
     */
    async delete(tenantId, resourceId) {
      return fetchWithAuth(`${endpoint}/${resourceId}`, {
        method: 'DELETE',
        tenantId,
      });
    },
  };
}

/**
 * Simpler factory for admin endpoints that may not have uniform structure
 * Useful when you just need a few common operations
 */
export function createSimpleCrud(basePath, tenantRequired = true) {
  return createCrudOps(basePath, { requiresTenantId: tenantRequired });
}
