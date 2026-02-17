import {
  buildCurateFilterObject,
  getCurateAuditFetchKey,
  getCurateHomeFetchKey,
} from '../shared/curate-filters.js';
import { shouldAutoRefreshCurateStats } from '../shared/curate-stats.js';
import { getSimilarImages } from '../../services/api.js';

export function bindAppDelegateMethods(host) {
  host._getCurateDefaultState = () => host._curateHomeState.getDefaultState();

  host._snapshotCurateState = () => host._curateHomeState.snapshotState();

  host._restoreCurateState = (state) => {
    host._curateHomeState.restoreState(state || host._getCurateDefaultState());
    host._curateDragOrder = null;
    host._cancelCuratePressState();
  };

  host._handleCurateHotspotChanged = (event) =>
    host._curateExploreState.handleHotspotChanged(event);

  host._handleCurateAuditHotspotChanged = (event) => {
    const detail = {
      changeType: event.detail.type?.replace('-change', '').replace('-target', '').replace('hotspot-drop', 'drop'),
      targetId: event.detail.targetId,
      value: event.detail.value,
      event: event.detail.event,
    };
    return host._curateAuditState.handleHotspotChanged({ detail });
  };

  host._removeCurateImagesByIds = (ids) =>
    host._curateHomeState.removeImagesByIds(ids);

  host._removeAuditImagesByIds = (ids) =>
    host._curateAuditState.removeImagesByIds(ids);

  host._processExploreTagDrop = (ids, target) =>
    host._curateExploreState.processTagDrop(ids, target);

  host._syncAuditHotspotPrimary = () =>
    host._curateAuditState.syncHotspotPrimary();

  host._handleCurateExploreRatingDrop = (event, ratingValue = null) =>
    host._curateExploreState.handleRatingDrop(event, ratingValue);

  host._handleCurateAuditRatingDrop = (event) =>
    host._auditRatingHandlers.handleDrop(event);

  host._loadCurrentUser = async () =>
    host._appShellState.loadCurrentUser();

  host._canCurate = () => host._appShellState.canCurate();

  host._handleTabChange = (event) =>
    host._appShellState.handleTabChange(event);

  host._handleHomeNavigate = (event) =>
    host._appShellState.handleHomeNavigate(event);

  host._initializeTab = (tab, { force = false } = {}) =>
    host._appShellState.initializeTab(tab, { force });

  host._showExploreRatingDialog = (imageIds) =>
    host._ratingModalState.showExploreRatingDialog(imageIds);

  host._showAuditRatingDialog = (imageIds) =>
    host._ratingModalState.showAuditRatingDialog(imageIds);

  host._handleRatingModalClick = (rating) =>
    host._ratingModalState.handleRatingModalClick(rating);

  host._closeRatingModal = () =>
    host._ratingModalState.closeRatingModal();

  host._handleEscapeKey = (event) =>
    host._ratingModalState.handleEscapeKey(event);

  host._applyExploreRating = async (imageIds, rating) =>
    host._ratingModalState.applyExploreRating(imageIds, rating);

  host._applyAuditRating = async (imageIds, rating) =>
    host._ratingModalState.applyAuditRating(imageIds, rating);

  host._applyCurateFilters = ({ resetOffset = false } = {}) =>
    host._curateHomeState.applyCurateFilters({ resetOffset });

  host._cancelCuratePressState = () =>
    host._exploreSelectionHandlers.cancelPressState();

  host._cancelCurateAuditPressState = () =>
    host._auditSelectionHandlers.cancelPressState();

  host._handleCurateKeywordSelect = (event, mode) =>
    host._curateHomeState.handleKeywordSelect(event, mode);

  host._updateCurateCategoryCards = () =>
    host._curateHomeState.updateCurateCategoryCards();

  host._fetchCurateHomeImages = async () =>
    host._curateHomeState.fetchCurateHomeImages();

  host._refreshCurateHome = async () =>
    host._curateHomeState.refreshCurateHome();

  host._handleTenantChange = (event) =>
    host._appShellState.handleTenantChange(event);

  host._handleOpenUploadModal = () => {
    host.showUploadModal = true;
  };

  host._handleOpenUploadLibraryModal = () => {
    host.showUploadLibraryModal = true;
  };

  host._handleCloseUploadModal = () => {
    host.showUploadModal = false;
  };

  host._handleCloseUploadLibraryModal = () => {
    host.showUploadLibraryModal = false;
  };

  host._handlePipelineOpenImage = (event) => {
    const image = event?.detail?.image;
    if (!image?.id) return;
    host.curateEditorImage = image;
    host.curateEditorImageSet = Array.isArray(host.curateImages) ? [...host.curateImages] : [];
    host.curateEditorImageIndex = host.curateEditorImageSet.findIndex((img) => img.id === image.id);
    host.curateEditorOpen = true;
  };

  host._handleUploadComplete = () => {
    const curateFilters = buildCurateFilterObject(host);
    host.curateHomeFilterPanel.updateFilters(curateFilters);
    host._fetchCurateHomeImages();
    host.fetchStats({
      force: true,
      includeTagStats: host.activeTab === 'curate' && host.curateSubTab === 'home',
    });
    host.showUploadModal = false;
  };

  host._handleUploadLibraryComplete = () => {
    const curateFilters = buildCurateFilterObject(host);
    host.curateHomeFilterPanel.updateFilters(curateFilters);
    host._fetchCurateHomeImages();
    host.fetchStats({
      force: true,
      includeTagStats: host.activeTab === 'curate' && host.curateSubTab === 'home',
    });
    host.assetsRefreshToken = (host.assetsRefreshToken || 0) + 1;
    host.showUploadLibraryModal = false;
  };

  host._handleCurateChipFiltersChanged = (event) =>
    host._curateHomeState.handleChipFiltersChanged(event);

  host._handleCurateListExcludeFromRightPanel = (event) =>
    host._curateHomeState.handleListExcludeFromRightPanel(event);

  host._handleCurateAuditChipFiltersChanged = (event) =>
    host._curateAuditState.handleChipFiltersChanged(event);

  host._fetchDropboxFolders = async (query) =>
    host._searchState.fetchDropboxFolders(query);

  host._handleCurateThumbSizeChange = (event) => {
    host.curateThumbSize = Number(event.target.value);
  };

  host._handleCurateSubTabChange = (nextTab) =>
    host._curateExploreState.handleSubTabChange(nextTab);

  host._buildCurateFilters = (options = {}) =>
    buildCurateFilterObject(host, options);

  host._getCurateHomeFetchKey = () =>
    getCurateHomeFetchKey(host);

  host._getCurateAuditFetchKey = (options = {}) =>
    getCurateAuditFetchKey(host, options);

  host._shouldAutoRefreshCurateStats = () =>
    shouldAutoRefreshCurateStats(host);

  host._loadExploreByTagData = async (forceRefresh = false) =>
    host._curateExploreState.loadExploreByTagData(forceRefresh);

  host._handleCurateAuditModeChange = (valueOrEvent) => {
    const mode = typeof valueOrEvent === 'string'
      ? valueOrEvent
      : valueOrEvent.target.value;
    return host._curateAuditState.handleModeChange(mode);
  };

  host._handleCurateAuditAiEnabledChange = (event) =>
    host._curateAuditState.handleAiEnabledChange(event.target.checked);

  host._handleCurateAuditAiModelChange = (nextModel) =>
    host._curateAuditState.handleAiModelChange(nextModel);

  host._fetchCurateAuditImages = async (options = {}) =>
    host._curateAuditState.fetchCurateAuditImages(options);

  host._refreshCurateAudit = () =>
    host._curateAuditState.refreshAudit();

  host._handleCurateImageClick = (event, image, imageSet) =>
    host._curateHomeState.handleCurateImageClick(event, image, imageSet);

  const _buildSimilarOpenPayload = (event) => {
    const sourceImage = event?.detail?.sourceImage || null;
    const similarImages = Array.isArray(event?.detail?.images)
      ? event.detail.images
      : [];
    const orderedImages = [];
    if (sourceImage?.id !== undefined && sourceImage?.id !== null) {
      orderedImages.push(sourceImage);
    }
    orderedImages.push(...similarImages);

    const dedupedImages = [];
    const seenIds = new Set();
    orderedImages.forEach((image) => {
      const imageId = Number(image?.id);
      if (!Number.isFinite(imageId) || seenIds.has(imageId)) return;
      seenIds.add(imageId);
      dedupedImages.push(image);
    });

    const sourceAssetUuid = String(
      sourceImage?.asset_id
      || sourceImage?.asset_uuid
      || event?.detail?.sourceAssetUuid
      || ''
    ).trim();
    return {
      sourceImage,
      sourceAssetUuid: sourceAssetUuid || null,
      dedupedImages,
    };
  };

  host._handleOpenSimilarInSearch = async (event) => {
    const { sourceImage, sourceAssetUuid, dedupedImages } = _buildSimilarOpenPayload(event);
    let imagesForSearch = dedupedImages;

    // Grid-launch path usually provides only source image; fetch similar results on demand.
    if (imagesForSearch.length <= 1 && Number.isFinite(Number(sourceImage?.id))) {
      try {
        const payload = await getSimilarImages(host.tenant, Number(sourceImage.id), {
          limit: 60,
          sameMediaType: true,
        });
        const fetched = Array.isArray(payload?.images) ? payload.images : [];
        const merged = [];
        const seen = new Set();
        [sourceImage, ...fetched].forEach((image) => {
          const imageId = Number(image?.id);
          if (!Number.isFinite(imageId) || seen.has(imageId)) return;
          seen.add(imageId);
          merged.push(image);
        });
        imagesForSearch = merged;
      } catch (error) {
        console.error('Failed to load similar images for search open action', error);
      }
    }

    if (!imagesForSearch.length) return;

    host.searchImages = imagesForSearch.map((image) => ({ ...image }));
    host.searchTotal = host.searchImages.length;
    host.searchPinnedImageId = Number.isFinite(Number(sourceImage?.id))
      ? Number(sourceImage.id)
      : null;
    host.searchSimilarityAssetUuid = sourceAssetUuid || null;
    host.activeSearchSubTab = 'advanced';
    host.pendingSearchExploreSelection = null;
    host._handleCurateEditorClose?.();
    host.curateEditorImageSet = [];
    host.curateEditorImageIndex = -1;
    host._appShellState.setActiveTab('search');
  };

  host._handleOpenSimilarInCurate = (event) => {
    if (!host._canCurate?.()) return;
    const { sourceImage, sourceAssetUuid, dedupedImages } = _buildSimilarOpenPayload(event);
    if (!dedupedImages.length) return;

    host.curateSubTab = 'main';
    host.curateImages = dedupedImages.map((image) => ({ ...image }));
    host.curateTotal = host.curateImages.length;
    host.curatePinnedImageId = Number.isFinite(Number(sourceImage?.id))
      ? Number(sourceImage.id)
      : null;
    host.curateSimilarityAssetUuid = sourceAssetUuid || null;
    host.curatePageOffset = 0;
    host.curateDragSelection = [];
    host.curateLoading = false;
    host._handleCurateEditorClose?.();
    host.curateEditorImageSet = [];
    host.curateEditorImageIndex = -1;
    host._appShellState.setActiveTab('curate');
  };

  host._handleZoomToPhoto = async (event) =>
    host._curateExploreState.handleZoomToPhoto(event);

  host._handleCurateEditorClose = () =>
    host._curateHomeState.handleCurateEditorClose();

  host._handleImageNavigate = (event) =>
    host._curateHomeState.handleImageNavigate(event);

  host._flashCurateSelection = (imageId) =>
    host._curateHomeState.flashSelection(imageId);

  host._handleSyncProgress = (event) =>
    host._appDataState.handleSyncProgress(event);

  host._handleSyncComplete = (event) =>
    host._appDataState.handleSyncComplete(event);

  host._handleSyncError = (event) =>
    host._appDataState.handleSyncError(event);
}
