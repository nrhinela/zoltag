import { html } from 'lit';

export function renderSectionGuide({ rows = [] } = {}) {
  return html`
    <div class="home-cta-grid" style="grid-template-columns: 1fr;">
      ${rows.map((row) => html`
        <button
          type="button"
          class="home-cta-card ${row.accentClass || 'home-cta-admin'} ${row.disabled ? 'opacity-60 cursor-not-allowed' : ''}"
          title=${row.title || row.label}
          ?disabled=${!!row.disabled}
          @click=${row.onClick || (() => {})}
        >
          <div class="home-cta-backdrop" aria-hidden="true"></div>
          <div class="home-cta-glyph" aria-hidden="true">
            <span class="home-cta-glyph-char">${row.glyphChar || '•'}</span>
          </div>
          <div class="home-cta-icon-wrap" aria-hidden="true">
            ${row.icon}
          </div>
          <div class="home-cta-content">
            <div class="home-cta-title">${row.label}</div>
            <div class="home-cta-subtitle">${row.description}</div>
          </div>
          <div class="home-cta-arrow" aria-hidden="true">
            <span class="home-cta-arrow-char">${row.disabled ? '•' : '→'}</span>
          </div>
        </button>
      `)}
    </div>
  `;
}
