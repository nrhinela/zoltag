import { LitElement, html } from 'lit';
import './guest-annotation-drawer.js';

const GUEST_LIST_VIEW_CSS = `
  .guest-shell {
    min-height: 100vh;
    background: radial-gradient(circle at top right, rgba(99, 102, 241, 0.1), transparent 45%), #f3f4f6;
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
  .guest-brand {
    display: flex;
    flex-direction: column;
    gap: 4px;
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
    margin: 0;
  }
  .guest-toolbar {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
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
  .guest-btn {
    border-radius: 10px;
    border: 1px solid #d1d5db;
    background: #ffffff;
    color: #374151;
    padding: 10px 14px;
    font-size: 14px;
    font-weight: 600;
    line-height: 1;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .guest-btn:hover {
    background: #f9fafb;
    border-color: #9ca3af;
  }
  .guest-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .guest-btn-primary {
    border-color: #2563eb;
    background: #2563eb;
    color: #ffffff;
  }
  .guest-btn-primary:hover {
    background: #1d4ed8;
    border-color: #1d4ed8;
  }
  .guest-content {
    max-width: 1240px;
    margin: 0 auto;
    padding: 24px 20px 32px;
  }
  .guest-back-row {
    display: flex;
    justify-content: flex-start;
    margin-bottom: 12px;
  }
  .guest-panel {
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 16px;
    padding: 16px;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
  }
  .guest-meta-row {
    font-size: 13px;
    color: #6b7280;
    margin-bottom: 14px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 700;
  }
  .guest-feedback-note {
    margin-bottom: 14px;
    border: 1px solid #bfdbfe;
    background: #eff6ff;
    color: #1e3a8a;
    border-radius: 12px;
    padding: 12px 14px;
    font-size: 13px;
    line-height: 1.5;
  }
  .guest-feedback-note strong {
    color: #1e40af;
    font-weight: 700;
  }
  .guest-feedback-note ul {
    margin: 8px 0 0;
    padding-left: 18px;
  }
  .guest-feedback-note li + li {
    margin-top: 4px;
  }
  .guest-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 14px;
  }
  .guest-tile {
    position: relative;
    aspect-ratio: 1 / 1;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid #d1d5db;
    background: #f3f4f6;
    cursor: pointer;
    transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
    padding: 0;
  }
  .guest-tile:hover {
    transform: translateY(-2px);
    border-color: #2563eb;
    box-shadow: 0 8px 18px rgba(37, 99, 235, 0.2);
  }
  .guest-tile img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .guest-tile-overlay {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 8px 10px;
    background: linear-gradient(to top, rgba(17, 24, 39, 0.75), rgba(17, 24, 39, 0));
    color: #f9fafb;
    font-size: 12px;
    font-weight: 600;
    opacity: 0;
    transition: opacity 0.15s ease;
  }
  .guest-tile:hover .guest-tile-overlay {
    opacity: 1;
  }
  .guest-tile-stats {
    position: absolute;
    top: 8px;
    left: 8px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    border-radius: 999px;
    background: rgba(17, 24, 39, 0.7);
    color: #f9fafb;
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    z-index: 1;
    backdrop-filter: blur(2px);
  }
  .guest-tile-done {
    position: absolute;
    right: 8px;
    bottom: 8px;
    width: 22px;
    height: 22px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: #16a34a;
    color: #ffffff;
    border: 2px solid rgba(255, 255, 255, 0.95);
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.25);
    font-size: 12px;
    font-weight: 800;
    z-index: 2;
  }
  .guest-tile-stat {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .guest-empty,
  .guest-loading,
  .guest-error {
    min-height: 62vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    gap: 10px;
    padding: 24px;
    color: #4b5563;
  }
  .guest-error-card {
    max-width: 560px;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 16px;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
    padding: 24px;
  }
`;

export class GuestListView extends LitElement {
  createRenderRoot() {
    return this;
  }

  static properties = {
    listId: { type: Number },
    tenantId: { type: String },
    list: { type: Object },
    items: { type: Array },
    images: { type: Array },
    loading: { type: Boolean },
    error: { type: String },
    sharePermissions: { type: Object },
    selectedImage: { type: Object },
    drawerOpen: { type: Boolean },
    userEmail: { type: String },
    userDisplayName: { type: String },
    userMenuOpen: { type: Boolean },
    downloadBusy: { type: String },
    downloadStatus: { type: String },
    reviewedAssetIds: { type: Object },
  };

  constructor() {
    super();
    this.listId = null;
    this.tenantId = null;
    this.list = null;
    this.items = [];
    this.images = [];
    this.loading = false;
    this.error = null;
    this.sharePermissions = {
      allow_download_thumbs: false,
      allow_download_originals: false,
    };
    this.selectedImage = null;
    this.drawerOpen = false;
    this.userEmail = '';
    this.userDisplayName = '';
    this.userMenuOpen = false;
    this.downloadBusy = '';
    this.downloadStatus = '';
    this.reviewedAssetIds = new Set();
    this._handleDocumentClick = this._handleDocumentClick.bind(this);
  }

  async connectedCallback() {
    super.connectedCallback();
    document.addEventListener('click', this._handleDocumentClick);
    await this._loadListData();
  }

  disconnectedCallback() {
    document.removeEventListener('click', this._handleDocumentClick);
    super.disconnectedCallback();
  }

  async _loadListData() {
    if (!this.listId || !this.tenantId) {
      this.error = 'Missing list ID or tenant ID';
      return;
    }

    this.loading = true;
    this.error = null;

    try {
      const { fetchWithAuth } = await import('../services/api.js');
      const listData = await fetchWithAuth(`/guest/lists/${this.listId}`, {
        method: 'GET',
        headers: {
          'X-Tenant-ID': this.tenantId,
        },
      });

      this.list = {
        id: listData.id,
        title: listData.title,
      };
      this.sharePermissions = {
        allow_download_thumbs: Boolean(listData?.share_permissions?.allow_download_thumbs),
        allow_download_originals: Boolean(listData?.share_permissions?.allow_download_originals),
      };
      this.items = listData.items || [];

      await this._loadImages();
      await this._loadReviewedAssetIds();
    } catch (err) {
      console.error('Failed to load list:', err);
      this.error = err.message || 'Failed to load collection. The link may have expired or been revoked.';
    } finally {
      this.loading = false;
    }
  }

  async _handleRetryLoad() {
    await this._loadListData();
  }

  async _loadImages() {
    if (this.items.length === 0) return;

    try {
      this.images = this.items
        .filter((item) => item && item.asset_id)
        .map((item) => ({
          id: item.asset_id,
          image_id: item.image_id,
          filename: item.filename,
          date_taken: item.date_taken,
          thumbnail_url: item.thumbnail_url || (item.image_id ? `/api/v1/images/${item.image_id}/thumbnail` : null),
          rating_counts: item.rating_counts || { '0': 0, '1': 0, '2': 0, '3': 0 },
          comment_count: item.comment_count || 0,
          added_at: item.added_at,
        }));
    } catch (err) {
      console.error('Failed to load images:', err);
    }
  }

  async _loadReviewedAssetIds() {
    if (!this.listId || !this.tenantId) return;
    try {
      const { fetchWithAuth } = await import('../services/api.js');
      const data = await fetchWithAuth(`/guest/lists/${this.listId}/my-reactions`, {
        method: 'GET',
        headers: {
          'X-Tenant-ID': this.tenantId,
        },
      });

      const reviewed = new Set();
      for (const rating of (data?.ratings || [])) {
        if (rating?.asset_id) reviewed.add(String(rating.asset_id));
      }
      for (const comment of (data?.comments || [])) {
        if (comment?.asset_id && comment?.can_delete) reviewed.add(String(comment.asset_id));
      }
      this.reviewedAssetIds = reviewed;
      this.requestUpdate();
    } catch (err) {
      console.warn('Failed to load reviewed asset markers:', err);
    }
  }

  _handleImageClick(image) {
    this.selectedImage = image;
    this.drawerOpen = true;
    this.requestUpdate();
  }

  _handleCloseDrawer() {
    this.drawerOpen = false;
    this.selectedImage = null;
    this.requestUpdate();
  }

  _handleAnnotationSaved() {
    const assetId = this.selectedImage?.id ? String(this.selectedImage.id) : '';
    if (!assetId) return;
    if (!(this.reviewedAssetIds instanceof Set)) {
      this.reviewedAssetIds = new Set([assetId]);
      this.requestUpdate();
      return;
    }
    this.reviewedAssetIds.add(assetId);
    this.reviewedAssetIds = new Set(this.reviewedAssetIds);
    this.requestUpdate();
  }

  _handleLogout() {
    this.userMenuOpen = false;
    this.dispatchEvent(new CustomEvent('guest-logout', {
      bubbles: true,
      composed: true,
    }));
  }

  _handleGoHome() {
    this.userMenuOpen = false;
    this.dispatchEvent(new CustomEvent('guest-home', {
      bubbles: true,
      composed: true,
    }));
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
    if (this.userDisplayName) return this.userDisplayName;
    return this.userEmail ? this.userEmail.split('@')[0] : 'Guest User';
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
    const seed = `${this._getUserDisplayName()}|${this.userEmail || ''}`;
    const hash = this._hashString(seed);
    const hueA = hash % 360;
    const hueB = (hueA + 45 + (hash % 70)) % 360;
    return `background: linear-gradient(135deg, hsl(${hueA} 78% 56%), hsl(${hueB} 78% 46%));`;
  }

  _normalizeRatingCounts(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
      '0': Number(src['0'] || 0),
      '1': Number(src['1'] || 0),
      '2': Number(src['2'] || 0),
      '3': Number(src['3'] || 0),
    };
  }

  _summarizeRatings(counts) {
    const c0 = Number(counts?.['0'] || 0);
    const c1 = Number(counts?.['1'] || 0);
    const c2 = Number(counts?.['2'] || 0);
    const c3 = Number(counts?.['3'] || 0);
    const total = c0 + c1 + c2 + c3;
    if (total <= 0) {
      return { total: 0, avgLabel: null };
    }
    const weighted = (0 * c0) + (1 * c1) + (2 * c2) + (3 * c3);
    const avg = weighted / total;
    const avgLabel = Number.isInteger(avg) ? String(avg) : avg.toFixed(1);
    return { total, avgLabel };
  }

  async _ensureZipLibrary() {
    if (window.JSZip) return;
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jszip@3/dist/jszip.min.js';
    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  _sanitizeFilename(value, fallback = 'image') {
    const trimmed = String(value || '').trim();
    const safe = trimmed.replace(/[\\/:*?"<>|]+/g, '_');
    return safe || fallback;
  }

  _splitFilename(name) {
    const safe = this._sanitizeFilename(name, 'image');
    const idx = safe.lastIndexOf('.');
    if (idx <= 0 || idx === safe.length - 1) {
      return { stem: safe, ext: '' };
    }
    return {
      stem: safe.slice(0, idx),
      ext: safe.slice(idx),
    };
  }

  _mimeToExt(mimeType) {
    const mime = String(mimeType || '').toLowerCase();
    if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
    if (mime.includes('png')) return '.png';
    if (mime.includes('webp')) return '.webp';
    if (mime.includes('gif')) return '.gif';
    return '.jpg';
  }

  _normalizeApiPath(path) {
    const value = String(path || '').trim();
    if (!value) return '';
    return value.startsWith('/api/v1/') ? value.slice('/api/v1'.length) : value;
  }

  async _handleDownload(type) {
    if (!this.listId || !this.tenantId || !Array.isArray(this.images) || this.images.length === 0) return;
    if (this.downloadBusy) return;

    this.downloadBusy = type;
    this.downloadStatus = '';

    try {
      await this._ensureZipLibrary();
      const { fetchWithAuth } = await import('../services/api.js');
      const zip = new window.JSZip();
      const folderName = type === 'thumbs' ? 'thumbnails' : 'fullsize';
      const total = this.images.length;
      let downloaded = 0;
      let failed = 0;

      for (let i = 0; i < total; i += 1) {
        const image = this.images[i];
        this.downloadStatus = `Downloading ${i + 1}/${total}...`;
        this.requestUpdate();

        let path = '';
        if (type === 'thumbs') {
          const thumbPath = image.thumbnail_url || (image.image_id ? `/api/v1/images/${image.image_id}/thumbnail` : '');
          path = this._normalizeApiPath(thumbPath);
        } else {
          path = `/guest/lists/${this.listId}/assets/${image.id}/full`;
        }
        if (!path) {
          failed += 1;
          continue;
        }

        try {
          const blob = await fetchWithAuth(path, {
            method: 'GET',
            headers: {
              'X-Tenant-ID': this.tenantId,
            },
            responseType: 'blob',
          });
          const fallback = `image_${i + 1}`;
          const { stem, ext } = this._splitFilename(image.filename || fallback);
          const finalExt = ext || this._mimeToExt(blob?.type);
          const baseName = type === 'thumbs' ? `${stem}_thumb` : stem;
          const finalName = `${baseName}${finalExt}`;
          zip.file(`${folderName}/${finalName}`, blob);
          downloaded += 1;
        } catch (_err) {
          failed += 1;
        }
      }

      if (downloaded === 0) {
        throw new Error('No files could be downloaded.');
      }

      this.downloadStatus = 'Creating ZIP...';
      this.requestUpdate();
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const baseTitle = this._sanitizeFilename(this.list?.title || 'shared-collection', 'shared-collection');
      const zipName = `${baseTitle}_${folderName}.zip`;
      const url = URL.createObjectURL(zipBlob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = zipName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      this.downloadStatus = failed > 0
        ? `Downloaded ${downloaded} file(s). ${failed} failed.`
        : `Downloaded ${downloaded} file(s).`;
    } catch (err) {
      this.downloadStatus = err?.message || `Failed to download ${type}.`;
    } finally {
      this.downloadBusy = '';
      this.requestUpdate();
    }
  }

  render() {
    if (this.loading) {
      return html`
        <style>${GUEST_LIST_VIEW_CSS}</style>
        <div class="guest-shell">
          <div class="guest-loading">
            <div style="font-size: 30px;">📸</div>
            <p>Loading collection...</p>
          </div>
        </div>
      `;
    }

    if (this.error) {
      return html`
        <style>${GUEST_LIST_VIEW_CSS}</style>
        <div class="guest-shell">
          <div class="guest-error">
            <div class="guest-error-card">
              <div style="font-size: 30px; margin-bottom: 8px;">⚠️</div>
              <h2 style="font-size: 24px; margin: 0 0 8px 0;">Unable to Load Collection</h2>
              <p style="margin: 0 0 16px 0; color: #6b7280;">${this.error}</p>
              <button @click=${this._handleRetryLoad} class="guest-btn guest-btn-primary">Try Again</button>
            </div>
          </div>
        </div>
      `;
    }

    return html`
      <style>${GUEST_LIST_VIEW_CSS}</style>
      <div class="guest-shell">
        <header class="guest-topbar">
          <div class="guest-topbar-inner">
            <div class="guest-brand">
              <h1 class="guest-brand-title">${this.list?.title || 'Shared Collection'}</h1>
              <p class="guest-brand-subtitle">You have been invited to review this collection</p>
            </div>
            <div class="guest-toolbar">
              ${this.sharePermissions.allow_download_thumbs ? html`
                <button
                  @click=${() => this._handleDownload('thumbs')}
                  class="guest-btn"
                  ?disabled=${this.downloadBusy === 'thumbs'}
                >
                  ${this.downloadBusy === 'thumbs' ? 'Requesting…' : 'Download Thumbs'}
                </button>
              ` : ''}
              ${this.sharePermissions.allow_download_originals ? html`
                <button
                  @click=${() => this._handleDownload('originals')}
                  class="guest-btn guest-btn-primary"
                  ?disabled=${this.downloadBusy === 'originals'}
                >
                  ${this.downloadBusy === 'originals' ? 'Requesting…' : 'Download Full Size'}
                </button>
              ` : ''}
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
                      ${this.userEmail ? html`
                        <div class="guest-user-email" title=${this.userEmail}>${this.userEmail}</div>
                      ` : ''}
                    </div>
                    <button type="button" class="guest-user-action signout" @click=${() => this._handleLogout()}>Sign Out</button>
                  </div>
                ` : ''}
              </div>
            </div>
          </div>
        </header>

        <main class="guest-content">
          <div class="guest-back-row">
            <button @click=${this._handleGoHome} class="guest-btn">Back</button>
          </div>
          ${this.images.length === 0 ? html`
            <div class="guest-panel">
              <div class="guest-empty">
                <div style="font-size: 36px;">📷</div>
                <p>This collection is empty</p>
              </div>
            </div>
          ` : html`
            <section class="guest-panel">
              ${this.downloadStatus ? html`
                <div class="guest-meta-row" style="margin-bottom: 10px; text-transform: none; letter-spacing: 0; color: #4b5563;">
                  ${this.downloadStatus}
                </div>
              ` : ''}
              <div class="guest-feedback-note">
                <strong>Thanks for reviewing this collection.</strong> You can rate and comment on any photo.
                <ul>
                  <li>A green check means you already provided feedback on that image.</li>
                  <li>The trash rating means it is a photo we should not use. If you choose trash, please leave a comment too.</li>
                </ul>
              </div>
              <div class="guest-meta-row">${this.images.length} items</div>
              <div class="guest-grid">
                ${this.images.map((image) => html`
                  ${(() => {
                    const ratingCounts = this._normalizeRatingCounts(image.rating_counts);
                    const ratingSummary = this._summarizeRatings(ratingCounts);
                    const hasRatings = ratingSummary.total > 0;
                    const hasComments = Number(image.comment_count || 0) > 0;
                    const hasReviewed = this.reviewedAssetIds instanceof Set
                      ? this.reviewedAssetIds.has(String(image.id))
                      : false;
                    return html`
                  <button
                    type="button"
                    class="guest-tile"
                    @click=${() => this._handleImageClick(image)}
                    title=${image.filename || 'Image'}
                  >
                    <img
                      src=${image.thumbnail_url || (image.image_id ? `/api/v1/images/${image.image_id}/thumbnail` : '')}
                      alt=${image.filename || 'Image'}
                      loading="lazy"
                    />
                    ${(hasRatings || hasComments) ? html`
                      <div class="guest-tile-stats">
                        ${hasRatings ? html`
                          <span class="guest-tile-stat">★ ${ratingSummary.avgLabel} (${ratingSummary.total})</span>
                        ` : ''}
                        ${hasComments ? html`
                          <span class="guest-tile-stat">💬 ${image.comment_count}</span>
                        ` : ''}
                      </div>
                    ` : ''}
                    ${hasReviewed ? html`
                      <span class="guest-tile-done" title="You reviewed this image">✓</span>
                    ` : ''}
                    <div class="guest-tile-overlay">Click to review</div>
                  </button>
                    `;
                  })()}
                `)}
              </div>
            </section>
          `}

          ${this.drawerOpen && this.selectedImage ? html`
            <guest-annotation-drawer
              .image=${this.selectedImage}
              .listId=${this.listId}
              .tenantId=${this.tenantId}
              @close-drawer=${this._handleCloseDrawer}
              @annotation-saved=${this._handleAnnotationSaved}
            ></guest-annotation-drawer>
          ` : ''}
        </main>
      </div>
    `;
  }
}

customElements.define('guest-list-view', GuestListView);
