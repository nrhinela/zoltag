import { LitElement, html, css } from 'lit';
import './app-header.js';
import './image-gallery.js';
import './filter-controls.js';
import './image-modal.js';
import './upload-modal.js';
import './tab-container.js'; // Import the new tab container
import './list-editor.js'; // Import the new list editor
import './permatag-editor.js';
import './tagging-admin.js';
import './ml-training.js';

import { tailwind } from './tailwind-lit.js';
import { getLists, getActiveList, getListItems, updateList, getKeywords, getImageStats, getMlTrainingStats, getTagStats } from '../services/api.js';
import { subscribeQueue, retryFailedCommand } from '../services/command-queue.js';

class PhotoCatApp extends LitElement {
  static styles = [tailwind, css`
    :host {
      display: block;
    }
    .container {
        max-width: 1280px;
        margin: 0 auto;
        padding: 16px;
    }
    .home-top-row {
        display: grid;
        grid-template-columns: 1fr;
        gap: 16px;
        margin-bottom: 16px;
        align-items: stretch;
    }
    @media (min-width: 1024px) {
        .home-top-row {
            grid-template-columns: 1fr 1fr;
            align-items: stretch;
        }
    }
    .home-panel {
        height: 100%;
        display: flex;
        flex-direction: column;
        min-height: 0;
    }
    .home-panel-right {
        overflow: hidden;
    }
    .tag-carousel {
        display: flex;
        gap: 12px;
        overflow-x: auto;
        overflow-y: auto;
        padding-bottom: 4px;
        -webkit-overflow-scrolling: touch;
        flex: 1;
        align-items: stretch;
        min-height: 0;
    }
    .tag-card {
        min-width: 180px;
        height: 100%;
        display: flex;
        flex-direction: column;
    }
    .tag-card-body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
    }
    .tag-bar {
        height: 6px;
        border-radius: 9999px;
        background: #e5e7eb;
        overflow: hidden;
    }
    .tag-bar-fill {
        height: 100%;
        background: #2563eb;
    }
  `];

  static properties = {
      filters: { type: Object },
      tenant: { type: String },
      selectedImage: { type: Object },
      showUploadModal: { type: Boolean },
      activeTab: { type: String }, // New property for active tab
      lists: { type: Array },
      activeListId: { type: String },
      activeListName: { type: String },
      activeListItemIds: { type: Object },
      keywords: { type: Array },
      queueState: { type: Object },
      showQueuePanel: { type: Boolean },
      displayMode: { type: String },
      imageStats: { type: Object },
      mlTrainingStats: { type: Object },
      tagStatsBySource: { type: Object },
      activeTagSource: { type: String },
  }

  constructor() {
      super();
      this.filters = {};
      this.tenant = 'bcg'; // Default tenant
      this.selectedImage = null;
      this.showUploadModal = false;
      this.activeTab = 'search'; // Default to search tab
      this.lists = [];
      this.activeListId = '';
      this.activeListName = '';
      this.activeListItemIds = new Set();
      this.keywords = [];
      this.queueState = { queuedCount: 0, inProgressCount: 0, failedCount: 0 };
      this._unsubscribeQueue = null;
      this.showQueuePanel = false;
      this.displayMode = 'grid';
      this.imageStats = null;
      this.mlTrainingStats = null;
      this.tagStatsBySource = {};
      this.activeTagSource = 'zero_shot';
      this._queueRefreshTimer = null;
      this._statsRefreshTimer = null;
      this._homePanelObserver = null;
      this._homePanelLeftEl = null;
      this._homePanelRightEl = null;
      this._handleWindowResize = () => {
        this._syncHomePanelHeights();
      };
      this._handleQueueCommandComplete = (event) => {
        const detail = event?.detail;
        if (!detail) return;
        if (
          detail.type === 'retag' ||
          detail.type === 'add-positive-permatag' ||
          detail.type === 'add-negative-permatag'
        ) {
          this._scheduleGalleryRefresh();
          this._scheduleStatsRefresh();
        }
      };
      this._handleQueueToggle = () => {
        this.showQueuePanel = !this.showQueuePanel;
      };
  }

  connectedCallback() {
      super.connectedCallback();
      this.fetchLists();
      this.fetchKeywords();
      this.fetchStats();
      this._unsubscribeQueue = subscribeQueue((state) => {
        this.queueState = state;
      });
      window.addEventListener('queue-command-complete', this._handleQueueCommandComplete);
      window.addEventListener('resize', this._handleWindowResize);
  }

  disconnectedCallback() {
      if (this._unsubscribeQueue) {
        this._unsubscribeQueue();
      }
      window.removeEventListener('queue-command-complete', this._handleQueueCommandComplete);
      window.removeEventListener('resize', this._handleWindowResize);
      if (this._statsRefreshTimer) {
        clearTimeout(this._statsRefreshTimer);
        this._statsRefreshTimer = null;
      }
      if (this._homePanelObserver) {
        this._homePanelObserver.disconnect();
        this._homePanelObserver = null;
      }
      super.disconnectedCallback();
  }

  _handleFilterChange(e) {
      this.filters = e.detail;
  }

  _handleTenantChange(e) {
      this.tenant = e.detail;
      this.fetchLists();
      this.fetchKeywords();
      this.fetchStats();
  }

  _handleImageSelected(e) {
      console.log('Image selected:', e.detail);
      this.selectedImage = e.detail;
  }

  _handleCloseModal() {
      this.selectedImage = null;
  }

  _handleOpenUploadModal() {
      this.showUploadModal = true;
  }

    _handleCloseUploadModal() {
        this.showUploadModal = false;
    }
    
    _handleUploadComplete() {
        this.shadowRoot.querySelector('tab-container').querySelector('image-gallery').fetchImages();
        this.fetchStats();
        this.showUploadModal = false;
    }

  render() {
    const fallbackActive = this.lists.find((list) => list.is_active);
    const activeId = this.activeListId || (fallbackActive ? String(fallbackActive.id) : '');
    const activeName = this.activeListName || (fallbackActive ? fallbackActive.title : 'None');
    const imageCount = this._formatStatNumber(this.imageStats?.image_count);
    const reviewedCount = this._formatStatNumber(this.imageStats?.reviewed_image_count);
    const mlTagCount = this._formatStatNumber(this.imageStats?.ml_tag_count);
    const trainedTagCount = this._formatStatNumber(this.mlTrainingStats?.trained_image_count);
    const sourceStats = this.tagStatsBySource?.[this.activeTagSource] || {};
    const categoryCards = Object.entries(sourceStats)
      .map(([category, keywords]) => {
        const keywordRows = (keywords || [])
          .filter((kw) => (kw.count || 0) > 0)
          .sort((a, b) => (b.count || 0) - (a.count || 0));
        if (!keywordRows.length) {
          return null;
        }
        const maxCount = keywordRows.reduce((max, kw) => Math.max(max, kw.count || 0), 0);
        const totalCount = keywordRows.reduce((sum, kw) => sum + (kw.count || 0), 0);
        return { category, keywordRows, maxCount, totalCount };
      })
      .filter(Boolean)
      .sort((a, b) => b.totalCount - a.totalCount);
    return html`
        <app-header
            .tenant=${this.tenant}
            @tenant-change=${this._handleTenantChange}
            @open-upload-modal=${this._handleOpenUploadModal}
            .activeTab=${this.activeTab}
            @tab-change=${(e) => this.activeTab = e.detail}
            @sync-progress=${this._handleSyncProgress}
            @sync-complete=${this._handleSyncComplete}
            @sync-error=${this._handleSyncError}
        ></app-header>
        
        <tab-container .activeTab=${this.activeTab}>
            <div slot="search" class="container">
                <div class="flex flex-wrap gap-4 mb-4">
                    <div class="flex-1 min-w-[200px] border border-gray-200 rounded-lg p-3 bg-white shadow">
                        <div class="text-xs text-gray-500 uppercase">Images</div>
                        <div class="text-2xl font-semibold text-gray-900">${imageCount}</div>
                    </div>
                    <div class="flex-1 min-w-[200px] border border-gray-200 rounded-lg p-3 bg-white shadow">
                        <div class="text-xs text-gray-500 uppercase">Reviewed</div>
                        <div class="text-2xl font-semibold text-gray-900">${reviewedCount}</div>
                    </div>
                    <div class="flex-1 min-w-[200px] border border-gray-200 rounded-lg p-3 bg-white shadow">
                        <div class="text-xs text-gray-500 uppercase">Zero-Shot</div>
                        <div class="text-2xl font-semibold text-gray-900">${mlTagCount}</div>
                    </div>
                    <div class="flex-1 min-w-[200px] border border-gray-200 rounded-lg p-3 bg-white shadow">
                        <div class="text-xs text-gray-500 uppercase">Keyword-Model</div>
                        <div class="text-2xl font-semibold text-gray-900">${trainedTagCount}</div>
                    </div>
                </div>
                <div class="home-top-row">
                    <div class="home-panel home-panel-left border border-gray-200 rounded-lg p-3 bg-white shadow">
                        <div class="text-xs text-gray-500 uppercase font-semibold mb-2">Search</div>
                        <filter-controls
                          .tenant=${this.tenant}
                          .lists=${this.lists}
                          @filter-change=${this._handleFilterChange}
                        ></filter-controls>
                    </div>
                    <div class="home-panel home-panel-right border border-gray-200 rounded-lg p-3 bg-white shadow">
                        <div class="text-xs text-gray-500 uppercase font-semibold mb-2">Tag Counts</div>
                        <div class="flex items-center gap-2 mb-3 text-xs font-semibold text-gray-600">
                          ${[
                            { key: 'permatags', label: 'Permatags' },
                            { key: 'keyword_model', label: 'Keyword-Model' },
                            { key: 'zero_shot', label: 'Zero-Shot' },
                          ].map((tab) => html`
                            <button
                              class="px-2 py-1 rounded border ${this.activeTagSource === tab.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}"
                              @click=${() => this.activeTagSource = tab.key}
                            >
                              ${tab.label}
                            </button>
                          `)}
                        </div>
                        ${categoryCards.length ? html`
                          <div class="tag-carousel">
                            ${categoryCards.map((item) => {
                              const label = item.category.replace(/_/g, ' ');
                              return html`
                                <div class="tag-card border border-gray-200 rounded-lg p-2">
                                  <div class="text-xs font-semibold text-gray-700 truncate" title=${label}>${label}</div>
                                  <div class="tag-card-body mt-2 space-y-2">
                                    ${item.keywordRows.map((kw) => {
                                      const width = item.maxCount
                                        ? Math.round((kw.count / item.maxCount) * 100)
                                        : 0;
                                      return html`
                                        <div>
                                          <div class="flex items-center justify-between gap-2 text-xs text-gray-600">
                                            <span class="truncate" title=${kw.keyword}>${kw.keyword}</span>
                                            <span class="text-gray-500">${this._formatStatNumber(kw.count)}</span>
                                          </div>
                                          <div class="tag-bar mt-1">
                                            <div class="tag-bar-fill" style="width: ${width}%"></div>
                                          </div>
                                        </div>
                                      `;
                                    })}
                                  </div>
                                </div>
                              `;
                            })}
                          </div>
                        ` : html`
                          <div class="text-xs text-gray-400">No tag data yet.</div>
                        `}
                    </div>
                </div>
                <div class="flex items-center gap-3 mb-4">
                    <div class="text-sm text-gray-700 font-semibold">
                        Active List: ${activeName}
                    </div>
                    <div class="ml-4">
                        <select class="px-3 py-2 border rounded-lg" .value=${activeId} @change=${this._handleActiveListChange}>
                        <option value="">None</option>
                        ${this.lists.map((list) => html`
                            <option value=${String(list.id)} ?selected=${String(list.id) === activeId}>${list.title}</option>
                        `)}
                        </select>
                    </div>
                    <div class="ml-4 flex items-center gap-2 text-xs text-gray-600">
                        <span>Display:</span>
                        <button
                          class="px-2 py-1 border rounded ${this.displayMode === 'grid' ? 'bg-gray-200' : 'bg-white'}"
                          @click=${() => this.displayMode = 'grid'}
                          title="Grid view"
                        >
                          ⬛
                        </button>
                        <button
                          class="px-2 py-1 border rounded ${this.displayMode === 'list' ? 'bg-gray-200' : 'bg-white'}"
                          @click=${() => this.displayMode = 'list'}
                          title="List view"
                        >
                          ☰
                        </button>
                    </div>
                    <div class="ml-auto text-xs text-gray-500">
                        <button
                          class="text-xs text-blue-600 hover:text-blue-700"
                          @click=${this._handleQueueToggle}
                        >
                          Queue: ${this.queueState.inProgressCount} active · ${this.queueState.queuedCount} queued · ${this.queueState.failedCount} failed
                        </button>
                    </div>
                </div>
                ${this.showQueuePanel ? html`
                  <div class="mb-4 border border-gray-200 rounded-lg p-3 bg-white text-xs text-gray-600 space-y-2">
                    <div class="font-semibold text-gray-700">Work Queue</div>
                    ${this.queueState.inProgress?.length ? html`
                      <div>
                        <div class="font-semibold text-gray-600 mb-1">In Progress</div>
                        ${this.queueState.inProgress.map((item) => html`
                          <div>${item.type} · image ${item.imageId}</div>
                        `)}
                      </div>
                    ` : html``}
                    ${this.queueState.queue?.length ? html`
                      <div>
                        <div class="font-semibold text-gray-600 mb-1">Queued</div>
                        ${this.queueState.queue.map((item) => html`
                          <div>${item.type} · image ${item.imageId}</div>
                        `)}
                      </div>
                    ` : html``}
                    ${this.queueState.failed?.length ? html`
                      <div>
                        <div class="font-semibold text-red-600 mb-1">Failed</div>
                        ${this.queueState.failed.map((item) => html`
                          <div class="flex items-center justify-between">
                            <span>${item.type} · image ${item.imageId}</span>
                            <button
                              class="text-xs text-blue-600 hover:text-blue-700"
                              @click=${() => retryFailedCommand(item.id)}
                            >
                              Retry
                            </button>
                          </div>
                        `)}
                      </div>
                    ` : html`<div class="text-gray-400">No failed commands.</div>`}
                  </div>
                ` : ''}
                <image-gallery
                    .tenant=${this.tenant}
                    .filters=${this.filters}
                    .activeListName=${this.activeListName}
                    .activeListItemIds=${this.activeListItemIds}
                    .keywords=${this.keywords}
                    .displayMode=${this.displayMode}
                    @image-selected=${this._handleImageSelected}
                    @list-item-added=${this._handleListItemAdded}
                    @image-retagged=${this._handleImageRetagged}
                    @image-rating-updated=${this._handleImageRatingUpdated}
                ></image-gallery>
            </div>
            <div slot="lists" class="container p-4">
                <list-editor .tenant=${this.tenant} @lists-updated=${this._handleListsUpdated}></list-editor>
            </div>
            <div slot="tagging" class="container p-4">
                <tagging-admin .tenant=${this.tenant} @open-upload-modal=${this._handleOpenUploadModal}></tagging-admin>
            </div>
            <div slot="ml-training" class="container p-4">
                <ml-training .tenant=${this.tenant}></ml-training>
            </div>
        </tab-container>

        ${this.selectedImage ? html`
          <image-modal
            .image=${this.selectedImage}
            .tenant=${this.tenant}
            .active=${true}
            @close=${this._handleCloseModal}
            @image-retagged=${this._handleImageRetagged}
          ></image-modal>
        ` : ''}
        ${this.showUploadModal ? html`<upload-modal .tenant=${this.tenant} @close=${this._handleCloseUploadModal} @upload-complete=${this._handleUploadComplete} active></upload-modal>` : ''}
    `;
  }

  async fetchLists() {
      if (!this.tenant) return;
      try {
          const results = await Promise.allSettled([
              getLists(this.tenant),
              getActiveList(this.tenant),
          ]);
          const listsResult = results[0];
          const activeResult = results[1];
          if (listsResult.status === 'fulfilled') {
              this.lists = listsResult.value;
          } else {
              console.error('Error fetching lists:', listsResult.reason);
              this.lists = [];
          }
          if (activeResult.status === 'fulfilled') {
              this.activeListId = activeResult.value?.id ? String(activeResult.value.id) : '';
          } else {
              console.error('Error fetching active list:', activeResult.reason);
              this.activeListId = '';
          }
          if (!this.activeListId && this.lists.length > 0) {
              const activeList = this.lists.find((list) => list.is_active);
              this.activeListId = activeList ? String(activeList.id) : '';
          }
          const activeList = this.lists.find((list) => String(list.id) === this.activeListId);
          this.activeListName = activeList ? activeList.title : '';
          await this.fetchActiveListItems();
      } catch (error) {
          console.error('Error fetching lists:', error);
      }
  }

  async fetchKeywords() {
      if (!this.tenant) return;
      try {
          const keywordsByCategory = await getKeywords(this.tenant);
          const flat = [];
          Object.entries(keywordsByCategory || {}).forEach(([category, list]) => {
              list.forEach((kw) => {
                  flat.push({ keyword: kw.keyword, category });
              });
          });
          this.keywords = flat.sort((a, b) => a.keyword.localeCompare(b.keyword));
      } catch (error) {
          console.error('Error fetching keywords:', error);
          this.keywords = [];
      }
  }

  async fetchActiveListItems() {
      if (!this.activeListId) {
          this.activeListItemIds = new Set();
          return;
      }
      try {
          const items = await getListItems(this.tenant, this.activeListId);
          this.activeListItemIds = new Set(items.map((item) => item.photo_id));
      } catch (error) {
          console.error('Error fetching active list items:', error);
          this.activeListItemIds = new Set();
      }
  }

  async fetchStats() {
      if (!this.tenant) return;
      const results = await Promise.allSettled([
          getImageStats(this.tenant),
          getMlTrainingStats(this.tenant),
          getTagStats(this.tenant),
      ]);
      const imageResult = results[0];
      const mlResult = results[1];
      const tagResult = results[2];
      if (imageResult.status === 'fulfilled') {
          this.imageStats = imageResult.value;
      } else {
          console.error('Error fetching image stats:', imageResult.reason);
          this.imageStats = null;
      }
      if (mlResult.status === 'fulfilled') {
          this.mlTrainingStats = mlResult.value;
      } else {
          console.error('Error fetching ML training stats:', mlResult.reason);
          this.mlTrainingStats = null;
      }
      if (tagResult.status === 'fulfilled') {
          this.tagStatsBySource = tagResult.value?.sources || {};
      } else {
          console.error('Error fetching tag stats:', tagResult.reason);
          this.tagStatsBySource = {};
      }
  }

  async _handleActiveListChange(e) {
      const selectedId = e.target.value;
      const previousActiveId = this.activeListId;
      this.activeListId = selectedId;
      const selectedList = this.lists.find((list) => String(list.id) === selectedId);
      this.activeListName = selectedList ? selectedList.title : '';
      this.activeListItemIds = new Set();
      try {
          if (!selectedId && previousActiveId) {
              await updateList(this.tenant, { id: previousActiveId, is_active: false });
          } else if (selectedId) {
              await updateList(this.tenant, { id: selectedId, is_active: true });
          }
          await this.fetchLists();
      } catch (error) {
          console.error('Error updating active list:', error);
      }
  }

  async _handleListItemAdded() {
      await this.fetchActiveListItems();
  }

  async _handleListsUpdated() {
      await this.fetchLists();
  }

  async _handleImageRetagged() {
      const gallery = this.shadowRoot.querySelector('image-gallery');
      if (gallery && typeof gallery.fetchImages === 'function') {
          await gallery.fetchImages();
      }
  }

  async _handleImageRatingUpdated(e) {
      const gallery = this.shadowRoot.querySelector('image-gallery');
      if (gallery && typeof gallery.applyRatingUpdate === 'function') {
          const hideZero = Boolean(this.filters?.hideZeroRating);
          gallery.applyRatingUpdate(e.detail.imageId, e.detail.rating, hideZero);
          return;
      }
      if (gallery && typeof gallery.fetchImages === 'function') {
          await gallery.fetchImages();
      }
  }

  _handleSyncProgress(e) {
      console.log(`Sync progress: ${e.detail.count} images processed`);
      // Refresh gallery on each sync progress to show new images
      this._refreshGallery();
  }

  _handleSyncComplete(e) {
      console.log(`Sync complete: ${e.detail.count} total images processed`);
      this._refreshGallery();
      this.fetchStats();
  }

  _handleSyncError(e) {
      console.error('Sync error:', e.detail.error);
      // Could show a toast/notification here
  }

  _refreshGallery() {
      const tabContainer = this.shadowRoot.querySelector('tab-container');
      if (tabContainer) {
          const gallery = tabContainer.querySelector('image-gallery');
          if (gallery && typeof gallery.fetchImages === 'function') {
              gallery.fetchImages();
          }
      }
  }

  _scheduleGalleryRefresh() {
      if (this._queueRefreshTimer) {
          clearTimeout(this._queueRefreshTimer);
      }
      this._queueRefreshTimer = setTimeout(() => {
          this._queueRefreshTimer = null;
          this._refreshGallery();
      }, 400);
  }

  _scheduleStatsRefresh() {
      if (this._statsRefreshTimer) {
          clearTimeout(this._statsRefreshTimer);
      }
      this._statsRefreshTimer = setTimeout(() => {
          this._statsRefreshTimer = null;
          this.fetchStats();
      }, 400);
  }

  _formatStatNumber(value) {
      if (value === null || value === undefined) return '--';
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) return '--';
      return numericValue.toLocaleString();
  }

  firstUpdated() {
      this._ensureHomePanelSync();
  }

  updated() {
      this._ensureHomePanelSync();
  }

  _ensureHomePanelSync() {
      const leftPanel = this.shadowRoot?.querySelector('.home-panel-left');
      const rightPanel = this.shadowRoot?.querySelector('.home-panel-right');
      if (!leftPanel || !rightPanel) return;
      if (this._homePanelLeftEl !== leftPanel || this._homePanelRightEl !== rightPanel) {
          if (this._homePanelObserver) {
              this._homePanelObserver.disconnect();
          }
          this._homePanelLeftEl = leftPanel;
          this._homePanelRightEl = rightPanel;
          this._homePanelObserver = new ResizeObserver(() => {
              this._syncHomePanelHeights();
          });
          this._homePanelObserver.observe(leftPanel);
      }
      this._syncHomePanelHeights();
  }

  _syncHomePanelHeights() {
      if (!this._homePanelLeftEl || !this._homePanelRightEl) return;
      const isWide = window.matchMedia('(min-width: 1024px)').matches;
      if (!isWide) {
          this._homePanelRightEl.style.height = '';
          return;
      }
      const height = this._homePanelLeftEl.getBoundingClientRect().height;
      this._homePanelRightEl.style.height = height ? `${height}px` : '';
  }
}

customElements.define('photocat-app', PhotoCatApp);
