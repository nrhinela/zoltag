import { renderImageGrid } from './image-grid.js';

/**
 * Render a selectable image grid with standardized pointer/selection wiring.
 * This prevents feature views (for example History) from accidentally omitting
 * selection interactions that exist in Results views.
 */
export function renderSelectableImageGrid(config) {
  const {
    images = [],
    selection = [],
    flashSelectionIds = new Set(),
    selectionHandlers = null,
    renderFunctions = {},
    onImageClick,
    onDragStart,
    selectionEvents = {},
    dragHandlers = {},
    options = {},
  } = config || {};

  const safeImages = Array.isArray(images) ? images : [];
  const derivedOrder = safeImages
    .map((image) => image?.id)
    .filter((id) => id !== null && id !== undefined);
  const order = Array.isArray(selectionEvents.order) ? selectionEvents.order : derivedOrder;
  const groupKey = selectionEvents.groupKey ?? null;

  return renderImageGrid({
    images: safeImages,
    selection,
    flashSelectionIds,
    selectionHandlers,
    renderFunctions,
    eventHandlers: {
      onImageClick: (event, image) => onImageClick?.(event, image, safeImages),
      onDragStart: (event, image) => onDragStart?.(event, image, safeImages),
      onDragOver: dragHandlers.onDragOver,
      onDragEnd: dragHandlers.onDragEnd,
      onPointerDown: selectionEvents.pointerDown
        ? (event, index, imageId) => selectionEvents.pointerDown(event, index, imageId, order, groupKey)
        : undefined,
      onPointerMove: selectionEvents.pointerMove
        ? (event) => selectionEvents.pointerMove(event)
        : undefined,
      onPointerEnter: selectionEvents.pointerEnter
        ? (index) => selectionEvents.pointerEnter(index, order, groupKey)
        : undefined,
    },
    options,
  });
}

