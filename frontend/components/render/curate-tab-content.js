import { html } from 'lit';
import { renderCurateAiMLScore, renderCuratePermatagSummary } from './curate-image-fragments.js';
import { renderCurateRatingWidget, renderCurateRatingStatic } from './curate-rating-widgets.js';
import { renderSectionGuide } from '../shared/section-guide.js';

function renderCurateSearchIcon(size = 15) {
  return html`
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      style=${`display:block; width:${size}px; height:${size}px;`}
    >
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"></circle>
      <line x1="16" y1="16" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line>
    </svg>
  `;
}

function renderCurateFolderIcon(size = 15) {
  return html`
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      style=${`display:block; width:${size}px; height:${size}px;`}
    >
      <path d="M4 8.2a2.2 2.2 0 0 1 2.2-2.2h4.1l1.9 2h5.8A2.2 2.2 0 0 1 20.2 10v7.8A2.2 2.2 0 0 1 18 20H6.2A2.2 2.2 0 0 1 4 17.8z" fill="none" stroke="currentColor" stroke-width="1.8"></path>
    </svg>
  `;
}

function renderCurateStatsIcon(size = 15) {
  return html`
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      style=${`display:block; width:${size}px; height:${size}px;`}
    >
      <line x1="5" y1="20" x2="19.5" y2="20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></line>
      <rect x="6.2" y="11" width="2.8" height="7" rx="0.8" fill="currentColor"></rect>
      <rect x="10.9" y="8" width="2.8" height="10" rx="0.8" fill="currentColor"></rect>
      <rect x="15.6" y="5" width="2.8" height="13" rx="0.8" fill="currentColor"></rect>
    </svg>
  `;
}

function renderCurateAiTagIcon(size = 15) {
  return html`
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      style=${`display:block; width:${size}px; height:${size}px;`}
    >
      <path d="M12 4.6l1.6 4.1 4.1 1.6-4.1 1.6L12 16l-1.6-4.1-4.1-1.6 4.1-1.6z" fill="currentColor"></path>
      <path d="M18.2 4.8l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z" fill="currentColor" opacity="0.75"></path>
      <path d="M18 14.8l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z" fill="currentColor" opacity="0.75"></path>
    </svg>
  `;
}

function renderCurateInfoIcon(size = 15) {
  return html`
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      style=${`display:block; width:${size}px; height:${size}px;`}
    >
      <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.8"></circle>
      <circle cx="12" cy="8" r="1.1" fill="currentColor"></circle>
      <path d="M12 11.2v5.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
    </svg>
  `;
}

function renderCurateInfoGuide(host) {
  return renderSectionGuide({
    rows: [
      {
        label: 'Filter',
        description: 'Open the main Curate workspace to filter images and organize them directly.',
        glyphChar: 'F',
        accentClass: 'home-cta-explore',
        icon: renderCurateSearchIcon(21),
        onClick: () => host._handleCurateSubTabChange('filter'),
      },
      {
        label: 'Tag Suggester',
        description: 'Review AI-generated tag suggestions and accept or reject them.',
        glyphChar: 'A',
        accentClass: 'home-cta-curate',
        icon: renderCurateAiTagIcon(21),
        onClick: () => host._handleCurateSubTabChange('tag-suggester'),
      },
      {
        label: 'Browse by Folder',
        description: 'Work through assets grouped by source folder.',
        glyphChar: 'B',
        accentClass: 'home-cta-assets',
        icon: renderCurateFolderIcon(21),
        onClick: () => host._handleCurateSubTabChange('browse-by-folder'),
      },
      {
        label: 'Stats',
        description: 'Monitor collection coverage, tagging, and curation metrics.',
        glyphChar: 'S',
        accentClass: 'home-cta-upload',
        icon: renderCurateStatsIcon(21),
        onClick: () => host._handleCurateSubTabChange('stats'),
      },
    ],
  });
}

export function renderCurateTabContent(host, { formatCurateDate }) {
  const leftImages = host.curateImages;
  const selectedKeywordValueMain = (() => {
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
  const curateRefreshBusy = host.curateSubTab === 'stats'
    ? (host.curateHomeRefreshing || host.curateStatsLoading)
    : host.curateSubTab === 'tag-audit'
      ? host.curateAuditLoading
      : host.curateSubTab === 'tag-suggester'
        ? host.curateAiTagfinder2Loading
        : host.curateSubTab === 'browse-by-folder'
          ? !!browseFolderTab?.browseByFolderLoading
          : host.curateLoading;
  const showCurateStatsOverlay = host.curateStatsLoading || host.curateHomeRefreshing;

  return html`
    <div slot="curate" class="container">
      <div class="flex items-center justify-between gap-3 mb-4">
        <div class="flex items-center gap-2">
          <button
            class=${`right-panel-edge-toggle ${host.curateSubTab === 'info' ? 'active' : ''}`}
            type="button"
            title="Information"
            aria-label="Information"
            style="position:static; margin-left:0; transform:none;"
            @click=${() => host._handleCurateSubTabChange('info')}
          >
            <span style="display:inline-flex; align-items:center; justify-content:center;">
              ${renderCurateInfoIcon(23)}
            </span>
          </button>
          <button
            class=${`right-panel-edge-toggle ${host.curateSubTab === 'filter' ? 'active' : ''}`}
            type="button"
            title="Filter"
            aria-label="Filter"
            style="position:static; margin-left:0; transform:none;"
            @click=${() => host._handleCurateSubTabChange('filter')}
          >
            <span style="display:inline-flex; align-items:center; justify-content:center;">
              ${renderCurateSearchIcon(23)}
            </span>
          </button>
          <button
            class=${`right-panel-edge-toggle ${(host.curateSubTab === 'tag-suggester' || host.curateSubTab === 'tag-audit') ? 'active' : ''}`}
            type="button"
            title="Tag Suggester"
            aria-label="Tag Suggester"
            style="position:static; margin-left:0; transform:none;"
            @click=${() => host._handleCurateSubTabChange('tag-suggester')}
          >
            <span style="display:inline-flex; align-items:center; justify-content:center;">
              ${renderCurateAiTagIcon(23)}
            </span>
          </button>
          <button
            class=${`right-panel-edge-toggle ${host.curateSubTab === 'browse-by-folder' ? 'active' : ''}`}
            type="button"
            title="Browse by Folder"
            aria-label="Browse by Folder"
            style="position:static; margin-left:0; transform:none;"
            @click=${() => host._handleCurateSubTabChange('browse-by-folder')}
          >
            <span style="display:inline-flex; align-items:center; justify-content:center;">
              ${renderCurateFolderIcon(23)}
            </span>
          </button>
          <button
            class=${`right-panel-edge-toggle ${host.curateSubTab === 'stats' ? 'active' : ''}`}
            type="button"
            title="Stats"
            aria-label="Stats"
            style="position:static; margin-left:0; transform:none;"
            @click=${() => host._handleCurateSubTabChange('stats')}
          >
            <span style="display:inline-flex; align-items:center; justify-content:center;">
              ${renderCurateStatsIcon(23)}
            </span>
          </button>
        </div>
        <div class="flex items-center gap-3 text-xs text-gray-600">
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
          <button
            class="right-panel-edge-toggle"
            style="position:static; margin-left:0; transform:none;"
            ?disabled=${curateRefreshBusy}
            @click=${() => {
              if (host.curateSubTab === 'tag-audit') {
                host._refreshCurateAudit();
              } else if (host.curateSubTab === 'tag-suggester') {
                host._refreshCurateAiTagfinder2Summary();
              } else if (host.curateSubTab === 'stats') {
                host._refreshCurateHome();
              } else if (host.curateSubTab === 'browse-by-folder') {
                const panel = host.renderRoot?.querySelector('curate-browse-folder-tab');
                panel?.refresh?.();
              } else {
                const curateFilters = host._buildCurateFilters();
                host.curateHomeFilterPanel.updateFilters(curateFilters);
                host._fetchCurateHomeImages();
              }
            }}
            title="Refresh"
            aria-label="Refresh"
          >
            ${curateRefreshBusy ? html`<span class="curate-spinner"></span>` : html`<span aria-hidden="true">↻</span>`}
          </button>
        </div>
      </div>

      ${host.curateSubTab === 'stats' ? html`
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

      ${host.curateSubTab === 'filter' ? html`
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
            .sourceProvider=${host.curateSourceProvider}
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
            .curateNoPermatagCategories=${host.curateNoPermatagCategories}
            .curateNoPermatagOperator=${host.curateNoPermatagOperator}
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
            @curate-images-optimistic-remove=${(e) => {
              const ids = Array.isArray(e?.detail?.ids) ? e.detail.ids : [];
              const beforeCount = Array.isArray(host.curateImages) ? host.curateImages.length : 0;
              host._removeCurateImagesByIds(ids);
              const afterCount = Array.isArray(host.curateImages) ? host.curateImages.length : 0;
              const removedCount = Math.max(0, beforeCount - afterCount);
              if (removedCount > 0 && Number.isFinite(Number(host.curateTotal))) {
                host.curateTotal = Math.max(0, Number(host.curateTotal) - removedCount);
              }
            }}
            @curate-list-drop-refresh=${() => {
              host._applyCurateFilters();
            }}
            @open-similar-in-search=${host._handleOpenSimilarInSearch}
          ></curate-explore-tab>
        </div>
      ` : html``}

      ${host.curateSubTab === 'browse-by-folder' ? html`
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
            .zeroShotMinConfidence=${host.curateAuditZeroShotMinConfidence}
            .trainedMinConfidence=${host.curateAuditTrainedMinConfidence}
            .mlSimilaritySeedCount=${host.curateAuditMlSimilaritySeedCount}
            .mlSimilaritySimilarCount=${host.curateAuditMlSimilaritySimilarCount}
            .mlSimilarityDedupe=${host.curateAuditMlSimilarityDedupe}
            .mlSimilarityRandom=${host.curateAuditMlSimilarityRandom}
            .images=${host.curateAuditImages}
            .emptyState=${host.curateAuditEmptyState}
            .thumbSize=${host.curateThumbSize}
            .minRating=${host.curateAuditMinRating}
            .mediaType=${host.curateAuditMediaType}
            .dropboxPathPrefix=${host.curateAuditDropboxPathPrefix}
            .filenameQuery=${host.curateAuditFilenameQuery}
            .textQuery=${host.curateAuditTextQuery}
            .sourceProvider=${host.curateAuditSourceProvider}
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
            @audit-ai-min-confidence-changed=${(e) => host._handleCurateAuditAiMinConfidenceChange(e.detail)}
            @audit-ai-ml-similarity-settings-changed=${(e) => host._handleCurateAuditMlSimilaritySettingsChange(e.detail)}
            @audit-save-and-load-more=${(e) => host._handleCurateAuditSaveAndLoadMore(e.detail)}
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
            @audit-back-to-training=${host._handleCurateAuditBackToTraining}
            @open-similar-in-search=${host._handleOpenSimilarInSearch}
          ></curate-audit-tab>
        </div>
      ` : html``}

      ${host.curateSubTab === 'tag-suggester' ? html`
        <div>
          <curate-ai-tagger
            .summary=${host.curateAiTagfinder2Summary}
            .loading=${host.curateAiTagfinder2Loading}
            .error=${host.curateAiTagfinder2Error}
            .zeroShotMinConfidence=${host.curateAiTagfinder2ZeroShotMinConfidence}
            .trainedMinConfidence=${host.curateAiTagfinder2TrainedMinConfidence}
            @threshold-changed=${(e) => host._handleCurateAiTagfinder2ThresholdChanged(e.detail)}
            @row-selected=${(e) => host._handleCurateAiTagfinder2RowSelected(e.detail)}
          ></curate-ai-tagger>
        </div>
      ` : html``}

      ${host.curateSubTab === 'info' ? html`
        <div>
          ${renderCurateInfoGuide(host)}
        </div>
      ` : html``}
    </div>
  `;
}
