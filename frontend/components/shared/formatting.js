/**
 * Format a statistic number with commas
 * @param {number} num - Number to format
 * @returns {string} Formatted number string
 */
export function formatStatNumber(num) {
  if (num === null || num === undefined || num === '') {
    return '0';
  }
  const n = Number(num);
  if (Number.isNaN(n)) {
    return '0';
  }
  return n.toLocaleString();
}
