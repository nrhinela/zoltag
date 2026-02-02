/**
 * Keyword Utilities
 *
 * Shared utilities for working with keyword/category data structures
 * used in curate filtering and tagging workflows.
 */

import { formatDropboxPath } from './formatting.js';

/**
 * Group keywords by category with counts
 * @param {Object} tagStatsBySource - Tag statistics organized by source
 * @param {string} activeTagSource - Currently active tag source (e.g., 'permatags')
 * @returns {Array<[string, Array<{keyword: string, count: number}>]>} Array of [category, keywords] tuples sorted alphabetically
 */
export function getKeywordsByCategory(tagStatsBySource, activeTagSource = 'permatags') {
  const sourceStats = tagStatsBySource?.[activeTagSource] || tagStatsBySource?.permatags || {};
  const result = [];

  Object.entries(sourceStats).forEach(([category, keywords]) => {
    const categoryKeywords = (keywords || [])
      .map(kw => ({
        keyword: kw.keyword,
        count: kw.count || 0
      }))
      .sort((a, b) => a.keyword.localeCompare(b.keyword));

    if (categoryKeywords.length > 0) {
      result.push([category, categoryKeywords]);
    }
  });

  // Sort categories alphabetically
  return result.sort((a, b) => a[0].localeCompare(b[0]));
}

/**
 * Get total positive permatag count for a category
 * @param {Object} tagStatsBySource - Tag statistics organized by source
 * @param {string} category - Category name
 * @param {string} activeTagSource - Currently active tag source (e.g., 'permatags')
 * @returns {number} Total count for the category
 */
export function getCategoryCount(tagStatsBySource, category, activeTagSource = 'permatags') {
  const sourceStats = tagStatsBySource?.[activeTagSource] || tagStatsBySource?.permatags || {};
  const keywords = sourceStats[category] || [];
  return (keywords || []).reduce((sum, kw) => sum + (kw.count || 0), 0);
}

/**
 * Group a flat keyword list by category with counts
 * @param {Array<{keyword: string, category?: string, count?: number}>} keywords
 * @returns {Array<[string, Array<{keyword: string, count: number}>]>}
 */
export function getKeywordsByCategoryFromList(keywords = []) {
  const categoryMap = new Map();
  (keywords || []).forEach((kw) => {
    if (!kw?.keyword) return;
    const category = kw.category || 'Uncategorized';
    if (!categoryMap.has(category)) {
      categoryMap.set(category, []);
    }
    categoryMap.get(category).push({
      keyword: kw.keyword,
      count: kw.count || 0,
    });
  });

  return Array.from(categoryMap.entries())
    .map(([category, items]) => [
      category,
      items.sort((a, b) => a.keyword.localeCompare(b.keyword)),
    ])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

/**
 * Get total keyword count for a category from a flat keyword list
 * @param {Array<{keyword: string, category?: string, count?: number}>} keywords
 * @param {string} category
 * @returns {number}
 */
export function getCategoryCountFromList(keywords = [], category) {
  return (keywords || []).reduce((sum, kw) => {
    if (!kw?.keyword) return sum;
    const kwCategory = kw.category || 'Uncategorized';
    if (kwCategory !== category) return sum;
    return sum + (kw.count || 0);
  }, 0);
}

export function resolveKeywordCategory(
  keyword,
  {
    fallbackCategory = '',
    keywords = [],
    tagStatsBySource = {},
    activeTagSource = 'permatags',
  } = {}
) {
  if (!keyword) return '';
  const normalizedKeyword = keyword.trim();
  if (!normalizedKeyword) return '';
  const keywordEntry = (keywords || []).find((kw) => kw?.keyword === normalizedKeyword);
  if (keywordEntry?.category) {
    return keywordEntry.category;
  }
  const sourceStats = tagStatsBySource?.[activeTagSource] || tagStatsBySource?.permatags || {};
  for (const [category, keywordEntries] of Object.entries(sourceStats)) {
    if ((keywordEntries || []).some((kw) => kw?.keyword === normalizedKeyword)) {
      return category;
    }
  }
  return fallbackCategory || 'Uncategorized';
}

export function buildCategoryCards(sourceStats, includeEmptyPreferred = false) {
  const preferredOrder = ['Circus Skills', 'Costume Colors', 'Performers'];
  const normalize = (label) => label.toLowerCase().replace(/[_\s]+/g, ' ').trim();
  const preferredNormalized = preferredOrder.map((label) => normalize(label));

  const cards = Object.entries(sourceStats || {})
    .map(([category, keywords]) => {
      const keywordRows = (keywords || [])
        .filter((kw) => (kw.count || 0) > 0)
        .sort((a, b) => (b.count || 0) - (a.count || 0));
      const maxCount = keywordRows.reduce((max, kw) => Math.max(max, kw.count || 0), 0);
      const totalCount = keywordRows.reduce((sum, kw) => sum + (kw.count || 0), 0);
      return { category, keywordRows, maxCount, totalCount };
    })
    .filter((card) => includeEmptyPreferred || card.keywordRows.length)
    .sort((a, b) => {
      const aLabel = normalize(a.category.replace(/_/g, ' '));
      const bLabel = normalize(b.category.replace(/_/g, ' '));
      const aIndex = preferredNormalized.indexOf(aLabel);
      const bIndex = preferredNormalized.indexOf(bLabel);
      if (aIndex !== -1 || bIndex !== -1) {
        return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
      }
      return aLabel.localeCompare(bLabel);
    });

  if (includeEmptyPreferred) {
    preferredOrder.forEach((label) => {
      const exists = cards.some(
        (card) => normalize(card.category.replace(/_/g, ' ')) === normalize(label)
      );
      if (!exists) {
        cards.push({
          category: label,
          keywordRows: [],
          maxCount: 0,
          totalCount: 0,
        });
      }
    });
    cards.sort((a, b) => {
      const aLabel = normalize(a.category.replace(/_/g, ' '));
      const bLabel = normalize(b.category.replace(/_/g, ' '));
      const aIndex = preferredNormalized.indexOf(aLabel);
      const bIndex = preferredNormalized.indexOf(bLabel);
      if (aIndex !== -1 || bIndex !== -1) {
        return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
      }
      return aLabel.localeCompare(bLabel);
    });
  }

  return cards;
}

export function getCurateHoverLines(image) {
  const lines = [];
  const path = formatDropboxPath(image?.dropbox_path);
  if (path && path !== 'Unknown') {
    lines.push(path);
  } else {
    lines.push('Unknown');
  }
  const permatags = Array.isArray(image?.permatags) ? image.permatags : [];
  const positive = permatags.filter((tag) => tag.signum === 1);
  if (!positive.length) {
    return lines;
  }
  const byCategory = {};
  positive.forEach((tag) => {
    const category = tag.category || 'Uncategorized';
    if (!byCategory[category]) {
      byCategory[category] = [];
    }
    byCategory[category].push(tag.keyword);
  });
  Object.entries(byCategory)
    .map(([category, keywords]) => ({
      category,
      keywords: keywords.filter(Boolean).sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.category.localeCompare(b.category))
    .forEach((group) => {
      if (!group.keywords.length) return;
      const label = group.category.replace(/_/g, ' ');
      lines.push(`${label}: ${group.keywords.join(', ')}`);
    });
  return lines;
}

export function getCuratePermatagGroups(image) {
  const permatags = Array.isArray(image?.permatags) ? image.permatags : [];
  const positive = permatags.filter((tag) => tag.signum === 1 && tag.keyword);
  if (!positive.length) {
    return [];
  }
  const byCategory = {};
  positive.forEach((tag) => {
    const category = tag.category || 'Uncategorized';
    if (!byCategory[category]) {
      byCategory[category] = [];
    }
    byCategory[category].push(tag.keyword);
  });
  return Object.entries(byCategory)
    .map(([category, keywords]) => ({
      category,
      keywords: keywords.filter(Boolean).sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

export function mergePermatags(existing, additions) {
  const map = new Map();
  (existing || []).forEach((tag) => {
    if (!tag?.keyword) return;
    const key = `${tag.category || 'Uncategorized'}::${tag.keyword}`;
    map.set(key, { ...tag });
  });
  (additions || []).forEach((tag) => {
    if (!tag?.keyword) return;
    const category = tag.category || 'Uncategorized';
    const key = `${category}::${tag.keyword}`;
    map.set(key, { keyword: tag.keyword, category, signum: 1 });
  });
  return Array.from(map.values());
}
