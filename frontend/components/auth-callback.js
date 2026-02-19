import { LitElement, html, css } from 'lit';
import { getSession, onAuthStateChange } from '../services/supabase.js';
import { acceptInvitation, ensureRegistration } from '../services/auth.js';

const INVITATION_TOKEN_KEY = 'zoltag_invitation_token';

function invitationMissingAccountMessage(email) {
  const normalizedEmail = String(email || '').trim();
  if (!normalizedEmail) return 'No account found for this email';
  return `No account found for ${normalizedEmail}`;
}

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

  async waitForSession(timeoutMs = 15000, pollMs = 250) {
    const existingSession = await getSession();
    if (existingSession?.access_token) {
      return existingSession;
    }

    return await new Promise((resolve, reject) => {
      const startedAt = Date.now();
      let settled = false;
      let subscription = null;

      const cleanup = () => {
        if (subscription) {
          subscription.unsubscribe();
          subscription = null;
        }
      };

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn(value);
      };

      const pollForSession = async () => {
        try {
          const session = await getSession();
          if (session?.access_token) {
            finish(resolve, session);
            return;
          }
        } catch (_error) {
          // Keep waiting until timeout.
        }

        if (Date.now() - startedAt >= timeoutMs) {
          finish(reject, new Error('Timed out waiting for OAuth session. Please try again.'));
          return;
        }

        setTimeout(pollForSession, pollMs);
      };

      const authListener = onAuthStateChange((_event, session) => {
        if (session?.access_token) {
          finish(resolve, session);
        }
      });
      subscription = authListener?.data?.subscription || null;

      pollForSession();
    });
  }

  async handleCallback() {
    let attemptedEmail = '';
    try {
      console.log('🔄 Auth callback: Waiting for Supabase to process OAuth...');

      const searchParams = new URLSearchParams(window.location.search || '');
      const hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
      const oauthError = searchParams.get('error_description')
        || searchParams.get('error')
        || hashParams.get('error_description')
        || hashParams.get('error');
      if (oauthError) {
        throw new Error(oauthError);
      }

      const session = await this.waitForSession();
      console.log('Session available:', !!session);
      attemptedEmail = String(session?.user?.email || '').trim();

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
      const didRegister = await ensureRegistration(
        session.user?.user_metadata?.name || '',
        { token, force: true, throwOnError: true }
      );
      if (!didRegister) {
        throw new Error('Registration failed');
      }
      console.log('✅ Registration complete');

      let invitationToken = '';
      try {
        const params = new URLSearchParams(window.location.search || '');
        invitationToken = (params.get('invitation_token')
          || sessionStorage.getItem(INVITATION_TOKEN_KEY)
          || '').trim();
      } catch (_error) {
        invitationToken = '';
      }

      if (invitationToken) {
        this.message = 'Applying tenant invitation...';
        try {
          await acceptInvitation(invitationToken);
        } catch (inviteError) {
          console.error('Invitation acceptance failed after OAuth:', inviteError);
          // Non-fatal: keep user signed in even if invitation token is stale/invalid.
        }
        try {
          sessionStorage.removeItem(INVITATION_TOKEN_KEY);
        } catch (_error) {
          // no-op
        }
      }

      // Registration successful - redirect to home
      this.message = 'Login successful! Redirecting...';
      setTimeout(() => {
        window.location.href = '/app';
      }, 1500);
    } catch (error) {
      const rawMessage = String(error?.message || '').trim();
      const mappedMessage = rawMessage.toLowerCase().includes('invitation required before registration')
        ? invitationMissingAccountMessage(attemptedEmail)
        : rawMessage || 'Login failed';
      console.error('❌ OAuth callback error:', mappedMessage);
      this.error = mappedMessage;
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
