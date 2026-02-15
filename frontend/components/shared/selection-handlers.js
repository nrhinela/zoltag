/**
 * Create selection handlers - eliminates duplication between explore and audit
 *
 * This factory creates handlers for long-press and modifier-click selection functionality.
 * Used to replace 10+ duplicate methods in zoltag-app.js.
 *
 * @param {Object} context - Component context (usually `this` from LitElement)
 * @param {Object} config - Configuration object
 * @param {string} config.selectionProperty - Name of property for selection array (e.g., 'curateDragSelection')
 * @param {string} config.selectingProperty - Name of property for selecting state (e.g., 'curateDragSelecting')
 * @param {string} config.startIndexProperty - Name of property for start index (e.g., 'curateDragStartIndex')
 * @param {string} config.endIndexProperty - Name of property for end index (e.g., 'curateDragEndIndex')
 * @param {string} config.pressActiveProperty - Name of property for press active state (e.g., '_curatePressActive')
 * @param {string} config.pressStartProperty - Name of property for press start coords (e.g., '_curatePressStart')
 * @param {string} config.pressIndexProperty - Name of property for press index (e.g., '_curatePressIndex')
 * @param {string} config.pressImageIdProperty - Name of property for press image ID (e.g., '_curatePressImageId')
 * @param {string} config.pressTimerProperty - Name of property for press timer (e.g., '_curatePressTimer')
 * @param {string} config.longPressTriggeredProperty - Name of property for long press triggered (e.g., '_curateLongPressTriggered')
 * @param {Function} config.getOrder - Function to get image order array for selection (e.g., () => this._curateLeftOrder)
 * @param {Function} config.flashSelection - Function to flash selection feedback (e.g., (imageId) => this._flashCurateSelection(imageId))
 * @param {number} [config.longPressDelay=250] - Delay in ms before long press triggers
 * @param {number} [config.moveThreshold=6] - Movement threshold in pixels to cancel press
 * @param {string} [config.suppressClickProperty] - Property for suppressing click (defaults to _curateSuppressClick)
 * @param {boolean} [config.dragSelectOnMove=false] - Start selection when dragging beyond threshold
 * @returns {Object} Handler methods for selection functionality
 */
export function createSelectionHandlers(context, config) {
  const {
    selectionProperty,
    selectingProperty,
    startIndexProperty,
    endIndexProperty,
    pressActiveProperty,
    pressStartProperty,
    pressIndexProperty,
    pressImageIdProperty,
    pressTimerProperty,
    longPressTriggeredProperty,
    getOrder,
    flashSelection,
    longPressDelay = 250,
    moveThreshold = 6,
    suppressClickProperty,
    dragSelectOnMove = false,
  } = config;
  const suppressClickProp = suppressClickProperty || '_curateSuppressClick';
  let anchorImageId = null;

  const toKey = (value) => String(value);
  const hasImageId = (value) => value !== null && value !== undefined && value !== '';
  const isSelectionEqual = (left, right) => {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
      if (toKey(left[i]) !== toKey(right[i])) {
        return false;
      }
    }
    return true;
  };
  const containsImageId = (selection, imageId) => {
    if (!Array.isArray(selection) || !hasImageId(imageId)) return false;
    const imageKey = toKey(imageId);
    return selection.some((value) => toKey(value) === imageKey);
  };
  const uniqueImageIds = (ids) => {
    const seen = new Set();
    const result = [];
    (ids || []).forEach((value) => {
      if (!hasImageId(value)) return;
      const key = toKey(value);
      if (seen.has(key)) return;
      seen.add(key);
      result.push(value);
    });
    return result;
  };
  const resolveOrder = (orderOverride = null) => {
    if (Array.isArray(orderOverride)) return orderOverride;
    const fallback = getOrder();
    return Array.isArray(fallback) ? fallback : [];
  };
  const resolveIndex = (order, imageId, fallbackIndex = null) => {
    if (!Array.isArray(order) || !order.length) {
      return Number.isInteger(fallbackIndex) ? fallbackIndex : null;
    }
    const imageKey = toKey(imageId);
    const matchedIndex = order.findIndex((value) => toKey(value) === imageKey);
    if (matchedIndex >= 0) return matchedIndex;
    if (Number.isInteger(fallbackIndex) && fallbackIndex >= 0 && fallbackIndex < order.length) {
      return fallbackIndex;
    }
    return null;
  };

  return {
    /**
     * Cancel press state
     */
    cancelPressState() {
      if (context[pressTimerProperty]) {
        clearTimeout(context[pressTimerProperty]);
        context[pressTimerProperty] = null;
      }
      context[pressActiveProperty] = false;
      context[pressStartProperty] = null;
      context[pressIndexProperty] = null;
      context[pressImageIdProperty] = null;
      context[longPressTriggeredProperty] = false;
    },

    /**
     * Start selection at index
     */
    startSelection(index, imageId) {
      if (containsImageId(context[selectionProperty], imageId)) {
        anchorImageId = imageId;
        return;
      }
      this.cancelPressState();
      context[longPressTriggeredProperty] = true;
      context[selectingProperty] = true;
      context[startIndexProperty] = index;
      context[endIndexProperty] = index;
      context[suppressClickProp] = true;
      anchorImageId = imageId;
      flashSelection(imageId);
      this.updateSelection();
    },

    /**
     * Handle pointer down
     */
    handlePointerDown(event, index, imageId) {
      if (context.curateDragSelecting || context.curateAuditDragSelecting) {
        return;
      }
      if (event.button !== 0) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.shiftKey) {
        this.cancelPressState();
        context[suppressClickProp] = false;
        return;
      }
      const selection = Array.isArray(context[selectionProperty]) ? context[selectionProperty] : [];
      if (!selection.length) {
        anchorImageId = null;
      }
      const alreadySelected = selection.length && containsImageId(selection, imageId);
      if (alreadySelected) {
        context[suppressClickProp] = true;
        anchorImageId = imageId;
        return;
      }
      if (dragSelectOnMove) {
        event.preventDefault();
      }
      context[suppressClickProp] = false;
      context[pressActiveProperty] = true;
      context[pressStartProperty] = { x: event.clientX, y: event.clientY };
      context[pressIndexProperty] = index;
      context[pressImageIdProperty] = imageId;
      context[pressTimerProperty] = setTimeout(() => {
        if (context[pressActiveProperty]) {
          this.startSelection(index, imageId);
        }
      }, longPressDelay);
    },

    /**
     * Handle pointer move
     */
    handlePointerMove(event) {
      if (!context[pressActiveProperty] || context[selectingProperty]) {
        return;
      }
      if (!context[pressStartProperty]) {
        return;
      }
      const dx = Math.abs(event.clientX - context[pressStartProperty].x);
      const dy = Math.abs(event.clientY - context[pressStartProperty].y);
      if (dx + dy > moveThreshold) {
        if (dragSelectOnMove && context[pressIndexProperty] !== null && context[pressImageIdProperty] !== null) {
          event.preventDefault();
          this.startSelection(context[pressIndexProperty], context[pressImageIdProperty]);
        } else {
          this.cancelPressState();
        }
      }
    },

    /**
     * Handle long press start
     */
    handleSelectStart(event, index, imageId) {
      if (containsImageId(context[selectionProperty], imageId)) {
        anchorImageId = imageId;
        return;
      }
      event.preventDefault();
      this.startSelection(index, imageId);
    },

    /**
     * Handle select hover
     */
    handleSelectHover(index) {
      if (!context[selectingProperty]) return;
      if (context[endIndexProperty] !== index) {
        context[endIndexProperty] = index;
        this.updateSelection();
      }
    },

    /**
     * Update selection based on start/end indices
     */
    updateSelection() {
      const order = resolveOrder();
      if (!order || context[startIndexProperty] === null || context[endIndexProperty] === null) {
        return;
      }
      const start = Math.min(context[startIndexProperty], context[endIndexProperty]);
      const end = Math.max(context[startIndexProperty], context[endIndexProperty]);
      const ids = order.slice(start, end + 1);
      context[selectionProperty] = ids;
      if (ids.length) {
        anchorImageId = order[context[startIndexProperty]] ?? ids[0];
      } else {
        anchorImageId = null;
      }
    },

    /**
     * Clear selection
     */
    clearSelection() {
      context[selectionProperty] = [];
      anchorImageId = null;
    },

    /**
     * Handle desktop-style modifier click behavior.
     */
    handleClickSelection(event, { imageId, index = null, order = null } = {}) {
      if (!event) {
        return { handled: false, changed: false, selection: Array.isArray(context[selectionProperty]) ? [...context[selectionProperty]] : [] };
      }
      const useToggle = Boolean(event.metaKey || event.ctrlKey);
      const useRange = Boolean(event.shiftKey);
      if (!useToggle && !useRange) {
        return { handled: false, changed: false, selection: Array.isArray(context[selectionProperty]) ? [...context[selectionProperty]] : [] };
      }

      const currentSelection = uniqueImageIds(context[selectionProperty]);
      if (!currentSelection.length) {
        anchorImageId = null;
      }

      const resolvedOrder = resolveOrder(order);
      const clickIndex = resolveIndex(resolvedOrder, imageId, index);
      let nextSelection = currentSelection;
      const imageKey = toKey(imageId);

      if (useRange) {
        if (clickIndex === null || !resolvedOrder.length) {
          if (useToggle) {
            const isSelected = currentSelection.some((value) => toKey(value) === imageKey);
            nextSelection = isSelected
              ? currentSelection.filter((value) => toKey(value) !== imageKey)
              : [...currentSelection, imageId];
          } else {
            nextSelection = hasImageId(imageId) ? [imageId] : [];
          }
        } else {
          const anchorIndex = resolveIndex(resolvedOrder, anchorImageId, clickIndex);
          const rangeStart = Math.min(anchorIndex ?? clickIndex, clickIndex);
          const rangeEnd = Math.max(anchorIndex ?? clickIndex, clickIndex);
          const rangeIds = resolvedOrder.slice(rangeStart, rangeEnd + 1);
          nextSelection = useToggle
            ? [...currentSelection, ...rangeIds]
            : rangeIds;
        }
        anchorImageId = hasImageId(imageId) ? imageId : anchorImageId;
      } else if (useToggle) {
        const isSelected = currentSelection.some((value) => toKey(value) === imageKey);
        if (isSelected) {
          nextSelection = currentSelection.filter((value) => toKey(value) !== imageKey);
          anchorImageId = nextSelection.length ? nextSelection[nextSelection.length - 1] : null;
        } else {
          nextSelection = [...currentSelection, imageId];
          anchorImageId = imageId;
        }
      }

      nextSelection = uniqueImageIds(nextSelection);
      const changed = !isSelectionEqual(currentSelection, nextSelection);
      if (changed) {
        context[selectionProperty] = nextSelection;
      }
      context[suppressClickProp] = false;
      event.preventDefault();
      return {
        handled: true,
        changed,
        selection: Array.isArray(context[selectionProperty]) ? [...context[selectionProperty]] : [],
      };
    },
  };
}
