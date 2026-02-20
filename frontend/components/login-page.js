import { LitElement, html, css } from 'lit';
import { signInWithGoogle, signInWithMagicLink, verifyOtpCode, acceptInvitation, ensureRegistration } from '../services/auth.js';

const INVITATION_TOKEN_KEY = 'zoltag_invitation_token';

/**
 * Login page component
 *
 * Provides Google OAuth and magic link (passwordless email) login.
 * No password or self-registration — users are invited by admins.
 */
export class LoginPage extends LitElement {
  static properties = {
    email: { type: String },
    error: { type: String },
    success: { type: String },
    loading: { type: Boolean },
    invitationToken: { type: String },
    otpCode: { type: String },
    otpSent: { type: Boolean },
  };

  static styles = css`
    :host {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .login-card {
      background: white;
      border-radius: 12px;
      padding: 2rem;
      width: 100%;
      max-width: 400px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
    }

    h1 {
      margin: 0 0 0.25rem 0;
      text-align: center;
      color: #333;
      font-size: 28px;
    }

    .subtitle {
      text-align: center;
      color: #999;
      font-size: 14px;
      margin-bottom: 1.5rem;
    }

    .form-group {
      margin-bottom: 1rem;
    }

    label {
      display: block;
      margin-bottom: 0.5rem;
      color: #555;
      font-weight: 500;
      font-size: 14px;
    }

    input {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 1rem;
      box-sizing: border-box;
      transition: border-color 0.2s;
    }

    input:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }

    input.otp-input {
      font-size: 1.5rem;
      letter-spacing: 0.4em;
      text-align: center;
    }

    button {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      background: white;
      color: #333;
    }

    button:hover:not(:disabled) {
      background: #f5f5f5;
      border-color: #999;
    }

    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .btn-submit {
      background: #667eea;
      color: white;
      border: none;
      margin-top: 0.5rem;
    }

    .btn-submit:hover:not(:disabled) {
      background: #5568d3;
      border: none;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
    }

    .error {
      background: #fee;
      color: #c33;
      padding: 0.75rem;
      border-radius: 6px;
      margin-bottom: 1rem;
      text-align: center;
      font-size: 14px;
    }

    .success {
      background: #eff6ff;
      color: #1d4ed8;
      padding: 0.75rem;
      border-radius: 6px;
      margin-bottom: 1rem;
      text-align: center;
      font-size: 14px;
    }

    .divider {
      text-align: center;
      margin: 0.75rem 0;
      color: #999;
      position: relative;
      font-size: 14px;
    }

    .divider::before,
    .divider::after {
      content: '';
      position: absolute;
      top: 50%;
      width: 40%;
      height: 1px;
      background: #ddd;
    }

    .divider::before { left: 0; }
    .divider::after { right: 0; }

    .email-accordion {
      margin-top: 0;
    }

    .email-accordion summary {
      list-style: none;
      display: block;
      width: 100%;
      box-sizing: border-box;
      cursor: pointer;
      padding: 0.75rem;
      border: 1px solid #ddd;
      border-radius: 6px;
      color: #333;
      font-size: 1rem;
      font-weight: 600;
      text-align: center;
      background: white;
      user-select: none;
      transition: all 0.2s;
    }

    .email-accordion summary::-webkit-details-marker {
      display: none;
    }

    .email-accordion summary:hover {
      background: #f5f5f5;
      border-color: #999;
    }

    .email-accordion[open] summary {
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
    }

    .email-accordion-content {
      border: 1px solid #ddd;
      border-top: none;
      border-bottom-left-radius: 6px;
      border-bottom-right-radius: 6px;
      padding: 1rem 0.9rem 0.75rem 0.9rem;
      background: #fff;
    }

    .otp-hint {
      font-size: 12px;
      color: #999;
      text-align: center;
      margin-top: 0.5rem;
    }
  `;

  constructor() {
    super();
    this.email = '';
    this.error = '';
    this.success = '';
    this.loading = false;
    this.invitationToken = '';
    this.otpCode = '';
    this.otpSent = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this.captureInvitationToken();
  }

  captureInvitationToken() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const token = (params.get('invitation_token') || '').trim();
      if (token) {
        sessionStorage.setItem(INVITATION_TOKEN_KEY, token);
        this.invitationToken = token;
        return;
      }
      this.invitationToken = (sessionStorage.getItem(INVITATION_TOKEN_KEY) || '').trim();
    } catch (_error) {
      this.invitationToken = '';
    }
  }

  async acceptPendingInvitationIfNeeded() {
    const token = (this.invitationToken || '').trim();
    if (!token) return;
    try {
      await acceptInvitation(token);
    } catch (error) {
      console.error('Invitation acceptance failed:', error);
      this.error = `Signed in, but invitation was not applied: ${error.message}`;
    } finally {
      try { sessionStorage.removeItem(INVITATION_TOKEN_KEY); } catch (_) {}
      this.invitationToken = '';
    }
  }

  async handleMagicLink(e) {
    e.preventDefault();
    this.error = '';
    this.success = '';
    this.loading = true;

    try {
      await signInWithMagicLink(this.email);
      this.success = `Check your email — we sent a sign-in link to ${this.email}`;
      this.otpSent = true;
      this.otpCode = '';
    } catch (err) {
      this.error = err.message;
    } finally {
      this.loading = false;
    }
  }

  async handleOtpVerify(e) {
    e.preventDefault();
    this.error = '';
    this.loading = true;

    try {
      await verifyOtpCode(this.email, this.otpCode.trim());
      await ensureRegistration();
      await this.acceptPendingInvitationIfNeeded();
      window.location.href = '/app';
    } catch (err) {
      this.error = err.message;
      this.loading = false;
    }
  }

  async handleGoogleSignIn() {
    this.error = '';
    this.loading = true;

    try {
      this.captureInvitationToken();
      if (this.invitationToken) {
        sessionStorage.setItem(INVITATION_TOKEN_KEY, this.invitationToken);
      }
      await signInWithGoogle();
    } catch (err) {
      this.error = err.message;
      this.loading = false;
    }
  }

  render() {
    return html`
      <div class="login-card">
        <h1>Zoltag</h1>

        ${this.error ? html`<div class="error">${this.error}</div>` : ''}
        ${this.success ? html`<div class="success">${this.success}</div>` : ''}
        ${this.invitationToken ? html`
          <div class="success">
            Invitation detected. Sign in to join your tenant automatically.
          </div>
        ` : ''}

        <button
          @click=${this.handleGoogleSignIn}
          ?disabled=${this.loading}
          type="button"
        >
          <svg style="margin-right:0.5rem;vertical-align:middle" width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/><path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/><path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 6.293C4.672 4.166 6.656 3.58 9 3.58z" fill="#EA4335"/></svg>Continue with Google
        </button>

        <div class="divider">or</div>

        <details class="email-accordion">
          <summary ?disabled=${this.loading}>
            <span style="margin-right:0.5rem">✉️</span>We'll email you an access link
          </summary>
          <div class="email-accordion-content">
            <form @submit=${this.handleMagicLink}>
              <div class="form-group">
                <label for="email">Email address</label>
                <input
                  id="email"
                  type="email"
                  .value=${this.email}
                  @input=${(e) => (this.email = e.target.value)}
                  placeholder="you@example.com"
                  required
                  ?disabled=${this.loading}
                  autocomplete="email"
                />
              </div>
              <button type="submit" class="btn-submit" ?disabled=${this.loading || !this.email}>
                ${this.loading && !this.otpSent ? 'Sending...' : 'Send access link'}
              </button>
            </form>

            ${this.otpSent ? html`
              <div class="divider" style="margin: 1rem 0 0.75rem">or enter the code</div>
              <form @submit=${this.handleOtpVerify}>
                <div class="form-group">
                  <input
                    class="otp-input"
                    type="text"
                    inputmode="numeric"
                    maxlength="8"
                    .value=${this.otpCode}
                    @input=${(e) => (this.otpCode = e.target.value.replace(/\D/g, ''))}
                    placeholder="00000000"
                    ?disabled=${this.loading}
                    autocomplete="one-time-code"
                  />
                </div>
                <button type="submit" class="btn-submit" ?disabled=${this.loading || this.otpCode.length < 6}>
                  ${this.loading ? 'Verifying...' : 'Sign in with code'}
                </button>
              </form>
              <p class="otp-hint">Check your email for the code</p>
            ` : ''}
          </div>
        </details>

        <button
          @click=${() => { window.location.href = '/'; }}
          type="button"
          style="margin-top: 1rem; background: none; border: none; color: #999; font-size: 13px; font-weight: 400; cursor: pointer; width: 100%;"
        >← Go back</button>
      </div>
    `;
  }
}

customElements.define('login-page', LoginPage);
