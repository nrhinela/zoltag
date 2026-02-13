import { css } from 'lit';

export const zoltagAppStyles = css`
    :host {
      display: block;
    }
    .container {
        max-width: 1280px;
        margin: 0 auto;
        padding: 16px;
    }
    .tag-carousel {
        display: flex;
        gap: 12px;
        overflow-x: auto;
        overflow-y: auto;
        padding-bottom: 4px;
        -webkit-overflow-scrolling: touch;
        flex: 1;
        align-items: stretch;
        min-height: 0;
    }
    .tag-card {
        min-width: 180px;
        height: 100%;
        display: flex;
        flex-direction: column;
    }
    .tag-card-body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
    }
    .tag-bar {
        height: 6px;
        border-radius: 9999px;
        background: #e5e7eb;
        overflow: hidden;
    }
    .tag-bar-fill {
        height: 100%;
        background: #2563eb;
    }
    .home-nav-grid {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(1, minmax(0, 1fr));
    }
    @media (min-width: 768px) {
        .home-nav-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }
    @media (min-width: 1024px) {
        .home-nav-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
        }
    }
    .home-nav-button {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 20px;
        border-radius: 12px;
        border: 1px solid #e5e7eb;
        background: #ffffff;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        transition: transform 0.15s ease, box-shadow 0.15s ease;
        text-align: left;
    }
    .home-nav-button:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 16px rgba(0, 0, 0, 0.08);
    }
    .home-tab-shell {
        position: relative;
        min-height: 280px;
    }
    .home-overview-layout {
        display: grid;
        grid-template-columns: 1fr;
        gap: 16px;
    }
    @media (min-width: 1100px) {
        .home-overview-layout {
            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
            align-items: start;
        }
        .home-overview-left {
            display: flex;
            max-height: 62.5vh;
            overflow-y: auto;
            align-self: start;
            padding-right: 6px;
        }
        .home-overview-right {
            max-height: 62.5vh;
            align-self: start;
            min-height: 0;
        }
        .home-overview-left .home-cta-grid.home-cta-grid-quad {
            width: 100%;
        }
    }
    .home-recommendations-panel {
        height: 100%;
        min-height: 0;
        max-height: 100%;
        border-radius: 14px;
        border: 1px solid #e2e8f0;
        background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .home-recommendations-tabs {
        margin-bottom: 8px;
    }
    .home-recommendations-header {
        font-size: 18px;
        font-weight: 700;
        color: #0f172a;
    }
    .home-recommendations-subtitle {
        font-size: 13px;
        font-weight: 600;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.06em;
    }
    .home-recommendations-body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding-right: 4px;
    }
    .home-tag-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .home-tag-section-title {
        font-size: 11px;
        font-weight: 700;
        color: #475569;
        text-transform: uppercase;
        letter-spacing: 0.08em;
    }
    .home-tag-chip-wrap {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
    .home-tag-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #ffffff;
        color: #1e293b;
        font-size: 13px;
        font-weight: 600;
        transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
    }
    .home-tag-chip:hover {
        border-color: #93c5fd;
        background: #eff6ff;
        transform: translateY(-1px);
    }
    .home-tag-chip:focus-visible {
        outline: 2px solid #2563eb;
        outline-offset: 2px;
    }
    .home-tag-chip-label {
        line-height: 1;
    }
    .home-tag-chip-count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 22px;
        height: 22px;
        padding: 0 6px;
        border-radius: 999px;
        background: #dbeafe;
        color: #1d4ed8;
        font-size: 11px;
        font-weight: 700;
        line-height: 1;
    }
    .home-recommendations-empty {
        font-size: 14px;
        color: #64748b;
    }
    .home-loading-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(255, 255, 255, 0.72);
        z-index: 20;
        pointer-events: auto;
    }
    .home-loading-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        background: rgba(255, 255, 255, 0.95);
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        box-shadow: 0 12px 28px rgba(15, 23, 42, 0.12);
        padding: 16px 20px;
    }
    .home-loading-text {
        font-size: 13px;
        font-weight: 600;
        color: #475569;
        letter-spacing: 0.2px;
    }
    .home-cta-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
        margin-top: 4px;
    }
    @media (min-width: 900px) {
        .home-cta-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
        }
    }
    .home-cta-grid.home-cta-grid-quad {
        grid-template-columns: 1fr;
    }
    @media (min-width: 680px) {
        .home-cta-grid.home-cta-grid-quad {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }
    .home-cta-card {
        position: relative;
        overflow: hidden;
        display: flex;
        align-items: center;
        gap: 13px;
        width: 100%;
        border-radius: 14px;
        border: 1px solid #dbe4f0;
        padding: 13px;
        text-align: left;
        transition: transform 0.18s ease, box-shadow 0.18s ease;
        background: #ffffff;
    }
    .home-cta-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 10px 22px rgba(15, 23, 42, 0.1);
    }
    .home-cta-card:focus-visible {
        outline: 2px solid #2563eb;
        outline-offset: 2px;
    }
    .home-cta-backdrop {
        position: absolute;
        inset: 0;
        opacity: 1;
    }
    .home-cta-search .home-cta-backdrop {
        background:
            radial-gradient(circle at 82% 24%, rgba(37, 99, 235, 0.15), transparent 54%),
            linear-gradient(140deg, #f8fbff 0%, #eef6ff 48%, #f4f9ff 100%);
    }
    .home-cta-curate .home-cta-backdrop {
        background:
            radial-gradient(circle at 78% 24%, rgba(8, 145, 178, 0.16), transparent 52%),
            linear-gradient(140deg, #f5fcfb 0%, #ecfbf8 54%, #f4fcff 100%);
    }
    .home-cta-upload .home-cta-backdrop {
        background:
            radial-gradient(circle at 80% 24%, rgba(245, 158, 11, 0.2), transparent 54%),
            linear-gradient(140deg, #fff9ef 0%, #fff5de 52%, #fff8e8 100%);
    }
    .home-cta-admin .home-cta-backdrop {
        background:
            radial-gradient(circle at 80% 24%, rgba(99, 102, 241, 0.18), transparent 54%),
            linear-gradient(140deg, #f4f4ff 0%, #eceefe 52%, #f6f7ff 100%);
    }
    .home-cta-keywords .home-cta-backdrop {
        background:
            radial-gradient(circle at 80% 24%, rgba(236, 72, 153, 0.17), transparent 54%),
            linear-gradient(140deg, #fff5fb 0%, #ffecf7 52%, #fff7fc 100%);
    }
    .home-cta-assets .home-cta-backdrop {
        background:
            radial-gradient(circle at 80% 24%, rgba(14, 116, 144, 0.16), transparent 54%),
            linear-gradient(140deg, #f0fcff 0%, #e7f8ff 52%, #f4fbff 100%);
    }
    .home-cta-glyph {
        position: absolute;
        right: 10px;
        top: 8px;
        z-index: 1;
        color: rgba(148, 163, 184, 0.2);
        pointer-events: none;
        transform: rotate(-7deg);
    }
    .home-cta-glyph-char {
        font-size: 28px;
        font-weight: 800;
        line-height: 1;
        display: inline-block;
    }
    .home-cta-search .home-cta-glyph {
        color: rgba(59, 130, 246, 0.22);
    }
    .home-cta-curate .home-cta-glyph {
        color: rgba(20, 184, 166, 0.22);
    }
    .home-cta-upload .home-cta-glyph {
        color: rgba(245, 158, 11, 0.24);
    }
    .home-cta-admin .home-cta-glyph {
        color: rgba(99, 102, 241, 0.22);
    }
    .home-cta-keywords .home-cta-glyph {
        color: rgba(236, 72, 153, 0.24);
    }
    .home-cta-assets .home-cta-glyph {
        color: rgba(14, 116, 144, 0.24);
    }
    .home-cta-icon-wrap {
        position: relative;
        z-index: 1;
        width: 46px;
        height: 46px;
        border-radius: 12px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        color: #1d4ed8;
        border: 1px solid rgba(37, 99, 235, 0.22);
        background: rgba(255, 255, 255, 0.95);
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.14);
    }
    .home-cta-icon-wrap svg {
        width: 21px;
        height: 21px;
        display: block;
    }
    .home-cta-curate .home-cta-icon-wrap {
        color: #0f766e;
        border-color: rgba(15, 118, 110, 0.24);
        box-shadow: 0 4px 12px rgba(15, 118, 110, 0.14);
    }
    .home-cta-upload .home-cta-icon-wrap {
        color: #b45309;
        border-color: rgba(180, 83, 9, 0.24);
        box-shadow: 0 4px 12px rgba(180, 83, 9, 0.14);
    }
    .home-cta-admin .home-cta-icon-wrap {
        color: #4338ca;
        border-color: rgba(67, 56, 202, 0.24);
        box-shadow: 0 4px 12px rgba(67, 56, 202, 0.14);
    }
    .home-cta-keywords .home-cta-icon-wrap {
        color: #be185d;
        border-color: rgba(190, 24, 93, 0.24);
        box-shadow: 0 4px 12px rgba(190, 24, 93, 0.14);
    }
    .home-cta-assets .home-cta-icon-wrap {
        color: #0e7490;
        border-color: rgba(14, 116, 144, 0.24);
        box-shadow: 0 4px 12px rgba(14, 116, 144, 0.14);
    }
    .home-cta-content {
        position: relative;
        z-index: 1;
        flex: 1;
        min-width: 0;
    }
    .home-cta-title {
        font-size: 1.05rem;
        font-weight: 700;
        color: #0f172a;
        line-height: 1.1;
    }
    .home-cta-subtitle {
        margin-top: 4px;
        font-size: 0.82rem;
        color: #475569;
        line-height: 1.2;
    }
    .home-cta-metrics {
        margin-top: 6px;
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }
    .home-cta-metric {
        display: inline-flex;
        align-items: baseline;
        gap: 4px;
        padding: 2px 6px;
        border-radius: 999px;
        border: 1px solid rgba(148, 163, 184, 0.32);
        background: rgba(255, 255, 255, 0.88);
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
    }
    .home-cta-metric-label {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.01em;
        color: #475569;
        text-transform: uppercase;
    }
    .home-cta-metric-value {
        font-size: 11px;
        font-weight: 800;
        color: #0f172a;
        letter-spacing: 0.01em;
    }
    .home-cta-arrow {
        position: relative;
        z-index: 1;
        width: 33px;
        height: 33px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: #1e40af;
        background: rgba(255, 255, 255, 0.86);
        border: 1px solid rgba(30, 64, 175, 0.2);
        font-size: 13px;
    }
    .home-cta-arrow-char {
        font-weight: 700;
        line-height: 1;
    }
    .home-cta-curate .home-cta-arrow {
        color: #0f766e;
        border-color: rgba(15, 118, 110, 0.25);
    }
    .home-cta-upload .home-cta-arrow {
        color: #b45309;
        border-color: rgba(180, 83, 9, 0.28);
    }
    .home-cta-admin .home-cta-arrow {
        color: #4338ca;
        border-color: rgba(67, 56, 202, 0.28);
    }
    .home-cta-keywords .home-cta-arrow {
        color: #be185d;
        border-color: rgba(190, 24, 93, 0.28);
    }
    .home-cta-assets .home-cta-arrow {
        color: #0e7490;
        border-color: rgba(14, 116, 144, 0.28);
    }
    .home-loading-bar {
        width: 100%;
        height: 6px;
        background: #e5e7eb;
        border-radius: 9999px;
        overflow: hidden;
        position: relative;
        margin: 12px 0 20px;
    }
    .home-loading-bar::after {
        content: "";
        position: absolute;
        left: 0;
        top: 0;
        height: 100%;
        width: 0%;
        background: linear-gradient(90deg, #60a5fa, #2563eb);
        animation: home-progress 25s linear infinite;
    }
    @keyframes home-progress {
        from { width: 0%; }
        to { width: 100%; }
    }
    .home-insights-large .prop-section-title {
        font-size: 12px;
        padding: 10px 12px;
    }
    .home-insights-large .prop-row {
        font-size: 14px;
        padding: 9px 12px;
    }
    .home-insights-large .prop-key {
        font-size: 15px;
    }
    .home-insights-large .prop-value {
        font-size: 15px;
    }
    .home-insights-large .prop-content {
        padding: 12px;
    }
    .home-insights-large .prop-content .text-[10px] {
        font-size: 11px;
    }
    .home-insights-large .prop-content .text-xs {
        font-size: 13px;
    }
    .curate-subtabs {
        display: inline-flex;
        gap: 6px;
        padding: 4px;
        border-radius: 999px;
        background: #f3f4f6;
        border: 1px solid #e5e7eb;
    }
    .curate-subtab {
        border: none;
        background: transparent;
        color: #6b7280;
        font-size: 12px;
        font-weight: 600;
        padding: 6px 12px;
        border-radius: 999px;
        cursor: pointer;
    }
    .curate-subtab.active {
        background: #2563eb;
        color: #ffffff;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
    }
    .admin-subtabs {
        display: inline-flex;
        gap: 6px;
        padding: 4px;
        border-radius: 999px;
        background: #f3f4f6;
        border: 1px solid #e5e7eb;
        margin-bottom: 16px;
    }
    .admin-subtab {
        border: none;
        background: transparent;
        color: #6b7280;
        font-size: 12px;
        font-weight: 600;
        padding: 6px 12px;
        border-radius: 999px;
        cursor: pointer;
    }
    .admin-subtab.active {
        background: #2563eb;
        color: #ffffff;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
    }
    .system-subtabs {
        display: inline-flex;
        gap: 6px;
        padding: 4px;
        border-radius: 999px;
        background: #f3f4f6;
        border: 1px solid #e5e7eb;
        margin-bottom: 16px;
    }
    .system-subtab {
        border: none;
        background: transparent;
        color: #6b7280;
        font-size: 12px;
        font-weight: 600;
        padding: 6px 12px;
        border-radius: 999px;
        cursor: pointer;
    }
    .system-subtab.active {
        background: #2563eb;
        color: #ffffff;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
    }
    .curate-audit-toggle {
        display: inline-flex;
        gap: 6px;
        padding: 4px;
        border-radius: 10px;
        background: #f8fafc;
        border: 1px solid #e5e7eb;
    }
    .curate-audit-toggle button {
        border: none;
        background: transparent;
        color: #6b7280;
        font-size: 12px;
        font-weight: 600;
        padding: 6px 12px;
        border-radius: 8px;
        cursor: pointer;
    }
    .curate-audit-toggle button.active {
        background: #111827;
        color: #ffffff;
    }
    .curate-ai-toggle {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 4px;
        border-radius: 10px;
        background: #f8fafc;
        border: 1px solid #e5e7eb;
    }
    .curate-layout {
        display: grid;
        grid-template-columns: 1fr;
        gap: 16px;
        min-height: 520px;
    }
    .curate-header-grid {
        display: grid;
        grid-template-columns: 2fr 1fr;
        gap: 16px;
        width: 100%;
        align-items: end;
    }
    .curate-header-right {
        display: flex;
        align-items: end;
        gap: 12px;
        justify-content: flex-start;
        width: 100%;
    }
    .curate-header-layout {
        display: grid;
        grid-template-columns: 2fr 1fr;
        gap: 16px;
        width: 100%;
    }
    .search-header-layout {
        grid-template-columns: 1fr;
    }
    .curate-control-grid {
        display: grid;
        grid-template-columns: minmax(200px, 1fr) minmax(320px, 2fr);
        gap: 16px;
        align-items: end;
        width: 100%;
    }
    .curate-control-row {
        display: flex;
        gap: 16px;
        align-items: center;
    }
    .curate-control-row select {
        flex: 1;
        min-width: 0;
    }
    .curate-control-row > button {
        margin-left: auto;
    }
    @media (min-width: 1024px) {
        .curate-layout {
            grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
        }
        .search-layout {
            grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
        }
    }
    .curate-pane {
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        background: #ffffff;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        min-height: 520px;
        min-width: 0;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        position: relative;
    }
    .curate-pane.utility-targets {
        position: sticky;
        top: 12px;
        align-self: start;
        max-height: calc(100vh - 160px);
    }
    .curate-pane-header {
        padding: 10px 12px;
        border-bottom: 1px solid #e5e7eb;
        font-size: 12px;
        font-weight: 600;
        color: #6b7280;
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }
    .right-panel-header {
        position: sticky;
        top: 0;
        z-index: 2;
        background: #ffffff;
    }
    .curate-pane-header-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }
    .curate-pane-header-actions {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .curate-pane-action {
        border: 1px solid #2563eb;
        background: #2563eb;
        color: #ffffff;
        font-size: 11px;
        padding: 4px 8px;
        border-radius: 6px;
        text-transform: none;
        letter-spacing: 0;
    }
    .curate-pane-action.secondary {
        background: #ffffff;
        color: #2563eb;
    }
    .curate-pane-action:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }
    .curate-pane-body {
        padding: 4px;
        flex: 1;
        overflow: auto;
        position: relative;
    }
    .list-target-card {
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 12px;
        min-height: 140px;
        background-color: #f9fafb;
        transition: border-color 0.2s ease, background-color 0.2s ease;
    }
    .list-target-card--active {
        border-color: #3b82f6;
        background-color: #eff6ff;
    }
    .list-target-tab {
        border: 1px solid #e5e7eb;
        border-radius: 999px;
        padding: 2px 10px;
        font-size: 11px;
        font-weight: 600;
        color: #6b7280;
        background: #ffffff;
        transition: border-color 0.2s ease, color 0.2s ease, background-color 0.2s ease;
    }
    .list-target-header {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .list-target-select {
        flex: 1;
        min-width: 0;
    }
    .list-target-tab.active {
        border-color: #2563eb;
        color: #2563eb;
        background: #eff6ff;
    }
    .list-target-tab:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    .list-target-drop {
        margin-top: 10px;
        padding: 10px 4px 4px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        text-align: center;
        color: #6b7280;
    }
    .list-target-drop-count {
        font-size: 26px;
        font-weight: 700;
        color: #111827;
        line-height: 1;
    }
    .list-target-drop-label {
        font-size: 13px;
        font-weight: 500;
    }
    .list-target-drop-sub {
        font-size: 12px;
        color: #9ca3af;
        font-weight: 600;
    }
    .curate-grid {
        display: grid;
        gap: 2px;
        grid-template-columns: repeat(auto-fill, minmax(var(--curate-thumb-size, 110px), 1fr));
        user-select: none;
    }
    .curate-thumb {
        width: 100%;
        aspect-ratio: 1 / 1;
        object-fit: cover;
        border-radius: 8px;
        border: 1px solid #e5e7eb;
        background: #f3f4f6;
        cursor: grab;
    }
    .curate-thumb-wrapper {
        position: relative;
    }
    .curate-thumb-rating-widget {
        position: absolute;
        top: 6px;
        left: 6px;
        right: 6px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        opacity: 0;
        transform: translateY(-2px);
        transition: opacity 0.15s ease, transform 0.15s ease;
        pointer-events: none;
        z-index: 12;
    }
    .curate-thumb-rating-static {
        position: absolute;
        top: 6px;
        right: 6px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: rgba(255, 255, 255, 0.9);
        color: #111827;
        padding: 4px 6px;
        border-radius: 999px;
        box-shadow: 0 4px 12px rgba(17, 24, 39, 0.18);
        z-index: 10;
        pointer-events: none;
    }
    .curate-thumb-rating-static.trash-offset {
        right: 6px;
    }
    .curate-thumb-rating-static span {
        font-size: 12px;
        line-height: 1;
    }
    .curate-thumb-rating-widget .curate-thumb-burst {
        position: absolute;
        top: -6px;
        right: -6px;
        width: 30px;
        height: 30px;
        pointer-events: none;
        animation: curate-burst 0.7s ease-out forwards;
    }
    .curate-thumb-rating-widget .curate-thumb-burst::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(250, 204, 21, 0.95) 0 30%, rgba(250, 204, 21, 0) 65%);
        box-shadow: 0 0 14px rgba(250, 204, 21, 0.8);
    }
    .curate-thumb-rating-widget .curate-thumb-burst::after {
        content: '';
        position: absolute;
        inset: -4px;
        border-radius: 50%;
        border: 2px solid rgba(250, 204, 21, 0.8);
        opacity: 0.9;
    }
    .curate-thumb-rating-widget button {
        font-size: 14px;
        line-height: 1;
    }
    .curate-thumb-trash {
        background: rgba(255, 255, 255, 0.98);
        color: #111827;
        border-radius: 999px;
        padding: 6px 8px;
        box-shadow: 0 6px 16px rgba(17, 24, 39, 0.22);
    }
    .curate-thumb-stars {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: rgba(255, 255, 255, 0.98);
        color: #111827;
        border-radius: 999px;
        padding: 6px 8px;
        box-shadow: 0 6px 16px rgba(17, 24, 39, 0.22);
    }
    .curate-thumb-wrapper:hover .curate-thumb-rating-widget {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
    }
    @keyframes curate-burst {
        0% {
            transform: scale(0.35);
            opacity: 0.1;
        }
        45% {
            transform: scale(1.1);
            opacity: 1;
        }
        100% {
            transform: scale(1.35);
            opacity: 0;
        }
    }
    .curate-thumb-date {
        position: absolute;
        left: 6px;
        right: 6px;
        bottom: 1px;
        font-size: 10px;
        color: #f9fafb;
        background: rgba(17, 24, 39, 0.65);
        padding: 2px 6px;
        border-radius: 6px;
        text-align: center;
        pointer-events: none;
    }
    .curate-thumb-icon {
        margin-right: 4px;
        font-size: 11px;
    }
    .curate-thumb-id {
        margin-right: 6px;
        font-weight: 600;
        color: #e5e7eb;
    }
    .curate-thumb-date.processed {
        bottom: 23px;
    }
    .curate-thumb-rating {
        position: absolute;
        left: 6px;
        right: 6px;
        bottom: 19px;
        font-size: 10px;
        color: #f9fafb;
        background: rgba(17, 24, 39, 0.65);
        padding: 2px 6px;
        border-radius: 6px;
        text-align: center;
        display: block;
        pointer-events: none;
    }
    .curate-thumb-variant-count {
        position: absolute;
        left: 6px;
        top: 50%;
        transform: translateY(-50%);
        color: #ffffff;
        background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
        border: 1px solid rgba(255, 255, 255, 0.45);
        border-radius: 999px;
        padding: 1px 5px;
        font-weight: 700;
        font-size: 10px;
        line-height: 1.1;
        text-transform: uppercase;
        flex: 0 0 auto;
        letter-spacing: 0.01em;
        box-shadow: 0 0 0 1px rgba(127, 29, 29, 0.35), 0 1px 3px rgba(0, 0, 0, 0.35);
    }
    .curate-thumb-variant-bar {
        position: absolute;
        left: 3px;
        bottom: 8px;
        width: 3px;
        height: 42px;
        border-radius: 999px;
        background: linear-gradient(
            180deg,
            rgb(254, 202, 202) 0%,
            rgb(248, 113, 113) 35%,
            rgb(239, 68, 68) 70%,
            rgb(220, 38, 38) 100%
        );
        box-shadow: 0 0 0 1px rgb(220, 38, 38);
        pointer-events: none;
        z-index: 8;
    }
    .curate-thumb-rating-label {
        display: block;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: center;
        padding: 0 6px;
    }
    .curate-thumb-rating.has-variant .curate-thumb-rating-label {
        padding-left: 40px;
        padding-right: 40px;
    }
    .curate-thumb-ml-score {
        position: absolute;
        left: 6px;
        right: 6px;
        bottom: 37px;
        font-size: 10px;
        color: #f9fafb;
        background: rgba(17, 24, 39, 0.65);
        padding: 2px 6px;
        border-radius: 6px;
        text-align: center;
        pointer-events: none;
    }
    .curate-thumb-line {
        display: block;
        white-space: normal;
        overflow: visible;
        word-break: break-word;
    }
    .curate-thumb.selected {
        outline: 3px solid #2563eb;
        outline-offset: -2px;
    }
    .curate-thumb.selected.flash {
        animation: curate-select-flash 0.6s ease;
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.35);
    }
    @keyframes curate-select-flash {
        0% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.6); }
        40% { box-shadow: 0 0 0 6px rgba(37, 99, 235, 0.35); }
        100% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0); }
    }
    .curate-drop {
        border: 2px dashed #cbd5f5;
        border-radius: 12px;
        padding: 12px;
        color: #9ca3af;
        font-size: 14px;
        text-align: center;
        margin: 6px;
        flex: 1;
        display: flex;
        align-items: flex-start;
        justify-content: flex-start;
    }
    .curate-drop.active {
        border-color: #2563eb;
        color: #1d4ed8;
        background: #eff6ff;
    }
    .curate-tags-panel {
        display: flex;
        flex-direction: column;
        gap: 10px;
        height: 100%;
        padding: 8px;
    }
    .curate-tags-search {
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 6px 8px;
        font-size: 12px;
        color: #374151;
    }
    .curate-tags-list {
        flex: 1;
        overflow: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 0;
    }
    .curate-tag-category {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .curate-tag-category-title {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #6b7280;
    }
    .curate-tag-options {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .curate-tag-option {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        font-size: 12px;
        color: #374151;
    }
    .curate-tag-option-label {
        font-weight: 500;
        color: #374151;
    }
    .curate-tag-choice {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        font-size: 11px;
        color: #6b7280;
    }
    .curate-tag-choice label {
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }
    .curate-utility-panel {
        position: sticky;
        top: 12px;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .curate-utility-box {
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 12px;
        background: #f9fafb;
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-height: 140px;
        position: relative;
    }
    .curate-utility-box.active {
        border-color: #2563eb;
        box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
        background: #eff6ff;
    }
    .curate-utility-controls {
        display: grid;
        grid-template-columns: 1fr auto auto;
        gap: 8px;
        align-items: center;
    }
    .curate-utility-controls.curate-utility-controls--tags {
        grid-template-columns: 1fr auto;
    }
    .curate-utility-controls.rating-target-controls {
        grid-template-columns: 1fr;
    }
    .curate-utility-controls select {
        width: 100%;
        padding: 6px 8px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        font-size: 0.75rem;
        background: #fff;
    }
    .curate-utility-controls select.curate-utility-select.selected {
        background: #fef3c7;
        border-color: #fde68a;
    }
    .curate-utility-count {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 2rem;
        font-weight: 600;
        color: #1f2937;
    }
    .curate-utility-drop-hint {
        text-align: center;
        font-size: 0.7rem;
        color: #6b7280;
    }
    .curate-utility-add {
        border: 1px dashed #cbd5f5;
        border-radius: 12px;
        padding: 10px;
        text-align: center;
        font-size: 1.25rem;
        font-weight: 600;
        color: #2563eb;
        background: #f8fbff;
        cursor: pointer;
    }
    .curate-utility-add:hover {
        background: #eef5ff;
    }
    .list-target-add {
        width: 100%;
        border-style: dashed;
        border-color: #c7d2fe;
        background: #f8fafc;
        color: #2563eb;
        font-size: 24px;
        line-height: 1;
        height: 56px;
    }
    .curate-utility-remove {
        position: absolute;
        top: 12px;
        right: 12px;
        width: 22px;
        height: 22px;
        border-radius: 9999px;
        border: 1px solid #e5e7eb;
        background: #fff;
        color: #6b7280;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        line-height: 1;
        cursor: pointer;
    }
    .curate-utility-remove:hover {
        color: #dc2626;
        border-color: #fecaca;
        background: #fef2f2;
    }
    .curate-rating-container {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 8px;
    }
    .curate-rating-checkbox {
        display: flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
    }
    .curate-rating-checkbox input[type="checkbox"] {
        margin: 0;
        cursor: pointer;
    }
    .curate-rating-checkbox label {
        margin: 0;
        font-size: 0.75rem;
        font-weight: 600;
        color: #1f2937;
        cursor: pointer;
        user-select: none;
    }
    .curate-rating-drop-zone {
        width: 100%;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 12px;
        background: #f9fafb;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        cursor: pointer;
        transition: all 0.2s ease;
        pointer-events: auto;
        user-select: none;
        margin-top: 8px;
        box-sizing: border-box;
        min-height: 140px;
        gap: 10px;
    }
    .curate-rating-drop-zone.active {
        border-color: #2563eb;
        box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
        background: #eff6ff;
    }
    .curate-rating-drop-zone-star {
        font-size: 36px;
        color: #fbbf24;
        margin-top: 4px;
    }
    .curate-rating-drop-zone-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
    }
    .curate-rating-drop-zone:hover {
        border-color: #2563eb;
        background: #f0f9ff;
        box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
    }
    .curate-rating-drop-zone.active {
        border-color: #2563eb;
        background: #dbeafe;
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.3);
        border-style: solid;
    }
    .curate-rating-drop-hint {
        font-size: 0.875rem;
        color: #6b7280;
        text-align: center;
        line-height: 1.4;
    }
    .curate-rating-count {
        font-size: 0.75rem;
        color: #6b7280;
        margin-top: 4px;
    }
    .curate-rating-modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    }
    .curate-rating-modal-content {
        background: white;
        border-radius: 12px;
        padding: 32px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
        text-align: center;
        max-width: 400px;
    }
    .curate-rating-modal-title {
        font-size: 1.125rem;
        font-weight: 600;
        color: #1f2937;
        margin-bottom: 8px;
    }
    .curate-rating-modal-subtitle {
        font-size: 0.875rem;
        color: #6b7280;
        margin-bottom: 24px;
    }
    .curate-rating-modal-options {
        display: flex;
        gap: 16px;
        justify-content: center;
    }
    .curate-rating-option {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        padding: 12px;
        border-radius: 8px;
        border: 2px solid #e5e7eb;
        background: #f9fafb;
        transition: all 0.2s ease;
        flex: 1;
        max-width: 80px;
    }
    .curate-rating-option:hover {
        border-color: #2563eb;
        background: #eff6ff;
        box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
    }
    .curate-rating-option-icon {
        font-size: 2rem;
        line-height: 1;
    }
    .curate-rating-option-label {
        font-size: 0.75rem;
        color: #6b7280;
        font-weight: 500;
    }
    .curate-rating-modal-buttons {
        display: flex;
        gap: 12px;
        justify-content: center;
        margin-top: 24px;
    }
    .curate-rating-modal-cancel {
        padding: 8px 16px;
        border: 1px solid #d1d5db;
        background: #f3f4f6;
        color: #374151;
        border-radius: 6px;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
    }
    .curate-rating-modal-cancel:hover {
        background: #e5e7eb;
        border-color: #9ca3af;
    }
    .curate-tags-actions {
        display: flex;
        gap: 8px;
        align-items: center;
        justify-content: flex-end;
    }
    .curate-tags-status {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: #6b7280;
        margin-right: auto;
    }
    .curate-spinner {
        width: 12px;
        height: 12px;
        border-radius: 9999px;
        border: 2px solid rgba(37, 99, 235, 0.3);
        border-top-color: #2563eb;
        animation: curate-spin 0.8s linear infinite;
    }
    .curate-spinner.large {
        width: 28px;
        height: 28px;
        border-width: 3px;
    }
    .curate-spinner.xlarge {
        width: 52px;
        height: 52px;
        border-width: 4px;
    }
    .curate-loading-overlay {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(255, 255, 255, 0.55);
        z-index: 1000;
        pointer-events: none;
    }
    .curate-stats-overlay {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(148, 163, 184, 0.25);
        z-index: 1100;
    }
    .curate-stats-overlay .curate-spinner {
        border-color: rgba(148, 163, 184, 0.4);
        border-top-color: #475569;
    }
    .curate-stats-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        background: rgba(255, 255, 255, 0.92);
        border-radius: 14px;
        padding: 18px 26px;
        box-shadow: 0 12px 28px rgba(15, 23, 42, 0.12);
    }
    .curate-stats-text {
        font-size: 13px;
        font-weight: 600;
        color: #475569;
        letter-spacing: 0.2px;
    }
    @keyframes curate-spin {
        to {
            transform: rotate(360deg);
        }
    }
    .curate-tags-apply {
        border: 1px solid #2563eb;
        background: #2563eb;
        color: #ffffff;
        font-size: 12px;
        padding: 6px 10px;
        border-radius: 8px;
    }
    .curate-tags-apply:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }
    .curate-tags-cancel {
        border: 1px solid #d1d5db;
        background: #ffffff;
        color: #6b7280;
        font-size: 12px;
        padding: 6px 10px;
        border-radius: 8px;
    }
    .curate-process-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .curate-process-item {
        display: flex;
        gap: 10px;
        padding: 6px;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        background: #ffffff;
        align-items: flex-start;
    }
    .curate-process-thumb {
        width: var(--curate-thumb-size, 110px);
        height: var(--curate-thumb-size, 110px);
        object-fit: cover;
        border-radius: 8px;
        border: 1px solid #e5e7eb;
        flex-shrink: 0;
    }
    .curate-process-tags {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 12px;
        color: #374151;
        line-height: 1.4;
        word-break: break-word;
    }
    .curate-process-tag-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .curate-process-tag-label {
        font-weight: 600;
        color: #6b7280;
    }
    .curate-process-tag-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .curate-process-tag-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: #f3f4f6;
        color: #374151;
        padding: 4px 6px;
        border-radius: 8px;
        font-size: 12px;
    }
    .curate-process-tag-remove {
        color: #dc2626;
        font-size: 14px;
        line-height: 1;
    }
    .curate-process-tag-remove:hover {
        color: #b91c1c;
    }
    .search-folder-input {
        min-width: 18rem;
        width: 100%;
    }
    .search-folder-selected {
        word-break: break-all;
    }
    .search-folder-field {
        position: relative;
        width: 100%;
        max-width: none;
    }
    .search-folder-menu {
        position: absolute;
        top: calc(100% + 6px);
        left: 0;
        right: 0;
        z-index: 40;
        max-height: 320px;
        overflow-y: auto;
        background: #111827;
        color: #f9fafb;
        border-radius: 12px;
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.25);
        padding: 6px;
    }
    .search-folder-option {
        padding: 8px 10px;
        border-radius: 8px;
        cursor: pointer;
        line-height: 1.3;
        word-break: break-all;
    }
    .search-folder-option:hover {
        background: rgba(255, 255, 255, 0.08);
    }
    .search-layout {
        display: grid;
        grid-template-columns: 1fr;
    }
    @media (min-width: 1024px) {
        .search-layout {
            grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
        }
    }
    .search-saved-pane {
        min-width: 200px;
    }
    .search-accordion .curate-control-grid {
        grid-template-columns: 1fr;
    }
    .search-saved-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
        gap: 8px;
    }
    .search-saved-item {
        position: relative;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        background: #fff;
        overflow: hidden;
        cursor: grab;
    }
    .search-saved-item:active {
        cursor: grabbing;
    }
    .search-saved-thumb {
        width: 100%;
        height: 90px;
        object-fit: cover;
        display: block;
    }
    .search-saved-meta {
        font-size: 10px;
        color: #6b7280;
        padding: 4px 6px;
        display: flex;
        justify-content: space-between;
        gap: 6px;
    }
    .search-saved-remove {
        position: absolute;
        top: 6px;
        right: 6px;
        width: 20px;
        height: 20px;
        border-radius: 9999px;
        border: 1px solid #e5e7eb;
        background: rgba(255, 255, 255, 0.9);
        color: #6b7280;
        font-size: 12px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
    }
    .search-saved-remove:hover {
        color: #dc2626;
        border-color: #fecaca;
        background: #fef2f2;
    }
    .search-saved-pane.drag-active .curate-pane-body {
        background: #eff6ff;
        box-shadow: inset 0 0 0 2px rgba(37, 99, 235, 0.25);
        border-radius: 12px;
    }
    .search-list-controls {
        display: flex;
        flex-direction: column;
        gap: 8px;
        align-items: stretch;
        width: 100%;
    }
    .search-list-row {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
    }
    .search-list-label {
        font-size: 12px;
        color: #6b7280;
        white-space: nowrap;
        min-width: 92px;
    }
    .search-list-controls input,
    .search-list-controls select {
        padding: 6px 8px;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        font-size: 12px;
        color: #374151;
        background: #fff;
    }
    .search-list-actions {
        display: flex;
        gap: 8px;
        align-items: center;
    }
`;
