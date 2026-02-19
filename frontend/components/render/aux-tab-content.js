import { html } from 'lit';
import { renderCuratePermatagSummary } from './curate-image-fragments.js';
import { renderCurateRatingWidget, renderCurateRatingStatic } from './curate-rating-widgets.js';
import {
  allowByPermissionOrRole,
  canViewTenantAudit,
  canViewTenantUsers,
  normalizeTenantRef,
  resolveTenantMembership,
  userIsSuperAdmin,
} from '../shared/tenant-permissions.js';

function getTenantSelectionOptions(currentUser) {
  const memberships = Array.isArray(currentUser?.tenants) ? currentUser.tenants : [];
  const seen = new Set();
  const options = [];
  for (const membership of memberships) {
    const tenantId = normalizeTenantRef(String(membership?.tenant_id || ''));
    if (!tenantId || seen.has(tenantId)) continue;
    seen.add(tenantId);
    options.push({
      id: tenantId,
      label: String(membership?.tenant_name || membership?.tenant_identifier || tenantId).trim() || tenantId,
    });
  }
  return options;
}

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
  const selectedTenant = normalizeTenantRef(host.tenant);
  const tenantMembership = resolveTenantMembership(host.currentUser, selectedTenant);
  const tenantDisplayName = String(tenantMembership?.tenant_name || '').trim()
    || String(tenantMembership?.tenant_identifier || '').trim()
    || selectedTenant;
  const isSuperAdmin = userIsSuperAdmin(host.currentUser);
  const canUploadTenantAssets = allowByPermissionOrRole(
    host.currentUser,
    selectedTenant,
    'image.variant.manage',
    ['admin', 'editor'],
  );
  const canDeleteTenantAssets = allowByPermissionOrRole(
    host.currentUser,
    selectedTenant,
    'tenant.settings.manage',
    ['admin'],
  );
  const canEditKeywords = allowByPermissionOrRole(
    host.currentUser,
    selectedTenant,
    'keywords.write',
    ['admin', 'editor'],
  );
  const canReadKeywords = allowByPermissionOrRole(
    host.currentUser,
    selectedTenant,
    'keywords.read',
    ['admin', 'editor', 'user'],
  );
  const canManageTenantUsers = allowByPermissionOrRole(
    host.currentUser,
    selectedTenant,
    'tenant.users.manage',
    ['admin'],
  );
  const canViewUsers = canViewTenantUsers(host.currentUser, selectedTenant);
  const canViewAudit = canViewTenantAudit(host.currentUser, selectedTenant);
  const canManageProviders = allowByPermissionOrRole(
    host.currentUser,
    selectedTenant,
    'provider.manage',
    ['admin'],
  );
  const canManageJobs = allowByPermissionOrRole(
    host.currentUser,
    selectedTenant,
    'tenant.jobs.view',
    ['admin'],
  );
  const unavailableLibraryTabs = [
    !canReadKeywords ? 'Keywords' : null,
    !canViewUsers ? 'Users' : null,
    !canViewAudit ? 'Audit' : null,
    !canManageProviders ? 'Providers' : null,
    !canManageJobs ? 'Jobs' : null,
  ].filter(Boolean);
  const libraryTabActive = host.activeTab === 'library';
  const defaultLibrarySubTab = 'assets';
  const rawLibrarySubTab = host.activeLibrarySubTab || defaultLibrarySubTab;
  const librarySubTab = (rawLibrarySubTab === 'assets'
    || (rawLibrarySubTab === 'keywords' && canReadKeywords)
    || (rawLibrarySubTab === 'users' && canViewUsers)
    || (rawLibrarySubTab === 'audit' && canViewAudit)
    || (rawLibrarySubTab === 'providers' && canManageProviders)
    || (rawLibrarySubTab === 'jobs' && canManageJobs))
    ? rawLibrarySubTab
    : defaultLibrarySubTab;

  return html`
    ${libraryTabActive ? html`
      <div slot="library" class="container">
        <div class="subnav-strip mb-4">
          <div class="admin-subtabs">
            <button
              class="admin-subtab ${librarySubTab === 'assets' ? 'active' : ''}"
              @click=${() => host.activeLibrarySubTab = 'assets'}
            >
              Assets
            </button>
            <button
              class="admin-subtab ${librarySubTab === 'keywords' ? 'active' : ''}"
              ?disabled=${!canReadKeywords}
              title=${canReadKeywords ? 'View and manage keywords' : 'Requires keywords.read permission'}
              @click=${() => host.activeLibrarySubTab = 'keywords'}
            >
              Keywords
            </button>
            <button
              class="admin-subtab ${librarySubTab === 'users' ? 'active' : ''}"
              ?disabled=${!canViewUsers}
              title=${canViewUsers ? 'Manage tenant users' : 'Requires tenant user permissions'}
              @click=${() => host.activeLibrarySubTab = 'users'}
            >
              Users
            </button>
            <button
              class="admin-subtab ${librarySubTab === 'audit' ? 'active' : ''}"
              ?disabled=${!canViewAudit}
              title=${canViewAudit ? 'View tenant activity' : 'Requires tenant.audit.view permission'}
              @click=${() => host.activeLibrarySubTab = 'audit'}
            >
              Audit
            </button>
            <button
              class="admin-subtab ${librarySubTab === 'providers' ? 'active' : ''}"
              ?disabled=${!canManageProviders}
              title=${canManageProviders ? 'Manage provider integrations' : 'Requires provider.manage permission'}
              @click=${() => host.activeLibrarySubTab = 'providers'}
            >
              Providers
            </button>
            <button
              class="admin-subtab ${librarySubTab === 'jobs' ? 'active' : ''}"
              ?disabled=${!canManageJobs}
              title=${canManageJobs ? 'View and manage tenant jobs' : 'Requires tenant.jobs.view permission'}
              @click=${() => host.activeLibrarySubTab = 'jobs'}
            >
              Jobs
            </button>
          </div>
        </div>
        ${unavailableLibraryTabs.length ? html`
          <div class="admin-subtabs-hint">
            Some tabs are unavailable for your role: ${unavailableLibraryTabs.join(', ')}
          </div>
        ` : html``}
        ${librarySubTab === 'assets' ? html`
          <assets-admin
            .tenant=${host.tenant}
            .canUpload=${canUploadTenantAssets}
            .canDelete=${canDeleteTenantAssets}
            .refreshToken=${host.assetsRefreshToken}
            @open-library-upload-modal=${host._handleOpenUploadLibraryModal}
            @image-selected=${(e) => host._handleCurateImageClick(null, e.detail.image, e.detail.imageSet)}
          ></assets-admin>
        ` : html``}
        ${librarySubTab === 'keywords' ? html`
          <div class="mt-2">
            <div class="subnav-strip mb-4">
              <div class="admin-subtabs">
                <button
                  class="admin-subtab ${host.activeAdminSubTab === 'tagging' ? 'active' : ''}"
                  @click=${() => host.activeAdminSubTab = 'tagging'}
                >
                  Tagging
                </button>
                <button
                  class="admin-subtab ${host.activeAdminSubTab === 'people' ? 'active' : ''}"
                  @click=${() => host.activeAdminSubTab = 'people'}
                >
                  People and Organizations
                </button>
              </div>
            </div>
          </div>
          ${host.activeAdminSubTab === 'tagging' ? html`
            <tagging-admin
              .tenant=${host.tenant}
              .readOnly=${!canEditKeywords}
              @open-upload-modal=${host._handleOpenUploadModal}
            ></tagging-admin>
          ` : html``}
          ${host.activeAdminSubTab === 'people' ? html`
            <person-manager
              .tenant=${host.tenant}
              .readOnly=${!canEditKeywords}
            ></person-manager>
          ` : html``}
        ` : html``}
        ${librarySubTab === 'users' ? html`
          <div class="mt-2">
            <tenant-users-admin
              .tenant=${host.tenant}
              .tenantName=${tenantDisplayName}
              .canView=${canViewUsers}
              .canManage=${canManageTenantUsers}
              .isSuperAdmin=${isSuperAdmin}
            ></tenant-users-admin>
          </div>
        ` : html``}
        ${librarySubTab === 'audit' ? html`
          <div class="mt-2">
            <activity-audit
              .tenant=${host.tenant}
              .tenantName=${tenantDisplayName}
              scope="tenant"
            ></activity-audit>
          </div>
        ` : html``}
        ${librarySubTab === 'providers' ? html`
          <div class="mt-2">
            <library-integrations-admin
              .tenant=${host.tenant}
            ></library-integrations-admin>
          </div>
        ` : html``}
        ${librarySubTab === 'jobs' ? html`
          <div class="mt-2">
            <library-jobs-admin
              .tenant=${host.tenant}
              .isSuperAdmin=${isSuperAdmin}
            ></library-jobs-admin>
          </div>
        ` : html``}
      </div>
    ` : html``}

    ${host.activeTab === 'lists' ? html`
      <div slot="lists" class="container">
        <list-editor
          .tenant=${host.tenant}
          .currentUser=${host.currentUser}
          .initialSelectedListId=${host.pendingListSelectionId}
          .initialSelectedListToken=${host.pendingListSelectionToken || 0}
          .thumbSize=${host.curateThumbSize}
          .renderCurateRatingWidget=${(image) => renderCurateRatingWidget(host, image)}
          .renderCurateRatingStatic=${renderCurateRatingStatic}
          .renderCuratePermatagSummary=${renderCuratePermatagSummary}
          .formatCurateDate=${formatCurateDate}
          @initial-list-selection-applied=${() => {
            host.pendingListSelectionId = null;
          }}
          @image-selected=${(e) => host._handleCurateImageClick(null, e.detail.image, e.detail.imageSet)}
          @open-similar-in-search=${host._handleOpenSimilarInSearch}
        ></list-editor>
      </div>
    ` : html``}

    ${host.activeTab === 'people' ? html`
      <div slot="people" class="container p-4">
        <person-manager
          .tenant=${host.tenant}
          .readOnly=${!canEditKeywords}
        ></person-manager>
      </div>
    ` : html``}

    ${host.activeTab === 'tagging' ? html`
      <div slot="tagging" class="container p-4">
        <tagging-admin
          .tenant=${host.tenant}
          .readOnly=${!canEditKeywords}
          @open-upload-modal=${host._handleOpenUploadModal}
        ></tagging-admin>
      </div>
    ` : html``}

  `;
}

export function renderGlobalOverlays(host, { canCurate }) {
  const tenantSelectionOptions = getTenantSelectionOptions(host.currentUser);
  const hasTenantSelection = !!normalizeTenantRef(host.tenant);
  const shouldShowTenantSelector = !host.tenantAccessBlocked
    && !hasTenantSelection
    && !!host.tenantSelectionRequired
    && tenantSelectionOptions.length > 1;
  const shouldShowTenantFallbackError = !host.tenantAccessBlocked
    && !hasTenantSelection
    && !shouldShowTenantSelector
    && tenantSelectionOptions.length > 1;

  return html`
    ${host.tenantAccessBlocked ? html`
      <div class="curate-rating-modal-overlay" aria-live="assertive">
        <div class="curate-rating-modal-content" role="alertdialog" aria-modal="true">
          <div class="curate-rating-modal-title">Tenant Access Required</div>
          <div class="curate-rating-modal-subtitle">${host.tenantAccessBlockedMessage || 'Your user has not been assigned permissions'}</div>
        </div>
      </div>
    ` : html``}
    ${shouldShowTenantSelector ? html`
      <div class="curate-rating-modal-overlay" aria-live="assertive">
        <div class="curate-rating-modal-content" role="dialog" aria-modal="true" style="max-width: 560px;">
          <div class="curate-rating-modal-title">Select a Tenant</div>
          <div class="curate-rating-modal-subtitle">Choose a tenant to continue.</div>
          <div class="mt-4 space-y-2 max-h-72 overflow-auto text-left">
            ${tenantSelectionOptions.map((tenantOption) => html`
              <button
                type="button"
                class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 text-left"
                @click=${() => host._handleTenantChange({ detail: tenantOption.id })}
              >
                ${tenantOption.label}
              </button>
            `)}
          </div>
        </div>
      </div>
    ` : html``}
    ${shouldShowTenantFallbackError ? html`
      <div class="curate-rating-modal-overlay" aria-live="assertive">
        <div class="curate-rating-modal-content" role="alertdialog" aria-modal="true">
          <div class="curate-rating-modal-title">No Tenant Selected</div>
          <div class="curate-rating-modal-subtitle">
            No tenant is active. Open your profile menu and select a tenant, then reload.
          </div>
        </div>
      </div>
    ` : html``}
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
        .canCurate=${canCurate}
        @close=${host._handleCurateEditorClose}
        @image-rating-updated=${host._handleImageRatingUpdated}
        @image-selected=${(e) => {
          const selectedImage = e?.detail?.image;
          const imageSet = Array.isArray(e?.detail?.imageSet) ? e.detail.imageSet : [];
          if (!selectedImage?.id) return;
          host.curateEditorImage = selectedImage;
          host.curateEditorImageSet = imageSet.length ? [...imageSet] : [selectedImage];
          host.curateEditorImageIndex = host.curateEditorImageSet.findIndex((img) => img.id === selectedImage.id);
          host.curateEditorOpen = true;
        }}
        @zoom-to-photo=${host._handleZoomToPhoto}
        @image-navigate=${host._handleImageNavigate}
        @open-similar-in-search=${host._handleOpenSimilarInSearch}
        @open-similar-in-curate=${host._handleOpenSimilarInCurate}
      ></image-editor>
    ` : html``}
  `;
}
