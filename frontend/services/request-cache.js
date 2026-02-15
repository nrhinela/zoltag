const queryStore = new Map()
const DEFAULT_CACHE_TIME_MS = 5 * 60 * 1000
const QUERY_DEBUG_STORAGE_KEY = 'zoltag:query-debug'

function isDevBuild() {
  try {
    return Boolean(import.meta.env?.DEV)
  } catch (_error) {
    return false
  }
}

function isQueryDebugEnabled() {
  if (typeof window !== 'undefined') {
    if (window.__ZOLTAG_QUERY_DEBUG__ === true) {
      return true
    }
    if (window.__ZOLTAG_QUERY_DEBUG__ === false) {
      return false
    }
    try {
      const stored = String(window.localStorage.getItem(QUERY_DEBUG_STORAGE_KEY) || '')
        .trim()
        .toLowerCase()
      if (['1', 'true', 'on', 'yes'].includes(stored)) return true
      if (['0', 'false', 'off', 'no'].includes(stored)) return false
    } catch (_error) {
      // ignore storage access errors
    }
  }
  return isDevBuild()
}

function debugQuery(event, key, detail = null) {
  if (!isQueryDebugEnabled()) return
  const normalizedKey = normalizeQueryKey(key)
  if (detail && typeof detail === 'object') {
    console.debug(`[query] ${event}`, { key: normalizedKey, ...detail })
    return
  }
  console.debug(`[query] ${event}`, { key: normalizedKey })
}

function normalizeQueryKey(key) {
  if (typeof key === 'string') {
    return key
  }
  try {
    return JSON.stringify(key)
  } catch (_error) {
    return String(key)
  }
}

function resolveExpiry(now, staleTimeMs, cacheTimeMs) {
  const cache = Number(cacheTimeMs) || 0
  const stale = Number(staleTimeMs) || 0
  if (cache > 0) {
    return now + cache
  }
  if (stale > 0) {
    return now + stale
  }
  return 0
}

function keyMatches(rawKey, keyMatcher) {
  if (typeof keyMatcher === 'function') {
    return !!keyMatcher(rawKey)
  }

  if (Array.isArray(keyMatcher)) {
    if (!Array.isArray(rawKey) || keyMatcher.length > rawKey.length) {
      return false
    }
    return keyMatcher.every((part, index) => part === rawKey[index])
  }

  if (typeof keyMatcher === 'string') {
    if (typeof rawKey === 'string') {
      return rawKey === keyMatcher || rawKey.startsWith(keyMatcher)
    }
    return normalizeQueryKey(rawKey) === keyMatcher
  }

  return normalizeQueryKey(rawKey) === normalizeQueryKey(keyMatcher)
}

function pruneExpiredQueries() {
  const now = Date.now()
  let removedCount = 0
  for (const [queryKey, entry] of queryStore.entries()) {
    if (entry?.inflight) continue
    if (entry?.expiresAt > 0 && entry.expiresAt <= now) {
      queryStore.delete(queryKey)
      removedCount += 1
    }
  }
  if (removedCount > 0) {
    debugQuery('prune-expired', 'all', { removedCount })
  }
}

export function queryRequest(
  key,
  fetcher,
  { staleTimeMs = 0, cacheTimeMs = undefined, force = false } = {}
) {
  pruneExpiredQueries()

  const queryKey = normalizeQueryKey(key)
  const now = Date.now()
  const existing = queryStore.get(queryKey)
  const staleForMs = Number(staleTimeMs) || 0
  const cacheForMs = cacheTimeMs === undefined
    ? (staleForMs > 0 ? staleForMs : 0)
    : Math.max(0, Number(cacheTimeMs) || 0)
  const effectiveCacheForMs = cacheForMs > 0
    ? cacheForMs
    : (staleForMs > 0 ? staleForMs : DEFAULT_CACHE_TIME_MS)

  if (existing?.inflight) {
    debugQuery('join-inflight', key)
    return existing.promise
  }

  if (
    !force
    && staleForMs > 0
    && existing?.status === 'success'
    && existing.staleUntil > now
  ) {
    debugQuery('cache-hit', key, {
      staleRemainingMs: Math.max(0, existing.staleUntil - now),
    })
    return Promise.resolve(existing.data)
  }

  debugQuery(force ? 'force-refetch' : 'fetch-start', key, {
    staleTimeMs: staleForMs,
    cacheTimeMs: effectiveCacheForMs,
    hadCachedValue: existing?.status === 'success',
  })
  const startedAt = Date.now()
  const promise = Promise.resolve().then(fetcher)
  queryStore.set(queryKey, {
    key: queryKey,
    rawKey: key,
    status: 'loading',
    inflight: true,
    promise,
    data: existing?.data,
    error: null,
    staleUntil: 0,
    expiresAt: resolveExpiry(now, staleForMs, effectiveCacheForMs),
  })

  return promise
    .then((result) => {
      const settledAt = Date.now()
      const durationMs = settledAt - startedAt
      if (staleForMs <= 0 && cacheForMs <= 0) {
        queryStore.delete(queryKey)
        debugQuery('fetch-success', key, {
          durationMs,
          cached: false,
        })
        return result
      }

      queryStore.set(queryKey, {
        key: queryKey,
        rawKey: key,
        status: 'success',
        inflight: false,
        promise: Promise.resolve(result),
        data: result,
        error: null,
        staleUntil: staleForMs > 0 ? settledAt + staleForMs : 0,
        expiresAt: resolveExpiry(settledAt, staleForMs, effectiveCacheForMs),
      })
      debugQuery('fetch-success', key, {
        durationMs,
        cached: true,
        staleUntilMs: staleForMs,
      })
      return result
    })
    .catch((error) => {
      queryStore.delete(queryKey)
      debugQuery('fetch-error', key, {
        durationMs: Date.now() - startedAt,
        message: String(error?.message || error || 'Unknown error'),
      })
      throw error
    })
}

export function primeQuery(
  key,
  data,
  { staleTimeMs = 0, cacheTimeMs = undefined } = {}
) {
  const queryKey = normalizeQueryKey(key)
  const now = Date.now()
  const staleForMs = Number(staleTimeMs) || 0
  const cacheForMs = cacheTimeMs === undefined
    ? (staleForMs > 0 ? staleForMs : DEFAULT_CACHE_TIME_MS)
    : Math.max(0, Number(cacheTimeMs) || 0)

  queryStore.set(queryKey, {
    key: queryKey,
    rawKey: key,
    status: 'success',
    inflight: false,
    promise: Promise.resolve(data),
    data,
    error: null,
    staleUntil: staleForMs > 0 ? now + staleForMs : 0,
    expiresAt: resolveExpiry(now, staleForMs, cacheForMs),
  })
  debugQuery('prime', key, {
    staleTimeMs: staleForMs,
    cacheTimeMs: cacheForMs,
  })
}

export function peekQuery(key) {
  pruneExpiredQueries()
  return queryStore.get(normalizeQueryKey(key)) || null
}

export function invalidateQuery(key) {
  const normalizedKey = normalizeQueryKey(key)
  const existed = queryStore.delete(normalizedKey)
  if (existed) {
    debugQuery('invalidate', key)
  }
}

export function invalidateQueries(keyMatcher = null) {
  if (keyMatcher === null || keyMatcher === undefined) {
    const count = queryStore.size
    queryStore.clear()
    if (count > 0) {
      debugQuery('invalidate-all', 'all', { count })
    }
    return
  }
  let removedCount = 0
  for (const [queryKey, entry] of queryStore.entries()) {
    if (keyMatches(entry?.rawKey, keyMatcher)) {
      queryStore.delete(queryKey)
      removedCount += 1
    }
  }
  if (removedCount > 0) {
    debugQuery('invalidate-match', keyMatcher, { removedCount })
  }
}

export function cachedRequest(key, fetcher, { ttlMs = 0, force = false } = {}) {
  return queryRequest(key, fetcher, {
    staleTimeMs: ttlMs,
    cacheTimeMs: ttlMs,
    force,
  })
}

export function clearCachedRequest(key) {
  invalidateQuery(key)
}

export function setQueryDebug(enabled) {
  const next = Boolean(enabled)
  if (typeof window !== 'undefined') {
    window.__ZOLTAG_QUERY_DEBUG__ = next
    try {
      window.localStorage.setItem(QUERY_DEBUG_STORAGE_KEY, next ? '1' : '0')
    } catch (_error) {
      // ignore storage access errors
    }
  }
}
