/**
 * Zoltag authentication service
 *
 * Handles user authentication flows:
 * - Email/password signup and login
 * - Google OAuth login
 * - User profile completion
 * - Invitation acceptance
 * - Logout
 *
 * Integrates Supabase Auth (identity) with Zoltag backend (authorization).
 */

import { supabase, getAccessToken, getSession } from './supabase.js';
import { fetchWithAuth } from './api.js';
import { invalidateQueries, queryRequest } from './request-cache.js';

const REGISTER_SUCCESS_CACHE_MS = 60 * 1000;
const REGISTER_CROSS_TAB_LOCK_MS = 15 * 1000;
const REGISTER_LOCK_WAIT_MS = 4000;
const REGISTER_LOCK_POLL_MS = 120;
const REGISTER_SUCCESS_STORAGE_PREFIX = 'zoltag:auth-register:success';
const REGISTER_LOCK_STORAGE_PREFIX = 'zoltag:auth-register:lock';
const REGISTER_LOCK_OWNER = `tab-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;

let registerInFlight = null;
let registerInFlightToken = null;
let lastRegisterSuccessToken = null;
let lastRegisterSuccessAt = 0;

function getStorageKey(prefix, subject) {
  return `${prefix}:${subject || 'unknown'}`;
}

function decodeJwtSubject(token) {
  if (!token) return '';
  try {
    const [, payloadBase64] = String(token).split('.');
    if (!payloadBase64) return '';
    const normalized = payloadBase64
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(payloadBase64.length / 4) * 4, '=');
    const payload = JSON.parse(atob(normalized));
    return String(payload?.sub || '').trim();
  } catch (_error) {
    return '';
  }
}

function readStorageNumber(key) {
  if (typeof window === 'undefined') return 0;
  try {
    const value = Number(window.localStorage.getItem(key) || 0);
    return Number.isFinite(value) ? value : 0;
  } catch (_error) {
    return 0;
  }
}

function writeStorageNumber(key, value) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch (_error) {
    // ignore storage access failures
  }
}

function readLockRecord(lockKey) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(lockKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const owner = String(parsed?.owner || '').trim();
    const acquiredAt = Number(parsed?.acquiredAt || 0);
    if (!owner || !Number.isFinite(acquiredAt) || acquiredAt <= 0) {
      return null;
    }
    return { owner, acquiredAt };
  } catch (_error) {
    return null;
  }
}

function tryAcquireRegisterLock(lockKey, owner) {
  const now = Date.now();
  const existing = readLockRecord(lockKey);
  const isStale = existing && (now - existing.acquiredAt) > REGISTER_CROSS_TAB_LOCK_MS;
  if (existing && existing.owner !== owner && !isStale) {
    return false;
  }
  if (typeof window === 'undefined') {
    return true;
  }
  try {
    window.localStorage.setItem(lockKey, JSON.stringify({
      owner,
      acquiredAt: now,
    }));
    const confirmed = readLockRecord(lockKey);
    return confirmed?.owner === owner;
  } catch (_error) {
    // If storage is unavailable, fall back to single-tab in-memory dedupe.
    return true;
  }
}

function releaseRegisterLock(lockKey, owner) {
  if (typeof window === 'undefined') return;
  try {
    const current = readLockRecord(lockKey);
    if (current?.owner === owner) {
      window.localStorage.removeItem(lockKey);
    }
  } catch (_error) {
    // ignore storage access failures
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isInvitationRequiredRegistrationError(message) {
  const normalized = String(message || '').trim().toLowerCase();
  return normalized.includes('invitation required before registration');
}

function noAccountFoundMessage(email) {
  const normalizedEmail = String(email || '').trim();
  if (!normalizedEmail) return 'No account found for this email';
  return `No account found for ${normalizedEmail}`;
}

function mapRegistrationErrorMessage(message, email = '') {
  if (isInvitationRequiredRegistrationError(message)) {
    return noAccountFoundMessage(email);
  }
  return String(message || '').trim() || 'Registration failed';
}

async function waitForRegisterCompletion(successKey, lockKey) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < REGISTER_LOCK_WAIT_MS) {
    const successAt = readStorageNumber(successKey);
    if (successAt > 0 && (Date.now() - successAt) < REGISTER_SUCCESS_CACHE_MS) {
      return true;
    }

    const lock = readLockRecord(lockKey);
    if (!lock) {
      return false;
    }
    const lockAge = Date.now() - lock.acquiredAt;
    if (lockAge > REGISTER_CROSS_TAB_LOCK_MS) {
      return false;
    }
    await sleep(REGISTER_LOCK_POLL_MS);
  }
  return false;
}

async function postRegister(token, displayName = '') {
  const response = await fetch('/api/v1/auth/register', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ display_name: displayName || '' }),
  });

  if (response.status === 429) {
    const isRecentSuccessForToken = (
      lastRegisterSuccessToken === token
      && (Date.now() - lastRegisterSuccessAt) < REGISTER_SUCCESS_CACHE_MS
    );
    if (isRecentSuccessForToken) {
      return true;
    }
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ detail: 'Registration failed' }));
    throw new Error(errorData.detail || 'Registration failed');
  }

  lastRegisterSuccessToken = token;
  lastRegisterSuccessAt = Date.now();
  invalidateQueries(['auth', 'me']);
  return true;
}

/**
 * Sign up with email and password
 *
 * Flow:
 * 1. Create account in Supabase Auth
 * 2. Complete registration in Zoltag backend
 * 3. Account starts as pending approval (is_active=FALSE)
 * 4. Super admin must approve before user can access tenants
 *
 * @param {string} email - User email
 * @param {string} password - User password
 * @param {string|null} displayName - User display name (optional)
 * @returns {Promise<Object>} Signup result with user and session
 * @throws {Error} If signup fails
 */
export async function signUp(email, password, displayName = null) {
  try {
    // Step 1: Create Supabase auth user
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName,
        },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      throw new Error(error.message);
    }

    console.log('✅ Supabase signup successful', { user: data.user?.id, hasSession: !!data.session });

    // Step 2: Complete registration in Zoltag backend
    if (data.user) {
      const token = data.session?.access_token;
      console.log('Token available:', !!token);

      if (!token) {
        console.warn('⚠️ No access token in session - likely waiting for email verification');
        return { ...data, needsEmailVerification: true };
      }

      const didRegister = await ensureRegistration(displayName || '', {
        token,
        force: true,
        throwOnError: true,
      });
      if (!didRegister) {
        throw new Error('Registration failed');
      }
      console.log('✅ Registration complete');
    }

    return data;
  } catch (error) {
    console.error('❌ Signup error:', error);
    const originalMessage = String(error?.message || '').trim() || 'Signup failed';
    const mappedMessage = mapRegistrationErrorMessage(originalMessage, email);
    if (mappedMessage !== originalMessage) {
      throw new Error(mappedMessage);
    }
    if (originalMessage.toLowerCase().startsWith('signup failed:')) {
      throw new Error(originalMessage);
    }
    throw new Error(`Signup failed: ${originalMessage}`);
  }
}

/**
 * Sign in with email and password
 *
 * Flow:
 * 1. Authenticate with Supabase Auth
 * 2. Receive JWT access token and refresh token
 * 3. Token is stored in localStorage by Supabase client
 *
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<Object>} Login result with user and session
 * @throws {Error} If login fails
 */
export async function signIn(email, password) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw new Error(error.message);
    }

    if (data?.session?.access_token) {
      const didRegister = await ensureRegistration(
        data.user?.user_metadata?.display_name || '',
        { token: data.session.access_token, throwOnError: true }
      );
      if (!didRegister) {
        console.warn('Sign in completed but registration ensure did not confirm success');
      }
    }

    return data;
  } catch (error) {
    const originalMessage = String(error?.message || '').trim() || 'Sign in failed';
    const mappedMessage = mapRegistrationErrorMessage(originalMessage, email);
    if (mappedMessage !== originalMessage) {
      throw new Error(mappedMessage);
    }
    if (originalMessage.toLowerCase().startsWith('sign in failed:')) {
      throw new Error(originalMessage);
    }
    throw new Error(`Sign in failed: ${originalMessage}`);
  }
}

/**
 * Ensure a user_profile exists for the current Supabase session.
 * Safe to call multiple times.
 */
export async function ensureRegistration(
  displayName = '',
  { token = null, force = false, throwOnError = false } = {},
) {
  try {
    const accessToken = token || await getAccessToken();
    if (!accessToken) {
      return false;
    }
    const subject = decodeJwtSubject(accessToken) || 'unknown';
    const successKey = getStorageKey(REGISTER_SUCCESS_STORAGE_PREFIX, subject);
    const lockKey = getStorageKey(REGISTER_LOCK_STORAGE_PREFIX, subject);

    const isRecentSuccessForToken = (
      !force
      && lastRegisterSuccessToken === accessToken
      && (Date.now() - lastRegisterSuccessAt) < REGISTER_SUCCESS_CACHE_MS
    );
    if (isRecentSuccessForToken) {
      return true;
    }

    const sharedSuccessAt = readStorageNumber(successKey);
    const isRecentSharedSuccess = sharedSuccessAt > 0
      && (Date.now() - sharedSuccessAt) < REGISTER_SUCCESS_CACHE_MS;
    if (isRecentSharedSuccess) {
      lastRegisterSuccessToken = accessToken;
      lastRegisterSuccessAt = sharedSuccessAt;
      return true;
    }

    if (registerInFlight && registerInFlightToken === accessToken) {
      return await registerInFlight;
    }

    let ownsCrossTabLock = tryAcquireRegisterLock(lockKey, REGISTER_LOCK_OWNER);
    if (!ownsCrossTabLock) {
      const completedByOtherTab = await waitForRegisterCompletion(successKey, lockKey);
      if (completedByOtherTab) {
        lastRegisterSuccessToken = accessToken;
        lastRegisterSuccessAt = Date.now();
        return true;
      }
      ownsCrossTabLock = tryAcquireRegisterLock(lockKey, REGISTER_LOCK_OWNER);
      if (!ownsCrossTabLock) {
        return false;
      }
    }

    registerInFlightToken = accessToken;
    registerInFlight = postRegister(accessToken, displayName)
      .then((result) => {
        if (result) {
          writeStorageNumber(successKey, Date.now());
        }
        return result;
      })
      .finally(() => {
        releaseRegisterLock(lockKey, REGISTER_LOCK_OWNER);
        if (registerInFlightToken === accessToken) {
          registerInFlight = null;
          registerInFlightToken = null;
        }
      });

    return await registerInFlight;
  } catch (error) {
    console.error('Registration ensure failed:', error.message);
    if (throwOnError) {
      throw error;
    }
    return false;
  }
}

/**
 * Sign in with magic link (passwordless email OTP)
 *
 * Supabase sends a one-time link to the email address. The user clicks it
 * and is redirected to /auth/callback where the session is established.
 * No password or account creation step required.
 *
 * @param {string} email - User email address
 * @returns {Promise<void>}
 * @throws {Error} If the request fails
 */
export async function signInWithMagicLink(email) {
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      throw new Error(error.message);
    }
  } catch (error) {
    throw new Error(`Magic link failed: ${error.message}`);
  }
}

/**
 * Verify a 6-digit OTP code sent via magic link email
 *
 * @param {string} email - The email address the code was sent to
 * @param {string} token - The 6-digit OTP code
 * @returns {Promise<void>}
 * @throws {Error} If verification fails
 */
export async function verifyOtpCode(email, token) {
  try {
    const { error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    });
    if (error) throw new Error(error.message);
  } catch (error) {
    throw new Error(`Code verification failed: ${error.message}`);
  }
}

/**
 * Sign in with Google OAuth
 *
 * Flow:
 * 1. Open Google consent screen
 * 2. User authorizes Zoltag
 * 3. Redirects back to VITE_SUPABASE_REDIRECT_TO or window.location.origin/auth/callback
 * 4. Supabase completes session setup
 *
 * @returns {Promise<Object>} OAuth result
 * @throws {Error} If OAuth fails
 */
export async function signInWithGoogle() {
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      throw new Error(error.message);
    }

    return data;
  } catch (error) {
    throw new Error(`Google sign in failed: ${error.message}`);
  }
}

/**
 * Get current user info from Zoltag backend
 *
 * This is different from supabase.auth.getUser() which only returns
 * identity information. This returns Zoltag-specific data:
 * - User approval status (is_active)
 * - Tenant memberships and roles
 * - Tenant access list
 *
 * @returns {Promise<Object>} User profile and tenant list
 * @throws {Error} If user is not authenticated or not approved
 */
export async function getCurrentUser({ force = false } = {}) {
  try {
    const response = await queryRequest(
      ['auth', 'me'],
      () => fetchWithAuth('/auth/me'),
      { staleTimeMs: 30000, force }
    );
    return response;
  } catch (error) {
    throw new Error(`Failed to get user info: ${error.message}`);
  }
}

/**
 * Accept an invitation to join a tenant
 *
 * Flow:
 * 1. User clicks invitation link (token in URL params)
 * 2. Call this endpoint with the token
 * 3. Backend verifies token and user email
 * 4. User account is activated (is_active=TRUE)
 * 5. User is added to the tenant with specified role
 * 6. Invitation is marked as accepted
 *
 * @param {string} token - Invitation token from email link
 * @returns {Promise<Object>} Updated user profile and tenant list
 * @throws {Error} If invitation is invalid or expired
 */
export async function acceptInvitation(token) {
  try {
    const response = await fetchWithAuth('/auth/accept-invitation', {
      method: 'POST',
      body: JSON.stringify({ invitation_token: token }),
    });
    invalidateQueries(['auth', 'me']);
    invalidateQueries(['tenants']);
    return response;
  } catch (error) {
    throw new Error(`Failed to accept invitation: ${error.message}`);
  }
}

/**
 * Check if user is authenticated
 *
 * Simply checks if an access token exists. Does not verify the token
 * with the backend. Use getCurrentUser() for full verification.
 *
 * @returns {Promise<boolean>} True if access token exists
 */
export async function isAuthenticated() {
  const token = await getAccessToken();
  return !!token;
}

/**
 * Verify user is approved and can access Zoltag
 *
 * Calls backend to verify:
 * 1. User profile exists
 * 2. User is_active=TRUE (approved)
 * 3. User has at least one tenant
 *
 * @returns {Promise<boolean>} True if user is verified and approved
 */
export async function isVerified() {
  try {
    const user = await getCurrentUser();
    const verified = !!(user && user.user && user.user.is_active);
    return {
      verified,
      reason: verified ? 'approved' : 'pending_approval',
      message: verified ? '' : 'Your account is awaiting admin approval. Please check back soon!',
    };
  } catch (error) {
    const message = String(error?.message || '');
    const normalized = message.toLowerCase();
    const missingProfile = message.includes('User profile not found')
      || normalized.includes('complete registration');

    // Only attempt auto-registration when backend explicitly says profile is missing.
    if (!missingProfile) {
      if (normalized.includes('pending admin approval')) {
        return {
          verified: false,
          reason: 'pending_approval',
          message: 'Your account is awaiting admin approval. Please check back soon!',
        };
      }
      return {
        verified: false,
        reason: 'error',
        message: message || 'Unable to verify account status.',
      };
    }

    try {
      const didRegister = await ensureRegistration('', { force: true, throwOnError: true });
      if (!didRegister) {
        return {
          verified: false,
          reason: 'error',
          message: 'Unable to complete account registration.',
        };
      }

      const user = await getCurrentUser({ force: true });
      const verified = !!(user && user.user && user.user.is_active);
      return {
        verified,
        reason: verified ? 'approved' : 'pending_approval',
        message: verified ? '' : 'Your account is awaiting admin approval. Please check back soon!',
      };
    } catch (registrationError) {
      const registrationMessage = String(registrationError?.message || '');
      if (isInvitationRequiredRegistrationError(registrationMessage)) {
        const session = await getSession();
        const email = String(session?.user?.email || '').trim();
        return {
          verified: false,
          reason: 'no_account',
          message: noAccountFoundMessage(email),
        };
      }
      return {
        verified: false,
        reason: 'error',
        message: registrationMessage || 'Unable to verify account status.',
      };
    }
  }
}
