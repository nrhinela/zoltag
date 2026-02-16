import { BaseStateController } from './base-state-controller.js';

const TOP_LEVEL_TABS = new Set(['home', 'search', 'curate', 'library', 'lists']);
const LIBRARY_SUB_TABS = new Set(['assets', 'keywords', 'providers', 'users', 'jobs']);
const SEARCH_SUB_TABS = new Set(['home', 'browse-by-folder', 'natural-search', 'chips']);
const CURATE_SUB_TABS = new Set(['main', 'browse-folder', 'tag-audit', 'home', 'help']);
const HOME_SUB_TABS = new Set(['overview', 'chips', 'lab']);
const ADMIN_SUB_TABS = new Set(['tagging', 'people']);
const SPA_NAV_STATE_KEY = '__zoltagSpaNav';

export class AppNavigationStateController extends BaseStateController {
  constructor(host) {
    super(host);
    this._navigationReady = false;
    this._suppressHistoryPush = false;
    this._lastNavigationKey = '';
    this._onPopState = (event) => this._handlePopState(event);
  }

  connect() {
    this._initializeBrowserNavigation();
    window.addEventListener('popstate', this._onPopState);
  }

  disconnect() {
    window.removeEventListener('popstate', this._onPopState);
  }

  handleUpdated(changedProperties) {
    this._syncBrowserNavigation(changedProperties);
  }

  _normalizeTopLevelTab(value) {
    const tab = String(value || '').trim().toLowerCase();
    return TOP_LEVEL_TABS.has(tab) ? tab : 'home';
  }

  _normalizeNavigationSnapshot(input = {}) {
    const tab = this._normalizeTopLevelTab(input.tab);
    const snapshot = { tab };
    if (tab === 'library') {
      const subTab = String(input.subTab || '').trim().toLowerCase();
      const normalizedSubTab = LIBRARY_SUB_TABS.has(subTab) ? subTab : 'assets';
      snapshot.subTab = normalizedSubTab;
      if (normalizedSubTab === 'keywords') {
        const adminSubTab = String(input.adminSubTab || '').trim().toLowerCase();
        snapshot.adminSubTab = ADMIN_SUB_TABS.has(adminSubTab) ? adminSubTab : 'tagging';
      }
    } else if (tab === 'search') {
      const subTab = String(input.subTab || '').trim().toLowerCase();
      snapshot.subTab = SEARCH_SUB_TABS.has(subTab) ? subTab : 'home';
    } else if (tab === 'curate') {
      const subTab = String(input.subTab || '').trim().toLowerCase();
      snapshot.subTab = CURATE_SUB_TABS.has(subTab) ? subTab : 'main';
    } else if (tab === 'home') {
      const subTab = String(input.subTab || '').trim().toLowerCase();
      snapshot.subTab = HOME_SUB_TABS.has(subTab) ? subTab : 'overview';
    }
    return snapshot;
  }

  _getNavigationSnapshot() {
    return this._normalizeNavigationSnapshot({
      tab: this.host.activeTab,
      subTab: this.host.activeTab === 'library'
        ? this.host.activeLibrarySubTab
        : this.host.activeTab === 'search'
          ? this.host.activeSearchSubTab
          : this.host.activeTab === 'curate'
            ? this.host.curateSubTab
            : this.host.homeSubTab,
      adminSubTab: this.host.activeAdminSubTab,
    });
  }

  _buildNavigationUrl(snapshot) {
    const params = new URLSearchParams(window.location.search || '');
    params.delete('tab');
    params.delete('subTab');
    params.delete('adminSubTab');

    params.set('tab', snapshot.tab);
    if (snapshot.subTab) {
      params.set('subTab', snapshot.subTab);
    }
    if (snapshot.adminSubTab) {
      params.set('adminSubTab', snapshot.adminSubTab);
    }

    const query = params.toString();
    return `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash || ''}`;
  }

  _readNavigationSnapshotFromUrl() {
    const params = new URLSearchParams(window.location.search || '');
    return this._normalizeNavigationSnapshot({
      tab: params.get('tab') || this.host.activeTab,
      subTab: params.get('subTab') || '',
      adminSubTab: params.get('adminSubTab') || '',
    });
  }

  _applyNavigationSnapshot(snapshot) {
    const normalized = this._normalizeNavigationSnapshot(snapshot);
    this._suppressHistoryPush = true;

    if (normalized.tab === 'library') {
      this.host.activeLibrarySubTab = normalized.subTab || 'assets';
      if ((normalized.subTab || '') === 'keywords') {
        this.host.activeAdminSubTab = normalized.adminSubTab || 'tagging';
      }
    } else if (normalized.tab === 'search') {
      this.host.activeSearchSubTab = normalized.subTab || 'home';
    } else if (normalized.tab === 'curate') {
      this.host.curateSubTab = normalized.subTab || 'main';
    } else if (normalized.tab === 'home') {
      this.host.homeSubTab = normalized.subTab || 'overview';
    }

    this.host._appShellState.setActiveTab(normalized.tab);
  }

  _navigationStateForHistory(snapshot) {
    return {
      [SPA_NAV_STATE_KEY]: true,
      snapshot: this._normalizeNavigationSnapshot(snapshot),
    };
  }

  _navigationKey(snapshot) {
    const normalized = this._normalizeNavigationSnapshot(snapshot);
    return JSON.stringify(normalized);
  }

  _replaceHistoryWithSnapshot(snapshot) {
    const normalized = this._normalizeNavigationSnapshot(snapshot);
    const url = this._buildNavigationUrl(normalized);
    window.history.replaceState(this._navigationStateForHistory(normalized), '', url);
    this._lastNavigationKey = this._navigationKey(normalized);
  }

  _pushHistorySnapshot(snapshot) {
    const normalized = this._normalizeNavigationSnapshot(snapshot);
    const url = this._buildNavigationUrl(normalized);
    window.history.pushState(this._navigationStateForHistory(normalized), '', url);
    this._lastNavigationKey = this._navigationKey(normalized);
  }

  _initializeBrowserNavigation() {
    const urlSnapshot = this._readNavigationSnapshotFromUrl();
    this._applyNavigationSnapshot(urlSnapshot);

    const initialSnapshot = this._getNavigationSnapshot();
    const historyState = window.history.state;
    const hasAppState = !!(historyState && historyState[SPA_NAV_STATE_KEY]);

    this._replaceHistoryWithSnapshot(initialSnapshot);
    if (!hasAppState) {
      // Add an internal guard entry so the first Back stays inside the SPA.
      this._pushHistorySnapshot(initialSnapshot);
    }
    this._suppressHistoryPush = false;
    this._navigationReady = true;
  }

  _handlePopState(event) {
    const state = event?.state;
    if (!state || !state[SPA_NAV_STATE_KEY] || !state.snapshot) {
      return;
    }
    this._applyNavigationSnapshot(state.snapshot);
    this._lastNavigationKey = this._navigationKey(state.snapshot);
  }

  _syncBrowserNavigation(changedProperties) {
    if (!this._navigationReady) {
      return;
    }
    const navProps = [
      'activeTab',
      'activeLibrarySubTab',
      'activeSearchSubTab',
      'activeAdminSubTab',
      'curateSubTab',
      'homeSubTab',
    ];
    const hasNavChange = navProps.some((prop) => changedProperties.has(prop));
    if (!hasNavChange) {
      return;
    }

    const snapshot = this._getNavigationSnapshot();
    const nextKey = this._navigationKey(snapshot);
    if (this._suppressHistoryPush) {
      this._suppressHistoryPush = false;
      if (nextKey !== this._lastNavigationKey) {
        this._replaceHistoryWithSnapshot(snapshot);
      }
      return;
    }

    if (nextKey === this._lastNavigationKey) {
      return;
    }

    this._pushHistorySnapshot(snapshot);
  }
}
