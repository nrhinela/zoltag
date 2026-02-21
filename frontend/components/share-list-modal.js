import { LitElement, html } from 'lit';

/**
 * Share List Modal Component
 *
 * Modal for sharing a list with guest users via email invites.
 * Uses Light DOM to inherit Tailwind styles from parent.
 *
 * @property {Boolean} active - Whether modal is visible
 * @property {Object} list - The list being shared (requires id and title)
 * @property {Array} existingShares - Existing shares for this list
 * @property {Boolean} loading - Loading state
 * @property {String} tenantId - Current tenant ID
 *
 * @fires close-modal - When modal is closed
 * @fires share-created - When shares are created successfully
 */
export class ShareListModal extends LitElement {
  // Disable Shadow DOM to use Tailwind classes from parent
  createRenderRoot() {
    return this;
  }

  static properties = {
    active: { type: Boolean },
    list: { type: Object },
    existingShares: { type: Array },
    loading: { type: Boolean },
    tenantId: { type: String },
  };

  constructor() {
    super();
    this.active = false;
    this.list = null;
    this.existingShares = [];
    this.loading = false;
    this.tenantId = null;

    // Form state
    this._emails = '';
    this._allowDownloadThumbs = false;
    this._allowDownloadOriginals = false;
    this._expiresInDays = 30; // default
    this._error = null;
  }

  async _handleSubmit(e) {
    e.preventDefault();
    this._error = null;

    // Parse and validate emails
    const emailStr = this._emails.trim();
    if (!emailStr) {
      this._error = 'Please enter at least one email address';
      this.requestUpdate();
      return;
    }

    const emails = emailStr
      .split(/[\s,\n]+/)
      .map(e => e.trim().toLowerCase())
      .filter(e => e);

    if (emails.length === 0) {
      this._error = 'Please enter at least one valid email address';
      this.requestUpdate();
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = emails.filter(e => !emailRegex.test(e));
    if (invalidEmails.length > 0) {
      this._error = `Invalid email addresses: ${invalidEmails.join(', ')}`;
      this.requestUpdate();
      return;
    }

    this.loading = true;
    this.requestUpdate();

    try {
      const { fetchWithAuth } = await import('../services/api.js');

      const body = {
        emails,
        allow_download_thumbs: this._allowDownloadThumbs,
        allow_download_originals: this._allowDownloadOriginals,
        expires_in_days: this._expiresInDays === 'never' ? null : parseInt(this._expiresInDays),
      };

      const newShares = await fetchWithAuth(`/lists/${this.list.id}/shares`, {
        method: 'POST',
        body: JSON.stringify(body),
        tenantId: this.tenantId,
      });

      // Emit success event
      this.dispatchEvent(new CustomEvent('share-created', {
        detail: { shares: newShares },
        bubbles: true,
        composed: true,
      }));

      // Reset form
      this._emails = '';
      this._error = null;

      // Reload existing shares
      await this._loadExistingShares();

    } catch (error) {
      console.error('Failed to create shares:', error);
      this._error = error.message || 'Failed to send invitations';
    } finally {
      this.loading = false;
      this.requestUpdate();
    }
  }

  async _loadExistingShares() {
    if (!this.list?.id || !this.tenantId) return;

    try {
      const { fetchWithAuth } = await import('../services/api.js');
      const shares = await fetchWithAuth(`/lists/${this.list.id}/shares`, {
        method: 'GET',
        tenantId: this.tenantId,
      });
      this.existingShares = shares || [];
      this.requestUpdate();
    } catch (error) {
      console.error('Failed to load shares:', error);
    }
  }

  async _handleRevokeShare(shareId) {
    if (!confirm('Are you sure you want to revoke this share? The guest will no longer be able to access this list.')) {
      return;
    }

    this.loading = true;
    this.requestUpdate();

    try {
      const { fetchWithAuth } = await import('../services/api.js');
      await fetchWithAuth(`/lists/${this.list.id}/shares/${shareId}`, {
        method: 'DELETE',
        tenantId: this.tenantId,
      });

      await this._loadExistingShares();
    } catch (error) {
      console.error('Failed to revoke share:', error);
      this._error = error.message || 'Failed to revoke share';
    } finally {
      this.loading = false;
      this.requestUpdate();
    }
  }

  _handleClose() {
    this.dispatchEvent(new CustomEvent('close-modal', {
      bubbles: true,
      composed: true,
    }));
  }

  _formatExpiryDate(expiresAt) {
    if (!expiresAt) return 'Never';
    const date = new Date(expiresAt);
    return date.toLocaleDateString();
  }

  updated(changedProperties) {
    // Load shares when modal opens or list changes
    if (changedProperties.has('active') && this.active) {
      this._loadExistingShares();
    }
  }

  render() {
    if (!this.active || !this.list) {
      return html``;
    }

    return html`
      <div
        class="fixed inset-0 z-50 overflow-y-auto bg-black bg-opacity-50 p-4 sm:p-6"
        @click=${this._handleClose}
      >
        <div
          class="mx-auto my-2 flex h-[calc(100vh-1rem)] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl sm:my-4 sm:h-[calc(100vh-2rem)]"
          @click=${(e) => e.stopPropagation()}
        >
          <!-- Header -->
          <div class="border-b border-gray-200 p-6 flex-shrink-0">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h3 class="text-xl font-bold text-gray-900">Share List: ${this.list.title}</h3>
                <p class="text-sm text-gray-600 mt-1">Invite guests to view and review this collection</p>
              </div>
              <button
                type="button"
                class="text-2xl leading-none text-gray-500 hover:text-gray-700"
                @click=${this._handleClose}
                aria-label="Close dialog"
                title="Close"
              >
                &times;
              </button>
            </div>
          </div>

          <!-- Scrollable Content -->
          <div class="overflow-y-auto flex-1">
            <!-- Form -->
            <form @submit=${this._handleSubmit} class="p-6">
            ${this._error ? html`
              <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                ${this._error}
              </div>
            ` : ''}

            <!-- Email Input -->
            <div class="mb-4">
              <label for="emails" class="block text-sm font-semibold text-gray-700 mb-2">
                Guest Email Addresses
              </label>
              <textarea
                id="emails"
                rows="3"
                class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter email addresses (comma or newline separated)"
                .value=${this._emails}
                @input=${(e) => { this._emails = e.target.value; }}
              ></textarea>
              <p class="text-xs text-gray-500 mt-1">
                Each guest will receive a magic link to access this list
              </p>
            </div>

            <!-- Download Permissions -->
            <div class="mb-4">
              <label class="block text-sm font-semibold text-gray-700 mb-2">
                Download Permissions
              </label>
              <div class="space-y-2">
                <label class="flex items-center">
                  <input
                    type="checkbox"
                    class="mr-2"
                    .checked=${this._allowDownloadThumbs}
                    @change=${(e) => { this._allowDownloadThumbs = e.target.checked; }}
                  />
                  <span class="text-sm text-gray-700">Allow thumbnail downloads</span>
                </label>
                <label class="flex items-center">
                  <input
                    type="checkbox"
                    class="mr-2"
                    .checked=${this._allowDownloadOriginals}
                    @change=${(e) => { this._allowDownloadOriginals = e.target.checked; }}
                  />
                  <span class="text-sm text-gray-700">Allow original file downloads</span>
                </label>
              </div>
            </div>

            <!-- Expiry Selector -->
            <div class="mb-6">
              <label for="expiry" class="block text-sm font-semibold text-gray-700 mb-2">
                Link Expiration
              </label>
              <select
                id="expiry"
                class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                .value=${this._expiresInDays.toString()}
                @change=${(e) => { this._expiresInDays = e.target.value === 'never' ? 'never' : parseInt(e.target.value); }}
              >
                <option value="7">7 days</option>
                <option value="30">30 days (default)</option>
                <option value="90">90 days</option>
                <option value="never">Never</option>
              </select>
            </div>

            <!-- Actions -->
            <div class="flex justify-end gap-2">
              <button
                type="button"
                @click=${this._handleClose}
                class="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                ?disabled=${this.loading}
              >
                Cancel
              </button>
              <button
                type="submit"
                class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                ?disabled=${this.loading}
              >
                ${this.loading ? 'Sending...' : 'Send Invites'}
              </button>
            </div>
          </form>

          <!-- Existing Shares -->
          ${this.existingShares.length > 0 ? html`
            <div class="border-t border-gray-200 p-6">
              <h4 class="text-sm font-semibold text-gray-700 mb-3">Active Shares</h4>
              <div class="space-y-2">
                ${this.existingShares.map(share => html`
                  <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div class="flex-1">
                      <div class="text-sm font-medium text-gray-900">${share.guest_email}</div>
                      <div class="text-xs text-gray-500">
                        Expires: ${this._formatExpiryDate(share.expires_at)}
                        ${share.allow_download_originals ? ' • Can download originals' :
                          share.allow_download_thumbs ? ' • Can download thumbnails' : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      @click=${() => this._handleRevokeShare(share.id)}
                      class="px-3 py-1 text-xs text-red-600 border border-red-300 rounded hover:bg-red-50"
                      ?disabled=${this.loading}
                    >
                      Revoke
                    </button>
                  </div>
                `)}
              </div>
            </div>
          ` : ''}
          </div>
          <!-- End Scrollable Content -->
        </div>
      </div>
    `;
  }
}

customElements.define('share-list-modal', ShareListModal);
