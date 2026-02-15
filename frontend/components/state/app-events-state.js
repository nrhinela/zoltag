import { BaseStateController } from './base-state-controller.js';
import { subscribeQueue } from '../../services/command-queue.js';
import { scheduleStatsRefresh } from '../shared/curate-stats.js';

export class AppEventsStateController extends BaseStateController {
  constructor(host) {
    super(host);
    this._boundKeyDown = null;
  }

  handleQueueCommandComplete(event) {
    const detail = event?.detail;
    if (!detail) return;
    if (detail.type === 'bulk-permatags') {
      const result = detail.result || {};
      const skipped = Number(result.skipped || 0);
      const errors = Array.isArray(result.errors) ? result.errors.length : 0;
      if (skipped > 0 || errors > 0) {
        const created = Number(result.created || 0);
        const updated = Number(result.updated || 0);
        this._showQueueNotice(
          `Tag update completed with issues: ${created} created, ${updated} updated, ${skipped} skipped, ${errors} errors.`,
          'warning'
        );
      }
    }
    if (
      detail.type === 'retag' ||
      detail.type === 'add-positive-permatag' ||
      detail.type === 'add-negative-permatag' ||
      detail.type === 'bulk-permatags'
    ) {
      scheduleStatsRefresh(this.host);
    }
  }

  handleQueueCommandFailed(event) {
    const detail = event?.detail;
    if (!detail?.id) return;
    if (detail.type === 'bulk-permatags') {
      this._showQueueNotice(`Tag update failed: ${detail.error || 'unknown error'}`, 'error');
    }
  }

  _showQueueNotice(message, level = 'warning') {
    if (!message) return;
    if (this.host._queueNoticeTimer) {
      clearTimeout(this.host._queueNoticeTimer);
    }
    this.host.queueNotice = {
      message,
      level,
      createdAt: Date.now(),
    };
    this.host._queueNoticeTimer = setTimeout(() => {
      this.host.queueNotice = null;
      this.host._queueNoticeTimer = null;
    }, 7000);
    this.requestUpdate();
  }

  handleCurateGlobalPointerDown(event) {
    if (!this.host.curateDragSelection.length) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      return;
    }
    const path = event.composedPath ? event.composedPath() : [];
    const clickedThumb = path.some((node) => {
      if (!node || !node.classList) {
        return false;
      }
      return (
        node.classList.contains('curate-thumb-wrapper') ||
        node.classList.contains('curate-thumb')
      );
    });
    const clickedSelected = path.some((node) => {
      if (!node || !node.classList) {
        return false;
      }
      return (
        (node.classList.contains('curate-thumb-wrapper') && node.classList.contains('selected')) ||
        (node.classList.contains('curate-thumb') && node.classList.contains('selected'))
      );
    });
    if (clickedSelected) {
      return;
    }
    this.host.curateDragSelection = [];
    this.host._curateSuppressClick = clickedThumb;
  }

  handleCurateSelectionEnd() {
    if (this.host.curateDragSelecting) {
      this.host.curateDragSelecting = false;
      this.host.curateDragStartIndex = null;
      this.host.curateDragEndIndex = null;
    }
    if (this.host.curateAuditDragSelecting) {
      this.host.curateAuditDragSelecting = false;
      this.host.curateAuditDragStartIndex = null;
      this.host.curateAuditDragEndIndex = null;
    }
    if (this.host._curateAuditLongPressTriggered) {
      this.host._curateSuppressClick = true;
      this.host._curateAuditLongPressTriggered = false;
    }
    if (this.host._curateLongPressTriggered) {
      this.host._curateSuppressClick = true;
      this.host._curateLongPressTriggered = false;
    }
    this.host._cancelCuratePressState();
    this.host._cancelCurateAuditPressState();
  }

  connect() {
    this.host._loadCurrentUser();
    this.host._initializeTab(this.host.activeTab);
    this.host._unsubscribeQueue = subscribeQueue((state) => {
      this.host.queueState = state;
    });
    window.addEventListener('queue-command-complete', this.host._handleQueueCommandComplete);
    window.addEventListener('queue-command-failed', this.host._handleQueueCommandFailed);
    window.addEventListener('pointerdown', this.host._handleCurateGlobalPointerDown);
    window.addEventListener('pointerup', this.host._handleCurateSelectionEnd);
    window.addEventListener('keyup', this.host._handleCurateSelectionEnd);
    if (!this._boundKeyDown) {
      this._boundKeyDown = (e) => this.host._handleEscapeKey(e);
    }
    window.addEventListener('keydown', this._boundKeyDown);
  }

  disconnect() {
    if (this.host._unsubscribeQueue) {
      this.host._unsubscribeQueue();
    }
    window.removeEventListener('queue-command-complete', this.host._handleQueueCommandComplete);
    window.removeEventListener('queue-command-failed', this.host._handleQueueCommandFailed);
    window.removeEventListener('pointerdown', this.host._handleCurateGlobalPointerDown);
    window.removeEventListener('pointerup', this.host._handleCurateSelectionEnd);
    window.removeEventListener('keyup', this.host._handleCurateSelectionEnd);
    if (this._boundKeyDown) {
      window.removeEventListener('keydown', this._boundKeyDown);
    }
    if (this.host._statsRefreshTimer) {
      clearTimeout(this.host._statsRefreshTimer);
      this.host._statsRefreshTimer = null;
    }
    if (this.host._queueNoticeTimer) {
      clearTimeout(this.host._queueNoticeTimer);
      this.host._queueNoticeTimer = null;
    }
  }
}
