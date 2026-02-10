import { BaseStateController } from './base-state-controller.js';
import { getCurrentUser } from '../../services/auth.js';
import { getImageStats, getMlTrainingStats } from '../../services/api.js';
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
    if (tabName === 'curate' && !this.canCurate()) {
      this.host.activeTab = 'home';
      return;
    }
    this.host.activeTab = tabName;
  }

  handleTabChange(event) {
    this.setActiveTab(event.detail);
  }

  handleHomeNavigate(event) {
    this.setActiveTab(event.detail.tab);
  }

  getTabBootstrapKey(tab) {
    const tenantKey = this.host.tenant || 'no-tenant';
    return `${tab}:${tenantKey}`;
  }

  async fetchHomeStats({ force = false } = {}) {
    if (!this.host.tenant) return;
    const results = await Promise.allSettled([
      getImageStats(this.host.tenant, { force, includeRatings: false }),
      getMlTrainingStats(this.host.tenant, { force }),
    ]);
    const imageResult = results[0];
    const mlResult = results[1];
    if (imageResult.status === 'fulfilled') {
      this.host.imageStats = imageResult.value;
    } else {
      console.error('Error fetching image stats:', imageResult.reason);
      this.host.imageStats = null;
    }
    if (mlResult.status === 'fulfilled') {
      this.host.mlTrainingStats = mlResult.value;
    } else {
      console.error('Error fetching ML training stats:', mlResult.reason);
      this.host.mlTrainingStats = null;
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
      this.fetchHomeStats();
      if (this.host.homeSubTab === 'insights') {
        this.host.fetchKeywords();
      }
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
      case 'system': {
        this.host.fetchStats({ includeTagStats: false });
        break;
      }
      case 'admin':
      case 'people':
      case 'tagging':
      case 'lists':
      case 'queue':
      default:
        break;
    }

    this.host._tabBootstrapped.add(key);
  }

  handleTenantChange(event) {
    this.host.tenant = event.detail;

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
    this.host._tabBootstrapped = new Set();
    this.initializeTab(this.host.activeTab, { force: true });
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
        return;
      }
      if (this.host.homeSubTab === 'insights') {
        this.host.fetchKeywords();
      }
    }
  }
}
