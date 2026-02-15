/**
 * image-grid.js - Shared image grid rendering utility (canonical)
 *
 * Provides a reusable image grid rendering function that eliminates code duplication
 * across components (search-tab, curate-explore-tab, curate-audit, etc.).
 *
 * This utility was created to replace hundreds of lines of duplicated image rendering
 * code throughout the application.
 *
 * @module image-grid-renderer
 */

import { html } from 'lit';
import { formatDurationMs } from './formatting.js';

function inferMediaType(image) {
  const mediaType = String(image?.media_type || '').trim().toLowerCase();
  if (mediaType === 'video' || mediaType === 'image') {
    return mediaType;
  }
  const mimeType = String(image?.mime_type || '').trim().toLowerCase();
  if (mimeType.startsWith('video/')) {
    return 'video';
  }
  return 'image';
}

/**
 * Renders an image grid with full selection, drag & drop, and interaction support
 *
 * @param {Object} config - Configuration object
 * @param {Array} config.images - Array of image objects to render
 * @param {Array} config.selection - Array of selected image IDs
 * @param {Set} config.flashSelectionIds - Set of image IDs currently flashing
 * @param {Object} config.selectionHandlers - Selection handlers from createSelectionHandlers()
 * @param {Object} config.renderFunctions - Rendering helper functions
 * @param {Function} config.renderFunctions.renderCurateRatingWidget - Rating widget renderer
 * @param {Function} config.renderFunctions.renderCurateRatingStatic - Static rating renderer
 * @param {Function} config.renderFunctions.renderCuratePermatagSummary - Permatag summary renderer (optional)
 * @param {Function} config.renderFunctions.renderCurateAiMLScore - AI/ML score renderer (optional)
 * @param {Function} config.renderFunctions.formatCurateDate - Date formatter
 * @param {Object} config.eventHandlers - Event handler functions
 * @param {Function} config.eventHandlers.onImageClick - Image click handler (event, image)
 * @param {Function} config.eventHandlers.onDragStart - Drag start handler (event, image)
 * @param {Function} config.eventHandlers.onDragOver - Drag over handler (event, targetImageId) - optional for reordering
 * @param {Function} config.eventHandlers.onDragEnd - Drag end handler (event) - optional for reordering
 * @param {Function} config.eventHandlers.onPointerDown - Pointer down handler (event, index, imageId)
 * @param {Function} config.eventHandlers.onPointerMove - Pointer move handler (event)
 * @param {Function} config.eventHandlers.onPointerEnter - Pointer enter handler (index)
 * @param {Object} config.options - Optional configuration
 * @param {boolean} config.options.enableReordering - Enable drag & drop reordering (default: false)
 * @param {boolean} config.options.showPermatags - Show permatag summary (default: false)
 * @param {boolean} config.options.showAiScore - Show AI/ML score (default: false)
 * @param {string} config.options.emptyMessage - Message when no images (default: "No images available.")
 * @param {Function} config.options.renderItemFooter - Optional render function for per-item footer content
 *
 * @returns {TemplateResult} Lit HTML template
 *
 * @example
 * // In your component's render() method:
 * ${renderImageGrid({
 *   images: this.searchImages,
 *   selection: this.searchDragSelection,
 *   flashSelectionIds: this._searchFlashSelectionIds,
 *   selectionHandlers: this._searchSelectionHandlers,
 *   renderFunctions: {
 *     renderCurateRatingWidget: this.renderCurateRatingWidget,
 *     renderCurateRatingStatic: this.renderCurateRatingStatic,
 *     formatCurateDate: this.formatCurateDate,
 *   },
 *   eventHandlers: {
 *     onImageClick: (event, image) => this._handleSearchImageClick(event, image),
 *     onDragStart: (event, image) => this._handleSearchDragStart(event, image),
 *     onPointerDown: (event, index, imageId) => this._handleSearchPointerDown(event, index, imageId),
 *     onPointerMove: (event) => this._handleSearchPointerMove(event),
 *     onPointerEnter: (index) => this._handleSearchSelectHover(index),
 *   },
 * })}
 */
export function renderImageGrid(config) {
  const {
    images = [],
    selection = [],
    flashSelectionIds = new Set(),
    selectionHandlers,
    renderFunctions = {},
    eventHandlers = {},
    options = {},
  } = config;

  const {
    renderCurateRatingWidget,
    renderCurateRatingStatic,
    renderCuratePermatagSummary,
    renderCurateAiMLScore,
    formatCurateDate,
  } = renderFunctions;

  const {
    onImageClick,
    onDragStart,
    onDragOver,
    onDragEnd,
    onPointerDown,
    onPointerMove,
    onPointerEnter,
  } = eventHandlers;

  const {
    enableReordering = false,
    showPermatags = false,
    showAiScore = false,
    emptyMessage = 'No images available.',
    renderItemFooter,
  } = options;

  const safeImages = (images || []).filter((image) => {
    if (!image) return false;
    const id = Number(image.id);
    return Number.isFinite(id) && id > 0;
  });

  if (!safeImages.length) {
    return html`
      <div class="curate-drop">
        ${emptyMessage}
      </div>
    `;
  }

  return html`
    <div class="curate-grid">
      ${safeImages.map((image, index) => {
        const imageId = Number(image.id);
        const isSelected = selection.includes(imageId) || selection.includes(image.id);
        const isFlashing = flashSelectionIds?.has(image.id);
        const mediaType = inferMediaType(image);
        const isVideo = mediaType === 'video';
        const videoDuration = isVideo ? formatDurationMs(image?.duration_ms) : '';
        const hasRating = !(image?.rating === null || image?.rating === undefined || image?.rating === '');
        const thumb = html`
          <div
            class="curate-thumb-wrapper ${isSelected ? 'selected' : ''}"
            data-image-id="${imageId}"
            draggable="true"
            @dragstart=${(event) => onDragStart?.(event, image)}
            @dragover=${enableReordering ? (event) => onDragOver?.(event, imageId) : null}
            @dragend=${enableReordering ? (event) => onDragEnd?.(event) : null}
            @click=${(event) => onImageClick?.(event, image)}
          >
            <img
              src=${image.thumbnail_url || `/api/v1/images/${imageId}/thumbnail`}
              alt=${image.filename}
              class="curate-thumb ${isSelected ? 'selected' : ''} ${isFlashing ? 'flash' : ''}"
              draggable="false"
              @pointerdown=${(event) => onPointerDown?.(event, index, imageId)}
              @pointermove=${(event) => onPointerMove?.(event)}
              @pointerenter=${() => onPointerEnter?.(index)}
            >
            ${renderCurateRatingWidget ? renderCurateRatingWidget(image) : ''}
            ${renderCurateRatingStatic ? renderCurateRatingStatic(image) : ''}
            ${isVideo ? html`
              <div class="curate-thumb-media-pill ${hasRating ? 'has-rating' : ''}">
                <span class="curate-thumb-media-pill-label">VIDEO</span>
                ${videoDuration ? html`<span class="curate-thumb-media-pill-duration">${videoDuration}</span>` : html``}
              </div>
            ` : html``}
            ${showAiScore && renderCurateAiMLScore ? renderCurateAiMLScore(image) : ''}
            ${showPermatags && renderCuratePermatagSummary ? renderCuratePermatagSummary(image) : ''}
            ${formatCurateDate && formatCurateDate(image) ? html`
              <div class="curate-thumb-date">
                <span class="curate-thumb-id">#${image.id}</span>
                <span class="curate-thumb-icon" aria-hidden="true">${isVideo ? '🎬' : '📷'}</span>${formatCurateDate(image)}
              </div>
            ` : ''}
          </div>
        `;

        if (renderItemFooter) {
          return html`
            <div class="curate-thumb-tile">
              ${thumb}
              <div class="curate-thumb-footer">
                ${renderItemFooter(image)}
              </div>
            </div>
          `;
        }

        return thumb;
      })}
    </div>
  `;
}
