import { html } from 'lit';
import { renderCuratePermatagSummary } from './curate-image-fragments.js';
import { renderCurateRatingWidget, renderCurateRatingStatic } from './curate-rating-widgets.js';

export function renderHomeTabContent(host, { navCards, formatCurateDate }) {
  return html`
    <div slot="home">
      <div class="container">
        <div class="curate-subtabs">
          <button
            class="curate-subtab ${host.homeSubTab === 'overview' ? 'active' : ''}"
            @click=${() => { host.homeSubTab = 'overview'; }}
          >
            Overview
          </button>
          <button
            class="curate-subtab ${host.homeSubTab === 'insights' ? 'active' : ''}"
            @click=${() => { host.homeSubTab = 'insights'; }}
          >
            Insights
          </button>
        </div>
      </div>
      ${host.homeSubTab === 'overview' ? html`
        <home-tab
          .imageStats=${host.imageStats}
          .mlTrainingStats=${host.mlTrainingStats}
          .navCards=${navCards}
          @navigate=${host._handleHomeNavigate}
        ></home-tab>
      ` : html``}
      ${host.homeSubTab === 'insights' ? html`
        <home-insights-tab
          .imageStats=${host.imageStats}
          .mlTrainingStats=${host.mlTrainingStats}
          .tagStatsBySource=${host.tagStatsBySource}
          .keywords=${host.keywords}
        ></home-insights-tab>
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
      @thumb-size-changed=${(e) => host.curateThumbSize = e.detail.size}
      @image-clicked=${(e) => host._handleCurateImageClick(e.detail.event, e.detail.image, e.detail.imageSet)}
      @image-selected=${(e) => host._handleCurateImageClick(null, e.detail.image, e.detail.imageSet)}
    ></search-tab>
  `;
}
