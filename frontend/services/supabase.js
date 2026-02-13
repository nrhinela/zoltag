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

// Validate environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)');
}

/**
 * Supabase client instance
 * Handles authentication and API calls to Supabase
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Auto-refresh access tokens before expiry
    autoRefreshToken: true,
    // Persist session to localStorage
    persistSession: true,
    // Detect OAuth redirects in URL
    detectSessionInUrl: true,
    // Use localStorage for token persistence
    storage: window.localStorage,
  },
});

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
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      console.error('Error getting session:', error);
      return null;
    }
    return session;
  } catch (err) {
    console.error('Error getting session:', err);
    return null;
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
