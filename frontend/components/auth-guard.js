import { LitElement, html, css } from 'lit';
import { onAuthStateChange, getSession } from '../services/supabase.js';
import { isVerified, ensureRegistration } from '../services/auth.js';

/**
 * Authentication guard component
 *
 * Wraps the main app and ensures user is authenticated and approved
 * before allowing access. Redirects to login if not authenticated.
 *
 * Usage:
 *   <auth-guard>
 *     <zoltag-app></zoltag-app>
 *   </auth-guard>
 */
export class AuthGuard extends LitElement {
  static properties = {
    authenticated: { type: Boolean },
    verified: { type: Boolean },
    loading: { type: Boolean },
  };

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    .loading-screen {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .loading-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 28px 36px;
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 16px;
      backdrop-filter: blur(6px);
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.18);
    }

    .loading-title {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: 0.02em;
      color: white;
    }

    .spinner {
      text-align: center;
      color: white;
    }

    .spinner-animation {
      width: 50px;
      height: 50px;
      margin: 0 auto 1rem;
      border: 4px solid rgba(255, 255, 255, 0.3);
      border-top: 4px solid white;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      0% {
        transform: rotate(0deg);
      }
      100% {
        transform: rotate(360deg);
      }
    }

    .loading-text {
      font-size: 14px;
      opacity: 0.9;
      margin-top: 4px;
    }

    .error-screen {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: white;
    }

    .error-message {
      text-align: center;
      max-width: 400px;
      padding: 2rem;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 12px;
    }

    .error-message h1 {
      margin: 0 0 1rem 0;
      font-size: 24px;
    }

    .error-message p {
      margin: 0 0 1rem 0;
      font-size: 14px;
      opacity: 0.9;
    }

    .error-message a {
      display: inline-block;
      margin-top: 1rem;
      padding: 0.75rem 1.5rem;
      background: white;
      color: #667eea;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
      transition: all 0.2s;
    }

    .error-message a:hover {
      background: #f5f5f5;
    }
  `;

  constructor() {
    super();
    this.authenticated = false;
    this.verified = false;
    this.loading = true;
  }

  async connectedCallback() {
    super.connectedCallback();

    // Check initial authentication state
    const session = await getSession();
    this.authenticated = !!session;

    if (this.authenticated) {
      await ensureRegistration(session?.user?.user_metadata?.display_name || '');
      // Check if user is approved
      this.verified = await isVerified();
    }

    this.loading = false;

    // Listen for future auth changes
    this.authSubscription = onAuthStateChange((event, session) => {
      this.authenticated = !!session;

      if (event === 'SIGNED_OUT') {
        // Redirect to login on logout
        window.location.href = '/login';
      } else if (event === 'SIGNED_IN') {
        // Verify approval status on signin
        ensureRegistration(session?.user?.user_metadata?.display_name || '')
          .then(() => isVerified())
          .then((verified) => {
            this.verified = verified;
          });
      }
    });

    // Redirect to login if not authenticated (do this AFTER setting loading = false)
    if (!this.authenticated) {
      window.location.href = '/login';
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.authSubscription) {
      this.authSubscription.unsubscribe();
    }
  }

  render() {
    // Still loading
    if (this.loading) {
      return html`
        <div class="loading-screen">
          <div class="loading-card">
            <div class="loading-title">Zoltag</div>
            <div class="spinner">
              <div class="spinner-animation"></div>
              <div class="loading-text">Loading workspace...</div>
            </div>
          </div>
        </div>
      `;
    }

    // Not authenticated
    if (!this.authenticated) {
      return html`
        <div class="loading-screen">
          <div class="loading-card">
            <div class="loading-title">Zoltag</div>
            <div class="spinner">
              <div class="loading-text">Redirecting to login...</div>
            </div>
          </div>
        </div>
      `;
    }

    // Not approved
    if (!this.verified) {
      return html`
        <div class="error-screen">
          <div class="error-message">
            <h1>Account Pending Approval</h1>
            <p>Your account is awaiting admin approval. Please check back soon!</p>
            <a href="#" @click=${() => window.location.href = '/logout'}>Sign Out</a>
          </div>
        </div>
      `;
    }

    // Authenticated and approved - show the app
    return html`<slot></slot>`;
  }
}

customElements.define('auth-guard', AuthGuard);
