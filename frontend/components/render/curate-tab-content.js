import { html } from 'lit';
import { renderCurateAiMLScore, renderCuratePermatagSummary } from './curate-image-fragments.js';
import { renderCurateRatingWidget, renderCurateRatingStatic } from './curate-rating-widgets.js';

export function renderCurateTabContent(host, { formatCurateDate }) {
  const leftImages = host.curateImages;
  const selectedKeywordValueMain = (() => {
    if (host.curateNoPositivePermatags) {
      return '__untagged__';
    }
    const entries = Object.entries(host.curateKeywordFilters || {});
    for (const [category, keywordsSet] of entries) {
      if (keywordsSet && keywordsSet.size > 0) {
        const [keyword] = Array.from(keywordsSet);
        if (keyword) {
          return `${encodeURIComponent(category)}::${encodeURIComponent(keyword)}`;
        }
      }
    }
    return '';
  })();
  const browseFolderTab = host.renderRoot?.querySelector('curate-browse-folder-tab');
  const curateRefreshBusy = host.curateSubTab === 'home'
    ? (host.curateHomeRefreshing || host.curateStatsLoading)
    : (host.curateSubTab === 'tag-audit'
      ? host.curateAuditLoading
      : (host.curateSubTab === 'browse-folder' ? !!browseFolderTab?.browseByFolderLoading : host.curateLoading));
  const showCurateStatsOverlay = host.curateStatsLoading || host.curateHomeRefreshing;

  return html`
    <div slot="curate" class="container">
      <div class="flex items-center justify-between mb-4">
        <div class="curate-subtabs">
          <button
            class="curate-subtab ${host.curateSubTab === 'main' ? 'active' : ''}"
            @click=${() => host._handleCurateSubTabChange('main')}
          >
            Explore
          </button>
          <button
            class="curate-subtab ${host.curateSubTab === 'browse-folder' ? 'active' : ''}"
            @click=${() => host._handleCurateSubTabChange('browse-folder')}
          >
            Browse by Folder
          </button>
          <button
            class="curate-subtab ${host.curateSubTab === 'tag-audit' ? 'active' : ''}"
            @click=${() => host._handleCurateSubTabChange('tag-audit')}
          >
            Tag audit
          </button>
          <button
            class="curate-subtab ${host.curateSubTab === 'home' ? 'active' : ''}"
            @click=${() => host._handleCurateSubTabChange('home')}
          >
            Stats
          </button>
          <button
            class="curate-subtab ${host.curateSubTab === 'help' ? 'active' : ''}"
            @click=${() => host._handleCurateSubTabChange('help')}
          >
            <i class="fas fa-question-circle mr-1"></i>Help
          </button>
        </div>
        <div class="ml-auto flex items-center gap-4 text-xs text-gray-600 mr-4">
          <label class="font-semibold text-gray-600">Thumb</label>
          <input
            type="range"
            min="80"
            max="220"
            step="10"
            .value=${String(host.curateThumbSize)}
            @input=${host._handleCurateThumbSizeChange}
            class="w-24"
          >
          <span class="w-12 text-right text-xs">${host.curateThumbSize}px</span>
        </div>
        <button
          class="inline-flex items-center gap-2 border rounded-lg px-4 py-2 text-xs text-gray-600 hover:bg-gray-50"
          ?disabled=${curateRefreshBusy}
          @click=${() => {
            if (host.curateSubTab === 'tag-audit') {
              host._refreshCurateAudit();
            } else if (host.curateSubTab === 'home') {
              host._refreshCurateHome();
            } else if (host.curateSubTab === 'browse-folder') {
              const panel = host.renderRoot?.querySelector('curate-browse-folder-tab');
              panel?.refresh?.();
            } else {
              const curateFilters = host._buildCurateFilters();
              host.curateHomeFilterPanel.updateFilters(curateFilters);
              host._fetchCurateHomeImages();
            }
          }}
          title="Refresh"
        >
          ${curateRefreshBusy ? html`<span class="curate-spinner"></span>` : html`<span aria-hidden="true">↻</span>`}
          ${curateRefreshBusy ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      ${host.curateSubTab === 'home' ? html`
        <div>
          ${showCurateStatsOverlay ? html`
            <div class="curate-loading-overlay" aria-label="Loading">
              <span class="curate-spinner large"></span>
            </div>
          ` : html``}
          <curate-home-tab-v2
            .imageStats=${host.imageStats}
            .tagStatsBySource=${host.tagStatsBySource}
            .activeCurateTagSource=${host.activeCurateTagSource}
            .curateCategoryCards=${host.curateCategoryCards}
            @tag-source-changed=${(e) => {
              host.activeCurateTagSource = e.detail.source;
              host._updateCurateCategoryCards();
            }}
          ></curate-home-tab-v2>
        </div>
      ` : html``}

      ${host.curateSubTab === 'main' ? html`
        <div>
          <curate-explore-tab
            .tenant=${host.tenant}
            .images=${leftImages}
            .thumbSize=${host.curateThumbSize}
            .orderBy=${host.curateOrderBy}
            .dateOrder=${host.curateOrderDirection}
            .limit=${host.curateLimit}
            .offset=${host.curatePageOffset}
            .total=${host.curateTotal}
            .loading=${host.curateLoading}
            .curatePinnedImageId=${host.curatePinnedImageId}
            .curateSimilarityAssetUuid=${host.curateSimilarityAssetUuid}
            .mediaType=${host.curateMediaType}
            .dragSelection=${host.curateDragSelection}
            .dragSelecting=${host.curateDragSelecting}
            .dragStartIndex=${host.curateDragStartIndex}
            .dragEndIndex=${host.curateDragEndIndex}
            .minRating=${host.curateMinRating}
            .dropboxPathPrefix=${host.curateDropboxPathPrefix}
            .filenameQuery=${host.curateFilenameQuery}
            .textQuery=${host.curateTextQuery}
            .renderCurateRatingWidget=${(image) => renderCurateRatingWidget(host, image)}
            .renderCurateRatingStatic=${renderCurateRatingStatic}
            .renderCuratePermatagSummary=${renderCuratePermatagSummary}
            .renderCurateAiMLScore=${(image) => renderCurateAiMLScore(host, image)}
            .formatCurateDate=${formatCurateDate}
            .imageStats=${host.imageStats}
            .curateCategoryCards=${host.curateCategoryCards}
            .selectedKeywordValueMain=${selectedKeywordValueMain}
            .curateKeywordFilters=${host.curateKeywordFilters}
            .curateKeywordOperators=${host.curateKeywordOperators}
            .curateNoPositivePermatags=${host.curateNoPositivePermatags}
            .listFilterId=${host.curateListExcludeId || host.curateListId}
            .listFilterMode=${host.curateListExcludeId ? 'exclude' : 'include'}
            .tagStatsBySource=${host.tagStatsBySource}
            .activeCurateTagSource=${host.activeCurateTagSource}
            .keywords=${host.keywords}
            .curateExploreTargets=${host.curateExploreTargets}
            .curateExploreRatingEnabled=${host.curateExploreRatingEnabled}
            .curateExploreRatingCount=${host.curateExploreRatingCount}
            @image-clicked=${(e) => host._handleCurateImageClick(e.detail.event, e.detail.image, e.detail.imageSet)}
            @sort-changed=${(e) => {
              host.curateOrderBy = e.detail.orderBy;
              host.curateOrderDirection = e.detail.dateOrder;
              host._applyCurateFilters();
            }}
            @thumb-size-changed=${(e) => { host.curateThumbSize = e.detail.size; }}
            @keyword-selected=${(e) => host._handleCurateKeywordSelect(e.detail.event, e.detail.mode)}
            @pagination-changed=${(e) => {
              host.curatePageOffset = e.detail.offset;
              host.curateLimit = e.detail.limit;
              host._applyCurateFilters();
            }}
            @hotspot-changed=${host._handleCurateHotspotChanged}
            @selection-changed=${(e) => { host.curateDragSelection = e.detail.selection; }}
            @rating-drop=${(e) => host._handleCurateExploreRatingDrop(e.detail.event, e.detail.rating)}
            @curate-filters-changed=${host._handleCurateChipFiltersChanged}
            @curate-similarity-context-changed=${(e) => {
              host.curateSimilarityAssetUuid = e?.detail?.assetUuid || null;
            }}
            @list-filter-exclude=${host._handleCurateListExcludeFromRightPanel}
            @open-similar-in-search=${host._handleOpenSimilarInSearch}
          ></curate-explore-tab>
        </div>
      ` : html``}

      ${host.curateSubTab === 'browse-folder' ? html`
        <div>
          <curate-browse-folder-tab
            .tenant=${host.tenant}
            .thumbSize=${host.curateThumbSize}
            .curateOrderBy=${host.curateOrderBy}
            .curateDateOrder=${host.curateOrderDirection}
            .renderCurateRatingWidget=${(image) => renderCurateRatingWidget(host, image)}
            .renderCurateRatingStatic=${renderCurateRatingStatic}
            .renderCuratePermatagSummary=${renderCuratePermatagSummary}
            .formatCurateDate=${formatCurateDate}
            .tagStatsBySource=${host.tagStatsBySource}
            .activeCurateTagSource=${host.activeCurateTagSource}
            .keywords=${host.keywords}
            @sort-changed=${(e) => {
              host.curateOrderBy = e.detail.orderBy;
              host.curateOrderDirection = e.detail.dateOrder;
            }}
            @image-clicked=${(e) => host._handleCurateImageClick(e.detail.event, e.detail.image, e.detail.imageSet)}
            @open-similar-in-search=${host._handleOpenSimilarInSearch}
          ></curate-browse-folder-tab>
        </div>
      ` : html``}

      ${host.curateSubTab === 'tag-audit' ? html`
        <div>
          <curate-audit-tab
            .tenant=${host.tenant}
            .keyword=${host.curateAuditKeyword}
            .keywordCategory=${host.curateAuditCategory}
            .mode=${host.curateAuditMode}
            .aiEnabled=${host.curateAuditAiEnabled}
            .aiModel=${host.curateAuditAiModel}
            .mlThreshold=${host.curateAuditMlThreshold ?? null}
            .images=${host.curateAuditImages}
            .thumbSize=${host.curateThumbSize}
            .minRating=${host.curateAuditMinRating}
            .mediaType=${host.curateAuditMediaType}
            .dropboxPathPrefix=${host.curateAuditDropboxPathPrefix}
            .filenameQuery=${host.curateAuditFilenameQuery}
            .textQuery=${host.curateAuditTextQuery}
            .offset=${host.curateAuditPageOffset || 0}
            .limit=${host.curateAuditLimit}
            .total=${host.curateAuditTotal}
            .loading=${host.curateAuditLoading}
            .loadAll=${host.curateAuditLoadAll}
            .dragSelection=${host.curateAuditDragSelection}
            .dragSelecting=${host.curateAuditDragSelecting}
            .dragStartIndex=${host.curateAuditDragStartIndex}
            .dragEndIndex=${host.curateAuditDragEndIndex}
            .renderCurateRatingWidget=${(image) => renderCurateRatingWidget(host, image)}
            .renderCurateRatingStatic=${renderCurateRatingStatic}
            .renderCurateAiMLScore=${(image) => renderCurateAiMLScore(host, image)}
            .renderCuratePermatagSummary=${renderCuratePermatagSummary}
            .formatCurateDate=${formatCurateDate}
            .tagStatsBySource=${host.tagStatsBySource}
            .activeCurateTagSource=${host.activeCurateTagSource}
            .keywords=${host.keywords}
            .targets=${host.curateAuditTargets}
            .ratingEnabled=${host.curateAuditRatingEnabled}
            .ratingCount=${host.curateAuditRatingCount}
            @audit-mode-changed=${(e) => host._handleCurateAuditModeChange(e.detail.mode)}
            @audit-ai-enabled-changed=${(e) => host._handleCurateAuditAiEnabledChange({ target: { checked: e.detail.enabled } })}
            @audit-ai-model-changed=${(e) => host._handleCurateAuditAiModelChange(e.detail.model)}
            @pagination-changed=${(e) => {
              host.curateAuditPageOffset = e.detail.offset;
              host.curateAuditLimit = e.detail.limit;
              host._fetchCurateAuditImages();
            }}
            @image-clicked=${(e) => host._handleCurateImageClick(e.detail.event, e.detail.image, e.detail.imageSet)}
            @selection-changed=${(e) => {
              host.curateAuditDragSelection = e.detail.selection;
            }}
            @hotspot-changed=${host._handleCurateAuditHotspotChanged}
            @rating-toggle=${(e) => {
              host.curateAuditRatingEnabled = e.detail.enabled;
            }}
            @rating-drop=${(e) => host._handleCurateAuditRatingDrop(e.detail.event)}
            @curate-audit-filters-changed=${host._handleCurateAuditChipFiltersChanged}
            @open-similar-in-search=${host._handleOpenSimilarInSearch}
          ></curate-audit-tab>
        </div>
      ` : html``}

      ${host.curateSubTab === 'help' ? html`
        <div>
          <div class="space-y-6">
            <div class="bg-white rounded-lg shadow p-6">
              <h2 class="text-2xl font-bold text-gray-900 mb-6">Curate Your Collection</h2>

              <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <h3 class="text-lg font-semibold text-blue-900 mb-3">Getting Started</h3>
                <p class="text-blue-800 text-sm mb-4">
                  Welcome to the Curation interface! Here's how to organize your collection:
                </p>
                <ol class="space-y-3 text-sm text-blue-800">
                  <li class="flex gap-3">
                    <span class="font-bold flex-shrink-0">1.</span>
                    <span><button @click=${() => host._handleCurateSubTabChange('main')} class="font-bold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer">Explore Tab</button>: Browse, select, and organize images by dragging them between panes. Use filters and keywords to find exactly what you need.</span>
                  </li>
                  <li class="flex gap-3">
                    <span class="font-bold flex-shrink-0">2.</span>
                    <span><button @click=${() => host._handleCurateSubTabChange('tag-audit')} class="font-bold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer">Tag Audit Tab</button>: Review and validate machine-generated tags. Ensure your automated tags are accurate and complete.</span>
                  </li>
                  <li class="flex gap-3">
                    <span class="font-bold flex-shrink-0">3.</span>
                    <span><button @click=${() => host._handleCurateSubTabChange('home')} class="font-bold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer">Stats</button>: Monitor tag statistics and understand your collection's tagging patterns at a glance.</span>
                  </li>
                </ol>
              </div>

              <div class="bg-green-50 border border-green-200 rounded-lg p-4">
                <h3 class="text-lg font-semibold text-green-900 mb-3">Quick Tips</h3>
                <ul class="space-y-2 text-sm text-green-800">
                  <li class="flex gap-2">
                    <span>📌</span>
                    <span>Click and drag images to move them between left and right panes</span>
                  </li>
                  <li class="flex gap-2">
                    <span>🏷️</span>
                    <span>Drag images into hotspots to add or remove tags</span>
                  </li>
                  <li class="flex gap-2">
                    <span>🔍</span>
                    <span>Filter by keywords, ratings, and lists to focus on specific images</span>
                  </li>
                  <li class="flex gap-2">
                    <span>⚙️</span>
                    <span>Switch between Permatags, Keyword-Model, and Zero-Shot in the histogram</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      ` : html``}
    </div>
  `;
}
