import './styles.css';

// Import all page components
import './components/login-page.js';
import './components/signup-page.js';
import './components/auth-callback.js';
import './components/auth-guard.js';
import './components/zoltag-app.js';
import './components/public-story-page.js';
import './components/guest-app.js';

/**
 * Route the user based on current page
 *
 * Auth pages (no auth guard):
 * - /login - Login page
 * - /signup - Sign up page
 * - /auth/callback - OAuth callback
 *
 * Protected pages (with auth guard):
 * - / - Main app (default)
 * - All other routes
 */

// Get the current path and normalize it
let path = window.location.pathname;

// Remove trailing slashes (except for root)
if (path.endsWith('/') && path !== '/') {
  path = path.slice(0, -1);
}

// Check for Supabase auth tokens (invite/magic link)
// If we're on the homepage with auth tokens, redirect to /guest.
const urlParams = new URLSearchParams(window.location.search);
const hashParams = new URLSearchParams(window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '');
const hasAuthTokens =
  urlParams.has('type') ||
  urlParams.has('access_token') ||
  urlParams.has('refresh_token') ||
  hashParams.has('type') ||
  hashParams.has('access_token') ||
  hashParams.has('refresh_token');
const authType = urlParams.get('type');
const hashAuthType = hashParams.get('type');
const isGuestAuthType =
  authType === 'invite' ||
  hashAuthType === 'invite';
const hasGuestTenantHint = urlParams.has('tenant_id') || hashParams.has('tenant_id');

if (path === '/' && hasAuthTokens && isGuestAuthType && hasGuestTenantHint) {
  // Guest auth token landed on root - route to /guest page.
  window.location.href = '/guest' + window.location.search + window.location.hash;
  // Don't render anything, we're redirecting
  throw new Error('Redirecting to /guest');
}

// Get the app container
const appContainer = document.getElementById('app');

// Route based on path
if (path === '/login') {
  appContainer.innerHTML = '<login-page></login-page>';
} else if (path === '/signup') {
  appContainer.innerHTML = '<signup-page></signup-page>';
} else if (path === '/auth/callback') {
  appContainer.innerHTML = '<auth-callback></auth-callback>';
} else if (path === '/guest') {
  // Guest collaboration view (requires guest auth)
  appContainer.innerHTML = '<guest-app></guest-app>';
} else if (path === '/' || path === '/story') {
  appContainer.innerHTML = '<public-story-page></public-story-page>';
} else if (path === '/app') {
  appContainer.innerHTML = `
    <auth-guard>
      <zoltag-app></zoltag-app>
    </auth-guard>
  `;
} else {
  // All other routes require authentication
  appContainer.innerHTML = `
    <auth-guard>
      <zoltag-app></zoltag-app>
    </auth-guard>
  `;
}
