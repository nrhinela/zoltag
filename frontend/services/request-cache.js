const requestCache = new Map();

export function cachedRequest(key, fetcher, { ttlMs = 0, force = false } = {}) {
  const now = Date.now();
  const existing = requestCache.get(key);

  if (existing?.inflight) {
    return existing.promise;
  }

  if (!force && ttlMs > 0 && existing?.expiresAt > now) {
    return existing.promise;
  }

  const promise = Promise.resolve().then(fetcher);
  requestCache.set(key, {
    promise,
    inflight: true,
    expiresAt: ttlMs > 0 ? now + ttlMs : 0,
  });

  return promise
    .then((result) => {
      if (ttlMs > 0) {
        requestCache.set(key, {
          promise: Promise.resolve(result),
          inflight: false,
          expiresAt: Date.now() + ttlMs,
        });
      } else {
        requestCache.delete(key);
      }
      return result;
    })
    .catch((error) => {
      requestCache.delete(key);
      throw error;
    });
}

export function clearCachedRequest(key) {
  requestCache.delete(key);
}
