import { BaseStateController } from './base-state-controller.js';
import { fetchWithAuth } from '../../services/api.js';

/**
 * Rating Modal State Controller
 *
 * Manages state and behavior for the rating modal dialog shared by
 * both Curate Explore and Curate Audit tabs. Handles showing/hiding
 * the modal, tracking which images are being rated, and applying ratings.
 *
 * @extends BaseStateController
 */
export class RatingModalStateController extends BaseStateController {
  constructor(host) {
    super(host);
  }

  // ========================================================================
  // MODAL VISIBILITY & STATE
  // ========================================================================

  /**
   * Show rating dialog for explore tab.
   * @param {Array<number>} imageIds - Image IDs to rate
   */
  showExploreRatingDialog(imageIds) {
    this.setHostProperties({
      _curateRatingModalImageIds: imageIds,
      _curateRatingModalSource: 'explore',
      _curateRatingModalActive: true,
    });
  }

  /**
   * Show rating dialog for audit tab.
   * @param {Array<number>} imageIds - Image IDs to rate
   */
  showAuditRatingDialog(imageIds) {
    this.setHostProperties({
      _curateRatingModalImageIds: imageIds,
      _curateRatingModalSource: 'audit',
      _curateRatingModalActive: true,
    });
  }

  /**
   * Close the rating modal.
   */
  closeRatingModal() {
    this.setHostProperties({
      _curateRatingModalActive: false,
      _curateRatingModalImageIds: null,
      _curateRatingModalSource: null,
    });
  }

  /**
   * Handle ESC key to close modal.
   * @param {KeyboardEvent} e - Keyboard event
   */
  handleEscapeKey(e) {
    const modalActive = this.getHostProperty('_curateRatingModalActive');
    if (e.key === 'Escape' && modalActive) {
      this.closeRatingModal();
    }
  }

  /**
   * Handle rating selection in modal.
   * @param {number} rating - Rating value (0-3)
   */
  handleRatingModalClick(rating) {
    const imageIds = this.getHostProperty('_curateRatingModalImageIds');
    if (!imageIds?.length) {
      return;
    }

    const source = this.getHostProperty('_curateRatingModalSource');
    const ids = [...imageIds]; // Copy before closing modal

    this.closeRatingModal();

    // Apply rating based on source
    if (source === 'explore') {
      this.applyExploreRating(ids, rating);
    } else if (source === 'audit') {
      this.applyAuditRating(ids, rating);
    }
  }

  // ========================================================================
  // RATING APPLICATION
  // ========================================================================

  /**
   * Apply rating to images from explore tab.
   * @param {Array<number>} imageIds - Image IDs to rate
   * @param {number} rating - Rating value (0-3)
   */
  async applyExploreRating(imageIds, rating) {
    const tenant = this.getHostProperty('tenant');
    try {
      const promises = imageIds.map((imageId) => {
        return fetchWithAuth(`/images/${imageId}/rating`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating }),
          tenantId: tenant,
        });
      });
      await Promise.all(promises);

      // Update count and remove images
      const currentCount = this.getHostProperty('curateExploreRatingCount') || 0;
      this.setHostProperty('curateExploreRatingCount', currentCount + imageIds.length);

      // Delegate to home state for image removal
      this.host._removeCurateImagesByIds(imageIds);

      this.requestUpdate();
    } catch (err) {
      console.error('Failed to apply explore rating:', err);
    }
  }

  /**
   * Apply rating to images from audit tab.
   * @param {Array<number>} imageIds - Image IDs to rate
   * @param {number} rating - Rating value (0-3)
   */
  async applyAuditRating(imageIds, rating) {
    const tenant = this.getHostProperty('tenant');
    try {
      await Promise.all(imageIds.map((imageId) =>
        fetchWithAuth(`/images/${imageId}/rating`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating }),
          tenantId: tenant,
        })
      ));

      // Update count and remove images
      const currentCount = this.getHostProperty('curateAuditRatingCount') || 0;
      this.setHostProperty('curateAuditRatingCount', currentCount + imageIds.length);

      // Delegate to audit state for image removal
      this.host._removeAuditImagesByIds(imageIds);

      this.requestUpdate();
    } catch (err) {
      console.error('Failed to apply audit rating:', err);
    }
  }

  // ========================================================================
  // STATE MANAGEMENT
  // ========================================================================

  /**
   * Get default rating modal state for initialization.
   * @returns {Object} Default state object
   */
  getDefaultState() {
    return {
      _curateRatingModalActive: false,
      _curateRatingModalImageIds: null,
      _curateRatingModalSource: null,
    };
  }

  /**
   * Snapshot current rating modal state.
   * @returns {Object} Current state snapshot
   */
  snapshotState() {
    const host = this.host;
    return {
      _curateRatingModalActive: host._curateRatingModalActive,
      _curateRatingModalImageIds: host._curateRatingModalImageIds
        ? [...host._curateRatingModalImageIds]
        : null,
      _curateRatingModalSource: host._curateRatingModalSource,
    };
  }

  /**
   * Restore rating modal state from snapshot.
   * @param {Object} snapshot - State snapshot to restore
   */
  restoreState(snapshot) {
    if (!snapshot) return;

    Object.entries(snapshot).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        this.host[key] = [...value];
      } else {
        this.host[key] = value;
      }
    });

    this.requestUpdate();
  }
}
