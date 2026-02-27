import { LitElement, html } from 'lit';

export class HotspotTargetsPanel extends LitElement {
  createRenderRoot() {
    return this;
  }

  static properties = {
    targets: { type: Array },
    keywordsByCategory: { type: Array },
    lists: { type: Array },
    dragTargetId: { type: String },
    ratingEnabled: { type: Boolean },
    ratingCount: { type: Number },
    ratingDragTarget: { type: Boolean },
    mode: { type: String },
  };

  constructor() {
    super();
    this.targets = [];
    this.keywordsByCategory = [];
    this.lists = [];
    this.dragTargetId = null;
    this.ratingEnabled = false;
    this.ratingCount = 0;
    this.ratingDragTarget = false;
    this.mode = 'hotspots';
  }

  _emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, {
      detail,
      bubbles: true,
      composed: true,
    }));
  }

  _handleDragOver(event, targetId) {
    event.preventDefault();
    this._emit('hotspot-dragover', { targetId, event });
  }

  _handleDragLeave(event) {
    this._emit('hotspot-dragleave', { event });
  }

  _handleDrop(event, targetId) {
    event.preventDefault();
    this._emit('hotspot-drop', { targetId, event });
  }

  _handleRatingDragOver(event) {
    event.preventDefault();
    this._emit('rating-dragover', { event });
  }

  _handleRatingDragLeave() {
    this._emit('rating-dragleave', {});
  }

  _handleRatingDrop(event) {
    event.preventDefault();
    this._emit('rating-drop', { event });
  }

  _renderHeader(target, isFirstTarget) {
    const isTagsMode = this.mode === 'tags';
    const isRating = !isTagsMode && target.type === 'rating';
    const isList = !isTagsMode && target.type === 'list';
    const isAdd = target.action !== 'remove';
    const keywordsByCategory = Array.isArray(this.keywordsByCategory) ? this.keywordsByCategory : [];
    const lists = Array.isArray(this.lists) ? this.lists : [];
    const selectedValue = target.keyword
      ? `${encodeURIComponent(target.category || 'Uncategorized')}::${encodeURIComponent(target.keyword)}`
      : '';

    return html`
      <div class="hotspot-header">

        ${/* +/- toggle — only for keyword targets */''}
        ${(!isRating && !isList) ? html`
          <button
            type="button"
            class="hotspot-signum ${isAdd ? 'hotspot-signum--add' : 'hotspot-signum--remove'}"
            title="${isAdd ? 'Currently: Add — click to switch to Remove' : 'Currently: Remove — click to switch to Add'}"
            @click=${(e) => {
              e.stopPropagation();
              this._emit('hotspot-action-change', {
                targetId: target.id,
                value: isAdd ? 'remove' : 'add',
              });
            }}
          >${isAdd ? '+' : '−'}</button>
        ` : html``}

        ${/* main picker — keyword / rating / list */''}
        ${isRating ? html`
          <select
            class="hotspot-keyword-select"
            .value=${target.rating ?? ''}
            @change=${(e) => this._emit('hotspot-rating-change', { targetId: target.id, value: e.target.value })}
          >
            <option value="">Select rating…</option>
            <option value="0">🗑️ Garbage</option>
            <option value="1">⭐ 1 Star</option>
            <option value="2">⭐⭐ 2 Stars</option>
            <option value="3">⭐⭐⭐ 3 Stars</option>
          </select>
        ` : isList ? html`
          <select
            class="hotspot-keyword-select ${target.listId ? 'hotspot-keyword-select--set' : ''}"
            .value=${target.listId || ''}
            @change=${(e) => this._emit('hotspot-list-change', { targetId: target.id, value: e.target.value })}
          >
            <option value="">Select list…</option>
            ${lists.map((list) => html`
              <option value=${String(list.id)} ?selected=${String(list.id) === String(target.listId)}>
                ${list.title}
              </option>
            `)}
          </select>
          <button
            class="list-target-tab ${target.listView ? 'active' : ''}"
            ?disabled=${!target.listId}
            @click=${() => this._emit('hotspot-view-list', { targetId: target.id })}
          >${target.listView ? 'Back' : 'View'}</button>
        ` : html`
          <select
            class="hotspot-keyword-select ${selectedValue ? 'hotspot-keyword-select--set' : ''}"
            .value=${selectedValue}
            @change=${(e) => this._emit('hotspot-keyword-change', { targetId: target.id, value: e.target.value })}
          >
            <option value="">Select Tag…</option>
            ${keywordsByCategory.map(([category, keywords]) => html`
              <optgroup label="${category}">
                ${keywords.map((kw) => html`
                  <option value=${`${encodeURIComponent(category)}::${encodeURIComponent(kw.keyword)}`}>
                    ${kw.keyword}
                  </option>
                `)}
              </optgroup>
            `)}
          </select>
        `}

        ${/* type selector — only in non-tags mode */''}
        ${!isTagsMode ? html`
          <select
            class="hotspot-type-select"
            .value=${target.type || 'keyword'}
            @change=${(e) => this._emit('hotspot-type-change', { targetId: target.id, value: e.target.value })}
          >
            <option value="keyword">Keyword</option>
            <option value="rating">Rating</option>
            <option value="list">List</option>
          </select>
        ` : html``}
      </div>

      ${/* remove button — absolute bottom-right of the box, suppressed on first target */''}
      ${!isFirstTarget ? html`
        <button
          type="button"
          class="hotspot-remove"
          title="Remove"
          @click=${(e) => { e.stopPropagation(); this._emit('hotspot-remove', { targetId: target.id }); }}
        >🗑</button>
      ` : html``}
    `;
  }

  render() {
    const targets = Array.isArray(this.targets) ? this.targets : [];
    const firstId = targets[0]?.id;

    return html`
      ${this.ratingEnabled ? html`
        <div
          class="curate-rating-drop-zone ${this.ratingDragTarget ? 'active' : ''}"
          @dragover=${(event) => this._handleRatingDragOver(event)}
          @dragleave=${() => this._handleRatingDragLeave()}
          @drop=${(event) => this._handleRatingDrop(event)}
        >
          <div class="curate-rating-drop-zone-star">⭐</div>
          <div class="curate-rating-drop-zone-content">
            <div class="curate-rating-drop-hint">Drop to rate</div>
            <div class="curate-rating-count">${this.ratingCount || 0} rated</div>
          </div>
        </div>
      ` : html``}
      <div class="curate-utility-panel">
        ${targets.map((target) => {
          const isFirstTarget = firstId === target.id;
          return html`
            <div
              class="curate-utility-box ${this.dragTargetId === target.id ? 'active' : ''}"
              @dragover=${(event) => this._handleDragOver(event, target.id)}
              @dragleave=${(event) => this._handleDragLeave(event)}
              @drop=${(event) => this._handleDrop(event, target.id)}
            >
              ${this._renderHeader(target, isFirstTarget)}
              <div class="curate-utility-count">${target.count || 0}</div>
              <div class="curate-utility-drop-hint">Drop images here</div>
            </div>
          `;
        })}
        <button class="curate-utility-add" @click=${() => this._emit('hotspot-add', {})}>
          +
        </button>
      </div>
    `;
  }
}

customElements.define('hotspot-targets-panel', HotspotTargetsPanel);
