import { LitElement, html } from 'lit';

const GUEST_REVIEW_MODAL_CSS = `
  .modal {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 70;
    background: rgba(15, 23, 42, 0.65);
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .modal.open {
    display: flex;
  }
  .panel {
    background: #ffffff;
    border-radius: 16px;
    width: min(1100px, 95vw);
    height: min(86vh, 860px);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 45px rgba(15, 23, 42, 0.25);
  }
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid #e5e7eb;
    background: #ffffff;
  }
  .panel-title {
    font-size: 16px;
    font-weight: 600;
    color: #111827;
    margin: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .panel-close {
    font-size: 22px;
    color: #6b7280;
    line-height: 1;
    border: none;
    background: transparent;
    cursor: pointer;
    padding: 4px;
  }
  .panel-close:hover {
    color: #111827;
  }
  .panel-body {
    display: grid;
    grid-template-columns: 1.1fr 0.9fr;
    gap: 18px;
    padding: 18px;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .guest-review-left {
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: #ffffff;
  }
  .guest-review-image-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f8fafc;
    position: relative;
  }
  .guest-review-image-wrap img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    display: block;
  }
  .guest-full-image-loading {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid #e5e7eb;
    background: rgba(17, 24, 39, 0.75);
    color: #f9fafb;
    font-size: 11px;
    box-shadow: 0 6px 16px rgba(15, 23, 42, 0.25);
  }
  .guest-full-image-loading-center {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.72;
    pointer-events: none;
  }
  .guest-full-image-loading-center-icon {
    width: 22px;
    height: 22px;
    border-radius: 999px;
    border: 2px solid rgba(17, 24, 39, 0.22);
    border-top-color: rgba(17, 24, 39, 0.55);
    background: rgba(255, 255, 255, 0.25);
    backdrop-filter: blur(1px);
    animation: guest-full-image-spin 0.8s linear infinite;
  }
  .guest-full-image-spinner {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    border: 2px solid rgba(255, 255, 255, 0.4);
    border-top-color: #fbbf24;
    animation: guest-full-image-spin 0.8s linear infinite;
  }
  @keyframes guest-full-image-spin {
    to { transform: rotate(360deg); }
  }
  .guest-review-meta {
    padding: 10px 12px;
    border-top: 1px solid #e5e7eb;
    background: #f9fafb;
  }
  .guest-review-filename {
    font-size: 13px;
    color: #374151;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .guest-review-date {
    margin-top: 4px;
    font-size: 12px;
    color: #6b7280;
  }
  .guest-review-right {
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    overflow: auto;
    background: #ffffff;
    padding: 14px;
    min-height: 0;
  }
  .guest-section + .guest-section {
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid #e5e7eb;
  }
  .guest-section-title {
    margin: 0 0 10px 0;
    font-size: 14px;
    font-weight: 700;
    color: #111827;
  }
  .guest-stars {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .guest-trash-btn {
    border: none;
    background: transparent;
    font-size: 24px;
    line-height: 1;
    cursor: pointer;
    padding: 0 2px;
    color: #6b7280;
    margin-right: 10px;
  }
  .guest-star-btn {
    border: none;
    background: transparent;
    font-size: 28px;
    line-height: 1;
    cursor: pointer;
    padding: 0;
    color: #9ca3af;
  }
  .guest-star-btn.selected {
    color: #f59e0b;
  }
  .guest-star-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .guest-trash-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .guest-rating-note {
    margin-top: 8px;
    font-size: 12px;
    color: #6b7280;
  }
  .guest-comments {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 10px;
  }
  .guest-comment-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
  }
  .guest-add-comment-btn {
    border: 1px solid #2563eb;
    background: #eff6ff;
    color: #1d4ed8;
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .guest-add-comment-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .guest-sort-btn {
    border: 1px solid #d1d5db;
    background: #ffffff;
    color: #374151;
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .guest-form-wrap {
    margin-top: 10px;
  }
  .guest-comment {
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    background: #f9fafb;
    padding: 10px;
  }
  .guest-comment-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 10px;
  }
  .guest-comment-text {
    font-size: 13px;
    color: #111827;
    margin: 0;
    line-height: 1.4;
  }
  .guest-comment-author {
    margin: 0 0 6px 0;
    font-size: 11px;
    color: #4b5563;
    font-weight: 700;
  }
  .guest-comment-date {
    margin-top: 6px;
    font-size: 11px;
    color: #6b7280;
  }
  .guest-delete-btn {
    border: 1px solid #fecaca;
    color: #b91c1c;
    background: #fef2f2;
    border-radius: 8px;
    font-size: 11px;
    padding: 4px 8px;
    cursor: pointer;
    white-space: nowrap;
  }
  .guest-delete-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .guest-empty-comments {
    font-size: 12px;
    color: #6b7280;
    margin: 0 0 10px 0;
  }
  .guest-comment-input {
    width: 100%;
    min-height: 92px;
    border: 1px solid #d1d5db;
    border-radius: 10px;
    padding: 10px;
    resize: vertical;
    font-size: 13px;
    box-sizing: border-box;
  }
  .guest-save-btn {
    margin-top: 8px;
    width: 100%;
    border: 1px solid #2563eb;
    background: #2563eb;
    color: #ffffff;
    border-radius: 10px;
    padding: 10px 12px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .guest-save-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .guest-help {
    margin-top: 12px;
    border: 1px solid #dbeafe;
    background: #eff6ff;
    color: #1e3a8a;
    border-radius: 10px;
    padding: 10px;
    font-size: 12px;
    line-height: 1.4;
  }
  @media (max-width: 960px) {
    .panel {
      width: 96vw;
      height: 92vh;
    }
    .panel-body {
      grid-template-columns: 1fr;
      overflow: auto;
    }
    .guest-review-left {
      min-height: 280px;
    }
    .guest-review-right {
      overflow: visible;
    }
  }
`;

/**
 * Guest review modal for ratings/comments.
 * Reuses the app image modal treatment (backdrop + centered panel + split layout).
 */
export class GuestAnnotationDrawer extends LitElement {
  createRenderRoot() {
    return this;
  }

  static properties = {
    image: { type: Object },
    listId: { type: Number },
    tenantId: { type: String },
    loading: { type: Boolean },
    currentRating: { type: Number },
    commentText: { type: String },
    myComments: { type: Array },
    commentFormOpen: { type: Boolean },
    commentSortDesc: { type: Boolean },
    fullImageUrl: { type: String },
    fullImageLoading: { type: Boolean },
  };

  constructor() {
    super();
    this.image = null;
    this.listId = null;
    this.tenantId = null;
    this.loading = false;
    this.currentRating = null;
    this.commentText = '';
    this.myComments = [];
    this.commentFormOpen = false;
    this.commentSortDesc = true;
    this.fullImageUrl = '';
    this.fullImageLoading = false;
    this._fullImageObjectUrl = null;
  }

  get _sortedComments() {
    const comments = Array.isArray(this.myComments) ? [...this.myComments] : [];
    comments.sort((a, b) => {
      const aTs = new Date(a?.created_at || 0).getTime();
      const bTs = new Date(b?.created_at || 0).getTime();
      return this.commentSortDesc ? bTs - aTs : aTs - bTs;
    });
    return comments;
  }

  async connectedCallback() {
    super.connectedCallback();
    await this._loadMyReactions();
    await this._loadFullImage();
  }

  disconnectedCallback() {
    this._revokeFullImageObjectUrl();
    super.disconnectedCallback();
  }

  async updated(changedProperties) {
    if (changedProperties.has('image') || changedProperties.has('listId') || changedProperties.has('tenantId')) {
      await this._loadFullImage();
    }
  }

  _revokeFullImageObjectUrl() {
    if (this._fullImageObjectUrl) {
      URL.revokeObjectURL(this._fullImageObjectUrl);
      this._fullImageObjectUrl = null;
    }
  }

  async _loadFullImage() {
    if (!this.image?.id || !this.listId || !this.tenantId) {
      this._revokeFullImageObjectUrl();
      this.fullImageUrl = '';
      return;
    }

    this.fullImageLoading = true;
    try {
      const { fetchWithAuth } = await import('../services/api.js');
      const blob = await fetchWithAuth(`/guest/lists/${this.listId}/assets/${this.image.id}/full`, {
        method: 'GET',
        headers: { 'X-Tenant-ID': this.tenantId },
        responseType: 'blob',
      });

      this._revokeFullImageObjectUrl();
      const objectUrl = URL.createObjectURL(blob);
      this._fullImageObjectUrl = objectUrl;
      this.fullImageUrl = objectUrl;
    } catch (err) {
      console.warn('Failed to load full image for guest detail; falling back to thumbnail.', err);
      this._revokeFullImageObjectUrl();
      this.fullImageUrl = '';
    } finally {
      this.fullImageLoading = false;
      this.requestUpdate();
    }
  }

  async _loadMyReactions() {
    if (!this.listId || !this.tenantId) return;

    try {
      const { fetchWithAuth } = await import('../services/api.js');
      const data = await fetchWithAuth(`/guest/lists/${this.listId}/my-reactions`, {
        method: 'GET',
        headers: {
          'X-Tenant-ID': this.tenantId,
        },
      });

      const rating = data.ratings?.find((r) => r.asset_id === this.image?.id);
      if (rating) {
        this.currentRating = rating.rating;
      }

      this.myComments = data.comments?.filter((c) => c.asset_id === this.image?.id) || [];
      this.requestUpdate();
    } catch (err) {
      console.error('Failed to load reactions:', err);
    }
  }

  async _handleRatingClick(rating) {
    if (this.loading) return;

    this.loading = true;
    const previousRating = this.currentRating;
    this.currentRating = rating;
    this.requestUpdate();

    try {
      const { fetchWithAuth } = await import('../services/api.js');
      await fetchWithAuth(`/guest/lists/${this.listId}/reactions`, {
        method: 'POST',
        headers: {
          'X-Tenant-ID': this.tenantId,
        },
        body: JSON.stringify({
          asset_id: this.image.id,
          rating,
        }),
      });

      this.dispatchEvent(new CustomEvent('annotation-saved', {
        detail: { type: 'rating', rating },
        bubbles: true,
        composed: true,
      }));
    } catch (err) {
      console.error('Failed to save rating:', err);
      this.currentRating = previousRating;
      alert('Failed to save rating. Please try again.');
    } finally {
      this.loading = false;
      this.requestUpdate();
    }
  }

  async _handleCommentSubmit(e) {
    e.preventDefault();
    const text = this.commentText.trim();
    if (!text || this.loading) return;

    this.loading = true;
    try {
      const { fetchWithAuth } = await import('../services/api.js');
      const newComment = await fetchWithAuth(`/guest/lists/${this.listId}/comments`, {
        method: 'POST',
        headers: {
          'X-Tenant-ID': this.tenantId,
        },
        body: JSON.stringify({
          asset_id: this.image.id,
          comment_text: text,
        }),
      });

      this.myComments = [...this.myComments, newComment];
      this.commentText = '';
      this.commentFormOpen = false;

      this.dispatchEvent(new CustomEvent('annotation-saved', {
        detail: { type: 'comment', comment: newComment },
        bubbles: true,
        composed: true,
      }));
    } catch (err) {
      console.error('Failed to save comment:', err);
      alert('Failed to save comment. Please try again.');
    } finally {
      this.loading = false;
      this.requestUpdate();
    }
  }

  async _handleDeleteComment(commentId) {
    if (!confirm('Delete this comment?')) return;
    this.loading = true;

    try {
      const { fetchWithAuth } = await import('../services/api.js');
      await fetchWithAuth(`/guest/lists/${this.listId}/comments/${commentId}`, {
        method: 'DELETE',
        headers: {
          'X-Tenant-ID': this.tenantId,
        },
      });

      this.myComments = this.myComments.filter((c) => c.id !== commentId);
    } catch (err) {
      console.error('Failed to delete comment:', err);
      alert('Failed to delete comment. Please try again.');
    } finally {
      this.loading = false;
      this.requestUpdate();
    }
  }

  _handleClose() {
    this.dispatchEvent(new CustomEvent('close-drawer', {
      bubbles: true,
      composed: true,
    }));
  }

  _formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleString();
  }

  render() {
    if (!this.image) return html``;

    return html`
      <style>${GUEST_REVIEW_MODAL_CSS}</style>
      <div class="modal open" @click=${this._handleClose}>
        <div class="panel" @click=${(e) => e.stopPropagation()}>
          <div class="panel-header">
            <h3 class="panel-title">Review image</h3>
            <button class="panel-close" @click=${this._handleClose} aria-label="Close">&times;</button>
          </div>

          <div class="panel-body">
            <section class="guest-review-left">
              <div class="guest-review-image-wrap">
                <img
                  src=${this.fullImageUrl || this.image.thumbnail_url || (this.image.image_id ? `/api/v1/images/${this.image.image_id}/thumbnail` : '')}
                  alt=${this.image.filename || 'Image'}
                />
                ${this.fullImageLoading ? html`
                  <div class="guest-full-image-loading-center" aria-hidden="true">
                    <span class="guest-full-image-loading-center-icon"></span>
                  </div>
                  <div class="guest-full-image-loading" aria-live="polite">
                    <span class="guest-full-image-spinner" aria-hidden="true"></span>
                    Loading full-size image...
                  </div>
                ` : ''}
              </div>
              <div class="guest-review-meta">
                <div class="guest-review-filename">${this.image.filename || 'Untitled'}</div>
                ${this.image.date_taken ? html`
                  <div class="guest-review-date">Taken: ${this._formatDate(this.image.date_taken)}</div>
                ` : ''}
              </div>
            </section>

            <section class="guest-review-right">
              <div class="guest-section">
                <h4 class="guest-section-title">Your Rating</h4>
                <div class="guest-stars">
                  <button
                    type="button"
                    class="guest-trash-btn"
                    @click=${() => this._handleRatingClick(0)}
                    ?disabled=${this.loading}
                    aria-label="Mark as trash"
                    title="Trash (0)"
                  >
                    ${this.currentRating === 0 ? '❌' : '🗑'}
                  </button>
                  ${[1, 2, 3].map((star) => html`
                    <button
                      type="button"
                      class="guest-star-btn ${star <= (this.currentRating || 0) ? 'selected' : ''}"
                      @click=${() => this._handleRatingClick(star)}
                      ?disabled=${this.loading}
                      aria-label=${`Rate ${star} star${star > 1 ? 's' : ''}`}
                    >
                      ${star <= (this.currentRating || 0) ? '★' : '☆'}
                    </button>
                  `)}
                </div>
                <div class="guest-rating-note">
                  ${this.currentRating === 0
                    ? 'You marked this image as trash.'
                    : this.currentRating
                      ? `You rated this ${this.currentRating} star${this.currentRating > 1 ? 's' : ''}.`
                      : 'Choose trash or 1-3 stars.'}
                </div>
              </div>

              <div class="guest-section">
                <h4 class="guest-section-title">Your Comments</h4>

                <div class="guest-comment-actions">
                  <button
                    type="button"
                    class="guest-add-comment-btn"
                    @click=${() => { this.commentFormOpen = !this.commentFormOpen; }}
                    ?disabled=${this.loading}
                  >
                    ${this.commentFormOpen ? 'Hide New Comment' : 'New Comment'}
                  </button>
                  <button
                    type="button"
                    class="guest-sort-btn"
                    @click=${() => { this.commentSortDesc = !this.commentSortDesc; }}
                    ?disabled=${this.loading}
                    title="Toggle sort order"
                  >
                    ${this.commentSortDesc ? 'Newest first ↓' : 'Oldest first ↑'}
                  </button>
                </div>

                ${this.commentFormOpen ? html`
                  <form class="guest-form-wrap" @submit=${this._handleCommentSubmit}>
                    <textarea
                      class="guest-comment-input"
                      placeholder="Add a comment about this image..."
                      .value=${this.commentText}
                      @input=${(e) => { this.commentText = e.target.value; }}
                      ?disabled=${this.loading}
                    ></textarea>
                    <button
                      type="submit"
                      class="guest-save-btn"
                      ?disabled=${this.loading || !this.commentText.trim()}
                    >
                      ${this.loading ? 'Saving...' : 'Save Comment'}
                    </button>
                  </form>
                ` : ''}

                ${this._sortedComments.length > 0 ? html`
                  <div class="guest-comments">
                    ${this._sortedComments.map((comment) => html`
                      <div class="guest-comment">
                        <div class="guest-comment-row">
                          <div>
                            <p class="guest-comment-author">
                              ${comment.author_name || comment.author_email || 'Guest'}
                            </p>
                            <p class="guest-comment-text">${comment.comment_text}</p>
                          </div>
                          ${comment.can_delete ? html`
                            <button
                              type="button"
                              class="guest-delete-btn"
                              @click=${() => this._handleDeleteComment(comment.id)}
                              ?disabled=${this.loading}
                            >
                              Delete
                            </button>
                          ` : ''}
                        </div>
                        <div class="guest-comment-date">${this._formatDate(comment.created_at)}</div>
                      </div>
                    `)}
                  </div>
                ` : html`
                  <p class="guest-empty-comments">No comments yet.</p>
                `}

                <div class="guest-help">
                  Your feedback helps the collection owner review and improve this collection.
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('guest-annotation-drawer', GuestAnnotationDrawer);
