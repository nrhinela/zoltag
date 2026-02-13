import { LitElement, html, css } from 'lit';
import { signUp, signInWithGoogle } from '../services/auth.js';

const INVITATION_TOKEN_KEY = 'zoltag_invitation_token';

/**
 * Signup page component
 *
 * Provides email/password signup and Google OAuth options.
 * After successful signup, account requires admin approval before access.
 */
export class SignupPage extends LitElement {
  static properties = {
    email: { type: String },
    password: { type: String },
    confirmPassword: { type: String },
    displayName: { type: String },
    error: { type: String },
    success: { type: String },
    loading: { type: Boolean },
    invitationToken: { type: String },
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

    .signup-card {
      background: white;
      border-radius: 12px;
      padding: 2rem;
      width: 100%;
      max-width: 400px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
    }

    h1 {
      margin: 0 0 0.5rem 0;
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

    button {
      width: 100%;
      padding: 0.75rem;
      border: none;
      border-radius: 6px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-primary {
      background: #667eea;
      color: white;
      margin-bottom: 0.75rem;
    }

    .btn-primary:hover:not(:disabled) {
      background: #5568d3;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
    }

    .btn-google {
      background: white;
      color: #333;
      border: 1px solid #ddd;
    }

    .btn-google:hover:not(:disabled) {
      background: #f5f5f5;
      border-color: #999;
    }

    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
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
      background: #efe;
      color: #3c3;
      padding: 0.75rem;
      border-radius: 6px;
      margin-bottom: 1rem;
      text-align: center;
      font-size: 14px;
    }

    .divider {
      text-align: center;
      margin: 1.5rem 0;
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

    .divider::before {
      left: 0;
    }

    .divider::after {
      right: 0;
    }

    .login-link {
      text-align: center;
      margin-top: 1.5rem;
      color: #666;
      font-size: 14px;
    }

    .login-link a {
      color: #667eea;
      text-decoration: none;
      font-weight: 600;
    }

    .login-link a:hover {
      text-decoration: underline;
    }

    .password-hint {
      font-size: 12px;
      color: #999;
      margin-top: 0.25rem;
    }
  `;

  constructor() {
    super();
    this.email = '';
    this.password = '';
    this.confirmPassword = '';
    this.displayName = '';
    this.error = '';
    this.success = '';
    this.loading = false;
    this.invitationToken = '';
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

  validatePasswords() {
    if (this.password !== this.confirmPassword) {
      this.error = 'Passwords do not match';
      return false;
    }
    if (this.password.length < 8) {
      this.error = 'Password must be at least 8 characters';
      return false;
    }
    return true;
  }

  async handleSubmit(e) {
    e.preventDefault();
    this.error = '';
    this.success = '';
    this.loading = true;

    if (!this.validatePasswords()) {
      this.loading = false;
      return;
    }

    try {
      const result = await signUp(this.email, this.password, this.displayName);
      if (result?.needsEmailVerification) {
        this.success = 'Check your email to verify your account, then sign in. Approval may still be required.';
        this.loading = false;
        return;
      }
      this.success = 'Account created! Awaiting admin approval.';
      this.email = '';
      this.password = '';
      this.confirmPassword = '';
      this.displayName = '';

      // Redirect to login after 2 seconds
      const inviteParam = this.invitationToken
        ? `?invitation_token=${encodeURIComponent(this.invitationToken)}`
        : '';
      setTimeout(() => {
        window.location.href = `/login${inviteParam}`;
      }, 2000);
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
      // User will be redirected to Google, then back to /auth/callback
    } catch (err) {
      this.error = err.message;
      this.loading = false;
    }
  }

  render() {
    return html`
      <div class="signup-card">
        <h1>Zoltag</h1>
        <p class="subtitle">Create your account</p>
        ${this.invitationToken ? html`
          <div class="success" style="background:#eff6ff;color:#1d4ed8;">
            Invitation detected. Use the same email from your invitation.
          </div>
        ` : ''}

        ${this.error ? html`<div class="error">${this.error}</div>` : ''}
        ${this.success ? html`<div class="success">${this.success}</div>` : ''}

        <form @submit=${this.handleSubmit}>
          <div class="form-group">
            <label for="displayName">Display Name (optional)</label>
            <input
              id="displayName"
              type="text"
              .value=${this.displayName}
              @input=${(e) => (this.displayName = e.target.value)}
              ?disabled=${this.loading}
            />
          </div>

          <div class="form-group">
            <label for="email">Email</label>
            <input
              id="email"
              type="email"
              .value=${this.email}
              @input=${(e) => (this.email = e.target.value)}
              required
              ?disabled=${this.loading}
              autocomplete="email"
            />
          </div>

          <div class="form-group">
            <label for="password">Password</label>
            <input
              id="password"
              type="password"
              .value=${this.password}
              @input=${(e) => (this.password = e.target.value)}
              required
              ?disabled=${this.loading}
              autocomplete="new-password"
            />
            <div class="password-hint">At least 8 characters</div>
          </div>

          <div class="form-group">
            <label for="confirmPassword">Confirm Password</label>
            <input
              id="confirmPassword"
              type="password"
              .value=${this.confirmPassword}
              @input=${(e) => (this.confirmPassword = e.target.value)}
              required
              ?disabled=${this.loading}
              autocomplete="new-password"
            />
          </div>

          <button type="submit" class="btn-primary" ?disabled=${this.loading}>
            ${this.loading ? 'Creating account...' : 'Sign Up'}
          </button>
        </form>

        <div class="divider">OR</div>

        <button
          class="btn-google"
          @click=${this.handleGoogleSignIn}
          ?disabled=${this.loading}
          type="button"
        >
          <span>🔐</span>Continue with Google
        </button>

        <div class="login-link">
          Already have an account? <a href="/login">Sign in</a>
        </div>
      </div>
    `;
  }
}

customElements.define('signup-page', SignupPage);
