export const APP_AUTH_STORAGE_KEY = 'zoltag:app:auth';
export const GUEST_AUTH_STORAGE_KEY = 'zoltag:guest:auth';
export const APP_CURRENT_TENANT_STORAGE_KEY = 'zoltag:app:currentTenant';

const LEGACY_TENANT_STORAGE_KEYS = ['tenantId', 'currentTenant'];

function hasWindowStorage() {
  return typeof window !== 'undefined' && !!window.localStorage;
}

function normalizeTenantValue(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

export function migrateLocalStorageKey(nextKey, legacyKeys = []) {
  if (!hasWindowStorage()) return;
  try {
    const existing = window.localStorage.getItem(nextKey);
    if (existing == null) {
      for (const legacyKey of legacyKeys) {
        const legacyValue = window.localStorage.getItem(legacyKey);
        if (legacyValue == null) continue;
        window.localStorage.setItem(nextKey, legacyValue);
        break;
      }
    }
    for (const legacyKey of legacyKeys) {
      window.localStorage.removeItem(legacyKey);
    }
  } catch (_error) {
    // Ignore storage access failures.
  }
}

function readLegacyTenantSelection() {
  if (!hasWindowStorage()) return '';
  for (const key of LEGACY_TENANT_STORAGE_KEYS) {
    const value = normalizeTenantValue(window.localStorage.getItem(key) || '');
    if (value) return value;
  }
  return '';
}

export function getStoredAppTenant() {
  if (!hasWindowStorage()) return '';
  try {
    const current = normalizeTenantValue(window.localStorage.getItem(APP_CURRENT_TENANT_STORAGE_KEY) || '');
    if (current) {
      for (const key of LEGACY_TENANT_STORAGE_KEYS) {
        window.localStorage.removeItem(key);
      }
      return current;
    }

    const legacy = readLegacyTenantSelection();
    if (legacy) {
      window.localStorage.setItem(APP_CURRENT_TENANT_STORAGE_KEY, legacy);
      for (const key of LEGACY_TENANT_STORAGE_KEYS) {
        window.localStorage.removeItem(key);
      }
    }
    return legacy;
  } catch (_error) {
    return '';
  }
}

export function setStoredAppTenant(tenantId) {
  const normalized = normalizeTenantValue(tenantId);
  if (!normalized || !hasWindowStorage()) return;
  try {
    window.localStorage.setItem(APP_CURRENT_TENANT_STORAGE_KEY, normalized);
    for (const key of LEGACY_TENANT_STORAGE_KEYS) {
      window.localStorage.removeItem(key);
    }
  } catch (_error) {
    // Ignore storage access failures.
  }
}

export function clearStoredAppTenant() {
  if (!hasWindowStorage()) return;
  try {
    window.localStorage.removeItem(APP_CURRENT_TENANT_STORAGE_KEY);
    for (const key of LEGACY_TENANT_STORAGE_KEYS) {
      window.localStorage.removeItem(key);
    }
  } catch (_error) {
    // Ignore storage access failures.
  }
}
