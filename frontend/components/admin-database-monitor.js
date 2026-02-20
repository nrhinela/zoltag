import { LitElement, html, css } from 'lit';
import { getAdminDatabaseMonitor } from '../services/api.js';

function fmtNumber(value) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '--';
  return n.toLocaleString();
}

function fmtDate(value) {
  if (!value) return '--';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleString();
}

export class AdminDatabaseMonitor extends LitElement {
  static properties = {
    loading: { type: Boolean },
    error: { type: String },
    snapshot: { type: Object },
    history: { type: Array },
    autoRefresh: { type: Boolean },
    refreshSeconds: { type: Number },
  };

  static styles = css`
    :host {
      display: block;
    }

    .panel {
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      padding: 20px;
    }

    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }

    .title {
      margin: 0;
      font-size: 20px;
      font-weight: 700;
      color: #111827;
    }

    .subtitle {
      margin: 4px 0 0 0;
      color: #6b7280;
      font-size: 13px;
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .btn {
      padding: 8px 12px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      background: white;
      color: #111827;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }

    .btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }

    .metric {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 10px;
      background: #f9fafb;
    }

    .metric-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #6b7280;
      margin-bottom: 6px;
    }

    .metric-value {
      font-size: 22px;
      line-height: 1.2;
      font-weight: 700;
      color: #111827;
    }

    .table-wrap {
      overflow-x: auto;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: white;
      margin-bottom: 12px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }

    th, td {
      border-bottom: 1px solid #e5e7eb;
      padding: 8px;
      text-align: left;
      vertical-align: top;
      white-space: nowrap;
    }

    th {
      font-size: 11px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      background: #f9fafb;
    }

    .error {
      margin-top: 10px;
      border: 1px solid #fecaca;
      background: #fef2f2;
      color: #991b1b;
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 13px;
    }
  `;

  constructor() {
    super();
    this.loading = false;
    this.error = '';
    this.snapshot = null;
    this.history = [];
    this.autoRefresh = true;
    this.refreshSeconds = 10;
    this._timer = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._load();
    this._startTimer();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._clearTimer();
  }

  _startTimer() {
    this._clearTimer();
    if (!this.autoRefresh) return;
    const ms = Math.max(5, Number(this.refreshSeconds || 10)) * 1000;
    this._timer = setInterval(() => this._load(), ms);
  }

  _clearTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async _load() {
    if (this.loading) return;
    this.loading = true;
    this.error = '';
    try {
      const data = await getAdminDatabaseMonitor();
      this.snapshot = data || null;
      this.history = [data, ...this.history].slice(0, 30);
    } catch (err) {
      console.error('Failed to load database monitor stats:', err);
      this.error = err?.message || 'Failed to load database monitor stats';
    } finally {
      this.loading = false;
    }
  }

  _toggleAutoRefresh(event) {
    this.autoRefresh = !!event?.target?.checked;
    this._startTimer();
  }

  _renderMetrics() {
    const s = this.snapshot || {};
    const c = s.connections || {};
    const counters = s.counters || {};
    return html`
      <div class="grid">
        <div class="metric">
          <div class="metric-label">Connections (Total / Max)</div>
          <div class="metric-value">${fmtNumber(c.total)} / ${fmtNumber(s.max_connections)}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Active</div>
          <div class="metric-value">${fmtNumber(c.active)}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Idle</div>
          <div class="metric-value">${fmtNumber(c.idle)}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Idle In Transaction</div>
          <div class="metric-value">${fmtNumber(c.idle_in_transaction)}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Query Calls (pg_stat_statements)</div>
          <div class="metric-value">${counters.calls_total == null ? '--' : fmtNumber(counters.calls_total)}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Transactions (Commit + Rollback)</div>
          <div class="metric-value">${fmtNumber(counters.transactions_total)}</div>
        </div>
      </div>
    `;
  }

  _renderProcesses() {
    const rows = Array.isArray(this.snapshot?.processes) ? this.snapshot.processes : [];
    return html`
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Process Type</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length === 0 ? html`
              <tr><td colspan="2">No process data</td></tr>
            ` : rows.map((row) => html`
              <tr>
                <td>${row.backend_type || 'unknown'}</td>
                <td>${fmtNumber(row.count)}</td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    `;
  }

  _renderHistory() {
    const rows = Array.isArray(this.history) ? this.history : [];
    return html`
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Captured</th>
              <th>Total</th>
              <th>Active</th>
              <th>Idle</th>
              <th>Idle In Tx</th>
              <th>Calls Total</th>
              <th>Transactions Total</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length === 0 ? html`
              <tr><td colspan="7">No history yet</td></tr>
            ` : rows.map((row) => html`
              <tr>
                <td>${fmtDate(row.captured_at)}</td>
                <td>${fmtNumber(row?.connections?.total)}</td>
                <td>${fmtNumber(row?.connections?.active)}</td>
                <td>${fmtNumber(row?.connections?.idle)}</td>
                <td>${fmtNumber(row?.connections?.idle_in_transaction)}</td>
                <td>${row?.counters?.calls_total == null ? '--' : fmtNumber(row.counters.calls_total)}</td>
                <td>${fmtNumber(row?.counters?.transactions_total)}</td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    `;
  }

  render() {
    return html`
      <div class="panel">
        <div class="header-row">
          <div>
            <h2 class="title">Database Monitor</h2>
            <p class="subtitle">Live connection, process, and query-volume counters.</p>
            <p class="subtitle">Last updated: ${fmtDate(this.snapshot?.captured_at)}</p>
          </div>
          <div class="actions">
            <label style="font-size:13px; color:#374151; display:flex; align-items:center; gap:6px;">
              <input type="checkbox" .checked=${this.autoRefresh} @change=${this._toggleAutoRefresh} />
              Auto refresh
            </label>
            <button class="btn" ?disabled=${this.loading} @click=${this._load}>
              ${this.loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>

        ${this._renderMetrics()}

        <h3 style="margin: 0 0 8px 0; font-size: 14px; color: #111827;">Process Counts</h3>
        ${this._renderProcesses()}

        <h3 style="margin: 8px 0 8px 0; font-size: 14px; color: #111827;">Recent Samples (Session)</h3>
        ${this._renderHistory()}

        ${this.error ? html`<div class="error">${this.error}</div>` : ''}
      </div>
    `;
  }
}

customElements.define('admin-database-monitor', AdminDatabaseMonitor);

