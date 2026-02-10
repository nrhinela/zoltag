import { BaseStateController } from './base-state-controller.js';
import {
  getKeywords,
  getImageStats,
  getMlTrainingStats,
  getTagStats,
} from '../../services/api.js';
import { shouldIncludeRatingStats } from '../shared/curate-filters.js';

export class AppDataStateController extends BaseStateController {
  constructor(host) {
    super(host);
  }

  async fetchKeywords() {
    if (!this.host.tenant) return;
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
    }
  }

  async fetchStats({ force = false, includeRatings, includeImageStats = true, includeMlStats = true, includeTagStats = true } = {}) {
    if (!this.host.tenant) return;
    const include = includeRatings ?? shouldIncludeRatingStats(this.host);
    const showCurateLoading = this.host.activeTab === 'curate' && this.host.curateSubTab === 'home';
    if (showCurateLoading) {
      this.host._curateStatsLoadingCount = (this.host._curateStatsLoadingCount || 0) + 1;
      this.host.curateStatsLoading = true;
    }
    try {
      const requests = [];
      if (includeImageStats) {
        requests.push(getImageStats(this.host.tenant, { force, includeRatings: include }));
      }
      if (includeMlStats) {
        requests.push(getMlTrainingStats(this.host.tenant, { force }));
      }
      if (includeTagStats) {
        requests.push(getTagStats(this.host.tenant, { force }));
      }
      const results = await Promise.allSettled(requests);
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
