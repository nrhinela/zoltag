import { html } from 'lit';
import { renderCuratePermatagSummary } from './curate-image-fragments.js';
import { renderCurateRatingWidget, renderCurateRatingStatic } from './curate-rating-widgets.js';

export function renderRatingModal(host) {
  if (!host._curateRatingModalActive) {
    return html``;
  }
  return html`
    <div class="curate-rating-modal-overlay" @click=${host._closeRatingModal}>
      <div class="curate-rating-modal-content" @click=${(e) => e.stopPropagation()}>
        <div class="curate-rating-modal-title">Rate images</div>
        <div class="curate-rating-modal-subtitle">${host._curateRatingModalImageIds?.length || 0} image(s)</div>
        <div class="curate-rating-modal-options">
          <div class="curate-rating-option" @click=${() => host._handleRatingModalClick(0)}>
            <div class="curate-rating-option-icon">🗑️</div>
            <div class="curate-rating-option-label">Garbage</div>
          </div>
          <div class="curate-rating-option" @click=${() => host._handleRatingModalClick(1)}>
            <div class="curate-rating-option-icon">⭐</div>
            <div class="curate-rating-option-label">1</div>
          </div>
          <div class="curate-rating-option" @click=${() => host._handleRatingModalClick(2)}>
            <div class="curate-rating-option-icon">⭐</div>
            <div class="curate-rating-option-label">2</div>
          </div>
          <div class="curate-rating-option" @click=${() => host._handleRatingModalClick(3)}>
            <div class="curate-rating-option-icon">⭐</div>
            <div class="curate-rating-option-label">3</div>
          </div>
        </div>
        <div class="curate-rating-modal-buttons">
          <button class="curate-rating-modal-cancel" @click=${host._closeRatingModal}>Cancel</button>
        </div>
      </div>
    </div>
  `;
}

export function renderAuxTabContent(host, { formatCurateDate, formatQueueItem, retryFailedCommand }) {
  return html`
    ${host.activeTab === 'lists' ? html`
      <div slot="lists" class="container p-4">
        <list-editor
          .tenant=${host.tenant}
          .thumbSize=${host.curateThumbSize}
          .renderCurateRatingWidget=${(image) => renderCurateRatingWidget(host, image)}
          .renderCurateRatingStatic=${renderCurateRatingStatic}
          .renderCuratePermatagSummary=${renderCuratePermatagSummary}
          .formatCurateDate=${formatCurateDate}
          @image-selected=${(e) => host._handleCurateImageClick(null, e.detail.image, e.detail.imageSet)}
        ></list-editor>
      </div>
    ` : html``}

    ${host.activeTab === 'admin' ? html`
      <div slot="admin" class="container p-4">
        <div class="admin-subtabs">
          <button
            class="admin-subtab ${host.activeAdminSubTab === 'tagging' ? 'active' : ''}"
            @click=${() => host.activeAdminSubTab = 'tagging'}
          >
            <i class="fas fa-tags mr-2"></i>Tagging
          </button>
          <button
            class="admin-subtab ${host.activeAdminSubTab === 'people' ? 'active' : ''}"
            @click=${() => host.activeAdminSubTab = 'people'}
          >
            <i class="fas fa-users mr-2"></i>People
          </button>
        </div>
        ${host.activeAdminSubTab === 'tagging' ? html`
          <tagging-admin .tenant=${host.tenant} @open-upload-modal=${host._handleOpenUploadModal}></tagging-admin>
        ` : html``}
        ${host.activeAdminSubTab === 'people' ? html`
          <person-manager .tenant=${host.tenant}></person-manager>
        ` : html``}
      </div>
    ` : html``}

    ${host.activeTab === 'people' ? html`
      <div slot="people" class="container p-4">
        <person-manager .tenant=${host.tenant}></person-manager>
      </div>
    ` : html``}

    ${host.activeTab === 'tagging' ? html`
      <div slot="tagging" class="container p-4">
        <tagging-admin .tenant=${host.tenant} @open-upload-modal=${host._handleOpenUploadModal}></tagging-admin>
      </div>
    ` : html``}

    ${host.activeTab === 'system' ? html`
      <div slot="system" class="container p-4">
        <div class="system-subtabs">
          <button
            class="system-subtab ${host.activeSystemSubTab === 'ml-training' ? 'active' : ''}"
            @click=${() => host.activeSystemSubTab = 'ml-training'}
          >
            <i class="fas fa-brain mr-2"></i>Pipeline
          </button>
          <button
            class="system-subtab ${host.activeSystemSubTab === 'cli' ? 'active' : ''}"
            @click=${() => host.activeSystemSubTab = 'cli'}
          >
            <i class="fas fa-terminal mr-2"></i>CLI
          </button>
        </div>
        ${host.activeSystemSubTab === 'ml-training' ? html`
          <ml-training
            .tenant=${host.tenant}
            @open-image-editor=${host._handlePipelineOpenImage}
          ></ml-training>
        ` : html``}
        ${host.activeSystemSubTab === 'cli' ? html`
          <cli-commands></cli-commands>
        ` : html``}
      </div>
    ` : html``}

    ${host.activeTab === 'ml-training' ? html`
      <div slot="ml-training" class="container p-4">
        <ml-training
          .tenant=${host.tenant}
          @open-image-editor=${host._handlePipelineOpenImage}
        ></ml-training>
      </div>
    ` : html``}

    ${host.activeTab === 'cli' ? html`
      <div slot="cli" class="container p-4">
        <cli-commands></cli-commands>
      </div>
    ` : html``}

    ${host.activeTab === 'queue' ? html`
      <div slot="queue" class="container p-4">
        <div class="border border-gray-200 rounded-lg p-4 bg-white text-sm text-gray-600 space-y-3">
          <div class="font-semibold text-gray-700">Work Queue</div>
          <div class="text-xs text-gray-500">
            ${host.queueState.inProgressCount || 0} active · ${host.queueState.queuedCount || 0} queued · ${host.queueState.failedCount || 0} failed
          </div>
          ${host.queueState.inProgress?.length ? html`
            <div>
              <div class="font-semibold text-gray-600 mb-1">In Progress</div>
              ${host.queueState.inProgress.map((item) => html`
                <div>${formatQueueItem(item)}</div>
              `)}
            </div>
          ` : html``}
          ${host.queueState.queue?.length ? html`
            <div>
              <div class="font-semibold text-gray-600 mb-1">Queued</div>
              ${host.queueState.queue.map((item) => html`
                <div>${formatQueueItem(item)}</div>
              `)}
            </div>
          ` : html``}
          ${host.queueState.failed?.length ? html`
            <div>
              <div class="font-semibold text-red-600 mb-1">Failed</div>
              ${host.queueState.failed.map((item) => html`
                <div class="flex items-center justify-between">
                  <span>${formatQueueItem(item)}</span>
                  <button
                    class="text-xs text-blue-600 hover:text-blue-700"
                    @click=${() => retryFailedCommand(item.id)}
                  >
                    Retry
                  </button>
                </div>
              `)}
            </div>
          ` : html`<div class="text-gray-400">No failed commands.</div>`}
        </div>
      </div>
    ` : html``}
  `;
}

export function renderGlobalOverlays(host, { canCurate }) {
  return html`
    ${host.queueNotice?.message ? html`
      <div class="fixed top-24 right-4 z-[1200] max-w-md">
        <div class="rounded-lg shadow-lg border px-4 py-3 text-sm ${host.queueNotice.level === 'error'
          ? 'bg-red-50 border-red-200 text-red-800'
          : 'bg-amber-50 border-amber-200 text-amber-800'}">
          <div class="flex items-start gap-3">
            <div class="flex-1">${host.queueNotice.message}</div>
            <button
              class="text-xs opacity-70 hover:opacity-100"
              @click=${() => {
                host.queueNotice = null;
                if (host._queueNoticeTimer) {
                  clearTimeout(host._queueNoticeTimer);
                  host._queueNoticeTimer = null;
                }
              }}
              aria-label="Dismiss notification"
            >
              ✕
            </button>
          </div>
        </div>
      </div>
    ` : html``}
    ${host.showUploadModal ? html`
      <upload-modal
        .tenant=${host.tenant}
        @close=${host._handleCloseUploadModal}
        @upload-complete=${host._handleUploadComplete}
        active
      ></upload-modal>
    ` : html``}
    ${host.curateEditorImage ? html`
      <image-editor
        .tenant=${host.tenant}
        .image=${host.curateEditorImage}
        .open=${host.curateEditorOpen}
        .imageSet=${host.curateEditorImageSet}
        .currentImageIndex=${host.curateEditorImageIndex}
        .canEditTags=${canCurate}
        @close=${host._handleCurateEditorClose}
        @image-rating-updated=${host._handleImageRatingUpdated}
        @zoom-to-photo=${host._handleZoomToPhoto}
        @image-navigate=${host._handleImageNavigate}
      ></image-editor>
    ` : html``}
  `;
}
