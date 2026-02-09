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
import { tailwind } from './tailwind-lit.js';
import {
  getKeywords,
  getImageStats,
  getMlTrainingStats,
  getTagStats,
  addToList,
} from '../services/api.js';
import { getCurrentUser } from '../services/auth.js';
import { subscribeQueue, retryFailedCommand } from '../services/command-queue.js';
import { createSelectionHandlers } from './shared/selection-handlers.js';
import { createPaginationHandlers } from './shared/pagination-controls.js';
import { createRatingDragHandlers } from './shared/rating-drag-handlers.js';
import { createHotspotHandlers, parseUtilityKeywordValue } from './shared/hotspot-controls.js';
import {
  buildCurateFilterObject,
  getCurateAuditFetchKey,
  getCurateHomeFetchKey,
  shouldIncludeRatingStats,
} from './shared/curate-filters.js';
import { scheduleStatsRefresh, shouldAutoRefreshCurateStats } from './shared/curate-stats.js';
import {
  formatCurateDate,
  formatQueueItem,
  formatStatNumber,
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
      try {
          this.currentUser = await getCurrentUser();
      } catch (error) {
          console.error('Error fetching current user:', error);
          this.currentUser = null;
      }
  }

  _getTenantRole() {
      const tenantId = this.tenant;
      if (!tenantId) return null;
      const memberships = this.currentUser?.tenants || [];
      const match = memberships.find((membership) => String(membership.tenant_id) === String(tenantId));
      return match?.role || null;
  }

  _canCurate() {
      const role = this._getTenantRole();
      if (!role) {
          return true;
      }
      return role !== 'user';
  }

  _setActiveTab(tabName) {
      if (tabName === 'curate' && !this._canCurate()) {
          this.activeTab = 'home';
          return;
      }
      this.activeTab = tabName;
  }

  _handleTabChange(event) {
      this._setActiveTab(event.detail);
  }

  _handleHomeNavigate(event) {
      this._setActiveTab(event.detail.tab);
  }

  _getTabBootstrapKey(tab) {
      const tenantKey = this.tenant || 'no-tenant';
      return `${tab}:${tenantKey}`;
  }

  async _fetchHomeStats({ force = false } = {}) {
      if (!this.tenant) return;
      const results = await Promise.allSettled([
          getImageStats(this.tenant, { force, includeRatings: false }),
          getMlTrainingStats(this.tenant, { force }),
      ]);
      const imageResult = results[0];
      const mlResult = results[1];
      if (imageResult.status === 'fulfilled') {
          this.imageStats = imageResult.value;
      } else {
          console.error('Error fetching image stats:', imageResult.reason);
          this.imageStats = null;
      }
      if (mlResult.status === 'fulfilled') {
          this.mlTrainingStats = mlResult.value;
      } else {
          console.error('Error fetching ML training stats:', mlResult.reason);
          this.mlTrainingStats = null;
      }
  }

  _initializeTab(tab, { force = false } = {}) {
      if (!tab) return;
      if (!this._tabBootstrapped) {
          this._tabBootstrapped = new Set();
      }
      const key = this._getTabBootstrapKey(tab);
      if (!force && this._tabBootstrapped.has(key)) {
          return;
      }

      if (tab === 'home') {
          this._fetchHomeStats();
          if (this.homeSubTab === 'chips' || this.homeSubTab === 'insights') {
              this.fetchKeywords();
          }
          this._tabBootstrapped.add(key);
          return;
      }

      if (!this.tenant) {
          return;
      }

      switch (tab) {
          case 'search': {
              this._searchState.initializeSearchTab();
              break;
          }
          case 'curate': {
              this._curateExploreState.initializeCurateTab();
              break;
          }
          case 'system': {
              this.fetchStats({ includeTagStats: false });
              break;
          }
          case 'admin':
          case 'people':
          case 'tagging':
          case 'lists':
          case 'queue':
          default:
              break;
      }

      this._tabBootstrapped.add(key);
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
      this.tenant = e.detail;
      // Update tenant on all filter panels
      this.searchFilterPanel.setTenant(this.tenant);
      this.curateHomeFilterPanel.setTenant(this.tenant);
      this.curateAuditFilterPanel.setTenant(this.tenant);

      this._curateHomeState.resetForTenantChange();
      this.curateSubTab = 'main';
      this._curateAuditState.resetForTenantChange();
      this._curateAuditLastFetchKey = null;
      this._curateHomeLastFetchKey = null;
      this._curateStatsAutoRefreshDone = false;
      this._searchState.resetForTenantChange();
      this._tabBootstrapped = new Set();
      this._initializeTab(this.activeTab, { force: true });
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

  _renderCurateRatingWidget(image) {
      return html`
        <div class="curate-thumb-rating-widget" @click=${(e) => e.stopPropagation()}>
          ${this._curateRatingBurstIds?.has(image.id) ? html`
            <span class="curate-thumb-burst" aria-hidden="true"></span>
          ` : html``}
            <button
              type="button"
              class="curate-thumb-trash cursor-pointer mx-0.5 ${image.rating == 0 ? 'text-red-600' : 'text-gray-600 hover:text-gray-900'}"
              title="0 stars"
              @click=${(e) => this._curateExploreState.handleCurateRating(e, image, 0)}
            >
              ${image.rating == 0 ? '❌' : '🗑'}
            </button>
            <span class="curate-thumb-stars">
              ${[1, 2, 3].map((star) => html`
                <button
                  type="button"
                  class="cursor-pointer mx-0.5 ${image.rating && image.rating >= star ? 'text-yellow-500' : 'text-gray-500 hover:text-gray-900'}"
                  title="${star} star${star > 1 ? 's' : ''}"
                  @click=${(e) => this._curateExploreState.handleCurateRating(e, image, star)}
                >
                  ${image.rating && image.rating >= star ? '★' : '☆'}
                </button>
              `)}
            </span>
        </div>
      `;
  }

  _renderCurateRatingStatic(image) {
      if (image?.rating === null || image?.rating === undefined || image?.rating === '') {
          return html``;
      }
      return html`
        <div class="curate-thumb-rating-static" aria-label="Rating ${image.rating}">
          ${[1, 2, 3].map((star) => html`
            <span class=${image.rating >= star ? 'text-yellow-500' : 'text-gray-400'}>
              ${image.rating >= star ? '★' : '☆'}
            </span>
          `)}
        </div>
      `;
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
    const showCurateStatsOverlay = this.curateStatsLoading || this.curateHomeRefreshing;
    const canCurate = this._canCurate();
    const navCards = [
      { key: 'search', label: 'Search', subtitle: 'Explore and save results', icon: 'fa-magnifying-glass' },
      { key: 'curate', label: 'Curate', subtitle: 'Build stories and sets', icon: 'fa-star' },
      { key: 'lists', label: 'Lists', subtitle: 'Organize saved sets', icon: 'fa-list' },
      { key: 'admin', label: 'Keywords', subtitle: 'Manage configuration', icon: 'fa-cog' },
      { key: 'system', label: 'System', subtitle: 'Manage pipelines and tasks', icon: 'fa-sliders' },
    ].filter((card) => canCurate || card.key !== 'curate');
    const leftImages = this.curateImages;
    this._curateLeftOrder = leftImages.map((img) => img.id);
    this._curateRightOrder = [];
    const curatePageOffset = this.curatePageOffset || 0;
    const curatePageSize = this.curateImages.length;
    const curateTotalCount = Number.isFinite(this.curateTotal)
      ? this.curateTotal
      : null;
    const curatePageStart = curatePageSize ? curatePageOffset + 1 : 0;
    const curatePageEnd = curatePageSize ? curatePageOffset + curatePageSize : 0;
    const curateCountLabel = curateTotalCount !== null
      ? (curatePageEnd === 0
        ? `0 of ${curateTotalCount}`
        : `${curatePageStart}-${curatePageEnd} of ${curateTotalCount}`)
      : `${curatePageSize} loaded`;
    const curateHasMore = curateTotalCount !== null && curatePageEnd < curateTotalCount;
    const curateHasPrev = curatePageOffset > 0;
    const leftPaneCount = Number.isFinite(curateTotalCount)
      ? curateTotalCount
      : curatePageSize;
    const leftPaneLabel = `${formatStatNumber(leftPaneCount, { placeholder: '--' })} Items`;
    const trimmedSearchListTitle = (this.searchListTitle || '').trim();
    const hasSearchListTitle = !!trimmedSearchListTitle;
    const duplicateNewListTitle =
      !this.searchListId && this._searchState.isDuplicateListTitle(this.searchListTitle);
    const selectedKeywordValueMain = (() => {
      if (this.curateNoPositivePermatags) {
        return '__untagged__';
      }
      const entries = Object.entries(this.curateKeywordFilters || {});
      for (const [category, keywordsSet] of entries) {
        if (keywordsSet && keywordsSet.size > 0) {
          const [keyword] = Array.from(keywordsSet);
          if (keyword) {
            return `${encodeURIComponent(category)}::${encodeURIComponent(keyword)}`;
          }
        }
      }
      return '';
    })();
    const auditActionVerb = this.curateAuditMode === 'existing' ? 'remove' : 'add';
    const auditKeywordLabel = this.curateAuditKeyword
      ? this.curateAuditKeyword.replace(/[-_]/g, ' ')
      : '';
    const auditRightLabel = this.curateAuditKeyword
      ? `${auditActionVerb === 'add' ? 'ADD TAG' : 'REMOVE TAG'}: ${auditKeywordLabel}`
      : `${auditActionVerb === 'add' ? 'ADD TAG' : 'REMOVE TAG'}: keyword`;
    const auditDropLabel = this.curateAuditKeyword
      ? `Drag here to ${auditActionVerb} tag: ${auditKeywordLabel}`
      : 'Select a keyword to start';
    const browseFolderTab = this.renderRoot?.querySelector('curate-browse-folder-tab');
    const curateRefreshBusy = this.curateSubTab === 'home'
      ? (this.curateHomeRefreshing || this.curateStatsLoading)
      : (this.curateSubTab === 'tag-audit'
        ? this.curateAuditLoading
        : (this.curateSubTab === 'browse-folder' ? !!browseFolderTab?.browseByFolderLoading : this.curateLoading));

    return html`
        ${this._curateRatingModalActive ? html`
          <div class="curate-rating-modal-overlay" @click=${this._closeRatingModal}>
            <div class="curate-rating-modal-content" @click=${(e) => e.stopPropagation()}>
              <div class="curate-rating-modal-title">Rate images</div>
              <div class="curate-rating-modal-subtitle">${this._curateRatingModalImageIds?.length || 0} image(s)</div>
              <div class="curate-rating-modal-options">
                <div class="curate-rating-option" @click=${() => this._handleRatingModalClick(0)}>
                  <div class="curate-rating-option-icon">🗑️</div>
                  <div class="curate-rating-option-label">Garbage</div>
                </div>
                <div class="curate-rating-option" @click=${() => this._handleRatingModalClick(1)}>
                  <div class="curate-rating-option-icon">⭐</div>
                  <div class="curate-rating-option-label">1</div>
                </div>
                <div class="curate-rating-option" @click=${() => this._handleRatingModalClick(2)}>
                  <div class="curate-rating-option-icon">⭐</div>
                  <div class="curate-rating-option-label">2</div>
                </div>
                <div class="curate-rating-option" @click=${() => this._handleRatingModalClick(3)}>
                  <div class="curate-rating-option-icon">⭐</div>
                  <div class="curate-rating-option-label">3</div>
                </div>
              </div>
              <div class="curate-rating-modal-buttons">
                <button class="curate-rating-modal-cancel" @click=${this._closeRatingModal}>Cancel</button>
              </div>
            </div>
          </div>
        ` : html``}
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
            ${this.activeTab === 'home' ? html`
            <div slot="home">
              <div class="container">
                <div class="curate-subtabs">
                  <button
                    class="curate-subtab ${this.homeSubTab === 'overview' ? 'active' : ''}"
                    @click=${() => { this.homeSubTab = 'overview'; }}
                  >
                    Overview
                  </button>
                  <button
                    class="curate-subtab ${this.homeSubTab === 'lab' ? 'active' : ''}"
                    @click=${() => { this.homeSubTab = 'lab'; }}
                  >
                    Natural Search
                  </button>
                  <button
                    class="curate-subtab ${this.homeSubTab === 'chips' ? 'active' : ''}"
                    @click=${() => { this.homeSubTab = 'chips'; }}
                  >
                    Chips
                  </button>
                  <button
                    class="curate-subtab ${this.homeSubTab === 'insights' ? 'active' : ''}"
                    @click=${() => { this.homeSubTab = 'insights'; }}
                  >
                    Insights (mock)
                  </button>
                </div>
              </div>
              ${this.homeSubTab === 'overview' ? html`
              <home-tab
                  .imageStats=${this.imageStats}
                  .mlTrainingStats=${this.mlTrainingStats}
                  .navCards=${navCards}
                  @navigate=${this._handleHomeNavigate}
              ></home-tab>
              ` : html``}
              ${this.homeSubTab === 'lab' ? html`
                <lab-tab
                  .tenant=${this.tenant}
                  .tagStatsBySource=${this.tagStatsBySource}
                  .activeCurateTagSource=${this.activeCurateTagSource}
                  .keywords=${this.keywords}
                  .imageStats=${this.imageStats}
                  .renderCurateRatingWidget=${this._renderCurateRatingWidget.bind(this)}
                  .renderCurateRatingStatic=${this._renderCurateRatingStatic.bind(this)}
                  .formatCurateDate=${formatCurateDate}
                  @image-clicked=${(e) => this._handleCurateImageClick(e.detail.event, e.detail.image, e.detail.imageSet)}
                  @image-selected=${(e) => this._handleCurateImageClick(null, e.detail.image, e.detail.imageSet)}
                ></lab-tab>
              ` : html``}
              ${this.homeSubTab === 'chips' ? html`
                <home-chips-tab
                  .tenant=${this.tenant}
                  .tagStatsBySource=${this.tagStatsBySource}
                  .activeCurateTagSource=${this.activeCurateTagSource}
                  .keywords=${this.keywords}
                  .imageStats=${this.imageStats}
                  .renderCurateRatingWidget=${this._renderCurateRatingWidget.bind(this)}
                  .renderCurateRatingStatic=${this._renderCurateRatingStatic.bind(this)}
                  .formatCurateDate=${formatCurateDate}
                  @image-clicked=${(e) => this._handleCurateImageClick(e.detail.event, e.detail.image, e.detail.imageSet)}
                  @image-selected=${(e) => this._handleCurateImageClick(null, e.detail.image, e.detail.imageSet)}
                ></home-chips-tab>
              ` : html``}
              ${this.homeSubTab === 'insights' ? html`
                <home-insights-tab
                  .imageStats=${this.imageStats}
                  .mlTrainingStats=${this.mlTrainingStats}
                  .keywords=${this.keywords}
                ></home-insights-tab>
              ` : html``}
            </div>
            ` : ''}
            ${this.activeTab === 'search' ? html`
            <search-tab
              slot="search"
              .tenant=${this.tenant}
              .searchFilterPanel=${this.searchFilterPanel}
              .searchImages=${this.searchImages}
              .searchTotal=${this.searchTotal}
              .curateThumbSize=${this.curateThumbSize}
              .tagStatsBySource=${this.tagStatsBySource}
              .activeCurateTagSource=${this.activeCurateTagSource}
              .keywords=${this.keywords}
              .imageStats=${this.imageStats}
              .curateOrderBy=${this.curateOrderBy}
              .curateDateOrder=${this.curateOrderDirection}
              .renderCurateRatingWidget=${this._renderCurateRatingWidget.bind(this)}
              .renderCurateRatingStatic=${this._renderCurateRatingStatic.bind(this)}
              .formatCurateDate=${formatCurateDate}
              @sort-changed=${this._handleSearchSortChanged}
              @thumb-size-changed=${(e) => this.curateThumbSize = e.detail.size}
              @image-clicked=${(e) => this._handleCurateImageClick(e.detail.event, e.detail.image, e.detail.imageSet)}
              @image-selected=${(e) => this._handleCurateImageClick(null, e.detail.image, e.detail.imageSet)}
            ></search-tab>
            ` : ''}

            ${this.activeTab === 'curate' ? html`
            <div slot="curate" class="container">
                <div class="flex items-center justify-between mb-4">
                    <div class="curate-subtabs">
                        <button
                          class="curate-subtab ${this.curateSubTab === 'main' ? 'active' : ''}"
                          @click=${() => this._handleCurateSubTabChange('main')}
                        >
                          Explore
                        </button>
                        <button
                          class="curate-subtab ${this.curateSubTab === 'browse-folder' ? 'active' : ''}"
                          @click=${() => this._handleCurateSubTabChange('browse-folder')}
                        >
                          Browse by Folder
                        </button>
                    <button
                      class="curate-subtab ${this.curateSubTab === 'tag-audit' ? 'active' : ''}"
                      @click=${() => this._handleCurateSubTabChange('tag-audit')}
                    >
                      Tag audit
                    </button>
                        <button
                          class="curate-subtab ${this.curateSubTab === 'home' ? 'active' : ''}"
                          @click=${() => this._handleCurateSubTabChange('home')}
                        >
                          Stats
                        </button>
                    <button
                      class="curate-subtab ${this.curateSubTab === 'help' ? 'active' : ''}"
                      @click=${() => this._handleCurateSubTabChange('help')}
                    >
                      <i class="fas fa-question-circle mr-1"></i>Help
                    </button>
                    </div>
                <div class="ml-auto flex items-center gap-4 text-xs text-gray-600 mr-4">
                  <label class="font-semibold text-gray-600">Thumb</label>
                  <input
                    type="range"
                    min="80"
                    max="220"
                    step="10"
                    .value=${String(this.curateThumbSize)}
                    @input=${this._handleCurateThumbSizeChange}
                    class="w-24"
                  >
                  <span class="w-12 text-right text-xs">${this.curateThumbSize}px</span>
                </div>
                <button
                  class="inline-flex items-center gap-2 border rounded-lg px-4 py-2 text-xs text-gray-600 hover:bg-gray-50"
                  ?disabled=${curateRefreshBusy}
                  @click=${() => {
                    if (this.curateSubTab === 'tag-audit') {
                      this._refreshCurateAudit();
                    } else if (this.curateSubTab === 'home') {
                      this._refreshCurateHome();
                    } else if (this.curateSubTab === 'browse-folder') {
                      const panel = this.renderRoot?.querySelector('curate-browse-folder-tab');
                      panel?.refresh?.();
                    } else {
                      const curateFilters = buildCurateFilterObject(this);
                      this.curateHomeFilterPanel.updateFilters(curateFilters);
                      this._fetchCurateHomeImages();
                    }
                  }}
                  title="Refresh"
                >
                  ${curateRefreshBusy ? html`<span class="curate-spinner"></span>` : html`<span aria-hidden="true">↻</span>`}
                  ${curateRefreshBusy ? 'Refreshing' : 'Refresh'}
                </button>
                </div>
                ${this.curateSubTab === 'home' ? html`
                <div>
                  ${showCurateStatsOverlay ? html`
                    <div class="curate-loading-overlay" aria-label="Loading">
                      <span class="curate-spinner large"></span>
                    </div>
                  ` : html``}
                  <curate-home-tab-v2
                    .imageStats=${this.imageStats}
                    .tagStatsBySource=${this.tagStatsBySource}
                    .activeCurateTagSource=${this.activeCurateTagSource}
                    .curateCategoryCards=${this.curateCategoryCards}
                    @tag-source-changed=${(e) => {
                      this.activeCurateTagSource = e.detail.source;
                      this._updateCurateCategoryCards();
                    }}
                  ></curate-home-tab-v2>
                </div>
                ` : html``}
                ${this.curateSubTab === 'main' ? html`
                <div>
                  <curate-explore-tab
                    .tenant=${this.tenant}
                    .images=${leftImages}
                    .thumbSize=${this.curateThumbSize}
                    .orderBy=${this.curateOrderBy}
                    .dateOrder=${this.curateOrderDirection}
                    .limit=${this.curateLimit}
                    .offset=${this.curatePageOffset}
                    .total=${this.curateTotal}
                    .loading=${this.curateLoading}
                    .dragSelection=${this.curateDragSelection}
                    .dragSelecting=${this.curateDragSelecting}
                    .dragStartIndex=${this.curateDragStartIndex}
                    .dragEndIndex=${this.curateDragEndIndex}
                    .minRating=${this.curateMinRating}
                    .dropboxPathPrefix=${this.curateDropboxPathPrefix}
                    .renderCurateRatingWidget=${this._renderCurateRatingWidget.bind(this)}
                    .renderCurateRatingStatic=${this._renderCurateRatingStatic.bind(this)}
                    .renderCuratePermatagSummary=${this._renderCuratePermatagSummary.bind(this)}
                    .renderCurateAiMLScore=${this._renderCurateAiMLScore.bind(this)}
                    .formatCurateDate=${formatCurateDate}
                    .imageStats=${this.imageStats}
                    .curateCategoryCards=${this.curateCategoryCards}
                    .selectedKeywordValueMain=${selectedKeywordValueMain}
                    .curateKeywordFilters=${this.curateKeywordFilters}
                    .curateKeywordOperators=${this.curateKeywordOperators}
                    .curateNoPositivePermatags=${this.curateNoPositivePermatags}
                    .listFilterId=${this.curateListExcludeId || this.curateListId}
                    .listFilterMode=${this.curateListExcludeId ? 'exclude' : 'include'}
                    .tagStatsBySource=${this.tagStatsBySource}
                    .activeCurateTagSource=${this.activeCurateTagSource}
                    .keywords=${this.keywords}
                    .curateExploreTargets=${this.curateExploreTargets}
                    .curateExploreRatingEnabled=${this.curateExploreRatingEnabled}
                    .curateExploreRatingCount=${this.curateExploreRatingCount}
                    @image-clicked=${(e) => this._handleCurateImageClick(e.detail.event, e.detail.image, e.detail.imageSet)}
                    @sort-changed=${(e) => {
                      this.curateOrderBy = e.detail.orderBy;
                      this.curateOrderDirection = e.detail.dateOrder;
                      this._applyCurateFilters();
                    }}
                    @thumb-size-changed=${(e) => { this.curateThumbSize = e.detail.size; }}
                    @keyword-selected=${(e) => this._handleCurateKeywordSelect(e.detail.event, e.detail.mode)}
                    @pagination-changed=${(e) => {
                      this.curatePageOffset = e.detail.offset;
                      this.curateLimit = e.detail.limit;
                      this._applyCurateFilters();
                    }}
                    @hotspot-changed=${this._handleCurateHotspotChanged}
                    @selection-changed=${(e) => { this.curateDragSelection = e.detail.selection; }}
                    @rating-drop=${(e) => this._handleCurateExploreRatingDrop(e.detail.event, e.detail.rating)}
                    @curate-filters-changed=${this._handleCurateChipFiltersChanged}
                    @list-filter-exclude=${this._handleCurateListExcludeFromRightPanel}
                  ></curate-explore-tab>
                </div>
                ` : html``}
                ${this.curateSubTab === 'browse-folder' ? html`
                <div>
                  <curate-browse-folder-tab
                    .tenant=${this.tenant}
                    .thumbSize=${this.curateThumbSize}
                    .curateOrderBy=${this.curateOrderBy}
                    .curateDateOrder=${this.curateOrderDirection}
                    .renderCurateRatingWidget=${this._renderCurateRatingWidget.bind(this)}
                    .renderCurateRatingStatic=${this._renderCurateRatingStatic.bind(this)}
                    .renderCuratePermatagSummary=${this._renderCuratePermatagSummary.bind(this)}
                    .formatCurateDate=${formatCurateDate}
                    .tagStatsBySource=${this.tagStatsBySource}
                    .activeCurateTagSource=${this.activeCurateTagSource}
                    .keywords=${this.keywords}
                    @sort-changed=${(e) => {
                      this.curateOrderBy = e.detail.orderBy;
                      this.curateOrderDirection = e.detail.dateOrder;
                    }}
                    @image-clicked=${(e) => this._handleCurateImageClick(e.detail.event, e.detail.image, e.detail.imageSet)}
                  ></curate-browse-folder-tab>
                </div>
                ` : html``}
                ${this.curateSubTab === 'tag-audit' ? html`
                <div>
                  <curate-audit-tab
                    .tenant=${this.tenant}
                    .keyword=${this.curateAuditKeyword}
                    .keywordCategory=${this.curateAuditCategory}
                    .mode=${this.curateAuditMode}
                    .aiEnabled=${this.curateAuditAiEnabled}
                    .aiModel=${this.curateAuditAiModel}
                    .images=${this.curateAuditImages}
                    .thumbSize=${this.curateThumbSize}
                    .minRating=${this.curateAuditMinRating}
                    .dropboxPathPrefix=${this.curateAuditDropboxPathPrefix}
                    .offset=${this.curateAuditPageOffset || 0}
                    .limit=${this.curateAuditLimit}
                    .total=${this.curateAuditTotal}
                    .loading=${this.curateAuditLoading}
                    .loadAll=${this.curateAuditLoadAll}
                    .dragSelection=${this.curateAuditDragSelection}
                    .dragSelecting=${this.curateAuditDragSelecting}
                    .dragStartIndex=${this.curateAuditDragStartIndex}
                    .dragEndIndex=${this.curateAuditDragEndIndex}
                    .renderCurateRatingWidget=${this._renderCurateRatingWidget.bind(this)}
                    .renderCurateRatingStatic=${this._renderCurateRatingStatic.bind(this)}
                    .renderCurateAiMLScore=${this._renderCurateAiMLScore.bind(this)}
                    .renderCuratePermatagSummary=${this._renderCuratePermatagSummary.bind(this)}
                    .formatCurateDate=${formatCurateDate}
                    .tagStatsBySource=${this.tagStatsBySource}
                    .activeCurateTagSource=${this.activeCurateTagSource}
                    .keywords=${this.keywords}
                    .targets=${this.curateAuditTargets}
                    .ratingEnabled=${this.curateAuditRatingEnabled}
                    .ratingCount=${this.curateAuditRatingCount}
                    @audit-mode-changed=${(e) => this._handleCurateAuditModeChange(e.detail.mode)}
                    @audit-ai-enabled-changed=${(e) => this._handleCurateAuditAiEnabledChange({ target: { checked: e.detail.enabled } })}
                    @audit-ai-model-changed=${(e) => this._handleCurateAuditAiModelChange(e.detail.model)}
                    @pagination-changed=${(e) => {
                      this.curateAuditPageOffset = e.detail.offset;
                      this.curateAuditLimit = e.detail.limit;
                      this._fetchCurateAuditImages();
                    }}
                    @image-clicked=${(e) => this._handleCurateImageClick(e.detail.event, e.detail.image, e.detail.imageSet)}
                    @selection-changed=${(e) => {
                      this.curateAuditDragSelection = e.detail.selection;
                    }}
                    @hotspot-changed=${this._handleCurateAuditHotspotChanged}
                    @rating-toggle=${(e) => {
                      this.curateAuditRatingEnabled = e.detail.enabled;
                    }}
                    @rating-drop=${(e) => this._handleCurateAuditRatingDrop(e.detail.event)}
                    @curate-audit-filters-changed=${this._handleCurateAuditChipFiltersChanged}
                  ></curate-audit-tab>
                </div>
                ` : html``}
                ${this.curateSubTab === 'help' ? html`
                <div>
                  <div class="space-y-6">
                    <div class="bg-white rounded-lg shadow p-6">
                      <h2 class="text-2xl font-bold text-gray-900 mb-6">Curate Your Collection</h2>

                      <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                        <h3 class="text-lg font-semibold text-blue-900 mb-3">Getting Started</h3>
                        <p class="text-blue-800 text-sm mb-4">
                          Welcome to the Curation interface! Here's how to organize your collection:
                        </p>
                        <ol class="space-y-3 text-sm text-blue-800">
                          <li class="flex gap-3">
                            <span class="font-bold flex-shrink-0">1.</span>
                            <span><button @click=${() => this._handleCurateSubTabChange('main')} class="font-bold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer">Explore Tab</button>: Browse, select, and organize images by dragging them between panes. Use filters and keywords to find exactly what you need.</span>
                          </li>
                          <li class="flex gap-3">
                            <span class="font-bold flex-shrink-0">2.</span>
                            <span><button @click=${() => this._handleCurateSubTabChange('tag-audit')} class="font-bold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer">Tag Audit Tab</button>: Review and validate machine-generated tags. Ensure your automated tags are accurate and complete.</span>
                          </li>
                          <li class="flex gap-3">
                            <span class="font-bold flex-shrink-0">3.</span>
                            <span><button @click=${() => this._handleCurateSubTabChange('home')} class="font-bold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer">Stats</button>: Monitor tag statistics and understand your collection's tagging patterns at a glance.</span>
                          </li>
                        </ol>
                      </div>

                      <div class="bg-green-50 border border-green-200 rounded-lg p-4">
                        <h3 class="text-lg font-semibold text-green-900 mb-3">Quick Tips</h3>
                        <ul class="space-y-2 text-sm text-green-800">
                          <li class="flex gap-2">
                            <span>📌</span>
                            <span>Click and drag images to move them between left and right panes</span>
                          </li>
                          <li class="flex gap-2">
                            <span>🏷️</span>
                            <span>Drag images into hotspots to add or remove tags</span>
                          </li>
                          <li class="flex gap-2">
                            <span>🔍</span>
                            <span>Filter by keywords, ratings, and lists to focus on specific images</span>
                          </li>
                          <li class="flex gap-2">
                            <span>⚙️</span>
                            <span>Switch between Permatags, Keyword-Model, and Zero-Shot in the histogram</span>
                          </li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
                ` : html``}
            </div>
            ` : ''}
            ${this.activeTab === 'lists' ? html`
            <div slot="lists" class="container p-4">
                <list-editor
                  .tenant=${this.tenant}
                  .thumbSize=${this.curateThumbSize}
                  .renderCurateRatingWidget=${this._renderCurateRatingWidget.bind(this)}
                  .renderCurateRatingStatic=${this._renderCurateRatingStatic.bind(this)}
                  .renderCuratePermatagSummary=${this._renderCuratePermatagSummary.bind(this)}
                  .formatCurateDate=${formatCurateDate}
                  @image-selected=${(e) => this._handleCurateImageClick(null, e.detail.image, e.detail.imageSet)}
                ></list-editor>
            </div>
            ` : ''}
            ${this.activeTab === 'admin' ? html`
            <div slot="admin" class="container p-4">
                <div class="admin-subtabs">
                    <button
                        class="admin-subtab ${this.activeAdminSubTab === 'tagging' ? 'active' : ''}"
                        @click=${() => this.activeAdminSubTab = 'tagging'}
                    >
                        <i class="fas fa-tags mr-2"></i>Tagging
                    </button>
                    <button
                        class="admin-subtab ${this.activeAdminSubTab === 'people' ? 'active' : ''}"
                        @click=${() => this.activeAdminSubTab = 'people'}
                    >
                        <i class="fas fa-users mr-2"></i>People
                    </button>
                </div>
                ${this.activeAdminSubTab === 'tagging' ? html`
                    <tagging-admin .tenant=${this.tenant} @open-upload-modal=${this._handleOpenUploadModal}></tagging-admin>
                ` : ''}
                ${this.activeAdminSubTab === 'people' ? html`
                    <person-manager .tenant=${this.tenant}></person-manager>
                ` : ''}
            </div>
            ` : ''}
            ${this.activeTab === 'people' ? html`
            <div slot="people" class="container p-4">
                <person-manager .tenant=${this.tenant}></person-manager>
            </div>
            ` : ''}
            ${this.activeTab === 'tagging' ? html`
            <div slot="tagging" class="container p-4">
                <tagging-admin .tenant=${this.tenant} @open-upload-modal=${this._handleOpenUploadModal}></tagging-admin>
            </div>
            ` : ''}
            ${this.activeTab === 'system' ? html`
            <div slot="system" class="container p-4">
                <div class="system-subtabs">
                    <button
                        class="system-subtab ${this.activeSystemSubTab === 'ml-training' ? 'active' : ''}"
                        @click=${() => this.activeSystemSubTab = 'ml-training'}
                    >
                        <i class="fas fa-brain mr-2"></i>Pipeline
                    </button>
                    <button
                        class="system-subtab ${this.activeSystemSubTab === 'cli' ? 'active' : ''}"
                        @click=${() => this.activeSystemSubTab = 'cli'}
                    >
                        <i class="fas fa-terminal mr-2"></i>CLI
                    </button>
                </div>
                ${this.activeSystemSubTab === 'ml-training' ? html`
                    <ml-training
                      .tenant=${this.tenant}
                      @open-image-editor=${this._handlePipelineOpenImage}
                    ></ml-training>
                ` : ''}
                ${this.activeSystemSubTab === 'cli' ? html`
                    <cli-commands></cli-commands>
                ` : ''}
            </div>
            ` : ''}
            ${this.activeTab === 'ml-training' ? html`
            <div slot="ml-training" class="container p-4">
                <ml-training
                  .tenant=${this.tenant}
                  @open-image-editor=${this._handlePipelineOpenImage}
                ></ml-training>
            </div>
            ` : ''}
            ${this.activeTab === 'cli' ? html`
            <div slot="cli" class="container p-4">
                <cli-commands></cli-commands>
            </div>
            ` : ''}
            ${this.activeTab === 'queue' ? html`
            <div slot="queue" class="container p-4">
                <div class="border border-gray-200 rounded-lg p-4 bg-white text-sm text-gray-600 space-y-3">
                    <div class="font-semibold text-gray-700">Work Queue</div>
                    <div class="text-xs text-gray-500">
                        ${this.queueState.inProgressCount || 0} active · ${this.queueState.queuedCount || 0} queued · ${this.queueState.failedCount || 0} failed
                    </div>
                    ${this.queueState.inProgress?.length ? html`
                      <div>
                        <div class="font-semibold text-gray-600 mb-1">In Progress</div>
                        ${this.queueState.inProgress.map((item) => html`
                          <div>${formatQueueItem(item)}</div>
                        `)}
                      </div>
                    ` : html``}
                    ${this.queueState.queue?.length ? html`
                      <div>
                        <div class="font-semibold text-gray-600 mb-1">Queued</div>
                        ${this.queueState.queue.map((item) => html`
                          <div>${formatQueueItem(item)}</div>
                        `)}
                      </div>
                    ` : html``}
                    ${this.queueState.failed?.length ? html`
                      <div>
                        <div class="font-semibold text-red-600 mb-1">Failed</div>
                        ${this.queueState.failed.map((item) => html`
                          <div class="flex items-center justify-between">
                            <span>${formatQueueItem(item)}</span>
                            <button
                              class="text-xs text-blue-600 hover:text-blue-700"
                              @click=${() => retryFailedCommand(item.id)}
                            >
                              Retry
                            </button>
                          </div>
                        `)}
                      </div>
                    ` : html`<div class="text-gray-400">No failed commands.</div>`}
                </div>
            </div>
            ` : ''}
        </tab-container>

        ${this.showUploadModal ? html`<upload-modal .tenant=${this.tenant} @close=${this._handleCloseUploadModal} @upload-complete=${this._handleUploadComplete} active></upload-modal>` : ''}
        ${this.curateEditorImage ? html`
          <image-editor
            .tenant=${this.tenant}
            .image=${this.curateEditorImage}
            .open=${this.curateEditorOpen}
            .imageSet=${this.curateEditorImageSet}
            .currentImageIndex=${this.curateEditorImageIndex}
            .canEditTags=${canCurate}
            @close=${this._handleCurateEditorClose}
            @image-rating-updated=${this._handleImageRatingUpdated}
            @zoom-to-photo=${this._handleZoomToPhoto}
            @image-navigate=${this._handleImageNavigate}
          ></image-editor>
        ` : ''}
    `;
  }

  async fetchKeywords() {
      if (!this.tenant) return;
      try {
          const keywordsByCategory = await getKeywords(this.tenant, { source: 'permatags', includePeople: true });
          const flat = [];
          Object.entries(keywordsByCategory || {}).forEach(([category, list]) => {
              list.forEach((kw) => {
                  flat.push({ keyword: kw.keyword, category, count: kw.count || 0 });
              });
          });
          this.keywords = flat.sort((a, b) => a.keyword.localeCompare(b.keyword));
      } catch (error) {
          console.error('Error fetching keywords:', error);
          this.keywords = [];
      }
  }

  async fetchStats({ force = false, includeRatings, includeImageStats = true, includeMlStats = true, includeTagStats = true } = {}) {
      if (!this.tenant) return;
      const include = includeRatings ?? shouldIncludeRatingStats(this);
      const showCurateLoading = this.activeTab === 'curate' && this.curateSubTab === 'home';
      if (showCurateLoading) {
          this._curateStatsLoadingCount = (this._curateStatsLoadingCount || 0) + 1;
          this.curateStatsLoading = true;
      }
      try {
          const requests = [];
          if (includeImageStats) {
              requests.push(getImageStats(this.tenant, { force, includeRatings: include }));
          }
          if (includeMlStats) {
              requests.push(getMlTrainingStats(this.tenant, { force }));
          }
          if (includeTagStats) {
              requests.push(getTagStats(this.tenant, { force }));
          }
          const results = await Promise.allSettled(requests);
          let index = 0;
          if (includeImageStats) {
              const imageResult = results[index++];
              if (imageResult.status === 'fulfilled') {
                  this.imageStats = imageResult.value;
              } else {
                  console.error('Error fetching image stats:', imageResult.reason);
                  this.imageStats = null;
              }
          }
          if (includeMlStats) {
              const mlResult = results[index++];
              if (mlResult.status === 'fulfilled') {
                  this.mlTrainingStats = mlResult.value;
              } else {
                  console.error('Error fetching ML training stats:', mlResult.reason);
                  this.mlTrainingStats = null;
              }
          }
          if (includeTagStats) {
              const tagResult = results[index++];
              if (tagResult.status === 'fulfilled') {
                  this.tagStatsBySource = tagResult.value?.sources || {};
                  this._updateCurateCategoryCards();
              } else {
                  console.error('Error fetching tag stats:', tagResult.reason);
                  this.tagStatsBySource = {};
              }
          }
      } finally {
          if (showCurateLoading) {
              this._curateStatsLoadingCount = Math.max(0, (this._curateStatsLoadingCount || 1) - 1);
              this.curateStatsLoading = this._curateStatsLoadingCount > 0;
          }
      }
  }

  _handleImageRatingUpdated(e) {
      if (e?.detail?.imageId !== undefined && e?.detail?.rating !== undefined) {
          this._curateExploreState.applyCurateRating(e.detail.imageId, e.detail.rating);
      }
  }

  _handleSyncProgress(e) {
      console.log(`Sync progress: ${e.detail.count} images processed`);
  }

  _handleSyncComplete(e) {
      console.log(`Sync complete: ${e.detail.count} total images processed`);
      this.fetchStats({
        force: true,
        includeTagStats: this.activeTab === 'curate' && this.curateSubTab === 'home',
      });
  }

  _handleSyncError(e) {
      console.error('Sync error:', e.detail.error);
      // Could show a toast/notification here
  }

  _renderCurateAiMLScore(image) {
      // Only show ML score in AI mode (zero-shot tagging)
      const isAiMode = this.curateAuditMode === 'missing'
          && this.curateAuditAiEnabled
          && !!this.curateAuditAiModel
          && this.curateAuditKeyword;

      if (!isAiMode) return html``;

      // Find the ML tag matching the selected keyword
      const tags = Array.isArray(image?.tags) ? image.tags : [];
      const mlTag = tags.find((tag) => tag.keyword === this.curateAuditKeyword);
      if (!mlTag) return html``;

      // DISABLED: Confidence label was confusing to users
      // Re-enable by uncommenting the code below
      // const modelName = this.curateAuditAiModel === 'trained' ? 'Keyword-Model' : 'Siglip';
      // return html`
      //   <div class="curate-thumb-ml-score">
      //     <span class="curate-thumb-icon" aria-hidden="true">🤖</span>${modelName}: ${this.curateAuditKeyword}=${(mlTag.confidence).toFixed(2)}
      //   </div>
      // `;

      return html``;
  }

  _renderCuratePermatagSummary(image) {
      const permatags = Array.isArray(image?.permatags) ? image.permatags : [];
      const positives = permatags.filter((tag) => tag.signum === 1 && tag.keyword);
      if (!positives.length) return html``;
      const keywords = positives
        .map((tag) => tag.keyword)
        .filter(Boolean);
      if (!keywords.length) return html``;
      const unique = Array.from(new Set(keywords));
      return html`
        <div class="curate-thumb-rating">Tags: ${unique.join(', ')}</div>
      `;
  }

  updated(changedProperties) {
      if (changedProperties.has('curateAuditKeyword') || changedProperties.has('curateAuditMode')) {
          this._syncAuditHotspotPrimary();
      }
      if (changedProperties.has('keywords') && this.curateAuditKeyword) {
          this._syncAuditHotspotPrimary();
      }
      if (this.activeTab === 'curate' && this.curateSubTab === 'home') {
          if (shouldAutoRefreshCurateStats(this)) {
              this._curateStatsAutoRefreshDone = true;
              this._refreshCurateHome();
          }
      }
      if (changedProperties.has('activeTab')) {
          this._initializeTab(this.activeTab);
      }
      if ((changedProperties.has('currentUser') || changedProperties.has('tenant')) && this.activeTab === 'curate' && !this._canCurate()) {
          this.activeTab = 'home';
      }
      if (changedProperties.has('homeSubTab') && this.activeTab === 'home') {
          if (this.homeSubTab === 'chips' || this.homeSubTab === 'insights') {
              this.fetchKeywords();
          }
      }
  }

}

customElements.define('photocat-app', PhotoCatApp);
