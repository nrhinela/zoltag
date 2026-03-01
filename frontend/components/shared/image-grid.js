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
import { formatDateTime, formatDurationMs } from './formatting.js';

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

function collectTagLabels(image) {
  const labels = [];
  const add = (value) => {
    const normalized = String(value || '').trim();
    if (normalized) labels.push(normalized);
  };

  const calculated = Array.isArray(image?.calculated_tags) ? image.calculated_tags : [];
  calculated.forEach((tag) => add(tag?.keyword || tag?.name || tag));

  const permatags = Array.isArray(image?.permatags) ? image.permatags : [];
  permatags.forEach((tag) => {
    if (Number(tag?.signum) === 1) {
      add(tag?.keyword || tag?.name || tag);
    }
  });

  const machineTags = Array.isArray(image?.tags) ? image.tags : [];
  machineTags.forEach((tag) => add(tag?.keyword || tag?.name || tag));

  return Array.from(new Set(labels));
}

function formatDimensions(image) {
  const width = Number(image?.width);
  const height = Number(image?.height);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return `${width} × ${height}`;
  }
  return 'Unknown';
}

function renderDefaultListDetails(image, mediaType, videoDuration) {
  const sourcePath = String(
    image?.source_display_path
    || image?.dropbox_path
    || image?.source_key
    || image?.filename
    || ''
  ).trim() || 'Unknown';
  const ratingValue = image?.rating === null || image?.rating === undefined || image?.rating === ''
    ? 'Unrated'
    : String(image.rating);
  const tags = collectTagLabels(image);
  const mediaLabel = mediaType === 'video'
    ? `Video${videoDuration ? ` (${videoDuration})` : ''}`
    : 'Image';

  return html`
    <div class="curate-list-meta-grid">
      <div><span class="curate-list-meta-label">asset.id:</span> ${String(image?.asset_id || '—')}</div>
      <div><span class="curate-list-meta-label">image_metadata.id:</span> ${String(image?.id || '—')}</div>
      <div><span class="curate-list-meta-label">Photo date:</span> ${formatDateTime(image?.capture_timestamp || image?.photo_creation)}</div>
      <div><span class="curate-list-meta-label">Ingested date:</span> ${formatDateTime(image?.created_at || image?.last_processed)}</div>
      <div class="curate-list-meta-span"><span class="curate-list-meta-label">Filepath:</span> ${sourcePath}</div>
      <div><span class="curate-list-meta-label">Dimensions:</span> ${formatDimensions(image)}</div>
      <div><span class="curate-list-meta-label">Type:</span> ${mediaLabel}</div>
      <div><span class="curate-list-meta-label">Rating:</span> ${ratingValue}</div>
      <div class="curate-list-meta-span"><span class="curate-list-meta-label">Tags:</span> ${tags.length ? tags.join(', ') : 'None'}</div>
    </div>
  `;
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
 * @param {string} config.options.viewMode - 'thumb' (default) or 'list'
 * @param {Function} config.options.renderListDetails - Optional custom details renderer for list rows
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
    onOpenSimilarInSearch,
  } = eventHandlers;

  const {
    enableReordering = false,
    showPermatags = false,
    showAiScore = false,
    emptyMessage = 'No images available.',
    renderItemFooter,
    pinnedImageIds = null,
    pinnedLabel = 'Source',
    viewMode = 'thumb',
    renderListDetails = null,
  } = options;
  const isListMode = viewMode === 'list';

  const pinnedIdSet = pinnedImageIds instanceof Set
    ? pinnedImageIds
    : new Set(Array.isArray(pinnedImageIds) ? pinnedImageIds : []);

  const safeImages = (images || []).filter((image) => {
    if (!image) return false;
    const id = Number(image.id);
    return Number.isFinite(id) && id > 0;
  });
  const selectedKeySet = new Set(
    (Array.isArray(selection) ? selection : [])
      .filter((value) => value !== null && value !== undefined && value !== '')
      .map((value) => String(value))
  );

  if (!safeImages.length) {
    return html`
      <div class="curate-drop">
        ${emptyMessage}
      </div>
    `;
  }

  return html`
    <div class="${isListMode ? 'curate-list' : 'curate-grid'}">
      ${safeImages.map((image, index) => {
        const imageId = Number(image.id);
        const imageIdKey = String(image.id);
        const isSelected = selectedKeySet.has(String(imageId)) || selectedKeySet.has(imageIdKey);
        const isFlashing = flashSelectionIds?.has(image.id);
        const isPinned = pinnedIdSet.has(imageId) || pinnedIdSet.has(image.id);
        const mediaType = inferMediaType(image);
        const isVideo = mediaType === 'video';
        const videoDuration = isVideo ? formatDurationMs(image?.duration_ms) : '';
        const hasRating = !(image?.rating === null || image?.rating === undefined || image?.rating === '');
        const sourceAssetUuid = String(image?.asset_id || image?.asset_uuid || '').trim() || null;
        const emitOpenSimilarInSearch = (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (onOpenSimilarInSearch) {
            onOpenSimilarInSearch(event, image, safeImages);
            return;
          }
          const target = event.currentTarget;
          if (!target || typeof target.dispatchEvent !== 'function') return;
          target.dispatchEvent(new CustomEvent('open-similar-in-search', {
            bubbles: true,
            composed: true,
            detail: {
              sourceImage: image,
              sourceAssetUuid,
              images: [],
            },
          }));
        };

        if (isListMode) {
          const details = typeof renderListDetails === 'function'
            ? renderListDetails(image)
            : renderDefaultListDetails(image, mediaType, videoDuration);
          return html`
            <div
              class="curate-thumb-wrapper curate-list-row ${isSelected ? 'selected' : ''} ${isPinned ? 'pinned-source' : ''}"
              data-image-id="${imageId}"
              draggable="true"
              @dragstart=${(event) => onDragStart?.(event, image)}
              @dragover=${enableReordering ? (event) => onDragOver?.(event, imageId) : null}
              @dragend=${enableReordering ? (event) => onDragEnd?.(event) : null}
              @click=${(event) => onImageClick?.(event, image)}
              @pointerdown=${(event) => onPointerDown?.(event, index, imageId)}
              @pointermove=${(event) => onPointerMove?.(event)}
              @pointerenter=${() => onPointerEnter?.(index)}
            >
              <div class="curate-list-thumb-shell">
                <img
                  src=${image.thumbnail_url || `/api/v1/images/${imageId}/thumbnail`}
                  alt=${image.filename}
                  class="curate-thumb curate-list-thumb ${isSelected ? 'selected' : ''} ${isFlashing ? 'flash' : ''}"
                  draggable="false"
                  @error=${(e) => { const fallback = `/api/v1/images/${imageId}/thumbnail`; if (e.target.src !== fallback) e.target.src = fallback; }}
                >
                ${isPinned ? html`
                  <span class="curate-thumb-pin-badge" aria-label="${pinnedLabel} image">
                    ${pinnedLabel}
                  </span>
                ` : html``}
                ${isVideo ? html`
                  <span class="curate-thumb-play-overlay" aria-hidden="true">
                    <svg
                      class="curate-thumb-play-icon"
                      viewBox="0 0 24 24"
                      focusable="false"
                    >
                      <path d="M8 6v12l10-6z"></path>
                    </svg>
                  </span>
                ` : html``}
              </div>
              <div class="curate-list-details">
                ${details}
              </div>
            </div>
          `;
        }
        const thumb = html`
          <div
            class="curate-thumb-wrapper ${isSelected ? 'selected' : ''} ${isPinned ? 'pinned-source' : ''}"
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
              @error=${(e) => { const fallback = `/api/v1/images/${imageId}/thumbnail`; if (e.target.src !== fallback) e.target.src = fallback; }}
              @pointerdown=${(event) => onPointerDown?.(event, index, imageId)}
              @pointermove=${(event) => onPointerMove?.(event)}
              @pointerenter=${() => onPointerEnter?.(index)}
            >
            ${isPinned ? html`
              <span class="curate-thumb-pin-badge" aria-label="${pinnedLabel} image">
                ${pinnedLabel}
              </span>
            ` : html``}
            ${isVideo ? html`
              <span class="curate-thumb-play-overlay" aria-hidden="true">
                <svg
                  class="curate-thumb-play-icon"
                  viewBox="0 0 24 24"
                  focusable="false"
                >
                  <path d="M8 6v12l10-6z"></path>
                </svg>
              </span>
            ` : html``}
            ${renderCurateRatingWidget ? renderCurateRatingWidget(image) : ''}
            ${renderCurateRatingStatic ? renderCurateRatingStatic(image) : ''}
            ${isVideo ? html`
              <div class="curate-thumb-media-pill ${hasRating ? 'has-rating' : ''}">
                <span class="curate-thumb-media-pill-label">VIDEO</span>
                ${videoDuration ? html`<span class="curate-thumb-media-pill-duration">${videoDuration}</span>` : html``}
              </div>
            ` : html``}
            <button
              type="button"
              class="curate-thumb-similar-link"
              title="Similar"
              aria-label="Similar"
              draggable="false"
              tabindex="-1"
              @pointerdown=${(event) => event.stopPropagation()}
              @click=${emitOpenSimilarInSearch}
            >
              <span class="curate-thumb-similar-link-icon" aria-hidden="true">≈</span>
            </button>
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
