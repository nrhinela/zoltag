/**
 * Supabase client initialization and utility functions.
 *
 * This module provides a singleton Supabase client configured for Zoltag.
 * It handles:
 * - User authentication (signup, login, OAuth)
 * - Session management and token refresh
 * - Real-time auth state changes
 */

import { createClient } from '@supabase/supabase-js';
import {
  APP_AUTH_STORAGE_KEY,
  GUEST_AUTH_STORAGE_KEY,
  migrateLocalStorageKey,
} from './app-storage.js';

// Validate environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)');
}

function createZoltagClient(storageKey, detectSessionInUrl) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      // Auto-refresh access tokens before expiry
      autoRefreshToken: true,
      // Persist session to localStorage
      persistSession: true,
      // Detect OAuth redirects in URL
      detectSessionInUrl,
      // Use localStorage for token persistence
      storage: window.localStorage,
      // Separate auth storage so /guest doesn't overwrite /app session.
      storageKey,
    },
  });
}

function isGuestRoute() {
  if (typeof window === 'undefined') return false;
  return window.location.pathname.startsWith('/guest');
}

const guestRoute = isGuestRoute();
if (guestRoute) {
  migrateLocalStorageKey(GUEST_AUTH_STORAGE_KEY, ['zoltag-auth-guest']);
} else {
  migrateLocalStorageKey(APP_AUTH_STORAGE_KEY, ['zoltag-auth-app']);
}
const activeStorageKey = guestRoute ? GUEST_AUTH_STORAGE_KEY : APP_AUTH_STORAGE_KEY;
const activeSupabaseClient = guestRoute
  ? createZoltagClient(GUEST_AUTH_STORAGE_KEY, true)
  : createZoltagClient(APP_AUTH_STORAGE_KEY, true);

/**
 * Active Supabase client for current route context.
 * - /guest => guest storage key
 * - all other routes => app storage key
 */
export const supabase = activeSupabaseClient;

function readSessionFromStorage() {
  try {
    const raw = window.localStorage.getItem(activeStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Supabase may persist either the session directly or under currentSession.
    const candidate = parsed?.access_token ? parsed : parsed?.currentSession;
    if (!candidate?.access_token) return null;
    return candidate;
  } catch (_err) {
    return null;
  }
}

/**
 * Get current user session from Supabase Auth
 *
 * Returns the active session if one exists, including:
 * - access_token: JWT token for API requests
 * - refresh_token: Token to refresh access token
 * - user: User object with email, id (supabase_uid), etc.
 *
 * @returns {Promise<Object|null>} Session object or null if not authenticated
 */
export async function getSession() {
  const timeoutMs = 1200;
  let timeoutId = null;
  try {
    const timeoutPromise = new Promise((resolve) => {
      timeoutId = window.setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    });
    const sessionPromise = (async () => {
      const result = await supabase.auth.getSession();
      return { timedOut: false, result };
    })();

    const raced = await Promise.race([sessionPromise, timeoutPromise]);

    if (raced?.timedOut) {
      return readSessionFromStorage();
    }

    const { data: { session }, error } = raced.result;
    if (error) {
      console.error('Error getting session:', error);
      return readSessionFromStorage();
    }
    return session || readSessionFromStorage();
  } catch (err) {
    console.error('Error getting session:', err);
    return readSessionFromStorage();
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
}

/**
 * Get current access token for API requests
 *
 * The access token is sent in the Authorization header as:
 * Authorization: Bearer <access_token>
 *
 * Tokens expire in 1 hour. The Supabase client automatically refreshes
 * them using the refresh token before expiry.
 *
 * @returns {Promise<string|null>} Access token or null if not authenticated
 */
export async function getAccessToken() {
  const session = await getSession();
  return session?.access_token || null;
}

/**
 * Get current authenticated user
 *
 * Returns the user object from the current session, which includes:
 * - id: Supabase UID (UUID)
 * - email: User email address
 * - user_metadata: Additional user data from signup
 *
 * @returns {Promise<Object|null>} User object or null if not authenticated
 */
export async function getCurrentUser() {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) {
      console.error('Error getting user:', error);
      return null;
    }
    return user;
  } catch (err) {
    console.error('Error getting user:', err);
    return null;
  }
}

/**
 * Listen for authentication state changes
 *
 * The callback is called whenever:
 * - User signs in (event: 'SIGNED_IN')
 * - User signs out (event: 'SIGNED_OUT')
 * - Session is refreshed (event: 'TOKEN_REFRESHED')
 * - User updates profile (event: 'USER_UPDATED')
 *
 * @param {Function} callback - Function called with (event, session)
 * @returns {Function} Unsubscribe function to stop listening
 *
 * @example
 * const unsubscribe = onAuthStateChange((event, session) => {
 *   if (event === 'SIGNED_IN') {
 *     console.log('User signed in:', session.user.email);
 *   }
 * });
 * // Later: unsubscribe() to stop listening
 */
export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange(callback);
}

/**
 * Sign out the current user
 *
 * This:
 * - Invalidates the user's session
 * - Clears tokens from localStorage
 * - Triggers SIGNED_OUT event
 *
 * @returns {Promise<void>}
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw new Error(error.message);
  }
}
