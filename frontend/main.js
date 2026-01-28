import './styles.css';

// Import all page components
import './components/login-page.js';
import './components/signup-page.js';
import './components/auth-guard.js';
import './components/photocat-app.js';

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

// Normalize path (remove trailing slash, keep single leading slash)
let path = window.location.pathname;
if (path.endsWith('/') && path !== '/') {
  path = path.slice(0, -1);
}

const appContainer = document.getElementById('app');

// Debug logging - remove after testing
console.log('Routing:', { path, pathname: window.location.pathname, href: window.location.href });

if (path === '/login') {
  // Show login page without auth guard
  console.log('Route: login');
  appContainer.innerHTML = '<login-page></login-page>';
} else if (path === '/signup') {
  // Show signup page without auth guard
  console.log('Route: signup');
  appContainer.innerHTML = '<signup-page></signup-page>';
} else if (path === '/auth/callback') {
  // OAuth callback - Supabase client handles it
  // Just show loading state until redirect
  console.log('Route: auth callback');
  appContainer.innerHTML = `
    <div style="
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: white;
    ">
      <div style="text-align: center;">
        <div style="
          width: 50px;
          height: 50px;
          margin: 0 auto 1rem;
          border: 4px solid rgba(255, 255, 255, 0.3);
          border-top: 4px solid white;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        "></div>
        <div>Processing login...</div>
      </div>
    </div>
  `;

  // Redirect to home after OAuth is processed
  setTimeout(() => {
    window.location.href = '/';
  }, 1000);
} else {
  // All other routes require authentication
  console.log('Route: protected (auth-guard)');
  appContainer.innerHTML = `
    <auth-guard>
      <photocat-app></photocat-app>
    </auth-guard>
  `;
}