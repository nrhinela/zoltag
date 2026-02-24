/**
 * Local desktop mode detection.
 *
 * Fetches /api/v1/config/system once and caches the result.
 * Returns true when the backend is running in LOCAL_MODE (desktop app).
 */

let _cachedLocalMode = null;

export async function isLocalMode() {
  if (_cachedLocalMode !== null) return _cachedLocalMode;
  try {
    const resp = await fetch('/api/v1/config/system');
    if (resp.ok) {
      const cfg = await resp.json();
      _cachedLocalMode = !!cfg.local_mode;
    } else {
      _cachedLocalMode = false;
    }
  } catch (_e) {
    _cachedLocalMode = false;
  }
  return _cachedLocalMode;
}
