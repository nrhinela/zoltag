import { LitElement, html } from 'lit';
import { getKeywordThresholds, setKeywordThresholdManual } from '../services/api.js';

export class AdminKeywordThresholds extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    tenantId: { type: String },
    tagType: { type: String },
    thresholds: { type: Array },
    loading: { type: Boolean },
    error: { type: String },
    _editValues: { type: Object },
    _savingRow: { type: String },  // key = `${keywordId}:${tagType}`
    _saveErrors: { type: Object },
  };

  constructor() {
    super();
    this.tenantId = '';
    this.tagType = 'siglip';
    this.thresholds = [];
    this.loading = false;
    this.error = '';
    this._editValues = {};
    this._savingRow = null;
    this._saveErrors = {};
  }

  updated(changed) {
    if (changed.has('tenantId') && this.tenantId) {
      this._load();
    }
  }

  async _load() {
    if (!this.tenantId) return;
    this.loading = true;
    this.error = '';
    try {
      const data = await getKeywordThresholds(this.tenantId, { tagType: this.tagType });
      this.thresholds = data.thresholds || [];
      // Pre-fill edit values with current manual values
      const edits = {};
      for (const row of this.thresholds) {
        if (row.keyword_id && row.tag_type) {
          const key = `${row.keyword_id}:${row.tag_type || this.tagType}`;
          edits[key] = row.threshold_manual != null ? String(row.threshold_manual) : '';
        }
      }
      this._editValues = edits;
    } catch (e) {
      this.error = 'Failed to load thresholds.';
    } finally {
      this.loading = false;
    }
  }

  async _save(row) {
    const tag_type = row.tag_type || this.tagType;
    const key = `${row.keyword_id}:${tag_type}`;
    const rawVal = this._editValues[key] ?? '';
    const parsed = rawVal.trim() === '' ? null : parseFloat(rawVal);
    if (rawVal.trim() !== '' && (isNaN(parsed) || parsed < 0 || parsed > 1)) {
      this._saveErrors = { ...this._saveErrors, [key]: 'Must be 0–1 or empty to clear' };
      return;
    }
    this._savingRow = key;
    this._saveErrors = { ...this._saveErrors, [key]: null };
    try {
      const updated = await setKeywordThresholdManual(this.tenantId, row.keyword_id, tag_type, parsed);
      this.thresholds = this.thresholds.map(t =>
        t.keyword_id === row.keyword_id && (t.tag_type || this.tagType) === tag_type ? updated : t
      );
      this._editValues = {
        ...this._editValues,
        [key]: updated.threshold_manual != null ? String(updated.threshold_manual) : '',
      };
    } catch (e) {
      this._saveErrors = { ...this._saveErrors, [key]: 'Save failed.' };
    } finally {
      this._savingRow = null;
    }
  }

  _onTagTypeChange(e) {
    this.tagType = e.target.value;
    this._load();
  }

  render() {
    return html`
      <div class="p-4">
        <div class="flex items-center gap-4 mb-4">
          <h2 class="text-lg font-semibold text-gray-800">Keyword Score Thresholds</h2>
          <div class="flex items-center gap-2">
            <label class="text-sm text-gray-600">Model type:</label>
            <select
              class="text-sm border border-gray-300 rounded px-2 py-1"
              .value=${this.tagType}
              @change=${this._onTagTypeChange}
            >
              <option value="siglip">siglip (zero-shot)</option>
              <option value="trained">trained (keyword model)</option>
            </select>
            <button
              class="text-sm text-blue-600 hover:text-blue-800 ml-2"
              @click=${() => this._load()}
            >Refresh</button>
          </div>
        </div>

        ${this.error ? html`<div class="text-red-600 text-sm mb-3">${this.error}</div>` : ''}

        ${this.loading ? html`<div class="text-gray-500 text-sm">Loading…</div>` : html`
          <div class="text-xs text-gray-500 mb-2">
            <strong>Effective threshold</strong> = manual override if set, otherwise calculated.
            Leave manual blank to use calculated value. Scores below the effective threshold
            are hidden in the tag audit view.
          </div>
          <table class="w-full text-sm border-collapse">
            <thead>
              <tr class="border-b border-gray-200 text-left text-xs text-gray-500 uppercase">
                <th class="py-2 pr-4 font-medium">Category</th>
                <th class="py-2 pr-4 font-medium">Keyword</th>
                <th class="py-2 pr-4 font-medium">Calculated</th>
                <th class="py-2 pr-4 font-medium">Method / Samples</th>
                <th class="py-2 pr-4 font-medium">Manual Override</th>
                <th class="py-2 pr-4 font-medium">Effective</th>
                <th class="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              ${this.thresholds.map(row => {
                const tag_type = row.tag_type || this.tagType;
                const key = `${row.keyword_id}:${tag_type}`;
                const saving = this._savingRow === key;
                const saveErr = this._saveErrors[key];
                const editVal = this._editValues[key] ?? '';
                return html`
                  <tr class="border-b border-gray-100 hover:bg-gray-50">
                    <td class="py-2 pr-4 text-gray-500">${row.category || '—'}</td>
                    <td class="py-2 pr-4 font-medium">${row.keyword}</td>
                    <td class="py-2 pr-4 tabular-nums">
                      ${row.threshold_calc != null ? row.threshold_calc.toFixed(4) : html`<span class="text-gray-400">—</span>`}
                    </td>
                    <td class="py-2 pr-4 text-gray-500 text-xs">
                      ${row.calc_method ? html`${row.calc_method} / n=${row.calc_sample_n ?? '?'}` : html`<span class="text-gray-400">not computed</span>`}
                    </td>
                    <td class="py-2 pr-4">
                      <input
                        type="number"
                        min="0" max="1" step="0.01"
                        class="w-24 border border-gray-300 rounded px-2 py-1 text-sm tabular-nums"
                        placeholder="auto"
                        .value=${editVal}
                        @input=${(e) => { this._editValues = { ...this._editValues, [key]: e.target.value }; }}
                      >
                      ${saveErr ? html`<div class="text-red-500 text-xs mt-1">${saveErr}</div>` : ''}
                    </td>
                    <td class="py-2 pr-4 tabular-nums font-medium">
                      ${row.effective_threshold != null
                        ? row.effective_threshold.toFixed(4)
                        : html`<span class="text-gray-400">none</span>`}
                    </td>
                    <td class="py-2">
                      <button
                        class="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
                        ?disabled=${saving}
                        @click=${() => this._save(row)}
                      >${saving ? 'Saving…' : 'Save'}</button>
                    </td>
                  </tr>
                `;
              })}
            </tbody>
          </table>
          ${this.thresholds.length === 0 ? html`
            <div class="text-gray-400 text-sm py-4 text-center">No keywords found.</div>
          ` : ''}
        `}
      </div>
    `;
  }
}

customElements.define('admin-keyword-thresholds', AdminKeywordThresholds);
