const DRAG_IMAGE_PAYLOAD_TYPE = 'application/x-zoltag-images';
const DEFAULT_HISTORY_BATCH_INCREMENT = 5;
const MAX_HISTORY_BATCHES = 250;
const HOTSPOT_HISTORY_SESSION_STORE = new Map();

function normalizeId(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function dedupeIds(ids) {
  const seen = new Set();
  const result = [];
  (ids || []).forEach((value) => {
    const id = normalizeId(value);
    if (!id || seen.has(id)) return;
    seen.add(id);
    result.push(id);
  });
  return result;
}

function cloneImageForHistory(image) {
  if (!image || typeof image !== 'object') return null;
  const id = normalizeId(image.id);
  if (!id) return null;
  const cloned = {
    ...image,
    id,
  };
  if (Array.isArray(image.permatags)) {
    cloned.permatags = image.permatags.map((tag) => ({ ...tag }));
  }
  return cloned;
}

function buildImageLookup(imageSets = []) {
  const map = new Map();
  imageSets.forEach((set) => {
    if (!Array.isArray(set)) return;
    set.forEach((image) => {
      const normalized = cloneImageForHistory(image);
      if (!normalized) return;
      map.set(normalized.id, normalized);
    });
  });
  return map;
}

function fallbackImage(id) {
  return {
    id,
    filename: `Image #${id}`,
    thumbnail_url: `/api/v1/images/${id}/thumbnail`,
    permatags: [],
  };
}

export function parseDraggedImageIds(dataTransfer) {
  const raw = dataTransfer?.getData('text/plain') || '';
  return dedupeIds(raw.split(','));
}

export function setDragImagePayload(dataTransfer, ids, imageSets = []) {
  if (!dataTransfer) return;
  const uniqueIds = dedupeIds(ids);
  if (!uniqueIds.length) return;
  const lookup = buildImageLookup(imageSets);
  const payload = uniqueIds
    .map((id) => lookup.get(id))
    .filter(Boolean);
  if (!payload.length) return;
  try {
    dataTransfer.setData(DRAG_IMAGE_PAYLOAD_TYPE, JSON.stringify(payload));
  } catch (_error) {
    // Ignore payload encoding failures; id list remains the source of truth.
  }
}

export function readDragImagePayload(dataTransfer) {
  const raw = dataTransfer?.getData(DRAG_IMAGE_PAYLOAD_TYPE) || '';
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((image) => cloneImageForHistory(image))
      .filter(Boolean);
  } catch (_error) {
    return [];
  }
}

export function formatHotspotTargetLabel(target) {
  if (!target || typeof target !== 'object') {
    return 'Hotspot';
  }
  if (target.type === 'rating') {
    return `Rating ${target.rating ?? '?'}`;
  }
  const action = target.action === 'remove' ? 'Remove' : 'Add';
  const category = target.category || 'Uncategorized';
  const keyword = target.keyword || 'Unspecified';
  return `${action} ${category}:${keyword}`;
}

export function createHotspotHistoryBatch({
  ids = [],
  dragImages = [],
  imageSets = [],
  target = null,
  sourceLabel = 'Results',
} = {}) {
  const uniqueIds = dedupeIds(ids);
  if (!uniqueIds.length) return null;
  const payloadLookup = buildImageLookup([dragImages]);
  const fallbackLookup = buildImageLookup(imageSets);
  const images = uniqueIds.map((id) => (
    payloadLookup.get(id)
    || fallbackLookup.get(id)
    || fallbackImage(id)
  ));
  return {
    batchId: (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `history_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    createdAt: Date.now(),
    sourceLabel,
    targetLabel: formatHotspotTargetLabel(target),
    targetType: target?.type || 'keyword',
    ids: uniqueIds,
    images,
  };
}

export function prependHistoryBatch(batches = [], batch = null, maxBatches = MAX_HISTORY_BATCHES) {
  if (!batch) return Array.isArray(batches) ? [...batches] : [];
  const next = [batch, ...(Array.isArray(batches) ? batches : [])];
  return next.slice(0, Math.max(1, maxBatches));
}

export function getVisibleHistoryBatches(batches = [], visibleCount = 1) {
  const normalized = Array.isArray(batches) ? batches : [];
  const cappedVisible = Math.max(1, Number(visibleCount) || 1);
  return normalized.slice(0, cappedVisible);
}

export function loadPreviousHistoryBatchCount(current, increment = DEFAULT_HISTORY_BATCH_INCREMENT) {
  const currentValue = Math.max(1, Number(current) || 1);
  const step = Math.max(1, Number(increment) || DEFAULT_HISTORY_BATCH_INCREMENT);
  return currentValue + step;
}

function cloneHistoryImage(image) {
  if (!image || typeof image !== 'object') return null;
  const cloned = { ...image };
  if (Array.isArray(image.permatags)) {
    cloned.permatags = image.permatags.map((tag) => ({ ...tag }));
  }
  return cloned;
}

function cloneHistoryBatch(batch) {
  if (!batch || typeof batch !== 'object') return null;
  return {
    ...batch,
    ids: Array.isArray(batch.ids) ? [...batch.ids] : [],
    images: Array.isArray(batch.images)
      ? batch.images.map((image) => cloneHistoryImage(image)).filter(Boolean)
      : [],
  };
}

function normalizeHistoryState(state, { fallbackView = 'results' } = {}) {
  const fallback = {
    view: fallbackView === 'history' ? 'history' : 'results',
    visibleCount: 1,
    batches: [],
  };
  if (!state || typeof state !== 'object') {
    return fallback;
  }
  const view = state.view === 'history' ? 'history' : 'results';
  const visibleCount = Math.max(1, Number(state.visibleCount) || 1);
  const batches = Array.isArray(state.batches)
    ? state.batches.map((batch) => cloneHistoryBatch(batch)).filter(Boolean)
    : [];
  return { view, visibleCount, batches };
}

export function buildHotspotHistorySessionKey(scope, tenant = '') {
  const safeScope = String(scope || 'default').trim() || 'default';
  const safeTenant = String(tenant || 'global').trim() || 'global';
  return `${safeScope}::${safeTenant}`;
}

export function saveHotspotHistorySessionState(sessionKey, state) {
  const key = String(sessionKey || '').trim();
  if (!key) return;
  HOTSPOT_HISTORY_SESSION_STORE.set(key, normalizeHistoryState(state));
}

export function loadHotspotHistorySessionState(sessionKey, { fallbackView = 'results' } = {}) {
  const key = String(sessionKey || '').trim();
  if (!key || !HOTSPOT_HISTORY_SESSION_STORE.has(key)) {
    return normalizeHistoryState(null, { fallbackView });
  }
  return normalizeHistoryState(HOTSPOT_HISTORY_SESSION_STORE.get(key), { fallbackView });
}
