export function shouldAutoRefreshCurateStats(state) {
  if (state._curateStatsAutoRefreshDone) {
    return false;
  }
  if (state.curateHomeRefreshing || state.curateStatsLoading) {
    return false;
  }
  const sourceKey = state.activeCurateTagSource || 'permatags';
  const sourceStats = state.tagStatsBySource?.[sourceKey] || null;
  const hasTagStats = !!(sourceStats && Object.keys(sourceStats).length > 0);
  const hasCategoryCards = Array.isArray(state.curateCategoryCards) && state.curateCategoryCards.length > 0;
  return !hasTagStats && !hasCategoryCards;
}

export function scheduleStatsRefresh(state, { delay = 400 } = {}) {
  if (state._statsRefreshTimer) {
    clearTimeout(state._statsRefreshTimer);
  }
  state._statsRefreshTimer = setTimeout(() => {
    state._statsRefreshTimer = null;
    state.fetchStats({
      force: true,
      includeTagStats: state.activeTab === 'curate' && state.curateSubTab === 'home',
    });
  }, delay);
}
