import { getDropboxFolders, getImages } from '../services/api.js';

export class FolderBrowserPanel {
  constructor(panelId = '') {
    this.panelId = panelId;
    this.tenant = null;
    this.folders = [];
    this.selection = [];
    this.data = {};
    this.loadingFolders = false;
    this.loadingData = false;
    this._foldersRequestId = 0;
    this._dataRequestId = 0;
    this._dataSignature = null;
    this._listeners = {
      'folders-loading': [],
      'folders-loaded': [],
      'data-loading': [],
      'data-loaded': [],
      'selection-changed': [],
      'error': [],
    };
  }

  setTenant(tenant) {
    this.tenant = tenant;
  }

  on(eventName, callback) {
    if (this._listeners[eventName]) {
      this._listeners[eventName].push(callback);
    }
  }

  off(eventName, callback) {
    if (this._listeners[eventName]) {
      this._listeners[eventName] = this._listeners[eventName].filter(
        (cb) => cb !== callback
      );
    }
  }

  _emit(eventName, detail) {
    if (this._listeners[eventName]) {
      this._listeners[eventName].forEach((callback) => {
        try {
          callback(detail);
        } catch (error) {
          console.error(`Error in ${eventName} listener for ${this.panelId}:`, error);
        }
      });
    }
  }

  async loadFolders({ query = '', limit, force = false } = {}) {
    if (!this.tenant) {
      this._emit('error', { panelId: this.panelId, message: 'Tenant not set' });
      return;
    }
    const normalizedQuery = (query || '').trim();
    if (!force && !normalizedQuery && this.folders.length) {
      return;
    }
    const requestId = ++this._foldersRequestId;
    this.loadingFolders = true;
    this._emit('folders-loading', { panelId: this.panelId, loading: true });
    try {
      const response = await getDropboxFolders(this.tenant, { query: normalizedQuery, limit });
      if (requestId !== this._foldersRequestId) return;
      const folders = response?.folders || [];
      this.folders = folders;
      this._emit('folders-loaded', { panelId: this.panelId, folders });
    } catch (error) {
      if (requestId !== this._foldersRequestId) return;
      this._emit('error', { panelId: this.panelId, message: error.message || 'Failed to load folders' });
    } finally {
      if (requestId === this._foldersRequestId) {
        this.loadingFolders = false;
        this._emit('folders-loading', { panelId: this.panelId, loading: false });
      }
    }
  }

  setSelection(selection) {
    const unique = Array.from(new Set(selection || [])).filter(Boolean);
    unique.sort((a, b) => a.localeCompare(b));
    this.selection = unique;
    this._emit('selection-changed', { panelId: this.panelId, selection: unique });
  }

  toggleFolder(folder, checked) {
    const next = new Set(this.selection || []);
    if (checked) {
      next.add(folder);
    } else {
      next.delete(folder);
    }
    this.setSelection(Array.from(next));
  }

  async loadData({ orderBy = 'photo_creation', sortOrder = 'desc', limit = 0, force = false } = {}) {
    if (!this.tenant) {
      this._emit('error', { panelId: this.panelId, message: 'Tenant not set' });
      return;
    }
    const folders = Array.isArray(this.selection) ? this.selection.filter(Boolean) : [];
    if (!folders.length) {
      this.data = {};
      this._emit('data-loaded', { panelId: this.panelId, data: {} });
      return;
    }
    const signature = JSON.stringify({ folders, orderBy, sortOrder, limit });
    if (!force && signature === this._dataSignature) {
      return;
    }
    this._dataSignature = signature;
    const requestId = ++this._dataRequestId;
    this.loadingData = true;
    this._emit('data-loading', { panelId: this.panelId, loading: true });
    try {
      const results = await Promise.allSettled(
        folders.map(async (folder) => {
          const result = await getImages(this.tenant, {
            dropboxPathPrefix: folder,
            orderBy,
            sortOrder,
            limit,
          });
          const images = Array.isArray(result) ? result : (result.images || []);
          return { folder, images };
        })
      );
      if (requestId !== this._dataRequestId) return;
      const data = {};
      for (const entry of results) {
        if (entry.status === 'fulfilled') {
          data[entry.value.folder] = entry.value.images || [];
        }
      }
      this.data = data;
      this._emit('data-loaded', { panelId: this.panelId, data });
    } catch (error) {
      if (requestId !== this._dataRequestId) return;
      this._emit('error', { panelId: this.panelId, message: error.message || 'Failed to load folder images' });
    } finally {
      if (requestId === this._dataRequestId) {
        this.loadingData = false;
        this._emit('data-loading', { panelId: this.panelId, loading: false });
      }
    }
  }
}

export default FolderBrowserPanel;
