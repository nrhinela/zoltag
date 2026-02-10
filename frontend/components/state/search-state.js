import { BaseStateController } from './base-state-controller.js';
import { getDropboxFolders } from '../../services/api.js';

/**
 * Search State Controller
 *
 * Manages search-tab list naming/filter sorting state and Dropbox folder lookup.
 */
export class SearchStateController extends BaseStateController {
  constructor(host) {
    super(host);
  }

  getDefaultNewListTitle() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    return `${date}:${time} new list`;
  }

  isDuplicateListTitle(title, excludeId = null) {
    const normalized = (title || '').trim().toLowerCase();
    if (!normalized) return false;
    return (this.host.searchLists || []).some((list) => {
      if (excludeId && list.id === excludeId) return false;
      return (list.title || '').trim().toLowerCase() === normalized;
    });
  }

  getUniqueNewListTitle() {
    const base = this.getDefaultNewListTitle();
    if (!this.isDuplicateListTitle(base)) {
      return base;
    }
    let suffix = 2;
    let candidate = `${base} (${suffix})`;
    while (this.isDuplicateListTitle(candidate)) {
      suffix += 1;
      candidate = `${base} (${suffix})`;
    }
    return candidate;
  }

  resetSearchListDraft() {
    this.host.searchListId = null;
    this.host.searchListTitle = this.getUniqueNewListTitle();
    this.host.searchSavedItems = [];
    this.host.searchListPromptNewTitle = false;
  }

  resetForTenantChange() {
    this.resetSearchListDraft();
    this.host.searchImages = [];
    this.host.searchTotal = 0;
    this.host.searchDropboxPathPrefix = '';
    this.host.searchDropboxQuery = '';
    this.host.searchDropboxOptions = [];
    this.host.searchDropboxOpen = false;
  }

  async fetchDropboxFolders(query) {
    if (!this.host.tenant) return;
    this.host.searchDropboxLoading = true;
    try {
      const response = await getDropboxFolders(this.host.tenant, { query });
      this.host.searchDropboxOptions = response.folders || [];
    } catch (error) {
      console.error('Failed to fetch Dropbox folders:', error);
      this.host.searchDropboxOptions = [];
    } finally {
      this.host.searchDropboxLoading = false;
    }
  }

  handleSortChanged(detail) {
    this.host.searchOrderBy = detail.orderBy;
    this.host.searchOrderDirection = detail.dateOrder;
    const panel = this.host.searchFilterPanel;
    if (!panel) return;
    const filters = panel.getState();
    panel.updateFilters({
      ...filters,
      orderBy: this.host.searchOrderBy,
      sortOrder: this.host.searchOrderDirection,
      offset: 0,
    });
    panel.fetchImages();
  }

  initializeSearchTab() {
    const panelState = this.host.searchFilterPanel?.getState?.() || this.host.searchFilterPanel?.filters || {};
    if (panelState.orderBy) {
      this.host.searchOrderBy = panelState.orderBy;
    }
    if (panelState.sortOrder) {
      this.host.searchOrderDirection = panelState.sortOrder;
    }

    this.host.fetchKeywords();
    this.host.fetchStats({
      includeRatings: false,
      includeMlStats: false,
      includeTagStats: false,
    });

    if (!this.host.searchImages?.length) {
      const searchFilters = this.host.searchFilterPanel.getState();
      this.host.searchFilterPanel.updateFilters(searchFilters);
      this.host.searchFilterPanel.fetchImages();
    }
  }
}
