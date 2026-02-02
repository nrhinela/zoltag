/**
 * Format a statistic number with commas
 * @param {number} num - Number to format
 * @returns {string} Formatted number string
 */
export function formatStatNumber(num, { placeholder = '0' } = {}) {
  if (num === null || num === undefined || num === '') {
    return placeholder;
  }
  const n = Number(num);
  if (Number.isNaN(n)) {
    return placeholder;
  }
  return n.toLocaleString();
}

export function formatDateTime(value) {
  if (!value) return 'Unknown';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString();
}

export function formatRating(value) {
  if (value === null || value === undefined || value === '') {
    return 'Unrated';
  }
  return String(value);
}

export function formatDropboxPath(path) {
  if (!path) return 'Unknown';
  return path.replace(/_/g, '_\u200b');
}

export function formatQueueItem(item) {
  if (!item) return '';
  if (item.description) return item.description;
  if (item.imageId) return `${item.type} · image ${item.imageId}`;
  return item.type || 'queue item';
}

export function formatCurateDate(image) {
  const value = image?.capture_timestamp || image?.modified_time;
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (num) => String(num).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function formatCurateProcessedDate(image) {
  const value = image?.last_processed || image?.created_at;
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (num) => String(num).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
