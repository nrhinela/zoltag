import { html } from 'lit';

export function renderCurateRatingWidget(host, image) {
  return html`
    <div class="curate-thumb-rating-widget" @click=${(e) => e.stopPropagation()}>
      ${host._curateRatingBurstIds?.has(image.id) ? html`
        <span class="curate-thumb-burst" aria-hidden="true"></span>
      ` : html``}
      <button
        type="button"
        class="curate-thumb-trash cursor-pointer mx-0.5 ${image.rating == 0 ? 'text-red-600' : 'text-gray-600 hover:text-gray-900'}"
        title="0 stars"
        @click=${(e) => host._curateExploreState.handleCurateRating(e, image, 0)}
      >
        ${image.rating == 0 ? '❌' : '🗑'}
      </button>
      <span class="curate-thumb-stars">
        ${[1, 2, 3].map((star) => html`
          <button
            type="button"
            class="cursor-pointer mx-0.5 ${image.rating && image.rating >= star ? 'text-yellow-500' : 'text-gray-500 hover:text-gray-900'}"
            title="${star} star${star > 1 ? 's' : ''}"
            @click=${(e) => host._curateExploreState.handleCurateRating(e, image, star)}
          >
            ${image.rating && image.rating >= star ? '★' : '☆'}
          </button>
        `)}
      </span>
    </div>
  `;
}

export function renderCurateRatingStatic(image) {
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
