import { LitElement, html } from 'lit';
import {
  getSharesSummary,
  updateListShare,
  revokeListShare,
  hardDeleteListShare,
  hardDeleteListShares,
} from '../services/api.js';

/**
 * Admin Shares Panel Component
 *
 * Light DOM CRUD table for list shares.
 */
export class AdminReviewsPanel extends LitElement {
  createRenderRoot() {
    return this;
  }

  static properties = {
    tenantId: { type: String },
    rows: { type: Array },
    loading: { type: Boolean },
    error: { type: String },
    expiryDraftByShareId: { type: Object },
    actionBusyByShareId: { type: Object },
    selectedShareIds: { type: Object },
    bulkDeleting: { type: Boolean },
  };

  constructor() {
    super();
    this.tenantId = '';
    this.rows = [];
    this.loading = false;
    this.error = '';
    this.expiryDraftByShareId = {};
    this.actionBusyByShareId = {};
    this.selectedShareIds = new Set();
    this.bulkDeleting = false;
  }

  async connectedCallback() {
    super.connectedCallback();
    await this._loadShares();
  }

  async _loadShares() {
    if (!this.tenantId) {
      this.error = 'Missing tenant ID';
      return;
    }
    this.loading = true;
    this.error = '';
    try {
      const lists = await getSharesSummary(this.tenantId);
      const flattened = [];
      for (const listEntry of (Array.isArray(lists) ? lists : [])) {
        const listId = Number(listEntry?.list_id || 0) || null;
        const listTitle = String(listEntry?.list_title || '').trim() || (listId ? `List #${listId}` : 'Unknown List');
        for (const share of (Array.isArray(listEntry?.shares) ? listEntry.shares : [])) {
          flattened.push({
            share_id: String(share?.share_id || ''),
            list_id: Number(share?.list_id || listId || 0) || null,
            list_title: String(share?.list_title || listTitle || '').trim() || listTitle,
            guest_email: String(share?.guest_email || '').trim(),
            guest_uid: String(share?.guest_uid || '').trim(),
            created_by_uid: String(share?.created_by_uid || '').trim(),
            created_by_name: String(share?.created_by_name || '').trim(),
            allow_download_thumbs: !!share?.allow_download_thumbs,
            allow_download_originals: !!share?.allow_download_originals,
            created_at: share?.created_at || null,
            expires_at: share?.expires_at || null,
            revoked_at: share?.revoked_at || null,
            annotation_count: Number(share?.annotation_count || 0) || 0,
          });
        }
      }

      flattened.sort((a, b) => {
        const aTime = new Date(a?.created_at || 0).getTime();
        const bTime = new Date(b?.created_at || 0).getTime();
        return bTime - aTime;
      });

      const draft = {};
      for (const row of flattened) {
        draft[row.share_id] = this._expiryDaysFromIso(row.expires_at);
      }

      this.rows = flattened;
      this.expiryDraftByShareId = draft;
      const currentIds = new Set(flattened.map((row) => String(row.share_id || '')));
      const nextSelected = new Set();
      for (const id of this.selectedShareIds) {
        if (currentIds.has(id)) nextSelected.add(id);
      }
      this.selectedShareIds = nextSelected;
    } catch (err) {
      console.error('Failed to load shares:', err);
      this.error = err?.message || 'Failed to load shares';
      this.rows = [];
    } finally {
      this.loading = false;
    }
  }

  _expiryDaysFromIso(expiresAt) {
    if (!expiresAt) return 'never';
    const expires = new Date(expiresAt);
    if (Number.isNaN(expires.getTime())) return '30';
    const now = new Date();
    const ms = expires.getTime() - now.getTime();
    const days = Math.round(ms / (1000 * 60 * 60 * 24));
    if (days <= 0) return 'never';
    if (days <= 10) return '7';
    if (days <= 45) return '30';
    return '90';
  }

  _isActionBusy(shareId) {
    return !!this.actionBusyByShareId[String(shareId)];
  }

  _setActionBusy(shareId, busy) {
    const key = String(shareId);
    this.actionBusyByShareId = {
      ...this.actionBusyByShareId,
      [key]: !!busy,
    };
  }

  _setExpiryDraft(shareId, value) {
    const key = String(shareId);
    this.expiryDraftByShareId = {
      ...this.expiryDraftByShareId,
      [key]: String(value || 'never'),
    };
  }

  _formatDate(dateStr) {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleDateString();
  }

  _statusText(row) {
    if (row.revoked_at) return 'Revoked';
    if (row.expires_at) {
      const expires = new Date(row.expires_at);
      if (!Number.isNaN(expires.getTime()) && expires.getTime() <= Date.now()) return 'Expired';
    }
    return 'Active';
  }

  _statusClass(row) {
    const status = this._statusText(row);
    if (status === 'Revoked') return 'bg-red-100 text-red-800';
    if (status === 'Expired') return 'bg-gray-100 text-gray-700';
    return 'bg-green-100 text-green-800';
  }

  async _handleSaveExpiry(row) {
    const shareId = String(row?.share_id || '');
    const listId = Number(row?.list_id || 0) || null;
    if (!shareId || !listId || this._isActionBusy(shareId)) return;

    const draft = String(this.expiryDraftByShareId?.[shareId] || 'never');
    const expires_in_days = draft === 'never' ? null : Number(draft);
    if (draft !== 'never' && ![7, 30, 90].includes(expires_in_days)) {
      alert('Expiration must be 7, 30, 90, or Never.');
      return;
    }

    this._setActionBusy(shareId, true);
    try {
      await updateListShare(this.tenantId, listId, shareId, {
        expires_in_days,
      });
      await this._loadShares();
    } catch (err) {
      console.error('Failed to update share:', err);
      alert(err?.message || 'Failed to update share');
    } finally {
      this._setActionBusy(shareId, false);
    }
  }

  async _handleRevoke(row) {
    const shareId = String(row?.share_id || '');
    const listId = Number(row?.list_id || 0) || null;
    if (!shareId || !listId || this._isActionBusy(shareId)) return;
    if (!confirm(`Revoke share for ${row.guest_email}?`)) return;

    this._setActionBusy(shareId, true);
    try {
      await revokeListShare(this.tenantId, listId, shareId);
      await this._loadShares();
    } catch (err) {
      console.error('Failed to revoke share:', err);
      alert(err?.message || 'Failed to revoke share');
    } finally {
      this._setActionBusy(shareId, false);
    }
  }

  async _handleDelete(row) {
    const shareId = String(row?.share_id || '');
    if (!shareId || this._isActionBusy(shareId)) return;
    if (!confirm(`Delete share for ${row.guest_email}? This cannot be undone.`)) return;

    this._setActionBusy(shareId, true);
    try {
      await hardDeleteListShare(this.tenantId, shareId);
      await this._loadShares();
    } catch (err) {
      console.error('Failed to delete share:', err);
      alert(err?.message || 'Failed to delete share');
    } finally {
      this._setActionBusy(shareId, false);
    }
  }

  _isSelected(shareId) {
    return this.selectedShareIds.has(String(shareId || ''));
  }

  _toggleSelected(shareId, checked) {
    const key = String(shareId || '');
    if (!key) return;
    const next = new Set(this.selectedShareIds);
    if (checked) {
      next.add(key);
    } else {
      next.delete(key);
    }
    this.selectedShareIds = next;
  }

  _toggleSelectAll(checked) {
    if (!checked) {
      this.selectedShareIds = new Set();
      return;
    }
    this.selectedShareIds = new Set(this.rows.map((row) => String(row.share_id || '')).filter(Boolean));
  }

  async _handleBulkDelete() {
    const selected = Array.from(this.selectedShareIds);
    if (!selected.length || this.bulkDeleting) return;
    if (!confirm(`Delete ${selected.length} selected share(s)? This cannot be undone.`)) return;
    this.bulkDeleting = true;
    try {
      await hardDeleteListShares(this.tenantId, selected);
      this.selectedShareIds = new Set();
      await this._loadShares();
    } catch (err) {
      console.error('Failed to bulk delete shares:', err);
      alert(err?.message || 'Failed to delete selected shares');
    } finally {
      this.bulkDeleting = false;
    }
  }

  render() {
    if (this.loading) {
      return html`
        <div class="bg-white border border-gray-200 rounded-lg p-6">
          <div class="text-sm text-gray-600">Loading shares...</div>
        </div>
      `;
    }

    if (this.error) {
      return html`
        <div class="bg-red-50 border border-red-200 rounded-lg p-6 space-y-2">
          <div class="text-sm font-semibold text-red-700">Failed to load shares</div>
          <div class="text-sm text-red-600">${this.error}</div>
          <button class="admin-subtab" @click=${() => this._loadShares()}>Retry</button>
        </div>
      `;
    }

    return html`
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-xl font-semibold text-gray-900">Shares</h2>
            <p class="text-sm text-gray-600">Manage guest shares across all lists.</p>
          </div>
          <button class="admin-subtab" @click=${() => this._loadShares()}>Refresh</button>
        </div>

        ${this.selectedShareIds.size > 0 ? html`
          <div class="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
            <div class="text-sm text-blue-900 font-medium">
              ${this.selectedShareIds.size} selected
            </div>
            <button
              class="admin-subtab"
              ?disabled=${this.bulkDeleting}
              @click=${this._handleBulkDelete}
            >
              ${this.bulkDeleting ? 'Deleting…' : 'Delete Selected'}
            </button>
          </div>
        ` : ''}

        <div class="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead class="bg-gray-50 border-b border-gray-200 text-gray-700">
              <tr>
                <th class="px-3 py-2 text-left font-semibold">
                  <input
                    type="checkbox"
                    .checked=${this.rows.length > 0 && this.selectedShareIds.size === this.rows.length}
                    @change=${(e) => this._toggleSelectAll(!!e.target?.checked)}
                    aria-label="Select all shares"
                  />
                </th>
                <th class="px-3 py-2 text-left font-semibold">List</th>
                <th class="px-3 py-2 text-left font-semibold">Guest</th>
                <th class="px-3 py-2 text-left font-semibold">Created By</th>
                <th class="px-3 py-2 text-left font-semibold">Created</th>
                <th class="px-3 py-2 text-left font-semibold">Expires</th>
                <th class="px-3 py-2 text-left font-semibold">Status</th>
                <th class="px-3 py-2 text-left font-semibold">Annotations</th>
                <th class="px-3 py-2 text-left font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${this.rows.length === 0 ? html`
                <tr>
                  <td class="px-3 py-8 text-center text-gray-500" colspan="9">No shares found.</td>
                </tr>
              ` : this.rows.map((row) => {
                const shareId = String(row.share_id || '');
                const busy = this._isActionBusy(shareId);
                const expiryDraft = String(this.expiryDraftByShareId?.[shareId] || 'never');
                return html`
                  <tr class="border-b border-gray-100 last:border-b-0 align-top">
                    <td class="px-3 py-3">
                      <input
                        type="checkbox"
                        .checked=${this._isSelected(shareId)}
                        @change=${(e) => this._toggleSelected(shareId, !!e.target?.checked)}
                        aria-label=${`Select share ${row.guest_email || shareId}`}
                      />
                    </td>
                    <td class="px-3 py-3">
                      <div class="font-medium text-gray-900">${row.list_title || `List #${row.list_id}`}</div>
                      <a class="text-blue-600 hover:underline text-xs" href="?tab=lists">Open Lists</a>
                    </td>
                    <td class="px-3 py-3">
                      <div class="text-gray-900">${row.guest_email || '--'}</div>
                    </td>
                    <td class="px-3 py-3">
                      <div class="text-gray-900">${row.created_by_name || '--'}</div>
                      <div class="text-xs text-gray-500">${row.created_by_uid || '--'}</div>
                    </td>
                    <td class="px-3 py-3 text-gray-700">${this._formatDate(row.created_at)}</td>
                    <td class="px-3 py-3">
                      <div class="flex items-center gap-2">
                        <select
                          class="border border-gray-300 rounded px-2 py-1 text-sm bg-white"
                          .value=${expiryDraft}
                          ?disabled=${busy}
                          @change=${(e) => this._setExpiryDraft(shareId, e.target.value)}
                        >
                          <option value="7">7 days</option>
                          <option value="30">30 days</option>
                          <option value="90">90 days</option>
                          <option value="never">Never</option>
                        </select>
                        <button class="admin-subtab" ?disabled=${busy} @click=${() => this._handleSaveExpiry(row)}>
                          Save
                        </button>
                      </div>
                    </td>
                    <td class="px-3 py-3">
                      <span class="text-xs px-2 py-1 rounded-full font-semibold ${this._statusClass(row)}">
                        ${this._statusText(row)}
                      </span>
                    </td>
                    <td class="px-3 py-3 text-gray-700">${Number(row.annotation_count || 0).toLocaleString()}</td>
                    <td class="px-3 py-3">
                      <div class="flex flex-wrap items-center gap-2">
                        <button
                          class="admin-subtab"
                          ?disabled=${busy || !!row.revoked_at}
                          @click=${() => this._handleRevoke(row)}
                        >
                          Revoke
                        </button>
                        <button
                          class="admin-subtab"
                          ?disabled=${busy}
                          @click=${() => this._handleDelete(row)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
              })}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
}

customElements.define('admin-reviews-panel', AdminReviewsPanel);
