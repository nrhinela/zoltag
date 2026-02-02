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
import { tailwind } from './tailwind-lit.js';
import {
  fetchWithAuth,
  getKeywords,
  getImageStats,
  getMlTrainingStats,
  getTagStats,
  getImages,
  getDropboxFolders,
  addToList,
} from '../services/api.js';
import { enqueueCommand, subscribeQueue, retryFailedCommand } from '../services/command-queue.js';
import { createSelectionHandlers } from './shared/selection-handlers.js';
import { createPaginationHandlers } from './shared/pagination-controls.js';
import { createRatingDragHandlers } from './shared/rating-drag-handlers.js';
import { createHotspotHandlers, parseUtilityKeywordValue } from './shared/hotspot-controls.js';
import {
  buildCurateAuditFilterObject,
  buildCurateFilterObject,
  getCurateAuditFetchKey,
  getCurateHomeFetchKey,
  shouldIncludeRatingStats,
} from './shared/curate-filters.js';
import {
  buildCategoryCards,
  getCategoryCount,
  getKeywordsByCategory,
  mergePermatags,
  resolveKeywordCategory,
} from './shared/keyword-utils.js';
import {
  formatCurateDate,
  formatQueueItem,
  formatStatNumber,
} from './shared/formatting.js';
import './home-tab.js';
import './curate-home-tab.js';
import './curate-explore-tab.js';
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
            grid-template-columns: 2fr 1fr;
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
      curateDropboxPathPrefix: { type: String },
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
  }

  constructor() {
      super();
      this.tenant = 'bcg'; // Default tenant
      this.showUploadModal = false;
      this.activeTab = 'home'; // Default to home tab
      this.activeAdminSubTab = 'tagging'; // Default admin subtab
      this.activeSystemSubTab = 'ml-training'; // Default system subtab

      // Initialize filter state containers for each tab
      this.searchFilterPanel = new ImageFilterPanel('search');
      this.searchFilterPanel.setTenant(this.tenant);
      this.curateHomeFilterPanel = new ImageFilterPanel('curate-home');
      this.curateHomeFilterPanel.setTenant(this.tenant);
      this.curateAuditFilterPanel = new ImageFilterPanel('curate-audit');
      this.curateAuditFilterPanel.setTenant(this.tenant);

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
      this.curateDropboxPathPrefix = '';
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
        processTagDrop: (ids, target) => this._processAuditTagDrop(ids, target),
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
          this._scheduleStatsRefresh();
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
      return {
          curateLimit: 100,
          curateOrderBy: 'photo_creation',
          curateOrderDirection: 'desc',
          curateHideDeleted: true,
          curateMinRating: null,
          curateKeywordFilters: {},
          curateKeywordOperators: {},
          curateDropboxPathPrefix: '',
          curateFilters: buildCurateFilterObject(this),
          curateImages: [],
          curatePageOffset: 0,
          curateTotal: null,
          curateLoading: false,
          curateDragSelection: [],
          curateDragSelecting: false,
          curateDragStartIndex: null,
          curateDragEndIndex: null,
          curateNoPositivePermatags: false,
          _curateLeftOrder: [],
          _curateRightOrder: [],
          _curateFlashSelectionIds: null,
      };
  }

  _snapshotCurateState() {
      return {
          curateLimit: this.curateLimit,
          curateOrderBy: this.curateOrderBy,
          curateOrderDirection: this.curateOrderDirection,
          curateHideDeleted: this.curateHideDeleted,
          curateMinRating: this.curateMinRating,
          curateKeywordFilters: { ...(this.curateKeywordFilters || {}) },
          curateKeywordOperators: { ...(this.curateKeywordOperators || {}) },
          curateDropboxPathPrefix: this.curateDropboxPathPrefix,
          curateFilters: { ...(this.curateFilters || {}) },
          curateImages: Array.isArray(this.curateImages) ? [...this.curateImages] : [],
          curatePageOffset: this.curatePageOffset,
          curateTotal: this.curateTotal,
          curateLoading: this.curateLoading,
          curateDragSelection: Array.isArray(this.curateDragSelection) ? [...this.curateDragSelection] : [],
          curateDragSelecting: this.curateDragSelecting,
          curateDragStartIndex: this.curateDragStartIndex,
          curateDragEndIndex: this.curateDragEndIndex,
          curateNoPositivePermatags: this.curateNoPositivePermatags,
          _curateLeftOrder: Array.isArray(this._curateLeftOrder) ? [...this._curateLeftOrder] : [],
          _curateRightOrder: Array.isArray(this._curateRightOrder) ? [...this._curateRightOrder] : [],
          _curateFlashSelectionIds: this._curateFlashSelectionIds ? new Set(this._curateFlashSelectionIds) : null,
      };
  }

  _restoreCurateState(state) {
      const next = state || this._getCurateDefaultState();
      this.curateLimit = next.curateLimit;
      this.curateOrderBy = next.curateOrderBy;
      this.curateOrderDirection = next.curateOrderDirection;
      this.curateHideDeleted = next.curateHideDeleted;
      this.curateMinRating = next.curateMinRating;
      this.curateKeywordFilters = { ...(next.curateKeywordFilters || {}) };
      this.curateKeywordOperators = { ...(next.curateKeywordOperators || {}) };
      this.curateDropboxPathPrefix = next.curateDropboxPathPrefix || '';
      this.curateFilters = { ...(next.curateFilters || buildCurateFilterObject(this)) };
      this.curateImages = Array.isArray(next.curateImages) ? [...next.curateImages] : [];
      this.curatePageOffset = next.curatePageOffset;
      this.curateTotal = next.curateTotal;
      this.curateLoading = next.curateLoading;
      this.curateDragSelection = Array.isArray(next.curateDragSelection) ? [...next.curateDragSelection] : [];
      this.curateDragSelecting = next.curateDragSelecting;
      this.curateDragStartIndex = next.curateDragStartIndex;
      this.curateDragEndIndex = next.curateDragEndIndex;
      this.curateNoPositivePermatags = next.curateNoPositivePermatags || false;
      this._curateLeftOrder = Array.isArray(next._curateLeftOrder) ? [...next._curateLeftOrder] : [];
      this._curateRightOrder = Array.isArray(next._curateRightOrder) ? [...next._curateRightOrder] : [];
      this._curateFlashSelectionIds = next._curateFlashSelectionIds ? new Set(next._curateFlashSelectionIds) : null;
      this._curateDragOrder = null;
      this._cancelCuratePressState();
  }

  // Explore hotspot handlers - now using factory to eliminate duplication
  _handleCurateExploreHotspotKeywordChange(event, targetId) {
      return this._exploreHotspotHandlers.handleKeywordChange(event, targetId);
  }

  _handleCurateExploreHotspotActionChange(event, targetId) {
      return this._exploreHotspotHandlers.handleActionChange(event, targetId);
  }

  _handleCurateExploreHotspotTypeChange(event, targetId) {
      return this._exploreHotspotHandlers.handleTypeChange(event, targetId);
  }

  _handleCurateExploreHotspotRatingChange(event, targetId) {
      return this._exploreHotspotHandlers.handleRatingChange(event, targetId);
  }

  _handleCurateExploreHotspotAddTarget() {
      return this._exploreHotspotHandlers.handleAddTarget();
  }

  _handleCurateExploreHotspotRemoveTarget(targetId) {
      return this._exploreHotspotHandlers.handleRemoveTarget(targetId);
  }

  _handleCurateExploreHotspotDrop(event, targetId) {
      return this._exploreHotspotHandlers.handleDrop(event, targetId);
  }

  _handleCurateHotspotChanged(event) {
      const { type, targetId, value } = event.detail;
      switch (type) {
          case 'keyword-change':
              return this._handleCurateExploreHotspotKeywordChange({ target: { value } }, targetId);
          case 'action-change':
              return this._handleCurateExploreHotspotActionChange({ target: { value } }, targetId);
          case 'type-change':
              return this._handleCurateExploreHotspotTypeChange({ target: { value } }, targetId);
          case 'rating-change':
              return this._handleCurateExploreHotspotRatingChange({ target: { value } }, targetId);
          case 'add-target':
              return this._handleCurateExploreHotspotAddTarget();
          case 'remove-target':
              return this._handleCurateExploreHotspotRemoveTarget(targetId);
          case 'rating-toggle':
              return this._handleCurateExploreRatingToggle({ target: { checked: event.detail.enabled } });
          case 'hotspot-drop':
              return this._handleCurateExploreHotspotDrop(event.detail.event, targetId);
          default:
              console.warn('Unknown hotspot event type:', type);
      }
  }

  _handleCurateAuditHotspotChanged(event) {
      const { type, targetId, value } = event.detail;
      switch (type) {
          case 'keyword-change':
              return this._handleCurateAuditHotspotKeywordChange({ target: { value } }, targetId);
          case 'action-change':
              return this._handleCurateAuditHotspotActionChange({ target: { value } }, targetId);
          case 'type-change':
              return this._handleCurateAuditHotspotTypeChange({ target: { value } }, targetId);
          case 'rating-change':
              return this._handleCurateAuditHotspotRatingChange({ target: { value } }, targetId);
          case 'add-target':
              return this._handleCurateAuditHotspotAddTarget();
          case 'remove-target':
              return this._handleCurateAuditHotspotRemoveTarget(targetId);
          case 'hotspot-drop':
              return this._handleCurateAuditHotspotDrop(event.detail.event, targetId);
          default:
              console.warn('Unknown audit hotspot event type:', type);
      }
  }

  _removeCurateImagesByIds(ids) {
      if (!ids?.length) return;
      const removeSet = new Set(ids);
      const keep = (image) => !removeSet.has(image.id);
      this.curateImages = this.curateImages.filter(keep);
      this.curateDragSelection = this.curateDragSelection.filter((id) => !removeSet.has(id));
  }

  _removeAuditImagesByIds(ids) {
      if (!ids?.length) return;
      const removeSet = new Set(ids);
      const keep = (image) => !removeSet.has(image.id);
      this.curateAuditImages = this.curateAuditImages.filter(keep);
      this.curateAuditDragSelection = this.curateAuditDragSelection.filter((id) => !removeSet.has(id));
  }

  _processExploreTagDrop(ids, target) {
      const signum = target.action === 'remove' ? -1 : 1;
      const category = target.category || 'Uncategorized';
      const operations = ids.map((imageId) => ({
          image_id: imageId,
          keyword: target.keyword,
          category,
          signum,
      }));
      enqueueCommand({
          type: 'bulk-permatags',
          tenantId: this.tenant,
          operations,
          description: `hotspot · ${operations.length} updates`,
      });
      const tags = [{ keyword: target.keyword, category }];
      if (signum === 1) {
          this._updateCuratePermatags(ids, tags);
      } else {
          this._updateCuratePermatagRemovals(ids, tags);
      }
      this._removeCurateImagesByIds(ids);
  }

  _processAuditTagDrop(ids, target) {
      const idSet = new Set(ids);
      const additions = this.curateAuditImages.filter((img) => idSet.has(img.id));
      if (!additions.length) {
          return;
      }
      const signum = target.action === 'remove' ? -1 : 1;
      const category = target.category || 'Uncategorized';
      const operations = additions.map((image) => ({
          image_id: image.id,
          keyword: target.keyword,
          category,
          signum,
      }));
      enqueueCommand({
          type: 'bulk-permatags',
          tenantId: this.tenant,
          operations,
          description: `tag audit · ${operations.length} updates`,
      });
      additions.forEach((image) => {
          this._applyAuditPermatagChange(image, signum, target.keyword, category);
      });
      this.curateAuditImages = this.curateAuditImages.filter((img) => !idSet.has(img.id));
      this.curateAuditDragSelection = this.curateAuditDragSelection.filter((id) => !idSet.has(id));
  }

  _syncAuditHotspotPrimary() {
      const defaultAction = this.curateAuditMode === 'existing' ? 'remove' : 'add';
      const keyword = this.curateAuditKeyword || '';
      let category = '';
      if (keyword) {
          category = this.curateAuditCategory || '';
          if (!category) {
              const match = (this.keywords || []).find((kw) => kw?.keyword === keyword);
              category = match?.category || '';
          }
          if (!category) {
              category = 'Uncategorized';
          }
      }
      if (keyword && category && this.curateAuditCategory !== category) {
          this.curateAuditCategory = category;
      }
      if (!this.curateAuditTargets || !this.curateAuditTargets.length) {
          this.curateAuditTargets = [
              { id: 1, type: 'keyword', category, keyword, action: defaultAction, count: 0 },
          ];
          this._curateAuditHotspotNextId = 2;
          return;
      }
      const [first, ...rest] = this.curateAuditTargets;
      const nextFirst = {
          ...first,
          type: first?.type || 'keyword',
          category,
          keyword,
          action: defaultAction,
      };
      if (!keyword || first.keyword !== keyword || first.action !== defaultAction) {
          nextFirst.count = 0;
      }
      this.curateAuditTargets = [nextFirst, ...rest];
  }

  _handleCurateAuditHotspotKeywordChange(event, targetId) {
      const value = event.target.value;
      const { category, keyword } = parseUtilityKeywordValue(value);
      this.curateAuditTargets = (this.curateAuditTargets || []).map((target) => (
          target.id === targetId ? { ...target, category, keyword, count: 0 } : target
      ));
  }

  _handleCurateAuditHotspotActionChange(event, targetId) {
      const action = event.target.value === 'remove' ? 'remove' : 'add';
      this.curateAuditTargets = (this.curateAuditTargets || []).map((target) => (
          target.id === targetId ? { ...target, action, count: 0 } : target
      ));
  }

  _handleCurateAuditHotspotTypeChange(event, targetId) {
      const type = event.target.value;
      this.curateAuditTargets = (this.curateAuditTargets || []).map((target) => (
          target.id === targetId ? { ...target, type, keyword: '', category: '', rating: '', action: 'add', count: 0 } : target
      ));
  }

  _handleCurateAuditHotspotRatingChange(event, targetId) {
      const rating = Number.parseInt(event.target.value, 10);
      this.curateAuditTargets = (this.curateAuditTargets || []).map((target) => (
          target.id === targetId ? { ...target, rating, count: 0 } : target
      ));
  }

  _handleCurateAuditHotspotAddTarget() {
      const nextId = this._curateAuditHotspotNextId || 1;
      this._curateAuditHotspotNextId = nextId + 1;
      this.curateAuditTargets = [
          ...(this.curateAuditTargets || []),
          { id: nextId, category: '', keyword: '', action: 'add', count: 0 },
      ];
  }

  _handleCurateAuditHotspotRemoveTarget(targetId) {
      if (!this.curateAuditTargets || this.curateAuditTargets.length <= 1) {
          return;
      }
      const firstId = this.curateAuditTargets[0]?.id;
      if (targetId === firstId) {
          return;
      }
      this.curateAuditTargets = this.curateAuditTargets.filter((target) => target.id !== targetId);
      if (this._curateAuditHotspotDragTarget === targetId) {
          this._curateAuditHotspotDragTarget = null;
      }
  }

  _handleCurateAuditHotspotDragOver(event, targetId) {
      event.preventDefault();
      if (this._curateAuditHotspotDragTarget !== targetId) {
          this._curateAuditHotspotDragTarget = targetId;
          this.requestUpdate();
      }
  }

  _handleCurateAuditHotspotDragLeave() {
      if (this._curateAuditHotspotDragTarget !== null) {
          this._curateAuditHotspotDragTarget = null;
          this.requestUpdate();
      }
  }

  _handleCurateAuditHotspotDrop(event, targetId) {
      event.preventDefault();
      const raw = event.dataTransfer?.getData('text/plain') || '';
      const ids = raw
          .split(',')
          .map((value) => Number.parseInt(value.trim(), 10))
          .filter((value) => Number.isFinite(value) && value > 0);
      if (!ids.length) {
          this._handleCurateAuditHotspotDragLeave();
          return;
      }
      const target = (this.curateAuditTargets || []).find((entry) => entry.id === targetId);
      if (!target) {
          this._handleCurateAuditHotspotDragLeave();
          return;
      }

      if (target.type === 'rating') {
          if (typeof target.rating !== 'number' || target.rating < 0 || target.rating > 3) {
              this._handleCurateAuditHotspotDragLeave();
              return;
          }
          this._applyAuditRating(ids, target.rating);
          this.curateAuditTargets = this.curateAuditTargets.map((entry) => (
              entry.id === targetId ? { ...entry, count: (entry.count || 0) + ids.length } : entry
          ));
      } else {
          if (!target.keyword) {
              this._handleCurateAuditHotspotDragLeave();
              return;
          }
          const idSet = new Set(ids);
          const additions = this.curateAuditImages.filter((img) => idSet.has(img.id));
          if (!additions.length) {
              this._handleCurateAuditHotspotDragLeave();
              return;
          }
          const signum = target.action === 'remove' ? -1 : 1;
          const category = target.category || 'Uncategorized';
          const operations = additions.map((image) => ({
              image_id: image.id,
              keyword: target.keyword,
              category,
              signum,
          }));
          enqueueCommand({
              type: 'bulk-permatags',
              tenantId: this.tenant,
              operations,
              description: `tag audit · ${operations.length} updates`,
          });
          additions.forEach((image) => {
              this._applyAuditPermatagChange(image, signum, target.keyword, category);
          });
          this.curateAuditImages = this.curateAuditImages.filter((img) => !idSet.has(img.id));
          this.curateAuditDragSelection = this.curateAuditDragSelection.filter((id) => !idSet.has(id));
          this.curateAuditTargets = this.curateAuditTargets.map((entry) => (
              entry.id === targetId ? { ...entry, count: (entry.count || 0) + additions.length } : entry
          ));
      }
      this._handleCurateAuditHotspotDragLeave();
  }

  // Explore rating drag handlers - now using factory to eliminate duplication
  _handleCurateExploreRatingToggle() {
      return this._exploreRatingHandlers.handleToggle();
  }

  _handleCurateExploreRatingDrop(event) {
      return this._exploreRatingHandlers.handleDrop(event);
  }

  // Audit rating drag handlers - now using factory to eliminate duplication
  _handleCurateAuditRatingToggle() {
      return this._auditRatingHandlers.handleToggle();
  }

  _handleCurateAuditRatingDragOver(event) {
      return this._auditRatingHandlers.handleDragOver(event);
  }

  _handleCurateAuditRatingDragLeave() {
      return this._auditRatingHandlers.handleDragLeave();
  }

  _handleCurateAuditRatingDrop(event) {
      return this._auditRatingHandlers.handleDrop(event);
  }

  connectedCallback() {
      super.connectedCallback();
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
          this._tabBootstrapped.add(key);
          return;
      }

      if (!this.tenant) {
          return;
      }

      switch (tab) {
          case 'search': {
              this.fetchKeywords();
              this.fetchStats({
                  includeRatings: this.searchSubTab === 'explore-by-tag',
                  includeMlStats: false,
                  includeTagStats: false,
              });
              if (this.searchSubTab === 'home') {
                  if (!this.searchImages?.length) {
                      const searchFilters = this.searchFilterPanel.getState();
                      this.searchFilterPanel.updateFilters(searchFilters);
                      this.searchFilterPanel.fetchImages();
                  }
              } else if (this.searchSubTab === 'explore-by-tag') {
                  this._loadExploreByTagData();
              }
              break;
          }
          case 'curate': {
              this.fetchKeywords();
              this.fetchStats({ includeTagStats: this.curateSubTab === 'home' }).finally(() => {
                  this._curateHomeLastFetchKey = getCurateHomeFetchKey(this);
              });
              if (this.curateSubTab === 'main') {
                  const curateFilters = buildCurateFilterObject(this);
                  this.curateHomeFilterPanel.updateFilters(curateFilters);
                  if (!this.curateImages?.length && !this.curateLoading) {
                      this._fetchCurateHomeImages();
                  }
              } else if (this.curateSubTab === 'tag-audit' && this.curateAuditKeyword) {
                  const fetchKey = getCurateAuditFetchKey(this, { loadAll: this.curateAuditLoadAll, offset: this.curateAuditPageOffset || 0 });
                  if (!this._curateAuditLastFetchKey || this._curateAuditLastFetchKey !== fetchKey) {
                      this._fetchCurateAuditImages();
                  }
              }
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
      console.log('[Rating] _showExploreRatingDialog called with ids:', imageIds);
      this._curateRatingModalImageIds = imageIds;
      this._curateRatingModalSource = 'explore';
      this._curateRatingModalActive = true;
      console.log('[Rating] Modal state set, active:', this._curateRatingModalActive);
      this.requestUpdate();
  }

  _showAuditRatingDialog(imageIds) {
      console.log('[Rating] _showAuditRatingDialog called with ids:', imageIds);
      this._curateRatingModalImageIds = imageIds;
      this._curateRatingModalSource = 'audit';
      this._curateRatingModalActive = true;
      console.log('[Rating] Modal state set, active:', this._curateRatingModalActive);
      this.requestUpdate();
  }

  _handleRatingModalClick(rating) {
      if (!this._curateRatingModalImageIds?.length) {
          console.log('[Rating] No image IDs found');
          return;
      }
      const ids = this._curateRatingModalImageIds;
      const source = this._curateRatingModalSource;
      console.log('[Rating] Modal clicked, rating:', rating, 'ids:', ids, 'source:', source);
      this._closeRatingModal();
      if (source === 'explore') {
          console.log('[Rating] Applying explore rating');
          this._applyExploreRating(ids, rating);
      } else if (source === 'audit') {
          console.log('[Rating] Applying audit rating');
          this._applyAuditRating(ids, rating);
      }
  }

  _closeRatingModal() {
      this._curateRatingModalActive = false;
      this._curateRatingModalImageIds = null;
      this._curateRatingModalSource = null;
      this.requestUpdate();
  }

  _handleEscapeKey(e) {
      if (e.key === 'Escape' && this._curateRatingModalActive) {
          this._closeRatingModal();
      }
  }

  async _applyExploreRating(imageIds, rating) {
      console.log('[Rating] _applyExploreRating called with ids:', imageIds, 'rating:', rating);
      try {
          const promises = imageIds.map((imageId) => {
              console.log('[Rating] Sending PATCH for image:', imageId);
              return fetchWithAuth(`/images/${imageId}/rating`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ rating }),
                  tenantId: this.tenant,
              });
          });
          const results = await Promise.all(promises);
          console.log('[Rating] All requests completed, results:', results);
          this.curateExploreRatingCount += imageIds.length;
          console.log('[Rating] Updated count to:', this.curateExploreRatingCount);
          this._removeCurateImagesByIds(imageIds);
          console.log('[Rating] Images removed from list');
          this.requestUpdate();
          console.log('[Rating] RequestUpdate called');
      } catch (err) {
          console.error('[Rating] Failed to apply explore rating:', err);
      }
  }

  async _applyAuditRating(imageIds, rating) {
      const idSet = new Set(imageIds);
      try {
          await Promise.all(imageIds.map((imageId) =>
              fetchWithAuth(`/images/${imageId}/rating`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ rating }),
                  tenantId: this.tenant,
              })
          ));
          this.curateAuditRatingCount += imageIds.length;
          this.curateAuditImages = this.curateAuditImages.filter((img) => !idSet.has(img.id));
          this.curateAuditDragSelection = this.curateAuditDragSelection.filter((id) => !idSet.has(id));
          this.requestUpdate();
      } catch (err) {
          console.error('Failed to apply audit rating:', err);
      }
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
      // NEW: Use filter panel for Curate Home
      const curateFilters = buildCurateFilterObject(this, { resetOffset });

      // Check special case before fetching
      if (this.curateMinRating === 0 && this.curateHideDeleted) {
          this.curateImages = [];
          this.curateTotal = 0;
          return;
      }

      // Update filter panel and fetch
      this.curateHomeFilterPanel.updateFilters(curateFilters);
      this._fetchCurateHomeImages();

      // Keep local mirror for UI state (no deprecated builder)
      if (resetOffset) {
          this.curatePageOffset = 0;
      }
      this.curateFilters = { ...curateFilters };
  }

  _handleCurateOrderByChange(e) {
      this.curateOrderBy = e.target.value;

      // Refresh the currently active tab only
      if (this.curateSubTab === 'main') {
          const curateFilters = buildCurateFilterObject(this, { resetOffset: true });
          this.curateHomeFilterPanel.updateFilters(curateFilters);
          this._fetchCurateHomeImages();
      } else if (this.curateSubTab === 'tag-audit' && this.curateAuditKeyword) {
          this._fetchCurateAuditImages();
      }
  }

  _handleCurateOrderDirectionChange(e) {
      this.curateOrderDirection = e.target.value;

      // Refresh the currently active tab only
      if (this.curateSubTab === 'main') {
          const curateFilters = buildCurateFilterObject(this, { resetOffset: true });
          this.curateHomeFilterPanel.updateFilters(curateFilters);
          this._fetchCurateHomeImages();
      } else if (this.curateSubTab === 'tag-audit' && this.curateAuditKeyword) {
          this._fetchCurateAuditImages();
      }
  }

  _handleCurateQuickSort(orderBy) {
      if (this.curateOrderBy === orderBy) {
          this.curateOrderDirection = this.curateOrderDirection === 'desc' ? 'asc' : 'desc';
      } else {
          this.curateOrderBy = orderBy;
          this.curateOrderDirection = 'desc';
      }

      // Refresh the currently active tab only
      if (this.curateSubTab === 'main') {
          const curateFilters = buildCurateFilterObject(this, { resetOffset: true });
          this.curateHomeFilterPanel.updateFilters(curateFilters);
          this._fetchCurateHomeImages();
      } else if (this.curateSubTab === 'tag-audit' && this.curateAuditKeyword) {
          this._fetchCurateAuditImages();
      }
  }

  // Explore selection handlers - now using factory to eliminate duplication
  _cancelCuratePressState() {
      return this._exploreSelectionHandlers.cancelPressState();
  }

  // Audit selection handlers - now using factory to eliminate duplication
  _cancelCurateAuditPressState() {
      return this._auditSelectionHandlers.cancelPressState();
  }

  _startCurateSelection(index, imageId) {
      return this._exploreSelectionHandlers.startSelection(index, imageId);
  }

  _startCurateAuditSelection(index, imageId) {
      return this._auditSelectionHandlers.startSelection(index, imageId);
  }

  _handleCuratePointerDown(event, index, imageId) {
      return this._exploreSelectionHandlers.handlePointerDown(event, index, imageId);
  }

  _handleCurateKeywordSelect(event, mode) {
      const rawValue = event.target.value || '';
      if (!rawValue) {
          if (mode === 'tag-audit') {
              this.curateAuditKeyword = '';
              this.curateAuditCategory = '';
              this.curateAuditSelection = [];
              this.curateAuditDragSelection = [];
              this.curateAuditDragTarget = null;
              this.curateAuditOffset = 0;
              this.curateAuditTotal = null;
              this.curateAuditLoadAll = false;
              this.curateAuditPageOffset = 0;
              this.curateAuditImages = [];
          } else {
              this.curateKeywordFilters = {};
              this.curateKeywordOperators = {};
              this.curateNoPositivePermatags = false;
              this._applyCurateFilters();
          }
          return;
      }

      if (mode !== 'tag-audit' && rawValue === '__untagged__') {
          this.curateKeywordFilters = {};
          this.curateKeywordOperators = {};
          this.curateNoPositivePermatags = true;
          this._applyCurateFilters({ resetOffset: true });
          return;
      }

      const [encodedCategory, ...encodedKeywordParts] = rawValue.split('::');
      const category = decodeURIComponent(encodedCategory || '');
      const keyword = decodeURIComponent(encodedKeywordParts.join('::') || '');

      if (mode === 'tag-audit') {
          this.curateAuditKeyword = keyword;
          this.curateAuditCategory = category;
          this.curateAuditSelection = [];
          this.curateAuditDragSelection = [];
          this.curateAuditDragTarget = null;
          this.curateAuditOffset = 0;
          this.curateAuditTotal = null;
          this.curateAuditLoadAll = false;
          this.curateAuditPageOffset = 0;
          if (!keyword) {
              this.curateAuditImages = [];
              return;
          }
          // Only fetch audit images, don't update Explore tab
          this._fetchCurateAuditImages();
          return;
      }

      const nextKeywords = {};
      if (keyword) {
          nextKeywords[category || 'Uncategorized'] = new Set([keyword]);
      }
      this.curateKeywordFilters = nextKeywords;
      this.curateKeywordOperators = keyword ? { [category || 'Uncategorized']: 'OR' } : {};
      this.curateNoPositivePermatags = false;
      this._applyCurateFilters({ resetOffset: true });
  }

  _handleCurateTagSourceChange(e) {
      this.activeCurateTagSource = e.detail?.source || 'permatags';
      this._updateCurateCategoryCards();
  }

  _updateCurateCategoryCards() {
      const sourceStats = this.tagStatsBySource?.[this.activeCurateTagSource] || {};
      this.curateCategoryCards = buildCategoryCards(sourceStats, true);
  }

  _getKeywordsByCategory() {
      return getKeywordsByCategory(this.tagStatsBySource, this.activeCurateTagSource);
  }

  _getCategoryCount(category) {
      return getCategoryCount(this.tagStatsBySource, category, this.activeCurateTagSource);
  }

  _handleCurateHideDeletedChange(e) {
      this.curateHideDeleted = e.target.checked;
      this._applyCurateFilters({ resetOffset: true });
  }

  _handleCurateNoPositivePermatagsChange(e) {
      this.curateNoPositivePermatags = e.target.checked;

      // Refresh the currently active tab only
      if (this.curateSubTab === 'main') {
          const curateFilters = buildCurateFilterObject(this, { resetOffset: true });
          this.curateHomeFilterPanel.updateFilters(curateFilters);
          this._fetchCurateHomeImages();
      } else if (this.curateSubTab === 'tag-audit' && this.curateAuditKeyword) {
          this._fetchCurateAuditImages();
      }
  }

  _handleCurateAuditNoPositivePermatagsChange(e) {
      this.curateAuditNoPositivePermatags = e.target.checked;
      if (this.curateAuditKeyword) {
          this._fetchCurateAuditImages();
      }
  }

  _handleCurateMinRating(value) {
      // Toggle rating filter - if same value clicked, clear it
      const newRating = (this.curateMinRating === value) ? null : value;

      // Update state variable for UI styling
      this.curateMinRating = newRating;

      // Refresh the currently active tab only
      if (this.curateSubTab === 'main') {
          // Update Explore tab
          const curateFilters = buildCurateFilterObject(this, {
              rating: newRating,
              resetOffset: true
          });
          this.curateHomeFilterPanel.updateFilters(curateFilters);
          this._fetchCurateHomeImages();
      } else if (this.curateSubTab === 'tag-audit' && this.curateAuditKeyword) {
          // Update Audit tab (both existing and missing share same settings)
          this._fetchCurateAuditImages();
      }
  }

  _handleCurateAuditMinRating(value) {
      const newRating = (this.curateAuditMinRating === value) ? null : value;
      this.curateAuditMinRating = newRating;
      if (this.curateAuditKeyword) {
          this._fetchCurateAuditImages();
      }
  }

  _handleCurateAuditHideDeletedChange(e) {
      this.curateAuditHideDeleted = e.target.checked;
      if (this.curateAuditKeyword) {
          this._fetchCurateAuditImages();
      }
  }

  _startCurateLoading() {
      this._curateLoadCount = (this._curateLoadCount || 0) + 1;
      this.curateLoading = true;
  }

  _finishCurateLoading() {
      this._curateLoadCount = Math.max(0, (this._curateLoadCount || 1) - 1);
      this.curateLoading = this._curateLoadCount > 0;
  }

  async _fetchCurateHomeImages() {
      if (!this.curateHomeFilterPanel) return;
      this._startCurateLoading();
      try {
          return await this.curateHomeFilterPanel.fetchImages();
      } finally {
          this._finishCurateLoading();
      }
  }

  _getDefaultNewListTitle() {
      const now = new Date();
      const pad = (value) => String(value).padStart(2, '0');
      const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      return `${date}:${time} new list`;
  }

  _getUniqueNewListTitle() {
      const base = this._getDefaultNewListTitle();
      if (!this._isDuplicateListTitle(base)) {
          return base;
      }
      let suffix = 2;
      let candidate = `${base} (${suffix})`;
      while (this._isDuplicateListTitle(candidate)) {
          suffix += 1;
          candidate = `${base} (${suffix})`;
      }
      return candidate;
  }

  _resetSearchListDraft() {
      this.searchListId = null;
      this.searchListTitle = this._getUniqueNewListTitle();
      this.searchSavedItems = [];
      this.searchListPromptNewTitle = false;
  }

  async _refreshCurateHome() {
      if (this.curateHomeRefreshing) return;
      this.curateHomeRefreshing = true;
      try {
          await this.fetchStats({ force: true, includeTagStats: true });
          this._curateHomeLastFetchKey = getCurateHomeFetchKey(this);
      } finally {
          this.curateHomeRefreshing = false;
      }
  }

  _isDuplicateListTitle(title, excludeId = null) {
      const normalized = (title || '').trim().toLowerCase();
      if (!normalized) return false;
      return (this.searchLists || []).some((list) => {
          if (excludeId && list.id === excludeId) return false;
          return (list.title || '').trim().toLowerCase() === normalized;
      });
  }

  _handleTenantChange(e) {
      this.tenant = e.detail;
      // Update tenant on all filter panels
      this.searchFilterPanel.setTenant(this.tenant);
      this.curateHomeFilterPanel.setTenant(this.tenant);
      this.curateAuditFilterPanel.setTenant(this.tenant);

      this.curateHideDeleted = true;
      this.curateMinRating = null;
      this.curateNoPositivePermatags = false;
      this.curateKeywordFilters = {};
      this.curateKeywordOperators = {};
      this.curateDropboxPathPrefix = '';
      this.curateFilters = buildCurateFilterObject(this, { resetOffset: true });
      this.curatePageOffset = 0;
      this.curateTotal = null;
      this.curateImages = [];
      const curateFilters = buildCurateFilterObject(this, { resetOffset: true });
      this.curateHomeFilterPanel.updateFilters(curateFilters);
      this.curateDragSelection = [];
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
      this.curateAuditOffset = 0;
      this.curateAuditTotal = null;
      this.curateAuditLoading = false;
      this.curateAuditLoadAll = false;
      this.curateAuditPageOffset = 0;
      this.curateAuditAiEnabled = false;
      this.curateAuditAiModel = '';
      this.curateAuditDropboxPathPrefix = '';
      this._curateAuditLastFetchKey = null;
      this._curateHomeLastFetchKey = null;
      this._curateStatsAutoRefreshDone = false;
      this._resetSearchListDraft();
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
      const chips = event.detail?.filters || [];
      const nextKeywords = {};
      const nextOperators = {};
      let nextMinRating = null;
      let nextNoPositivePermatags = false;
      let nextDropboxPathPrefix = '';
      let nextHideDeleted = true;

      chips.forEach((chip) => {
          switch (chip.type) {
              case 'keyword':
                  if (chip.value === '__untagged__') {
                      nextNoPositivePermatags = true;
                  } else if (chip.value) {
                      const category = chip.category || 'Uncategorized';
                      if (!nextKeywords[category]) {
                          nextKeywords[category] = new Set();
                      }
                      nextKeywords[category].add(chip.value);
                      nextOperators[category] = 'OR';
                  }
                  break;
              case 'rating':
                  if (chip.value === 'unrated') {
                      nextMinRating = 'unrated';
                      nextHideDeleted = true;
                  } else {
                      nextMinRating = chip.value;
                      nextHideDeleted = false;
                  }
                  break;
              case 'folder':
                  nextDropboxPathPrefix = chip.value || '';
                  break;
          }
      });

      if (nextNoPositivePermatags) {
          Object.keys(nextKeywords).forEach((key) => delete nextKeywords[key]);
          Object.keys(nextOperators).forEach((key) => delete nextOperators[key]);
      }

      this.curateKeywordFilters = nextKeywords;
      this.curateKeywordOperators = nextOperators;
      this.curateNoPositivePermatags = nextNoPositivePermatags;
      this.curateMinRating = nextMinRating;
      this.curateHideDeleted = nextHideDeleted;
      this.curateDropboxPathPrefix = nextDropboxPathPrefix;

      this._applyCurateFilters({ resetOffset: true });
  }

  _handleCurateAuditChipFiltersChanged(event) {
      const chips = event.detail?.filters || [];
      const keywordChip = chips.find((chip) => chip.type === 'keyword');
      const nextKeyword = keywordChip?.value || '';
      let nextCategory = keywordChip?.category || '';
      let nextMinRating = null;
      let nextHideDeleted = true;
      let nextDropboxPathPrefix = '';

      chips.forEach((chip) => {
          switch (chip.type) {
              case 'rating':
                  if (chip.value === 'unrated') {
                      nextMinRating = 'unrated';
                      nextHideDeleted = true;
                  } else {
                      nextMinRating = chip.value;
                      nextHideDeleted = false;
                  }
                  break;
              case 'folder':
                  nextDropboxPathPrefix = chip.value || '';
                  break;
          }
      });

      nextCategory = resolveKeywordCategory(nextKeyword, {
          fallbackCategory: nextCategory,
          keywords: this.keywords,
          tagStatsBySource: this.tagStatsBySource,
          activeTagSource: this.activeCurateTagSource,
      });
      const keywordChanged = nextKeyword !== this.curateAuditKeyword
          || nextCategory !== this.curateAuditCategory;

      this.curateAuditKeyword = nextKeyword;
      this.curateAuditCategory = nextCategory;
      this.curateAuditMinRating = nextMinRating;
      this.curateAuditHideDeleted = nextHideDeleted;
      this.curateAuditDropboxPathPrefix = nextDropboxPathPrefix;
      this.curateAuditPageOffset = 0;
      this.curateAuditOffset = 0;
      this.curateAuditLoadAll = false;

      const defaultAction = this.curateAuditMode === 'existing' ? 'remove' : 'add';
      const [firstTarget, ...restTargets] = this.curateAuditTargets || [];
      const primaryType = firstTarget?.type || 'keyword';
      const primaryId = firstTarget?.id || 1;
      this.curateAuditTargets = [
          {
              ...firstTarget,
              id: primaryId,
              type: primaryType,
              category: nextKeyword ? nextCategory : '',
              keyword: nextKeyword,
              action: defaultAction,
              count: 0,
          },
          ...restTargets,
      ];

      if (keywordChanged) {
          this.curateAuditSelection = [];
          this.curateAuditDragSelection = [];
          this.curateAuditDragTarget = null;
          this.curateAuditDragSelecting = false;
          this.curateAuditDragStartIndex = null;
          this.curateAuditDragEndIndex = null;
      }
      this._syncAuditHotspotPrimary();

      if (!this.curateAuditKeyword) {
          this.curateAuditImages = [];
          this.curateAuditTotal = null;
          return;
      }

      this._fetchCurateAuditImages();
  }

  async _fetchDropboxFolders(query) {
      if (!this.tenant) return;
      this.searchDropboxLoading = true;
      try {
          const response = await getDropboxFolders(this.tenant, { query });
          this.searchDropboxOptions = response.folders || [];
      } catch (error) {
          console.error('Failed to fetch Dropbox folders:', error);
          this.searchDropboxOptions = [];
      } finally {
          this.searchDropboxLoading = false;
      }
  }

  _handleCurateDragStart(event, image) {
      if (this.curateDragSelecting) {
          event.preventDefault();
          return;
      }
      if (this._curatePressActive) {
          this._cancelCuratePressState();
      }
      let ids = [image.id];
      if (this.curateDragSelection.length && this.curateDragSelection.includes(image.id)) {
          ids = this.curateDragSelection;
      } else if (this.curateDragSelection.length) {
          this.curateDragSelection = [image.id];
      }
      event.dataTransfer.setData('text/plain', ids.join(','));
      event.dataTransfer.setData('application/x-photocat-source', 'available');
      event.dataTransfer.effectAllowed = 'move';
  }

  _handleCurateThumbSizeChange(event) {
      this.curateThumbSize = Number(event.target.value);
  }

  _shouldAutoRefreshCurateStats() {
      if (this._curateStatsAutoRefreshDone) {
          return false;
      }
      if (this.curateHomeRefreshing || this.curateStatsLoading) {
          return false;
      }
      const sourceKey = this.activeCurateTagSource || 'permatags';
      const sourceStats = this.tagStatsBySource?.[sourceKey] || null;
      const hasTagStats = !!(sourceStats && Object.keys(sourceStats).length > 0);
      const hasCategoryCards = Array.isArray(this.curateCategoryCards) && this.curateCategoryCards.length > 0;
      return !hasTagStats && !hasCategoryCards;
  }

  _handleCurateSubTabChange(nextTab) {
      if (!nextTab || this.curateSubTab === nextTab) {
          return;
      }
      const prevTab = this.curateSubTab;
      if (prevTab === 'main') {
          this._curateSubTabState[prevTab] = this._snapshotCurateState();
          this._curateActiveWorkingTab = prevTab;
      }
      this.curateSubTab = nextTab;
      if (nextTab === 'main') {
          const saved = this._curateSubTabState[nextTab];
          if (saved) {
              this._restoreCurateState(saved);
          } else {
              this._restoreCurateState(this._getCurateDefaultState());
              this._curateSubTabState[nextTab] = this._snapshotCurateState();
          }
          if (!this.curateImages.length && !this.curateLoading) {
              // Use filter panel instead of deprecated method
              const curateFilters = buildCurateFilterObject(this);
              this.curateHomeFilterPanel.updateFilters(curateFilters);
              this._fetchCurateHomeImages();
          }
      }
      if (nextTab === 'home') {
          const fetchKey = getCurateHomeFetchKey(this);
          if (!this._curateHomeLastFetchKey || this._curateHomeLastFetchKey !== fetchKey) {
              this.fetchStats({ includeRatings: true }).finally(() => {
                  this._curateHomeLastFetchKey = fetchKey;
              });
          }
          if (this._shouldAutoRefreshCurateStats()) {
              this._curateStatsAutoRefreshDone = true;
              this._refreshCurateHome();
          }
      }
      if (nextTab === 'tag-audit' && this.curateAuditKeyword) {
          const fetchKey = getCurateAuditFetchKey(this, { loadAll: this.curateAuditLoadAll, offset: this.curateAuditPageOffset || 0 });
          if (!this._curateAuditLastFetchKey || this._curateAuditLastFetchKey !== fetchKey) {
              this._fetchCurateAuditImages();
          }
      }
  }

  async _loadExploreByTagData(forceRefresh = false) {
      if (!this.tenant) return;
      this.exploreByTagLoading = true;
      if (!this.imageStats?.rating_by_category || !Object.keys(this.imageStats.rating_by_category || {}).length) {
          if (!this._exploreByTagStatsPromise) {
              this._exploreByTagStatsPromise = this.fetchStats({
                  includeRatings: true,
                  includeMlStats: false,
                  includeTagStats: false,
              }).catch((error) => {
                  console.error('Error fetching explore-by-tag stats:', error);
              }).finally(() => {
                  this._exploreByTagStatsPromise = null;
              });
              this._exploreByTagStatsPromise.then(() => {
                  if (!this.imageStats?.rating_by_category || !Object.keys(this.imageStats.rating_by_category || {}).length) {
                      this.exploreByTagLoading = false;
                      return;
                  }
                  this._loadExploreByTagData(forceRefresh);
              });
          }
          return;
      }
      try {
          // Get all keywords with 2+ star ratings
          const keywordsByRating = {};
          const imageStats = this.imageStats;

          if (imageStats?.rating_by_category) {
              Object.entries(imageStats.rating_by_category).forEach(([category, categoryData]) => {
                  Object.entries(categoryData.keywords || {}).forEach(([keyword, keywordData]) => {
                      const twoStarPlus = (keywordData.stars_2 || 0) + (keywordData.stars_3 || 0);
                      if (twoStarPlus > 0) {
                          // Use category - keyword format to match template rendering
                          const keywordName = `${category} - ${keyword}`;
                          keywordsByRating[keywordName] = { category, keyword, twoStarPlus };
                      }
                  });
              });
          }

          // Fetch images for each keyword, sorted alphabetically
          const sortedKeywords = Object.entries(keywordsByRating).sort(([a], [b]) => a.localeCompare(b));
          const exploreByTagData = {};
          const exploreByTagKeywords = [];
          for (const [keywordName, data] of sortedKeywords) {
              const cacheKey = `exploreByTag_${keywordName}`;
              let cachedImages = this[cacheKey];
              if (forceRefresh || !Array.isArray(cachedImages)) {
                  try {
                      const result = await getImages(this.tenant, {
                          permatagKeyword: data.keyword,
                          permatagCategory: data.category,
                          permatagSignum: 1,
                          rating: 2,
                          ratingOperator: 'gte',
                          limit: 10,
                          orderBy: 'rating',
                          sortOrder: 'desc'
                      });
                      const images = Array.isArray(result) ? result : (result?.images || []);
                      // Filter out any invalid images before caching
                      cachedImages = images.filter(img => img && img.id);
                      this[cacheKey] = cachedImages;
                  } catch (error) {
                      console.error(`Error loading images for keyword "${keywordName}":`, error);
                      cachedImages = [];
                  }
              }
              exploreByTagData[keywordName] = cachedImages || [];
              exploreByTagKeywords.push(keywordName);
          }
          this.exploreByTagData = exploreByTagData;
          this.exploreByTagKeywords = exploreByTagKeywords;
      } finally {
          this.exploreByTagLoading = false;
      }
  }

  _handleCurateAuditModeChange(valueOrEvent) {
      const nextValue = typeof valueOrEvent === 'string'
          ? valueOrEvent
          : valueOrEvent.target.value;
      this.curateAuditMode = nextValue;
      this.curateAuditSelection = [];
      this.curateAuditDragSelection = [];
      this.curateAuditDragTarget = null;
      this.curateAuditOffset = 0;
      this.curateAuditTotal = null;
      this.curateAuditLoadAll = false;
      this.curateAuditPageOffset = 0;
      if (this.curateAuditKeyword) {
          this._fetchCurateAuditImages();
      }
  }

  _handleCurateAuditAiEnabledChange(event) {
      this.curateAuditAiEnabled = event.target.checked;
      if (!this.curateAuditAiEnabled) {
          this.curateAuditAiModel = '';
      }
      this.curateAuditOffset = 0;
      this.curateAuditTotal = null;
      this.curateAuditLoadAll = false;
      this.curateAuditPageOffset = 0;
      if (this.curateAuditKeyword && this.curateAuditMode === 'missing') {
          this._fetchCurateAuditImages();
      }
  }

  _handleCurateAuditAiModelChange(nextModel) {
      this.curateAuditAiModel = this.curateAuditAiModel === nextModel ? '' : nextModel;
      this.curateAuditOffset = 0;
      this.curateAuditTotal = null;
      this.curateAuditLoadAll = false;
      this.curateAuditPageOffset = 0;
      if (this.curateAuditKeyword && this.curateAuditMode === 'missing') {
          this._fetchCurateAuditImages();
      }
  }

  _handleCurateAuditKeywordChange(e) {
      const detail = e.detail || {};
      let nextKeyword = '';
      let nextCategory = '';
      for (const [category, keywordsSet] of Object.entries(detail.keywords || {})) {
          if (keywordsSet && keywordsSet.size > 0) {
              const [keyword] = Array.from(keywordsSet);
              if (keyword) {
                  nextKeyword = keyword.trim();
                  nextCategory = category;
                  break;
              }
          }
      }
      this.curateAuditKeyword = nextKeyword;
      this.curateAuditCategory = nextCategory;
      this.curateAuditSelection = [];
      this.curateAuditDragSelection = [];
      this.curateAuditDragTarget = null;
      this.curateAuditOffset = 0;
      this.curateAuditTotal = null;
      this.curateAuditLoadAll = false;
      this.curateAuditPageOffset = 0;
      if (!nextKeyword) {
          this.curateAuditImages = [];
          return;
      }
      this._fetchCurateAuditImages();
  }

  // Audit pagination handlers - now using factory to eliminate duplication
  async _fetchCurateAuditImages({ append = false, loadAll = false, offset = null } = {}) {
      if (!this.tenant || !this.curateAuditKeyword) return;

      const useLoadAll = loadAll || this.curateAuditLoadAll;
      const resolvedOffset = offset !== null && offset !== undefined
          ? offset
          : append
            ? this.curateAuditOffset
            : (this.curateAuditPageOffset || 0);
      const fetchKey = getCurateAuditFetchKey(this, { loadAll: useLoadAll, offset: resolvedOffset });

      // Check special case
      if (this.curateAuditMinRating === 0 && this.curateAuditHideDeleted) {
          this.curateAuditImages = [];
          this.curateAuditOffset = 0;
          this.curateAuditTotal = 0;
          this.curateAuditPageOffset = 0;
          this._curateAuditLastFetchKey = fetchKey;
          return;
      }

      this.curateAuditLoading = true;
      const existingImages = append ? [...(this.curateAuditImages || [])] : null;
      try {
          // Build filter object using helper
          const filters = buildCurateAuditFilterObject(this, {
              loadAll: useLoadAll,
              offset: resolvedOffset
          });

          // Fetch using filter panel
          this.curateAuditFilterPanel.updateFilters(filters);
          const result = await this.curateAuditFilterPanel.fetchImages();

          const images = Array.isArray(result) ? result : (result.images || []);
          const total = Array.isArray(result)
              ? null
              : Number.isFinite(result.total)
                ? result.total
                : null;

          if (append) {
              this.curateAuditImages = [...(existingImages || []), ...images];
          } else {
              this.curateAuditImages = images;
          }

          if (!useLoadAll) {
              this.curateAuditPageOffset = resolvedOffset;
              this.curateAuditOffset = resolvedOffset + images.length;
              this.curateAuditTotal = total;
          } else {
              this.curateAuditOffset = images.length;
              this.curateAuditTotal = images.length;
          }
          this._curateAuditLastFetchKey = fetchKey;
      } catch (error) {
          console.error('Error fetching curate audit images:', error);
      } finally {
          this.curateAuditLoading = false;
      }
  }

  _handleCurateAuditSelectHover(index) {
      return this._auditSelectionHandlers.handleSelectHover(index);
  }

  _refreshCurateAudit() {
      if (this.curateAuditLoadAll) {
          this._fetchCurateAuditImages({ loadAll: true });
          return;
      }
      const offset = this.curateAuditPageOffset || 0;
      this._fetchCurateAuditImages({ offset });
  }

  _updateCurateAuditDragSelection() {
      return this._auditSelectionHandlers.updateSelection();
  }

  _applyAuditPermatagChange(image, signum, keyword, category) {
      const permatags = Array.isArray(image?.permatags) ? image.permatags : [];
      if (signum === 1) {
          return { ...image, permatags: mergePermatags(permatags, [{ keyword, category }]) };
      }
      const matches = (tag) => tag.keyword === keyword && (tag.category || 'Uncategorized') === (category || 'Uncategorized');
      const next = permatags.filter((tag) => !(tag.signum === 1 && matches(tag)));
      return { ...image, permatags: next };
  }

  _handleCurateImageClick(event, image, imageSet) {
      if (this.curateDragSelecting || this.curateAuditDragSelecting) {
          return;
      }
      if (event.defaultPrevented) {
          return;
      }
      if (this._curateSuppressClick || this.curateDragSelection.length) {
          this._curateSuppressClick = false;
          return;
      }
      const nextSet = Array.isArray(imageSet) && imageSet.length
          ? [...imageSet]
          : (Array.isArray(this.curateImages) ? [...this.curateImages] : []);
      this.curateEditorImage = image;
      this.curateEditorImageSet = nextSet;
      this.curateEditorImageIndex = this.curateEditorImageSet.findIndex(img => img.id === image.id);
      this.curateEditorOpen = true;
  }

  async _handleZoomToPhoto(e) {
      const imageId = e?.detail?.imageId;
      if (!imageId) return;
      this.activeTab = 'curate';
      this.curateSubTab = 'main';
      this.curateOrderBy = 'photo_creation';
      this.curateOrderDirection = 'desc';
      this.curatePageOffset = 0;
      this.curateDragSelection = [];
      this.curateKeywordFilters = {};
      this.curateKeywordOperators = {};
      this.curateNoPositivePermatags = false;
      this.curateMinRating = null;
      this.curateDropboxPathPrefix = '';
      this.curateFilters = buildCurateFilterObject(this);
      const curateFilters = {
          ...buildCurateFilterObject(this, { resetOffset: true }),
          anchorId: imageId,
      };
      this.curateHomeFilterPanel.updateFilters(curateFilters);
      await this._fetchCurateHomeImages();
      await this.updateComplete;
      this._scrollCurateThumbIntoView(imageId);
  }

  _scrollCurateThumbIntoView(imageId) {
      const selector = `[data-image-id="${imageId}"]`;
      const target = this.shadowRoot?.querySelector(selector);
      if (target && typeof target.scrollIntoView === 'function') {
          target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      }
  }

  _applyCurateRating(imageId, rating) {
      const update = (image) => (image.id === imageId ? { ...image, rating } : image);
      const hideZero = this.curateHideDeleted && rating === 0;
      if (hideZero) {
          const keep = (image) => image.id !== imageId;
          this.curateImages = this.curateImages.filter(keep);
          this.curateAuditImages = this.curateAuditImages.filter(keep);
          this.curateAuditSelection = this.curateAuditSelection.filter(keep);
          this.curateDragSelection = this.curateDragSelection.filter((id) => id !== imageId);
          this.curateAuditDragSelection = this.curateAuditDragSelection.filter((id) => id !== imageId);
      } else {
          this.curateImages = this.curateImages.map(update);
          this.curateAuditImages = this.curateAuditImages.map(update);
          this.curateAuditSelection = this.curateAuditSelection.map(update);
      }
      if (Array.isArray(this.searchImages)) {
          this.searchImages = this.searchImages.map(update);
      }
      if (this.exploreByTagData && typeof this.exploreByTagData === 'object') {
          const nextExplore = {};
          let updated = false;
          Object.entries(this.exploreByTagData).forEach(([keyword, images]) => {
              if (!Array.isArray(images)) {
                  nextExplore[keyword] = images;
                  return;
              }
              let keywordUpdated = false;
              const nextImages = images.map((image) => {
                  if (image?.id === imageId && image.rating !== rating) {
                      keywordUpdated = true;
                      updated = true;
                      return { ...image, rating };
                  }
                  return image;
              });
              nextExplore[keyword] = keywordUpdated ? nextImages : images;
          });
          if (updated) {
              this.exploreByTagData = nextExplore;
          }
      }
      const searchTab = this.shadowRoot?.querySelector('search-tab');
      if (searchTab?.applyRatingUpdate) {
          searchTab.applyRatingUpdate(imageId, rating);
      }
  }

  _handleCurateRating(event, image, rating) {
      event.preventDefault();
      event.stopPropagation();
      if (!image?.id) return;
      this._triggerCurateRatingBurst(image.id);
      this._applyCurateRating(image.id, rating);
      enqueueCommand({
          type: 'set-rating',
          tenantId: this.tenant,
          imageId: image.id,
          rating,
      });
  }

  _triggerCurateRatingBurst(imageId) {
      if (!this._curateRatingBurstIds) {
          this._curateRatingBurstIds = new Set();
      }
      if (!this._curateRatingBurstTimers) {
          this._curateRatingBurstTimers = new Map();
      }
      const existing = this._curateRatingBurstTimers.get(imageId);
      if (existing) {
          clearTimeout(existing);
      }
      this._curateRatingBurstIds.add(imageId);
      this.requestUpdate();
      const timer = setTimeout(() => {
          this._curateRatingBurstIds.delete(imageId);
          this._curateRatingBurstTimers.delete(imageId);
          this.requestUpdate();
      }, 700);
      this._curateRatingBurstTimers.set(imageId, timer);
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
              @click=${(e) => this._handleCurateRating(e, image, 0)}
            >
              ${image.rating == 0 ? '❌' : '🗑'}
            </button>
            <span class="curate-thumb-stars">
              ${[1, 2, 3].map((star) => html`
                <button
                  type="button"
                  class="cursor-pointer mx-0.5 ${image.rating && image.rating >= star ? 'text-yellow-500' : 'text-gray-500 hover:text-gray-900'}"
                  title="${star} star${star > 1 ? 's' : ''}"
                  @click=${(e) => this._handleCurateRating(e, image, star)}
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
      this.curateEditorOpen = false;
      this.curateEditorImage = null;
      // Clear any lingering drag selection that might block next click
      this.curateDragSelection = [];
  }

  _handleImageNavigate(event) {
      const { index } = event.detail;
      if (index >= 0 && index < this.curateEditorImageSet.length) {
          const nextImage = this.curateEditorImageSet[index];
          this.curateEditorImage = nextImage;
          this.curateEditorImageIndex = index;
      }
  }

  _handleCurateSelectStart(event, index, imageId) {
      return this._exploreSelectionHandlers.handleSelectStart(event, index, imageId);
  }

  _handleCurateSelectHover(index) {
      return this._exploreSelectionHandlers.handleSelectHover(index);
  }

  _updateCurateDragSelection() {
      return this._exploreSelectionHandlers.updateSelection();
  }

  _handleExploreByTagPointerDown(event, index, imageId, keywordName, cachedImages) {
      if (this.curateDragSelecting || this.curateAuditDragSelecting) {
          return;
      }
      if (event.button !== 0) {
          return;
      }
      if (this.curateDragSelection.length && this.curateDragSelection.includes(imageId)) {
          this._curateSuppressClick = true;
          return;
      }
      this._curateSuppressClick = false;
      this._curatePressActive = true;
      this._curatePressStart = { x: event.clientX, y: event.clientY };
      this._curatePressIndex = index;
      this._curatePressImageId = imageId;
      this._exploreByTagCachedImages = cachedImages;
      this._curatePressTimer = setTimeout(() => {
          if (this._curatePressActive) {
              this._startExploreByTagSelection(index, imageId, cachedImages);
          }
      }, 250);
  }

  _handleExploreByTagSelectHover(index, cachedImages) {
      if (!this.curateDragSelecting) return;
      if (this.curateDragEndIndex !== index) {
          this.curateDragEndIndex = index;
          this._updateExploreByTagDragSelection(cachedImages);
      }
  }

  _startExploreByTagSelection(index, imageId, cachedImages) {
      if (this.curateDragSelection.includes(imageId)) {
          return;
      }
      this._cancelCuratePressState();
      this._curateLongPressTriggered = true;
      this.curateDragSelecting = true;
      this.curateDragStartIndex = index;
      this.curateDragEndIndex = index;
      this._curateSuppressClick = true;
      this._flashCurateSelection(imageId);
      this._updateExploreByTagDragSelection(cachedImages);
  }

  _updateExploreByTagDragSelection(cachedImages) {
      if (!cachedImages || this.curateDragStartIndex === null || this.curateDragEndIndex === null) {
          return;
      }
      const start = Math.min(this.curateDragStartIndex, this.curateDragEndIndex);
      const end = Math.max(this.curateDragStartIndex, this.curateDragEndIndex);
      const ids = cachedImages.slice(start, end + 1).map(img => img.id);
      this.curateDragSelection = ids;
  }

  _flashCurateSelection(imageId) {
      if (!this._curateFlashSelectionIds) {
          this._curateFlashSelectionIds = new Set();
      }
      if (!this._curateFlashSelectionTimers) {
          this._curateFlashSelectionTimers = new Map();
      }
      const existing = this._curateFlashSelectionTimers.get(imageId);
      if (existing) {
          clearTimeout(existing);
      }
      this._curateFlashSelectionIds.add(imageId);
      this.requestUpdate();
      const timer = setTimeout(() => {
          this._curateFlashSelectionIds.delete(imageId);
          this._curateFlashSelectionTimers.delete(imageId);
          this.requestUpdate();
      }, 600);
      this._curateFlashSelectionTimers.set(imageId, timer);
  }

  _renderCurateFilters({ mode = 'main', showHistogramOnly = false, showHistogram = true, showHeader = true, hideSortControls = false, hidePermatagMissing = false, hideRatingControls = false, renderDropboxFolder = false } = {}) {
    // If showing only histogram (for home tab), render just that
    if (showHistogramOnly) {
      return html`
        <tag-histogram
          .categoryCards=${this.curateCategoryCards || []}
          .activeTagSource=${this.activeCurateTagSource || 'permatags'}
          .tagStatsBySource=${this.tagStatsBySource}
          @tag-source-change=${this._handleCurateTagSourceChange}
        ></tag-histogram>
      `;
    }

    const selectedKeywordValue = (() => {
      if (mode === 'tag-audit') {
        if (!this.curateAuditKeyword) return '';
        const category = this.curateAuditCategory || 'Uncategorized';
        return `${encodeURIComponent(category)}::${encodeURIComponent(this.curateAuditKeyword)}`;
      }
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
    const isAuditMode = mode === 'tag-audit';
    const activeHideDeleted = isAuditMode ? this.curateAuditHideDeleted : this.curateHideDeleted;
    const activeMinRating = isAuditMode ? this.curateAuditMinRating : this.curateMinRating;
    const activeNoPositivePermatags = isAuditMode ? this.curateAuditNoPositivePermatags : this.curateNoPositivePermatags;
    const handleHideDeletedChange = isAuditMode
      ? (event) => this._handleCurateAuditHideDeletedChange(event)
      : (event) => this._handleCurateHideDeletedChange(event);
    const handleMinRatingChange = isAuditMode
      ? (value) => this._handleCurateAuditMinRating(value)
      : (value) => this._handleCurateMinRating(value);
    const handleNoPositivePermatagsChange = isAuditMode
      ? (event) => this._handleCurateAuditNoPositivePermatagsChange(event)
      : (event) => this._handleCurateNoPositivePermatagsChange(event);

    const advancedPanel = this.curateAdvancedOpen ? html`
      <div class="border rounded-lg">
        <div class="px-3 py-3 bg-gray-50 space-y-4 ${renderDropboxFolder ? 'search-accordion' : ''}">
        <!-- Existing filter controls moved into accordion -->
        <div class="flex flex-wrap md:flex-nowrap items-end gap-4">
                ${hideRatingControls ? html`` : html`
                <div class="flex-[2] min-w-[200px]">
                  <label class="block text-xs font-semibold text-gray-600 mb-1">Rating</label>
                  <div class="flex flex-wrap items-center gap-2">
                    <label class="inline-flex items-center gap-2 text-xs text-gray-600">
                      <input
                        type="checkbox"
                        class="h-4 w-4"
                        .checked=${activeHideDeleted}
                        @change=${handleHideDeletedChange}
                      >
                      <span class="inline-flex items-center gap-2">
                        <i class="fas fa-trash"></i>
                        hide deleted
                      </span>
                    </label>
                    <div class="flex items-center gap-1">
                      ${[0, 1, 2, 3].map((value) => {
                        const label = value === 0 ? '0' : `${value}+`;
                        const title = value === 0 ? 'Quality = 0' : `Quality >= ${value}`;
                        return html`
                          <button
                            class="inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs ${activeMinRating === value ? 'bg-yellow-100 text-yellow-800 border-yellow-200' : 'bg-gray-100 text-gray-500 border-gray-200'}"
                            title=${title}
                            @click=${() => handleMinRatingChange(value)}
                          >
                            <i class="fas fa-star"></i>
                            <span>${label}</span>
                          </button>
                        `;
                      })}
                      <button
                        class="inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs ${activeMinRating === 'unrated' ? 'bg-yellow-100 text-yellow-800 border-yellow-200' : 'bg-gray-100 text-gray-500 border-gray-200'}"
                        title="Unrated images"
                        @click=${() => handleMinRatingChange('unrated')}
                      >
                        <i class="fas fa-circle-notch"></i>
                        <span>unrated</span>
                      </button>
                    </div>
                  </div>
                </div>
                `}
                ${hidePermatagMissing ? html`` : html`
                <div class="flex-[1.5] min-w-[180px]">
                  <label class="block text-xs font-semibold text-gray-600 mb-1">Permatags</label>
                  <label class="inline-flex items-center gap-2 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      class="h-4 w-4"
                      .checked=${activeNoPositivePermatags}
                      @change=${handleNoPositivePermatagsChange}
                    >
                    no positive permatags
                  </label>
                </div>
                `}
                ${renderDropboxFolder ? html`
                <div class="flex-1 min-w-0 w-full">
                  <label class="block text-xs font-semibold text-gray-600 mb-1">Dropbox folder</label>
                  <div class="search-folder-field">
                    <input
                      class="search-folder-input px-3 py-2 border rounded-lg"
                      placeholder="Search folders..."
                      .value=${this.searchDropboxQuery}
                      @input=${this._handleSearchDropboxInput}
                      @change=${this._handleSearchDropboxSelect}
                      @focus=${this._handleSearchDropboxFocus}
                      @blur=${this._handleSearchDropboxBlur}
                    >
                    ${this.searchDropboxOpen && this.searchDropboxOptions.length ? html`
                      <div class="search-folder-menu">
                        ${this.searchDropboxOptions.map((folder) => html`
                          <div
                            class="search-folder-option"
                            @mousedown=${() => this._handleSearchDropboxPick(folder)}
                          >
                            ${folder}
                          </div>
                        `)}
                      </div>
                    ` : html``}
                  </div>
                  ${this.searchDropboxPathPrefix ? html`
                    <div class="text-xs text-gray-500 search-folder-selected flex items-center gap-2 mt-2">
                      <span>Filtered: ${this.searchDropboxPathPrefix}</span>
                      <button
                        class="text-xs text-blue-600 hover:text-blue-700"
                        @click=${this._handleSearchDropboxClear}
                      >
                        Clear filter
                      </button>
                    </div>
                  ` : html``}
                </div>
                ` : html``}
              </div>
        </div>
      </div>
    ` : html``;

    return showHeader ? html`
      <!-- Compact Filter Section (Top) -->
      <div class="bg-white rounded-lg shadow p-4 mb-4">
        <div class="space-y-4">
          <!-- Line 1: Keyword Dropdown + Page Size + Thumbnail Slider -->
          <div class="flex gap-4 items-end">
            <div class="w-1/2 min-w-[260px]">
              <label class="block text-base font-semibold text-gray-700 mb-2">Keywords</label>
              <keyword-dropdown
                .value=${selectedKeywordValue}
                .placeholder=${'Select a keyword...'}
                .tagStatsBySource=${this.tagStatsBySource}
                .activeCurateTagSource=${this.activeCurateTagSource || 'permatags'}
                .keywords=${this.keywords}
                .imageStats=${this.imageStats}
                .includeUntagged=${mode !== 'tag-audit'}
                .compact=${mode === 'tag-audit'}
                @change=${(event) => this._handleCurateKeywordSelect(event, mode)}
              ></keyword-dropdown>
            </div>
            
            <button
              class="h-10 w-10 flex items-center justify-center border rounded-lg text-gray-600 hover:bg-gray-50"
              title="Advanced filters"
              aria-pressed=${this.curateAdvancedOpen ? 'true' : 'false'}
              @click=${() => { this.curateAdvancedOpen = !this.curateAdvancedOpen; }}
            >
              <svg viewBox="0 0 24 24" class="h-7 w-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.02.02a2 2 0 1 1-2.83 2.83l-.02-.02a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.03a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.02.02a2 2 0 1 1-2.83-2.83l.02-.02a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.03a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.02-.02a2 2 0 1 1 2.83-2.83l.02.02a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.03a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.02-.02a2 2 0 1 1 2.83 2.83l-.02.02a1.7 1.7 0 0 0-.34 1.87V9c0 .68.4 1.3 1.02 1.58.24.11.5.17.77.17H21a2 2 0 1 1 0 4h-.03a1.7 1.7 0 0 0-1.55 1z"></path>
              </svg>
            </button>
          </div>

          ${advancedPanel}
        </div>
      </div>
    ` : html`${advancedPanel}`;
  }

  render() {
    const showCurateStatsOverlay = this.curateStatsLoading || this.curateHomeRefreshing;
    const navCards = [
      { key: 'search', label: 'Search', subtitle: 'Explore and save results', icon: 'fa-magnifying-glass' },
      { key: 'curate', label: 'Curate', subtitle: 'Build stories and sets', icon: 'fa-star' },
      { key: 'lists', label: 'Lists', subtitle: 'Organize saved sets', icon: 'fa-list' },
      { key: 'admin', label: 'Admin', subtitle: 'Manage configuration', icon: 'fa-cog' },
      { key: 'system', label: 'System', subtitle: 'Manage pipelines and tasks', icon: 'fa-sliders' },
    ];
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
    const duplicateNewListTitle = !this.searchListId && this._isDuplicateListTitle(this.searchListTitle);
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
    const curateRefreshBusy = this.curateSubTab === 'home'
      ? (this.curateHomeRefreshing || this.curateStatsLoading)
      : (this.curateSubTab === 'tag-audit' ? this.curateAuditLoading : this.curateLoading);

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
            .queueCount=${(this.queueState?.queuedCount || 0) + (this.queueState?.inProgressCount || 0) + (this.queueState?.failedCount || 0)}
            @tab-change=${(e) => this.activeTab = e.detail}
            @sync-progress=${this._handleSyncProgress}
            @sync-complete=${this._handleSyncComplete}
            @sync-error=${this._handleSyncError}
        ></app-header>
        
        <tab-container .activeTab=${this.activeTab}>
            ${this.activeTab === 'home' ? html`
            <home-tab
              slot="home"
              .imageStats=${this.imageStats}
              .mlTrainingStats=${this.mlTrainingStats}
              .navCards=${navCards}
              @navigate=${(e) => { this.activeTab = e.detail.tab; }}
            ></home-tab>
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
                    .dateOrder=${this.curateDateOrder}
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
                    .tagStatsBySource=${this.tagStatsBySource}
                    .activeCurateTagSource=${this.activeCurateTagSource}
                    .keywords=${this.keywords}
                    .curateExploreTargets=${this.curateExploreTargets}
                    .curateExploreRatingEnabled=${this.curateExploreRatingEnabled}
                    .curateExploreRatingCount=${this.curateExploreRatingCount}
                    @image-clicked=${(e) => this._handleCurateImageClick(e.detail.event, e.detail.image, e.detail.imageSet)}
                    @sort-changed=${(e) => {
                      this.curateOrderBy = e.detail.orderBy;
                      this.curateDateOrder = e.detail.dateOrder;
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
                    @rating-drop=${(e) => this._handleCurateExploreRatingDrop(e.detail.event)}
                    @curate-filters-changed=${this._handleCurateChipFiltersChanged}
                  ></curate-explore-tab>
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
                <list-editor .tenant=${this.tenant}></list-editor>
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
          const keywordsByCategory = await getKeywords(this.tenant);
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
          this._applyCurateRating(e.detail.imageId, e.detail.rating);
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

  _scheduleStatsRefresh() {
      if (this._statsRefreshTimer) {
          clearTimeout(this._statsRefreshTimer);
      }
      this._statsRefreshTimer = setTimeout(() => {
          this._statsRefreshTimer = null;
          this.fetchStats({
            force: true,
            includeTagStats: this.activeTab === 'curate' && this.curateSubTab === 'home',
          });
      }, 400);
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

  _removeCuratePermatag(event, image, keyword, category) {
      event.stopPropagation();
      enqueueCommand({
          type: 'add-negative-permatag',
          tenantId: this.tenant,
          imageId: image.id,
          keyword,
          category,
      });
      this._updateCuratePermatagRemoval(image.id, keyword, category);
  }

  _updateCuratePermatagRemoval(imageId, keyword, category) {
      const matches = (tag) => tag.keyword === keyword && (tag.category || 'Uncategorized') === (category || 'Uncategorized');
      const removePositive = (image) => {
          const permatags = Array.isArray(image.permatags) ? image.permatags : [];
          const next = permatags.filter((tag) => !(tag.signum === 1 && matches(tag)));
          return { ...image, permatags: next };
      };
      this.curateImages = this.curateImages.map((image) => (
          image.id === imageId ? removePositive(image) : image
      ));
  }

  _updateCuratePermatagRemovals(imageIds, tags) {
      if (!imageIds?.length || !tags?.length) return;
      const targetIds = new Set(imageIds);
      const removeSet = new Set(tags.map((tag) => `${tag.category || 'Uncategorized'}::${tag.keyword}`));
      const prune = (image) => {
          const permatags = Array.isArray(image.permatags) ? image.permatags : [];
          const next = permatags.filter((tag) => {
              if (tag.signum !== 1) return true;
              const key = `${tag.category || 'Uncategorized'}::${tag.keyword}`;
              return !removeSet.has(key);
          });
          return { ...image, permatags: next };
      };
      this.curateImages = this.curateImages.map((image) => (
          targetIds.has(image.id) ? prune(image) : image
      ));
  }

  _updateCuratePermatags(imageIds, tags) {
      if (!imageIds?.length || !tags?.length) return;
      const targetIds = new Set(imageIds);
      this.curateImages = this.curateImages.map((image) => {
          if (!targetIds.has(image.id)) return image;
          const permatags = mergePermatags(image.permatags, tags);
          return { ...image, permatags };
      });
  }

  _updateAuditPermatags(imageIds, tags) {
      if (!imageIds?.length || !tags?.length) return;
      const targetIds = new Set(imageIds);
      this.curateAuditImages = this.curateAuditImages.map((image) => {
          if (!targetIds.has(image.id)) return image;
          const permatags = mergePermatags(image.permatags, tags);
          return { ...image, permatags };
      });
  }

  _updateAuditPermatagRemovals(imageIds, tags) {
      if (!imageIds?.length || !tags?.length) return;
      const targetIds = new Set(imageIds);
      this.curateAuditImages = this.curateAuditImages.map((image) => {
          if (!targetIds.has(image.id)) return image;
          const permatags = this._removePermatags(image.permatags, tags);
          return { ...image, permatags };
      });
  }

  updated(changedProperties) {
      if (changedProperties.has('curateAuditKeyword') || changedProperties.has('curateAuditMode')) {
          this._syncAuditHotspotPrimary();
      }
      if (changedProperties.has('keywords') && this.curateAuditKeyword) {
          this._syncAuditHotspotPrimary();
      }
      if (this.activeTab === 'curate' && this.curateSubTab === 'home') {
          if (this._shouldAutoRefreshCurateStats()) {
              this._curateStatsAutoRefreshDone = true;
              this._refreshCurateHome();
          }
      }
      if (changedProperties.has('activeTab')) {
          this._initializeTab(this.activeTab);
      }
  }

}

customElements.define('photocat-app', PhotoCatApp);
