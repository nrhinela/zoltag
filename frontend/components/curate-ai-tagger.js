import { LitElement, html } from 'lit';
import './shared/widgets/right-panel.js';

const DEFAULT_ZERO_SHOT_MIN_CONFIDENCE = 0.77;
const DEFAULT_TRAINED_MIN_CONFIDENCE = 0.55;

export class CurateAiTagger extends LitElement {
  createRenderRoot() {
    return this;
  }

  static properties = {
    summary: { type: Object },
    loading: { type: Boolean },
    error: { type: String },
    zeroShotMinConfidence: { type: Number },
    trainedMinConfidence: { type: Number },
    _draftZeroShotMinConfidence: { state: true },
    _draftTrainedMinConfidence: { state: true },
    _expandedThresholdEditor: { state: true },
  };

  constructor() {
    super();
    this.summary = null;
    this.loading = false;
    this.error = '';
    this.zeroShotMinConfidence = 0;
    this.trainedMinConfidence = 0;
    this._draftZeroShotMinConfidence = this._formatThresholdInput(0);
    this._draftTrainedMinConfidence = this._formatThresholdInput(0);
    this._expandedThresholdEditor = '';
  }

  _toCategories() {
    return Array.isArray(this.summary?.categories) ? this.summary.categories : [];
  }

  _formatCount(modelStats) {
    const value = Number(modelStats?.count);
    if (!Number.isFinite(value) || value <= 0) return '-';
    return value.toLocaleString();
  }

  _resolveRowTagType(tag, preferredTagType = '') {
    const zeroCount = Number(tag?.zero_shot?.count || 0);
    const trainedCount = Number(tag?.trained?.count || 0);
    const hasZero = zeroCount > 0;
    const hasTrained = trainedCount > 0;
    const preferred = String(preferredTagType || '').trim().toLowerCase();
    if (preferred === 'siglip' && hasZero) return 'siglip';
    if (preferred === 'trained' && hasTrained) return 'trained';
    if (hasZero) return 'siglip';
    if (hasTrained) return 'trained';
    return '';
  }

  _emitRowSelected(category, keyword, tagType = 'siglip') {
    this.dispatchEvent(new CustomEvent('row-selected', {
      detail: {
        category,
        keyword,
        tagType: String(tagType || 'siglip').trim().toLowerCase(),
      },
      bubbles: true,
      composed: true,
    }));
  }

  _normalizeThreshold(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(1, parsed));
  }

  _formatThresholdInput(value) {
    const normalized = this._normalizeThreshold(value);
    return normalized.toFixed(2);
  }

  _isThresholdChanged(tagType) {
    const normalizedTagType = String(tagType || '').trim().toLowerCase();
    const draftRaw = normalizedTagType === 'trained'
      ? this._draftTrainedMinConfidence
      : this._draftZeroShotMinConfidence;
    const currentRaw = normalizedTagType === 'trained'
      ? this.trainedMinConfidence
      : this.zeroShotMinConfidence;
    const draft = this._normalizeThreshold(draftRaw);
    const current = this._normalizeThreshold(currentRaw);
    return Math.abs(draft - current) > 0.0001;
  }

  _emitThresholdChanged(nextZeroShot, nextTrained) {
    this.dispatchEvent(new CustomEvent('threshold-changed', {
      detail: {
        zeroShotMinConfidence: this._normalizeThreshold(nextZeroShot),
        trainedMinConfidence: this._normalizeThreshold(nextTrained),
      },
      bubbles: true,
      composed: true,
    }));
  }

  _hasNonDefaultThresholds() {
    const zeroShot = this._normalizeThreshold(this.zeroShotMinConfidence);
    const trained = this._normalizeThreshold(this.trainedMinConfidence);
    return Math.abs(zeroShot - DEFAULT_ZERO_SHOT_MIN_CONFIDENCE) > 0.0001
      || Math.abs(trained - DEFAULT_TRAINED_MIN_CONFIDENCE) > 0.0001;
  }

  _restoreDefaultThresholds() {
    this._draftZeroShotMinConfidence = this._formatThresholdInput(DEFAULT_ZERO_SHOT_MIN_CONFIDENCE);
    this._draftTrainedMinConfidence = this._formatThresholdInput(DEFAULT_TRAINED_MIN_CONFIDENCE);
    this._expandedThresholdEditor = '';
    this._emitThresholdChanged(
      DEFAULT_ZERO_SHOT_MIN_CONFIDENCE,
      DEFAULT_TRAINED_MIN_CONFIDENCE,
    );
  }

  _handleThresholdInputDraft(tagType, event) {
    const target = event?.target;
    const raw = String(target?.value ?? '');
    if (raw.trim() === '') {
      if (tagType === 'trained') {
        this._draftTrainedMinConfidence = '';
      } else {
        this._draftZeroShotMinConfidence = '';
      }
      return;
    }
    const normalized = this._normalizeThreshold(raw);
    const normalizedString = String(normalized);
    if (target && target.value !== normalizedString) {
      target.value = normalizedString;
    }
    if (tagType === 'trained') {
      this._draftTrainedMinConfidence = normalizedString;
    } else {
      this._draftZeroShotMinConfidence = normalizedString;
    }
  }

  _handleThresholdInputBlur(tagType, event) {
    const normalized = this._normalizeThreshold(event?.target?.value);
    const formatted = this._formatThresholdInput(normalized);
    if (event?.target) {
      event.target.value = formatted;
    }
    if (tagType === 'trained') {
      this._draftTrainedMinConfidence = formatted;
    } else {
      this._draftZeroShotMinConfidence = formatted;
    }
  }

  _applyZeroShotThreshold() {
    const nextZeroShot = this._normalizeThreshold(this._draftZeroShotMinConfidence);
    this._draftZeroShotMinConfidence = this._formatThresholdInput(nextZeroShot);
    this._expandedThresholdEditor = '';
    this._emitThresholdChanged(nextZeroShot, this.trainedMinConfidence);
  }

  _applyTrainedThreshold() {
    const nextTrained = this._normalizeThreshold(this._draftTrainedMinConfidence);
    this._draftTrainedMinConfidence = this._formatThresholdInput(nextTrained);
    this._expandedThresholdEditor = '';
    this._emitThresholdChanged(this.zeroShotMinConfidence, nextTrained);
  }

  _toggleThresholdEditor(tagType, event) {
    event?.stopPropagation?.();
    const normalized = String(tagType || '').trim().toLowerCase();
    this._expandedThresholdEditor = this._expandedThresholdEditor === normalized ? '' : normalized;
  }

  _handleThresholdInputKeydown(event, tagType) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (tagType === 'trained') {
      this._applyTrainedThreshold();
    } else {
      this._applyZeroShotThreshold();
    }
  }

  willUpdate(changedProperties) {
    if (changedProperties.has('zeroShotMinConfidence')) {
      this._draftZeroShotMinConfidence = this._formatThresholdInput(this.zeroShotMinConfidence);
    }
    if (changedProperties.has('trainedMinConfidence')) {
      this._draftTrainedMinConfidence = this._formatThresholdInput(this.trainedMinConfidence);
    }
  }

  _handleRowKeydown(event, category, tag) {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    const keyword = String(tag?.keyword || '').trim();
    if (!keyword) return;
    const tagType = this._resolveRowTagType(tag);
    if (!tagType) return;
    this._emitRowSelected(category, keyword, tagType);
  }

  _handleRowClick(event, category, tag) {
    const keyword = String(tag?.keyword || '').trim();
    if (!keyword) return;
    const clickedTagType = this._getTagTypeFromEventTarget(event?.target);
    if (clickedTagType && !this._hasSuggestionsForTagType(tag, clickedTagType)) {
      return;
    }
    const hoveredTagType = String(event?.currentTarget?.dataset?.hoverModel || '').trim().toLowerCase();
    const nextTagType = this._resolveRowTagType(tag, clickedTagType || hoveredTagType);
    if (!nextTagType) return;
    this._emitRowSelected(category, keyword, nextTagType);
  }

  _handleModelCellClick(event, category, tag, tagType, hasSuggestions) {
    event.stopPropagation();
    if (!hasSuggestions) return;
    const keyword = String(tag?.keyword || '').trim();
    if (!keyword) return;
    this._emitRowSelected(category, keyword, tagType);
  }

  _setRowHoverModel(source, tagType) {
    const row = source && typeof source.closest === 'function' ? source.closest('tr.ai-training-row') : null;
    if (!row) return;
    const normalized = String(tagType || '').trim().toLowerCase();
    if (normalized === 'siglip' || normalized === 'trained') {
      row.setAttribute('data-hover-model', normalized);
      return;
    }
    row.removeAttribute('data-hover-model');
  }

  _handleRowMouseLeave(event) {
    this._setRowHoverModel(event?.currentTarget, '');
  }

  _handleModelCellMouseEnter(event, tagType, hasSuggestions) {
    if (!hasSuggestions) {
      this._setRowHoverModel(event?.currentTarget, '');
      return;
    }
    this._setRowHoverModel(event?.currentTarget, tagType);
  }

  _hasSuggestionsForTagType(tag, tagType) {
    const normalized = String(tagType || '').trim().toLowerCase();
    if (normalized === 'trained') {
      return Number(tag?.trained?.count || 0) > 0;
    }
    if (normalized === 'siglip') {
      return Number(tag?.zero_shot?.count || 0) > 0;
    }
    return false;
  }

  _getTagTypeFromEventTarget(target) {
    if (!target || typeof target.closest !== 'function') return '';
    if (target.closest('.ai-training-cell--siglip')) return 'siglip';
    if (target.closest('.ai-training-cell--trained')) return 'trained';
    return '';
  }

  _renderThresholdHeader(tagType, modelLabel, currentValue, draftValue, borderClass = '') {
    const normalized = String(tagType || '').trim().toLowerCase();
    const isExpanded = this._expandedThresholdEditor === normalized;
    const ariaLabel = `${modelLabel} minimum confidence`;
    return html`
      <th class=${`px-4 py-2 text-center font-semibold text-gray-600 ${borderClass}`} colspan="1">
        <div class="flex flex-col items-center gap-2">
          <div class="flex flex-wrap items-center justify-center gap-2">
            <span class="text-xs font-semibold text-gray-600">ML Model: "${modelLabel}"</span>
            <button
              type="button"
              class="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-100"
              @click=${(event) => this._toggleThresholdEditor(normalized, event)}
            >
              [${this._formatThresholdInput(currentValue)}]
            </button>
          </div>
          ${isExpanded ? html`
            <div class="flex flex-col items-center gap-1">
              <div class="text-[11px] font-medium text-gray-500">Minimum Confidence</div>
              <div class="inline-flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  class="w-16 rounded border border-gray-300 px-1 py-0.5 text-right text-xs font-medium"
                  .value=${draftValue}
                  @input=${(event) => this._handleThresholdInputDraft(normalized, event)}
                  @blur=${(event) => this._handleThresholdInputBlur(normalized, event)}
                  @keydown=${(event) => this._handleThresholdInputKeydown(event, normalized)}
                  @click=${(event) => event.stopPropagation()}
                  aria-label=${ariaLabel}
                  title=${ariaLabel}
                >
                <button
                  type="button"
                  class="rounded border border-gray-300 px-2 py-0.5 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                  ?disabled=${!this._isThresholdChanged(normalized)}
                  @click=${(event) => {
                    event.stopPropagation();
                    if (normalized === 'trained') {
                      this._applyTrainedThreshold();
                    } else {
                      this._applyZeroShotThreshold();
                    }
                  }}
                >
                  Set
                </button>
              </div>
            </div>
          ` : null}
        </div>
      </th>
    `;
  }

  render() {
    const categories = this._toCategories();
    const hasRows = categories.some((categoryGroup) =>
      Array.isArray(categoryGroup?.tags)
      && categoryGroup.tags.some((tag) => Number(tag?.zero_shot?.count || 0) > 0 || Number(tag?.trained?.count || 0) > 0)
    );
    const mainContent = this.loading
        ? html`
          <div class="bg-white rounded-lg border border-gray-200 p-6 text-sm text-gray-600">
            <span class="curate-spinner mr-2" aria-hidden="true"></span>
            Loading AI Tagging...
          </div>
        `
      : this.error
        ? html`
            <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
              ${this.error}
            </div>
          `
        : !hasRows
          ? html`
              <div class="space-y-3">
                <div class="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-800">
                  Instructions: Review suggestion counts. Click on any row to accept/reject suggestions.
                </div>
                <div class="bg-white rounded-lg border border-gray-200 p-6 text-sm text-gray-600">
                  No zero-shot or trained tag suggestions are currently pending review.
                </div>
              </div>
            `
          : html`
              <div class="space-y-5">
                <div class="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-800">
                  Instructions: Review suggestion counts. Click on any row to accept/reject suggestions.
                </div>
                ${categories.map((categoryGroup) => {
                  const category = String(categoryGroup?.category || 'Uncategorized');
                  const tags = Array.isArray(categoryGroup?.tags) ? categoryGroup.tags : [];
                  const rowCount = tags.filter((tag) => Number(tag?.zero_shot?.count || 0) > 0 || Number(tag?.trained?.count || 0) > 0).length;
                  if (!rowCount) return html``;
                  return html`
                    <section class="bg-white rounded-lg border border-gray-200 overflow-hidden">
                      <div class="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                        <h3 class="text-sm font-semibold tracking-wide uppercase text-slate-700">${category}</h3>
                        <span class="text-xs text-gray-500">${rowCount} tags</span>
                      </div>
                      <div class="overflow-x-auto">
                        <table class="min-w-full text-sm">
                          <thead class="bg-gray-50">
                            <tr>
                              <th class="px-4 py-2 text-left font-semibold text-gray-600 border-r border-gray-200" rowspan="2">Tag</th>
                              ${this._renderThresholdHeader(
                                'siglip',
                                'zero-shot',
                                this.zeroShotMinConfidence,
                                this._draftZeroShotMinConfidence,
                                'border-r border-gray-200'
                              )}
                              ${this._renderThresholdHeader(
                                'trained',
                                'trained',
                                this.trainedMinConfidence,
                                this._draftTrainedMinConfidence,
                                'border-r border-gray-200'
                              )}
                              <th class="px-4 py-2 text-center font-semibold text-gray-600" colspan="1">
                                <div class="flex flex-col items-center gap-1">
                                  <div class="text-xs font-semibold text-gray-600">ML Model: "similarity"</div>
                                </div>
                              </th>
                            </tr>
                            <tr>
                              <th class="px-4 py-2 text-right font-semibold text-gray-600 border-r border-gray-200">Suggestions</th>
                              <th class="px-4 py-2 text-right font-semibold text-gray-600 border-r border-gray-200">Suggestions</th>
                              <th class="px-4 py-2 text-center font-semibold text-gray-600">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            ${tags.map((tag) => {
                              const keyword = String(tag?.keyword || '').trim();
                              if (!keyword) return html``;
                              const hasZero = Number(tag?.zero_shot?.count || 0) > 0;
                              const hasTrained = Number(tag?.trained?.count || 0) > 0;
                              const selectedTagType = this._resolveRowTagType(tag);
                              return html`
                                <tr
                                  class="border-t border-gray-100 ai-training-row ai-training-row--${selectedTagType}"
                                  tabindex="0"
                                  role="button"
                                  @click=${(event) => this._handleRowClick(event, category, tag)}
                                  @mouseleave=${this._handleRowMouseLeave}
                                  @keydown=${(event) => this._handleRowKeydown(event, category, tag)}
                                >
                                  <td class="px-4 py-2 font-semibold text-slate-800 border-r border-gray-200">${keyword}</td>
                                  <td
                                    class="px-4 py-2 text-right tabular-nums ai-training-cell ai-training-cell--siglip ${hasZero ? 'cursor-pointer text-blue-700 font-semibold' : 'cursor-default text-gray-400'}"
                                    @mouseenter=${(event) => this._handleModelCellMouseEnter(event, 'siglip', hasZero)}
                                    @click=${(event) => this._handleModelCellClick(event, category, tag, 'siglip', hasZero)}
                                  >
                                    ${this._formatCount(tag?.zero_shot)}
                                  </td>
                                  <td
                                    class="px-4 py-2 text-right tabular-nums ai-training-cell ai-training-cell--trained ${hasTrained ? 'cursor-pointer text-indigo-700 font-semibold' : 'cursor-default text-gray-400'}"
                                    @mouseenter=${(event) => this._handleModelCellMouseEnter(event, 'trained', hasTrained)}
                                    @click=${(event) => this._handleModelCellClick(event, category, tag, 'trained', hasTrained)}
                                  >
                                    ${this._formatCount(tag?.trained)}
                                  </td>
                                  <td class="px-4 py-2 text-center">
                                    <button
                                      type="button"
                                      class="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 transition-colors hover:text-blue-800 hover:underline"
                                      @click=${(event) => this._handleModelCellClick(event, category, tag, 'similarity', true)}
                                    >
                                      <span aria-hidden="true">🔍</span>
                                      Check
                                    </button>
                                  </td>
                                </tr>
                              `;
                            })}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  `;
                })}
              </div>
            `;

    return html`
      <div class="curate-layout results-hotspot-layout">
        <div class="curate-pane">
          <div class="curate-pane-body p-3">
            ${mainContent}
          </div>
        </div>
        <right-panel
          .tools=${[]}
          .collapsible=${false}
          .collapsed=${false}
        >
          <div slot="header-left" class="text-xs font-semibold uppercase tracking-wide text-slate-700">
            Tag Suggester Help
          </div>
          <div slot="default" class="p-4 space-y-4 text-sm text-gray-700">
            <p>
              Zoltag uses several ML (machine learning) models to suggest tags. The goal of this page: <strong>Accept or reject suggestions until suggestion counts are as low as possible.</strong> As you do this, the models will learn from you, and the suggestions will become more accurate over time.
            </p>
            <p>
              When you click into a row, you can accept results by tagging them positively (green) and reject results by tagging them negatively (red). Return to this screen and refresh to see counts decrease.
            </p>
            <p>
              <strong>What are confidence scores?</strong> ML suggestions assign probabilities of matches. The higher the score, the higher the chance of a match. You can alter the minimum confidence scores to consider a larger or smaller set. Or you can just accept the defaults.
            </p>
            ${this._hasNonDefaultThresholds() ? html`
              <p>
                <button
                  type="button"
                  class="text-blue-700 underline underline-offset-2 hover:text-blue-800"
                  @click=${this._restoreDefaultThresholds}
                >
                  Click here to restore confidence score defaults
                </button>
              </p>
            ` : html``}
            <p>
              Remember, as you confirm and reject tags, the models learn from those new tags.
            </p>
          </div>
        </right-panel>
      </div>
    `;
  }
}

customElements.define('curate-ai-tagger', CurateAiTagger);
