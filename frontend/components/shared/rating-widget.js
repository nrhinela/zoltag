import { html } from 'lit';

/**
 * Render an interactive rating widget for an image
 * @param {Object} image - Image object with id and rating
 * @param {Function} onRatingChange - Callback (event, image, newRating) => void
 * @param {Set} burstIds - Optional set of image IDs to show burst animation
 * @returns {TemplateResult}
 */
export function renderRatingWidget(image, onRatingChange, burstIds = null) {
  return html`
    <div class="curate-thumb-rating-widget" @click=${(e) => e.stopPropagation()}>
      ${burstIds?.has(image.id) ? html`
        <span class="curate-thumb-burst" aria-hidden="true"></span>
      ` : html``}
      <button
        type="button"
        class="curate-thumb-trash cursor-pointer mx-0.5 ${image.rating == 0 ? 'text-red-600' : 'text-gray-600 hover:text-gray-900'}"
        title="0 stars"
        @click=${(e) => onRatingChange(e, image, 0)}
      >
        ${image.rating == 0 ? '❌' : '🗑'}
      </button>
      <span class="curate-thumb-stars">
        ${[1, 2, 3].map((star) => html`
          <button
            type="button"
            class="cursor-pointer mx-0.5 ${image.rating && image.rating >= star ? 'text-yellow-500' : 'text-gray-500 hover:text-gray-900'}"
            title="${star} star${star > 1 ? 's' : ''}"
            @click=${(e) => onRatingChange(e, image, star)}
          >
            ${image.rating && image.rating >= star ? '★' : '☆'}
          </button>
        `)}
      </span>
    </div>
  `;
}

/**
 * Render a static (non-interactive) rating display
 * @param {Object} image - Image object with rating property
 * @returns {TemplateResult}
 */
export function renderRatingStatic(image) {
  if (image?.rating === null || image?.rating === undefined || image?.rating === '') {
    return html``;
  }
  return html`
    <div class="curate-thumb-rating-static" aria-label="Rating ${image.rating}">
      ${[1, 2, 3].map((star) => html`
        <span class=${image.rating >= star ? 'text-yellow-500' : 'text-gray-400'}>
          ${image.rating >= star ? '★' : '☆'}
        </span>
      `)}
    </div>
  `;
}
