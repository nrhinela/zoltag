import { html } from 'lit';
import { renderCuratePermatagSummary } from './curate-image-fragments.js';
import { renderCurateRatingWidget, renderCurateRatingStatic } from './curate-rating-widgets.js';
import { renderHomeCtaGlyph } from './home-search-tab-content.js';
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

function renderAdminNavIcon(kind, size = 23) {
  const style = `display:block; width:${size}px; height:${size}px;`;
  if (kind === 'overview') {
    return html`
      <svg viewBox="0 0 24 24" aria-hidden="true" style=${style}>
        <circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.9"></circle>
        <circle cx="12" cy="8.1" r="1.1" fill="currentColor"></circle>
        <path d="M12 11v5.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
      </svg>
    `;
  }
  if (kind === 'assets') {
    return html`
      <svg viewBox="0 0 24 24" aria-hidden="true" style=${style}>
        <path d="M5.4 6.2a1.8 1.8 0 0 1 1.8-1.8h2.4a1.8 1.8 0 0 1 1.8 1.8v11.6a1.8 1.8 0 0 1-1.8 1.8H7.2a1.8 1.8 0 0 1-1.8-1.8z" fill="none" stroke="currentColor" stroke-width="1.8"></path>
        <path d="M11.2 6.2A1.8 1.8 0 0 1 13 4.4h2.4a1.8 1.8 0 0 1 1.8 1.8v11.6a1.8 1.8 0 0 1-1.8 1.8H13a1.8 1.8 0 0 1-1.8-1.8z" fill="none" stroke="currentColor" stroke-width="1.8"></path>
        <path d="M16.9 7.3a1.7 1.7 0 0 1 2.1-1.2l1.3.4a1.7 1.7 0 0 1 1.2 2.1l-3 10.7a1.7 1.7 0 0 1-2.1 1.2l-1.3-.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
      </svg>
    `;
  }
  if (kind === 'tags') {
    return html`
      <svg viewBox="0 0 24 24" aria-hidden="true" style=${style}>
        <path d="M5.2 6.2A2.2 2.2 0 0 1 7.4 4h5l6.4 6.4a1.8 1.8 0 0 1 0 2.6l-5.8 5.8a1.8 1.8 0 0 1-2.6 0L4 12.4v-5A2.2 2.2 0 0 1 5.2 6.2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
        <circle cx="9" cy="8.8" r="1.2" fill="currentColor"></circle>
      </svg>
    `;
  }
  if (kind === 'users') {
    return html`
      <svg viewBox="0 0 24 24" aria-hidden="true" style=${style}>
        <circle cx="9" cy="9" r="3" fill="none" stroke="currentColor" stroke-width="1.8"></circle>
        <path d="M4.5 18c.7-2.6 2.6-4.2 4.5-4.2s3.8 1.6 4.5 4.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
        <circle cx="16.8" cy="10" r="2.3" fill="none" stroke="currentColor" stroke-width="1.6"></circle>
        <path d="M14.5 18c.4-1.8 1.8-3 3.4-3 1.1 0 2.1.6 2.8 1.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path>
      </svg>
    `;
  }
  if (kind === 'activity') {
    return html`
      <svg viewBox="0 0 24 24" aria-hidden="true" style=${style}>
        <circle cx="12" cy="12" r="7.6" fill="none" stroke="currentColor" stroke-width="1.8"></circle>
        <path d="M12 7.7v4.6l3.3 1.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    `;
  }
  if (kind === 'providers') {
    return html`
      <svg viewBox="0 0 24 24" aria-hidden="true" style=${style}>
        <path d="M8.4 8.2V5.6M15.6 8.2V5.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
        <path d="M8 8.2h8a2.6 2.6 0 0 1 2.6 2.6v1.4a2.6 2.6 0 0 1-2.6 2.6h-1.4v2.1a1.2 1.2 0 0 1-2 1l-1.6-1.4-1.6 1.4a1.2 1.2 0 0 1-2-1v-2.1H8a2.6 2.6 0 0 1-2.6-2.6v-1.4A2.6 2.6 0 0 1 8 8.2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
      </svg>
    `;
  }
  if (kind === 'jobs') {
    return html`
      <svg viewBox="0 0 24 24" aria-hidden="true" style=${style}>
        <path d="M10.4 3.8h3.2l.6 1.9a6.9 6.9 0 0 1 1.4.6l1.7-1 2.2 2.2-1 1.7c.25.45.46.92.6 1.42l1.9.58v3.16l-1.9.58a6.9 6.9 0 0 1-.6 1.42l1 1.7-2.2 2.2-1.7-1a6.9 6.9 0 0 1-1.4.6l-.6 1.9h-3.2l-.6-1.9a6.9 6.9 0 0 1-1.4-.6l-1.7 1-2.2-2.2 1-1.7a6.9 6.9 0 0 1-.6-1.42l-1.9-.58v-3.16l1.9-.58c.14-.5.35-.97.6-1.42l-1-1.7 2.2-2.2 1.7 1c.45-.25.92-.46 1.4-.6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"></path>
        <circle cx="12" cy="12" r="2.7" fill="none" stroke="currentColor" stroke-width="1.8"></circle>
      </svg>
    `;
  }
  if (kind === 'templates') {
    return html`
      <svg viewBox="0 0 24 24" aria-hidden="true" style=${style}>
        <path d="M7 5.2h10a1.8 1.8 0 0 1 1.8 1.8v10A1.8 1.8 0 0 1 17 18.8H7A1.8 1.8 0 0 1 5.2 17V7A1.8 1.8 0 0 1 7 5.2z" fill="none" stroke="currentColor" stroke-width="1.8"></path>
        <path d="M8.5 9h7M8.5 12h7M8.5 15h4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
      </svg>
    `;
  }
  if (kind === 'shares') {
    return html`
      <svg viewBox="0 0 24 24" aria-hidden="true" style=${style}>
        <circle cx="7" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.8"></circle>
        <circle cx="17" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="1.8"></circle>
        <circle cx="17" cy="17" r="2" fill="none" stroke="currentColor" stroke-width="1.8"></circle>
        <path d="M8.8 11.1l6.1-3.1M8.8 12.9l6.1 3.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
      </svg>
    `;
  }
  return html``;
}

function renderAdminOverview(host, {
  canReadKeywords,
  canViewUsers,
  canViewAudit,
  canManageProviders,
  canManageJobs,
  canManageTemplates,
  canManageShares,
} = {}) {
  const cards = [
    {
      key: 'tags',
      label: 'Tags',
      subtitle: 'Define categories, tags, prompts, and person links.',
      subTab: 'keywords',
      adminSubTab: 'tagging',
      navIcon: 'tags',
      glyphKey: 'K',
      accentClass: 'home-cta-keywords',
      disabled: !canReadKeywords,
      disabledReason: 'Requires keywords.read permission',
    },
    {
      key: 'assets',
      label: 'Assets',
      subtitle: 'Browse uploaded files and review asset records.',
      subTab: 'assets',
      navIcon: 'assets',
      glyphKey: 'B',
      accentClass: 'home-cta-assets',
    },
    {
      key: 'providers',
      label: 'Providers',
      subtitle: 'Configure provider integrations and sync connections.',
      subTab: 'providers',
      navIcon: 'providers',
      glyphKey: 'P',
      accentClass: 'home-cta-search',
      disabled: !canManageProviders,
      disabledReason: 'Requires provider.manage permission',
    },
    {
      key: 'shares',
      label: 'Shares',
      subtitle: 'Inspect guest shares and clean up expired access.',
      subTab: 'shares',
      navIcon: 'shares',
      glyphKey: 'S',
      accentClass: 'home-cta-upload',
      disabled: !canManageShares,
      disabledReason: 'Requires list.edit.shared permission',
    },
    {
      key: 'templates',
      label: 'Templates',
      subtitle: 'Manage presentation and export templates.',
      subTab: 'templates',
      navIcon: 'templates',
      glyphKey: 'T',
      accentClass: 'home-cta-admin',
      disabled: !canManageTemplates,
      disabledReason: 'Requires list.edit.shared permission',
    },
    {
      key: 'jobs',
      label: 'Jobs',
      subtitle: 'Monitor processing jobs, attempts, and queue status.',
      subTab: 'jobs',
      navIcon: 'jobs',
      glyphKey: 'J',
      accentClass: 'home-cta-admin',
      disabled: !canManageJobs,
      disabledReason: 'Requires tenant.jobs.view permission',
    },
    {
      key: 'user-activity',
      label: 'User Activity',
      subtitle: 'Review audit history and recent activity by user.',
      subTab: 'audit',
      navIcon: 'activity',
      glyphKey: 'A',
      accentClass: 'home-cta-upload',
      disabled: !canViewAudit,
      disabledReason: 'Requires tenant.audit.view permission',
    },
    {
      key: 'users',
      label: 'Users',
      subtitle: 'Manage tenant users, access, and membership details.',
      subTab: 'users',
      navIcon: 'users',
      glyphKey: 'U',
      accentClass: 'home-cta-curate',
      disabled: !canViewUsers,
      disabledReason: 'Requires tenant user permissions',
    },
  ];

  const openCard = (card) => {
    if (card.disabled) return;
    host.activeLibrarySubTab = card.subTab;
    if (card.adminSubTab) host.activeAdminSubTab = card.adminSubTab;
  };

  return html`
    <div class="mt-2">
      <div class="home-cta-grid" style="grid-template-columns: 1fr;">
        ${cards.map((card) => html`
          <button
            type="button"
            class="home-cta-card ${card.accentClass} ${card.disabled ? 'opacity-60 cursor-not-allowed' : ''}"
            title=${card.disabled ? card.disabledReason : card.label}
            ?disabled=${card.disabled}
            @click=${() => openCard(card)}
          >
            <div class="home-cta-backdrop" aria-hidden="true"></div>
            <div class="home-cta-glyph" aria-hidden="true">
              ${renderHomeCtaGlyph(card.glyphKey)}
            </div>
            <div class="home-cta-icon-wrap" aria-hidden="true">
              ${renderAdminNavIcon(card.navIcon, 21)}
            </div>
            <div class="home-cta-content">
              <div class="home-cta-title">${card.label}</div>
              <div class="home-cta-subtitle">${card.subtitle}</div>
            </div>
            <div class="home-cta-arrow" aria-hidden="true">
              <span class="home-cta-arrow-char">${card.disabled ? '•' : '→'}</span>
            </div>
          </button>
        `)}
      </div>
    </div>
  `;
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
  const canManageTemplates = allowByPermissionOrRole(
    host.currentUser,
    selectedTenant,
    'list.edit.shared',
    ['admin', 'editor'],
  );
  const canManageShares = allowByPermissionOrRole(
    host.currentUser,
    selectedTenant,
    'list.edit.shared',
    ['admin'],
  );
  const hasDefinedTags = Array.isArray(host.keywords)
    && host.keywords.some((kw) => String(kw?.keyword || '').trim().length > 0);
  const unavailableLibraryTabs = [
    !canReadKeywords ? 'Tags' : null,
    !canViewUsers ? 'Users' : null,
    !canViewAudit ? 'User Activity' : null,
    !canManageProviders ? 'Providers' : null,
    !canManageJobs ? 'Jobs' : null,
    !canManageTemplates ? 'Templates' : null,
    !canManageShares ? 'Shares' : null,
  ].filter(Boolean);
  const libraryTabActive = host.activeTab === 'library';
  const defaultLibrarySubTab = 'overview';
  const rawLibrarySubTab = host.activeLibrarySubTab || defaultLibrarySubTab;
  const librarySubTab = (rawLibrarySubTab === 'overview'
    || rawLibrarySubTab === 'assets'
    || (rawLibrarySubTab === 'keywords' && canReadKeywords)
    || (rawLibrarySubTab === 'users' && canViewUsers)
    || (rawLibrarySubTab === 'audit' && canViewAudit)
    || (rawLibrarySubTab === 'providers' && canManageProviders)
    || (rawLibrarySubTab === 'jobs' && canManageJobs)
    || (rawLibrarySubTab === 'templates' && canManageTemplates)
    || (rawLibrarySubTab === 'shares' && canManageShares))
    ? rawLibrarySubTab
    : defaultLibrarySubTab;
  const adminNavItems = [
    { key: 'overview', label: 'Overview', icon: 'overview', disabled: false, title: 'Admin Overview' },
    { key: 'keywords', label: 'Tags', icon: 'tags', disabled: !canReadKeywords, title: canReadKeywords ? 'Tags' : 'Requires keywords.read permission' },
    { key: 'assets', label: 'Assets', icon: 'assets', disabled: false, title: 'Assets' },
    { key: 'providers', label: 'Providers', icon: 'providers', disabled: !canManageProviders, title: canManageProviders ? 'Providers' : 'Requires provider.manage permission' },
    { key: 'shares', label: 'Shares', icon: 'shares', disabled: !canManageShares, title: canManageShares ? 'Shares' : 'Requires list.edit.shared permission' },
    { key: 'templates', label: 'Templates', icon: 'templates', disabled: !canManageTemplates, title: canManageTemplates ? 'Templates' : 'Requires list.edit.shared permission' },
    { key: 'jobs', label: 'Jobs', icon: 'jobs', disabled: !canManageJobs, title: canManageJobs ? 'Jobs' : 'Requires tenant.jobs.view permission' },
    { key: 'audit', label: 'User Activity', icon: 'activity', disabled: !canViewAudit, title: canViewAudit ? 'User Activity' : 'Requires tenant.audit.view permission' },
    { key: 'users', label: 'Users', icon: 'users', disabled: !canViewUsers, title: canViewUsers ? 'Users' : 'Requires tenant user permissions' },
  ];

  return html`
    ${libraryTabActive ? html`
      <div slot="library" class="container">
        <div class="flex items-center gap-2 mb-4">
          ${adminNavItems.map((item) => html`
            <button
              class=${`right-panel-edge-toggle ${librarySubTab === item.key ? 'active' : ''} ${item.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              type="button"
              title=${item.title}
              aria-label=${item.label}
              style="position:static; margin-left:0; transform:none;"
              ?disabled=${item.disabled}
              @click=${() => {
                if (item.disabled) return;
                host.activeLibrarySubTab = item.key;
              }}
            >
              <span style="display:inline-flex; align-items:center; justify-content:center;">
                ${renderAdminNavIcon(item.icon, 23)}
              </span>
            </button>
          `)}
        </div>
        ${unavailableLibraryTabs.length ? html`
          <div class="admin-subtabs-hint">
            Some tabs are unavailable for your role: ${unavailableLibraryTabs.join(', ')}
          </div>
        ` : html``}
        ${librarySubTab === 'overview' ? renderAdminOverview(host, {
          canReadKeywords,
          canViewUsers,
          canViewAudit,
          canManageProviders,
          canManageJobs,
          canManageTemplates,
          canManageShares,
        }) : html``}
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
            <tagging-admin2
              .tenant=${host.tenant}
              .readOnly=${!canEditKeywords}
            ></tagging-admin2>
          ` : html``}
          ${host.activeAdminSubTab === 'people' ? html`
            <person-manager
              .tenant=${host.tenant}
              .readOnly=${!canEditKeywords}
              .hasDefinedTags=${hasDefinedTags}
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
              .tenantName=${tenantDisplayName}
              .isSuperAdmin=${isSuperAdmin}
            ></library-jobs-admin>
          </div>
        ` : html``}
        ${librarySubTab === 'templates' ? html`
          <div class="mt-2">
            <presentation-templates-admin
              .tenant=${host.tenant}
            ></presentation-templates-admin>
          </div>
        ` : html``}
        ${librarySubTab === 'shares' ? html`
          <div class="mt-2">
            <admin-reviews-panel
              .tenantId=${host.tenant}
            ></admin-reviews-panel>
          </div>
        ` : html``}
      </div>
    ` : html``}
    ${host.activeTab === 'people' ? html`
      <div slot="people" class="container p-4">
        <person-manager
          .tenant=${host.tenant}
          .readOnly=${!canEditKeywords}
          .hasDefinedTags=${hasDefinedTags}
        ></person-manager>
      </div>
    ` : html``}

    ${host.activeTab === 'tagging' ? html`
      <div slot="tagging" class="container p-4">
        <tagging-admin2
          .tenant=${host.tenant}
          .readOnly=${!canEditKeywords}
        ></tagging-admin2>
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
          <div style="display: flex; gap: 0.75rem; margin-top: 1.25rem; justify-content: center;">
            <button
              @click=${() => { window.location.href = '/'; }}
              style="padding: 0.5rem 1.25rem; background: white; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; color: #374151;"
            >Cancel</button>
            <button
              @click=${() => host.dispatchEvent(new CustomEvent('request-logout', { bubbles: true, composed: true }))}
              style="padding: 0.5rem 1.25rem; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; color: #374151;"
            >Sign Out</button>
          </div>
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
