import { LitElement, html, css } from 'lit';
import { getSession } from '../services/supabase.js';

/**
 * OAuth callback handler component
 *
 * Processes the OAuth callback from Supabase, completes user registration,
 * and redirects to the appropriate page.
 */
export class AuthCallback extends LitElement {
  static properties = {
    message: { type: String },
    error: { type: String },
  };

  static styles = css`
    :host {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .container {
      text-align: center;
      color: white;
    }

    .spinner {
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

    .error-message {
      background: rgba(255, 0, 0, 0.2);
      padding: 1rem;
      border-radius: 6px;
      margin-top: 1rem;
    }
  `;

  constructor() {
    super();
    this.message = 'Processing login...';
    this.error = null;
  }

  async connectedCallback() {
    super.connectedCallback();
    await this.handleCallback();
  }

  async handleCallback() {
    try {
      console.log('🔄 Auth callback: Waiting for Supabase to process OAuth...');

      // Wait for Supabase to set the session
      // The callback handler should have already run, so the session should be available
      await new Promise(resolve => setTimeout(resolve, 1000));

      const session = await getSession();
      console.log('Session available:', !!session);

      if (!session) {
        throw new Error('No session after OAuth callback - login may have failed');
      }

      console.log('✅ OAuth session established');

      // Now register the user with our backend
      const token = session.access_token;
      if (!token) {
        throw new Error('No access token in session');
      }

      this.message = 'Completing registration...';
      console.log('Calling /api/v1/auth/register with OAuth token...');

      const response = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ display_name: session.user?.user_metadata?.name || '' }),
      });

      console.log('Register response:', { status: response.status, ok: response.ok });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Registration failed' }));
        console.error('Backend error response:', {
          status: response.status,
          detail: errorData.detail,
          raw: errorData
        });
        throw new Error(`Registration failed (${response.status}): ${errorData.detail}`);
      }

      const result = await response.json();
      console.log('✅ Registration complete:', result);

      // Registration successful - redirect to home
      this.message = 'Login successful! Redirecting...';
      setTimeout(() => {
        window.location.href = '/app';
      }, 1500);
    } catch (error) {
      console.error('❌ OAuth callback error:', error.message);
      this.error = error.message;
      this.message = 'Login failed';
    }
  }

  render() {
    return html`
      <div class="container">
        ${!this.error
          ? html`
              <div class="spinner"></div>
              <div>${this.message}</div>
            `
          : html`
              <div>
                <h1>Login Failed</h1>
                <div class="error-message">${this.error}</div>
                <a href="/login" style="color: white; text-decoration: underline; margin-top: 1rem; display: block;">
                  Back to Login
                </a>
              </div>
            `
        }
      </div>
    `;
  }
}

customElements.define('auth-callback', AuthCallback);
