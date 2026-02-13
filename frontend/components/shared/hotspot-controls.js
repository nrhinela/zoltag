import { html } from 'lit';

/**
 * Render hotspot configuration UI
 * @param {Object} hotspot - Hotspot configuration object
 * @param {number} index - Hotspot index
 * @param {Object} options - { categories, keywords, actions, types }
 * @param {Object} handlers - { onChange, onRemove, onAdd }
 * @returns {TemplateResult}
 */
export function renderHotspotConfig(hotspot, index, options, handlers) {
  const { categories = [], keywords = [], actions = [], types = [] } = options;
  const { onChange, onRemove, onAdd } = handlers;

  return html`
    <div class="hotspot-config-row">
      <div class="hotspot-config-field">
        <label class="text-xs">Keyword</label>
        <select
          class="curate-select text-xs"
          .value=${hotspot.keyword || ''}
          @change=${(e) => onChange(index, 'keyword', e.target.value)}
        >
          <option value="">Select keyword...</option>
          ${keywords.map((kw) => html`
            <option value=${kw.value}>${kw.label}</option>
          `)}
        </select>
      </div>

      <div class="hotspot-config-field">
        <label class="text-xs">Action</label>
        <select
          class="curate-select text-xs"
          .value=${hotspot.action || 'add'}
          @change=${(e) => onChange(index, 'action', e.target.value)}
        >
          ${actions.map((action) => html`
            <option value=${action.value}>${action.label}</option>
          `)}
        </select>
      </div>

      <div class="hotspot-config-field">
        <label class="text-xs">Type</label>
        <select
          class="curate-select text-xs"
          .value=${hotspot.type || 'permatag'}
          @change=${(e) => onChange(index, 'type', e.target.value)}
        >
          ${types.map((type) => html`
            <option value=${type.value}>${type.label}</option>
          `)}
        </select>
      </div>

      ${hotspot.action === 'rate' ? html`
        <div class="hotspot-config-field">
          <label class="text-xs">Rating</label>
          <select
            class="curate-select text-xs"
            .value=${String(hotspot.rating || 1)}
            @change=${(e) => onChange(index, 'rating', Number(e.target.value))}
          >
            ${[0, 1, 2, 3].map((rating) => html`
              <option value=${rating}>${rating === 0 ? 'Trash' : `${rating} star${rating > 1 ? 's' : ''}`}</option>
            `)}
          </select>
        </div>
      ` : ''}

      <button
        class="hotspot-remove-btn"
        @click=${() => onRemove(index)}
        title="Remove hotspot"
      >
        ×
      </button>
    </div>
  `;
}

/**
 * Render rating button controls
 * @param {number|string} activeRating - Currently active rating filter
 * @param {Function} onChange - Callback (newRating) => void
 * @param {boolean} hideDeleted - Whether "hide deleted" is checked
 * @param {Function} onHideDeletedChange - Callback (event) => void
 * @returns {TemplateResult}
 */
export function renderRatingButtons(activeRating, onChange, hideDeleted, onHideDeletedChange) {
  return html`
    <div class="flex flex-wrap items-center gap-2">
      <label class="inline-flex items-center gap-2 text-xs text-gray-600">
        <input
          type="checkbox"
          class="h-4 w-4"
          .checked=${hideDeleted}
          @change=${onHideDeletedChange}
        >
        <span class="inline-flex items-center gap-2">
          <i class="fas fa-trash"></i>
          hide deleted
        </span>
      </label>
      <div class="flex items-center gap-1">
        ${[0, 1, 2, 3].map((value) => {
          const label = value === 0 ? '0' : `${value}+`;
          const title = value === 0 ? 'Quality = 0' : `Quality >= ${value}`;
          return html`
            <button
              class="inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs ${activeRating === value ? 'bg-yellow-100 text-yellow-800 border-yellow-200' : 'bg-gray-100 text-gray-500 border-gray-200'}"
              title=${title}
              @click=${() => onChange(value)}
            >
              <i class="fas fa-star"></i>
              <span>${label}</span>
            </button>
          `;
        })}
        <button
          class="inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs ${activeRating === 'unrated' ? 'bg-yellow-100 text-yellow-800 border-yellow-200' : 'bg-gray-100 text-gray-500 border-gray-200'}"
          title="Unrated images"
          @click=${() => onChange('unrated')}
        >
          <i class="fas fa-circle-notch"></i>
          <span>unrated</span>
        </button>
      </div>
    </div>
  `;
}

/**
 * Create hotspot handlers - eliminates duplication between explore and audit
 *
 * This factory creates all the handler methods needed for hotspot functionality.
 * Used to replace 15+ duplicate methods in zoltag-app.js.
 *
 * @param {Object} context - Component context (usually `this` from LitElement)
 * @param {Object} config - Configuration object
 * @param {string} config.targetsProperty - Name of property storing targets array (e.g., 'curateExploreTargets')
 * @param {string} config.dragTargetProperty - Name of property for drag target (e.g., '_curateExploreHotspotDragTarget')
 * @param {string} config.nextIdProperty - Name of property for next ID (e.g., '_curateExploreHotspotNextId')
 * @param {Function} config.parseKeywordValue - Function to parse keyword value string
 * @param {Function} config.applyRating - Function to apply rating (imageIds, rating) => void
 * @param {Function} config.processTagDrop - Function to process tag drop (ids, target) => void
 * @param {Function} config.removeImages - Function to remove images by IDs
 * @returns {Object} Handler methods
 */
export function createHotspotHandlers(context, config) {
  const {
    targetsProperty,
    dragTargetProperty,
    nextIdProperty,
    parseKeywordValue,
    applyRating,
    processTagDrop,
    removeImages,
  } = config;

  return {
    /**
     * Handle keyword change for a hotspot
     */
    handleKeywordChange(event, targetId) {
      const value = event.target.value;
      const { category, keyword } = parseKeywordValue(value);
      context[targetsProperty] = (context[targetsProperty] || []).map((target) =>
        target.id === targetId ? { ...target, category, keyword, count: 0 } : target
      );
    },

    /**
     * Handle action change (add/remove) for a hotspot
     */
    handleActionChange(event, targetId) {
      const action = event.target.value === 'remove' ? 'remove' : 'add';
      context[targetsProperty] = (context[targetsProperty] || []).map((target) =>
        target.id === targetId ? { ...target, action, count: 0 } : target
      );
    },

    /**
     * Handle type change (permatag/rating) for a hotspot
     */
    handleTypeChange(event, targetId) {
      const type = event.target.value;
      context[targetsProperty] = (context[targetsProperty] || []).map((target) =>
        target.id === targetId
          ? { ...target, type, keyword: '', category: '', rating: '', action: 'add', count: 0 }
          : target
      );
    },

    /**
     * Handle rating change for a hotspot
     */
    handleRatingChange(event, targetId) {
      const rating = Number.parseInt(event.target.value, 10);
      context[targetsProperty] = (context[targetsProperty] || []).map((target) =>
        target.id === targetId ? { ...target, rating, count: 0 } : target
      );
    },

    /**
     * Add a new hotspot target
     */
    handleAddTarget() {
      const nextId = context[nextIdProperty] || 1;
      context[nextIdProperty] = nextId + 1;
      context[targetsProperty] = [
        ...(context[targetsProperty] || []),
        { id: nextId, category: '', keyword: '', action: 'add', count: 0 },
      ];
    },

    /**
     * Remove a hotspot target
     */
    handleRemoveTarget(targetId) {
      if (!context[targetsProperty] || context[targetsProperty].length <= 1) {
        return;
      }
      const firstId = context[targetsProperty][0]?.id;
      if (targetId === firstId) {
        return; // Can't remove first target
      }
      context[targetsProperty] = context[targetsProperty].filter(
        (target) => target.id !== targetId
      );
      if (context[dragTargetProperty] === targetId) {
        context[dragTargetProperty] = null;
      }
    },

    /**
     * Handle drag over hotspot
     */
    handleDragOver(event, targetId) {
      event.preventDefault();
      if (context[dragTargetProperty] !== targetId) {
        context[dragTargetProperty] = targetId;
        context.requestUpdate();
      }
    },

    /**
     * Handle drag leave hotspot
     */
    handleDragLeave() {
      if (context[dragTargetProperty] !== null) {
        context[dragTargetProperty] = null;
        context.requestUpdate();
      }
    },

    /**
     * Handle drop on hotspot
     */
    handleDrop(event, targetId) {
      event.preventDefault();
      const raw = event.dataTransfer?.getData('text/plain') || '';
      const ids = raw
        .split(',')
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((value) => Number.isFinite(value) && value > 0);

      if (!ids.length) {
        this.handleDragLeave();
        return;
      }

      const target = (context[targetsProperty] || []).find((entry) => entry.id === targetId);
      if (!target) {
        this.handleDragLeave();
        return;
      }

      // Handle rating hotspot
      if (target.type === 'rating') {
        if (typeof target.rating !== 'number' || target.rating < 0 || target.rating > 3) {
          this.handleDragLeave();
          return;
        }
        applyRating(ids, target.rating);
        context[targetsProperty] = context[targetsProperty].map((entry) =>
          entry.id === targetId ? { ...entry, count: (entry.count || 0) + ids.length } : entry
        );
      } else {
        // Handle tag hotspot
        if (!target.keyword) {
          this.handleDragLeave();
          return;
        }
        processTagDrop(ids, target);
        context[targetsProperty] = context[targetsProperty].map((entry) =>
          entry.id === targetId ? { ...entry, count: (entry.count || 0) + ids.length } : entry
        );
      }

      this.handleDragLeave();
    },
  };
}

/**
 * Parse utility keyword value from dropdown
 * Format: "category::keyword"
 * @param {string} value - Encoded value string
 * @returns {Object} { category, keyword }
 */
export function parseUtilityKeywordValue(value) {
  if (!value || value === '__untagged__') {
    return { category: '', keyword: '' };
  }
  const parts = value.split('::');
  if (parts.length === 2) {
    return {
      category: decodeURIComponent(parts[0]),
      keyword: decodeURIComponent(parts[1]),
    };
  }
  return { category: '', keyword: '' };
}
