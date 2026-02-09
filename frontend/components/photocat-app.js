import { LitElement, html, css } from 'lit';
import './app-header.js';
import './tag-histogram.js';
import './upload-modal.js';
import './tab-container.js'; // Import the new tab container
import './list-editor.js'; // Import the new list editor
import './permatag-editor.js';
import './tagging-admin.js';
import './ml-training.js';
import './image-editor.js';
import './cli-commands.js';
import './person-manager.js';
import './people-tagger.js';
import './shared/widgets/filter-chips.js';
import './shared/widgets/keyword-dropdown.js';

import ImageFilterPanel from './shared/state/image-filter-panel.js';
import { CurateHomeStateController } from './state/curate-home-state.js';
import { CurateAuditStateController } from './state/curate-audit-state.js';
import { CurateExploreStateController } from './state/curate-explore-state.js';
import { RatingModalStateController } from './state/rating-modal-state.js';
import { SearchStateController } from './state/search-state.js';
import { AppShellStateController } from './state/app-shell-state.js';
import { AppDataStateController } from './state/app-data-state.js';
import { tailwind } from './tailwind-lit.js';
import { subscribeQueue, retryFailedCommand } from '../services/command-queue.js';
import { createSelectionHandlers } from './shared/selection-handlers.js';
import { createPaginationHandlers } from './shared/pagination-controls.js';
import { createRatingDragHandlers } from './shared/rating-drag-handlers.js';
import { createHotspotHandlers, parseUtilityKeywordValue } from './shared/hotspot-controls.js';
import {
  buildCurateFilterObject,
  getCurateAuditFetchKey,
  getCurateHomeFetchKey,
} from './shared/curate-filters.js';
import { scheduleStatsRefresh, shouldAutoRefreshCurateStats } from './shared/curate-stats.js';
import {
  formatCurateDate,
  formatQueueItem,
} from './shared/formatting.js';
import './home-tab.js';
import './home-chips-tab.js';
import './home-insights-tab.js';
import './lab-tab.js';
import './curate-home-tab.js';
import './curate-explore-tab.js';
import './curate-browse-folder-tab.js';
import './curate-audit-tab.js';
import './search-tab.js';
import { renderCurateTabContent } from './render/curate-tab-content.js';
import { renderHomeTabContent, renderSearchTabContent } from './render/home-search-tab-content.js';
import { renderAuxTabContent, renderGlobalOverlays, renderRatingModal } from './render/aux-tab-content.js';

class PhotoCatApp extends LitElement {
  static styles = [tailwind, css`
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
        bottom: 6px;
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
        bottom: 24px;
    }
    .curate-thumb-rating {
        position: absolute;
        left: 6px;
        right: 6px;
        bottom: 22px;
        font-size: 10px;
        color: #f9fafb;
        background: rgba(17, 24, 39, 0.65);
        padding: 2px 6px;
        border-radius: 6px;
        text-align: center;
        pointer-events: none;
    }
    .curate-thumb-ml-score {
        position: absolute;
        left: 6px;
        right: 6px;
        bottom: 36px;
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
  `];

  static properties = {
      tenant: { type: String },
      showUploadModal: { type: Boolean },
      activeTab: { type: String }, // New property for active tab
      activeAdminSubTab: { type: String }, // Subtab for admin section (people or tagging)
      activeSystemSubTab: { type: String }, // Subtab for system section (pipeline or cli)
      keywords: { type: Array },
      queueState: { type: Object },
      showQueuePanel: { type: Boolean },
      imageStats: { type: Object },
      mlTrainingStats: { type: Object },
      tagStatsBySource: { type: Object },
      curateFilters: { type: Object },
      curateLimit: { type: Number },
      curateOrderBy: { type: String },
      curateOrderDirection: { type: String },
      curateHideDeleted: { type: Boolean },
      curateMinRating: { type: [Number, String] },
      curateKeywordFilters: { type: Object },
      curateKeywordOperators: { type: Object },
      curateCategoryFilterOperator: { type: String },
      curateDropboxPathPrefix: { type: String },
      curateListId: { type: [Number, String] },
      curateListExcludeId: { type: [Number, String] },
      curateImages: { type: Array },
      curatePageOffset: { type: Number },
      curateTotal: { type: Number },
      curateLoading: { type: Boolean },
      curateDragSelection: { type: Array },
      curateDragSelecting: { type: Boolean },
      curateDragStartIndex: { type: Number },
      curateDragEndIndex: { type: Number },
      curateThumbSize: { type: Number },
      curateEditorImage: { type: Object },
      curateEditorOpen: { type: Boolean },
      curateEditorImageSet: { type: Array },
      curateEditorImageIndex: { type: Number },
      curateSubTab: { type: String, attribute: false },
      curateAuditMode: { type: String },
      curateAuditKeyword: { type: String },
      curateAuditCategory: { type: String },
      curateAuditImages: { type: Array },
      curateAuditSelection: { type: Array },
      curateAuditDragTarget: { type: String },
      curateAuditDragSelection: { type: Array },
      curateAuditDragSelecting: { type: Boolean },
      curateAuditDragStartIndex: { type: Number },
      curateAuditDragEndIndex: { type: Number },
      curateAuditLimit: { type: Number },
      curateAuditOffset: { type: Number },
      curateAuditTotal: { type: Number },
      curateAuditLoading: { type: Boolean },
      curateAuditLoadAll: { type: Boolean },
      curateAuditPageOffset: { type: Number },
      curateAuditAiEnabled: { type: Boolean },
      curateAuditAiModel: { type: String },
      curateAuditOrderBy: { type: String },
      curateAuditOrderDirection: { type: String },
      curateAuditHideDeleted: { type: Boolean },
      curateAuditMinRating: { type: [Number, String] },
      curateAuditNoPositivePermatags: { type: Boolean },
      curateAuditDropboxPathPrefix: { type: String },
      curateHomeRefreshing: { type: Boolean },
      curateStatsLoading: { type: Boolean },
      homeSubTab: { type: String },
      curateAdvancedOpen: { type: Boolean },
      curateNoPositivePermatags: { type: Boolean },
      activeCurateTagSource: { type: String },
      curateCategoryCards: { type: Array },
      curateAuditTargets: { type: Array },
      curateExploreTargets: { type: Array },
      curateExploreRatingEnabled: { type: Boolean },
      curateAuditRatingEnabled: { type: Boolean },
      searchImages: { type: Array },
      searchTotal: { type: Number },
      currentUser: { type: Object },
  }

  constructor() {
      super();
      this.tenant = 'bcg'; // Default tenant
      this.showUploadModal = false;
      this.activeTab = 'home'; // Default to home tab
      this.homeSubTab = 'overview';
      this.activeAdminSubTab = 'tagging'; // Default admin subtab
      this.activeSystemSubTab = 'ml-training'; // Default system subtab

      // Initialize filter state containers for each tab
      this.searchFilterPanel = new ImageFilterPanel('search');
      this.searchFilterPanel.setTenant(this.tenant);
      this.curateHomeFilterPanel = new ImageFilterPanel('curate-home');
      this.curateHomeFilterPanel.setTenant(this.tenant);
      this.curateAuditFilterPanel = new ImageFilterPanel('curate-audit');
      this.curateAuditFilterPanel.setTenant(this.tenant);

      // Initialize state controllers
      // Milestone 1: Curate Home State (Complete)
      this._curateHomeState = new CurateHomeStateController(this);
      // Milestone 2: Curate Audit State (In Progress)
      this._curateAuditState = new CurateAuditStateController(this);
      this._curateExploreState = new CurateExploreStateController(this);
      this._searchState = new SearchStateController(this);
      this._ratingModalState = new RatingModalStateController(this);
      this._appShellState = new AppShellStateController(this);
      this._appDataState = new AppDataStateController(this);

      this._handleSearchSortChanged = (e) =>
        this._searchState.handleSortChanged(e.detail || {});

      this.keywords = [];
      this.queueState = { queuedCount: 0, inProgressCount: 0, failedCount: 0 };
      this._unsubscribeQueue = null;
      this.showQueuePanel = false;
      this.imageStats = null;
      this.mlTrainingStats = null;
      this.tagStatsBySource = {};
      this.curateLimit = 100;
      this.curateOrderBy = 'photo_creation';
      this.curateOrderDirection = 'desc';
      this.curateHideDeleted = true;
      this.curateMinRating = null;
      this.curateKeywordFilters = {};
      this.curateKeywordOperators = {};
      this.curateCategoryFilterOperator = undefined;
      this.curateDropboxPathPrefix = '';
      this.curateListId = '';
      this.curateListExcludeId = '';
      this.curateFilters = buildCurateFilterObject(this);
      this.curateImages = [];
      this.curatePageOffset = 0;
      this.curateTotal = null;
      this.curateLoading = false;
      this.curateDragSelection = [];
      this.curateDragSelecting = false;
      this.curateDragStartIndex = null;
      this.curateDragEndIndex = null;
      this.curateThumbSize = 190;
      this.curateEditorImage = null;
      this.curateEditorOpen = false;
      this.curateEditorImageSet = [];
      this.curateEditorImageIndex = -1;
      this.curateSubTab = 'main';
      this.curateAuditMode = 'existing';
      this.curateAuditKeyword = '';
      this.curateAuditCategory = '';
      this.curateAuditImages = [];
      this.curateAuditSelection = [];
      this.curateAuditDragTarget = null;
      this.curateAuditDragSelection = [];
      this.curateAuditDragSelecting = false;
      this.curateAuditDragStartIndex = null;
      this.curateAuditDragEndIndex = null;
      this.curateAuditLimit = 100;
      this.curateAuditOffset = 0;
      this.curateAuditTotal = null;
      this.curateAuditLoading = false;
      this.curateAuditLoadAll = false;
      this.curateAuditPageOffset = 0;
      this.curateAuditAiEnabled = false;
      this.curateAuditAiModel = '';
      this.curateAuditOrderBy = 'photo_creation';
      this.curateAuditOrderDirection = 'desc';
      this.curateAuditHideDeleted = true;
      this.curateAuditMinRating = null;
      this.curateAuditNoPositivePermatags = false;
      this.curateAuditDropboxPathPrefix = '';
      this.curateHomeRefreshing = false;
      this.curateStatsLoading = false;
      this.curateAdvancedOpen = false;
      this.curateNoPositivePermatags = false;
      this.activeCurateTagSource = 'permatags';
      this.curateCategoryCards = [];
      this.searchImages = [];
      this.searchTotal = 0;
      this.currentUser = null;
      this.curateExploreTargets = [
        { id: 1, category: '', keyword: '', action: 'add', count: 0 },
      ];
      this._curateExploreHotspotNextId = 2;
      this.curateExploreRatingEnabled = false;
      this.curateExploreRatingCount = 0;
      this._curateExploreRatingPending = null;
      this.curateAuditTargets = [
        { id: 1, category: '', keyword: '', action: 'remove', count: 0 },
      ];
      this._curateAuditHotspotNextId = 2;
      this.curateAuditRatingEnabled = false;
      this.curateAuditRatingCount = 0;
      this._curateAuditRatingPending = null;
      this._curateRatingModalActive = false;
      this._curateRatingModalImageIds = null;
      this._curateRatingModalSource = null;
      this._curateSubTabState = { main: null };
      this._curateActiveWorkingTab = 'main';
      this._curateSubTabState.main = this._snapshotCurateState();
      this._statsRefreshTimer = null;
      this._curateStatsLoadingCount = 0;
      this._curatePressTimer = null;
      this._curatePressActive = false;
      this._curatePressStart = null;
      this._curatePressIndex = null;
      this._curatePressImageId = null;
      this._curateSuppressClick = false;
      this._curateLongPressTriggered = false;
      this._curateAuditPressTimer = null;
      this._curateAuditPressActive = false;
      this._curateAuditPressStart = null;
      this._curateAuditPressIndex = null;
      this._curateAuditPressImageId = null;
      this._curateAuditLongPressTriggered = false;
      this._tabBootstrapped = new Set();
      this._curateRatingBurstIds = new Set();
      this._curateRatingBurstTimers = new Map();
      this._curateStatsAutoRefreshDone = false;
      this._curateFlashSelectionIds = new Set();
      this._curateFlashSelectionTimers = new Map();
      this._curateDragOrder = null;
      this._curateExploreReorderId = null;
      this._curateAuditHotspotDragTarget = null;
      this._curateExploreHotspotDragTarget = null;

      // Initialize hotspot handlers using factory (eliminates 30+ duplicate methods)
      this._exploreHotspotHandlers = createHotspotHandlers(this, {
        targetsProperty: 'curateExploreTargets',
        dragTargetProperty: '_curateExploreHotspotDragTarget',
        nextIdProperty: '_curateExploreHotspotNextId',
        parseKeywordValue: parseUtilityKeywordValue,
        applyRating: (ids, rating) => this._applyExploreRating(ids, rating),
        processTagDrop: (ids, target) => this._processExploreTagDrop(ids, target),
        removeImages: (ids) => this._removeCurateImagesByIds(ids),
      });

      this._auditHotspotHandlers = createHotspotHandlers(this, {
        targetsProperty: 'curateAuditTargets',
        dragTargetProperty: '_curateAuditHotspotDragTarget',
        nextIdProperty: '_curateAuditHotspotNextId',
        parseKeywordValue: parseUtilityKeywordValue,
        applyRating: (ids, rating) => this._applyAuditRating(ids, rating),
        processTagDrop: (ids, target) => this._curateAuditState.processTagDrop(ids, target),
        removeImages: (ids) => this._removeAuditImagesByIds(ids),
      });

      // Initialize rating drag handlers using factory (eliminates 8+ duplicate methods)
      this._exploreRatingHandlers = createRatingDragHandlers(this, {
        enabledProperty: 'curateExploreRatingEnabled',
        dragTargetProperty: '_curateExploreRatingDragTarget',
        showRatingDialog: (ids) => this._showExploreRatingDialog(ids),
      });

      this._auditRatingHandlers = createRatingDragHandlers(this, {
        enabledProperty: 'curateAuditRatingEnabled',
        dragTargetProperty: '_curateAuditRatingDragTarget',
        showRatingDialog: (ids) => this._showAuditRatingDialog(ids),
      });

      // Initialize selection handlers using factory (eliminates 10+ duplicate methods)
      this._exploreSelectionHandlers = createSelectionHandlers(this, {
        selectionProperty: 'curateDragSelection',
        selectingProperty: 'curateDragSelecting',
        startIndexProperty: 'curateDragStartIndex',
        endIndexProperty: 'curateDragEndIndex',
        pressActiveProperty: '_curatePressActive',
        pressStartProperty: '_curatePressStart',
        pressIndexProperty: '_curatePressIndex',
        pressImageIdProperty: '_curatePressImageId',
        pressTimerProperty: '_curatePressTimer',
        longPressTriggeredProperty: '_curateLongPressTriggered',
        getOrder: () => this._curateDragOrder || this._curateLeftOrder,
        flashSelection: (imageId) => this._flashCurateSelection(imageId),
      });

      this._auditSelectionHandlers = createSelectionHandlers(this, {
        selectionProperty: 'curateAuditDragSelection',
        selectingProperty: 'curateAuditDragSelecting',
        startIndexProperty: 'curateAuditDragStartIndex',
        endIndexProperty: 'curateAuditDragEndIndex',
        pressActiveProperty: '_curateAuditPressActive',
        pressStartProperty: '_curateAuditPressStart',
        pressIndexProperty: '_curateAuditPressIndex',
        pressImageIdProperty: '_curateAuditPressImageId',
        pressTimerProperty: '_curateAuditPressTimer',
        longPressTriggeredProperty: '_curateAuditLongPressTriggered',
        getOrder: () => this._curateAuditLeftOrder,
        flashSelection: (imageId) => this._flashCurateSelection(imageId),
      });

      // Initialize pagination handlers using factory (eliminates 6+ duplicate methods)
      this._auditPaginationHandlers = createPaginationHandlers(this, {
        loadingProperty: 'curateAuditLoading',
        offsetProperty: 'curateAuditPageOffset',
        limitProperty: 'curateAuditLimit',
        loadAllProperty: 'curateAuditLoadAll',
        fetchData: (options) => this._fetchCurateAuditImages(options),
      });

      // Wire up filter panel event listeners
      this.searchFilterPanel.on('images-loaded', (detail) => {
        if (detail.tabId === 'search') {
          // Create new array reference so Lit detects the change
          this.searchImages = [...detail.images];
          this.searchTotal = detail.total || 0;
        }
      });
      this.curateHomeFilterPanel.on('images-loaded', (detail) => {
        if (detail.tabId === 'curate-home') {
          this.curateImages = [...detail.images];
          this.curateTotal = detail.total || 0;
        }
      });
      this.curateAuditFilterPanel.on('images-loaded', (detail) => {
        if (detail.tabId === 'curate-audit') {
          this.curateAuditImages = [...detail.images];
          this.curateAuditTotal = detail.total || 0;
        }
      });

      this._handleQueueCommandComplete = (event) => {
        const detail = event?.detail;
        if (!detail) return;
        if (
          detail.type === 'retag' ||
          detail.type === 'add-positive-permatag' ||
          detail.type === 'add-negative-permatag'
        ) {
          scheduleStatsRefresh(this);
        }
      };
      this._handleQueueCommandFailed = (event) => {
        const detail = event?.detail;
        if (!detail?.id) return;
      };
      this._handleQueueToggle = () => {
        this.showQueuePanel = !this.showQueuePanel;
      };
      this._handleCurateGlobalPointerDown = (event) => {
        if (!this.curateDragSelection.length) {
          return;
        }
        const path = event.composedPath ? event.composedPath() : [];
        const clickedThumb = path.some((node) => {
          if (!node || !node.classList) {
            return false;
          }
          return (
            node.classList.contains('curate-thumb-wrapper') ||
            node.classList.contains('curate-thumb')
          );
        });
        const clickedSelected = path.some((node) => {
          if (!node || !node.classList) {
            return false;
          }
          return (
            (node.classList.contains('curate-thumb-wrapper') && node.classList.contains('selected')) ||
            (node.classList.contains('curate-thumb') && node.classList.contains('selected'))
          );
        });
        if (clickedSelected) {
          return;
        }
        this.curateDragSelection = [];
        this._curateSuppressClick = clickedThumb;
      };
      this._handleCurateSelectionEnd = () => {
        if (this.curateDragSelecting) {
          this.curateDragSelecting = false;
          this.curateDragStartIndex = null;
          this.curateDragEndIndex = null;
        }
        if (this.curateAuditDragSelecting) {
          this.curateAuditDragSelecting = false;
          this.curateAuditDragStartIndex = null;
          this.curateAuditDragEndIndex = null;
        }
        if (this._curateAuditLongPressTriggered) {
          this._curateSuppressClick = true;
          this._curateAuditLongPressTriggered = false;
        }
        if (this._curateLongPressTriggered) {
          this._curateSuppressClick = true;
          this._curateLongPressTriggered = false;
        }
      this._cancelCuratePressState();
      this._cancelCurateAuditPressState();
      };
  }

  _getCurateDefaultState() {
      return this._curateHomeState.getDefaultState();
  }

  _snapshotCurateState() {
      return this._curateHomeState.snapshotState();
  }

  _restoreCurateState(state) {
      this._curateHomeState.restoreState(state || this._getCurateDefaultState());
      this._curateDragOrder = null;
      this._cancelCuratePressState();
  }

  // Explore hotspot handlers - now using factory to eliminate duplication
  _handleCurateExploreHotspotKeywordChange(event, targetId) {
      return this._curateExploreState.handleHotspotKeywordChange(event, targetId);
  }

  _handleCurateExploreHotspotActionChange(event, targetId) {
      return this._curateExploreState.handleHotspotActionChange(event, targetId);
  }

  _handleCurateExploreHotspotTypeChange(event, targetId) {
      return this._curateExploreState.handleHotspotTypeChange(event, targetId);
  }

  _handleCurateExploreHotspotRatingChange(event, targetId) {
      return this._curateExploreState.handleHotspotRatingChange(event, targetId);
  }

  _handleCurateExploreHotspotAddTarget() {
      return this._curateExploreState.handleHotspotAddTarget();
  }

  _handleCurateExploreHotspotRemoveTarget(targetId) {
      return this._curateExploreState.handleHotspotRemoveTarget(targetId);
  }

  _handleCurateExploreHotspotDrop(event, targetId) {
      return this._curateExploreState.handleHotspotDrop(event, targetId);
  }

  _handleCurateHotspotChanged(event) {
      return this._curateExploreState.handleHotspotChanged(event);
  }

  _handleCurateAuditHotspotChanged(event) {
      // Transform event detail to match state controller expectations
      const detail = {
          changeType: event.detail.type?.replace('-change', '').replace('-target', '').replace('hotspot-drop', 'drop'),
          targetId: event.detail.targetId,
          value: event.detail.value,
          event: event.detail.event,
      };
      return this._curateAuditState.handleHotspotChanged({ detail });
  }

  _removeCurateImagesByIds(ids) {
      return this._curateHomeState.removeImagesByIds(ids);
  }

  _removeAuditImagesByIds(ids) {
      return this._curateAuditState.removeImagesByIds(ids);
  }

  _processExploreTagDrop(ids, target) {
      return this._curateExploreState.processTagDrop(ids, target);
  }

  _syncAuditHotspotPrimary() {
      return this._curateAuditState.syncHotspotPrimary();
  }

  _handleCurateExploreRatingDrop(event, ratingValue = null) {
      return this._curateExploreState.handleRatingDrop(event, ratingValue);
  }

  _handleCurateAuditRatingDrop(event) {
      return this._auditRatingHandlers.handleDrop(event);
  }

  connectedCallback() {
      super.connectedCallback();
      this._loadCurrentUser();
      this._initializeTab(this.activeTab);
      this._unsubscribeQueue = subscribeQueue((state) => {
        this.queueState = state;
      });
      window.addEventListener('queue-command-complete', this._handleQueueCommandComplete);
      window.addEventListener('queue-command-failed', this._handleQueueCommandFailed);
      window.addEventListener('pointerdown', this._handleCurateGlobalPointerDown);
      window.addEventListener('pointerup', this._handleCurateSelectionEnd);
      window.addEventListener('keyup', this._handleCurateSelectionEnd);
      window.addEventListener('keydown', (e) => this._handleEscapeKey(e));
  }

  async _loadCurrentUser() {
      return await this._appShellState.loadCurrentUser();
  }

  _getTenantRole() {
      return this._appShellState.getTenantRole();
  }

  _canCurate() {
      return this._appShellState.canCurate();
  }

  _handleTabChange(event) {
      return this._appShellState.handleTabChange(event);
  }

  _handleHomeNavigate(event) {
      return this._appShellState.handleHomeNavigate(event);
  }

  _initializeTab(tab, { force = false } = {}) {
      return this._appShellState.initializeTab(tab, { force });
  }

  _showExploreRatingDialog(imageIds) {
      return this._ratingModalState.showExploreRatingDialog(imageIds);
  }

  _showAuditRatingDialog(imageIds) {
      return this._ratingModalState.showAuditRatingDialog(imageIds);
  }

  _handleRatingModalClick(rating) {
      return this._ratingModalState.handleRatingModalClick(rating);
  }

  _closeRatingModal() {
      return this._ratingModalState.closeRatingModal();
  }

  _handleEscapeKey(e) {
      return this._ratingModalState.handleEscapeKey(e);
  }

  async _applyExploreRating(imageIds, rating) {
      return await this._ratingModalState.applyExploreRating(imageIds, rating);
  }

  async _applyAuditRating(imageIds, rating) {
      return await this._ratingModalState.applyAuditRating(imageIds, rating);
  }

  disconnectedCallback() {
      if (this._unsubscribeQueue) {
        this._unsubscribeQueue();
      }
      window.removeEventListener('queue-command-complete', this._handleQueueCommandComplete);
      window.removeEventListener('queue-command-failed', this._handleQueueCommandFailed);
      window.removeEventListener('pointerdown', this._handleCurateGlobalPointerDown);
      window.removeEventListener('pointerup', this._handleCurateSelectionEnd);
      window.removeEventListener('keyup', this._handleCurateSelectionEnd);
      if (this._statsRefreshTimer) {
        clearTimeout(this._statsRefreshTimer);
        this._statsRefreshTimer = null;
      }
      super.disconnectedCallback();
  }

  _applyCurateFilters({ resetOffset = false } = {}) {
      return this._curateHomeState.applyCurateFilters({ resetOffset });
  }

  // Explore selection handlers - now using factory to eliminate duplication
  _cancelCuratePressState() {
      return this._exploreSelectionHandlers.cancelPressState();
  }

  // Audit selection handlers - now using factory to eliminate duplication
  _cancelCurateAuditPressState() {
      return this._auditSelectionHandlers.cancelPressState();
  }

  _handleCuratePointerDown(event, index, imageId) {
      return this._exploreSelectionHandlers.handlePointerDown(event, index, imageId);
  }

  _handleCurateKeywordSelect(event, mode) {
      return this._curateHomeState.handleKeywordSelect(event, mode);
  }

  _updateCurateCategoryCards() {
      return this._curateHomeState.updateCurateCategoryCards();
  }

  async _fetchCurateHomeImages() {
      return await this._curateHomeState.fetchCurateHomeImages();
  }

  _resetSearchListDraft() {
      return this._searchState.resetSearchListDraft();
  }

  async _refreshCurateHome() {
      return await this._curateHomeState.refreshCurateHome();
  }


  _handleTenantChange(e) {
      return this._appShellState.handleTenantChange(e);
  }

  _handleOpenUploadModal() {
      this.showUploadModal = true;
  }

    _handleCloseUploadModal() {
        this.showUploadModal = false;
    }

    _handlePipelineOpenImage(event) {
        const image = event?.detail?.image;
        if (!image?.id) return;
        this.curateEditorImage = image;
        this.curateEditorImageSet = Array.isArray(this.curateImages) ? [...this.curateImages] : [];
        this.curateEditorImageIndex = this.curateEditorImageSet.findIndex(img => img.id === image.id);
        this.curateEditorOpen = true;
    }
    
    _handleUploadComplete() {
        const curateFilters = buildCurateFilterObject(this);
        this.curateHomeFilterPanel.updateFilters(curateFilters);
        this._fetchCurateHomeImages();
        this.fetchStats({
          force: true,
          includeTagStats: this.activeTab === 'curate' && this.curateSubTab === 'home',
        });
        this.showUploadModal = false;
    }

  _handleCurateChipFiltersChanged(event) {
      return this._curateHomeState.handleChipFiltersChanged(event);
  }

  _handleCurateListExcludeFromRightPanel(event) {
      return this._curateHomeState.handleListExcludeFromRightPanel(event);
  }

  _handleCurateAuditChipFiltersChanged(event) {
      return this._curateAuditState.handleChipFiltersChanged(event);
  }

  async _fetchDropboxFolders(query) {
      return await this._searchState.fetchDropboxFolders(query);
  }

  _handleCurateThumbSizeChange(event) {
      this.curateThumbSize = Number(event.target.value);
  }

  _handleCurateSubTabChange(nextTab) {
      return this._curateExploreState.handleSubTabChange(nextTab);
  }

  _buildCurateFilters(options = {}) {
      return buildCurateFilterObject(this, options);
  }

  _getCurateHomeFetchKey() {
      return getCurateHomeFetchKey(this);
  }

  _getCurateAuditFetchKey(options = {}) {
      return getCurateAuditFetchKey(this, options);
  }

  _shouldAutoRefreshCurateStats() {
      return shouldAutoRefreshCurateStats(this);
  }

  async _loadExploreByTagData(forceRefresh = false) {
      return await this._curateExploreState.loadExploreByTagData(forceRefresh);
  }

  _handleCurateAuditModeChange(valueOrEvent) {
      const mode = typeof valueOrEvent === 'string'
          ? valueOrEvent
          : valueOrEvent.target.value;
      return this._curateAuditState.handleModeChange(mode);
  }

  _handleCurateAuditAiEnabledChange(event) {
      return this._curateAuditState.handleAiEnabledChange(event.target.checked);
  }

  _handleCurateAuditAiModelChange(nextModel) {
      return this._curateAuditState.handleAiModelChange(nextModel);
  }

  // Audit pagination handlers - now using factory to eliminate duplication
  async _fetchCurateAuditImages(options = {}) {
      return await this._curateAuditState.fetchCurateAuditImages(options);
  }

  _refreshCurateAudit() {
      return this._curateAuditState.refreshAudit();
  }


  _handleCurateImageClick(event, image, imageSet) {
      return this._curateHomeState.handleCurateImageClick(event, image, imageSet);
  }

  async _handleZoomToPhoto(e) {
      return await this._curateExploreState.handleZoomToPhoto(e);
  }

  _handleCurateEditorClose() {
      return this._curateHomeState.handleCurateEditorClose();
  }

  _handleImageNavigate(event) {
      return this._curateHomeState.handleImageNavigate(event);
  }

  _handleCurateSelectHover(index) {
      return this._exploreSelectionHandlers.handleSelectHover(index);
  }

  _handleExploreByTagPointerDown(event, index, imageId, keywordName, cachedImages) {
      return this._curateExploreState.handleExploreByTagPointerDown(event, index, imageId, cachedImages);
  }

  _handleExploreByTagSelectHover(index, cachedImages) {
      return this._curateExploreState.handleExploreByTagSelectHover(index, cachedImages);
  }


  _flashCurateSelection(imageId) {
      return this._curateHomeState.flashSelection(imageId);
  }

  render() {
    const canCurate = this._canCurate();
    const navCards = [
      { key: 'search', label: 'Search', subtitle: 'Explore and save results', icon: 'fa-magnifying-glass' },
      { key: 'curate', label: 'Curate', subtitle: 'Build stories and sets', icon: 'fa-star' },
      { key: 'lists', label: 'Lists', subtitle: 'Organize saved sets', icon: 'fa-list' },
      { key: 'admin', label: 'Keywords', subtitle: 'Manage configuration', icon: 'fa-cog' },
      { key: 'system', label: 'System', subtitle: 'Manage pipelines and tasks', icon: 'fa-sliders' },
    ].filter((card) => canCurate || card.key !== 'curate');
    this._curateLeftOrder = this.curateImages.map((img) => img.id);
    this._curateRightOrder = [];

    return html`
        ${renderRatingModal(this)}
        <app-header
            .tenant=${this.tenant}
            @tenant-change=${this._handleTenantChange}
            @open-upload-modal=${this._handleOpenUploadModal}
            .activeTab=${this.activeTab}
            .canCurate=${canCurate}
            .queueCount=${(this.queueState?.queuedCount || 0) + (this.queueState?.inProgressCount || 0) + (this.queueState?.failedCount || 0)}
            @tab-change=${this._handleTabChange}
            @sync-progress=${this._handleSyncProgress}
            @sync-complete=${this._handleSyncComplete}
            @sync-error=${this._handleSyncError}
        ></app-header>
        
        <tab-container .activeTab=${this.activeTab}>
            ${this.activeTab === 'home' ? renderHomeTabContent(this, { navCards, formatCurateDate }) : ''}
            ${this.activeTab === 'search' ? renderSearchTabContent(this, { formatCurateDate }) : ''}
            ${this.activeTab === 'curate' ? renderCurateTabContent(this, { formatCurateDate }) : ''}
            ${renderAuxTabContent(this, { formatCurateDate, formatQueueItem, retryFailedCommand })}
        </tab-container>
        ${renderGlobalOverlays(this, { canCurate })}
    `;
  }

  async fetchKeywords() {
      return await this._appDataState.fetchKeywords();
  }

  async fetchStats({ force = false, includeRatings, includeImageStats = true, includeMlStats = true, includeTagStats = true } = {}) {
      return await this._appDataState.fetchStats({
          force,
          includeRatings,
          includeImageStats,
          includeMlStats,
          includeTagStats,
      });
  }

  _handleImageRatingUpdated(e) {
      if (e?.detail?.imageId !== undefined && e?.detail?.rating !== undefined) {
          this._curateExploreState.applyCurateRating(e.detail.imageId, e.detail.rating);
      }
  }

  _handleSyncProgress(e) {
      return this._appDataState.handleSyncProgress(e);
  }

  _handleSyncComplete(e) {
      return this._appDataState.handleSyncComplete(e);
  }

  _handleSyncError(e) {
      return this._appDataState.handleSyncError(e);
  }

  updated(changedProperties) {
      if (changedProperties.has('curateAuditKeyword') || changedProperties.has('curateAuditMode')) {
          this._syncAuditHotspotPrimary();
      }
      if (changedProperties.has('keywords') && this.curateAuditKeyword) {
          this._syncAuditHotspotPrimary();
      }
      this._appShellState.handleUpdated(changedProperties);
  }

}

customElements.define('photocat-app', PhotoCatApp);
