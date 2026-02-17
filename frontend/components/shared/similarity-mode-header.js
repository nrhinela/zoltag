import { html } from 'lit';

/**
 * Render a shared similarity-mode header for result panes.
 * Used in Search and Curate to avoid divergent UI treatments.
 */
export function renderSimilarityModeHeader({ onContinue } = {}) {
  const handleContinue = typeof onContinue === 'function' ? onContinue : null;
  return html`
    <div class="w-full flex items-center gap-3">
      ${handleContinue ? html`
        <button
          type="button"
          class="inline-flex items-center gap-1 text-blue-700 text-sm font-semibold hover:underline"
          @click=${handleContinue}
        >
          <span aria-hidden="true">←</span>
          <span>Back</span>
        </button>
      ` : html``}
      <div class="text-lg sm:text-xl font-extrabold tracking-tight text-gray-900">Similarity Results</div>
    </div>
  `;
}
