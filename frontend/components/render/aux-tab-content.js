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

export function renderAuxTabContent(host, { formatCurateDate }) {
  const libraryTabActive = host.activeTab === 'library' || host.activeTab === 'admin';
  const rawLibrarySubTab = host.activeLibrarySubTab
    || (host.activeTab === 'admin' ? 'keywords' : 'assets');
  const librarySubTab = rawLibrarySubTab === 'keywords' || rawLibrarySubTab === 'assets'
    ? rawLibrarySubTab
    : 'assets';

  return html`
    ${libraryTabActive ? html`
      <div slot="library" class="container">
        <div class="admin-subtabs">
          <button
            class="admin-subtab ${librarySubTab === 'assets' ? 'active' : ''}"
            @click=${() => host.activeLibrarySubTab = 'assets'}
          >
            <i class="fas fa-images mr-2"></i>Assets
          </button>
          <button
            class="admin-subtab ${librarySubTab === 'keywords' ? 'active' : ''}"
            @click=${() => host.activeLibrarySubTab = 'keywords'}
          >
            <i class="fas fa-tags mr-2"></i>Keywords
          </button>
        </div>
        ${librarySubTab === 'assets' ? html`
          <assets-admin
            .tenant=${host.tenant}
            .refreshToken=${host.assetsRefreshToken}
            @open-library-upload-modal=${host._handleOpenUploadLibraryModal}
            @image-selected=${(e) => host._handleCurateImageClick(null, e.detail.image, e.detail.imageSet)}
          ></assets-admin>
        ` : html``}
        ${librarySubTab === 'keywords' ? html`
          <div class="mt-2">
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
          </div>
          ${host.activeAdminSubTab === 'tagging' ? html`
            <tagging-admin
              .tenant=${host.tenant}
              @open-upload-modal=${host._handleOpenUploadModal}
            ></tagging-admin>
          ` : html``}
          ${host.activeAdminSubTab === 'people' ? html`
            <person-manager .tenant=${host.tenant}></person-manager>
          ` : html``}
        ` : html``}
      </div>
    ` : html``}

    ${host.activeTab === 'lists' ? html`
      <div slot="lists" class="container">
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

    ${host.activeTab === 'people' ? html`
      <div slot="people" class="container p-4">
        <person-manager .tenant=${host.tenant}></person-manager>
      </div>
    ` : html``}

    ${host.activeTab === 'tagging' ? html`
      <div slot="tagging" class="container p-4">
        <tagging-admin
          .tenant=${host.tenant}
          @open-upload-modal=${host._handleOpenUploadModal}
        ></tagging-admin>
      </div>
    ` : html``}

    ${host.activeTab === 'cli' ? html`
      <div slot="cli" class="container">
        <cli-commands></cli-commands>
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
    ${host.showUploadLibraryModal ? html`
      <upload-library-modal
        .tenant=${host.tenant}
        @close=${host._handleCloseUploadLibraryModal}
        @upload-complete=${host._handleUploadLibraryComplete}
        active
      ></upload-library-modal>
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
