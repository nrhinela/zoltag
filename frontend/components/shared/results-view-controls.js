import { html } from 'lit';

/**
 * Render the common Results/Hotspot History controls used above result grids.
 * Keeps tab switches on their own row and optional actions (pagination, etc.)
 * on a separate row to avoid layout crowding.
 */
export function renderResultsViewControls({
  view = 'results',
  onChange = null,
  actions = null,
  resultsLabel = 'Results',
  historyLabel = 'Hotspot History',
} = {}) {
  const hasActions = actions !== null && actions !== undefined && actions !== false;

  return html`
    <div class="curate-pane-header-row curate-pane-header-row--view-toggle">
      <div class="curate-audit-toggle">
        <button
          class=${view === 'results' ? 'active' : ''}
          @click=${() => onChange?.('results')}
        >
          ${resultsLabel}
        </button>
        <button
          class=${view === 'history' ? 'active' : ''}
          @click=${() => onChange?.('history')}
        >
          ${historyLabel}
        </button>
      </div>
    </div>
    ${hasActions ? html`
      <div class="curate-pane-header-row curate-pane-header-row--view-actions">
        <div class="curate-pane-header-actions">
          ${actions}
        </div>
      </div>
    ` : html``}
  `;
}

