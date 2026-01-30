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
import './filter-chips.js';

import { tailwind } from './tailwind-lit.js';
import {
  fetchWithAuth,
  getKeywords,
  getImageStats,
  getMlTrainingStats,
  getTagStats,
  getImages,
  getDropboxFolders,
  getLists,
  getListItems,
  createList,
  updateList,
  addToList,
  deleteListItem,
} from '../services/api.js';
import { enqueueCommand, subscribeQueue, retryFailedCommand } from '../services/command-queue.js';

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
      curateMinRating: { type: Number },
      curateKeywordFilters: { type: Object },
      curateKeywordOperators: { type: Object },
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
      searchSubTab: { type: String, attribute: false },
      searchChipFilters: { type: Array },
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
      curateHomeRefreshing: { type: Boolean },
      curateAdvancedOpen: { type: Boolean },
      curateNoPositivePermatags: { type: Boolean },
      activeCurateTagSource: { type: String },
      curateCategoryCards: { type: Array },
      curateAuditTargets: { type: Array },
      curateExploreTargets: { type: Array },
      curateExploreRatingEnabled: { type: Boolean },
      curateAuditRatingEnabled: { type: Boolean },
      searchSavedItems: { type: Array },
      searchSavedDragTarget: { type: Boolean },
      searchLists: { type: Array },
      searchListId: { type: Number },
      searchListTitle: { type: String },
      searchListLoading: { type: Boolean },
      searchListSaving: { type: Boolean },
      searchListPromptNewTitle: { type: Boolean },
      searchDropboxQuery: { type: String },
      searchDropboxOptions: { type: Array },
      searchDropboxPathPrefix: { type: String },
      searchDropboxLoading: { type: Boolean },
      searchDropboxOpen: { type: Boolean },
  }

  constructor() {
      super();
      this.tenant = 'bcg'; // Default tenant
      this.showUploadModal = false;
      this.activeTab = 'home'; // Default to home tab
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
      this.curateFilters = this._buildCurateFilters();
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
      this.curateSubTab = 'home';
      this.searchSubTab = 'home';
      this.searchChipFilters = [];
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
      this.curateHomeRefreshing = false;
      this.curateAdvancedOpen = false;
      this.curateNoPositivePermatags = false;
      this.activeCurateTagSource = 'permatags';
      this.curateCategoryCards = [];
      this.searchSavedItems = [];
      this.searchSavedDragTarget = false;
      this.searchLists = [];
      this.searchListId = null;
      this.searchListTitle = this._getDefaultNewListTitle();
      this.searchListLoading = false;
      this.searchListSaving = false;
      this.searchListPromptNewTitle = false;
      this.searchDropboxQuery = '';
      this.searchDropboxOptions = [];
      this.searchDropboxPathPrefix = '';
      this.searchDropboxLoading = false;
      this.searchDropboxOpen = false;
      this.curateExploreTargets = [
        { id: 1, category: '', keyword: '', action: 'add', count: 0 },
      ];
      this._curateExploreHotspotNextId = 2;
      this.curateExploreRatingEnabled = false;
      this.curateExploreRatingCount = 0;
      this._curateExploreRatingPending = null;
      this._searchDropboxFetchTimer = null;
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
      this._curateRatingBurstIds = new Set();
      this._curateRatingBurstTimers = new Map();
      this._curateFlashSelectionIds = new Set();
      this._curateFlashSelectionTimers = new Map();
      this._curateDragOrder = null;
      this._curateExploreReorderId = null;
      this._curateAuditHotspotDragTarget = null;
      this._curateExploreHotspotDragTarget = null;
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
        this._curateSuppressClick = true;
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
          curateFilters: this._buildCurateFilters(),
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
      this.curateFilters = { ...(next.curateFilters || this._buildCurateFilters()) };
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

  _parseUtilityKeywordValue(value) {
      if (!value) {
          return { category: '', keyword: '' };
      }
      const [rawCategory, rawKeyword] = value.split('::');
      if (!rawKeyword) {
          return { category: '', keyword: '' };
      }
      return {
          category: decodeURIComponent(rawCategory || 'Uncategorized'),
          keyword: decodeURIComponent(rawKeyword || ''),
      };
  }

  _handleCurateExploreHotspotKeywordChange(event, targetId) {
      const value = event.target.value;
      const { category, keyword } = this._parseUtilityKeywordValue(value);
      this.curateExploreTargets = (this.curateExploreTargets || []).map((target) => (
          target.id === targetId ? { ...target, category, keyword, count: 0 } : target
      ));
  }

  _handleCurateExploreHotspotActionChange(event, targetId) {
      const action = event.target.value === 'remove' ? 'remove' : 'add';
      this.curateExploreTargets = (this.curateExploreTargets || []).map((target) => (
          target.id === targetId ? { ...target, action, count: 0 } : target
      ));
  }

  _handleCurateExploreHotspotTypeChange(event, targetId) {
      const type = event.target.value;
      this.curateExploreTargets = (this.curateExploreTargets || []).map((target) => (
          target.id === targetId ? { ...target, type, keyword: '', category: '', rating: '', action: 'add', count: 0 } : target
      ));
  }

  _handleCurateExploreHotspotRatingChange(event, targetId) {
      const rating = Number.parseInt(event.target.value, 10);
      this.curateExploreTargets = (this.curateExploreTargets || []).map((target) => (
          target.id === targetId ? { ...target, rating, count: 0 } : target
      ));
  }

  _handleCurateExploreHotspotAddTarget() {
      const nextId = this._curateExploreHotspotNextId || 1;
      this._curateExploreHotspotNextId = nextId + 1;
      this.curateExploreTargets = [
          ...(this.curateExploreTargets || []),
          { id: nextId, category: '', keyword: '', action: 'add', count: 0 },
      ];
  }

  _handleCurateExploreHotspotRemoveTarget(targetId) {
      if (!this.curateExploreTargets || this.curateExploreTargets.length <= 1) {
          return;
      }
      const firstId = this.curateExploreTargets[0]?.id;
      if (targetId === firstId) {
          return;
      }
      this.curateExploreTargets = this.curateExploreTargets.filter((target) => target.id !== targetId);
      if (this._curateExploreHotspotDragTarget === targetId) {
          this._curateExploreHotspotDragTarget = null;
      }
  }

  _handleCurateExploreHotspotDragOver(event, targetId) {
      event.preventDefault();
      if (this._curateExploreHotspotDragTarget !== targetId) {
          this._curateExploreHotspotDragTarget = targetId;
          this.requestUpdate();
      }
  }

  _handleCurateExploreHotspotDragLeave() {
      if (this._curateExploreHotspotDragTarget !== null) {
          this._curateExploreHotspotDragTarget = null;
          this.requestUpdate();
      }
  }

  _handleCurateExploreHotspotDrop(event, targetId) {
      event.preventDefault();
      const raw = event.dataTransfer?.getData('text/plain') || '';
      const ids = raw
          .split(',')
          .map((value) => Number.parseInt(value.trim(), 10))
          .filter((value) => Number.isFinite(value) && value > 0);
      if (!ids.length) {
          this._handleCurateExploreHotspotDragLeave();
          return;
      }
      const target = (this.curateExploreTargets || []).find((entry) => entry.id === targetId);
      if (!target) {
          this._handleCurateExploreHotspotDragLeave();
          return;
      }

      if (target.type === 'rating') {
          if (typeof target.rating !== 'number' || target.rating < 0 || target.rating > 3) {
              this._handleCurateExploreHotspotDragLeave();
              return;
          }
          this._applyExploreRating(ids, target.rating);
          this.curateExploreTargets = this.curateExploreTargets.map((entry) => (
              entry.id === targetId ? { ...entry, count: (entry.count || 0) + ids.length } : entry
          ));
      } else {
          if (!target.keyword) {
              this._handleCurateExploreHotspotDragLeave();
              return;
          }
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
          this.curateExploreTargets = this.curateExploreTargets.map((entry) => (
              entry.id === targetId ? { ...entry, count: (entry.count || 0) + ids.length } : entry
          ));
      }
      this._handleCurateExploreHotspotDragLeave();
  }

  _removeCurateImagesByIds(ids) {
      if (!ids?.length) return;
      const removeSet = new Set(ids);
      const keep = (image) => !removeSet.has(image.id);
      this.curateImages = this.curateImages.filter(keep);
      this.curateDragSelection = this.curateDragSelection.filter((id) => !removeSet.has(id));
  }

  _syncAuditHotspotPrimary() {
      const defaultAction = this.curateAuditMode === 'existing' ? 'remove' : 'add';
      const keyword = this.curateAuditKeyword || '';
      const category = keyword ? (this.curateAuditCategory || 'Uncategorized') : '';
      if (!this.curateAuditTargets || !this.curateAuditTargets.length) {
          this.curateAuditTargets = [
              { id: 1, category, keyword, action: defaultAction, count: 0 },
          ];
          this._curateAuditHotspotNextId = 2;
          return;
      }
      const [first, ...rest] = this.curateAuditTargets;
      const nextFirst = {
          ...first,
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
      const { category, keyword } = this._parseUtilityKeywordValue(value);
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

  _handleCurateExploreRatingToggle() {
      this.curateExploreRatingEnabled = !this.curateExploreRatingEnabled;
  }

  _handleCurateExploreRatingDragOver(event) {
      event.preventDefault();
      this._curateExploreRatingDragTarget = true;
      this.requestUpdate();
  }

  _handleCurateExploreRatingDragLeave() {
      this._curateExploreRatingDragTarget = false;
      this.requestUpdate();
  }

  _handleCurateExploreRatingDrop(event) {
      event.preventDefault();
      console.log('[Rating] _handleCurateExploreRatingDrop called');
      const raw = event.dataTransfer?.getData('text/plain') || '';
      console.log('[Rating] Raw data:', raw);
      const ids = raw
          .split(',')
          .map((value) => Number.parseInt(value.trim(), 10))
          .filter((value) => Number.isFinite(value) && value > 0);
      console.log('[Rating] Parsed IDs:', ids);
      if (!ids.length) {
          console.log('[Rating] No valid IDs, aborting');
          this._handleCurateExploreRatingDragLeave();
          return;
      }

      // Show rating selection dialog
      console.log('[Rating] Showing dialog for ids:', ids);
      this._showExploreRatingDialog(ids);
      this._handleCurateExploreRatingDragLeave();
  }

  _handleCurateAuditRatingToggle() {
      this.curateAuditRatingEnabled = !this.curateAuditRatingEnabled;
  }

  _handleCurateAuditRatingDragOver(event) {
      event.preventDefault();
      this._curateAuditRatingDragTarget = true;
      this.requestUpdate();
  }

  _handleCurateAuditRatingDragLeave() {
      this._curateAuditRatingDragTarget = false;
      this.requestUpdate();
  }

  _handleCurateAuditRatingDrop(event) {
      event.preventDefault();
      console.log('[Rating] _handleCurateAuditRatingDrop called');
      const raw = event.dataTransfer?.getData('text/plain') || '';
      console.log('[Rating] Raw data:', raw);
      const ids = raw
          .split(',')
          .map((value) => Number.parseInt(value.trim(), 10))
          .filter((value) => Number.isFinite(value) && value > 0);
      console.log('[Rating] Parsed IDs:', ids);
      if (!ids.length) {
          console.log('[Rating] No valid IDs, aborting');
          this._handleCurateAuditRatingDragLeave();
          return;
      }

      // Show rating selection dialog
      console.log('[Rating] Showing dialog for ids:', ids);
      this._showAuditRatingDialog(ids);
      this._handleCurateAuditRatingDragLeave();
  }

  _handleCurateExploreReorderStart(event, image) {
      if (!image?.id) return;
      this._handleCurateDragStart(event, image);
      if (event.defaultPrevented) {
          return;
      }
      this._curateExploreReorderId = image.id;
  }

  _handleCurateExploreReorderOver(event, targetId) {
      if (!this._curateExploreReorderId || !targetId || this._curateExploreReorderId === targetId) {
          return;
      }
      event.preventDefault();
      const images = Array.isArray(this.curateImages) ? [...this.curateImages] : [];
      const fromIndex = images.findIndex((img) => img.id === this._curateExploreReorderId);
      const toIndex = images.findIndex((img) => img.id === targetId);
      if (fromIndex < 0 || toIndex < 0) {
          return;
      }
      const [moved] = images.splice(fromIndex, 1);
      images.splice(toIndex, 0, moved);
      this.curateImages = images;
  }

  _handleCurateExploreReorderEnd() {
      this._curateExploreReorderId = null;
  }

  connectedCallback() {
      super.connectedCallback();
      this.fetchKeywords();
      this.fetchStats();
      this._fetchCurateImages();
      this._fetchSearchLists();
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

  _handleCurateFilterChange(e) {
      const nextFilters = { ...(e.detail || {}) };
      if (nextFilters.limit === undefined || nextFilters.limit === null || nextFilters.limit === '') {
          nextFilters.limit = 100;
      }
      const parsedLimit = Number.parseInt(nextFilters.limit, 10);
      if (Number.isFinite(parsedLimit) && parsedLimit !== this.curateLimit) {
          this.curateLimit = parsedLimit;
      }
      this.curateFilters = nextFilters;
      this._fetchCurateImages();
  }

  _buildCurateFilters() {
      const filters = {
          limit: this.curateLimit,
          offset: this.curatePageOffset || 0,
          sortOrder: this.curateOrderDirection,
      };
      if (this.curateHideDeleted) {
          filters.hideZeroRating = true;
      }
      if (this.curateNoPositivePermatags) {
          filters.permatagPositiveMissing = true;
      }
      if (this.curateMinRating !== null && this.curateMinRating !== undefined) {
          filters.rating = this.curateMinRating;
          filters.ratingOperator = this.curateMinRating === 0 ? 'eq' : 'gte';
      }
      if (this.curateOrderBy) {
          filters.orderBy = this.curateOrderBy;
      }
      if (this.curateKeywordFilters && Object.keys(this.curateKeywordFilters).length) {
          const hasSelections = Object.values(this.curateKeywordFilters)
              .some((keywordsSet) => keywordsSet && keywordsSet.size > 0);
          if (hasSelections) {
              filters.keywords = this.curateKeywordFilters;
              filters.operators = this.curateKeywordOperators || {};
              filters.categoryFilterSource = 'permatags';
          }
      }
      if (this.activeTab === 'search' && this.searchDropboxPathPrefix) {
          filters.dropboxPathPrefix = this.searchDropboxPathPrefix;
      }
      return filters;
  }

  _applyCurateFilters({ resetOffset = false } = {}) {
      if (resetOffset) {
          this.curatePageOffset = 0;
      }
      this.curateFilters = this._buildCurateFilters();
      if (this.curateMinRating === 0 && this.curateHideDeleted) {
          this.curateImages = [];
          this.curateTotal = 0;
          return;
      }
      this._fetchCurateImages();
  }

  _handleCurateLimitChange(e) {
      const parsed = Number.parseInt(e.target.value, 10);
      const allowedSizes = new Set([50, 100, 200]);
      if (!Number.isFinite(parsed) || !allowedSizes.has(parsed)) {
          this.curateLimit = 100;
      } else {
          this.curateLimit = parsed;
      }
      this.curateAuditLimit = this.curateLimit;
      this.curateAuditOffset = 0;
      this.curateAuditTotal = null;
      this.curateAuditLoadAll = false;
      this.curateAuditPageOffset = 0;
      this._applyCurateFilters({ resetOffset: true });
      if (this.curateSubTab === 'tag-audit' && this.curateAuditKeyword) {
          this._fetchCurateAuditImages();
      }
  }

  _handleCurateOrderByChange(e) {
      this.curateOrderBy = e.target.value;
      this._applyCurateFilters({ resetOffset: true });
  }

  _handleCurateOrderDirectionChange(e) {
      this.curateOrderDirection = e.target.value;
      this._applyCurateFilters({ resetOffset: true });
  }

  _handleCurateQuickSort(orderBy) {
      if (this.curateOrderBy === orderBy) {
          this.curateOrderDirection = this.curateOrderDirection === 'desc' ? 'asc' : 'desc';
      } else {
          this.curateOrderBy = orderBy;
          this.curateOrderDirection = 'desc';
      }
      this._applyCurateFilters({ resetOffset: true });
  }

  _getCurateQuickSortArrow(orderBy) {
      const direction = this.curateOrderBy === orderBy ? this.curateOrderDirection : 'desc';
      return direction === 'desc' ? '↓' : '↑';
  }

  _cancelCuratePressState() {
      if (this._curatePressTimer) {
          clearTimeout(this._curatePressTimer);
          this._curatePressTimer = null;
      }
      this._curatePressActive = false;
      this._curatePressStart = null;
      this._curatePressIndex = null;
      this._curatePressImageId = null;
      this._curateLongPressTriggered = false;
  }

  _cancelCurateAuditPressState() {
      if (this._curateAuditPressTimer) {
          clearTimeout(this._curateAuditPressTimer);
          this._curateAuditPressTimer = null;
      }
      this._curateAuditPressActive = false;
      this._curateAuditPressStart = null;
      this._curateAuditPressIndex = null;
      this._curateAuditPressImageId = null;
      this._curateAuditLongPressTriggered = false;
  }

  _startCurateSelection(index, imageId) {
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
      this._updateCurateDragSelection();
  }

  _startCurateAuditSelection(index, imageId) {
      if (this.curateAuditDragSelection.includes(imageId)) {
          return;
      }
      this._cancelCurateAuditPressState();
      this._curateAuditLongPressTriggered = true;
      this.curateAuditDragSelecting = true;
      this.curateAuditDragStartIndex = index;
      this.curateAuditDragEndIndex = index;
      this._curateSuppressClick = true;
      this._updateCurateAuditDragSelection();
  }

  _handleCuratePointerDown(event, index, imageId) {
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
      this._curatePressTimer = setTimeout(() => {
          if (this._curatePressActive) {
              this._startCurateSelection(index, imageId);
          }
      }, 250);
  }

  _handleCuratePointerDownWithOrder(event, index, imageId, order) {
      this._curateDragOrder = Array.isArray(order) ? order : null;
      this._handleCuratePointerDown(event, index, imageId);
  }

  _handleCurateSelectHoverWithOrder(index, order) {
      this._curateDragOrder = Array.isArray(order) ? order : null;
      this._handleCurateSelectHover(index);
  }

  _handleCuratePointerMove(event) {
      if (!this._curatePressActive || this.curateDragSelecting) {
          return;
      }
      if (!this._curatePressStart) {
          return;
      }
      const dx = Math.abs(event.clientX - this._curatePressStart.x);
      const dy = Math.abs(event.clientY - this._curatePressStart.y);
      if (dx + dy > 6) {
          this._cancelCuratePressState();
      }
  }

  _handleCurateAuditPointerDown(event, index, imageId) {
      if (this.curateAuditDragSelecting) {
          return;
      }
      if (event.button !== 0) {
          return;
      }
      if (this.curateAuditDragSelection.length && this.curateAuditDragSelection.includes(imageId)) {
          this._curateSuppressClick = true;
          return;
      }
      this._curateSuppressClick = false;
      this._curateAuditPressActive = true;
      this._curateAuditPressStart = { x: event.clientX, y: event.clientY };
      this._curateAuditPressIndex = index;
      this._curateAuditPressImageId = imageId;
      this._curateAuditPressTimer = setTimeout(() => {
          if (this._curateAuditPressActive) {
              this._startCurateAuditSelection(index, imageId);
          }
      }, 250);
  }

  _handleCurateAuditPointerMove(event) {
      if (!this._curateAuditPressActive || this.curateAuditDragSelecting) {
          return;
      }
      if (!this._curateAuditPressStart) {
          return;
      }
      const dx = Math.abs(event.clientX - this._curateAuditPressStart.x);
      const dy = Math.abs(event.clientY - this._curateAuditPressStart.y);
      if (dx + dy > 6) {
          this._cancelCurateAuditPressState();
      }
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
              this.curateKeywordFilters = {};
              this.curateKeywordOperators = {};
          } else {
              this.curateKeywordFilters = {};
              this.curateKeywordOperators = {};
              this.curateNoPositivePermatags = false;
              this.curateAuditKeyword = '';
              this.curateAuditCategory = '';
              this.curateAuditSelection = [];
              this.curateAuditDragSelection = [];
              this.curateAuditDragTarget = null;
              this._applyCurateFilters();
          }
          return;
      }

      if (mode !== 'tag-audit' && rawValue === '__untagged__') {
          this.curateKeywordFilters = {};
          this.curateKeywordOperators = {};
          this.curateNoPositivePermatags = true;
          this.curateAuditKeyword = '';
          this.curateAuditCategory = '';
          this._applyCurateFilters({ resetOffset: true });
          return;
      }

      const [encodedCategory, ...encodedKeywordParts] = rawValue.split('::');
      const category = decodeURIComponent(encodedCategory || '');
      const keyword = decodeURIComponent(encodedKeywordParts.join('::') || '');

      if (mode === 'tag-audit') {
          this.curateAuditKeyword = keyword;
          this.curateAuditCategory = category;
          this.curateKeywordFilters = keyword
            ? { [category || 'Uncategorized']: new Set([keyword]) }
            : {};
          this.curateKeywordOperators = keyword ? { [category || 'Uncategorized']: 'OR' } : {};
          this.curateNoPositivePermatags = false;
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
          this._fetchCurateAuditImages();
          this._applyCurateFilters({ resetOffset: true });
          return;
      }

      const nextKeywords = {};
      if (keyword) {
          nextKeywords[category || 'Uncategorized'] = new Set([keyword]);
      }
      this.curateKeywordFilters = nextKeywords;
      this.curateKeywordOperators = keyword ? { [category || 'Uncategorized']: 'OR' } : {};
      this.curateNoPositivePermatags = false;
      this.curateAuditKeyword = keyword;
      this.curateAuditCategory = category || 'Uncategorized';
      this._applyCurateFilters({ resetOffset: true });
  }

  _handleCurateKeywordFilterChange(e) {
      const detail = e.detail || {};
      const nextKeywords = {};
      Object.entries(detail.keywords || {}).forEach(([category, keywordsSet]) => {
          nextKeywords[category] = keywordsSet ? new Set(keywordsSet) : new Set();
      });
      this.curateKeywordFilters = nextKeywords;
      this.curateKeywordOperators = { ...(detail.operators || {}) };
      const firstCategory = Object.keys(nextKeywords).find((cat) => nextKeywords[cat]?.size);
      const firstKeyword = firstCategory ? Array.from(nextKeywords[firstCategory])[0] : '';
      if (firstKeyword) {
          this.curateAuditKeyword = firstKeyword;
          this.curateAuditCategory = firstCategory;
      } else {
          this.curateAuditKeyword = '';
          this.curateAuditCategory = '';
      }
      this._applyCurateFilters({ resetOffset: true });
  }

  _handleCurateTagSourceChange(e) {
      this.activeCurateTagSource = e.detail?.source || 'permatags';
      this._updateCurateCategoryCards();
  }

  _updateCurateCategoryCards() {
      const sourceStats = this.tagStatsBySource?.[this.activeCurateTagSource] || {};
      this.curateCategoryCards = this._buildCategoryCards(sourceStats, true);
  }

  _getAllKeywordsFlat() {
      // Flatten all keywords from all categories for dropdown
      const sourceStats = this.tagStatsBySource?.[this.activeCurateTagSource] || this.tagStatsBySource?.permatags || {};
      const allKeywords = [];
      Object.entries(sourceStats).forEach(([category, keywords]) => {
          (keywords || []).forEach(kw => {
              allKeywords.push({
                  keyword: kw.keyword,
                  category: category,
                  count: kw.count || 0
              });
          });
      });
      // Sort by keyword name
      return allKeywords.sort((a, b) => a.keyword.localeCompare(b.keyword));
  }

  _getKeywordsByCategory() {
      // Group keywords by category with counts, returns array of [category, keywords] tuples
      const sourceStats = this.tagStatsBySource?.[this.activeCurateTagSource] || this.tagStatsBySource?.permatags || {};
      const result = [];

      Object.entries(sourceStats).forEach(([category, keywords]) => {
          const categoryKeywords = (keywords || [])
              .map(kw => ({
                  keyword: kw.keyword,
                  count: kw.count || 0
              }))
              .sort((a, b) => a.keyword.localeCompare(b.keyword));

          if (categoryKeywords.length > 0) {
              result.push([category, categoryKeywords]);
          }
      });

      // Sort categories alphabetically
      return result.sort((a, b) => a[0].localeCompare(b[0]));
  }

  _getCategoryCount(category) {
      // Get total positive permatag count for a category
      const sourceStats = this.tagStatsBySource?.[this.activeCurateTagSource] || this.tagStatsBySource?.permatags || {};
      const keywords = sourceStats[category] || [];
      return (keywords || []).reduce((sum, kw) => sum + (kw.count || 0), 0);
  }

  _handleCurateHideDeletedChange(e) {
      this.curateHideDeleted = e.target.checked;
      this._applyCurateFilters({ resetOffset: true });
  }

  _handleCurateNoPositivePermatagsChange(e) {
      this.curateNoPositivePermatags = e.target.checked;
      this._applyCurateFilters({ resetOffset: true });
  }

  _handleCurateMinRating(value) {
      if (this.curateMinRating === value) {
          this.curateMinRating = null;
      } else {
          this.curateMinRating = value;
      }
      this._applyCurateFilters({ resetOffset: true });
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

  _focusSearchListTitleInput() {
      this.updateComplete.then(() => {
          const input = this.renderRoot?.querySelector('[data-search-list-title]');
          if (input) {
              input.focus();
              input.select?.();
          }
      });
  }

  async _refreshCurateHome() {
      if (this.curateHomeRefreshing) return;
      this.curateHomeRefreshing = true;
      try {
          await this.fetchStats();
      } finally {
          this.curateHomeRefreshing = false;
      }
  }

  async _fetchSearchLists() {
      if (!this.tenant) return;
      this.searchListLoading = true;
      try {
          const selectedId = this.searchListId;
          const selectedTitle = this.searchListTitle;
          const lists = await getLists(this.tenant);
          const hasSelected = selectedId
            ? lists.some((list) => list.id === selectedId)
            : false;
          this.searchLists = hasSelected || !selectedId
            ? lists
            : [...lists, { id: selectedId, title: selectedTitle || `List ${selectedId}` }];
      } catch (error) {
          console.error('Error fetching lists:', error);
          this.searchLists = [];
      } finally {
          this.searchListLoading = false;
      }
  }

  _resetSearchListDraft() {
      this.searchListId = null;
      this.searchListTitle = this._getUniqueNewListTitle();
      this.searchSavedItems = [];
      this.searchListPromptNewTitle = false;
  }

  async _loadSearchList(listId) {
      if (!this.tenant || !listId) return;
      this.searchListId = listId;
      this.searchListLoading = true;
      try {
          const items = await getListItems(this.tenant, listId);
          this.searchSavedItems = items.map((item) => ({
              id: item.image?.id ?? item.photo_id,
              listItemId: item.id,
              filename: item.image?.filename,
              thumbnail_url: item.image?.thumbnail_url,
              rating: item.image?.rating,
              dropbox_path: item.image?.dropbox_path,
          })).filter((item) => Number.isFinite(item.id));
          const listMeta = (this.searchLists || []).find((list) => list.id === listId);
          this.searchListTitle = listMeta?.title || this.searchListTitle || '';
      } catch (error) {
          console.error('Error loading list items:', error);
          this.searchSavedItems = [];
      } finally {
          this.searchListLoading = false;
      }
  }

  _handleSearchListSelect(event) {
      const value = event.target.value;
      if (!value) {
          this._resetSearchListDraft();
          return;
      }
      const listId = Number.parseInt(value, 10);
      if (!Number.isFinite(listId)) {
          this._resetSearchListDraft();
          return;
      }
      this.searchListId = listId;
      const listMeta = (this.searchLists || []).find((list) => list.id === listId);
      this.searchListTitle = listMeta?.title || '';
      this.searchListPromptNewTitle = false;
      this._loadSearchList(listId);
  }

  _handleSearchListTitleChange(event) {
      this.searchListTitle = event.target.value;
      if (this.searchListPromptNewTitle) {
          this.searchListPromptNewTitle = false;
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

  async _persistSearchListItems(listId) {
      if (!this.tenant || !listId) return;
      const desiredIds = new Set(this.searchSavedItems.map((item) => item.id));
      const currentItems = await getListItems(this.tenant, listId, { idsOnly: true });
      const currentIds = new Set(currentItems.map((item) => item.photo_id));
      const toAdd = Array.from(desiredIds).filter((id) => !currentIds.has(id));
      const toRemove = currentItems.filter((item) => !desiredIds.has(item.photo_id));

      for (const photoId of toAdd) {
          await addToList(this.tenant, photoId);
      }
      for (const item of toRemove) {
          await deleteListItem(this.tenant, item.id);
      }
  }

  async _handleSearchSaveNewList() {
      if (!this.tenant) return;
      if (this.searchListId) {
          this.searchListId = null;
          this.searchListTitle = this._getUniqueNewListTitle();
          this.searchListPromptNewTitle = true;
          this._focusSearchListTitleInput();
          return;
      }
      this.searchListSaving = true;
      try {
          const title = (this.searchListTitle || '').trim();
          if (!title) return;
          if (this._isDuplicateListTitle(title)) return;
          const created = await createList(this.tenant, { title });
          const listId = Number.parseInt(created?.id, 10);
          if (!listId) return;
          this.searchListId = listId;
          this.searchListTitle = title;
          const existing = (this.searchLists || []).some((list) => list.id === listId);
          if (!existing) {
              this.searchLists = [...(this.searchLists || []), { id: listId, title }];
          }
          await this._fetchSearchLists();
          await this._persistSearchListItems(listId);
          await this._loadSearchList(listId);
          this.searchListPromptNewTitle = false;
          this.searchListId = listId;
          this.searchListTitle = title;
      } catch (error) {
          console.error('Error saving new list:', error);
      } finally {
          this.searchListSaving = false;
      }
  }

  async _handleSearchSaveExistingList() {
      if (!this.tenant || !this.searchListId) return;
      this.searchListSaving = true;
      try {
          const title = (this.searchListTitle || '').trim() || 'Untitled List';
          await updateList(this.tenant, { id: this.searchListId, title });
          await this._fetchSearchLists();
          await this._persistSearchListItems(this.searchListId);
          await this._loadSearchList(this.searchListId);
      } catch (error) {
          console.error('Error saving list:', error);
      } finally {
          this.searchListSaving = false;
      }
  }

  _handleTenantChange(e) {
      this.tenant = e.detail;
      this.fetchKeywords();
      this.fetchStats();
      this._fetchSearchLists();
      this.curateHideDeleted = true;
      this.curateMinRating = null;
      this.curateNoPositivePermatags = false;
      this.curateKeywordFilters = {};
      this.curateKeywordOperators = {};
      this.curateFilters = this._buildCurateFilters();
      this.curatePageOffset = 0;
      this.curateTotal = null;
      this._fetchCurateImages();
      this.curateDragSelection = [];
      this.curateSubTab = 'home';
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
      this._resetSearchListDraft();
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
        this._fetchCurateImages();
        this.fetchStats();
        this.showUploadModal = false;
    }

  _parseSearchDragIds(event) {
      const raw = event.dataTransfer?.getData('text/plain') || '';
      return raw
          .split(',')
          .map((value) => Number.parseInt(value.trim(), 10))
          .filter((value) => Number.isFinite(value) && value > 0);
  }

  _addSearchSavedImagesByIds(ids) {
      if (!ids?.length) return;
      const existingIds = new Set(this.searchSavedItems.map((item) => item.id));
      const additions = [];
      ids.forEach((id) => {
          if (existingIds.has(id)) return;
          const image = (this.curateImages || []).find((img) => img.id === id);
          if (!image) return;
          additions.push({
              id: image.id,
              filename: image.filename,
              thumbnail_url: image.thumbnail_url || `/api/v1/images/${image.id}/thumbnail`,
              rating: image.rating,
              dropbox_path: image.dropbox_path,
          });
      });
      if (additions.length) {
          this.searchSavedItems = [...this.searchSavedItems, ...additions];
      }
  }

  _handleSearchRemoveSaved(id) {
      this.searchSavedItems = this.searchSavedItems.filter((item) => item.id !== id);
  }

  _handleSearchSavedDragStart(event, image) {
      if (!image?.id) return;
      event.dataTransfer.setData('text/plain', String(image.id));
      event.dataTransfer.setData('application/x-photocat-source', 'saved');
      event.dataTransfer.effectAllowed = 'move';
  }

  _handleSearchSavedDragOver(event) {
      event.preventDefault();
      if (!this.searchSavedDragTarget) {
          this.searchSavedDragTarget = true;
      }
  }

  _handleSearchSavedDragLeave() {
      if (this.searchSavedDragTarget) {
          this.searchSavedDragTarget = false;
      }
  }

  _handleSearchSavedDrop(event) {
      event.preventDefault();
      const ids = this._parseSearchDragIds(event);
      if (!ids.length) {
          this._handleSearchSavedDragLeave();
          return;
      }
      this._addSearchSavedImagesByIds(ids);
      this._handleSearchSavedDragLeave();
  }

  _handleSearchAvailableDragOver(event) {
      event.preventDefault();
  }

  _handleSearchAvailableDrop(event) {
      event.preventDefault();
      const source = event.dataTransfer?.getData('application/x-photocat-source');
      if (source !== 'saved') {
          return;
      }
      const ids = this._parseSearchDragIds(event);
      if (!ids.length) return;
      const removeSet = new Set(ids);
      this.searchSavedItems = this.searchSavedItems.filter((item) => !removeSet.has(item.id));
  }

  _handleChipFiltersChanged(event) {
      const filters = event.detail.filters;

      // Store the chip filters
      this.searchChipFilters = filters;

      // Reset all filters first
      this.curateKeywordFilters = {};
      this.curateMinRating = null;
      this.searchDropboxPathPrefix = '';

      // Apply each filter
      filters.forEach(filter => {
          switch (filter.type) {
              case 'keyword':
                  if (filter.value === '__untagged__') {
                      this.curateNoPositivePermatags = true;
                  } else {
                      this.curateKeywordFilters = { [filter.category]: new Set([filter.value]) };
                  }
                  break;
              case 'rating':
                  this.curateMinRating = filter.value;
                  break;
              case 'folder':
                  this.searchDropboxPathPrefix = filter.value;
                  break;
          }
      });

      // Reset page offset and rebuild filters
      this.curatePageOffset = 0;
      this._applyCurateFilters({ resetOffset: true });

      // Fetch images with new filters
      this._fetchCurateImages();
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

  _handleSearchDropboxInput(event) {
      // Handle both native input events and custom events from filter-chips
      const value = event.detail?.query ?? event.target?.value ?? '';
      this.searchDropboxQuery = value;
      this.searchDropboxOpen = !!value.trim();
      if (this._searchDropboxFetchTimer) {
          clearTimeout(this._searchDropboxFetchTimer);
      }
      if (!value.trim()) {
          this.searchDropboxOptions = [];
          return;
      }
      this._searchDropboxFetchTimer = setTimeout(() => {
          this._fetchDropboxFolders(value.trim());
      }, 250);
  }

  _handleSearchDropboxFocus() {
      if (this.searchDropboxQuery.trim()) {
          this.searchDropboxOpen = true;
      }
  }

  _handleSearchDropboxBlur() {
      setTimeout(() => {
          this.searchDropboxOpen = false;
      }, 120);
  }

  _handleSearchDropboxSelect(event) {
      const value = (event.target.value || '').trim();
      this.searchDropboxPathPrefix = value;
      this.curatePageOffset = 0;
      this._applyCurateFilters({ resetOffset: true });
  }

  _handleSearchDropboxPick(folder) {
      this.searchDropboxQuery = folder;
      this.searchDropboxPathPrefix = folder;
      this.searchDropboxOpen = false;
      this.curatePageOffset = 0;
      this._applyCurateFilters({ resetOffset: true });
  }

  _handleSearchDropboxClear() {
      this.searchDropboxQuery = '';
      this.searchDropboxPathPrefix = '';
      this.searchDropboxOptions = [];
      this.searchDropboxOpen = false;
      this.curatePageOffset = 0;
      this._applyCurateFilters({ resetOffset: true });
  }

  async _fetchCurateImages(extraFilters = {}) {
      if (!this.tenant) return;
      this.curateLoading = true;
      try {
          const requestFilters = { ...this.curateFilters, ...extraFilters };
          if (Number.isFinite(requestFilters.limit) && requestFilters.limit !== this.curateLimit) {
              this.curateLimit = requestFilters.limit;
          }
          const result = await getImages(this.tenant, requestFilters);
          this.curateImages = Array.isArray(result) ? result : (result.images || []);
          this.curateTotal = Array.isArray(result)
            ? null
            : Number.isFinite(result.total)
              ? result.total
              : null;
          if (!Array.isArray(result) && Number.isFinite(result.limit)) {
              const allowedSizes = new Set([50, 100, 200]);
              if (allowedSizes.has(result.limit)) {
                  if (result.limit !== this.curateLimit) {
                      this.curateLimit = result.limit;
                  }
                  this.curateFilters = { ...(this.curateFilters || {}), limit: result.limit };
              }
          }
          if (!Array.isArray(result) && Number.isFinite(result.offset)) {
              this.curatePageOffset = result.offset;
          }
      } catch (error) {
          console.error('Error fetching curate images:', error);
      } finally {
          this.curateLoading = false;
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
              this._fetchCurateImages();
          }
      }
      if (nextTab === 'tag-audit' && this.curateAuditKeyword) {
          this._fetchCurateAuditImages();
      }
  }

  _handleSearchSubTabChange(nextTab) {
      if (!nextTab || this.searchSubTab === nextTab) {
          return;
      }
      this.searchSubTab = nextTab;
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

  _handleCurateAuditLimitChange(e) {
      const parsed = Number.parseInt(e.target.value, 10);
      const allowedSizes = new Set([50, 100, 200]);
      if (!Number.isFinite(parsed) || !allowedSizes.has(parsed)) {
          this.curateAuditLimit = 50;
      } else {
          this.curateAuditLimit = parsed;
      }
      this.curateAuditOffset = 0;
      this.curateAuditTotal = null;
      this.curateAuditLoadAll = false;
      this.curateAuditPageOffset = 0;
      if (this.curateAuditKeyword) {
          this._fetchCurateAuditImages();
      }
  }

  _handleCurateAuditLoadMore() {
      if (this.curateAuditLoading) return;
      this._fetchCurateAuditImages({ append: true });
  }

  _handleCurateAuditLoadAll() {
      if (this.curateAuditLoading || !this.curateAuditKeyword) return;
      this.curateAuditOffset = 0;
      this.curateAuditTotal = null;
      this.curateAuditLoadAll = true;
      this.curateAuditPageOffset = 0;
      this._fetchCurateAuditImages({ loadAll: true });
  }

  _handleCuratePagePrev() {
      if (this.curateLoading) return;
      const nextOffset = Math.max(0, (this.curatePageOffset || 0) - this.curateLimit);
      this.curatePageOffset = nextOffset;
      this._applyCurateFilters();
  }

  _handleCuratePageNext() {
      if (this.curateLoading) return;
      const nextOffset = (this.curatePageOffset || 0) + this.curateLimit;
      this.curatePageOffset = nextOffset;
      this._applyCurateFilters();
  }

  _handleCurateAuditPagePrev() {
      if (this.curateAuditLoading) return;
      const nextOffset = Math.max(0, (this.curateAuditPageOffset || 0) - this.curateAuditLimit);
      this.curateAuditLoadAll = false;
      this._fetchCurateAuditImages({ offset: nextOffset });
  }

  _handleCurateAuditPageNext() {
      if (this.curateAuditLoading) return;
      const nextOffset = (this.curateAuditPageOffset || 0) + this.curateAuditLimit;
      this.curateAuditLoadAll = false;
      this._fetchCurateAuditImages({ offset: nextOffset });
  }

  async _fetchCurateAuditImages({ append = false, loadAll = false, offset = null } = {}) {
      if (!this.tenant || !this.curateAuditKeyword) return;
      const useAiSort = this.curateAuditMode === 'missing'
          && this.curateAuditAiEnabled
          && !!this.curateAuditAiModel;
      if (this.curateMinRating === 0 && this.curateHideDeleted) {
          this.curateAuditImages = [];
          this.curateAuditOffset = 0;
          this.curateAuditTotal = 0;
          this.curateAuditPageOffset = 0;
          return;
      }
      this.curateAuditLoading = true;
      try {
          const useLoadAll = loadAll || this.curateAuditLoadAll;
          const resolvedOffset = offset !== null && offset !== undefined
              ? offset
              : append
                ? this.curateAuditOffset
                : (this.curateAuditPageOffset || 0);
          const filters = {
              sortOrder: this.curateOrderDirection,
              orderBy: useAiSort ? 'ml_score' : this.curateOrderBy,
              permatagKeyword: this.curateAuditKeyword,
              permatagCategory: this.curateAuditCategory,
              permatagSignum: 1,
              permatagMissing: this.curateAuditMode === 'missing',
          };
          if (useAiSort) {
              filters.mlKeyword = this.curateAuditKeyword;
              filters.mlTagType = this.curateAuditAiModel;
          }
          if (this.curateHideDeleted) {
              filters.hideZeroRating = true;
          }
          if (this.curateMinRating !== null && this.curateMinRating !== undefined) {
              filters.rating = this.curateMinRating;
              filters.ratingOperator = this.curateMinRating === 0 ? 'eq' : 'gte';
          }
          if (!useLoadAll) {
              filters.limit = this.curateAuditLimit;
              filters.offset = resolvedOffset;
          }
          const result = await getImages(this.tenant, filters);
          const images = Array.isArray(result) ? result : (result.images || []);
          const total = Array.isArray(result)
              ? null
              : Number.isFinite(result.total)
                ? result.total
                : null;
          if (append) {
              this.curateAuditImages = [...this.curateAuditImages, ...images];
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
      } catch (error) {
          console.error('Error fetching curate audit images:', error);
      } finally {
          this.curateAuditLoading = false;
      }
  }

  _handleCurateAuditDragStart(event, image) {
      if (this.curateAuditDragSelecting) {
          event.preventDefault();
          return;
      }
      let ids = [image.id];
      if (this.curateAuditDragSelection.length && this.curateAuditDragSelection.includes(image.id)) {
          ids = this.curateAuditDragSelection;
      } else if (this.curateAuditDragSelection.length) {
          this.curateAuditDragSelection = [image.id];
      }
      event.dataTransfer.setData('text/plain', ids.join(','));
      event.dataTransfer.effectAllowed = 'move';
  }

  _handleCurateAuditDragOver(event) {
      event.preventDefault();
      if (this.curateAuditDragTarget !== 'right') {
          this.curateAuditDragTarget = 'right';
      }
  }

  _handleCurateAuditDragLeave() {
      if (this.curateAuditDragTarget) {
          this.curateAuditDragTarget = null;
      }
  }

  _handleCurateAuditDrop(event) {
      event.preventDefault();
      if (!this.curateAuditKeyword) return;
      const raw = event.dataTransfer.getData('text/plain') || '';
      const ids = raw
          .split(',')
          .map((value) => Number(value.trim()))
          .filter((value) => Number.isFinite(value) && value > 0);
      if (!ids.length) return;
      const idSet = new Set(ids);
      const additions = this.curateAuditImages.filter((img) => idSet.has(img.id));
      if (!additions.length) return;
      const signum = this.curateAuditMode === 'existing' ? -1 : 1;
      const category = this.curateAuditCategory || 'Uncategorized';
      const operations = additions.map((image) => ({
          image_id: image.id,
          keyword: this.curateAuditKeyword,
          category,
          signum,
      }));
      enqueueCommand({
          type: 'bulk-permatags',
          tenantId: this.tenant,
          operations,
          description: `tag audit · ${operations.length} updates`,
      });
      const updatedAdditions = additions.map((image) => (
          this._applyAuditPermatagChange(image, signum, this.curateAuditKeyword, category)
      ));
      this.curateAuditSelection = [...this.curateAuditSelection, ...updatedAdditions];
      this.curateAuditImages = this.curateAuditImages.filter((img) => !idSet.has(img.id));
      this.curateAuditDragSelection = this.curateAuditDragSelection.filter((id) => !idSet.has(id));
      this.curateAuditDragTarget = null;
  }

  _handleCurateAuditSelectStart(event, index, imageId) {
      if (this.curateAuditDragSelection.includes(imageId)) {
          return;
      }
      event.preventDefault();
      this._startCurateAuditSelection(index, imageId);
  }

  _handleCurateAuditSelectHover(index) {
      if (!this.curateAuditDragSelecting) return;
      if (this.curateAuditDragEndIndex !== index) {
          this.curateAuditDragEndIndex = index;
          this._updateCurateAuditDragSelection();
      }
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
      if (!this._curateAuditLeftOrder || this.curateAuditDragStartIndex === null || this.curateAuditDragEndIndex === null) {
          return;
      }
      const start = Math.min(this.curateAuditDragStartIndex, this.curateAuditDragEndIndex);
      const end = Math.max(this.curateAuditDragStartIndex, this.curateAuditDragEndIndex);
      const ids = this._curateAuditLeftOrder.slice(start, end + 1);
      this.curateAuditDragSelection = ids;
  }

  _handleCurateAuditClearSelection() {
      this.curateAuditSelection = [];
  }

  _applyAuditPermatagChange(image, signum, keyword, category) {
      const permatags = Array.isArray(image?.permatags) ? image.permatags : [];
      if (signum === 1) {
          return { ...image, permatags: this._mergePermatags(permatags, [{ keyword, category }]) };
      }
      const matches = (tag) => tag.keyword === keyword && (tag.category || 'Uncategorized') === (category || 'Uncategorized');
      const next = permatags.filter((tag) => !(tag.signum === 1 && matches(tag)));
      return { ...image, permatags: next };
  }

  _handleCurateImageClick(event, image) {
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
      this.curateEditorImage = image;
      this.curateEditorImageSet = Array.isArray(this.curateImages) ? [...this.curateImages] : [];
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
      this.curateFilters = this._buildCurateFilters();
      await this._fetchCurateImages({ anchorId: imageId, offset: 0 });
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
      if (this.curateDragSelection.includes(imageId)) {
          return;
      }
      event.preventDefault();
      this._startCurateSelection(index, imageId);
  }

  _handleCurateSelectHover(index) {
      if (!this.curateDragSelecting) return;
      if (this.curateDragEndIndex !== index) {
          this.curateDragEndIndex = index;
          this._updateCurateDragSelection();
      }
  }

  _updateCurateDragSelection() {
      const order = this._curateDragOrder || this._curateLeftOrder;
      if (!order || this.curateDragStartIndex === null || this.curateDragEndIndex === null) {
          return;
      }
      const start = Math.min(this.curateDragStartIndex, this.curateDragEndIndex);
      const end = Math.max(this.curateDragStartIndex, this.curateDragEndIndex);
      const ids = order.slice(start, end + 1);
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
    const untaggedCountLabel = this._formatStatNumber(this.imageStats?.untagged_positive_count);

    const advancedPanel = this.curateAdvancedOpen ? html`
      <div class="border rounded-lg">
        <div class="px-3 py-3 bg-gray-50 space-y-4 ${renderDropboxFolder ? 'search-accordion' : ''}">
        <!-- Existing filter controls moved into accordion -->
        <div class="flex flex-wrap md:flex-nowrap items-end gap-4">
                ${hideSortControls ? html`` : html`
                <div class="flex-[2] min-w-[180px]">
                  <label class="block text-xs font-semibold text-gray-600 mb-1">Sort items by</label>
                  <div class="grid grid-cols-2 gap-2">
                    <select
                      class="w-full px-2 py-1 border rounded-lg text-xs"
                      .value=${this.curateOrderBy}
                      @change=${this._handleCurateOrderByChange}
                    >
                      <option value="photo_creation">Photo Date</option>
                      <option value="processed">Process Date</option>
                    </select>
                    <select
                      class="w-full px-2 py-1 border rounded-lg text-xs"
                      .value=${this.curateOrderDirection}
                      @change=${this._handleCurateOrderDirectionChange}
                    >
                      <option value="desc">Desc</option>
                      <option value="asc">Asc</option>
                    </select>
                  </div>
                </div>
                `}
                ${hideRatingControls ? html`` : html`
                <div class="flex-[2] min-w-[200px]">
                  <label class="block text-xs font-semibold text-gray-600 mb-1">Rating</label>
                  <div class="flex flex-wrap items-center gap-2">
                    <label class="inline-flex items-center gap-2 text-xs text-gray-600">
                      <input
                        type="checkbox"
                        class="h-4 w-4"
                        .checked=${this.curateHideDeleted}
                        @change=${this._handleCurateHideDeletedChange}
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
                            class="inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs ${this.curateMinRating === value ? 'bg-yellow-100 text-yellow-800 border-yellow-200' : 'bg-gray-100 text-gray-500 border-gray-200'}"
                            title=${title}
                            @click=${() => this._handleCurateMinRating(value)}
                          >
                            <i class="fas fa-star"></i>
                            <span>${label}</span>
                          </button>
                        `;
                      })}
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
                      .checked=${this.curateNoPositivePermatags}
                      @change=${this._handleCurateNoPositivePermatagsChange}
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
              <select
                class="w-full ${mode === 'tag-audit' ? 'px-3 py-2' : 'px-4 py-3 text-lg'} border rounded-lg ${selectedKeywordValue ? 'bg-yellow-100 border-yellow-200' : ''}"
                .value=${selectedKeywordValue}
                @change=${(event) => this._handleCurateKeywordSelect(event, mode)}
              >
                <option value="">Select a keyword...</option>
                ${mode !== 'tag-audit'
                  ? html`<option value="__untagged__">Untagged (${untaggedCountLabel})</option>`
                  : html``}
                ${this._getKeywordsByCategory().map(([category, keywords]) => html`
                  <optgroup label="${category} (${this._getCategoryCount(category)})">
                    ${keywords.map(kw => html`
                      <option value=${`${encodeURIComponent(category)}::${encodeURIComponent(kw.keyword)}`}>
                        ${kw.keyword} (${kw.count})
                      </option>
                    `)}
                  </optgroup>
                `)}
              </select>
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
    const imageCount = this._formatStatNumber(this.imageStats?.image_count);
    const reviewedCount = this._formatStatNumber(this.imageStats?.reviewed_image_count);
    const mlTagCount = this._formatStatNumber(this.imageStats?.ml_tag_count);
    const trainedTagCount = this._formatStatNumber(this.mlTrainingStats?.trained_image_count);
    const navCards = [
      { key: 'search', label: 'Search', subtitle: 'Explore and save results', icon: 'fa-magnifying-glass' },
      { key: 'curate', label: 'Curate', subtitle: 'Build stories and sets', icon: 'fa-star' },
      { key: 'lists', label: 'Lists', subtitle: 'Organize saved sets', icon: 'fa-list' },
      { key: 'people', label: 'People', subtitle: 'Manage and tag people', icon: 'fa-users' },
      { key: 'tagging', label: 'Tagging', subtitle: 'Manage keywords and labels', icon: 'fa-tags' },
      { key: 'ml-training', label: 'Pipeline', subtitle: 'Inspect training data', icon: 'fa-brain' },
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
    const leftPaneLabel = `${this._formatStatNumber(leftPaneCount)} Items`;
    const untaggedCountLabel = this._formatStatNumber(this.imageStats?.untagged_positive_count);
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
    const auditLeftLabel = this.curateAuditKeyword
      ? (this.curateAuditMode === 'existing'
        ? `All images WITH tag: ${auditKeywordLabel}`
        : `All images WITHOUT tag: ${auditKeywordLabel}`)
      : 'Select a keyword';
    const auditRightLabel = this.curateAuditKeyword
      ? `${auditActionVerb === 'add' ? 'ADD TAG' : 'REMOVE TAG'}: ${auditKeywordLabel}`
      : `${auditActionVerb === 'add' ? 'ADD TAG' : 'REMOVE TAG'}: keyword`;
    const auditDropLabel = this.curateAuditKeyword
      ? `Drag here to ${auditActionVerb} tag: ${auditKeywordLabel}`
      : 'Select a keyword to start';
    const curateRefreshBusy = this.curateSubTab === 'home'
      ? this.curateHomeRefreshing
      : (this.curateSubTab === 'tag-audit' ? this.curateAuditLoading : this.curateLoading);
    const auditLeftImages = this.curateAuditImages;
    this._curateAuditLeftOrder = auditLeftImages.map((img) => img.id);
    const auditLoadAll = this.curateAuditLoadAll;
    const auditTotalCount = auditLoadAll
      ? auditLeftImages.length
      : Number.isFinite(this.curateAuditTotal)
        ? this.curateAuditTotal
        : null;
    const auditPageStart = auditLeftImages.length
      ? (auditLoadAll ? 1 : (this.curateAuditPageOffset || 0) + 1)
      : 0;
    const auditPageEnd = auditLeftImages.length
      ? (auditLoadAll
        ? auditLeftImages.length
        : (this.curateAuditPageOffset || 0) + auditLeftImages.length)
      : 0;
    const auditCountLabel = auditTotalCount !== null
      ? (auditPageEnd === 0
        ? `0 of ${auditTotalCount}`
        : `${auditPageStart}-${auditPageEnd} of ${auditTotalCount}`)
      : `${auditLeftImages.length} loaded`;
    const auditHasMore = !auditLoadAll && auditTotalCount !== null
      && auditPageEnd < auditTotalCount;
    const auditHasPrev = !auditLoadAll && (this.curateAuditPageOffset || 0) > 0;

    const renderPageSizeSelect = (value, onChange) => html`
      <label class="inline-flex items-center gap-2 text-xs text-gray-500">
        <span>Results per page:</span>
        <select
          class="px-2 py-1 border rounded-md text-xs bg-white"
          .value=${String(value)}
          @change=${onChange}
        >
          ${[100, 50, 200].map((size) => html`<option value=${String(size)}>${size}</option>`)}
        </select>
      </label>
    `;
    const renderPaginationControls = ({
      countLabel,
      hasPrev,
      hasNext,
      onPrev,
      onNext,
      pageSize,
      onPageSizeChange,
      disabled = false,
      showPageSize = true,
    }) => html`
      <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
        ${showPageSize ? renderPageSizeSelect(pageSize, onPageSizeChange) : html``}
        <div class="flex items-center gap-3">
          <span>${countLabel}</span>
          <button
            class="curate-pane-action secondary"
            ?disabled=${disabled || !hasPrev}
            @click=${onPrev}
            aria-label="Previous page"
          >
            &lt;
          </button>
          <button
            class="curate-pane-action secondary"
            ?disabled=${disabled || !hasNext}
            @click=${onNext}
            aria-label="Next page"
          >
            &gt;
          </button>
        </div>
      </div>
    `;

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
            <div slot="home" class="container">
                <div class="flex flex-wrap gap-4 mb-6">
                    <div class="flex-1 min-w-[200px] border border-gray-200 rounded-lg p-3 bg-white shadow">
                        <div class="text-xs text-gray-500 uppercase">Images</div>
                        <div class="text-2xl font-semibold text-gray-900">${imageCount}</div>
                    </div>
                    <div class="flex-1 min-w-[200px] border border-gray-200 rounded-lg p-3 bg-white shadow">
                        <div class="text-xs text-gray-500 uppercase">Reviewed</div>
                        <div class="text-2xl font-semibold text-gray-900">${reviewedCount}</div>
                    </div>
                    <div class="flex-1 min-w-[200px] border border-gray-200 rounded-lg p-3 bg-white shadow">
                        <div class="text-xs text-gray-500 uppercase">Zero-Shot</div>
                        <div class="text-2xl font-semibold text-gray-900">${mlTagCount}</div>
                    </div>
                    <div class="flex-1 min-w-[200px] border border-gray-200 rounded-lg p-3 bg-white shadow">
                        <div class="text-xs text-gray-500 uppercase">Keyword-Model</div>
                        <div class="text-2xl font-semibold text-gray-900">${trainedTagCount}</div>
                    </div>
                </div>
                <div class="home-nav-grid">
                  ${navCards.map((card) => html`
                    <button
                      class="home-nav-button"
                      type="button"
                      @click=${() => { this.activeTab = card.key; }}
                    >
                      <div>
                        <div class="text-lg font-semibold text-gray-900">${card.label}</div>
                        <div class="text-sm text-gray-500">${card.subtitle}</div>
                      </div>
                      <span class="text-2xl text-blue-600"><i class="fas ${card.icon}"></i></span>
                    </button>
                  `)}
                </div>
            </div>
            <div slot="search" class="container">
                <div class="flex items-center justify-between mb-4">
                    <div class="curate-subtabs">
                        <button
                          class="curate-subtab ${this.searchSubTab === 'home' ? 'active' : ''}"
                          @click=${() => this._handleSearchSubTabChange('home')}
                        >
                          Search Home
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
                      @click=${() => { this._fetchCurateImages(); this._fetchSearchLists(); }}
                      title="Refresh"
                    >
                      <span aria-hidden="true">↻</span>
                      Refresh
                    </button>
                </div>
                <div ?hidden=${this.searchSubTab !== 'home'}>
                  <!-- Search Home View -->
                  <filter-chips
                    .tenant=${this.tenant}
                    .tagStatsBySource=${this.tagStatsBySource}
                    .activeCurateTagSource=${this.activeCurateTagSource || 'permatags'}
                    .imageStats=${this.imageStats}
                    .activeFilters=${this.searchChipFilters}
                    .dropboxFolders=${this.searchDropboxOptions || []}
                    @filters-changed=${this._handleChipFiltersChanged}
                    @folder-search=${this._handleSearchDropboxInput}
                  >
                    <div slot="sort-controls" class="flex items-center gap-2">
                      <span class="text-sm font-semibold text-gray-700">Sort:</span>
                      <div class="curate-audit-toggle">
                        <button
                          class=${this.curateOrderBy === 'rating' ? 'active' : ''}
                          @click=${() => this._handleCurateQuickSort('rating')}
                        >
                          Rating ${this._getCurateQuickSortArrow('rating')}
                        </button>
                        <button
                          class=${this.curateOrderBy === 'photo_creation' ? 'active' : ''}
                          @click=${() => this._handleCurateQuickSort('photo_creation')}
                        >
                          Photo Date ${this._getCurateQuickSortArrow('photo_creation')}
                        </button>
                        <button
                          class=${this.curateOrderBy === 'processed' ? 'active' : ''}
                          @click=${() => this._handleCurateQuickSort('processed')}
                        >
                          Process Date ${this._getCurateQuickSortArrow('processed')}
                        </button>
                      </div>
                    </div>
                    <div slot="view-controls" class="flex items-center gap-3">
                      <span class="text-sm font-semibold text-gray-700">View:</span>
                      <input
                        type="range"
                        min="80"
                        max="220"
                        step="10"
                        .value=${String(this.curateThumbSize)}
                        @input=${this._handleCurateThumbSizeChange}
                        class="w-24"
                      >
                      <span class="text-xs text-gray-600">${this.curateThumbSize}px</span>
                    </div>
                  </filter-chips>

                  <!-- Image Grid for Chip Filters -->
                  <div class="curate-layout search-layout" style="--curate-thumb-size: ${this.curateThumbSize}px;">
                    <div
                      class="curate-pane"
                      @dragover=${this._handleSearchAvailableDragOver}
                      @drop=${this._handleSearchAvailableDrop}
                    >
                        <div class="curate-pane-header">
                            <div class="curate-pane-header-row">
                                <span>${leftPaneLabel}</span>
                                <div class="curate-pane-header-actions">
                                  ${renderPaginationControls({
                                    countLabel: curateCountLabel,
                                    hasPrev: curateHasPrev,
                                    hasNext: curateHasMore,
                                    onPrev: this._handleCuratePagePrev,
                                    onNext: this._handleCuratePageNext,
                                    pageSize: this.curateLimit,
                                    onPageSizeChange: this._handleCurateLimitChange,
                                    disabled: this.curateLoading,
                                  })}
                                </div>
                            </div>
                        </div>
                        ${this.curateLoading ? html`
                          <div class="curate-loading-overlay" aria-label="Loading">
                            <span class="curate-spinner large"></span>
                          </div>
                        ` : html``}
                        <div class="curate-pane-body">
                            ${this.curateImages.length ? html`
                              <div class="curate-grid">
                                ${this.curateImages.map((image, index) => html`
                                  <div class="curate-thumb-wrapper" @click=${(event) => this._handleCurateImageClick(event, image)}>
                                    <img
                                      src=${image.thumbnail_url || `/api/v1/images/${image.id}/thumbnail`}
                                      alt=${image.filename}
                                      class="curate-thumb ${this.curateDragSelection.includes(image.id) ? 'selected' : ''}"
                                      draggable="true"
                                      @dragstart=${(event) => this._handleCurateDragStart(event, image)}
                                      @pointerdown=${(event) => this._handleCuratePointerDown(event, index, image.id)}
                                      @pointermove=${(event) => this._handleCuratePointerMove(event)}
                                      @pointerenter=${() => this._handleCurateSelectHover(index)}
                                    >
                                    ${this._renderCurateRatingWidget(image)}
                                    ${this._renderCurateRatingStatic(image)}
                                    ${this._renderCurateAiMLScore(image)}
                                    ${this._renderCuratePermatagSummary(image)}
                                    ${this._formatCurateDate(image) ? html`
                                      <div class="curate-thumb-date">
                                        <span class="curate-thumb-id">#${image.id}</span>
                                        <span class="curate-thumb-icon" aria-hidden="true">📷</span>${this._formatCurateDate(image)}
                                      </div>
                                    ` : html``}
                                  </div>
                                `)}
                              </div>
                            ` : html`
                              <div class="curate-drop">
                                No images available.
                              </div>
                            `}
                            <div class="curate-pane-header-row mt-3">
                              <span>${leftPaneLabel}</span>
                              <div class="curate-pane-header-actions">
                                ${renderPaginationControls({
                                  countLabel: curateCountLabel,
                                  hasPrev: curateHasPrev,
                                  hasNext: curateHasMore,
                                  onPrev: this._handleCuratePagePrev,
                                  onNext: this._handleCuratePageNext,
                                  pageSize: this.curateLimit,
                                  onPageSizeChange: this._handleCurateLimitChange,
                                  disabled: this.curateLoading,
                                })}
                              </div>
                            </div>
                        </div>
                    </div>
                    <div
                      class="curate-pane utility-targets search-saved-pane ${this.searchSavedDragTarget ? 'drag-active' : ''}"
                      @dragover=${this._handleSearchSavedDragOver}
                      @dragleave=${this._handleSearchSavedDragLeave}
                      @drop=${this._handleSearchSavedDrop}
                    >
                        <div class="curate-pane-header">
                            <div class="curate-pane-header-row">
                                <span>Saved Items</span>
                            </div>
                            <div class="search-list-controls mt-2">
                              ${(() => {
                                const options = [...(this.searchLists || [])];
                                const selectedValue = this.searchListId ? String(this.searchListId) : '';
                                if (selectedValue && !options.some((list) => String(list.id) === selectedValue)) {
                                  options.unshift({
                                    id: this.searchListId,
                                    title: this.searchListTitle || `List ${this.searchListId}`,
                                  });
                                }
                                return html`
                              <div class="search-list-row">
                                <span class="search-list-label">Current List:</span>
                                <select
                                  class="flex-1 min-w-[160px]"
                                  ?disabled=${this.searchListLoading}
                                  @change=${this._handleSearchListSelect}
                                >
                                  <option value="" ?selected=${!selectedValue}>New list</option>
                                  ${options.map((list) => html`
                                    <option
                                      value=${String(list.id)}
                                      ?selected=${String(list.id) === selectedValue}
                                    >
                                      ${list.title || `List ${list.id}`}
                                    </option>
                                  `)}
                                </select>
                              </div>
                              ${this.searchListId ? html`` : html`
                                <div class="search-list-row">
                                  <span class="search-list-label">New List Name:</span>
                                  <input
                                    type="text"
                                    placeholder="List title"
                                    class="flex-1 min-w-[160px]"
                                    .value=${this.searchListTitle}
                                    ?disabled=${this.searchListLoading}
                                    @input=${this._handleSearchListTitleChange}
                                    data-search-list-title
                                  >
                                </div>
                              `}
                              <div class="search-list-actions">
                                <button
                                  class="curate-pane-action secondary"
                                  ?disabled=${this.searchListSaving || this.searchListLoading || !hasSearchListTitle || (!this.searchListId && duplicateNewListTitle)}
                                  @click=${this.searchListId ? this._handleSearchSaveExistingList : this._handleSearchSaveNewList}
                                  title=${this.searchListId ? 'Save to existing list' : 'Save new list'}
                                >
                                  Save
                                </button>
                                ${this.searchListId ? html`
                                  <button
                                    class="curate-pane-action secondary"
                                    ?disabled=${this.searchListSaving || this.searchListLoading}
                                    @click=${this._handleSearchSaveNewList}
                                    title="Save as new list"
                                  >
                                    Save new
                                  </button>
                                ` : html``}
                              </div>
                                `;
                              })()}
                            </div>
                            ${duplicateNewListTitle ? html`
                              <div class="text-xs text-red-600 mt-1">List title already exists.</div>
                            ` : this.searchListPromptNewTitle ? html`
                              <div class="text-xs text-blue-600 mt-1">Enter a new list title, then click “Save new”.</div>
                            ` : html``}
                        </div>
                        <div class="curate-pane-body">
                          ${this.searchSavedItems.length ? html`
                            <div class="search-saved-grid">
                              ${this.searchSavedItems.map((item) => html`
                                <div
                                  class="search-saved-item"
                                  draggable="true"
                                  @dragstart=${(event) => this._handleSearchSavedDragStart(event, item)}
                                >
                                  <img
                                    src=${item.thumbnail_url || `/api/v1/images/${item.id}/thumbnail`}
                                    alt=${item.filename || `Saved ${item.id}`}
                                    class="search-saved-thumb"
                                  >
                                  <button
                                    class="search-saved-remove"
                                    title="Remove from saved"
                                    @click=${() => this._handleSearchRemoveSaved(item.id)}
                                  >
                                    ×
                                  </button>
                                  <div class="search-saved-meta">
                                    <span>#${item.id}</span>
                                    ${Number.isFinite(item.rating) ? html`<span>${item.rating}★</span>` : html``}
                                  </div>
                                </div>
                              `)}
                            </div>
                          ` : html`
                            <div class="curate-drop ${this.searchSavedDragTarget ? 'active' : ''}">
                              Drag images here
                            </div>
                          `}
                        </div>
                    </div>
                  </div>
                </div>
            </div>
            <div slot="curate" class="container">
                <div class="flex items-center justify-between mb-4">
                    <div class="curate-subtabs">
                        <button
                          class="curate-subtab ${this.curateSubTab === 'home' ? 'active' : ''}"
                          @click=${() => this._handleCurateSubTabChange('home')}
                        >
                          Curate Home
                        </button>
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
                      this._fetchCurateImages();
                    }
                  }}
                  title="Refresh"
                >
                  ${curateRefreshBusy ? html`<span class="curate-spinner"></span>` : html`<span aria-hidden="true">↻</span>`}
                  ${curateRefreshBusy ? 'Refreshing' : 'Refresh'}
                </button>
                </div>
                <div ?hidden=${this.curateSubTab !== 'home'}>
                  <div class="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6">
                    <!-- Left Column: Instructions -->
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
                              <span><strong>Curate Home (This Tab):</strong> Monitor tag statistics and understand your collection's tagging patterns at a glance.</span>
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

                    <!-- Right Column: Tag Counts -->
                    <div class="bg-white rounded-lg shadow p-4 self-start sticky top-0 max-h-[calc(100vh-200px)] overflow-y-auto">
                      <div class="text-xs text-gray-500 uppercase font-semibold mb-2">
                        Tag Counts: Total: ${this._formatStatNumber(this.imageStats?.image_count)} / Reviewed: ${this._formatStatNumber(this.imageStats?.reviewed_image_count)}
                      </div>
                      <div class="flex items-center gap-2 mb-3 text-xs font-semibold text-gray-600">
                        ${[
                          { key: 'permatags', label: 'Permatags' },
                          { key: 'zero_shot', label: 'Zero-Shot' },
                          { key: 'keyword_model', label: 'Keyword-Model' },
                        ].map((tab) => html`
                          <button
                            class="px-2 py-1 rounded border ${this.activeCurateTagSource === tab.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}"
                            @click=${() => {
                              this.activeCurateTagSource = tab.key;
                              this._updateCurateCategoryCards();
                            }}
                          >
                            ${tab.label}
                          </button>
                        `)}
                      </div>
                      ${(this.curateCategoryCards || []).length ? html`
                        <div class="tag-carousel">
                          ${(this.curateCategoryCards || []).map((item) => {
                            const label = item.category.replace(/_/g, ' ');
                            return html`
                              <div class="tag-card border border-gray-200 rounded-lg p-2">
                                <div class="text-xs font-semibold text-gray-700 truncate" title=${label}>${label}</div>
                                <div class="tag-card-body mt-2 space-y-2">
                                  ${item.keywordRows.length ? item.keywordRows.map((kw) => {
                                    const width = item.maxCount
                                      ? Math.round((kw.count / item.maxCount) * 100)
                                      : 0;
                                    return html`
                                      <div>
                                        <div class="flex items-center justify-between gap-2 text-xs text-gray-600">
                                          <span class="truncate" title=${kw.keyword}>${kw.keyword}</span>
                                          <span class="text-gray-500">${this._formatStatNumber(kw.count)}</span>
                                        </div>
                                        <div class="tag-bar mt-1">
                                          <div class="tag-bar-fill" style="width: ${width}%"></div>
                                        </div>
                                      </div>
                                    `;
                                  }) : html`<div class="text-xs text-gray-400">No tags yet.</div>`}
                                </div>
                              </div>
                            `;
                          })}
                        </div>
                      ` : html`
                        <div class="text-xs text-gray-400">No tag data yet.</div>
                      `}
                    </div>
                  </div>
                </div>
                <div ?hidden=${this.curateSubTab !== 'main'}>
                  <div class="curate-header-layout mb-4">
                      <div class="bg-white rounded-lg shadow p-4 w-full">
                        <div class="curate-control-grid">
                          <div>
                            <div class="text-xs font-semibold text-gray-600 mb-1">Quick sort</div>
                            <div class="curate-audit-toggle">
                                <button
                                  class=${this.curateOrderBy === 'photo_creation' ? 'active' : ''}
                                  @click=${() => this._handleCurateQuickSort('photo_creation')}
                                >
                                  Photo Date ${this._getCurateQuickSortArrow('photo_creation')}
                                </button>
                                <button
                                  class=${this.curateOrderBy === 'processed' ? 'active' : ''}
                                  @click=${() => this._handleCurateQuickSort('processed')}
                                >
                                  Process Date ${this._getCurateQuickSortArrow('processed')}
                                </button>
                            </div>
                          </div>
                          <div>
                            <div class="text-xs font-semibold text-gray-600 mb-1">Optional filter by keyword</div>
                            <div class="curate-control-row">
                              <select
                                class="w-full px-3 py-2 border rounded-lg ${selectedKeywordValueMain ? 'bg-yellow-100 border-yellow-200' : ''}"
                                .value=${selectedKeywordValueMain}
                                @change=${(event) => this._handleCurateKeywordSelect(event, 'main')}
                              >
                                <option value="">Select a keyword...</option>
                                <option value="__untagged__">Untagged (${untaggedCountLabel})</option>
                                ${this._getKeywordsByCategory().map(([category, keywords]) => html`
                                  <optgroup label="${category} (${this._getCategoryCount(category)})">
                                    ${keywords.map(kw => html`
                                      <option value=${`${encodeURIComponent(category)}::${encodeURIComponent(kw.keyword)}`}>
                                        ${kw.keyword} (${kw.count})
                                      </option>
                                    `)}
                                  </optgroup>
                                `)}
                              </select>
                              <button
                                class="h-10 w-10 flex items-center justify-center border rounded-lg text-gray-600 hover:bg-gray-50"
                                title="Advanced filters"
                                aria-pressed=${this.curateAdvancedOpen ? 'true' : 'false'}
                                @click=${() => { this.curateAdvancedOpen = !this.curateAdvancedOpen; }}
                              >
                                <svg viewBox="0 0 24 24" class="h-7 w-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                  <circle cx="12" cy="12" r="3"></circle>
                                  <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.02.02a2 2 0 0 1-2.83 2.83l-.02-.02a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.03a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.02.02a2 2 0 1 1-2.83-2.83l.02-.02a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.03a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.02-.02a2 2 0 1 1 2.83-2.83l.02.02a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.03a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.02-.02a2 2 0 0 1 2.83 2.83l-.02.02a1.7 1.7 0 0 0-.34 1.87V9c0 .68.4 1.3 1.02 1.58.24.11.5.17.77.17H21a2 2 0 1 1 0 4h-.03a1.7 1.7 0 0 0-1.55 1z"></path>
                                </svg>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div></div>
                  </div>
                  ${this._renderCurateFilters({ mode: 'main', showHistogram: false, showHeader: false })}
                  <div class="curate-layout" style="--curate-thumb-size: ${this.curateThumbSize}px;">
                    <div class="curate-pane">
                        <div class="curate-pane-header">
                            <div class="curate-pane-header-row">
                                <span>${leftPaneLabel}</span>
                                <div class="curate-pane-header-actions">
                                  ${renderPaginationControls({
                                    countLabel: curateCountLabel,
                                    hasPrev: curateHasPrev,
                                    hasNext: curateHasMore,
                                    onPrev: this._handleCuratePagePrev,
                                    onNext: this._handleCuratePageNext,
                                    pageSize: this.curateLimit,
                                    onPageSizeChange: this._handleCurateLimitChange,
                                    disabled: this.curateLoading,
                                  })}
                                </div>
                            </div>
                        </div>
                        ${this.curateLoading ? html`
                          <div class="curate-loading-overlay" aria-label="Loading">
                            <span class="curate-spinner large"></span>
                          </div>
                        ` : html``}
                        <div class="curate-pane-body">
                            ${leftImages.length ? html`
                              <div class="curate-grid">
                                  ${leftImages.map((image, index) => html`
                                  <div
                                    class="curate-thumb-wrapper ${this.curateDragSelection.includes(image.id) ? 'selected' : ''}"
                                    data-image-id="${image.id}"
                                    draggable="true"
                                    @dragstart=${(event) => this._handleCurateExploreReorderStart(event, image)}
                                    @dragover=${(event) => this._handleCurateExploreReorderOver(event, image.id)}
                                    @dragend=${this._handleCurateExploreReorderEnd}
                                    @click=${(event) => this._handleCurateImageClick(event, image)}
                                  >
                                      <img
                                        src=${image.thumbnail_url || `/api/v1/images/${image.id}/thumbnail`}
                                        alt=${image.filename}
                                      class="curate-thumb ${this.curateDragSelection.includes(image.id) ? 'selected' : ''} ${this._curateFlashSelectionIds?.has(image.id) ? 'flash' : ''}"
                                      draggable="false"
                                      @pointerdown=${(event) => this._handleCuratePointerDownWithOrder(event, index, image.id, this._curateLeftOrder)}
                                      @pointermove=${(event) => this._handleCuratePointerMove(event)}
                                      @pointerenter=${() => this._handleCurateSelectHoverWithOrder(index, this._curateLeftOrder)}
                                    >
                                      ${this._renderCurateRatingWidget(image)}
                                      ${this._renderCurateRatingStatic(image)}
                                      ${this._renderCurateAiMLScore(image)}
                                      ${this._renderCuratePermatagSummary(image)}
                                      ${this._formatCurateDate(image) ? html`
                                        <div class="curate-thumb-date">
                                          <span class="curate-thumb-id">#${image.id}</span>
                                          <span class="curate-thumb-icon" aria-hidden="true">📷</span>${this._formatCurateDate(image)}
                                        </div>
                                      ` : html``}
                                    </div>
                                  `)}
                              </div>
                            ` : html`
                              <div class="curate-drop">
                                No images available.
                              </div>
                            `}
                            <div class="mt-3">
                              ${renderPaginationControls({
                                countLabel: curateCountLabel,
                                hasPrev: curateHasPrev,
                                hasNext: curateHasMore,
                                onPrev: this._handleCuratePagePrev,
                                onNext: this._handleCuratePageNext,
                                pageSize: this.curateLimit,
                                onPageSizeChange: this._handleCurateLimitChange,
                                disabled: this.curateLoading,
                                showPageSize: false,
                              })}
                            </div>
                        </div>
                    </div>
                    <div class="curate-pane utility-targets">
                        <div class="curate-pane-header">
                            <div class="curate-pane-header-row">
                                <span>Hotspots</span>
                                <div class="curate-rating-checkbox" style="margin-left: auto;">
                                    <input
                                        type="checkbox"
                                        id="rating-checkbox-explore"
                                        .checked=${this.curateExploreRatingEnabled}
                                        @change=${this._handleCurateExploreRatingToggle}
                                    />
                                    <label for="rating-checkbox-explore">Rating</label>
                                </div>
                            </div>
                        </div>
                        <div class="curate-pane-body">
                          ${this.curateExploreRatingEnabled ? html`
                            <div
                              class="curate-rating-drop-zone ${this._curateExploreRatingDragTarget ? 'active' : ''}"
                              @dragover=${(event) => this._handleCurateExploreRatingDragOver(event)}
                              @dragleave=${this._handleCurateExploreRatingDragLeave}
                              @drop=${(event) => this._handleCurateExploreRatingDrop(event)}
                            >
                              <div class="curate-rating-drop-zone-star">⭐</div>
                              <div class="curate-rating-drop-zone-content">
                                <div class="curate-rating-drop-hint">Drop to rate</div>
                                <div class="curate-rating-count">${this.curateExploreRatingCount || 0} rated</div>
                              </div>
                            </div>
                          ` : html``}
                          <div class="curate-utility-panel">
                            ${(this.curateExploreTargets || []).map((target) => {
                              const isFirstTarget = (this.curateExploreTargets?.[0]?.id === target.id);
                              const isRating = target.type === 'rating';
                              const selectedValue = target.keyword
                                ? `${encodeURIComponent(target.category || 'Uncategorized')}::${encodeURIComponent(target.keyword)}`
                                : '';
                              return html`
                                <div
                                  class="curate-utility-box ${this._curateExploreHotspotDragTarget === target.id ? 'active' : ''}"
                                  @dragover=${(event) => this._handleCurateExploreHotspotDragOver(event, target.id)}
                                  @dragleave=${this._handleCurateExploreHotspotDragLeave}
                                  @drop=${(event) => this._handleCurateExploreHotspotDrop(event, target.id)}
                                >
                                  <div class="curate-utility-controls">
                                    <select
                                      class="curate-utility-type-select"
                                      .value=${target.type || 'keyword'}
                                      @change=${(event) => this._handleCurateExploreHotspotTypeChange(event, target.id)}
                                    >
                                      <option value="keyword">Keyword</option>
                                      <option value="rating">Rating</option>
                                    </select>
                                    ${isRating ? html`
                                      <select
                                        class="curate-utility-select"
                                        .value=${target.rating ?? ''}
                                        @change=${(event) => this._handleCurateExploreHotspotRatingChange(event, target.id)}
                                      >
                                        <option value="">Select rating…</option>
                                        <option value="0">🗑️ Garbage</option>
                                        <option value="1">⭐ 1 Star</option>
                                        <option value="2">⭐⭐ 2 Stars</option>
                                        <option value="3">⭐⭐⭐ 3 Stars</option>
                                      </select>
                                    ` : html`
                                      <select
                                        class="curate-utility-select ${selectedValue ? 'selected' : ''}"
                                        .value=${selectedValue}
                                        @change=${(event) => this._handleCurateExploreHotspotKeywordChange(event, target.id)}
                                      >
                                        <option value="">Select keyword…</option>
                                        ${this._getKeywordsByCategory().map(([category, keywords]) => html`
                                          <optgroup label="${category}">
                                            ${keywords.map((kw) => html`
                                              <option value=${`${encodeURIComponent(category)}::${encodeURIComponent(kw.keyword)}`}>
                                                ${kw.keyword}
                                              </option>
                                            `)}
                                          </optgroup>
                                        `)}
                                      </select>
                                      <select
                                        class="curate-utility-action"
                                        .value=${target.action || 'add'}
                                        @change=${(event) => this._handleCurateExploreHotspotActionChange(event, target.id)}
                                      >
                                        <option value="add">Add</option>
                                        <option value="remove">Remove</option>
                                      </select>
                                    `}
                                  </div>
                                  ${!isFirstTarget ? html`
                                    <button
                                      type="button"
                                      class="curate-utility-remove"
                                      title="Remove box"
                                      @click=${() => this._handleCurateExploreHotspotRemoveTarget(target.id)}
                                    >
                                      ×
                                    </button>
                                  ` : html``}
                                  <div class="curate-utility-count">${target.count || 0}</div>
                                  <div class="curate-utility-drop-hint">Drop images here</div>
                                </div>
                              `;
                            })}
                            <button class="curate-utility-add" @click=${this._handleCurateExploreHotspotAddTarget}>
                              +
                            </button>
                          </div>
                          </div>
                        </div>
                    </div>
                </div>
                <div ?hidden=${this.curateSubTab !== 'tag-audit'}>
                    ${this._renderCurateFilters({ mode: 'tag-audit', showHistogram: false })}
                    ${this.curateAuditKeyword ? html`
                      <div class="text-center text-xl font-semibold text-gray-800 mb-3">
                        Auditing tag : ${this.curateAuditKeyword}
                      </div>
                    ` : html``}
                    ${this.curateAuditKeyword ? html`
                      <div class="bg-white rounded-lg shadow p-4 mb-4">
                          <div class="flex flex-wrap items-start gap-4">
                              <div>
                                  <div class="text-xs font-semibold text-gray-600 mb-1">Audit mode</div>
                                  <div class="curate-audit-toggle">
                                      <button
                                        class=${this.curateAuditMode === 'existing' ? 'active' : ''}
                                        @click=${() => this._handleCurateAuditModeChange('existing')}
                                      >
                                        Verify Existing Tags
                                      </button>
                                      <button
                                        class=${this.curateAuditMode === 'missing' ? 'active' : ''}
                                        @click=${() => this._handleCurateAuditModeChange('missing')}
                                      >
                                        Find Missing Tags
                                      </button>
                                  </div>
                              </div>
                              ${this.curateAuditMode === 'missing' ? html`
                                <div>
                                  <div class="text-xs font-semibold text-gray-600 mb-1">Find with AI</div>
                                  <div class="curate-ai-toggle text-xs text-gray-600">
                                    <label class="inline-flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        class="h-4 w-4"
                                        .checked=${this.curateAuditAiEnabled}
                                        @change=${this._handleCurateAuditAiEnabledChange}
                                      >
                                      <span>Enable</span>
                                    </label>
                                    ${this.curateAuditAiEnabled ? html`
                                      <div class="flex items-center gap-2">
                                        ${[
                                          { key: 'siglip', label: 'Zero-shot' },
                                          { key: 'trained', label: 'Keyword model' },
                                        ].map((model) => html`
                                          <button
                                            class="px-2 py-1 rounded border text-xs ${this.curateAuditAiModel === model.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}"
                                            aria-pressed=${this.curateAuditAiModel === model.key ? 'true' : 'false'}
                                            @click=${() => this._handleCurateAuditAiModelChange(model.key)}
                                          >
                                            ${model.label}
                                          </button>
                                        `)}
                                      </div>
                                    ` : html``}
                                  </div>
                                </div>
                              ` : html``}
                          </div>
                      </div>
                      <div class="curate-layout" style="--curate-thumb-size: ${this.curateThumbSize}px;">
                        <div class="curate-pane">
                            <div class="curate-pane-header">
                                <div class="curate-pane-header-row">
                                    <span>${auditLeftLabel}</span>
                                    <div class="curate-pane-header-actions">
                                        ${this.curateAuditKeyword && !auditLoadAll ? html`
                                          ${renderPaginationControls({
                                            countLabel: auditCountLabel,
                                            hasPrev: auditHasPrev,
                                            hasNext: auditHasMore,
                                            onPrev: this._handleCurateAuditPagePrev,
                                            onNext: this._handleCurateAuditPageNext,
                                            pageSize: this.curateAuditLimit,
                                            onPageSizeChange: this._handleCurateAuditLimitChange,
                                            disabled: this.curateAuditLoading,
                                          })}
                                        ` : html``}
                                    </div>
                                </div>
                            </div>
                            ${this.curateAuditLoading ? html`
                              <div class="curate-loading-overlay" aria-label="Loading">
                                <span class="curate-spinner large"></span>
                              </div>
                            ` : html``}
                            <div class="curate-pane-body">
                                ${auditLeftImages.length ? html`
                                  <div class="curate-grid">
                                    ${auditLeftImages.map((image, index) => html`
                                      <div class="curate-thumb-wrapper" @click=${(event) => this._handleCurateImageClick(event, image)}>
                                        <img
                                          src=${image.thumbnail_url || `/api/v1/images/${image.id}/thumbnail`}
                                          alt=${image.filename}
                                          class="curate-thumb ${this.curateAuditDragSelection.includes(image.id) ? 'selected' : ''}"
                                          draggable="true"
                                          @dragstart=${(event) => this._handleCurateAuditDragStart(event, image)}
                                          @pointerdown=${(event) => this._handleCurateAuditPointerDown(event, index, image.id)}
                                          @pointermove=${(event) => this._handleCurateAuditPointerMove(event)}
                                          @pointerenter=${() => this._handleCurateAuditSelectHover(index)}
                                        >
                                        ${this._renderCurateRatingWidget(image)}
                                        ${this._renderCurateRatingStatic(image)}
                                        ${this._renderCurateAiMLScore(image)}
                                        ${this._renderCuratePermatagSummary(image)}
                                        ${this._formatCurateDate(image) ? html`
                                          <div class="curate-thumb-date">
                                            <span class="curate-thumb-id">#${image.id}</span>
                                            <span class="curate-thumb-icon" aria-hidden="true">📷</span>${this._formatCurateDate(image)}
                                          </div>
                                        ` : html``}
                                      </div>
                                    `)}
                                  </div>
                                ` : html`
                                  <div class="curate-drop">
                                    ${this.curateAuditKeyword ? 'No images available.' : 'Choose a keyword to start.'}
                                  </div>
                                `}
                                ${this.curateAuditKeyword ? html`
                                  ${auditLoadAll ? html`` : html`
                                    <div class="mt-3">
                                      ${renderPaginationControls({
                                        countLabel: auditCountLabel,
                                        hasPrev: auditHasPrev,
                                        hasNext: auditHasMore,
                                        onPrev: this._handleCurateAuditPagePrev,
                                        onNext: this._handleCurateAuditPageNext,
                                        pageSize: this.curateAuditLimit,
                                        onPageSizeChange: this._handleCurateAuditLimitChange,
                                        disabled: this.curateAuditLoading,
                                        showPageSize: false,
                                      })}
                                    </div>
                                  `}
                                ` : html``}
                            </div>
                        </div>
                        <div
                          class="curate-pane utility-targets"
                        >
                            <div class="curate-pane-header">
                                <div class="curate-pane-header-row">
                                    <span>Hotspots</span>
                                    <div class="curate-rating-checkbox" style="margin-left: auto;">
                                        <input
                                            type="checkbox"
                                            id="rating-checkbox-audit"
                                            .checked=${this.curateAuditRatingEnabled}
                                            @change=${this._handleCurateAuditRatingToggle}
                                        />
                                        <label for="rating-checkbox-audit">Rating</label>
                                    </div>
                                </div>
                            </div>
                            <div class="curate-pane-body">
                              ${this.curateAuditRatingEnabled ? html`
                                <div
                                  class="curate-rating-drop-zone ${this._curateAuditRatingDragTarget ? 'active' : ''}"
                                  @dragover=${(event) => this._handleCurateAuditRatingDragOver(event)}
                                  @dragleave=${this._handleCurateAuditRatingDragLeave}
                                  @drop=${(event) => this._handleCurateAuditRatingDrop(event)}
                                >
                                  <div class="curate-rating-drop-zone-star">⭐</div>
                                  <div class="curate-rating-drop-zone-content">
                                    <div class="curate-rating-drop-hint">Drop to rate</div>
                                    <div class="curate-rating-count">${this.curateAuditRatingCount || 0} rated</div>
                                  </div>
                                </div>
                              ` : html``}
                              <div class="curate-utility-panel">
                                ${(this.curateAuditTargets || []).map((target) => {
                                  const isPrimary = (this.curateAuditTargets?.[0]?.id === target.id);
                                  const isRating = target.type === 'rating';
                                  const selectedValue = target.keyword
                                    ? `${encodeURIComponent(target.category || 'Uncategorized')}::${encodeURIComponent(target.keyword)}`
                                    : '';
                                  return html`
                                    <div
                                      class="curate-utility-box ${this._curateAuditHotspotDragTarget === target.id ? 'active' : ''}"
                                      @dragover=${(event) => this._handleCurateAuditHotspotDragOver(event, target.id)}
                                      @dragleave=${this._handleCurateAuditHotspotDragLeave}
                                      @drop=${(event) => this._handleCurateAuditHotspotDrop(event, target.id)}
                                    >
                                      <div class="curate-utility-controls">
                                        <select
                                          class="curate-utility-type-select"
                                          .value=${target.type || 'keyword'}
                                          ?disabled=${isPrimary}
                                          @change=${(event) => this._handleCurateAuditHotspotTypeChange(event, target.id)}
                                        >
                                          <option value="keyword">Keyword</option>
                                          <option value="rating">Rating</option>
                                        </select>
                                        ${isRating ? html`
                                          <select
                                            class="curate-utility-select"
                                            .value=${target.rating ?? ''}
                                            ?disabled=${isPrimary}
                                            @change=${(event) => this._handleCurateAuditHotspotRatingChange(event, target.id)}
                                          >
                                            <option value="">Select rating…</option>
                                            <option value="0">🗑️ Garbage</option>
                                            <option value="1">⭐ 1 Star</option>
                                            <option value="2">⭐⭐ 2 Stars</option>
                                            <option value="3">⭐⭐⭐ 3 Stars</option>
                                          </select>
                                        ` : html`
                                          <select
                                            class="curate-utility-select ${selectedValue ? 'selected' : ''}"
                                            .value=${selectedValue}
                                            ?disabled=${isPrimary}
                                            @change=${(event) => this._handleCurateAuditHotspotKeywordChange(event, target.id)}
                                          >
                                            <option value="">Select keyword…</option>
                                            ${this._getKeywordsByCategory().map(([category, keywords]) => html`
                                              <optgroup label="${category}">
                                                ${keywords.map((kw) => html`
                                                  <option value=${`${encodeURIComponent(category)}::${encodeURIComponent(kw.keyword)}`}>
                                                    ${kw.keyword}
                                                  </option>
                                                `)}
                                              </optgroup>
                                            `)}
                                          </select>
                                          <select
                                            class="curate-utility-action"
                                            .value=${target.action || 'add'}
                                            ?disabled=${isPrimary}
                                            @change=${(event) => this._handleCurateAuditHotspotActionChange(event, target.id)}
                                          >
                                            <option value="add">Add</option>
                                            <option value="remove">Remove</option>
                                          </select>
                                        `}
                                      </div>
                                      ${!isPrimary ? html`
                                        <button
                                          type="button"
                                          class="curate-utility-remove"
                                          title="Remove box"
                                          @click=${() => this._handleCurateAuditHotspotRemoveTarget(target.id)}
                                        >
                                          ×
                                        </button>
                                      ` : html``}
                                      <div class="curate-utility-count">${target.count || 0}</div>
                                      <div class="curate-utility-drop-hint">Drop images here</div>
                                    </div>
                                  `;
                                })}
                                <button class="curate-utility-add" @click=${this._handleCurateAuditHotspotAddTarget}>
                                  +
                                </button>
                              </div>
                        </div>
                    </div>
                      </div>
                    ` : html`
                      <div class="bg-white rounded-lg shadow p-6 text-sm text-gray-600">
                        This screen lets you scan your collection for all images tagged to a Keyword. You can verify existing images, and look for images that should have it. Select a keyword to proceed.
                      </div>
                    `}
                </div>
            </div>
            <div slot="lists" class="container p-4">
                <list-editor .tenant=${this.tenant}></list-editor>
            </div>
            <div slot="people" class="container p-4">
                <person-manager .tenant=${this.tenant}></person-manager>
            </div>
            <div slot="tagging" class="container p-4">
                <tagging-admin .tenant=${this.tenant} @open-upload-modal=${this._handleOpenUploadModal}></tagging-admin>
            </div>
            <div slot="ml-training" class="container p-4">
                <ml-training
                  .tenant=${this.tenant}
                  @open-image-editor=${this._handlePipelineOpenImage}
                ></ml-training>
            </div>
            <div slot="cli" class="container p-4">
                <cli-commands></cli-commands>
            </div>
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
                          <div>${this._formatQueueItem(item)}</div>
                        `)}
                      </div>
                    ` : html``}
                    ${this.queueState.queue?.length ? html`
                      <div>
                        <div class="font-semibold text-gray-600 mb-1">Queued</div>
                        ${this.queueState.queue.map((item) => html`
                          <div>${this._formatQueueItem(item)}</div>
                        `)}
                      </div>
                    ` : html``}
                    ${this.queueState.failed?.length ? html`
                      <div>
                        <div class="font-semibold text-red-600 mb-1">Failed</div>
                        ${this.queueState.failed.map((item) => html`
                          <div class="flex items-center justify-between">
                            <span>${this._formatQueueItem(item)}</span>
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

  async fetchStats() {
      if (!this.tenant) return;
      const results = await Promise.allSettled([
          getImageStats(this.tenant),
          getMlTrainingStats(this.tenant),
          getTagStats(this.tenant),
      ]);
      const imageResult = results[0];
      const mlResult = results[1];
      const tagResult = results[2];
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
      if (tagResult.status === 'fulfilled') {
          this.tagStatsBySource = tagResult.value?.sources || {};
          this._updateCurateCategoryCards();
      } else {
          console.error('Error fetching tag stats:', tagResult.reason);
          this.tagStatsBySource = {};
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
      this.fetchStats();
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
          this.fetchStats();
      }, 400);
  }

  _formatStatNumber(value) {
      if (value === null || value === undefined) return '--';
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) return '--';
      return numericValue.toLocaleString();
  }

  _formatDateTime(value) {
      if (!value) return 'Unknown';
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return 'Unknown';
      return date.toLocaleString();
  }

  _formatRating(value) {
      if (value === null || value === undefined || value === '') {
          return 'Unrated';
      }
      return String(value);
  }

  _formatDropboxPath(path) {
      if (!path) return 'Unknown';
      return path.replace(/_/g, '_\u200b');
  }

  _formatQueueItem(item) {
      if (!item) return '';
      if (item.description) return item.description;
      if (item.imageId) return `${item.type} · image ${item.imageId}`;
      return item.type || 'queue item';
  }

  _formatCurateDate(image) {
      const value = image?.capture_timestamp || image?.modified_time;
      if (!value) return '';
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      const pad = (num) => String(num).padStart(2, '0');
      const year = date.getFullYear();
      const month = pad(date.getMonth() + 1);
      const day = pad(date.getDate());
      const hours = pad(date.getHours());
      const minutes = pad(date.getMinutes());
      const seconds = pad(date.getSeconds());
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  _formatCurateProcessedDate(image) {
      const value = image?.last_processed || image?.created_at;
      if (!value) return '';
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      const pad = (num) => String(num).padStart(2, '0');
      const year = date.getFullYear();
      const month = pad(date.getMonth() + 1);
      const day = pad(date.getDate());
      const hours = pad(date.getHours());
      const minutes = pad(date.getMinutes());
      const seconds = pad(date.getSeconds());
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  _buildCategoryCards(sourceStats, includeEmptyPreferred = false) {
      const preferredOrder = ['Circus Skills', 'Costume Colors', 'Performers'];
      const normalize = (label) => label.toLowerCase().replace(/[_\s]+/g, ' ').trim();
      const preferredNormalized = preferredOrder.map((label) => normalize(label));

      const cards = Object.entries(sourceStats || {})
        .map(([category, keywords]) => {
            const keywordRows = (keywords || [])
              .filter((kw) => (kw.count || 0) > 0)
              .sort((a, b) => (b.count || 0) - (a.count || 0));
            const maxCount = keywordRows.reduce((max, kw) => Math.max(max, kw.count || 0), 0);
            const totalCount = keywordRows.reduce((sum, kw) => sum + (kw.count || 0), 0);
            return { category, keywordRows, maxCount, totalCount };
        })
        .filter((card) => includeEmptyPreferred || card.keywordRows.length)
        .sort((a, b) => {
            const aLabel = normalize(a.category.replace(/_/g, ' '));
            const bLabel = normalize(b.category.replace(/_/g, ' '));
            const aIndex = preferredNormalized.indexOf(aLabel);
            const bIndex = preferredNormalized.indexOf(bLabel);
            if (aIndex !== -1 || bIndex !== -1) {
                return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
            }
            return aLabel.localeCompare(bLabel);
        });

      if (includeEmptyPreferred) {
          preferredOrder.forEach((label) => {
              const exists = cards.some((card) => normalize(card.category.replace(/_/g, ' ')) === normalize(label));
              if (!exists) {
                  cards.push({
                      category: label,
                      keywordRows: [],
                      maxCount: 0,
                      totalCount: 0,
                  });
              }
          });
          cards.sort((a, b) => {
              const aLabel = normalize(a.category.replace(/_/g, ' '));
              const bLabel = normalize(b.category.replace(/_/g, ' '));
              const aIndex = preferredNormalized.indexOf(aLabel);
              const bIndex = preferredNormalized.indexOf(bLabel);
              if (aIndex !== -1 || bIndex !== -1) {
                  return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
              }
              return aLabel.localeCompare(bLabel);
          });
      }

      return cards;
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

      // Format the model name for display
      const modelName = this.curateAuditAiModel === 'trained' ? 'Keyword-Model' : 'Siglip';

      return html`
        <div class="curate-thumb-ml-score">
          <span class="curate-thumb-icon" aria-hidden="true">🤖</span>${modelName}: ${this.curateAuditKeyword}=${(mlTag.confidence).toFixed(2)}
        </div>
      `;
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

  _getCurateHoverLines(image) {
      const lines = [];
      const path = this._formatDropboxPath(image?.dropbox_path);
      if (path && path !== 'Unknown') {
          lines.push(path);
      } else {
          lines.push('Unknown');
      }
      const permatags = Array.isArray(image?.permatags) ? image.permatags : [];
      const positive = permatags.filter((tag) => tag.signum === 1);
      if (!positive.length) {
          return lines;
      }
      const byCategory = {};
      positive.forEach((tag) => {
          const category = tag.category || 'Uncategorized';
          if (!byCategory[category]) {
              byCategory[category] = [];
          }
          byCategory[category].push(tag.keyword);
      });
      Object.entries(byCategory)
          .map(([category, keywords]) => ({
              category,
              keywords: keywords.filter(Boolean).sort((a, b) => a.localeCompare(b)),
          }))
          .sort((a, b) => a.category.localeCompare(b.category))
          .forEach((group) => {
              if (!group.keywords.length) return;
              const label = group.category.replace(/_/g, ' ');
              lines.push(`${label}: ${group.keywords.join(', ')}`);
          });
      return lines;
  }

  _getCuratePermatagGroups(image) {
      const permatags = Array.isArray(image?.permatags) ? image.permatags : [];
      const positive = permatags.filter((tag) => tag.signum === 1 && tag.keyword);
      if (!positive.length) {
          return [];
      }
      const byCategory = {};
      positive.forEach((tag) => {
          const category = tag.category || 'Uncategorized';
          if (!byCategory[category]) {
              byCategory[category] = [];
          }
          byCategory[category].push(tag.keyword);
      });
      return Object.entries(byCategory)
          .map(([category, keywords]) => ({
              category,
              keywords: keywords.filter(Boolean).sort((a, b) => a.localeCompare(b)),
          }))
          .sort((a, b) => a.category.localeCompare(b.category));
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

  _mergePermatags(existing, additions) {
      const map = new Map();
      (existing || []).forEach((tag) => {
          if (!tag?.keyword) return;
          const key = `${tag.category || 'Uncategorized'}::${tag.keyword}`;
          map.set(key, { ...tag });
      });
      (additions || []).forEach((tag) => {
          if (!tag?.keyword) return;
          const category = tag.category || 'Uncategorized';
          const key = `${category}::${tag.keyword}`;
          map.set(key, { keyword: tag.keyword, category, signum: 1 });
      });
      return Array.from(map.values());
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
          const permatags = this._mergePermatags(image.permatags, tags);
          return { ...image, permatags };
      });
  }

  updated(changedProperties) {
      if (changedProperties.has('curateAuditKeyword') || changedProperties.has('curateAuditMode')) {
          this._syncAuditHotspotPrimary();
      }
  }

}

customElements.define('photocat-app', PhotoCatApp);
