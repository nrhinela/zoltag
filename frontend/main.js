import './styles.css';

// Import all page components
import './components/login-page.js';
import './components/signup-page.js';
import './components/auth-callback.js';
import './components/auth-guard.js';
import './components/photocat-app.js';
import './components/public-story-page.js';

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

// Get the app container
const appContainer = document.getElementById('app');

// Route based on path
if (path === '/login') {
  appContainer.innerHTML = '<login-page></login-page>';
} else if (path === '/signup') {
  appContainer.innerHTML = '<signup-page></signup-page>';
} else if (path === '/auth/callback') {
  appContainer.innerHTML = '<auth-callback></auth-callback>';
} else if (path === '/' || path === '/story') {
  appContainer.innerHTML = '<public-story-page></public-story-page>';
} else if (path === '/app') {
  appContainer.innerHTML = `
    <auth-guard>
      <photocat-app></photocat-app>
    </auth-guard>
  `;
} else {
  // All other routes require authentication
  appContainer.innerHTML = `
    <auth-guard>
      <photocat-app></photocat-app>
    </auth-guard>
  `;
}
