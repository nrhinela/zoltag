import { LitElement, html } from 'lit';
import { enqueueCommand } from '../services/command-queue.js';
import {
  getLists,
  createList,
  updateList,
  addToList,
  getListItems,
  getDropboxFolders
} from '../services/api.js';
import { createSelectionHandlers } from './curate-shared.js';
import './filter-chips.js';
import './image-card.js';
import ImageFilterPanel from './image-filter-panel.js';

/**
 * Search Tab Component
 *
 * ⭐ REFERENCE IMPLEMENTATION for standardized image rendering pattern
 * See lines 136-149 (selection handlers), 369-410 (event handlers), 479-507 (template)
 * Copy this pattern when creating components that display images!
 *
 * Provides search functionality with two modes:
 * - Search Home: Filter-based image search with list management
 * - Explore by Tag: Browse images grouped by keywords
 *
 * @property {String} tenant - Current tenant ID
 * @property {String} searchSubTab - Active subtab ('home' or 'explore-by-tag')
 * @property {Object} searchChipFilters - Current filter chip selections
 * @property {Array} searchDropboxOptions - Dropbox folder options
 * @property {Array} searchImages - Images from filter panel
 * @property {Set} searchSelectedImages - Selected image IDs
 * @property {Array} searchLists - Available lists
 * @property {String} searchListId - Currently selected list ID
 * @property {String} searchListTitle - Draft list title
 * @property {Array} searchSavedImages - Images saved to current list
 * @property {Object} exploreByTagData - Tag exploration data
 * @property {Array} exploreByTagKeywords - Keywords for exploration
 * @property {Boolean} exploreByTagLoading - Loading state for explore
 * @property {Number} curateThumbSize - Thumbnail size
 * @property {Object} tagStatsBySource - Tag statistics
 * @property {String} activeCurateTagSource - Active tag source
 * @property {Object} imageStats - Image statistics
 * @property {String} curateOrderBy - Sort field
 * @property {String} curateDateOrder - Date sort order
 *
 * @fires search-subtab-changed - When user changes subtab
 * @fires search-filters-changed - When search filters change
 * @fires search-list-created - When a new list is created
 * @fires search-list-updated - When a list is updated
 * @fires thumb-size-changed - When thumbnail size changes
 * @fires sort-changed - When sort order changes
 * @fires image-selected - When an image is selected
 */
export class SearchTab extends LitElement {
  // Use Light DOM to access Tailwind CSS classes
  createRenderRoot() {
    return this;
  }

  static properties = {
    tenant: { type: String },
    searchSubTab: { type: String },
    searchChipFilters: { type: Object },
    searchFilterPanel: { type: Object },
    searchDropboxOptions: { type: Array },
    searchImages: { type: Array },
    searchSelectedImages: { type: Object },
    searchLists: { type: Array },
    searchListId: { type: String, state: true },  // Internal state - not controlled by parent
    searchListTitle: { type: String, state: true },  // Internal state - not controlled by parent
    searchListItems: { type: Array, state: true },  // Internal state - not controlled by parent
    searchListError: { type: String, state: true },  // Internal state - not controlled by parent
    searchSavedImages: { type: Array },
    exploreByTagData: { type: Object },
    exploreByTagKeywords: { type: Array },
    exploreByTagLoading: { type: Boolean },
    searchRefreshing: { type: Boolean },
    curateThumbSize: { type: Number },
    tagStatsBySource: { type: Object },
    activeCurateTagSource: { type: String },
    imageStats: { type: Object },
    curateOrderBy: { type: String },
    curateDateOrder: { type: String },
    renderCurateRatingWidget: { type: Object },
    renderCurateRatingStatic: { type: Object },
    formatCurateDate: { type: Object },
    searchDragSelection: { type: Array },
    searchDragSelecting: { type: Boolean },
    searchDragStartIndex: { type: Number },
    searchDragEndIndex: { type: Number },
    searchSavedDragTarget: { type: Boolean },
  };

  constructor() {
    super();
    this.tenant = '';
    this.searchSubTab = 'home';
    this.searchChipFilters = {};
    this.searchFilterPanel = null;
    this.searchDropboxOptions = [];
    this.searchImages = [];
    this.searchSelectedImages = new Set();
    this.searchLists = [];
    this.searchListId = null;
    this.searchListTitle = '';
    this.searchListItems = [];
    this.searchListError = '';
    this.searchSavedImages = [];
    this.exploreByTagData = {};
    this.exploreByTagKeywords = [];
    this.exploreByTagLoading = false;
    this.searchRefreshing = false;
    this.curateThumbSize = 120;
    this.tagStatsBySource = {};
    this.activeCurateTagSource = 'permatags';
    this.imageStats = null;
    this.curateOrderBy = 'rating';
    this.curateDateOrder = 'desc';
    this.renderCurateRatingWidget = null;
    this.renderCurateRatingStatic = null;
    this.formatCurateDate = null;
    this.searchDragSelection = [];
    this.searchDragSelecting = false;
    this.searchDragStartIndex = null;
    this.searchDragEndIndex = null;
    this.searchSavedDragTarget = false;
    this._searchSuppressClick = false;
    this._searchFlashSelectionIds = new Set();
    this._searchPressActive = false;
    this._searchPressStart = null;
    this._searchPressIndex = null;
    this._searchPressImageId = null;
    this._searchPressTimer = null;
    this._searchLongPressTriggered = false;
    this._searchInitialLoadComplete = false;
    this._searchInitialLoadPending = false;
    this._exploreInitialLoadComplete = false;
    this._exploreInitialLoadPending = false;
    this._searchExploreOrder = null;
    this._searchFilterPanelHandlers = null;

    // Debounce tracking for list fetches
    this._lastListFetchTime = 0;
    this._listFetchDebounceMs = 5000; // 5 seconds

    // Prevent conflicts with curate selection handlers
    this.curateDragSelecting = false;
    this.curateAuditDragSelecting = false;

    // ⭐ REFERENCE: Selection handler configuration for long-press multi-select
    // This pattern is REQUIRED for all components displaying images
    // See curate-shared.js createSelectionHandlers() documentation for details
    this._searchSelectionHandlers = createSelectionHandlers(this, {
      selectionProperty: 'searchDragSelection',
      selectingProperty: 'searchDragSelecting',
      startIndexProperty: 'searchDragStartIndex',
      endIndexProperty: 'searchDragEndIndex',
      pressActiveProperty: '_searchPressActive',
      pressStartProperty: '_searchPressStart',
      pressIndexProperty: '_searchPressIndex',
      pressImageIdProperty: '_searchPressImageId',
      pressTimerProperty: '_searchPressTimer',
      longPressTriggeredProperty: '_searchLongPressTriggered',
      getOrder: () => {
        if (this.searchSubTab === 'explore-by-tag') {
          return this._searchExploreOrder || [];
        }
        return (this.searchImages || []).map(img => img.id);
      },
      flashSelection: (imageId) => this._flashSearchSelection(imageId),
    });
  }

  async _refreshSearch() {
    if (this.searchRefreshing) return;
    this.searchRefreshing = true;
    try {
      const tasks = [];
      if (this.searchSubTab === 'home') {
        tasks.push(this.searchFilterPanel?.fetchImages());
      }
      tasks.push(this._fetchSearchLists({ force: true }));
      if (this.searchSubTab === 'explore-by-tag') {
        tasks.push(this._loadExploreByTagData(true));
      }
      await Promise.allSettled(tasks);
    } finally {
      this.searchRefreshing = false;
    }
  }

  // ========================================
  // Lifecycle Methods
  // ========================================

  connectedCallback() {
    super.connectedCallback();
    this._fetchSearchLists();
    this._setupSearchFilterPanel(this.searchFilterPanel);
    this._maybeStartInitialRefresh();

    // Add global pointer handlers for selection
    this._handleSearchGlobalPointerDown = (event) => {
      if (!this.searchDragSelection.length) return;
      const path = event.composedPath ? event.composedPath() : [];
      const clickedThumb = path.some(node =>
        node.classList && node.classList.contains('curate-thumb-wrapper')
      );
      const clickedSelected = clickedThumb && path.some(node =>
        node.classList && node.classList.contains('selected')
      );
      if (clickedSelected) return;
      this.searchDragSelection = [];
      this._searchSuppressClick = true;
    };

    // Selection end handler - called on pointerup and keyup
    this._handleSearchSelectionEnd = () => {
      if (this.searchDragSelecting) {
        this.searchDragSelecting = false;
        this.searchDragStartIndex = null;
        this.searchDragEndIndex = null;
      }
    };

    document.addEventListener('pointerdown', this._handleSearchGlobalPointerDown);
    window.addEventListener('pointerup', this._handleSearchSelectionEnd);
    window.addEventListener('keyup', this._handleSearchSelectionEnd);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._teardownSearchFilterPanel(this.searchFilterPanel);
    if (this._handleSearchGlobalPointerDown) {
      document.removeEventListener('pointerdown', this._handleSearchGlobalPointerDown);
    }
    if (this._handleSearchSelectionEnd) {
      window.removeEventListener('pointerup', this._handleSearchSelectionEnd);
      window.removeEventListener('keyup', this._handleSearchSelectionEnd);
    }
    // Cancel any active press state
    if (this._searchPressTimer) {
      clearTimeout(this._searchPressTimer);
      this._searchPressTimer = null;
    }
  }

  updated(changedProps) {
    if (changedProps.has('searchFilterPanel')) {
      this._teardownSearchFilterPanel(changedProps.get('searchFilterPanel'));
      this._setupSearchFilterPanel(this.searchFilterPanel);
      this._maybeStartInitialRefresh();
    }

    if (changedProps.has('searchSubTab')) {
      if (this.searchSubTab === 'explore-by-tag') {
        if (this.exploreByTagLoading || (!this._exploreInitialLoadComplete && !(this.exploreByTagKeywords || []).length)) {
          this._startExploreRefresh();
        }
      } else {
        if (this._exploreInitialLoadPending) {
          this._finishExploreRefresh();
        }
        this._maybeStartInitialRefresh();
      }
    }

    if (changedProps.has('searchImages')) {
      const wasUndefined = changedProps.get('searchImages') === undefined;
      if (this._searchInitialLoadPending && !wasUndefined) {
        this._finishInitialRefresh();
      } else if (!this._searchInitialLoadComplete && (this.searchImages || []).length > 0) {
        this._searchInitialLoadComplete = true;
      }
    }

    if (changedProps.has('exploreByTagLoading') && this.searchSubTab === 'explore-by-tag') {
      if (this.exploreByTagLoading) {
        this._startExploreRefresh();
      } else {
        this._finishExploreRefresh();
      }
    }

    if (changedProps.has('exploreByTagKeywords') && this.searchSubTab === 'explore-by-tag') {
      if (this._exploreInitialLoadPending && !(this.exploreByTagKeywords || []).length) {
        return;
      }
      if (this._exploreInitialLoadPending) {
        this._finishExploreRefresh();
      } else if (!this._exploreInitialLoadComplete && (this.exploreByTagKeywords || []).length > 0) {
        this._exploreInitialLoadComplete = true;
      }
    }
  }

  // ========================================
  // Search List Management Methods
  // ========================================

  async _fetchSearchLists({ force = false } = {}) {
    if (!this.tenant) return;

    // Debounce: prevent fetches within 5 seconds of last fetch
    const now = Date.now();
    if (now - this._lastListFetchTime < this._listFetchDebounceMs) {
      console.log('Suppressing duplicate list fetch (within 5s debounce window)');
      return;
    }

    this._lastListFetchTime = now;
    try {
    this.searchLists = await getLists(this.tenant, { force });
    } catch (error) {
      console.error('Error fetching search lists:', error);
    }
  }

  _focusSearchListTitleInput() {
    setTimeout(() => {
      const input = this.querySelector('#search-list-title-input');
      if (input) {
        input.focus();
        input.select();
      }
    }, 100);
  }

  _resetSearchListDraft() {
    this.searchListId = null;
    this.searchListTitle = this._buildNewListTitle();
    this.searchListItems = [];
    this.searchSavedImages = [];
    this.searchListError = '';
  }

  async _handleSearchListSelect(event) {
    const listId = event.target.value;
    if (!listId) {
      this._resetSearchListDraft();
      this.searchListItems = [];
      return;
    }
    this.searchListError = '';
    const selectedList = this.searchLists.find((l) => l.id === parseInt(listId, 10));
    if (selectedList) {
      this.searchListId = selectedList.id;
      this.searchListTitle = selectedList.title || '';

      // Fetch list items
      try {
        this.searchListItems = await getListItems(this.tenant, this.searchListId);
      } catch (error) {
        console.error('Error fetching list items:', error);
        this.searchListItems = [];
      }

      this.dispatchEvent(new CustomEvent('search-list-updated', {
        detail: { list: selectedList },
        bubbles: true,
        composed: true
      }));
    }
  }

  _handleSearchListTitleChange(event) {
    this.searchListTitle = event.target.value;
    if (this.searchListError) {
      this.searchListError = '';
    }
  }

  // ========================================
  // Search Drag & Drop Methods
  // ========================================

  _parseSearchDragIds(event) {
    const dataString = event.dataTransfer?.getData('image-ids');
    if (!dataString) return [];
    try {
      return JSON.parse(dataString);
    } catch {
      return [];
    }
  }

  _addSearchSavedImagesByIds(ids) {
    if (!ids || !ids.length) return;

    const currentSavedIds = new Set(this.searchSavedImages.map((img) => img.id));
    const newSavedImages = [];

    for (const id of ids) {
      if (currentSavedIds.has(id)) continue;
      const found = this._findSearchImageById(id);
      if (found) {
        newSavedImages.push(found);
      }
    }

    if (newSavedImages.length > 0) {
      this.searchSavedImages = [...this.searchSavedImages, ...newSavedImages];
    }
  }

  _findSearchImageById(id) {
    const searchFound = this.searchImages.find((img) => img.id === id);
    if (searchFound) {
      return searchFound;
    }
    if (!this.exploreByTagData || typeof this.exploreByTagData !== 'object') {
      return null;
    }
    for (const images of Object.values(this.exploreByTagData)) {
      const match = (images || []).find((img) => img.id === id);
      if (match) {
        return match;
      }
    }
    return null;
  }

  _handleSearchRemoveSaved(id) {
    this.searchSavedImages = this.searchSavedImages.filter((img) => img.id !== id);
  }

  _handleSearchSavedDragStart(event, image) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('image-ids', JSON.stringify([image.id]));
  }

  _handleSearchSavedDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    this.searchSavedDragTarget = true;
  }

  _handleSearchSavedDragLeave(event) {
    if (event && event.currentTarget !== event.target) {
      return;
    }
    this.searchSavedDragTarget = false;
  }

  _handleSearchSavedDrop(event) {
    event.preventDefault();
    this.searchSavedDragTarget = false;
    const ids = this._parseSearchDragIds(event);
    this._addSearchSavedImagesByIds(ids);
    // Clear selection after successful drop
    this.searchDragSelection = [];
  }

  _handleSearchAvailableDragOver(event) {
    event.preventDefault();
  }

  _handleSearchAvailableDrop(event) {
    event.preventDefault();
    const ids = this._parseSearchDragIds(event);
    this.searchSavedImages = this.searchSavedImages.filter(
      (img) => !ids.includes(img.id)
    );
  }

  // ========================================
  // Search Dropbox Integration Methods
  // ========================================

  _handleSearchDropboxInput(event) {
    const query = event.detail?.query || '';
    if (query.length < 2) {
      this.searchDropboxOptions = [];
      return;
    }
    this._fetchDropboxFolders(query);
  }

  async _fetchDropboxFolders(query) {
    if (!this.tenant) return;
    try {
      const folders = await getDropboxFolders(this.tenant, query);
      this.searchDropboxOptions = folders || [];
    } catch (error) {
      console.error('Error fetching Dropbox folders:', error);
      this.searchDropboxOptions = [];
    }
  }

  _handleSearchDropboxFocus() {
    // Handle focus event if needed
  }

  _handleSearchDropboxBlur() {
    // Handle blur event if needed
  }

  _handleSearchDropboxSelect(event) {
    const folder = event.detail?.folder;
    if (folder) {
      this._handleSearchDropboxPick(folder);
    }
  }

  _handleSearchDropboxPick(folder) {
    this.dispatchEvent(new CustomEvent('search-filters-changed', {
      detail: { filters: { ...this.searchChipFilters, dropbox_folder: folder } },
      bubbles: true,
      composed: true
    }));
  }

  _handleSearchDropboxClear() {
    const { dropbox_folder, ...rest } = this.searchChipFilters;
    this.dispatchEvent(new CustomEvent('search-filters-changed', {
      detail: { filters: rest },
      bubbles: true,
      composed: true
    }));
  }

  async _handleSaveToList() {
    if ((!this.searchListId && !this.searchListTitle) || (this.searchSavedImages || []).length === 0) return;

    try {
      let listId = this.searchListId;

      // Create new list if needed
      if (!listId) {
        const trimmedTitle = (this.searchListTitle || '').trim();
        if (this._isDuplicateListTitle(trimmedTitle)) {
          this.searchListError = 'LIST TITLE ALREADY EXISTS.';
          this._focusSearchListTitleInput();
          return;
        }
        const newList = await createList(this.tenant, {
          title: trimmedTitle,
          notebox: '',
        });
        listId = newList.id;
        await this._fetchSearchLists({ force: true });

        // Keep the newly created list selected
        this.searchListId = listId;
        const selectedList = this.searchLists.find((l) => l.id === listId);
        if (selectedList) {
          this.searchListTitle = selectedList.title || '';
        }
        this.searchListError = '';
      }

      // Add images to list
      for (const image of this.searchSavedImages) {
        await addToList(this.tenant, listId, image.id);
      }

      // Clear saved images but keep list selected
      this.searchSavedImages = [];

      // Refresh list items to show newly added images
      try {
        this.searchListItems = await getListItems(this.tenant, listId);
      } catch (error) {
        console.error('Error fetching list items:', error);
        this.searchListItems = [];
      }

      // Notify parent
      this.dispatchEvent(new CustomEvent('search-list-created', {
        detail: { listId },
        bubbles: true,
        composed: true
      }));
    } catch (error) {
      console.error('Error saving to list:', error);
      alert('Failed to save to list. Please try again.');
    }
  }

  // ========================================
  // Search Tab Navigation
  // ========================================

  _handleSearchSubTabChange(nextTab) {
    this.searchSubTab = nextTab;
    this.dispatchEvent(new CustomEvent('search-subtab-changed', {
      detail: { subtab: nextTab },
      bubbles: true,
      composed: true
    }));

    if (nextTab === 'explore-by-tag') {
      this._loadExploreByTagData(false);
    }
  }

  _setupSearchFilterPanel(panel) {
    if (!panel) return;
    if (this._searchFilterPanelHandlers?.panel === panel) {
      return;
    }
    if (this._searchFilterPanelHandlers?.panel) {
      this._teardownSearchFilterPanel(this._searchFilterPanelHandlers.panel);
    }
    const handleLoaded = (detail) => {
      if (detail?.tabId !== 'search') return;
      this._finishInitialRefresh();
    };
    const handleError = (detail) => {
      if (detail?.tabId !== 'search') return;
      this._finishInitialRefresh();
    };
    this._searchFilterPanelHandlers = { panel, handleLoaded, handleError };
    panel.on('images-loaded', handleLoaded);
    panel.on('error', handleError);
  }

  _teardownSearchFilterPanel(panel) {
    if (!panel || !this._searchFilterPanelHandlers) return;
    panel.off('images-loaded', this._searchFilterPanelHandlers.handleLoaded);
    panel.off('error', this._searchFilterPanelHandlers.handleError);
    this._searchFilterPanelHandlers = null;
  }

  _maybeStartInitialRefresh() {
    if (this._searchInitialLoadComplete || this._searchInitialLoadPending) return;
    if (this.searchSubTab !== 'home') return;
    if (!this.searchFilterPanel) return;
    if ((this.searchImages || []).length > 0) {
      this._searchInitialLoadComplete = true;
      return;
    }
    this._searchInitialLoadPending = true;
    this.searchRefreshing = true;
  }

  _finishInitialRefresh() {
    if (!this._searchInitialLoadPending) return;
    this._searchInitialLoadPending = false;
    this._searchInitialLoadComplete = true;
    this.searchRefreshing = false;
  }

  _startExploreRefresh() {
    if (this._exploreInitialLoadPending) return;
    this._exploreInitialLoadPending = true;
    this.searchRefreshing = true;
  }

  _finishExploreRefresh() {
    if (!this._exploreInitialLoadPending) return;
    this._exploreInitialLoadPending = false;
    this._exploreInitialLoadComplete = true;
    if (!this._searchInitialLoadPending) {
      this.searchRefreshing = false;
    }
  }

  async _loadExploreByTagData(force = false) {
    // TODO: Implement explore by tag data loading
    // This will need to be connected to the parent's data loading logic
    console.log('Load explore by tag data:', force);
  }

  // ========================================
  // Event Handlers for Parent Communication
  // ========================================

  _handleCurateThumbSizeChange(event) {
    const size = parseInt(event.target.value, 10);
    this.dispatchEvent(new CustomEvent('thumb-size-changed', {
      detail: { size },
      bubbles: true,
      composed: true
    }));
  }

  _handleCurateQuickSort(field) {
    this.dispatchEvent(new CustomEvent('sort-changed', {
      detail: { orderBy: field },
      bubbles: true,
      composed: true
    }));
  }

  _getCurateQuickSortArrow(field) {
    if (this.curateOrderBy !== field) return '';
    return this.curateDateOrder === 'desc' ? '↓' : '↑';
  }

  _handleChipFiltersChanged(event) {
    this.dispatchEvent(new CustomEvent('search-filters-changed', {
      detail: event.detail,
      bubbles: true,
      composed: true
    }));
  }

  // ========================================
  // Helper Methods
  // ========================================

  _isDuplicateListTitle(title) {
    if (!title) return false;
    const normalized = title.trim().toLowerCase();
    return this.searchLists.some(
      (list) => list.title.trim().toLowerCase() === normalized
    );
  }

  _buildNewListTitle() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
      `:${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    return `${stamp} new list`;
  }

  // ========================================
  // Selection Helper Methods
  // ========================================

  _flashSearchSelection(imageId) {
    this._searchFlashSelectionIds.add(imageId);
    this.requestUpdate();
    setTimeout(() => {
      this._searchFlashSelectionIds.delete(imageId);
      this.requestUpdate();
    }, 300);
  }

  _handleSearchPointerDown(event, index, imageId) {
    return this._searchSelectionHandlers.handlePointerDown(event, index, imageId);
  }

  _handleSearchPointerMove(event) {
    return this._searchSelectionHandlers.handlePointerMove(event);
  }

  _handleSearchSelectHover(index) {
    return this._searchSelectionHandlers.handleSelectHover(index);
  }

  _handleExploreByTagPointerDown(event, index, imageId, order) {
    this._searchExploreOrder = order;
    return this._handleSearchPointerDown(event, index, imageId);
  }

  _handleExploreByTagSelectHover(index, order) {
    if (this._searchExploreOrder !== order) {
      return;
    }
    return this._handleSearchSelectHover(index);
  }

  _handleSearchImageClick(event, image) {
    if (event.defaultPrevented) return;
    if (this._searchSuppressClick || this.searchDragSelection.length) {
      this._searchSuppressClick = false;
      return;
    }
    this.dispatchEvent(new CustomEvent('image-clicked', {
      detail: { event, image },
      bubbles: true,
      composed: true
    }));
  }

  _handleSearchDragStart(event, image) {
    // Prevent dragging during selection mode
    if (this.searchDragSelecting) {
      event.preventDefault();
      return;
    }

    let ids = [image.id];
    if (this.searchDragSelection.length && this.searchDragSelection.includes(image.id)) {
      ids = this.searchDragSelection;
    } else if (this.searchDragSelection.length) {
      this.searchDragSelection = [image.id];
    }
    event.dataTransfer.setData('text/plain', ids.join(','));
    event.dataTransfer.setData('application/x-photocat-source', 'search-available');
    event.dataTransfer.setData('image-ids', JSON.stringify(ids));
  }

  // ========================================
  // Render Method
  // ========================================

  render() {
    const trimmedSearchListTitle = (this.searchListTitle || '').trim();
    const hasSearchListTitle = !!trimmedSearchListTitle;
    const savedPane = html`
      <div class="curate-pane utility-targets search-saved-pane ${this.searchSavedDragTarget ? 'drag-active' : ''}">
        <div class="curate-pane-header">
          <div class="curate-pane-header-row">
            <span class="text-sm font-semibold">Saved Items</span>
          </div>
        </div>
        <div
          class="curate-pane-body flex flex-col"
          @dragover=${this._handleSearchSavedDragOver}
          @dragleave=${this._handleSearchSavedDragLeave}
          @drop=${this._handleSearchSavedDrop}
        >
          <!-- List Management Controls -->
          <div class="p-3 bg-gray-50 border-t">
            <label class="block text-xs font-semibold text-gray-700 mb-2">Current List:</label>
            <select
              class="w-full p-2 border rounded text-sm mb-2"
              @change=${this._handleSearchListSelect}
              .value=${this.searchListId || ''}
            >
              <option value="">New list</option>
              ${this.searchLists.map(list => html`
                <option value=${list.id}>${list.title}</option>
              `)}
            </select>

            ${!this.searchListId ? html`
              <label class="block text-xs font-semibold text-gray-700 mb-2">New list name:</label>
              <input
                id="search-list-title-input"
                type="text"
                placeholder="List title..."
                .value=${this.searchListTitle || ''}
                @input=${this._handleSearchListTitleChange}
                class="w-full p-2 border rounded text-sm mb-2"
              >
            ` : ''}

            <button
              class="w-full bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
              @click=${this._handleSaveToList}
              ?disabled=${(!this.searchListId && (!this.searchListTitle || this._isDuplicateListTitle(this.searchListTitle))) || (this.searchSavedImages || []).length === 0}
            >
              ${this.searchListId ? 'Save' : 'Save new'} (${(this.searchSavedImages || []).length})
            </button>
            ${this.searchListError ? html`
              <div class="mt-2 text-xs font-semibold text-red-600">
                ${this.searchListError}
              </div>
            ` : ''}
          </div>

          <!-- Combined Area: Existing List Items + Drag Target for New Images -->
          <div class="flex-1">
            ${this.searchListId && (this.searchListItems || []).length > 0 ? html`
              <div class="p-2 border-b">
                <div class="text-xs font-semibold text-gray-600 mb-2">
                  ${this.searchListTitle} (${this.searchListItems.length} items)
                </div>
                <div class="search-saved-grid max-h-48 overflow-y-auto">
                  ${this.searchListItems.map(item => html`
                    <div class="search-saved-item">
                      <img
                        src=${item.photo?.thumbnail_url || `/api/v1/images/${item.photo_id}/thumbnail`}
                        alt=${item.photo?.filename || ''}
                        class="search-saved-thumb opacity-75"
                      >
                    </div>
                  `)}
                </div>
              </div>
            ` : ''}

            ${(this.searchSavedImages || []).length > 0 ? html`
              <div class="p-2">
                <div class="text-xs font-semibold text-gray-600 mb-2">
                  To be added (${this.searchSavedImages.length})
                </div>
                <div class="search-saved-grid">
                  ${this.searchSavedImages.map(image => html`
                    <div class="search-saved-item">
                      <img
                        src=${image.thumbnail_url || `/api/v1/images/${image.id}/thumbnail`}
                        alt=${image.filename}
                        class="search-saved-thumb"
                        draggable="true"
                        @dragstart=${(e) => this._handleSearchSavedDragStart(e, image)}
                      >
                      <button
                        class="search-saved-remove"
                        @click=${() => this._handleSearchRemoveSaved(image.id)}
                        title="Remove"
                      >×</button>
                    </div>
                  `)}
                </div>
              </div>
            ` : !this.searchListId || !(this.searchListItems || []).length ? html`
              <div class="p-4 text-center text-gray-500 text-sm">
                Drag images here to save to a list
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    return html`
      <div class="container">
        <!-- Search Tab Header -->
        <div class="flex items-center justify-between mb-4">
          <div class="curate-subtabs">
            <button
              class="curate-subtab ${this.searchSubTab === 'home' ? 'active' : ''}"
              @click=${() => this._handleSearchSubTabChange('home')}
            >
              Search Home
            </button>
            <button
              class="curate-subtab ${this.searchSubTab === 'explore-by-tag' ? 'active' : ''}"
              @click=${() => this._handleSearchSubTabChange('explore-by-tag')}
            >
              Explore by Tag
            </button>
          </div>

          <div class="ml-auto flex items-center gap-4 text-xs text-gray-600 mr-4">
            <label class="font-semibold text-gray-600">Thumb</label>
            <input
              type="range"
              min="80"
              max="220"
              step="10"
              .value=${String(this.curateThumbSize)}
              @input=${this._handleCurateThumbSizeChange}
              class="w-24"
            >
            <span class="w-12 text-right text-xs">${this.curateThumbSize}px</span>
          </div>

          <button
            class="inline-flex items-center gap-2 border rounded-lg px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
            ?disabled=${this.searchRefreshing}
            @click=${this._refreshSearch}
            title="Refresh"
          >
            ${this.searchRefreshing ? html`<span class="curate-spinner"></span>` : html`<span aria-hidden="true">↻</span>`}
            ${this.searchRefreshing ? 'Refreshing' : 'Refresh'}
          </button>
        </div>

        <!-- Search Home Subtab -->
        ${this.searchSubTab === 'home' ? html`
          <div>
            <!-- Filter Chips Component -->
            <filter-chips
              .tenant=${this.tenant}
              .tagStatsBySource=${this.tagStatsBySource}
              .activeCurateTagSource=${this.activeCurateTagSource || 'permatags'}
              .imageStats=${this.imageStats}
              .activeFilters=${this.searchChipFilters}
              .dropboxFolders=${this.searchDropboxOptions || []}
              @filters-changed=${this._handleChipFiltersChanged}
              @folder-search=${this._handleSearchDropboxInput}
            >
              <div slot="sort-controls" class="flex items-center gap-2">
                <span class="text-sm font-semibold text-gray-700">Sort:</span>
                <div class="curate-audit-toggle">
                  <button
                    class=${this.curateOrderBy === 'rating' ? 'active' : ''}
                    @click=${() => this._handleCurateQuickSort('rating')}
                  >
                    Rating ${this._getCurateQuickSortArrow('rating')}
                  </button>
                  <button
                    class=${this.curateOrderBy === 'photo_creation' ? 'active' : ''}
                    @click=${() => this._handleCurateQuickSort('photo_creation')}
                  >
                    Photo Date ${this._getCurateQuickSortArrow('photo_creation')}
                  </button>
                  <button
                    class=${this.curateOrderBy === 'processed' ? 'active' : ''}
                    @click=${() => this._handleCurateQuickSort('processed')}
                  >
                    Process Date ${this._getCurateQuickSortArrow('processed')}
                  </button>
                </div>
              </div>

              <div slot="view-controls" class="flex items-center gap-3">
                <span class="text-sm font-semibold text-gray-700">View:</span>
                <input
                  type="range"
                  min="80"
                  max="220"
                  step="10"
                  .value=${String(this.curateThumbSize)}
                  @input=${this._handleCurateThumbSizeChange}
                  class="w-24"
                >
                <span class="text-xs text-gray-600">${this.curateThumbSize}px</span>
              </div>
            </filter-chips>

            <!-- Image Grid Layout -->
            <div class="curate-layout search-layout mt-4" style="--curate-thumb-size: ${this.curateThumbSize}px;">
              <!-- Left Pane: Available Images -->
              <div class="curate-pane" @dragover=${this._handleSearchAvailableDragOver} @drop=${this._handleSearchAvailableDrop}>
                <div class="curate-pane-header">
                  <div class="curate-pane-header-row">
                    <span class="text-sm font-semibold">Available Images</span>
                  </div>
                </div>
                <div class="curate-pane-body">
                  ${this.searchImages && this.searchImages.length > 0 ? html`
                    <div class="curate-grid">
                      <!-- ⭐ REFERENCE: Standardized image rendering pattern -->
                      <!-- This template shows the complete pattern for images with: -->
                      <!-- - Long-press multi-select (pointerdown/move/enter handlers) -->
                      <!-- - Drag & drop (dragstart handler checks selectingProperty) -->
                      <!-- - Rating widgets (renderCurateRatingWidget/Static props) -->
                      <!-- - Click to open modal (image-clicked event) -->
                      <!-- - Selection styling (.selected class, flash animation) -->
                      <!-- - Photo date display (formatCurateDate prop) -->
                      <!-- COPY THIS PATTERN when creating image display components! -->
                      ${this.searchImages.map((image, index) => html`
                        <div
                          class="curate-thumb-wrapper ${this.searchDragSelection.includes(image.id) ? 'selected' : ''}"
                          data-image-id="${image.id}"
                          draggable="true"
                          @dragstart=${(event) => this._handleSearchDragStart(event, image)}
                          @click=${(event) => this._handleSearchImageClick(event, image)}
                        >
                          <img
                            src=${image.thumbnail_url || `/api/v1/images/${image.id}/thumbnail`}
                            alt=${image.filename}
                            class="curate-thumb ${this.searchDragSelection.includes(image.id) ? 'selected' : ''} ${this._searchFlashSelectionIds?.has(image.id) ? 'flash' : ''}"
                            draggable="false"
                            @pointerdown=${(event) => this._handleSearchPointerDown(event, index, image.id)}
                            @pointermove=${(event) => this._handleSearchPointerMove(event)}
                            @pointerenter=${() => this._handleSearchSelectHover(index)}
                          >
                          ${this.renderCurateRatingWidget ? this.renderCurateRatingWidget(image) : ''}
                          ${this.renderCurateRatingStatic ? this.renderCurateRatingStatic(image) : ''}
                          ${this.formatCurateDate && this.formatCurateDate(image) ? html`
                            <div class="curate-thumb-date">
                              <span class="curate-thumb-id">#${image.id}</span>
                              <span class="curate-thumb-icon" aria-hidden="true">📷</span>${this.formatCurateDate(image)}
                            </div>
                          ` : ''}
                        </div>
                      `)}
                    </div>
                  ` : html`
                    <div class="p-4 text-center text-gray-500 text-sm">
                      No images found. Adjust filters to search.
                    </div>
                  `}
                </div>
              </div>

              ${savedPane}
            </div>
          </div>
        ` : ''}

        <!-- Explore by Tag Subtab -->
        ${this.searchSubTab === 'explore-by-tag' ? html`
          <div>
            <div class="curate-layout search-layout mt-4" style="--curate-thumb-size: ${this.curateThumbSize}px;">
              <div class="curate-pane" @dragover=${this._handleSearchAvailableDragOver} @drop=${this._handleSearchAvailableDrop}>
                <div class="curate-pane-header">
                  <div class="curate-pane-header-row">
                    <span class="text-sm font-semibold">Explore by Tag</span>
                  </div>
                </div>
                <div class="curate-pane-body">
                  ${this.exploreByTagLoading && !(this.exploreByTagKeywords && this.exploreByTagKeywords.length) ? html`
                    <div class="flex items-center justify-center p-8">
                      <span class="curate-spinner large"></span>
                      <span class="ml-3 text-gray-600">Loading tag exploration data...</span>
                    </div>
                  ` : this.exploreByTagKeywords && this.exploreByTagKeywords.length > 0 ? html`
                    <div class="space-y-6">
                      ${this.exploreByTagKeywords.map(keyword => {
                        const images = this.exploreByTagData[keyword] || [];
                        const order = images.map((image) => image.id);
                        return html`
                          <div>
                            <div class="text-sm font-semibold text-gray-900 mb-3">
                              ${keyword}
                              <span class="text-xs text-gray-500 font-normal">(${images.length} images)</span>
                            </div>
                            <div class="curate-grid">
                              ${images.length ? images.map((image, index) => html`
                                <div
                                  class="curate-thumb-wrapper ${this.searchDragSelection.includes(image.id) ? 'selected' : ''}"
                                  data-image-id="${image.id}"
                                  draggable="true"
                                  @dragstart=${(event) => this._handleSearchDragStart(event, image)}
                                  @click=${(event) => this._handleSearchImageClick(event, image)}
                                >
                                  <img
                                    src=${image.thumbnail_url || `/api/v1/images/${image.id}/thumbnail`}
                                    alt=${image.filename}
                                    class="curate-thumb ${this.searchDragSelection.includes(image.id) ? 'selected' : ''} ${this._searchFlashSelectionIds?.has(image.id) ? 'flash' : ''}"
                                    draggable="false"
                                    @pointerdown=${(event) => this._handleExploreByTagPointerDown(event, index, image.id, order)}
                                    @pointermove=${(event) => this._handleSearchPointerMove(event)}
                                    @pointerenter=${() => this._handleExploreByTagSelectHover(index, order)}
                                  >
                                  ${this.renderCurateRatingWidget ? this.renderCurateRatingWidget(image) : ''}
                                  ${this.renderCurateRatingStatic ? this.renderCurateRatingStatic(image) : ''}
                                  ${this.formatCurateDate && this.formatCurateDate(image) ? html`
                                    <div class="curate-thumb-date">
                                      <span class="curate-thumb-id">#${image.id}</span>
                                      <span class="curate-thumb-icon" aria-hidden="true">📷</span>${this.formatCurateDate(image)}
                                    </div>
                                  ` : ''}
                                </div>
                              `) : html`
                                <div class="col-span-full text-xs text-gray-400 py-4 text-center">
                                  No images found.
                                </div>
                              `}
                            </div>
                          </div>
                        `;
                      })}
                    </div>
                  ` : html`
                    <div class="p-8 text-center text-gray-500">
                      <p class="text-sm">No tagged images found.</p>
                      <p class="text-xs mt-2">Tag some images first to explore by tag.</p>
                    </div>
                  `}
                </div>
              </div>

              ${savedPane}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }
}

customElements.define('search-tab', SearchTab);
