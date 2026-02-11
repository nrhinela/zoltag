import { BaseStateController } from './base-state-controller.js';
import { getCurrentUser } from '../../services/auth.js';
import { getImageStats } from '../../services/api.js';
import { shouldAutoRefreshCurateStats } from '../shared/curate-stats.js';

/**
 * App Shell State Controller
 *
 * Manages top-level app lifecycle concerns:
 * - User/tenant role resolution
 * - Active tab permissions/routing
 * - Per-tab bootstrap/loading
 * - Tenant switch reset flow
 */
export class AppShellStateController extends BaseStateController {
  constructor(host) {
    super(host);
  }

  async loadCurrentUser() {
    try {
      this.host.currentUser = await getCurrentUser();
    } catch (error) {
      console.error('Error fetching current user:', error);
      this.host.currentUser = null;
    }
  }

  getTenantRole() {
    const tenantId = this.host.tenant;
    if (!tenantId) return null;
    const memberships = this.host.currentUser?.tenants || [];
    const match = memberships.find(
      (membership) => String(membership.tenant_id) === String(tenantId)
    );
    return match?.role || null;
  }

  canCurate() {
    const role = this.getTenantRole();
    if (!role) {
      return true;
    }
    return role !== 'user';
  }

  setActiveTab(tabName) {
    // Normalize legacy deep-links now nested under Library.
    if (tabName === 'admin') {
      this.host.activeLibrarySubTab = 'keywords';
      this.host.activeTab = 'library';
      return;
    }
    if (tabName === 'ml-training') {
      this.host.activeTab = 'cli';
      return;
    }
    if (tabName === 'system') {
      this.host.activeTab = 'cli';
      return;
    }
    if (tabName === 'queue') {
      this.host.activeTab = 'home';
      return;
    }
    if (tabName === 'library' && !this.host.activeLibrarySubTab) {
      this.host.activeLibrarySubTab = 'assets';
    }
    if (tabName === 'curate' && !this.canCurate()) {
      this.host.activeTab = 'home';
      return;
    }
    if (tabName === 'curate' && this.host.curateSubTab === 'lists') {
      this.host.curateSubTab = 'main';
    }
    this.host.activeTab = tabName;
  }

  handleTabChange(event) {
    this.setActiveTab(event.detail);
  }

  handleHomeNavigate(event) {
    const tab = event?.detail?.tab;
    const subTab = event?.detail?.subTab;
    if (tab === 'library' && subTab) {
      this.host.activeLibrarySubTab = subTab;
    }
    if (tab === 'curate' && subTab) {
      this.host.curateSubTab = subTab;
    }
    this.setActiveTab(tab);
  }

  getTabBootstrapKey(tab) {
    const tenantKey = this.host.tenant || 'no-tenant';
    return `${tab}:${tenantKey}`;
  }

  async fetchHomeStats({ force = false } = {}) {
    const tenantAtRequest = this.host.tenant;
    if (!tenantAtRequest) return;

    const requestId = (this.host._homeStatsRequestId || 0) + 1;
    this.host._homeStatsRequestId = requestId;
    this.host._homeLoadingCount = (this.host._homeLoadingCount || 0) + 1;
    this.host.homeLoading = true;

    try {
      const results = await Promise.allSettled([
        getImageStats(tenantAtRequest, { force, includeRatings: false }),
      ]);

      const isStale =
        this.host._homeStatsRequestId !== requestId || this.host.tenant !== tenantAtRequest;
      if (isStale) {
        return;
      }

      const imageResult = results[0];
      if (imageResult.status === 'fulfilled') {
        this.host.imageStats = imageResult.value;
      } else {
        console.error('Error fetching image stats:', imageResult.reason);
        this.host.imageStats = null;
      }
    } finally {
      this.host._homeLoadingCount = Math.max(0, (this.host._homeLoadingCount || 1) - 1);
      this.host.homeLoading = this.host._homeLoadingCount > 0;
    }
  }

  initializeTab(tab, { force = false } = {}) {
    if (!tab) return;
    if (!this.host._tabBootstrapped) {
      this.host._tabBootstrapped = new Set();
    }
    const key = this.getTabBootstrapKey(tab);
    if (!force && this.host._tabBootstrapped.has(key)) {
      return;
    }

    if (tab === 'home') {
      if (this.host.homeSubTab === 'lab' || this.host.homeSubTab === 'chips') {
        this.host.homeSubTab = 'overview';
      }
      this.fetchHomeStats({ force });
      this.host.fetchKeywords();
      this.host._tabBootstrapped.add(key);
      return;
    }

    if (!this.host.tenant) {
      return;
    }

    switch (tab) {
      case 'search': {
        this.host._searchState.initializeSearchTab();
        break;
      }
      case 'curate': {
        this.host._curateExploreState.initializeCurateTab();
        break;
      }
      case 'library':
      case 'admin':
      case 'people':
      case 'tagging':
      default:
        break;
    }

    this.host._tabBootstrapped.add(key);
  }

  handleTenantChange(event) {
    const nextTenant = (typeof event?.detail === 'string' ? event.detail : '').trim();
    if (!nextTenant || nextTenant === this.host.tenant) {
      return;
    }

    this.host.tenant = nextTenant;
    try {
      localStorage.setItem('tenantId', nextTenant);
      localStorage.setItem('currentTenant', nextTenant);
    } catch (error) {
      console.error('Failed to persist tenant selection:', error);
    }

    this.host.searchFilterPanel.setTenant(this.host.tenant);
    this.host.curateHomeFilterPanel.setTenant(this.host.tenant);
    this.host.curateAuditFilterPanel.setTenant(this.host.tenant);

    this.host._curateHomeState.resetForTenantChange();
    this.host.curateSubTab = 'main';
    this.host._curateAuditState.resetForTenantChange();
    this.host._curateAuditLastFetchKey = null;
    this.host._curateHomeLastFetchKey = null;
    this.host._curateStatsAutoRefreshDone = false;
    this.host._searchState.resetForTenantChange();
    this.host.homeLoading = true;
    this.host.curateStatsLoading = false;
    this.host.imageStats = null;
    this.host.mlTrainingStats = null;
    this.host.tagStatsBySource = {};

    // Tenant switch always returns to Home and forces a fresh data pull.
    this.host.activeTab = 'home';
    this.host.homeSubTab = 'overview';
    this.host._tabBootstrapped = new Set();
    this.initializeTab('home', { force: true });
  }

  handleUpdated(changedProperties) {
    if (this.host.activeTab === 'curate' && this.host.curateSubTab === 'home') {
      if (shouldAutoRefreshCurateStats(this.host)) {
        this.host._curateStatsAutoRefreshDone = true;
        this.host._refreshCurateHome();
      }
    }
    if (changedProperties.has('activeTab')) {
      this.initializeTab(this.host.activeTab);
    }
    if ((changedProperties.has('currentUser') || changedProperties.has('tenant'))
      && this.host.activeTab === 'curate'
      && !this.canCurate()) {
      this.host.activeTab = 'home';
    }
    if (changedProperties.has('homeSubTab') && this.host.activeTab === 'home') {
      if (this.host.homeSubTab === 'lab' || this.host.homeSubTab === 'chips') {
        this.host.homeSubTab = 'overview';
      }
    }
  }
}
