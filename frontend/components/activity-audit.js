import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import { adminTypography } from './shared/admin-typography.js';
import { getAdminActivity, getTenantActivity } from '../services/api.js';

const EVENT_OPTIONS = [
  { value: '', label: 'All events' },
  { value: 'auth.login', label: 'Logins' },
];

const WINDOW_OPTIONS = [
  { value: 24, label: 'Last 24h' },
  { value: 168, label: 'Last 7d' },
  { value: 720, label: 'Last 30d' },
];

class ActivityAudit extends LitElement {
  static properties = {
    tenant: { type: String },
    tenantName: { type: String },
    scope: { type: String }, // "tenant" | "global"
    loading: { type: Boolean, state: true },
    error: { type: String, state: true },
    events: { type: Array, state: true },
    summary: { type: Object, state: true },
    sinceHours: { type: Number, state: true },
    eventType: { type: String, state: true },
    tenantFilter: { type: String, state: true },
    limit: { type: Number, state: true },
  };

  static styles = [
    tailwind,
    adminTypography,
    css`
      :host {
        display: block;
      }

      .card {
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
      }

      .header {
        padding: 18px 20px;
        border-bottom: 1px solid #e5e7eb;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }

      .title {
        margin: 0;
        font-size: 24px;
        color: #111827;
      }

      .subtitle {
        margin: 4px 0 0;
        color: #6b7280;
        font-size: 14px;
      }

      .content {
        padding: 18px 20px 20px;
      }

      .controls {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-bottom: 16px;
      }

      .select,
      .input {
        border: 1px solid #d1d5db;
        border-radius: 8px;
        padding: 8px 10px;
        font-size: 14px;
        background: white;
      }

      .input {
        min-width: 220px;
      }

      .btn {
        border: 1px solid #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
        border-radius: 8px;
        padding: 8px 12px;
        font-weight: 600;
        cursor: pointer;
      }

      .btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .error {
        border: 1px solid #fecaca;
        background: #fef2f2;
        color: #b91c1c;
        padding: 10px 12px;
        border-radius: 8px;
        margin-bottom: 12px;
      }

      .summary {
        margin-bottom: 12px;
        color: #4b5563;
        font-size: 13px;
      }

      .table-wrap {
        margin-top: 14px;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        overflow-x: auto;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th {
        text-align: left;
        font-size: 12px;
        color: #374151;
        background: #f9fafb;
        text-transform: uppercase;
        letter-spacing: 0.02em;
        padding: 10px 12px;
        border-bottom: 1px solid #e5e7eb;
      }

      td {
        padding: 10px 12px;
        border-bottom: 1px solid #f1f5f9;
        font-size: 13px;
        color: #1f2937;
        vertical-align: top;
      }

      tr:last-child td {
        border-bottom: none;
      }

      .muted {
        color: #6b7280;
      }

      .empty {
        text-align: center;
        color: #6b7280;
        padding: 16px 8px;
      }
    `,
  ];

  constructor() {
    super();
    this.tenant = '';
    this.tenantName = '';
    this.scope = 'tenant';
    this.loading = false;
    this.error = '';
    this.events = [];
    this.summary = { total_events: 0, unique_actors: 0, event_type_counts: {}, daily_counts: [] };
    this.sinceHours = 168;
    this.eventType = 'auth.login';
    this.tenantFilter = '';
    this.limit = 200;
  }

  updated(changedProperties) {
    if (changedProperties.has('tenant') || changedProperties.has('scope')) {
      this._load();
    }
  }

  connectedCallback() {
    super.connectedCallback();
    this._load();
  }

  _eventLabel(eventType) {
    const normalized = String(eventType || '').trim().toLowerCase();
    if (normalized === 'auth.login') return 'Login';
    if (normalized === 'search.images') return 'Image Search';
    if (normalized === 'search.nl') return 'NL Search';
    return normalized || 'Unknown';
  }

  _formatEventTime(value) {
    if (!value) return 'n/a';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'n/a';
    return date.toLocaleString();
  }

  async _load() {
    if (this.scope === 'tenant' && !String(this.tenant || '').trim()) {
      this.events = [];
      this.summary = { total_events: 0, unique_actors: 0, event_type_counts: {}, daily_counts: [] };
      return;
    }
    this.loading = true;
    this.error = '';
    try {
      let result;
      if (this.scope === 'global') {
        result = await getAdminActivity({
          tenantId: this.tenantFilter || undefined,
          eventType: this.eventType || undefined,
          sinceHours: this.sinceHours,
          limit: this.limit,
          offset: 0,
        });
      } else {
        result = await getTenantActivity(this.tenant, {
          eventType: this.eventType || undefined,
          sinceHours: this.sinceHours,
          limit: this.limit,
          offset: 0,
        });
      }
      this.events = Array.isArray(result?.events) ? result.events : [];
      this.summary = result?.summary || { total_events: 0, unique_actors: 0, event_type_counts: {}, daily_counts: [] };
    } catch (error) {
      console.error('Failed to load activity audit:', error);
      this.error = error?.message || 'Failed to load activity events';
      this.events = [];
      this.summary = { total_events: 0, unique_actors: 0, event_type_counts: {}, daily_counts: [] };
    } finally {
      this.loading = false;
    }
  }

  render() {
    return html`
      <div class="card">
        <div class="header">
          <div>
            <h2 class="title">Audit</h2>
            <p class="subtitle">
              ${this.scope === 'global'
                ? 'System-wide login and search activity'
                : `Tenant activity for ${this.tenantName || this.tenant}`}
            </p>
          </div>
          <button class="btn" @click=${this._load} ?disabled=${this.loading}>
            ${this.loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        <div class="content">
          <div class="controls">
            <select
              class="select"
              .value=${String(this.sinceHours)}
              @change=${(e) => {
                this.sinceHours = Number(e.target.value || 168);
                this._load();
              }}
            >
              ${WINDOW_OPTIONS.map((option) => html`<option value=${String(option.value)}>${option.label}</option>`)}
            </select>
            <select
              class="select"
              @change=${(e) => {
                this.eventType = e.target.value || '';
                this._load();
              }}
            >
              ${EVENT_OPTIONS.map((option) => html`
                <option value=${option.value} ?selected=${this.eventType === option.value}>${option.label}</option>
              `)}
            </select>
            ${this.scope === 'global' ? html`
              <input
                class="input"
                type="text"
                .value=${this.tenantFilter}
                placeholder="Filter tenant UUID"
                @change=${(e) => {
                  this.tenantFilter = String(e.target.value || '').trim();
                  this._load();
                }}
              />
            ` : html``}
          </div>

          ${this.error ? html`<div class="error">${this.error}</div>` : html``}

          <div class="summary">
            Showing ${this.events.length} events
            (total ${Number(this.summary?.total_events || 0)} in selected window,
            ${Number(this.summary?.unique_actors || 0)} unique actors).
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  ${this.scope === 'global' ? html`<th>Tenant</th>` : html``}
                  <th>Event</th>
                  <th>Actor</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                ${this.events.length ? this.events.map((row) => html`
                  <tr>
                    <td class="muted">${this._formatEventTime(row.created_at)}</td>
                    ${this.scope === 'global' ? html`
                      <td class="muted">${row.tenant_id || 'n/a'}</td>
                    ` : html``}
                    <td>${this._eventLabel(row.event_type)}</td>
                    <td>
                      ${row.actor_display_name || row.actor_email || row.actor_supabase_uid || 'system'}
                    </td>
                    <td class="muted">
                      ${row.request_path || ''}
                      ${row.details?.mode ? html`<span> · ${row.details.mode}</span>` : html``}
                    </td>
                  </tr>
                `) : html`
                  <tr>
                    <td colspan="4" class="empty">${this.loading ? 'Loading activity...' : 'No activity events found.'}</td>
                  </tr>
                `}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('activity-audit', ActivityAudit);
export default ActivityAudit;
