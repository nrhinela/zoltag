import { LitElement, html } from 'lit';
import './app-header.js';
import './tag-histogram.js';
import './upload-modal.js';
import './upload-library-modal.js';
import './tab-container.js';
import './list-editor.js';
import './permatag-editor.js';
import './tagging-admin.js';
import './assets-admin.js';
import './tenant-users-admin.js';
import './ml-training.js';
import './image-editor.js';
import './cli-commands.js';
import './person-manager.js';
import './people-tagger.js';
import './shared/widgets/filter-chips.js';
import './shared/widgets/keyword-dropdown.js';

import { initializeAppCoreSetup } from './state/app-core-setup.js';
import { initializeAppDefaultState } from './state/app-default-state.js';
import { initializeAppConstructorWiring } from './state/app-constructor-wiring.js';
import { bindAppDelegateMethods } from './state/app-delegate-methods.js';
import { tailwind } from './tailwind-lit.js';
import {
  formatCurateDate,
} from './shared/formatting.js';
import './home-tab.js';
import './home-chips-tab.js';
import './home-insights-tab.js';
import './lab-tab.js';
import './curate-home-tab.js';
import './curate-explore-tab.js';
import './curate-browse-folder-tab.js';
import './curate-audit-tab.js';
import './search-tab.js';
import { renderCurateTabContent } from './render/curate-tab-content.js';
import { renderHomeTabContent, renderSearchTabContent } from './render/home-search-tab-content.js';
import { renderAuxTabContent, renderGlobalOverlays, renderRatingModal } from './render/aux-tab-content.js';
import { photocatAppStyles } from './styles/photocat-app-styles.js';
import { propertyGridStyles } from './shared/widgets/property-grid.js';

class PhotoCatApp extends LitElement {
  static styles = [tailwind, photocatAppStyles, propertyGridStyles];

  static properties = {
      tenant: { type: String },
      showUploadModal: { type: Boolean },
      showUploadLibraryModal: { type: Boolean },
      activeTab: { type: String },
      activeLibrarySubTab: { type: String },
      activeAdminSubTab: { type: String },
      activeSystemSubTab: { type: String },
      keywords: { type: Array },
      queueState: { type: Object },
      queueNotice: { type: Object },
      imageStats: { type: Object },
      mlTrainingStats: { type: Object },
      tagStatsBySource: { type: Object },
      homeLoading: { type: Boolean },
      curateFilters: { type: Object },
      curateLimit: { type: Number },
      curateOrderBy: { type: String },
      curateOrderDirection: { type: String },
      curateHideDeleted: { type: Boolean },
      curateMinRating: { type: [Number, String] },
      curateKeywordFilters: { type: Object },
      curateKeywordOperators: { type: Object },
      curateCategoryFilterOperator: { type: String },
      curateDropboxPathPrefix: { type: String },
      curateFilenameQuery: { type: String },
      curateListId: { type: [Number, String] },
      curateListExcludeId: { type: [Number, String] },
      curateImages: { type: Array },
      curatePageOffset: { type: Number },
      curateTotal: { type: Number },
      curateLoading: { type: Boolean },
      curateDragSelection: { type: Array },
      curateDragSelecting: { type: Boolean },
      curateDragStartIndex: { type: Number },
      curateDragEndIndex: { type: Number },
      curateThumbSize: { type: Number },
      curateEditorImage: { type: Object },
      curateEditorOpen: { type: Boolean },
      curateEditorImageSet: { type: Array },
      curateEditorImageIndex: { type: Number },
      curateSubTab: { type: String, attribute: false },
      curateAuditMode: { type: String },
      curateAuditKeyword: { type: String },
      curateAuditCategory: { type: String },
      curateAuditImages: { type: Array },
      curateAuditSelection: { type: Array },
      curateAuditDragTarget: { type: String },
      curateAuditDragSelection: { type: Array },
      curateAuditDragSelecting: { type: Boolean },
      curateAuditDragStartIndex: { type: Number },
      curateAuditDragEndIndex: { type: Number },
      curateAuditLimit: { type: Number },
      curateAuditOffset: { type: Number },
      curateAuditTotal: { type: Number },
      curateAuditLoading: { type: Boolean },
      curateAuditLoadAll: { type: Boolean },
      curateAuditPageOffset: { type: Number },
      curateAuditAiEnabled: { type: Boolean },
      curateAuditAiModel: { type: String },
      curateAuditOrderBy: { type: String },
      curateAuditOrderDirection: { type: String },
      curateAuditHideDeleted: { type: Boolean },
      curateAuditMinRating: { type: [Number, String] },
      curateAuditNoPositivePermatags: { type: Boolean },
      curateAuditDropboxPathPrefix: { type: String },
      curateAuditFilenameQuery: { type: String },
      curateHomeRefreshing: { type: Boolean },
      curateStatsLoading: { type: Boolean },
      homeSubTab: { type: String },
      curateAdvancedOpen: { type: Boolean },
      curateNoPositivePermatags: { type: Boolean },
      activeCurateTagSource: { type: String },
      curateCategoryCards: { type: Array },
      curateAuditTargets: { type: Array },
      curateExploreTargets: { type: Array },
      curateExploreRatingEnabled: { type: Boolean },
      curateAuditRatingEnabled: { type: Boolean },
      searchOrderBy: { type: String },
      searchOrderDirection: { type: String },
      searchImages: { type: Array },
      searchTotal: { type: Number },
      currentUser: { type: Object },
      _homeLoadingCount: { type: Number },
      assetsRefreshToken: { type: Number },
  }

  constructor() {
      super();
      let storedTenant = '';
      try {
          storedTenant = (localStorage.getItem('tenantId') || localStorage.getItem('currentTenant') || '').trim();
      } catch (_error) {
          storedTenant = '';
      }
      this.tenant = storedTenant || '';
      this.showUploadModal = false;
      this.showUploadLibraryModal = false;
      this.activeTab = 'home';
      this.homeSubTab = 'overview';
      this.activeLibrarySubTab = 'assets';
      this.activeAdminSubTab = 'tagging';
      this.activeSystemSubTab = 'cli';
      this.assetsRefreshToken = 0;

      initializeAppCoreSetup(this);
      bindAppDelegateMethods(this);
      initializeAppDefaultState(this);
      initializeAppConstructorWiring(this);
  }

  connectedCallback() {
      super.connectedCallback();
      this._appEventsState.connect();
      this._syncTenantFromStorage();
  }

  disconnectedCallback() {
      this._appEventsState.disconnect();
      super.disconnectedCallback();
  }

  render() {
    const canCurate = this._canCurate();
    const navCards = [
      { key: 'search', label: 'Search', subtitle: 'Explore and save results', icon: 'fa-magnifying-glass' },
      { key: 'curate', label: 'Curate', subtitle: 'Build stories and sets', icon: 'fa-star' },
      { key: 'lists', label: 'Lists', subtitle: 'Organize saved sets', icon: 'fa-list' },
      { key: 'admin', label: 'Keywords', subtitle: 'Manage configuration', icon: 'fa-cog' },
      { key: 'system', label: 'System', subtitle: 'Manage pipelines and tasks', icon: 'fa-sliders' },
    ].filter((card) => canCurate || card.key !== 'curate');
    this._curateLeftOrder = this.curateImages.map((img) => img.id);
    this._curateRightOrder = [];

    return html`
        ${renderRatingModal(this)}
        <app-header
            .tenant=${this.tenant}
            @tenant-change=${this._handleTenantChange}
            @open-upload-modal=${this._handleOpenUploadModal}
            .activeTab=${this.activeTab}
            .canCurate=${canCurate}
            .queueCount=${(this.queueState?.queuedCount || 0) + (this.queueState?.inProgressCount || 0) + (this.queueState?.failedCount || 0)}
            @tab-change=${this._handleTabChange}
            @sync-progress=${this._handleSyncProgress}
            @sync-complete=${this._handleSyncComplete}
            @sync-error=${this._handleSyncError}
        ></app-header>
        
        <tab-container .activeTab=${this.activeTab}>
            ${this.activeTab === 'home' ? renderHomeTabContent(this, { navCards, formatCurateDate }) : ''}
            ${this.activeTab === 'search' ? renderSearchTabContent(this, { formatCurateDate }) : ''}
            ${this.activeTab === 'curate' ? renderCurateTabContent(this, { formatCurateDate }) : ''}
            ${renderAuxTabContent(this, { formatCurateDate })}
        </tab-container>
        ${renderGlobalOverlays(this, { canCurate })}
    `;
  }

  async fetchKeywords() {
      return await this._appDataState.fetchKeywords();
  }

  async fetchStats({ force = false, includeRatings, includeImageStats = true, includeMlStats = false, includeTagStats = true } = {}) {
      return await this._appDataState.fetchStats({
          force,
          includeRatings,
          includeImageStats,
          includeMlStats,
          includeTagStats,
      });
  }

  _handleImageRatingUpdated(e) {
      if (e?.detail?.imageId !== undefined && e?.detail?.rating !== undefined) {
          this._curateExploreState.applyCurateRating(e.detail.imageId, e.detail.rating);
      }
  }

  updated(changedProperties) {
      if (changedProperties.has('curateAuditKeyword') || changedProperties.has('curateAuditMode')) {
          this._syncAuditHotspotPrimary();
      }
      if (changedProperties.has('keywords') && this.curateAuditKeyword) {
          this._syncAuditHotspotPrimary();
      }
      this._appShellState.handleUpdated(changedProperties);
  }

  _syncTenantFromStorage() {
      let storedTenant = '';
      try {
          storedTenant = (localStorage.getItem('tenantId') || localStorage.getItem('currentTenant') || '').trim();
      } catch (_error) {
          storedTenant = '';
      }
      if (!storedTenant || storedTenant === this.tenant) {
          return;
      }
      this._handleTenantChange({ detail: storedTenant });
  }

}

customElements.define('photocat-app', PhotoCatApp);
