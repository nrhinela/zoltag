/**
 * PhotoCat authentication service
 *
 * Handles user authentication flows:
 * - Email/password signup and login
 * - Google OAuth login
 * - User profile completion
 * - Invitation acceptance
 * - Logout
 *
 * Integrates Supabase Auth (identity) with PhotoCat backend (authorization).
 */

import { supabase, getAccessToken } from './supabase.js';
import { fetchWithAuth } from './api.js';
import { cachedRequest } from './request-cache.js';

/**
 * Sign up with email and password
 *
 * Flow:
 * 1. Create account in Supabase Auth
 * 2. Complete registration in PhotoCat backend
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
        // emailRedirectTo: `${window.location.origin}/auth/verify-email`,
      },
    });

    if (error) {
      throw new Error(error.message);
    }

    console.log('✅ Supabase signup successful', { user: data.user?.id, hasSession: !!data.session });

    // Step 2: Complete registration in PhotoCat backend
    if (data.user) {
      const token = data.session?.access_token;
      console.log('Token available:', !!token);

      if (!token) {
        console.error('❌ No access token in session - cannot complete registration');
        throw new Error('No access token - Supabase session not established');
      }

      try {
        console.log('Calling /api/v1/auth/register with token...');
        const response = await fetch('/api/v1/auth/register', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ display_name: displayName }),
        });

        console.log('Register response:', { status: response.status, ok: response.ok });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ detail: 'Registration failed' }));
          console.error('Registration error response:', errorData);
          throw new Error(`Registration failed: ${errorData.detail || 'Unknown error'}`);
        }

        const result = await response.json();
        console.log('✅ Registration complete:', result);
      } catch (registrationError) {
        console.error('❌ Registration error:', registrationError.message);
        throw registrationError;
      }
    }

    return data;
  } catch (error) {
    console.error('❌ Signup error:', error);
    throw new Error(`Signup failed: ${error.message}`);
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

    return data;
  } catch (error) {
    throw new Error(`Sign in failed: ${error.message}`);
  }
}

/**
 * Sign in with Google OAuth
 *
 * Flow:
 * 1. Open Google consent screen
 * 2. User authorizes PhotoCat
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
 * Get current user info from PhotoCat backend
 *
 * This is different from supabase.auth.getUser() which only returns
 * identity information. This returns PhotoCat-specific data:
 * - User approval status (is_active)
 * - Tenant memberships and roles
 * - Tenant access list
 *
 * @returns {Promise<Object>} User profile and tenant list
 * @throws {Error} If user is not authenticated or not approved
 */
export async function getCurrentUser({ force = false } = {}) {
  try {
    const response = await cachedRequest(
      'auth:me',
      () => fetchWithAuth('/auth/me'),
      { ttlMs: 30000, force }
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
 * Verify user is approved and can access PhotoCat
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
    return user && user.user && user.user.is_active;
  } catch {
    return false;
  }
}
