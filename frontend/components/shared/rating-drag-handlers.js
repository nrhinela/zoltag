/**
 * Create rating drag handlers - eliminates duplication between explore and audit
 *
 * This factory creates handlers for drag-to-rating-bucket functionality.
 * Used to replace 4+ duplicate methods in photocat-app.js.
 *
 * @param {Object} context - Component context (usually `this` from LitElement)
 * @param {Object} config - Configuration object
 * @param {string} config.enabledProperty - Name of property for enabled state (e.g., 'curateExploreRatingEnabled')
 * @param {string} config.dragTargetProperty - Name of property for drag target (e.g., '_curateExploreRatingDragTarget')
 * @param {Function} config.showRatingDialog - Function to show rating dialog (imageIds) => void
 * @returns {Object} Handler methods
 */
export function createRatingDragHandlers(context, config) {
  const {
    enabledProperty,
    dragTargetProperty,
    showRatingDialog,
  } = config;

  return {
    /**
     * Toggle rating drag mode on/off
     */
    handleToggle() {
      context[enabledProperty] = !context[enabledProperty];
    },

    /**
     * Handle drag over rating drop zone
     */
    handleDragOver(event) {
      event.preventDefault();
      context[dragTargetProperty] = true;
      context.requestUpdate();
    },

    /**
     * Handle drag leave rating drop zone
     */
    handleDragLeave() {
      context[dragTargetProperty] = false;
      context.requestUpdate();
    },

    /**
     * Handle drop on rating zone
     */
    handleDrop(event) {
      event.preventDefault();
      const raw = event.dataTransfer?.getData('text/plain') || '';
      const ids = raw
        .split(',')
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((value) => Number.isFinite(value) && value > 0);

      if (!ids.length) {
        this.handleDragLeave();
        return;
      }

      // Show rating selection dialog
      showRatingDialog(ids);
      this.handleDragLeave();
    },
  };
}
