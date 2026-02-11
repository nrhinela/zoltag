import { html } from 'lit';
import { renderCuratePermatagSummary } from './curate-image-fragments.js';
import { renderCurateRatingWidget, renderCurateRatingStatic } from './curate-rating-widgets.js';
import { formatStatNumber } from '../shared/formatting.js';

function renderCtaIcon(iconKey) {
  if (iconKey === 'search') {
    return html`
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"></circle>
        <line x1="16" y1="16" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line>
      </svg>
    `;
  }
  if (iconKey === 'curate') {
    return html`
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.2l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8z" fill="currentColor"></path>
      </svg>
    `;
  }
  if (iconKey === 'lists') {
    return html`
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="6" cy="7" r="1.2" fill="currentColor"></circle>
        <circle cx="6" cy="12" r="1.2" fill="currentColor"></circle>
        <circle cx="6" cy="17" r="1.2" fill="currentColor"></circle>
        <line x1="9" y1="7" x2="19" y2="7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></line>
        <line x1="9" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></line>
        <line x1="9" y1="17" x2="19" y2="17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></line>
      </svg>
    `;
  }
  if (iconKey === 'admin') {
    return html`
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3l6 2.7v5.3c0 4.1-2.4 7.6-6 9-3.6-1.4-6-4.9-6-9V5.7z" fill="none" stroke="currentColor" stroke-width="1.8"></path>
        <circle cx="12" cy="11" r="2.1" fill="none" stroke="currentColor" stroke-width="1.8"></circle>
        <path d="M12 7.2v1.2M12 13.6v1.2M8.8 11h1.2M14 11h1.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path>
      </svg>
    `;
  }
  if (iconKey === 'stats') {
    return html`
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 18.5h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
        <rect x="6.2" y="11.4" width="2.8" height="5.6" rx="0.8" fill="currentColor"></rect>
        <rect x="10.6" y="8.9" width="2.8" height="8.1" rx="0.8" fill="currentColor"></rect>
        <rect x="15" y="6.4" width="2.8" height="10.6" rx="0.8" fill="currentColor"></rect>
      </svg>
    `;
  }
  if (iconKey === 'keywords') {
    return html`
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4.2 7.2h15.6M6.5 12h11M8.6 16.8h6.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
        <circle cx="5.2" cy="7.2" r="1" fill="currentColor"></circle>
        <circle cx="7.6" cy="12" r="1" fill="currentColor"></circle>
        <circle cx="9.7" cy="16.8" r="1" fill="currentColor"></circle>
      </svg>
    `;
  }
  if (iconKey === 'assets') {
    return html`
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="5" width="16" height="14" rx="2.4" ry="2.4" fill="none" stroke="currentColor" stroke-width="1.8"></rect>
        <path d="M7 15.5l3-3.2 2.3 2.4 2.7-2.6 2 1.9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
        <circle cx="9.2" cy="9.2" r="1.2" fill="currentColor"></circle>
      </svg>
    `;
  }
  return html`
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 8.2a2.2 2.2 0 0 1 2.2-2.2h4.1l1.9 2h5.8A2.2 2.2 0 0 1 20.2 10v7.8A2.2 2.2 0 0 1 18 20H6.2A2.2 2.2 0 0 1 4 17.8z" fill="none" stroke="currentColor" stroke-width="1.8"></path>
      <path d="M12 10.4v5.2M9.4 13h5.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
    </svg>
  `;
}

function renderCtaGlyph(glyphKey) {
  if (glyphKey === 'search') {
    return html`<span class="home-cta-glyph-char">S</span>`;
  }
  if (glyphKey === 'curate') {
    return html`<span class="home-cta-glyph-char">C</span>`;
  }
  if (glyphKey === 'lists') {
    return html`<span class="home-cta-glyph-char">L</span>`;
  }
  if (glyphKey === 'admin') {
    return html`<span class="home-cta-glyph-char">A</span>`;
  }
  if (glyphKey === 'stats') {
    return html`<span class="home-cta-glyph-char">T</span>`;
  }
  if (glyphKey === 'keywords') {
    return html`<span class="home-cta-glyph-char">K</span>`;
  }
  if (glyphKey === 'assets') {
    return html`<span class="home-cta-glyph-char">B</span>`;
  }
  return html`<span class="home-cta-glyph-char">+</span>`;
}

export function renderHomeTabContent(host, { navCards, formatCurateDate }) {
  const imageStats = host.imageStats || {};
  const totalImages = Number(imageStats.image_count || 0);
  const taggedImages = Number(imageStats.positive_permatag_image_count || 0);
  const coverageRate = totalImages > 0
    ? `${Math.round((taggedImages / totalImages) * 100)}%`
    : '0%';
  const cardMetrics = {
    lists: [
      { label: 'Lists', value: formatStatNumber(imageStats.list_count) },
    ],
    curate: [
      { label: 'Tags', value: formatStatNumber(imageStats.positive_permatag_count) },
      { label: 'Rated', value: formatStatNumber(imageStats.rated_image_count) },
    ],
    'tagging-stats': [
      { label: 'Coverage', value: coverageRate },
    ],
    'keyword-definitions': [
      { label: 'Categories', value: formatStatNumber(imageStats.category_count) },
      { label: 'Keywords', value: formatStatNumber(imageStats.keyword_count) },
    ],
    'asset-library': [
      { label: 'Items', value: formatStatNumber(imageStats.image_count) },
    ],
  };

  const ctaCards = [
    {
      key: 'search',
      label: 'Search',
      subtitle: 'Find photos fast with filters and natural-language queries.',
      iconKey: 'search',
      accentClass: 'home-cta-search',
      glyphKey: 'search',
    },
    {
      key: 'lists',
      label: 'Lists',
      subtitle: 'Create and download collections of content',
      iconKey: 'lists',
      accentClass: 'home-cta-upload',
      glyphKey: 'lists',
    },
    {
      key: 'curate',
      label: 'Curate',
      subtitle: 'Categorize and rate items, organize lists.',
      iconKey: 'curate',
      accentClass: 'home-cta-curate',
      glyphKey: 'curate',
      requiresCurate: true,
    },
    {
      key: 'tagging-stats',
      tab: 'curate',
      subTab: 'home',
      label: 'Tagging Stats',
      subtitle: 'View tagging coverage and distribution metrics.',
      iconKey: 'stats',
      accentClass: 'home-cta-admin',
      glyphKey: 'stats',
      requiresCurate: true,
    },
    {
      key: 'keyword-definitions',
      tab: 'library',
      subTab: 'keywords',
      adminSubTab: 'tagging',
      label: 'Keyword Definitions',
      subtitle: 'Define keyword categories and tag vocabulary.',
      iconKey: 'keywords',
      accentClass: 'home-cta-keywords',
      glyphKey: 'keywords',
    },
    {
      key: 'asset-library',
      tab: 'library',
      subTab: 'assets',
      label: 'Asset Library',
      subtitle: 'Browse and review uploaded and provider-backed files.',
      iconKey: 'assets',
      accentClass: 'home-cta-assets',
      glyphKey: 'assets',
    },
  ].filter((card) => !(card.requiresCurate && !host._canCurate()));

  const handleNavigate = (card) => {
    host._handleHomeNavigate({
      detail: {
        tab: card.tab || card.key,
        subTab: card.subTab,
        adminSubTab: card.adminSubTab,
      },
    });
  };

  return html`
    <div slot="home" class="home-tab-shell">
      <div class="container">
        <div class="home-overview-layout">
          <div class="home-overview-left">
            <div class="home-cta-grid home-cta-grid-quad">
              ${ctaCards.map((card) => html`
                <button
                  type="button"
                  class="home-cta-card ${card.accentClass}"
                  @click=${() => handleNavigate(card)}
                >
                  <div class="home-cta-backdrop" aria-hidden="true"></div>
                  <div class="home-cta-glyph" aria-hidden="true">
                    ${renderCtaGlyph(card.glyphKey)}
                  </div>
                  <div class="home-cta-icon-wrap" aria-hidden="true">
                    ${renderCtaIcon(card.iconKey)}
                  </div>
                  <div class="home-cta-content">
                    <div class="home-cta-title">${card.label}</div>
                    <div class="home-cta-subtitle">${card.subtitle}</div>
                    ${cardMetrics[card.key]?.length ? html`
                      <div class="home-cta-metrics">
                        ${cardMetrics[card.key].map((metric) => html`
                          <div class="home-cta-metric">
                            <span class="home-cta-metric-label">${metric.label}</span>
                            <span class="home-cta-metric-value">${metric.value}</span>
                          </div>
                        `)}
                      </div>
                    ` : html``}
                  </div>
                  <div class="home-cta-arrow" aria-hidden="true">
                    <span class="home-cta-arrow-char">&#8594;</span>
                  </div>
                </button>
              `)}
            </div>
          </div>
          <div class="home-overview-right">
            <div class="home-recommendations-panel" aria-label="Recommendations panel">
              <div class="home-recommendations-header">Recommendations</div>
              <div class="home-recommendations-empty">Coming soon</div>
            </div>
          </div>
        </div>
      </div>
      ${host.homeLoading ? html`
        <div class="home-loading-overlay" aria-live="polite" aria-label="Refreshing home statistics">
          <div class="home-loading-card">
            <span class="curate-spinner xlarge" aria-hidden="true"></span>
            <span class="home-loading-text">Refreshing tenant statistics...</span>
          </div>
        </div>
      ` : html``}
    </div>
  `;
}

export function renderSearchTabContent(host, { formatCurateDate }) {
  return html`
    <search-tab
      slot="search"
      .tenant=${host.tenant}
      .searchFilterPanel=${host.searchFilterPanel}
      .searchImages=${host.searchImages}
      .searchTotal=${host.searchTotal}
      .curateThumbSize=${host.curateThumbSize}
      .tagStatsBySource=${host.tagStatsBySource}
      .activeCurateTagSource=${host.activeCurateTagSource}
      .keywords=${host.keywords}
      .imageStats=${host.imageStats}
      .searchOrderBy=${host.searchOrderBy}
      .searchDateOrder=${host.searchOrderDirection}
      .renderCurateRatingWidget=${(image) => renderCurateRatingWidget(host, image)}
      .renderCurateRatingStatic=${renderCurateRatingStatic}
      .renderCuratePermatagSummary=${renderCuratePermatagSummary}
      .formatCurateDate=${formatCurateDate}
      @sort-changed=${host._handleSearchSortChanged}
      @search-images-optimistic-remove=${host._handleSearchOptimisticRemove}
      @thumb-size-changed=${(e) => host.curateThumbSize = e.detail.size}
      @image-clicked=${(e) => host._handleCurateImageClick(e.detail.event, e.detail.image, e.detail.imageSet)}
      @image-selected=${(e) => host._handleCurateImageClick(null, e.detail.image, e.detail.imageSet)}
    ></search-tab>
  `;
}
