import { LitElement, html, css } from 'lit';
import { onAuthStateChange, getSession } from '../services/supabase.js';
import { verifyOtpCode } from '../services/auth.js';
import './guest-list-view.js';

/**
 * Guest Application Root Component
 *
 * Entry point for guest users accessing shared lists.
 * Handles authentication via Supabase magic links and routes to list view.
 *
 * Flow:
 * 1. User clicks magic link from email (format: /guest#access_token=...)
 * 2. Supabase JS client exchanges hash for session
 * 3. JWT contains user_role='guest' and tenant_ids array
 * 4. Component validates guest role and routes to list view
 *
 * @property {Boolean} authenticated - Whether user has valid session
 * @property {Boolean} loading - Loading state
 * @property {Boolean} isGuest - Whether user has guest role in JWT
 * @property {String} error - Error message if any
 * @property {String} tenantId - Current tenant ID from URL or JWT
 * @property {Number} listId - List ID from URL
 */
export class GuestApp extends LitElement {
  static properties = {
    authenticated: { type: Boolean },
    loading: { type: Boolean },
    isGuest: { type: Boolean },
    error: { type: String },
    tenantId: { type: String },
    listId: { type: Number },
    // New properties for auth flow
    authEmail: { type: String },
    authLoading: { type: Boolean },
    authMessage: { type: String },
    authSuccess: { type: Boolean },
    authCode: { type: String },
    verifyLoading: { type: Boolean },
    verifyMessage: { type: String },
    currentUser: { type: Object },
    userMenuOpen: { type: Boolean },
    guestTenantIds: { type: Array },
    collectionsRefreshing: { type: Boolean },
  };

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    .spinner-animation {
      width: 24px;
      height: 24px;
      border: 2px solid #d1d5db;
      border-top-color: #2563eb;
      border-radius: 9999px;
      animation: spin 1s linear infinite;
      display: inline-block;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    .loading-text {
      font-size: 14px;
      color: #6b7280;
      margin-left: 10px;
    }

    .guest-shell {
      min-height: 100vh;
      background: #f3f4f6;
      color: #111827;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .guest-topbar {
      position: sticky;
      top: 0;
      z-index: 20;
      background: rgba(255, 255, 255, 0.95);
      border-bottom: 1px solid #e5e7eb;
      backdrop-filter: blur(8px);
    }
    .guest-topbar-inner {
      max-width: 1240px;
      margin: 0 auto;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .guest-topbar-actions {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      margin-left: auto;
    }
    .guest-auth-wrap {
      max-width: 760px;
      margin: 0 auto;
    }
    .guest-auth-panel {
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 16px;
      padding: 22px;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
    }
    .guest-auth-title {
      margin: 0;
      font-size: 26px;
      line-height: 1.2;
      color: #111827;
      font-weight: 700;
    }
    .guest-auth-subtitle {
      margin: 10px 0 0;
      font-size: 14px;
      color: #6b7280;
      line-height: 1.5;
    }
    .guest-mode-switch {
      display: inline-flex;
      border: 1px solid #d1d5db;
      border-radius: 10px;
      overflow: hidden;
      background: #ffffff;
    }
    .guest-mode-btn {
      border: none;
      border-right: 1px solid #e5e7eb;
      background: #ffffff;
      color: #374151;
      padding: 8px 12px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }
    .guest-mode-btn:last-child {
      border-right: none;
    }
    .guest-mode-btn.active {
      background: #eff6ff;
      color: #1d4ed8;
    }
    .guest-auth-form {
      margin-top: 16px;
      display: grid;
      gap: 10px;
    }
    .guest-auth-input {
      width: 100%;
      padding: 12px;
      border: 1px solid #d1d5db;
      border-radius: 10px;
      font-size: 15px;
      background: #ffffff;
      color: #111827;
      box-sizing: border-box;
    }
    .guest-auth-input:focus {
      outline: none;
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
    }
    .guest-auth-input.code {
      letter-spacing: 0.12em;
    }
    .guest-auth-submit {
      width: 100%;
      padding: 11px 14px;
      background: #2563eb;
      color: #ffffff;
      border: 1px solid #2563eb;
      border-radius: 10px;
      font-weight: 700;
      font-size: 15px;
      cursor: pointer;
    }
    .guest-auth-submit.secondary {
      background: #ffffff;
      color: #374151;
      border-color: #d1d5db;
    }
    .guest-auth-submit:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .guest-auth-message {
      margin-top: 10px;
      padding: 10px 12px;
      border-radius: 10px;
      font-size: 14px;
      line-height: 1.4;
    }
    .guest-auth-message.ok {
      background: #ecfdf3;
      border: 1px solid #86efac;
      color: #166534;
    }
    .guest-auth-message.err {
      background: #fef2f2;
      border: 1px solid #fecaca;
      color: #991b1b;
    }
    .guest-auth-divider {
      margin: 12px 0 2px;
      font-size: 12px;
      color: #6b7280;
      text-align: center;
    }
    .guest-auth-footer {
      margin-top: 18px;
      font-size: 12px;
      color: #6b7280;
      line-height: 1.5;
    }
    .guest-auth-actions {
      margin-top: 16px;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .guest-brand-title {
      font-size: 28px;
      font-weight: 700;
      line-height: 1.1;
      color: #111827;
      margin: 0;
    }
    .guest-brand-subtitle {
      font-size: 14px;
      color: #6b7280;
      line-height: 1.4;
      margin: 4px 0 0 0;
    }
    .guest-content {
      max-width: 1240px;
      margin: 0 auto;
      padding: 24px 20px 32px;
    }
    .guest-panel {
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 16px;
      padding: 20px;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
    }
    .guest-panel-title {
      margin: 0;
      font-size: 22px;
      color: #111827;
      font-weight: 700;
    }
    .guest-panel-subtitle {
      margin: 8px 0 0 0;
      font-size: 14px;
      color: #6b7280;
    }
    .guest-list-grid {
      margin-top: 18px;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
    }
    .guest-list-card {
      width: 100%;
      border: 1px solid #d1d5db;
      border-radius: 12px;
      background: #ffffff;
      padding: 14px;
      text-align: left;
      cursor: pointer;
      transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
    }
    .guest-list-card:hover {
      transform: translateY(-1px);
      border-color: #2563eb;
      box-shadow: 0 8px 18px rgba(37, 99, 235, 0.18);
    }
    .guest-list-name {
      font-size: 16px;
      font-weight: 700;
      color: #111827;
    }
    .guest-list-meta {
      margin-top: 6px;
      font-size: 13px;
      color: #6b7280;
    }
    .guest-list-shared-by {
      margin-top: 6px;
      font-size: 13px;
      color: #374151;
    }
    .guest-list-dates {
      margin-top: 8px;
      display: grid;
      gap: 2px;
      font-size: 12px;
      color: #6b7280;
    }
    .guest-list-footer {
      margin-top: 10px;
      padding-top: 8px;
      border-top: 1px solid #e5e7eb;
      font-size: 12px;
      color: #4b5563;
      font-weight: 600;
    }
    .guest-reviewed-ok {
      color: #16a34a;
      font-weight: 700;
      margin-left: 8px;
    }
    .guest-user-menu {
      position: relative;
    }
    .guest-avatar-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 40px;
      width: 40px;
      border-radius: 9999px;
      color: #ffffff;
      font-size: 16px;
      font-weight: 700;
      border: 1px solid rgba(15, 23, 42, 0.08);
      box-shadow: 0 2px 6px rgba(15, 23, 42, 0.18);
      cursor: pointer;
    }
    .guest-user-dropdown {
      position: absolute;
      right: 0;
      top: 46px;
      min-width: 280px;
      max-width: min(86vw, 360px);
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      box-shadow: 0 10px 25px rgba(15, 23, 42, 0.16);
      z-index: 50;
      overflow: hidden;
    }
    .guest-user-head {
      padding: 12px 14px;
      border-bottom: 1px solid #f1f5f9;
    }
    .guest-user-name {
      font-size: 14px;
      font-weight: 700;
      color: #111827;
      line-height: 1.3;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .guest-user-email {
      margin-top: 2px;
      font-size: 12px;
      color: #6b7280;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .guest-user-action {
      width: 100%;
      text-align: left;
      border: none;
      border-top: 1px solid #f8fafc;
      background: #ffffff;
      padding: 10px 14px;
      font-size: 13px;
      color: #374151;
      cursor: pointer;
    }
    .guest-user-action:hover {
      background: #f8fafc;
    }
    .guest-user-action.signout {
      color: #b91c1c;
    }
    .guest-refresh-btn {
      border: 1px solid #d1d5db;
      background: #ffffff;
      color: #374151;
      border-radius: 10px;
      padding: 8px 12px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .guest-refresh-btn:hover {
      background: #f9fafb;
      border-color: #9ca3af;
    }

    @media (max-width: 1200px) {
      .guest-list-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }

    @media (max-width: 920px) {
      .guest-list-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 640px) {
      .guest-list-grid {
        grid-template-columns: 1fr;
      }
    }
  `;

  constructor() {
    super();
    this.authenticated = false;
    this.loading = true;
    this.isGuest = false;
    this.error = null;
    this.availableLists = null; // List of accessible lists when no list_id provided
    this.tenantId = null;
    this.listId = null;
    // Auth flow state
    this.authEmail = '';
    this.authLoading = false;
    this.authMessage = '';
    this.authSuccess = false;
    this.authCode = '';
    this.verifyLoading = false;
    this.verifyMessage = '';
    this.currentUser = null;
    this.userMenuOpen = false;
    this.guestTenantIds = [];
    this.collectionsRefreshing = false;
    this._handleDocumentClick = this._handleDocumentClick.bind(this);
    this._handleWindowFocus = this._handleWindowFocus.bind(this);
  }

  async connectedCallback() {
    super.connectedCallback();

    // Parse URL for list ID, tenant ID, and email
    const urlParams = new URLSearchParams(window.location.search);
    let listIdParam = urlParams.get('list_id');
    let tenantIdParam = urlParams.get('tenant_id');
    const emailParam = urlParams.get('email');

    // Pre-fill email if provided in URL
    if (emailParam) {
      this.authEmail = emailParam;
    }

    this._setAuthErrorFromUrl();

    // Then try hash fragment (new method from invite links: #list_id,tenant_id)
    if (!listIdParam && window.location.hash) {
      const hash = window.location.hash.substring(1); // Remove #
      const parts = hash.split(',');
      if (
        parts.length >= 2 &&
        /^\d+$/.test(parts[0]) &&
        /^[0-9a-fA-F-]{36}$/.test(parts[1])
      ) {
        listIdParam = parts[0];
        tenantIdParam = parts[1];
      }
    }

    if (listIdParam) {
      this.listId = parseInt(listIdParam);
    }
    if (tenantIdParam) {
      this.tenantId = tenantIdParam;
    }

    // Check authentication state
    const session = await getSession();
    this.authenticated = !!session;
    this.currentUser = session?.user || null;

    if (this.authenticated) {
      await this._validateGuestAccess(session);
    }

    this.loading = false;

    // Listen for auth state changes
    this.authSubscription = onAuthStateChange(async (event, session) => {
      this.authenticated = !!session;
      this.currentUser = session?.user || null;

      if (session) {
        await this._validateGuestAccess(session);
      } else if (event === 'SIGNED_OUT') {
        this.isGuest = false;
        this.error = null;
        this.authSuccess = false;
        this.authMessage = this._expiredOrUsedLinkMessage();
      } else {
        this.isGuest = false;
        this.error = null;
      }

      this.requestUpdate();
    });
    document.addEventListener('click', this._handleDocumentClick);
    window.addEventListener('focus', this._handleWindowFocus);
  }

  async _validateGuestAccess(session) {
    try {
      // Decode JWT to check user_role
      const token = session.access_token;
      const payload = JSON.parse(atob(token.split('.')[1]));

      // Check if user has guest role
      const sessionRole = session?.user?.app_metadata?.role;
      const jwtRole = payload.user_role || payload?.app_metadata?.role;
      this.isGuest = (jwtRole || sessionRole) === 'guest';

      if (!this.isGuest) {
        // Ignore existing real-user sessions on /guest without affecting /app tabs.
        this.authenticated = false;
        this.isGuest = false;
        this.error = null;
        this.availableLists = null;
        return;
      }

      // Extract tenant_ids from JWT
      const tenantIds = payload.tenant_ids || payload?.app_metadata?.tenant_ids || session?.user?.app_metadata?.tenant_ids || [];
      this.guestTenantIds = Array.isArray(tenantIds) ? tenantIds : [];

      // If tenant_id is in URL, validate it's in the JWT
      if (this.tenantId && !tenantIds.includes(this.tenantId)) {
        this.error = 'You do not have access to this tenant.';
        return;
      }

      // If no tenant_id in URL but only one in JWT, use it
      if (!this.tenantId && tenantIds.length === 1) {
        this.tenantId = tenantIds[0];
      }

      // If no list_id in URL, fetch accessible lists and let user choose
      if (!this.listId) {
        await this._fetchAccessibleLists();
        return;
      }

      this.error = null;

    } catch (err) {
      console.error('Error validating guest access:', err);
      this.error = 'Failed to validate access. Please try again or request a new link.';
    }
  }

  async _fetchAccessibleLists() {
    try {
      const { fetchWithAuth } = await import('../services/api.js');
      const tenantIdsToQuery = this.tenantId
        ? [this.tenantId]
        : (Array.isArray(this.guestTenantIds) ? this.guestTenantIds : []);

      if (!tenantIdsToQuery.length) {
        throw new Error('No tenant access found for this guest account.');
      }

      const listResponses = await Promise.all(
        tenantIdsToQuery.map(async (tenantId) => {
          const response = await fetchWithAuth('/guest/lists', {
            headers: { 'X-Tenant-ID': tenantId },
          });
          const lists = Array.isArray(response?.lists) ? response.lists : [];
          return lists.map((item) => ({
            ...item,
            tenant_id: tenantId,
          }));
        }),
      );

      const merged = listResponses.flat();
      const deduped = [];
      const seen = new Set();
      for (const list of merged) {
        const key = `${list.tenant_id}:${list.list_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(list);
      }

      deduped.sort((a, b) => {
        const aTs = a?.shared_at ? new Date(a.shared_at).getTime() : 0;
        const bTs = b?.shared_at ? new Date(b.shared_at).getTime() : 0;
        return bTs - aTs;
      });

      this.availableLists = deduped;
      this.loading = false;
    } catch (err) {
      console.error('Failed to fetch accessible lists:', err);
      this.error = 'Failed to load shared photo lists. Please try again.';
      this.loading = false;
    }
  }

  _selectList(listId, tenantId = this.tenantId) {
    // Keep navigation in-app for smooth transitions.
    const selectedTenant = tenantId || this.tenantId || (this.guestTenantIds?.[0] || '');
    if (!selectedTenant) {
      this.error = 'Could not determine tenant for selected list.';
      return;
    }
    this.listId = Number(listId);
    this.tenantId = selectedTenant;
    this.availableLists = null;
    this.error = null;
    window.location.hash = `${this.listId},${selectedTenant}`;
  }

  _goToApp() {
    window.location.href = '/app';
  }

  async _handleGuestHome() {
    this.listId = null;
    this.tenantId = null;
    this.error = null;
    this.collectionsRefreshing = true;
    this.availableLists = null;
    window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}`);
    try {
      await this._refreshGuestSessionState();
      const canQueryLists = !this.listId && (this.isGuest || (Array.isArray(this.guestTenantIds) && this.guestTenantIds.length > 0));
      if (canQueryLists) {
        await this._fetchAccessibleLists();
      }
    } finally {
      this.collectionsRefreshing = false;
    }
  }

  _renderAccountModeSwitch() {
    return html`
      <div class="guest-mode-switch" role="group" aria-label="Account mode">
          <button
            type="button"
            class="guest-mode-btn active"
          >
            Guest Mode
          </button>
          <button
            type="button"
            @click=${this._goToApp}
            class="guest-mode-btn"
          >
            Go to App
          </button>
      </div>
    `;
  }

  _expiredOrUsedLinkMessage() {
    return 'This sign-in link has expired or has already been used. Please request a new link below.';
  }

  _looksLikeExpiredOrInvalidAuthError(value) {
    const msg = String(value || '').toLowerCase();
    if (!msg) return false;
    return msg.includes('expired')
      || msg.includes('invalid')
      || msg.includes('otp_expired')
      || msg.includes('already')
      || msg.includes('used')
      || msg.includes('access_denied')
      || msg.includes('token')
      || msg.includes('revoked');
  }

  _setAuthErrorFromUrl() {
    const searchParams = new URLSearchParams(window.location.search || '');
    const hashRaw = String(window.location.hash || '').replace(/^#/, '');
    const hashParams = new URLSearchParams(hashRaw.includes('=') ? hashRaw : '');
    const values = [
      searchParams.get('error'),
      searchParams.get('error_description'),
      searchParams.get('error_code'),
      hashParams.get('error'),
      hashParams.get('error_description'),
      hashParams.get('error_code'),
    ].filter(Boolean).map((v) => String(v).toLowerCase());
    if (!values.length) {
      return;
    }

    const combined = values.join(' ');
    const looksExpiredOrUsed = this._looksLikeExpiredOrInvalidAuthError(combined);
    this.authSuccess = false;
    this.authMessage = looksExpiredOrUsed
      ? this._expiredOrUsedLinkMessage()
      : 'This sign-in link is invalid. Please request a new link below.';
    this.error = null;

    // Keep useful context params and clear auth error params from URL.
    ['error', 'error_description', 'error_code', 'code', 'type'].forEach((key) => searchParams.delete(key));
    const nextQuery = searchParams.toString();
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`,
    );
  }

  async _handleGuestLogout() {
    try {
      const { signOut } = await import('../services/supabase.js');
      await signOut();
    } catch (err) {
      console.error('Failed to sign out:', err);
    } finally {
      this.authenticated = false;
      this.isGuest = false;
      this.error = null;
      this.availableLists = null;
      this.currentUser = null;
      this.listId = null;
      window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}`);
      window.location.href = '/guest';
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.authSubscription) {
      this.authSubscription.unsubscribe();
    }
    document.removeEventListener('click', this._handleDocumentClick);
    window.removeEventListener('focus', this._handleWindowFocus);
  }

  async _refreshGuestSessionState() {
    const session = await getSession();
    this.authenticated = !!session;
    this.currentUser = session?.user || null;

    if (session) {
      await this._validateGuestAccess(session);
    } else {
      this.isGuest = false;
      this.guestTenantIds = [];
      this.availableLists = null;
    }
  }

  async _handleWindowFocus() {
    try {
      await this._refreshGuestSessionState();

      if (this.authenticated && this.isGuest && !this.listId) {
        await this._fetchAccessibleLists();
      }
      this.requestUpdate();
    } catch (err) {
      console.warn('Failed to refresh guest session on focus:', err);
    }
  }

  async _handleRefreshCollections() {
    this.collectionsRefreshing = true;
    try {
      await this._refreshGuestSessionState();
      const canQueryLists = !this.listId && (this.isGuest || (Array.isArray(this.guestTenantIds) && this.guestTenantIds.length > 0));
      if (canQueryLists) {
        await this._fetchAccessibleLists();
      }
    } finally {
      this.collectionsRefreshing = false;
    }
  }

  _toggleUserMenu(event) {
    event?.stopPropagation?.();
    this.userMenuOpen = !this.userMenuOpen;
  }

  _handleDocumentClick(event) {
    if (!this.userMenuOpen) return;
    const target = event?.target;
    if (target && this.contains(target)) return;
    this.userMenuOpen = false;
  }

  _getUserDisplayName() {
    return this.currentUser?.user_metadata?.full_name
      || this.currentUser?.email?.split('@')?.[0]
      || 'Guest User';
  }

  _getUserEmail() {
    return this.currentUser?.email || '';
  }

  _getAvatarLetter() {
    const name = this._getUserDisplayName().trim();
    return name ? name.charAt(0).toUpperCase() : 'G';
  }

  _hashString(value) {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = ((hash << 5) - hash) + value.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  _getAvatarStyle() {
    const seed = `${this._getUserDisplayName()}|${this._getUserEmail()}`;
    const hash = this._hashString(seed);
    const hueA = hash % 360;
    const hueB = (hueA + 45 + (hash % 70)) % 360;
    return `background: linear-gradient(135deg, hsl(${hueA} 78% 56%), hsl(${hueB} 78% 46%));`;
  }

  _getSharedByLabel(list) {
    const raw = String(list?.shared_by || '').trim();
    return raw || 'Unknown';
  }

  _formatGuestDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString();
  }

  async _handleRequestNewLink(e) {
    if (e?.preventDefault) e.preventDefault();

    if (!this.authEmail || !this.authEmail.trim()) {
      this.authMessage = 'Please enter your email address.';
      this.authSuccess = false;
      return;
    }

    this.authLoading = true;
    this.authMessage = '';

    try {
      const response = await fetch('/api/v1/guest/auth/request-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: this.authEmail.trim().toLowerCase(),
          tenant_id: this.tenantId || undefined,
        }),
      });

      const data = await response.json();

      this.authSuccess = data.success || false;
      this.authMessage = data.message || 'An error occurred. Please try again.';
      this.authLoading = false;

    } catch (err) {
      console.error('Failed to request magic link:', err);
      this.authMessage = 'Failed to send link. Please try again or contact support.';
      this.authSuccess = false;
      this.authLoading = false;
    }
  }

  _handleEmailInput(e) {
    this.authEmail = e.target.value;
    if (this.authMessage && !this.authSuccess) this.authMessage = '';
    if (this.verifyMessage) this.verifyMessage = '';
  }

  _handleCodeInput(e) {
    const raw = String(e.target.value || '');
    this.authCode = raw.replace(/\s+/g, '').trim();
    if (this.verifyMessage) this.verifyMessage = '';
  }

  async _handleVerifyCode(e) {
    if (e?.preventDefault) e.preventDefault();

    const email = String(this.authEmail || '').trim().toLowerCase();
    const code = String(this.authCode || '').trim();
    if (!email) {
      this.verifyMessage = 'Enter your email first.';
      return;
    }
    if (!code) {
      this.verifyMessage = 'Enter the code from the email.';
      return;
    }

    this.verifyLoading = true;
    this.verifyMessage = '';
    try {
      await verifyOtpCode(email, code);
      this.verifyMessage = 'Code verified. Signing you in...';
    } catch (err) {
      this.verifyMessage = err?.message || 'Invalid code. Please try again.';
    } finally {
      this.verifyLoading = false;
    }
  }

  _renderGuestAuthForm() {
    return html`
      <form @submit=${this._handleRequestNewLink} class="guest-auth-form">
        <input
          type="email"
          placeholder="your.email@example.com"
          .value=${this.authEmail}
          @input=${this._handleEmailInput}
          class="guest-auth-input"
          required
          ?disabled=${this.authLoading || this.verifyLoading}
        />
        <button
          type="submit"
          ?disabled=${this.authLoading || this.verifyLoading}
          class="guest-auth-submit"
        >
          ${this.authLoading ? 'Sending...' : 'Send Magic Link'}
        </button>
      </form>

      ${this.authMessage ? html`
        <p class="guest-auth-message ${this.authSuccess ? 'ok' : 'err'}">
          ${this.authMessage}
        </p>
      ` : ''}

      ${this.authSuccess ? html`
        <div class="guest-auth-divider">or</div>
        <form @submit=${this._handleVerifyCode} class="guest-auth-form">
          <input
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            placeholder="Enter code from email"
            .value=${this.authCode}
            @input=${this._handleCodeInput}
            class="guest-auth-input code"
            ?disabled=${this.authLoading || this.verifyLoading}
          />
          <button
            type="submit"
            ?disabled=${this.authLoading || this.verifyLoading}
            class="guest-auth-submit secondary"
          >
            ${this.verifyLoading ? 'Verifying...' : 'Sign In With Code'}
          </button>
        </form>
      ` : ''}

      ${this.verifyMessage ? html`
        <p class="guest-auth-message ${this.verifyMessage.toLowerCase().includes('verified') ? 'ok' : 'err'}">
          ${this.verifyMessage}
        </p>
      ` : ''}
    `;
  }

  render() {
    const unresolvedAuthError = this.authMessage
      ? ''
      : (this._looksLikeExpiredOrInvalidAuthError(this.error) ? this._expiredOrUsedLinkMessage() : '');

    // Still loading
    if (this.loading) {
      return html`
        <div class="guest-shell">
          <header class="guest-topbar">
            <div class="guest-topbar-inner">
              <div>
                <h1 class="guest-brand-title">Zoltag - Guest Access</h1>
                <p class="guest-brand-subtitle">Checking your access</p>
              </div>
            </div>
          </header>
          <main class="guest-content">
            <section class="guest-auth-wrap">
              <div class="guest-auth-panel">
                <span class="spinner-animation" aria-hidden="true"></span>
                <span class="loading-text">Verifying access...</span>
              </div>
            </section>
          </main>
        </div>
      `;
    }

    // Not authenticated - show email input form
    if (!this.authenticated) {
      return html`
        <div class="guest-shell">
          <header class="guest-topbar">
            <div class="guest-topbar-inner">
              <div>
                <h1 class="guest-brand-title">Zoltag - Guest Access</h1>
                <p class="guest-brand-subtitle">Sign in to view shared collections</p>
              </div>
              <div class="guest-topbar-actions">
                ${this._renderAccountModeSwitch()}
              </div>
            </div>
          </header>
          <main class="guest-content">
            <section class="guest-auth-wrap">
              <div class="guest-auth-panel">
                <h2 class="guest-auth-title">Sign In to View Shared Photos</h2>
                <p class="guest-auth-subtitle">
                  Enter your invited email to receive a secure sign-in link. If your previous link expired or was already used, request a new one below.
                </p>
                ${unresolvedAuthError ? html`
                  <p class="guest-auth-message err">${unresolvedAuthError}</p>
                ` : ''}
                ${this._renderGuestAuthForm()}
                <p class="guest-auth-footer">
                  This is a secure guest access flow. If you did not request access, you can ignore this page.
                </p>
              </div>
            </section>
          </main>
        </div>
      `;
    }

    // Error state
    if (this.error) {
      return html`
        <div class="guest-shell">
          <header class="guest-topbar">
            <div class="guest-topbar-inner">
              <div>
                <h1 class="guest-brand-title">Zoltag - Guest Access</h1>
                <p class="guest-brand-subtitle">Access issue</p>
              </div>
              <div class="guest-topbar-actions">
                ${this._renderAccountModeSwitch()}
              </div>
            </div>
          </header>
          <main class="guest-content">
            <section class="guest-auth-wrap">
              <div class="guest-auth-panel">
                <h2 class="guest-auth-title">Access Error</h2>
                <p class="guest-auth-subtitle">${this.error}</p>
                <div class="guest-auth-actions">
                  <button class="guest-auth-submit" @click=${this._handleRequestNewLink}>Request New Link</button>
                  <button class="guest-auth-submit secondary" @click=${this._handleGuestLogout}>Sign Out</button>
                </div>
              </div>
            </section>
          </main>
        </div>
      `;
    }

    if (this.authenticated && !this.isGuest) {
      return html`
        <div class="guest-shell">
          <header class="guest-topbar">
            <div class="guest-topbar-inner">
              <div>
                <h1 class="guest-brand-title">Zoltag - Guest Access</h1>
                <p class="guest-brand-subtitle">Sign in with your invited guest account</p>
              </div>
              <div class="guest-topbar-actions">
                ${this._renderAccountModeSwitch()}
              </div>
            </div>
          </header>
          <main class="guest-content">
            <section class="guest-auth-wrap">
              <div class="guest-auth-panel">
                <h2 class="guest-auth-title">Sign In to View Shared Photos</h2>
                <p class="guest-auth-subtitle">
                  This guest link can only be used with the invited email account. If your link expired or was used already, request a new one.
                </p>
                ${this._renderGuestAuthForm()}
              </div>
            </section>
          </main>
        </div>
      `;
    }

    if (this.isGuest && !this.listId) {
      if (!this.availableLists || this.collectionsRefreshing) {
        return html`
          <div class="guest-shell">
            <header class="guest-topbar">
              <div class="guest-topbar-inner">
                <div>
                  <h1 class="guest-brand-title">Zoltag - Guest Access</h1>
                  <p class="guest-brand-subtitle">Select a shared collection to review</p>
                </div>
              </div>
            </header>
            <main class="guest-content">
              <section class="guest-panel">
                <h2 class="text-lg font-semibold text-gray-900">Loading collections…</h2>
              </section>
            </main>
          </div>
        `;
      }

      if (this.availableLists.length === 0) {
        return html`
          <div class="guest-shell">
            <header class="guest-topbar">
              <div class="guest-topbar-inner">
                <div>
                  <h1 class="guest-brand-title">Zoltag - Guest Access</h1>
                  <p class="guest-brand-subtitle">No shared collections found</p>
                </div>
                <div class="guest-topbar-actions">
                  <button type="button" class="guest-refresh-btn" @click=${this._handleGuestLogout}>Sign Out</button>
                </div>
              </div>
            </header>
            <main class="guest-content">
              <section class="guest-auth-wrap">
                <div class="guest-auth-panel">
                  <h2 class="guest-auth-title">No Shared Lists</h2>
                  <p class="guest-auth-subtitle">You don't have access to any shared photo lists yet.</p>
                </div>
              </section>
            </main>
          </div>
        `;
      }

      return html`
        <div class="guest-shell">
          <header class="guest-topbar">
            <div class="guest-topbar-inner">
              <div>
                <h1 class="guest-brand-title">Zoltag - Guest Access</h1>
                <p class="guest-brand-subtitle">Select a shared collection to review</p>
              </div>
              <div class="guest-topbar-actions">
                <button type="button" class="guest-refresh-btn" @click=${this._handleRefreshCollections}>
                  ${this.collectionsRefreshing ? 'Refreshing…' : 'Refresh'}
                </button>
                <div class="guest-user-menu">
                  <button
                    type="button"
                    class="guest-avatar-btn"
                    style=${this._getAvatarStyle()}
                    aria-haspopup="menu"
                    aria-expanded=${this.userMenuOpen ? 'true' : 'false'}
                    @click=${this._toggleUserMenu}
                    title=${this._getUserDisplayName()}
                  >
                    ${this._getAvatarLetter()}
                  </button>
                  ${this.userMenuOpen ? html`
                    <div class="guest-user-dropdown" role="menu">
                      <div class="guest-user-head">
                        <div class="guest-user-name" title=${this._getUserDisplayName()}>${this._getUserDisplayName()}</div>
                        ${this._getUserEmail() ? html`
                          <div class="guest-user-email" title=${this._getUserEmail()}>${this._getUserEmail()}</div>
                        ` : ''}
                      </div>
                      <button type="button" class="guest-user-action signout" @click=${() => this._handleGuestLogout()}>Sign Out</button>
                    </div>
                  ` : ''}
                </div>
              </div>
            </div>
          </header>
          <main class="guest-content">
            <section class="guest-panel">
              <h2 class="guest-panel-title">Your Shared Collections</h2>
              <p class="guest-panel-subtitle">Choose a collection to open the review workspace.</p>
              <div class="guest-list-grid">
                ${this.availableLists.map((list) => html`
                  <button
                    class="guest-list-card"
                    @click=${() => this._selectList(list.list_id, list.tenant_id)}
                    type="button"
                  >
                    <div class="guest-list-name">${list.title}</div>
                    <div class="guest-list-meta">${list.item_count} ${list.item_count === 1 ? 'photo' : 'photos'}</div>
                    <div class="guest-list-shared-by">Shared by ${this._getSharedByLabel(list)}</div>
                    <div class="guest-list-dates">
                      <div>Shared: ${this._formatGuestDate(list.shared_at) || 'Unknown'}</div>
                      <div>Expires: ${list.expires_at ? (this._formatGuestDate(list.expires_at) || 'Unknown') : 'Never'}</div>
                    </div>
                    <div class="guest-list-footer">
                      ${Number(list.item_count || 0)} items • ${Number(list.reviewed_count || 0)} reviewed
                      ${Number(list.reviewed_count || 0) > 0 ? html`
                        <span class="guest-reviewed-ok">✓</span>
                      ` : ''}
                    </div>
                  </button>
                `)}
              </div>
            </section>
          </main>
        </div>
      `;
    }

    // Valid guest access - show list view
    if (this.isGuest && this.listId && this.tenantId) {
      return html`
        <guest-list-view
          .listId=${this.listId}
          .tenantId=${this.tenantId}
          .userEmail=${this._getUserEmail()}
          .userDisplayName=${this._getUserDisplayName()}
          @guest-logout=${this._handleGuestLogout}
          @guest-home=${this._handleGuestHome}
        ></guest-list-view>
      `;
    }

    // Fallback (shouldn't reach here)
    return html`
      <div class="guest-shell">
        <header class="guest-topbar">
          <div class="guest-topbar-inner">
            <div>
              <h1 class="guest-brand-title">Zoltag - Guest Access</h1>
              <p class="guest-brand-subtitle">Access issue</p>
            </div>
            <div class="guest-topbar-actions">
              ${this._renderAccountModeSwitch()}
            </div>
          </div>
        </header>
        <main class="guest-content">
          <section class="guest-auth-wrap">
            <div class="guest-auth-panel">
              <h2 class="guest-auth-title">Invalid Access</h2>
              <p class="guest-auth-subtitle">
                This sign-in link has expired or has already been used. Please request a new link.
              </p>
              <div class="guest-auth-actions">
                <button class="guest-auth-submit" @click=${this._handleRequestNewLink}>Request New Link</button>
              </div>
            </div>
          </section>
        </main>
        </div>
      `;
  }
}

customElements.define('guest-app', GuestApp);
