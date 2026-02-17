import { BaseStateController } from './base-state-controller.js';
import { getCurrentUser } from '../../services/auth.js';
import { getImageStats } from '../../services/api.js';
import { shouldAutoRefreshCurateStats } from '../shared/curate-stats.js';
import {
  canCurateTenant,
  getTenantPermissions as getMembershipPermissions,
  getTenantRole as getMembershipRole,
  hasTenantPermission as hasMembershipPermission,
  normalizeTenantRef,
  resolveTenantMembership,
} from '../shared/tenant-permissions.js';

function normalizeTenantValue(value) {
  return normalizeTenantRef(value);
}

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
      const memberships = Array.isArray(this.host.currentUser?.tenants)
        ? this.host.currentUser.tenants
        : [];
      const fallbackSingleTenant = memberships.length === 1
        ? normalizeTenantValue(String(memberships[0]?.tenant_id ?? ''))
        : '';
      const canonicalTenant = this.resolveTenantRef(this.host.tenant) || fallbackSingleTenant;
      if (canonicalTenant && canonicalTenant !== this.host.tenant) {
        this.host.tenant = canonicalTenant;
        try {
          localStorage.setItem('tenantId', canonicalTenant);
          localStorage.setItem('currentTenant', canonicalTenant);
        } catch (_error) {
          // no-op; persistence failures should not block UI
        }
        this.host.searchFilterPanel.setTenant(this.host.tenant);
        this.host.curateHomeFilterPanel.setTenant(this.host.tenant);
        this.host.curateAuditFilterPanel.setTenant(this.host.tenant);
      }
    } catch (error) {
      console.error('Error fetching current user:', error);
      this.host.currentUser = null;
    }
  }

  resolveTenantRef(rawTenantRef) {
    const tenantRef = normalizeTenantValue(rawTenantRef);
    if (!tenantRef) return '';
    const membership = resolveTenantMembership(this.host.currentUser, tenantRef);
    return normalizeTenantValue(String(membership?.tenant_id || '')) || tenantRef;
  }

  getTenantRole() {
    return getMembershipRole(this.host.currentUser, this.host.tenant);
  }

  getTenantMembership() {
    return resolveTenantMembership(this.host.currentUser, this.host.tenant);
  }

  getTenantPermissions() {
    return getMembershipPermissions(this.host.currentUser, this.host.tenant);
  }

  hasTenantPermission(permissionKey) {
    return hasMembershipPermission(this.host.currentUser, this.host.tenant, permissionKey);
  }

  canCurate() {
    return canCurateTenant(this.host.currentUser, this.host.tenant);
  }

  setActiveTab(tabName) {
    if (!tabName || !['home', 'search', 'curate', 'library', 'lists'].includes(tabName)) {
      this.host.activeTab = 'home';
      return;
    }
    if (tabName === 'library' && !this.host.activeLibrarySubTab) {
      this.host.activeLibrarySubTab = 'assets';
    }
    if (tabName === 'search' && !this.host.activeSearchSubTab) {
      this.host.activeSearchSubTab = 'landing';
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
    const detail = event?.detail;
    if (detail && typeof detail === 'object') {
      const tab = detail.tab;
      const subTab = detail.subTab;
      const adminSubTab = detail.adminSubTab;
      if (tab === 'library' && subTab) {
        this.host.activeLibrarySubTab = subTab;
      }
      if (tab === 'search') {
        this.host.activeSearchSubTab = subTab || 'landing';
        this.host.pendingSearchExploreSelection = null;
        this.host.pendingVectorstoreQuery = null;
      }
      if (tab === 'library' && subTab === 'keywords' && adminSubTab) {
        this.host.activeAdminSubTab = adminSubTab;
      }
      this.setActiveTab(tab);
      return;
    }
    if (detail === 'search') {
      this.host.activeSearchSubTab = 'landing';
      this.host.pendingSearchExploreSelection = null;
      this.host.pendingVectorstoreQuery = null;
    }
    if (detail === 'lists') {
      this.host.pendingListSelectionId = null;
    }
    this.setActiveTab(detail);
  }

  handleHomeNavigate(event) {
    const tab = event?.detail?.tab;
    const subTab = event?.detail?.subTab;
    const adminSubTab = event?.detail?.adminSubTab;
    const exploreSelection = event?.detail?.exploreSelection || null;
    const vectorstoreQuery = typeof event?.detail?.vectorstoreQuery === 'string'
      ? event.detail.vectorstoreQuery.trim()
      : '';
    const listSelection = event?.detail?.listSelection || null;
    if (tab === 'library' && subTab) {
      this.host.activeLibrarySubTab = subTab;
    }
    if (tab === 'search') {
      this.host.activeSearchSubTab = subTab || 'landing';
    }
    if (tab === 'library' && subTab === 'keywords' && adminSubTab) {
      this.host.activeAdminSubTab = adminSubTab;
    }
    if (tab === 'curate' && subTab) {
      this.host.curateSubTab = subTab;
    }
    if (tab === 'search') {
      this.host.pendingSearchExploreSelection = exploreSelection;
      this.host.pendingVectorstoreQuery = vectorstoreQuery || null;
      if (vectorstoreQuery) {
        this.host.pendingVectorstoreQueryToken = (this.host.pendingVectorstoreQueryToken || 0) + 1;
      }
    }
    if (tab === 'lists') {
      const listId = listSelection?.listId ?? null;
      this.host.pendingListSelectionId = listId;
      this.host.pendingListSelectionToken = (this.host.pendingListSelectionToken || 0) + 1;
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
      this.host.fetchHomeLists({ force });
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
        break;
      default:
        break;
    }

    this.host._tabBootstrapped.add(key);
  }

  handleTenantChange(event) {
    const rawTenant = normalizeTenantValue(typeof event?.detail === 'string' ? event.detail : '');
    const nextTenant = this.resolveTenantRef(rawTenant);
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
    this.host.providerAdminTenant = null;
    this.host.providerAdminError = '';

    this.host._curateHomeState.resetForTenantChange();
    this.host.curateSubTab = 'main';
    this.host.curatePinnedImageId = null;
    this.host.curateSimilarityAssetUuid = null;
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
    this.host.homeLists = [];
    this.host.homeRecommendationsTab = 'lists';

    // Tenant switch always returns to Home and forces a fresh data pull.
    this.host.activeTab = 'home';
    this.host.homeSubTab = 'overview';
    this.host.activeSearchSubTab = 'landing';
    this.host.pendingSearchExploreSelection = null;
    this.host.pendingVectorstoreQuery = null;
    this.host.pendingVectorstoreQueryToken = 0;
    this.host.pendingListSelectionId = null;
    this.host.pendingListSelectionToken = 0;
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
      if (this.host._appBootstrapReady) {
        this.initializeTab(this.host.activeTab);
      }
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
