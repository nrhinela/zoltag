import { BaseStateController } from './base-state-controller.js';
import {
  getKeywords,
  getImageStats,
  getMlTrainingStats,
  getTagStats,
  getLists,
} from '../../services/api.js';
import { shouldIncludeRatingStats } from '../shared/curate-filters.js';

export class AppDataStateController extends BaseStateController {
  constructor(host) {
    super(host);
  }

  async fetchKeywords() {
    if (!this.host.tenant) return;
    const showHomeLoading = this.host.activeTab === 'home';
    if (showHomeLoading) {
      this.host._homeLoadingCount = (this.host._homeLoadingCount || 0) + 1;
      this.host.homeLoading = true;
    }
    try {
      const keywordsByCategory = await getKeywords(this.host.tenant, { source: 'permatags', includePeople: true });
      const flat = [];
      Object.entries(keywordsByCategory || {}).forEach(([category, list]) => {
        list.forEach((kw) => {
          flat.push({ keyword: kw.keyword, category, count: kw.count || 0 });
        });
      });
      this.host.keywords = flat.sort((a, b) => a.keyword.localeCompare(b.keyword));
    } catch (error) {
      console.error('Error fetching keywords:', error);
      this.host.keywords = [];
    } finally {
      if (showHomeLoading) {
        this.host._homeLoadingCount = Math.max(0, (this.host._homeLoadingCount || 1) - 1);
        this.host.homeLoading = this.host._homeLoadingCount > 0;
      }
    }
  }

  async fetchHomeLists({ force = false } = {}) {
    if (!this.host.tenant) {
      this.host.homeLists = [];
      return;
    }
    try {
      const lists = await getLists(this.host.tenant, { force });
      this.host.homeLists = Array.isArray(lists) ? lists : [];
    } catch (error) {
      console.error('Error fetching home lists:', error);
      this.host.homeLists = [];
    }
  }

  async fetchStats({ force = false, includeRatings, includeImageStats = true, includeMlStats = false, includeTagStats = true } = {}) {
    const tenantAtRequest = this.host.tenant;
    if (!tenantAtRequest) return;
    const requestId = (this.host._statsRequestId || 0) + 1;
    this.host._statsRequestId = requestId;
    const include = includeRatings ?? shouldIncludeRatingStats(this.host);
    const showCurateLoading = this.host.activeTab === 'curate' && this.host.curateSubTab === 'home';
    const showHomeLoading = this.host.activeTab === 'home';
    if (showCurateLoading) {
      this.host._curateStatsLoadingCount = (this.host._curateStatsLoadingCount || 0) + 1;
      this.host.curateStatsLoading = true;
    }
    if (showHomeLoading) {
      this.host._homeLoadingCount = (this.host._homeLoadingCount || 0) + 1;
      this.host.homeLoading = true;
    }
    try {
      const requests = [];
      if (includeImageStats) {
        requests.push(getImageStats(tenantAtRequest, { force, includeRatings: include }));
      }
      if (includeMlStats) {
        requests.push(getMlTrainingStats(tenantAtRequest, { force }));
      }
      if (includeTagStats) {
        requests.push(getTagStats(tenantAtRequest, { force }));
      }
      const results = await Promise.allSettled(requests);
      const isStale =
        this.host._statsRequestId !== requestId || this.host.tenant !== tenantAtRequest;
      if (isStale) {
        return;
      }
      let index = 0;
      if (includeImageStats) {
        const imageResult = results[index++];
        if (imageResult.status === 'fulfilled') {
          this.host.imageStats = imageResult.value;
        } else {
          console.error('Error fetching image stats:', imageResult.reason);
          this.host.imageStats = null;
        }
      }
      if (includeMlStats) {
        const mlResult = results[index++];
        if (mlResult.status === 'fulfilled') {
          this.host.mlTrainingStats = mlResult.value;
        } else {
          console.error('Error fetching ML training stats:', mlResult.reason);
          this.host.mlTrainingStats = null;
        }
      }
      if (includeTagStats) {
        const tagResult = results[index++];
        if (tagResult.status === 'fulfilled') {
          this.host.tagStatsBySource = tagResult.value?.sources || {};
          this.host._updateCurateCategoryCards();
        } else {
          console.error('Error fetching tag stats:', tagResult.reason);
          this.host.tagStatsBySource = {};
        }
      }
    } finally {
      if (showCurateLoading) {
        this.host._curateStatsLoadingCount = Math.max(0, (this.host._curateStatsLoadingCount || 1) - 1);
        this.host.curateStatsLoading = this.host._curateStatsLoadingCount > 0;
      }
      if (showHomeLoading) {
        this.host._homeLoadingCount = Math.max(0, (this.host._homeLoadingCount || 1) - 1);
        this.host.homeLoading = this.host._homeLoadingCount > 0;
      }
    }
  }

  handleSyncProgress(event) {
    console.log(`Sync progress: ${event.detail.count} images processed`);
  }

  handleSyncComplete(event) {
    console.log(`Sync complete: ${event.detail.count} total images processed`);
    this.fetchStats({
      force: true,
      includeTagStats: this.host.activeTab === 'curate' && this.host.curateSubTab === 'home',
    });
  }

  handleSyncError(event) {
    console.error('Sync error:', event.detail.error);
  }
}
