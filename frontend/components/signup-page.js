import { LitElement, html } from 'lit';

/**
 * Signup page — self-registration is disabled.
 * Users are invited by admins. Redirect to login.
 */
export class SignupPage extends LitElement {
  createRenderRoot() { return this; }

  connectedCallback() {
    super.connectedCallback();
    window.location.replace('/login');
  }

  render() {
    return html``;
  }
}

customElements.define('signup-page', SignupPage);
