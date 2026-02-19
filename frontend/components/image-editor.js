import { LitElement, html, css } from 'lit';
import {
  getImageDetails,
  getSimilarImages,
  getKeywords,
  getKeywordCategories,
  createKeyword,
  addPermatag,
  getFullImage,
  getImagePlayback,
  getImagePlaybackStream,
  setRating,
  refreshImageMetadata,
  propagateDropboxTags,
  listAssetVariants,
  uploadAssetVariant,
  updateAssetVariant,
  deleteAssetVariant,
  getAssetVariantContent,
  inspectAssetVariant,
  getAssetNote,
  upsertAssetNote,
} from '../services/api.js';
import { tailwind } from './tailwind-lit.js';
import { propertyGridStyles, renderPropertyRows, renderPropertySection } from './shared/widgets/property-grid.js';
import { formatCurateDate, formatDurationMs } from './shared/formatting.js';
import { renderImageGrid } from './shared/image-grid.js';
import { renderCuratePermatagSummary } from './render/curate-image-fragments.js';
import { renderCurateRatingStatic } from './render/curate-rating-widgets.js';
import './shared/widgets/keyword-dropdown.js';

const SIMILAR_WARMUP_DELAY_MS = 300;
const similarWarmupInflight = new Map();
const similarWarmupCompleted = new Set();

class ImageEditor extends LitElement {
  static styles = [tailwind, propertyGridStyles, css`
    :host {
      display: block;
    }
    .modal {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 60;
      background: rgba(15, 23, 42, 0.65);
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .modal.open {
      display: flex;
    }
    .panel {
      background: #ffffff;
      border-radius: 16px;
      width: min(1200px, 95vw);
      height: 82vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 45px rgba(15, 23, 42, 0.25);
      font-size: 11px;
    }
    .panel.embedded {
      width: 100%;
      height: auto;
      box-shadow: none;
      border: 1px solid #e5e7eb;
    }
    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 18px;
      border-bottom: 1px solid #e5e7eb;
    }
    .panel-title {
      font-size: 16px;
      font-weight: 600;
      color: #111827;
      word-break: break-word;
    }
    .panel-close {
      font-size: 22px;
      color: #6b7280;
      line-height: 1;
    }
    .panel-body {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
      padding: 18px;
      flex: 1;
      overflow: hidden;
      align-items: stretch;
      min-height: 0;
    }
    .editor-tab-strip {
      display: flex;
      gap: 8px;
      padding: 12px 18px 10px;
      border-bottom: 1px solid #e5e7eb;
      flex-wrap: wrap;
    }
    .variants-layout {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
    .panel-right {
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: auto;
    }
    .right-pane {
      text-align: left;
      font-size: inherit;
      color: #4b5563;
      display: flex;
      flex-direction: column;
      gap: 12px;
      overflow: visible;
      min-height: 0;
      min-width: 0;
    }
    .image-wrap {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      justify-content: flex-start;
      overflow: hidden;
      max-height: 100%;
      min-height: 0;
      position: relative;
    }
    .image-container {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
      min-height: 0;
      position: relative;
    }
    .image-container.zoomed {
      align-items: flex-start;
      justify-content: flex-start;
      overflow: auto;
      flex: 1;
      min-height: 0;
    }
    .image-container.zoomed img {
      width: auto;
      height: auto;
      max-width: none;
      max-height: none;
      object-fit: contain;
      border-radius: 0;
      border: none;
      background: transparent;
    }
    .image-wrap img {
      width: 100%;
      height: 100%;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: 12px;
      border: 1px solid #e5e7eb;
      background: #f3f4f6;
      flex-shrink: 0;
    }
    .image-wrap video {
      width: 100%;
      height: 100%;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: 12px;
      border: 1px solid #e5e7eb;
      background: #111827;
      flex-shrink: 0;
    }
    .image-media-pill {
      position: absolute;
      top: 10px;
      left: 10px;
      z-index: 10;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.84);
      color: #e2e8f0;
      font-size: 11px;
      line-height: 1;
      font-weight: 700;
      letter-spacing: 0.02em;
      pointer-events: none;
      box-shadow: 0 6px 16px rgba(15, 23, 42, 0.26);
    }
    .image-media-pill .duration {
      color: #f8fafc;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.01em;
    }
    .image-wrap.image-full img {
      width: 100%;
      height: 100%;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    .image-wrap.image-full video {
      width: 100%;
      height: 100%;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    .video-loading-surface {
      width: 100%;
      height: 100%;
      max-width: 100%;
      max-height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 12px;
      border: 1px solid #1f2937;
      background: #111827;
      color: #cbd5e1;
      font-size: 12px;
      letter-spacing: 0.01em;
    }
    .video-playback-status {
      position: absolute;
      bottom: 12px;
      left: 50%;
      transform: translateX(-50%);
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 999px;
      border: 1px solid #e5e7eb;
      background: rgba(17, 24, 39, 0.78);
      color: #f9fafb;
      font-size: 11px;
      box-shadow: 0 6px 16px rgba(15, 23, 42, 0.25);
    }
    .video-playback-retry {
      border: 1px solid #93c5fd;
      background: #eff6ff;
      color: #1d4ed8;
      border-radius: 999px;
      padding: 3px 8px;
      font-size: 10px;
      font-weight: 600;
    }
    .high-res-button {
      position: absolute;
      bottom: 12px;
      left: 50%;
      transform: translateX(-50%);
      padding: 6px 12px;
      border-radius: 999px;
      border: 1px solid #e5e7eb;
      background: rgba(17, 24, 39, 0.75);
      color: #f9fafb;
      font-size: 11px;
      box-shadow: 0 6px 16px rgba(15, 23, 42, 0.25);
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .high-res-button:hover {
      background: rgba(17, 24, 39, 0.85);
    }
    .high-res-button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .high-res-loading {
      position: absolute;
      bottom: 12px;
      left: 50%;
      transform: translateX(-50%);
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 999px;
      border: 1px solid #e5e7eb;
      background: rgba(17, 24, 39, 0.75);
      color: #f9fafb;
      font-size: 11px;
      box-shadow: 0 6px 16px rgba(15, 23, 42, 0.25);
    }
    .high-res-spinner {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      border: 2px solid rgba(255, 255, 255, 0.4);
      border-top-color: #fbbf24;
      animation: high-res-spin 0.8s linear infinite;
    }
    @keyframes high-res-spin {
      to { transform: rotate(360deg); }
    }
    .skeleton-block {
      background: linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 37%, #f3f4f6 63%);
      background-size: 400% 100%;
      animation: skeleton-shimmer 1.4s ease infinite;
      border-radius: 10px;
    }
    .skeleton-image {
      width: 100%;
      aspect-ratio: 4 / 3;
      border: 1px solid #e5e7eb;
    }
    .skeleton-line {
      height: 12px;
    }
    .skeleton-line.sm {
      height: 10px;
    }
    .skeleton-stack {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .loading-indicator {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #6b7280;
    }
    .loading-dot {
      width: 8px;
      height: 8px;
      border-radius: 9999px;
      background: #2563eb;
      animation: loading-pulse 1s ease-in-out infinite;
    }
    @keyframes skeleton-shimmer {
      0% { background-position: 100% 0; }
      100% { background-position: -100% 0; }
    }
    @keyframes loading-pulse {
      0%, 100% { opacity: 0.3; }
      50% { opacity: 1; }
    }
    .tab-row {
      display: flex;
      gap: 8px;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 8px;
    }
    .tab-button {
      padding: 6px 10px;
      font-size: inherit;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
      color: #4b5563;
      background: #ffffff;
    }
    .tab-button.active {
      border-color: #2563eb;
      background: #2563eb;
      color: #ffffff;
    }
    .image-navigation {
      display: flex;
      gap: 8px;
      margin-top: auto;
      padding: 12px 18px 16px;
      border-top: 1px solid #e5e7eb;
      justify-content: center;
    }
    .nav-button {
      padding: 8px 12px;
      font-size: 12px;
      border-radius: 6px;
      border: 1px solid #d1d5db;
      background: #ffffff;
      color: #374151;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .nav-button:hover:not(:disabled) {
      border-color: #9ca3af;
      background: #f3f4f6;
    }
    .nav-button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .tag-section {
      display: flex;
      flex-direction: column;
      gap: 12px;
      font-size: inherit;
    }
    .tag-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .tag-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #eef2ff;
      color: #3730a3;
      padding: 6px 10px;
      border-radius: 9999px;
      font-size: inherit;
    }
    .tag-remove {
      color: #dc2626;
      font-size: 14px;
      line-height: 1;
    }
    .tag-form {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .new-keyword-toggle-row {
      display: flex;
      justify-content: flex-start;
      margin-bottom: 6px;
    }
    .new-keyword-toggle {
      border-radius: 8px;
      padding: 7px 10px;
      border: 1px solid #d1d5db;
      background: #ffffff;
      color: #111827;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }
    .new-keyword-toggle.active {
      border-color: #2563eb;
      background: #eff6ff;
      color: #1d4ed8;
    }
    .new-keyword-panel {
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: #f8fafc;
    }
    .new-keyword-grid {
      display: grid;
      grid-template-columns: minmax(130px, 0.9fr) minmax(170px, 1.1fr);
      gap: 8px;
    }
    .new-keyword-input,
    .new-keyword-select {
      border: 1px solid #d1d5db;
      border-radius: 8px;
      padding: 7px 8px;
      font-size: 11px;
      color: #111827;
      background: #ffffff;
      min-width: 0;
    }
    .new-keyword-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .new-keyword-save {
      border-radius: 8px;
      padding: 7px 11px;
      background: #2563eb;
      color: #ffffff;
      font-size: 11px;
      font-weight: 600;
      border: 1px solid #2563eb;
    }
    .new-keyword-cancel {
      border-radius: 8px;
      padding: 7px 11px;
      background: #ffffff;
      color: #374151;
      font-size: 11px;
      font-weight: 600;
      border: 1px solid #d1d5db;
    }
    .new-keyword-error {
      color: #b91c1c;
      font-size: 11px;
    }
    .new-keyword-similar {
      border-top: 1px solid #e2e8f0;
      padding-top: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .new-keyword-similar-title {
      color: #475569;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }
    .new-keyword-similar-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 120px;
      overflow: auto;
    }
    .new-keyword-similar-item {
      border: 1px solid #dbeafe;
      border-radius: 8px;
      background: #ffffff;
      color: #1e293b;
      font-size: 11px;
      padding: 6px 8px;
      text-align: left;
    }
    .new-keyword-similar-item:hover {
      background: #eff6ff;
      border-color: #93c5fd;
    }
    .tag-grid-table {
      display: flex;
      flex-direction: column;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
    }
    .tag-grid-row {
      display: grid;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      font-size: 11px;
      color: #111827;
      border-top: 1px solid #f1f5f9;
    }
    .tag-grid-row:first-child {
      border-top: 0;
    }
    .tag-grid-head {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: #6b7280;
      background: #f8fafc;
    }
    .tag-grid-row-negative {
      background: #fff1f2;
    }
    .tag-sign-positive {
      color: #047857;
      font-weight: 600;
    }
    .tag-sign-negative {
      color: #b91c1c;
      font-weight: 600;
    }
    .tag-grid-row-permatag {
      grid-template-columns: minmax(120px, 1.4fr) minmax(110px, 1fr) 88px minmax(140px, 1.1fr);
    }
    .tag-grid-row-machine {
      grid-template-columns: minmax(120px, 1.4fr) minmax(110px, 1fr) minmax(140px, 1.1fr) 88px;
    }
    .tag-grid-cell-muted {
      color: #6b7280;
    }
    .detail-rating-widget {
      display: flex;
      align-items: center;
      gap: 10px;
      position: relative;
    }
    .detail-rating-widget button {
      font-size: 16px;
      line-height: 1;
    }
    .detail-rating-trash {
      background: rgba(255, 255, 255, 0.98);
      color: #111827;
      border-radius: 999px;
      padding: 8px 10px;
      box-shadow: 0 6px 16px rgba(17, 24, 39, 0.22);
    }
    .detail-rating-stars {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(255, 255, 255, 0.98);
      color: #111827;
      border-radius: 999px;
      padding: 8px 10px;
      box-shadow: 0 6px 16px rgba(17, 24, 39, 0.22);
    }
    .detail-rating-burst {
      position: absolute;
      top: -8px;
      right: -8px;
      width: 34px;
      height: 34px;
      pointer-events: none;
      animation: detail-burst 0.7s ease-out forwards;
    }
    .detail-rating-burst::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(250, 204, 21, 0.95) 0 30%, rgba(250, 204, 21, 0) 65%);
      box-shadow: 0 0 14px rgba(250, 204, 21, 0.8);
    }
    .detail-rating-burst::after {
      content: '';
      position: absolute;
      inset: -4px;
      border-radius: 50%;
      border: 2px solid rgba(250, 204, 21, 0.8);
      opacity: 0.9;
    }
    @keyframes detail-burst {
      0% { transform: scale(0.35); opacity: 0.1; }
      45% { transform: scale(1.1); opacity: 1; }
      100% { transform: scale(1.35); opacity: 0; }
    }
    .tag-dropdown {
      flex: 1;
      min-width: 220px;
    }
    .tag-add {
      border-radius: 8px;
      padding: 8px 12px;
      background: #2563eb;
      color: #ffffff;
      font-size: inherit;
    }
    .variants-section {
      display: flex;
      flex-direction: column;
      gap: 10px;
      font-size: inherit;
    }
    .variants-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .variants-list {
      display: grid;
      gap: 8px;
    }
    .variants-table {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
      background: #ffffff;
    }
    .variants-table-header {
      display: grid;
      grid-template-columns: 92px minmax(170px, 1.1fr) minmax(170px, 1.1fr) minmax(240px, 1.2fr) minmax(120px, 0.9fr) minmax(200px, 1.2fr);
      gap: 8px;
      align-items: center;
      padding: 7px 10px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: #6b7280;
      background: #f8fafc;
      border-bottom: 1px solid #e5e7eb;
    }
    .variants-row {
      display: grid;
      grid-template-columns: 92px minmax(170px, 1.1fr) minmax(170px, 1.1fr) minmax(240px, 1.2fr) minmax(120px, 0.9fr) minmax(200px, 1.2fr);
      gap: 8px;
      align-items: center;
      padding: 8px 10px;
      border-top: 1px solid #f1f5f9;
      min-width: 0;
    }
    .variants-row:first-child {
      border-top: 0;
    }
    .variants-cell {
      min-width: 0;
    }
    .variants-cell-preview {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .variants-cell-meta {
      font-size: 11px;
      line-height: 1.35;
      color: #6b7280;
    }
    .variants-meta-line {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 6px;
      align-items: baseline;
      min-width: 0;
    }
    .variants-meta-label {
      font-weight: 600;
      color: #4b5563;
      text-transform: lowercase;
    }
    .variants-cell-inspect {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .variants-inspect-metrics {
      font-size: 10px;
      color: #6b7280;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }
    .variants-cell-actions {
      display: flex;
      align-items: center;
      justify-content: flex-start;
    }
    .variant-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    .variant-inspect-link {
      background: transparent;
      border: 0;
      padding: 0;
      color: #2563eb;
      text-decoration: underline;
      text-underline-offset: 2px;
      font-size: 10px;
      line-height: 1.2;
      cursor: pointer;
    }
    .variant-inspect-link:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      text-decoration: none;
    }
    .variants-detail-row {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 8px;
      align-items: baseline;
      min-width: 0;
      padding: 0 10px 10px 112px;
      border-top: 1px dashed #e5e7eb;
      margin-top: -1px;
      background: #fafafa;
      font-size: 11px;
      line-height: 1.35;
      color: #6b7280;
    }
    .variants-detail-label {
      font-weight: 600;
      color: #4b5563;
      text-transform: lowercase;
      white-space: nowrap;
    }
    .variant-preview-url-input {
      width: 100%;
      min-width: 0;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 4px 6px;
      font-size: 11px;
      color: #374151;
      background: #ffffff;
    }
    .variants-input {
      border: 1px solid #d1d5db;
      border-radius: 8px;
      padding: 6px 8px;
      font-size: 11px;
      color: #374151;
      min-width: 0;
    }
    .variants-filename-input {
      width: 100%;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .variants-action {
      border: 1px solid #d1d5db;
      border-radius: 8px;
      padding: 6px 8px;
      background: #f9fafb;
      color: #374151;
      font-size: 12px;
      cursor: pointer;
    }
    .variants-action.primary {
      border-color: #2563eb;
      color: #1d4ed8;
      background: #eff6ff;
    }
    .variants-action.danger {
      border-color: #ef4444;
      color: #b91c1c;
      background: #fef2f2;
    }
    .variants-action:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .variants-upload {
      display: grid;
      grid-template-columns: minmax(160px, 1fr) minmax(180px, 1fr) auto;
      gap: 8px;
      align-items: center;
    }
    .variants-fullscreen {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px 18px;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }
    .variants-list-scroll {
      min-height: 0;
      overflow: auto;
    }
    .similar-fullscreen {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px 18px;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }
    .similar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 12px;
      color: #4b5563;
    }
    .similar-header-actions {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .similar-open-search {
      border: 1px solid #2563eb;
      border-radius: 8px;
      padding: 6px 8px;
      background: #eff6ff;
      color: #1d4ed8;
      font-size: 12px;
      cursor: pointer;
    }
    .similar-open-search:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .similar-refresh {
      border: 1px solid #d1d5db;
      border-radius: 8px;
      padding: 6px 8px;
      background: #f9fafb;
      color: #374151;
      font-size: 12px;
      cursor: pointer;
    }
    .similar-refresh:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .similar-grid-wrap {
      min-height: 0;
      overflow: auto;
      --curate-thumb-size: 150px;
    }
    .similar-grid-wrap .curate-grid {
      gap: 10px;
    }
    .similar-grid-wrap .curate-thumb-tile {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .similar-grid-wrap .curate-thumb-footer {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .similar-item-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      color: #4b5563;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }
    .similar-open-button {
      border: 1px solid #2563eb;
      border-radius: 8px;
      padding: 6px 8px;
      background: #eff6ff;
      color: #1d4ed8;
      font-size: 11px;
      cursor: pointer;
      width: 100%;
    }
    .curate-grid {
      display: grid;
      gap: 2px;
      grid-template-columns: repeat(auto-fill, minmax(var(--curate-thumb-size, 110px), 1fr));
      user-select: none;
    }
    .curate-thumb-wrapper {
      position: relative;
      border-radius: 10px;
      transition: box-shadow 0.15s ease, transform 0.15s ease;
    }
    .curate-thumb-wrapper:hover {
      transform: translateY(-1px);
      box-shadow: 0 8px 18px rgba(17, 24, 39, 0.18);
    }
    .curate-thumb {
      width: 100%;
      aspect-ratio: 1 / 1;
      object-fit: cover;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
      background: #f3f4f6;
      cursor: pointer;
    }
    .curate-thumb-play-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      z-index: 9;
    }
    .curate-thumb-play-icon {
      width: clamp(30px, 28%, 52px);
      height: clamp(30px, 28%, 52px);
      fill: rgba(255, 255, 255, 0.96);
      background: rgba(15, 23, 42, 0.55);
      border-radius: 999px;
      padding: 8px;
      box-shadow: 0 8px 18px rgba(15, 23, 42, 0.38);
    }
    .curate-thumb-media-pill {
      position: absolute;
      top: 6px;
      right: 6px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(15, 23, 42, 0.88);
      color: #e2e8f0;
      padding: 4px 7px;
      border-radius: 999px;
      font-size: 10px;
      line-height: 1;
      font-weight: 700;
      letter-spacing: 0.03em;
      pointer-events: none;
      z-index: 11;
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.28);
    }
    .curate-thumb-media-pill-label {
      color: #bfdbfe;
    }
    .curate-thumb-media-pill-duration {
      color: #f8fafc;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.01em;
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
    .curate-thumb-rating-static span {
      font-size: 12px;
      line-height: 1;
    }
    .curate-thumb-similar-link {
      position: absolute;
      right: 8px;
      bottom: 8px;
      width: 28px;
      height: 28px;
      padding: 0;
      cursor: pointer;
      appearance: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      border: 1px solid rgba(191, 219, 254, 0.95);
      background: rgba(15, 23, 42, 0.86);
      color: #eff6ff;
      box-shadow: 0 6px 14px rgba(15, 23, 42, 0.35);
      opacity: 0;
      transform: translateY(3px);
      transition: opacity 0.14s ease, transform 0.14s ease, background-color 0.14s ease;
      pointer-events: auto;
      z-index: 13;
    }
    .curate-thumb-similar-link:hover,
    .curate-thumb-similar-link:focus-visible,
    .curate-thumb-similar-link:active {
      opacity: 1;
      transform: translateY(0);
    }
    .curate-thumb-similar-link:hover {
      background: rgba(30, 64, 175, 0.95);
    }
    .curate-thumb-similar-link-icon {
      font-size: 17px;
      font-weight: 700;
      line-height: 1;
      pointer-events: none;
    }
    .curate-thumb-date {
      position: absolute;
      left: 6px;
      right: 6px;
      bottom: 1px;
      font-size: 10px;
      line-height: 1.2;
      color: #f9fafb;
      background: rgba(17, 24, 39, 0.65);
      padding: 2px 6px;
      border-radius: 6px;
      text-align: center;
      pointer-events: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .curate-thumb-id {
      margin-right: 6px;
      font-weight: 600;
      color: #e5e7eb;
    }
    .curate-thumb-icon {
      margin-right: 4px;
      font-size: 11px;
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
    .curate-thumb-rating-label {
      display: block;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-align: center;
      padding: 0 6px;
    }
    .curate-drop {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 180px;
      color: #9ca3af;
      font-size: 12px;
      border: 1px dashed #d1d5db;
      border-radius: 8px;
      padding: 16px;
      text-align: center;
    }
    .variant-preview-wrap {
      width: 100%;
      height: 72px;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
      overflow: hidden;
      background: #f9fafb;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .variant-preview-link {
      display: flex;
      width: 100%;
      height: 100%;
      color: inherit;
      text-decoration: none;
    }
    .variant-preview {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .variant-preview-fallback {
      display: none;
      width: 100%;
      height: 100%;
      align-items: center;
      justify-content: center;
      color: #9ca3af;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .variants-cell-key {
      display: none;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: #6b7280;
      margin-bottom: 2px;
    }
    .edit-action-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 11px;
      color: #4b5563;
    }
    .tag-active-row {
      display: flex;
      align-items: center;
      gap: 8px;
      justify-content: space-between;
    }
    .tag-active-meta {
      color: #6b7280;
      font-size: 11px;
    }
    .tag-remove-inline {
      border: 1px solid #ef4444;
      background: #fef2f2;
      color: #b91c1c;
      border-radius: 999px;
      font-size: 10px;
      line-height: 1;
      padding: 3px 7px;
      white-space: nowrap;
    }
    .empty-text {
      font-size: 12px;
      color: #9ca3af;
    }
    .zoom-controls {
      position: sticky;
      bottom: 0;
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      background: rgba(255, 255, 255, 0.98);
      padding: 12px;
      border-top: 1px solid #e5e7eb;
      box-shadow: 0 -2px 8px rgba(15, 23, 42, 0.1);
    }
    .zoom-button {
      padding: 6px 10px;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      background: #ffffff;
      color: #374151;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .zoom-button:hover {
      background: #f3f4f6;
      border-color: #d1d5db;
    }
    .zoom-button.active {
      background: #2563eb;
      color: #ffffff;
      border-color: #2563eb;
    }
    .fullscreen-viewer {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 70;
      background: #000000;
      align-items: center;
      justify-content: center;
    }
    .fullscreen-viewer.open {
      display: flex;
    }
    .fullscreen-viewer-content {
      position: relative;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: flex-start;
      justify-content: flex-start;
      overflow: auto;
      padding: 20px;
    }
    .fullscreen-viewer-content.fit-mode {
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .fullscreen-viewer-image {
      width: auto;
      height: auto;
      max-width: none;
      max-height: none;
      cursor: grab;
    }
    .fullscreen-viewer-image.fit-mode {
      position: fixed;
      top: 50%;
      left: 50%;
      cursor: default;
    }
    .fullscreen-viewer-image:active {
      cursor: grabbing;
    }
    .fullscreen-viewer-image.fit-mode:active {
      cursor: default;
    }
    .fullscreen-close {
      position: absolute;
      top: 20px;
      right: 20px;
      z-index: 71;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.3);
      color: #ffffff;
      font-size: 28px;
      line-height: 1;
      cursor: pointer;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
    }
    .fullscreen-close:hover {
      background: rgba(255, 255, 255, 0.2);
      border-color: rgba(255, 255, 255, 0.5);
    }
    .fullscreen-controls {
      position: absolute;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 71;
      background: rgba(0, 0, 0, 0.7);
      padding: 12px 16px;
      border-radius: 8px;
      color: #ffffff;
      font-size: 12px;
      text-align: center;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .fullscreen-zoom-buttons {
      display: flex;
      gap: 6px;
    }
    .fullscreen-zoom-button {
      padding: 4px 8px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.1);
      color: #ffffff;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.15s ease;
      outline: none;
      user-select: none;
      -webkit-user-select: none;
    }
    .fullscreen-zoom-button:hover {
      background: rgba(255, 255, 255, 0.2);
      border-color: rgba(255, 255, 255, 0.5);
    }
    .fullscreen-zoom-button.active {
      background: rgba(255, 255, 255, 0.3);
      border-color: rgba(255, 255, 255, 0.7);
      font-weight: 600;
    }
    @media (max-width: 760px) {
      .panel-body {
        grid-template-columns: 1fr;
      }
      .tag-form {
        grid-template-columns: 1fr;
      }
      .new-keyword-grid {
        grid-template-columns: 1fr;
      }
      .variants-table-header {
        display: none;
      }
      .variants-row {
        grid-template-columns: 1fr;
        gap: 6px;
      }
      .variants-cell-key {
        display: block;
      }
      .variants-cell-actions {
        justify-content: flex-start;
      }
      .variants-detail-row {
        grid-template-columns: 1fr;
        padding: 0 10px 10px;
      }
      .variants-upload {
        grid-template-columns: 1fr;
      }
      .tag-grid-row-permatag,
      .tag-grid-row-machine {
        grid-template-columns: 1fr;
      }
      .zoom-controls {
        flex-wrap: wrap;
        gap: 8px;
      }
    }
  `];

  static properties = {
    tenant: { type: String },
    image: { type: Object },
    open: { type: Boolean },
    embedded: { type: Boolean },
    details: { type: Object },
    keywordsByCategory: { type: Object },
    activeTab: { type: String },
    tagSubTab: { type: String },
    tagInput: { type: String },
    tagCategory: { type: String },
    loading: { type: Boolean },
    error: { type: String },
    fullImageUrl: { type: String },
    fullImageLoading: { type: Boolean },
    fullImageError: { type: String },
    videoPlaybackUrl: { type: String },
    videoPlaybackLoading: { type: Boolean },
    videoPlaybackError: { type: String },
    similarImages: { type: Array },
    similarLoading: { type: Boolean },
    similarError: { type: String },
    ratingSaving: { type: Boolean },
    ratingError: { type: String },
    metadataRefreshing: { type: Boolean },
    tagsPropagating: { type: Boolean },
    assetVariants: { type: Array },
    assetVariantsLoading: { type: Boolean },
    assetVariantsError: { type: String },
    variantUploadLabel: { type: String },
    variantUploading: { type: Boolean },
    variantRowBusy: { type: Object },
    variantDrafts: { type: Object },
    variantInspectBusy: { type: Object },
    variantInspectData: { type: Object },
    isActualSize: { type: Boolean },
    fullscreenOpen: { type: Boolean },
    imageSet: { type: Array },
    currentImageIndex: { type: Number },
    fullscreenZoom: { type: Number },
    fullscreenFitMode: { type: Boolean },
    canEditTags: { type: Boolean },
    canCurate: { type: Boolean },
    marketingNote: { type: String },
    marketingNoteSaving: { type: Boolean },
    marketingNoteError: { type: String },
    keywordCategories: { type: Array },
    newKeywordMode: { type: Boolean },
    newKeywordCategoryId: { type: [Number, String] },
    newKeywordName: { type: String },
    newKeywordSaving: { type: Boolean },
    newKeywordError: { type: String },
  };

  constructor() {
    super();
    this.tenant = '';
    this.image = null;
    this.open = false;
    this.embedded = false;
    this.details = null;
    this.keywordsByCategory = {};
    this.activeTab = 'edit';
    this.tagSubTab = 'permatags';
    this.tagInput = '';
    this.tagCategory = '';
    this.loading = false;
    this.error = '';
    this.fullImageUrl = '';
    this.fullImageLoading = false;
    this.fullImageError = '';
    this.videoPlaybackUrl = '';
    this.videoPlaybackLoading = false;
    this.videoPlaybackError = '';
    this.similarImages = [];
    this.similarLoading = false;
    this.similarError = '';
    this._fullImageAbortController = null;
    this._videoPlaybackAbortController = null;
    this._videoPlaybackObjectUrl = '';
    this._fullImageLoadTimer = null;
    this._fullImageLoadDelayMs = 0;
    this._fullImageRapidDelayMs = 120;
    this._fullImageRapidThresholdMs = 200;
    this._fullImageLastNavTs = 0;
    this._similarWarmupTimer = null;
    this.ratingSaving = false;
    this.ratingError = '';
    this.metadataRefreshing = false;
    this.tagsPropagating = false;
    this.assetVariants = [];
    this.assetVariantsLoading = false;
    this.assetVariantsError = '';
    this.variantUploadLabel = '';
    this.variantUploading = false;
    this.variantRowBusy = {};
    this.variantDrafts = {};
    this.variantInspectBusy = {};
    this.variantInspectData = {};
    this._variantUploadFile = null;
    this._variantPreviewUrls = {};
    this._variantPreviewInflight = {};
    this.isActualSize = false;
    this.fullscreenOpen = false;
    this.imageSet = [];
    this.currentImageIndex = -1;
    this.fullscreenZoom = 50;
    this.fullscreenFitMode = false;
    this.canEditTags = true;
    this.canCurate = false;
    this.marketingNote = '';
    this.marketingNoteSaving = false;
    this.marketingNoteError = '';
    this.keywordCategories = [];
    this.newKeywordMode = false;
    this.newKeywordCategoryId = '';
    this.newKeywordName = '';
    this.newKeywordSaving = false;
    this.newKeywordError = '';
    this._ratingBurstActive = false;
    this._ratingBurstTimer = null;
    this._suppressPermatagRefresh = false;
    this._prevBodyOverflow = null;
    this._handlePermatagEvent = (event) => {
      if ((this.open || this.embedded) && event?.detail?.imageId === this.image?.id) {
        if (event?.detail?.source === 'image-editor' && this._suppressPermatagRefresh) {
          this._suppressPermatagRefresh = false;
          return;
        }
        this.fetchDetails();
      }
    };
  }

  updated(changedProperties) {
    if (changedProperties.has('image')) {
      this._resetFullImage();
    }
    if (changedProperties.has('open') || changedProperties.has('image')) {
      this._syncBodyScrollLock();
      if (this.activeTab !== 'edit') {
        this.activeTab = 'edit';
      }
    }
    if (changedProperties.has('open') && this.open) {
      this._scheduleFullImageLoad();
      this._scheduleVideoPlaybackLoad();
    }
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('permatags-changed', this._handlePermatagEvent);
  }

  disconnectedCallback() {
    window.removeEventListener('permatags-changed', this._handlePermatagEvent);
    this._clearSimilarWarmupTimer();
    this._revokeVariantPreviewUrls();
    this._resetFullImage();
    this._resetVideoPlayback();
    this._restoreBodyScroll();
    super.disconnectedCallback();
  }

  _syncBodyScrollLock() {
    if (this.embedded) return;
    if (this.open) {
      if (this._prevBodyOverflow === null) {
        this._prevBodyOverflow = document.body.style.overflow || '';
      }
      document.body.style.overflow = 'hidden';
    } else {
      this._restoreBodyScroll();
    }
  }

  _restoreBodyScroll() {
    if (this.embedded) return;
    if (this._prevBodyOverflow !== null) {
      document.body.style.overflow = this._prevBodyOverflow;
      this._prevBodyOverflow = null;
    }
  }

  willUpdate(changedProperties) {
    const shouldLoad = this.embedded || this.open;
    if (shouldLoad && (changedProperties.has('image') || changedProperties.has('tenant'))) {
      this._clearSimilarWarmupTimer();
      this._resetFullImage();
      this._resetVideoPlayback();
      this._resetSimilarResults();
      this._resetVariantEditor();
      this._cancelNewKeywordMode();
      this.fetchDetails();
      this.fetchKeywords();
    }
    if (changedProperties.has('details')) {
      this._syncTagSubTab();
      this._scheduleFullImageLoad();
      this._scheduleVideoPlaybackLoad();
      if (this.open || this.embedded) {
        this._scheduleSimilarWarmup();
      }
      if (this.activeTab === 'variants') {
        this._loadAssetVariants();
      }
    }
    if (changedProperties.has('open') && !this.open && !this.embedded) {
      this._clearSimilarWarmupTimer();
      this._resetFullImage();
      this._resetVideoPlayback();
    }
  }

  async fetchDetails() {
    if (!this.image || !this.tenant) return;
    this.loading = true;
    this.error = '';
    try {
      this.details = await getImageDetails(this.tenant, this.image.id);
      this._fetchMarketingNote();
    } catch (error) {
      this.error = 'Failed to load image details.';
      console.error('ImageEditor: fetchDetails failed', error);
    } finally {
      this.loading = false;
    }
  }

  async _fetchMarketingNote() {
    if (!this.image || !this.tenant) return;
    try {
      const result = await getAssetNote(this.tenant, this.image.id, 'marketing');
      this.marketingNote = result.body ?? '';
    } catch (error) {
      console.error('ImageEditor: failed to load marketing note', error);
    }
  }

  async _handleSaveMarketingNote() {
    if (!this.canCurate || !this.image || !this.tenant || this.marketingNoteSaving) return;
    this.marketingNoteSaving = true;
    this.marketingNoteError = '';
    try {
      const result = await upsertAssetNote(this.tenant, this.image.id, 'marketing', this.marketingNote);
      this.marketingNote = result.body ?? '';
    } catch (error) {
      this.marketingNoteError = 'Failed to save note.';
      console.error('ImageEditor: failed to save marketing note', error);
    } finally {
      this.marketingNoteSaving = false;
    }
  }

  async _handleMetadataRefresh() {
    if (!this.details || !this.tenant || this.metadataRefreshing) return;
    this.metadataRefreshing = true;
    try {
      await refreshImageMetadata(this.tenant, this.details.id);
      await this.fetchDetails();
    } catch (error) {
      console.error('ImageEditor: metadata refresh failed', error);
    } finally {
      this.metadataRefreshing = false;
    }
  }

  async _handlePropagateDropboxTags() {
    if (!this.details || !this.tenant || this.tagsPropagating) return;
    this.tagsPropagating = true;
    try {
      await propagateDropboxTags(this.tenant, this.details.id);
    } catch (error) {
      console.error('ImageEditor: tag propagation failed', error);
    } finally {
      this.tagsPropagating = false;
    }
  }

  async fetchKeywords() {
    if (!this.tenant) return;
    try {
      this.keywordsByCategory = await getKeywords(this.tenant, { source: 'permatags', includePeople: true });
      this.keywordCategories = await getKeywordCategories(this.tenant);
      if (this.newKeywordMode && !this.newKeywordCategoryId && Array.isArray(this.keywordCategories) && this.keywordCategories.length) {
        this.newKeywordCategoryId = String(this.keywordCategories[0].id);
      }
    } catch (error) {
      console.error('ImageEditor: fetchKeywords failed', error);
      this.keywordsByCategory = {};
      this.keywordCategories = [];
    }
  }

  _close() {
    this._pauseInlineVideo();
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  _setTab(tab) {
    this.activeTab = tab;
    if (tab === 'image') {
      this._loadFullImage();
    } else if (tab === 'similar') {
      this._loadSimilarImages();
    } else if (tab === 'variants') {
      this._loadAssetVariants();
    }
  }

  _resetSimilarResults() {
    this.similarImages = [];
    this.similarLoading = false;
    this.similarError = '';
  }

  _getSimilarWarmupKey() {
    if (!this.tenant || !this.details?.id) return null;
    const mediaType = String(this._inferMediaType(this.details) || 'image').toLowerCase();
    return `${this.tenant}::${mediaType}`;
  }

  _clearSimilarWarmupTimer() {
    if (!this._similarWarmupTimer) return;
    clearTimeout(this._similarWarmupTimer);
    this._similarWarmupTimer = null;
  }

  _scheduleSimilarWarmup() {
    if (!this.details?.id || !this.tenant) return;
    if (this.activeTab === 'similar') return;
    const warmupKey = this._getSimilarWarmupKey();
    if (!warmupKey || similarWarmupCompleted.has(warmupKey) || similarWarmupInflight.has(warmupKey)) {
      return;
    }
    this._clearSimilarWarmupTimer();
    this._similarWarmupTimer = window.setTimeout(() => {
      this._similarWarmupTimer = null;
      this._warmSimilarCache().catch(() => {});
    }, SIMILAR_WARMUP_DELAY_MS);
  }

  async _warmSimilarCache() {
    const sourceImageId = this.details?.id;
    const warmupKey = this._getSimilarWarmupKey();
    if (!sourceImageId || !warmupKey || !this.tenant) return;
    if (similarWarmupCompleted.has(warmupKey)) return;

    const existingWarmup = similarWarmupInflight.get(warmupKey);
    if (existingWarmup) {
      await existingWarmup;
      return;
    }

    const warmupPromise = (async () => {
      await getSimilarImages(this.tenant, sourceImageId, {
        limit: 1,
        sameMediaType: true,
      });
      similarWarmupCompleted.add(warmupKey);
    })();

    similarWarmupInflight.set(warmupKey, warmupPromise);
    try {
      await warmupPromise;
    } catch (error) {
      console.debug('ImageEditor: similar warmup skipped', error);
    } finally {
      similarWarmupInflight.delete(warmupKey);
    }
  }

  async _loadSimilarImages(force = false) {
    if (!this.details?.id || !this.tenant) return;
    if (!force && (this.similarLoading || this.similarImages.length > 0)) return;
    const sourceImageId = this.details.id;
    const warmupKey = this._getSimilarWarmupKey();
    const existingWarmup = warmupKey ? similarWarmupInflight.get(warmupKey) : null;
    if (existingWarmup) {
      try {
        await existingWarmup;
      } catch {
        // Warmup is opportunistic only; continue with direct fetch.
      }
    }
    this.similarLoading = true;
    this.similarError = '';
    try {
      const payload = await getSimilarImages(this.tenant, sourceImageId, {
        limit: 60,
        sameMediaType: true,
      });
      if (this.details?.id !== sourceImageId) {
        return;
      }
      this.similarImages = Array.isArray(payload?.images) ? payload.images : [];
    } catch (error) {
      if (this.details?.id !== sourceImageId) {
        return;
      }
      this.similarImages = [];
      this.similarError = error?.message || 'Failed to load similar images.';
      console.error('ImageEditor: failed to load similar images', error);
    } finally {
      if (this.details?.id === sourceImageId) {
        this.similarLoading = false;
      }
    }
  }

  _resetVariantEditor() {
    this._revokeVariantPreviewUrls();
    this.assetVariants = [];
    this.assetVariantsLoading = false;
    this.assetVariantsError = '';
    this.variantUploadLabel = '';
    this.variantUploading = false;
    this.variantRowBusy = {};
    this.variantDrafts = {};
    this.variantInspectBusy = {};
    this.variantInspectData = {};
    this._variantUploadFile = null;
  }

  async _loadAssetVariants(force = false) {
    if (!this.details?.id || !this.tenant) return;
    if (!force && (this.assetVariantsLoading || this.assetVariants.length > 0)) return;
    this.assetVariantsLoading = true;
    this.assetVariantsError = '';
    try {
      const data = await listAssetVariants(this.tenant, this.details.id);
      const rows = Array.isArray(data?.variants) ? data.variants : [];
      this.assetVariants = rows;
      this._revokeVariantPreviewUrls(rows.map((row) => row.id));
      const drafts = {};
      rows.forEach((row) => {
        drafts[row.id] = {
          variant: row.variant || '',
          filename: row.filename || '',
        };
        this._ensureVariantPreviewUrl(row);
      });
      this.variantDrafts = drafts;
      const keepIds = new Set(rows.map((item) => String(item.id)));
      this.variantInspectData = Object.fromEntries(
        Object.entries(this.variantInspectData || {}).filter(([variantId]) => keepIds.has(String(variantId)))
      );
      this.variantInspectBusy = Object.fromEntries(
        Object.entries(this.variantInspectBusy || {}).filter(([variantId]) => keepIds.has(String(variantId)))
      );
    } catch (error) {
      this.assetVariantsError = error?.message || 'Failed to load variants.';
    } finally {
      this.assetVariantsLoading = false;
    }
  }

  _handleVariantFileChange(event) {
    this._variantUploadFile = event?.target?.files?.[0] || null;
  }

  _handleVariantPreviewError(event) {
    const imageEl = event?.target;
    if (!imageEl) return;
    imageEl.style.display = 'none';
    const fallback = imageEl.nextElementSibling;
    if (fallback) {
      fallback.style.display = 'flex';
    }
  }

  _revokeVariantPreviewUrls(keepIds = []) {
    const keep = new Set((keepIds || []).map(String));
    Object.entries(this._variantPreviewUrls || {}).forEach(([variantId, objectUrl]) => {
      if (keep.has(String(variantId))) return;
      try {
        URL.revokeObjectURL(objectUrl);
      } catch (_error) {
        // no-op
      }
      delete this._variantPreviewUrls[variantId];
      delete this._variantPreviewInflight[variantId];
    });
  }

  async _ensureVariantPreviewUrl(row) {
    const variantId = String(row?.id || '');
    if (!variantId || !this.details?.id || !this.tenant) return;
    if (this._variantPreviewUrls[variantId] || this._variantPreviewInflight[variantId]) return;

    this._variantPreviewInflight[variantId] = true;
    const imageId = this.details.id;
    try {
      const blob = await getAssetVariantContent(this.tenant, imageId, variantId);
      const objectUrl = URL.createObjectURL(blob);
      const stillPresent = (this.assetVariants || []).some((item) => String(item.id) === variantId);
      if (!stillPresent) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      const existing = this._variantPreviewUrls[variantId];
      if (existing && existing !== objectUrl) {
        URL.revokeObjectURL(existing);
      }
      this._variantPreviewUrls[variantId] = objectUrl;
      this.requestUpdate();
    } catch (error) {
      console.error('ImageEditor: failed to load variant preview', error);
    } finally {
      delete this._variantPreviewInflight[variantId];
    }
  }

  async _handleOpenVariant(row) {
    const variantId = String(row?.id || '');
    if (!variantId) return;
    if (!this._variantPreviewUrls[variantId]) {
      await this._ensureVariantPreviewUrl(row);
    }
    const url = this._variantPreviewUrls[variantId];
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  async _handleDownloadVariant(row) {
    const variantId = String(row?.id || '');
    if (!variantId || !this.details?.id || !this.tenant) return;
    const busyKey = `${variantId}:download`;
    if (this.variantRowBusy[busyKey]) return;
    this.variantRowBusy = { ...this.variantRowBusy, [busyKey]: true };
    this.assetVariantsError = '';
    try {
      const blob = await getAssetVariantContent(this.tenant, this.details.id, variantId);
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const fallbackName = `variant-${variantId}`;
      link.href = downloadUrl;
      link.download = row?.filename || fallbackName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      this.assetVariantsError = error?.message || 'Failed to download variant.';
    } finally {
      this.variantRowBusy = { ...this.variantRowBusy, [busyKey]: false };
    }
  }

  _updateVariantDraft(variantId, field, value) {
    this.variantDrafts = {
      ...this.variantDrafts,
      [variantId]: {
        ...(this.variantDrafts[variantId] || {}),
        [field]: value,
      },
    };
  }

  async _handleVariantUpload() {
    const variantLabel = String(this.variantUploadLabel || '').trim();
    if (!this.canEditTags || !this.details?.id || !this.tenant || !variantLabel || !this._variantUploadFile) return;
    this.variantUploading = true;
    this.assetVariantsError = '';
    try {
      await uploadAssetVariant(this.tenant, this.details.id, {
        file: this._variantUploadFile,
        variant: variantLabel,
      });
      this.variantUploadLabel = '';
      this._variantUploadFile = null;
      const input = this.renderRoot?.querySelector('.variant-upload-file');
      if (input) {
        input.value = '';
      }
      await this._loadAssetVariants(true);
    } catch (error) {
      this.assetVariantsError = error?.message || 'Failed to upload variant.';
    } finally {
      this.variantUploading = false;
    }
  }

  async _handleVariantSave(variantId) {
    if (!this.canEditTags || !this.details?.id || !this.tenant) return;
    const draft = this.variantDrafts[variantId] || {};
    const busyKey = `${variantId}:save`;
    this.variantRowBusy = { ...this.variantRowBusy, [busyKey]: true };
    this.assetVariantsError = '';
    try {
      await updateAssetVariant(this.tenant, this.details.id, variantId, {
        variant: draft.variant ?? '',
        filename: draft.filename ?? '',
      });
      await this._loadAssetVariants(true);
    } catch (error) {
      this.assetVariantsError = error?.message || 'Failed to update variant.';
    } finally {
      this.variantRowBusy = { ...this.variantRowBusy, [busyKey]: false };
    }
  }

  async _handleVariantDelete(variantId) {
    if (!this.canEditTags || !this.details?.id || !this.tenant) return;
    const confirmed = window.confirm('Delete this asset variant?');
    if (!confirmed) return;
    const busyKey = `${variantId}:delete`;
    this.variantRowBusy = { ...this.variantRowBusy, [busyKey]: true };
    this.assetVariantsError = '';
    try {
      await deleteAssetVariant(this.tenant, this.details.id, variantId);
      await this._loadAssetVariants(true);
    } catch (error) {
      this.assetVariantsError = error?.message || 'Failed to delete variant.';
    } finally {
      this.variantRowBusy = { ...this.variantRowBusy, [busyKey]: false };
    }
  }

  async _handleVariantInspect(variantId) {
    const rowId = String(variantId || '');
    if (!rowId || !this.details?.id || !this.tenant) return;
    if (this.variantInspectBusy[rowId]) return;
    this.variantInspectBusy = { ...this.variantInspectBusy, [rowId]: true };
    this.assetVariantsError = '';
    try {
      const data = await inspectAssetVariant(this.tenant, this.details.id, rowId);
      this.variantInspectData = { ...this.variantInspectData, [rowId]: data || {} };
    } catch (error) {
      this.assetVariantsError = error?.message || 'Failed to inspect variant.';
    } finally {
      this.variantInspectBusy = { ...this.variantInspectBusy, [rowId]: false };
    }
  }

  _setTagSubTab(tab) {
    this.tagSubTab = tab;
  }

  async _handleRatingClick(value) {
    if (!this.canCurate || !this.details || !this.tenant || this.ratingSaving) return;
    this._triggerRatingBurst();
    this.ratingSaving = true;
    this.ratingError = '';
    try {
      await setRating(this.tenant, this.details.id, value);
      this.details = { ...this.details, rating: value };
      this.dispatchEvent(new CustomEvent('image-rating-updated', {
        detail: { imageId: this.details.id, rating: value },
        bubbles: true,
        composed: true,
      }));
    } catch (error) {
      this.ratingError = 'Failed to update rating.';
      console.error('ImageEditor: rating update failed', error);
    } finally {
      this.ratingSaving = false;
    }
  }

  _triggerRatingBurst() {
    if (this._ratingBurstTimer) {
      clearTimeout(this._ratingBurstTimer);
    }
    this._ratingBurstActive = true;
    this.requestUpdate();
    this._ratingBurstTimer = setTimeout(() => {
      this._ratingBurstActive = false;
      this._ratingBurstTimer = null;
      this.requestUpdate();
    }, 700);
  }

  _resetFullImage() {
    this._cancelFullImageLoad();
    if (this.fullImageUrl) {
      URL.revokeObjectURL(this.fullImageUrl);
    }
    this.fullImageUrl = '';
    this.fullImageLoading = false;
    this.fullImageError = '';
  }

  _resetVideoPlayback() {
    this._cancelVideoPlaybackLoad();
    this._revokeVideoPlaybackObjectUrl();
    this.videoPlaybackUrl = '';
    this.videoPlaybackLoading = false;
    this.videoPlaybackError = '';
    this._pauseInlineVideo();
  }

  _cancelFullImageLoad() {
    if (this._fullImageLoadTimer) {
      clearTimeout(this._fullImageLoadTimer);
      this._fullImageLoadTimer = null;
    }
    if (this._fullImageAbortController) {
      this._fullImageAbortController.abort();
      this._fullImageAbortController = null;
    }
  }

  _cancelVideoPlaybackLoad() {
    if (this._videoPlaybackAbortController) {
      this._videoPlaybackAbortController.abort();
      this._videoPlaybackAbortController = null;
    }
  }

  _scheduleVideoPlaybackLoad() {
    if (!this.details || !this.tenant) return;
    if (!this.open && !this.embedded) return;
    if (!this._isVideoMedia(this.details)) {
      this._resetVideoPlayback();
      return;
    }
    this._loadVideoPlayback();
  }

  async _loadVideoPlayback({ force = false } = {}) {
    if (!this.details || !this.tenant) return;
    if (!this._isVideoMedia(this.details)) return;
    if (!force && (this.videoPlaybackLoading || this.videoPlaybackUrl)) return;

    this._cancelVideoPlaybackLoad();
    this.videoPlaybackLoading = true;
    this.videoPlaybackError = '';
    if (force) {
      this._revokeVideoPlaybackObjectUrl();
      this.videoPlaybackUrl = '';
      this._pauseInlineVideo();
    }
    const imageId = this.details.id;
    const controller = new AbortController();
    this._videoPlaybackAbortController = controller;
    try {
      const payload = await getImagePlayback(this.tenant, imageId, { signal: controller.signal });
      if (controller.signal.aborted || this.details?.id !== imageId) {
        return;
      }
      const playbackMode = String(payload?.mode || '').trim().toLowerCase();
      if (playbackMode === 'proxy_stream') {
        const streamBlob = await getImagePlaybackStream(this.tenant, imageId, { signal: controller.signal });
        if (controller.signal.aborted || this.details?.id !== imageId) {
          return;
        }
        const objectUrl = URL.createObjectURL(streamBlob);
        this._revokeVideoPlaybackObjectUrl();
        this._videoPlaybackObjectUrl = objectUrl;
        this.videoPlaybackUrl = objectUrl;
        return;
      }
      const nextUrl = String(payload?.playback_url || '').trim();
      if (!nextUrl) {
        throw new Error('Playback URL unavailable');
      }
      this._revokeVideoPlaybackObjectUrl();
      this.videoPlaybackUrl = nextUrl;
    } catch (error) {
      if (error?.name === 'AbortError') {
        return;
      }
      this.videoPlaybackError = error?.message || 'Failed to load video playback URL.';
      console.error('ImageEditor: video playback load failed', error);
    } finally {
      if (this._videoPlaybackAbortController === controller) {
        this._videoPlaybackAbortController = null;
      }
      this.videoPlaybackLoading = false;
    }
  }

  _pauseInlineVideo() {
    const videoEl = this.renderRoot?.querySelector('.image-video-player');
    if (videoEl && typeof videoEl.pause === 'function') {
      videoEl.pause();
    }
  }

  _revokeVideoPlaybackObjectUrl() {
    if (!this._videoPlaybackObjectUrl) return;
    try {
      URL.revokeObjectURL(this._videoPlaybackObjectUrl);
    } catch (_error) {
      // no-op
    }
    this._videoPlaybackObjectUrl = '';
  }

  _handleVideoPlaybackError() {
    if (!this._isVideoMedia(this.details)) return;
    if (!this.videoPlaybackUrl || this.videoPlaybackLoading) return;
    this.videoPlaybackError = this.videoPlaybackError || 'Video playback failed.';
  }

  _handleVideoPlaybackLoaded() {
    if (this.videoPlaybackError) {
      this.videoPlaybackError = '';
    }
  }

  _scheduleFullImageLoad() {
    if (!this.details || !this.tenant) return;
    if (!this.open && !this.embedded) return;
    if (this._isVideoMedia(this.details)) return;
    if (this.fullImageUrl || this.fullImageLoading) return;
    this._cancelFullImageLoad();
    const now = Date.now();
    const delta = now - (this._fullImageLastNavTs || 0);
    this._fullImageLastNavTs = now;
    const delay = delta < this._fullImageRapidThresholdMs
      ? this._fullImageRapidDelayMs
      : this._fullImageLoadDelayMs;
    if (!delay) {
      this._loadFullImage();
      return;
    }
    this._fullImageLoadTimer = setTimeout(() => {
      this._fullImageLoadTimer = null;
      this._loadFullImage();
    }, delay);
  }

  async _loadFullImage() {
    if (!this.details || !this.tenant) return;
    if (this._isVideoMedia(this.details)) return;
    if (this.fullImageUrl || this.fullImageLoading) return;
    this._cancelFullImageLoad();
    this.fullImageLoading = true;
    this.fullImageError = '';
    const imageId = this.details.id;
    const controller = new AbortController();
    this._fullImageAbortController = controller;
    try {
      const blob = await getFullImage(this.tenant, imageId, { signal: controller.signal });
      if (controller.signal.aborted || this.details?.id !== imageId) {
        return;
      }
      this.fullImageUrl = URL.createObjectURL(blob);
    } catch (error) {
      if (error?.name === 'AbortError') {
        return;
      }
      this.fullImageError = 'Failed to load full-size image.';
      console.error('ImageEditor: full image load failed', error);
    } finally {
      if (this._fullImageAbortController === controller) {
        this._fullImageAbortController = null;
      }
      this.fullImageLoading = false;
    }
  }

  _setFitToWidth() {
    this.isActualSize = false;
  }

  _setActualSize() {
    this.isActualSize = true;
  }

  _openFullscreen() {
    this.fullscreenOpen = true;
    this.fullscreenFitMode = false;
    this.fullscreenZoom = 50;
  }

  _closeFullscreen() {
    this.fullscreenOpen = false;
    this.fullscreenZoom = 50;
    this.fullscreenFitMode = false;
  }

  _setFullscreenZoom(zoom) {
    if (zoom === 'fit') {
      this._fitImageToScreen();
    } else {
      this.fullscreenZoom = zoom;
      this.fullscreenFitMode = false;
      this.requestUpdate();
    }
  }

  _fitImageToScreen() {
    this.fullscreenFitMode = true;
    // Image will be calculated in render based on container dimensions
    this.requestUpdate();
  }

  _calculateFitZoom() {
    // Get the fullscreen viewer content container
    const container = this.shadowRoot?.querySelector('.fullscreen-viewer-content');
    const img = this.shadowRoot?.querySelector('.fullscreen-viewer-image');

    if (!container || !img) return 100;

    // Container dimensions (minus padding of 20px on each side = 40px total)
    const containerWidth = container.clientWidth - 40;
    const containerHeight = container.clientHeight - 40;

    // Image natural dimensions
    const imgWidth = img.naturalWidth || img.width;
    const imgHeight = img.naturalHeight || img.height;

    if (!imgWidth || !imgHeight) return 100;

    // Calculate zoom to fit both dimensions
    const zoomX = (containerWidth / imgWidth) * 100;
    const zoomY = (containerHeight / imgHeight) * 100;

    // Use the smaller zoom to fit both dimensions
    return Math.min(zoomX, zoomY, 100);
  }

  _goToPreviousImage() {
    if (this.currentImageIndex > 0) {
      const previousIndex = this.currentImageIndex - 1;
      this.dispatchEvent(new CustomEvent('image-navigate', {
        detail: { imageId: this.imageSet[previousIndex].id, index: previousIndex }
      }));
    }
  }

  _goToNextImage() {
    if (this.currentImageIndex < this.imageSet.length - 1) {
      const nextIndex = this.currentImageIndex + 1;
      this.dispatchEvent(new CustomEvent('image-navigate', {
        detail: { imageId: this.imageSet[nextIndex].id, index: nextIndex }
      }));
    }
  }

  _syncTagSubTab() {
    const types = Object.keys(this.details?.machine_tags_by_type || {});
    const tabs = ['permatags', ...types];
    if (!tabs.includes(this.tagSubTab)) {
      this.tagSubTab = 'permatags';
    }
  }

  _keywordIndex() {
    const map = {};
    Object.entries(this.keywordsByCategory || {}).forEach(([category, keywords]) => {
      keywords.forEach((entry) => {
        if (entry.keyword) {
          map[entry.keyword] = category;
        }
      });
    });
    return map;
  }

  _getKeywordCategoriesSorted() {
    const categories = Array.isArray(this.keywordCategories) ? [...this.keywordCategories] : [];
    return categories.sort((a, b) => {
      const aOrder = Number(a?.sort_order ?? 0);
      const bOrder = Number(b?.sort_order ?? 0);
      if (aOrder !== bOrder) return aOrder - bOrder;
      return String(a?.name || '').localeCompare(String(b?.name || ''));
    });
  }

  _normalizeKeywordValue(value) {
    return String(value || '').trim().toLowerCase();
  }

  _getSimilarKeywordSuggestions(queryRaw) {
    const query = this._normalizeKeywordValue(queryRaw);
    if (!query || query.length < 2) return [];
    const matches = [];
    Object.entries(this.keywordsByCategory || {}).forEach(([category, keywords]) => {
      (keywords || []).forEach((entry) => {
        const keyword = String(entry?.keyword || '').trim();
        if (!keyword) return;
        const normalizedKeyword = this._normalizeKeywordValue(keyword);
        if (!normalizedKeyword.includes(query)) return;
        matches.push({ keyword, category });
      });
    });
    matches.sort((a, b) => {
      const aKeyword = this._normalizeKeywordValue(a.keyword);
      const bKeyword = this._normalizeKeywordValue(b.keyword);
      const aStarts = aKeyword.startsWith(query) ? 0 : 1;
      const bStarts = bKeyword.startsWith(query) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      if (aKeyword !== bKeyword) return aKeyword.localeCompare(bKeyword);
      return String(a.category || '').localeCompare(String(b.category || ''));
    });
    const deduped = [];
    const seen = new Set();
    for (const row of matches) {
      const key = `${row.category}::${this._normalizeKeywordValue(row.keyword)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(row);
      if (deduped.length >= 8) break;
    }
    return deduped;
  }

  _toggleNewKeywordMode() {
    const next = !this.newKeywordMode;
    this.newKeywordMode = next;
    this.newKeywordError = '';
    if (!next) {
      this.newKeywordName = '';
      this.newKeywordCategoryId = '';
      return;
    }
    const categories = this._getKeywordCategoriesSorted();
    if (!this.newKeywordCategoryId && categories.length) {
      this.newKeywordCategoryId = String(categories[0].id);
    }
  }

  _cancelNewKeywordMode() {
    this.newKeywordMode = false;
    this.newKeywordName = '';
    this.newKeywordCategoryId = '';
    this.newKeywordError = '';
  }

  async _applyPermatag(keywordRaw, categoryRaw) {
    if (!this.details) return;
    const keyword = String(keywordRaw || '').trim();
    if (!keyword) return;
    const keywordMap = this._keywordIndex();
    const category = String(categoryRaw || '').trim() || keywordMap[keyword] || 'Uncategorized';
    await addPermatag(this.tenant, this.details.id, keyword, category, 1);
    const existing = Array.isArray(this.details.permatags) ? this.details.permatags : [];
    const alreadyTagged = existing.some((entry) => (
      entry.signum === 1
      && String(entry.keyword || '') === keyword
      && String(entry.category || 'Uncategorized') === String(category || 'Uncategorized')
    ));
    const nextPermatags = alreadyTagged
      ? existing
      : [...existing, { keyword, category, signum: 1 }];
    this.details = { ...this.details, permatags: nextPermatags };
    this.tagInput = '';
    this.tagCategory = '';
    this._suppressPermatagRefresh = true;
    this.dispatchEvent(new CustomEvent('permatags-changed', {
      detail: { imageId: this.details.id, source: 'image-editor' },
      bubbles: true,
      composed: true,
    }));
  }

  async _handleAddTag() {
    if (!this.details) return;
    const keyword = this.tagInput.trim();
    if (!keyword) return;
    try {
      await this._applyPermatag(keyword, this.tagCategory);
    } catch (error) {
      this.error = 'Failed to add tag.';
      console.error('ImageEditor: add tag failed', error);
    }
  }

  async _handleSelectExistingSimilarKeyword(suggestion) {
    if (!suggestion?.keyword) return;
    try {
      await this._applyPermatag(suggestion.keyword, suggestion.category);
      this._cancelNewKeywordMode();
    } catch (error) {
      this.newKeywordError = 'Failed to apply selected keyword.';
      console.error('ImageEditor: apply existing similar keyword failed', error);
    }
  }

  async _handleSaveNewKeyword() {
    if (!this.details || !this.tenant || this.newKeywordSaving) return;
    const keyword = String(this.newKeywordName || '').trim();
    const categoryId = String(this.newKeywordCategoryId || '').trim();
    if (!categoryId) {
      this.newKeywordError = 'Select a category.';
      return;
    }
    if (!keyword) {
      this.newKeywordError = 'Enter a keyword name.';
      return;
    }
    const categories = this._getKeywordCategoriesSorted();
    const selectedCategory = categories.find((cat) => String(cat?.id) === categoryId);
    if (!selectedCategory) {
      this.newKeywordError = 'Selected category no longer exists.';
      return;
    }
    this.newKeywordSaving = true;
    this.newKeywordError = '';
    try {
      await createKeyword(this.tenant, Number(categoryId), { keyword });
      await this.fetchKeywords();
      await this._applyPermatag(keyword, selectedCategory.name || 'Uncategorized');
      this._cancelNewKeywordMode();
    } catch (error) {
      this.newKeywordError = error?.message || 'Failed to create keyword.';
      console.error('ImageEditor: create keyword failed', error);
    } finally {
      this.newKeywordSaving = false;
    }
  }

  _handleTagSelectChange(event) {
    const value = event?.detail?.value ?? event?.target?.value ?? '';
    if (!value) {
      this.tagInput = '';
      this.tagCategory = '';
      return;
    }
    const [categoryPart, keywordPart] = value.split('::');
    const keyword = decodeURIComponent(keywordPart || '');
    const category = decodeURIComponent(categoryPart || 'Uncategorized');
    this.tagInput = keyword;
    this.tagCategory = category;
  }

  async _handleRemoveTag(tag) {
    if (!this.details) return;
    try {
      await addPermatag(this.tenant, this.details.id, tag.keyword, tag.category, -1);
      const existing = Array.isArray(this.details.permatags) ? this.details.permatags : [];
      const nextPermatags = existing.filter((entry) => !(
        entry.signum === 1 &&
        entry.keyword === tag.keyword &&
        (entry.category || 'Uncategorized') === (tag.category || 'Uncategorized')
      ));
      this.details = { ...this.details, permatags: nextPermatags };
      this._suppressPermatagRefresh = true;
      this.dispatchEvent(new CustomEvent('permatags-changed', {
        detail: { imageId: this.details.id, source: 'image-editor' },
        bubbles: true,
        composed: true,
      }));
    } catch (error) {
      this.error = 'Failed to remove tag.';
      console.error('ImageEditor: remove tag failed', error);
    }
  }

  _formatDateTime(value) {
    if (!value) return 'Unknown';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleString();
  }

  _formatVariantMetaDate(value) {
    if (!value) return '--';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleString([], {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  _formatVariantFileSize(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return '--';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let size = bytes / 1024;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
  }

  _inferMediaType(details = this.details) {
    const mediaType = String(details?.media_type || '').trim().toLowerCase();
    if (mediaType === 'video' || mediaType === 'image') {
      return mediaType;
    }
    const mimeType = String(details?.mime_type || '').trim().toLowerCase();
    if (mimeType.startsWith('video/')) {
      return 'video';
    }
    return 'image';
  }

  _isVideoMedia(details = this.details) {
    return this._inferMediaType(details) === 'video';
  }

  _formatMediaType(details = this.details) {
    return this._isVideoMedia(details) ? 'Video' : 'Photo';
  }

  _formatMediaDuration(details = this.details, { placeholder = '--' } = {}) {
    if (!this._isVideoMedia(details)) {
      return placeholder;
    }
    return formatDurationMs(details?.duration_ms, { placeholder });
  }

  _normalizeSourceProvider(value) {
    if (!value) return '';
    return String(value).trim().toLowerCase();
  }

  _formatSourceProvider(value = this.details?.source_provider) {
    const normalized = this._normalizeSourceProvider(value);
    if (!normalized) return 'Unknown';
    if (normalized === 'dropbox') return 'Dropbox';
    if (normalized === 'gdrive') return 'Google Drive';
    if (normalized === 'managed') return 'Managed Storage';
    if (normalized === 'local') return 'Local Storage';
    if (normalized === 'flickr') return 'Flickr';
    return normalized.replace(/[_-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
  }

  _buildDropboxHref(path) {
    if (!path) return '';
    const encodedPath = path.split('/').map((part) => encodeURIComponent(part)).join('/');
    return `https://www.dropbox.com/home${encodedPath}`;
  }

  _getSourcePath(details = this.details) {
    return details?.source_key || details?.dropbox_path || '';
  }

  _getSourceHref(details = this.details) {
    const sourceUrl = String(details?.source_url || '').trim();
    if (sourceUrl) return sourceUrl;
    const sourcePath = this._getSourcePath(details);
    if (!sourcePath) return '';
    const sourceProvider = this._normalizeSourceProvider(details?.source_provider);
    if (!sourceProvider || sourceProvider === 'dropbox') {
      return this._buildDropboxHref(sourcePath);
    }
    if (sourcePath.startsWith('http://') || sourcePath.startsWith('https://')) {
      return sourcePath;
    }
    return '';
  }

  _renderEditTab() {
    const permatags = (this.details?.permatags || []).filter((tag) => tag.signum === 1);
    const categories = Object.keys(this.keywordsByCategory || {}).sort((a, b) => a.localeCompare(b));
    const keywordMap = this._keywordIndex();
    const selectedCategory = this.tagCategory || (this.tagInput ? keywordMap[this.tagInput] : '') || 'Uncategorized';
    const selectedValue = this.tagInput
      ? `${encodeURIComponent(selectedCategory)}::${encodeURIComponent(this.tagInput)}`
      : '';
    const sourcePath = this._getSourcePath(this.details);
    const sourceHref = this._getSourceHref(this.details);
    const sourceProvider = this._formatSourceProvider(this.details?.source_provider);
    const flatKeywords = categories.flatMap((category) => (
      (this.keywordsByCategory?.[category] || [])
        .filter((entry) => entry.keyword)
        .map((entry) => ({
          keyword: entry.keyword,
          category,
          count: entry.count || 0,
        }))
    ));
    const sortedKeywordCategories = this._getKeywordCategoriesSorted();
    const similarKeywordSuggestions = this._getSimilarKeywordSuggestions(this.newKeywordName);
    return html`
      <div class="prop-panel">
        ${renderPropertySection({
          title: 'Image',
          rows: [
            {
              label: 'ID',
              value: html`
                <span>${this.details?.id ?? 'Unknown'}</span>
                ${this.details?.id ? html`
                  <button
                    type="button"
                    class="ml-2 text-blue-600 hover:text-blue-700 underline underline-offset-2"
                    @click=${this._handleZoomToPhoto}
                  >
                    [time travel]
                  </button>
                ` : html``}
              `,
            },
            {
              label: 'Provider',
              value: sourceProvider,
            },
            {
              label: 'Media',
              value: this._formatMediaType(this.details),
            },
            ...(this._isVideoMedia(this.details)
              ? [{
                  label: 'Duration',
                  value: this._formatMediaDuration(this.details, { placeholder: 'Unknown' }),
                }]
              : []),
            {
              label: 'Source',
              value: sourceHref
                ? html`<a class="prop-link" href=${sourceHref} target="_blank" rel="noopener noreferrer">${sourcePath || sourceHref}</a>`
                : (sourcePath || 'Unknown'),
            },
          ],
        })}

        ${renderPropertySection({
          title: 'Rating',
          body: this._renderRatingControl({ showHeading: false }),
        })}

        ${this.canEditTags ? renderPropertySection({
          title: 'Add Tags',
          body: html`
            <div class="new-keyword-toggle-row">
              <button
                type="button"
                class="new-keyword-toggle ${this.newKeywordMode ? 'active' : ''}"
                @click=${this._toggleNewKeywordMode}
              >
                New keyword
              </button>
            </div>
            ${this.newKeywordMode ? html`
              <div class="new-keyword-panel">
                <div class="new-keyword-grid">
                  <select
                    class="new-keyword-select"
                    .value=${String(this.newKeywordCategoryId || '')}
                    @change=${(event) => {
                      this.newKeywordCategoryId = String(event?.target?.value || '');
                      this.newKeywordError = '';
                    }}
                  >
                    <option value="">Select category</option>
                    ${sortedKeywordCategories.map((cat) => html`
                      <option value=${String(cat.id)}>${cat.name}</option>
                    `)}
                  </select>
                  <input
                    type="text"
                    class="new-keyword-input"
                    placeholder="Keyword name"
                    .value=${this.newKeywordName}
                    @input=${(event) => {
                      this.newKeywordName = String(event?.target?.value || '');
                      this.newKeywordError = '';
                    }}
                  />
                </div>
                <div class="new-keyword-actions">
                  <button
                    type="button"
                    class="new-keyword-save"
                    ?disabled=${this.newKeywordSaving}
                    @click=${this._handleSaveNewKeyword}
                  >
                    ${this.newKeywordSaving ? 'Saving...' : 'Save keyword'}
                  </button>
                  <button
                    type="button"
                    class="new-keyword-cancel"
                    ?disabled=${this.newKeywordSaving}
                    @click=${this._cancelNewKeywordMode}
                  >
                    Cancel
                  </button>
                </div>
                ${this.newKeywordError ? html`<div class="new-keyword-error">${this.newKeywordError}</div>` : html``}
                ${similarKeywordSuggestions.length ? html`
                  <div class="new-keyword-similar">
                    <div class="new-keyword-similar-title">Similar keywords (click to use existing)</div>
                    <div class="new-keyword-similar-list">
                      ${similarKeywordSuggestions.map((suggestion) => html`
                        <button
                          type="button"
                          class="new-keyword-similar-item"
                          @click=${() => this._handleSelectExistingSimilarKeyword(suggestion)}
                        >
                          ${suggestion.keyword} · ${suggestion.category || 'Uncategorized'}
                        </button>
                      `)}
                    </div>
                  </div>
                ` : html``}
              </div>
            ` : html``}
            <div class="tag-form">
              <keyword-dropdown
                class="tag-dropdown"
                .value=${selectedValue}
                .keywords=${flatKeywords}
                .includeUntagged=${false}
                .compact=${true}
                @keyword-selected=${this._handleTagSelectChange}
                @change=${this._handleTagSelectChange}
              ></keyword-dropdown>
              <button class="tag-add" @click=${this._handleAddTag}>Add Tag</button>
            </div>
          `,
        }) : html``}

        ${renderPropertySection({
          title: 'Active Tags',
          body: permatags.length
            ? renderPropertyRows(
              permatags.map((tag) => ({
                label: tag.keyword || '--',
                value: html`
                  <div class="tag-active-row">
                    <span class="tag-active-meta">${tag.category || 'Uncategorized'}</span>
                    ${this.canEditTags ? html`
                      <button
                        type="button"
                        class="tag-remove-inline"
                        @click=${() => this._handleRemoveTag(tag)}
                      >
                        Remove
                      </button>
                    ` : html``}
                  </div>
                `,
              })),
              { scroll: true },
            )
            : html`<div class="empty-text">No active tags.</div>`,
        })}

        ${renderPropertySection({
          title: 'Notes',
          body: html`
            <div class="flex flex-col gap-2">
              <textarea
                class="w-full rounded border border-gray-300 p-2 text-sm resize-y min-h-[80px]"
                placeholder="Marketing description..."
                .value=${this.marketingNote}
                @input=${(e) => { this.marketingNote = e.target.value; }}
                ?disabled=${!this.canCurate}
              ></textarea>
              <div class="flex items-center gap-2">
                <button
                  class="text-xs text-blue-600 hover:text-blue-700 disabled:opacity-50"
                  ?disabled=${this.marketingNoteSaving || !this.canCurate}
                  @click=${this._handleSaveMarketingNote}
                >${this.marketingNoteSaving ? 'Saving…' : 'Save'}</button>
                ${!this.canCurate ? html`<span class="text-xs text-gray-500">Read only for your role.</span>` : html``}
                ${this.marketingNoteError ? html`<span class="text-xs text-red-500">${this.marketingNoteError}</span>` : html``}
              </div>
            </div>
          `,
        })}

        ${(this.canEditTags && this._normalizeSourceProvider(this.details?.source_provider) === 'dropbox') ? renderPropertySection({
          title: 'Tag Actions',
          body: html`
            <div class="edit-action-row">
              <span>Write tags to ${sourceProvider}</span>
              <button
                class="text-xs text-blue-600 hover:text-blue-700"
                ?disabled=${this.tagsPropagating}
                @click=${this._handlePropagateDropboxTags}
                title="Write GMM tags for this image"
              >
                ${this.tagsPropagating ? 'Propagating...' : 'Propagate tags'}
              </button>
            </div>
          `,
        }) : html``}
      </div>
    `;
  }

  _handleZoomToPhoto() {
    if (!this.details?.id) return;
    this.dispatchEvent(new CustomEvent('zoom-to-photo', {
      detail: {
        imageId: this.details.id,
        captureTimestamp: this.details.capture_timestamp,
      },
      bubbles: true,
      composed: true,
    }));
  }

  _renderTagsReadOnly() {
    const details = this.details;
    if (!details) return html`<div class="empty-text">No tags.</div>`;
    const machineTags = details.machine_tags_by_type || {};
    const machineTypes = Object.keys(machineTags).sort((a, b) => a.localeCompare(b));
    const tabs = ['permatags', ...machineTypes];
    const activeTab = this.tagSubTab;
    return html`
      <div class="prop-panel">
        ${renderPropertySection({
          title: 'Tag Source',
          body: html`
            <div class="tab-row">
              ${tabs.map((tab) => {
                const label = tab === 'permatags' ? 'Permatags' : this._machineTagTypeLabel(tab);
                return html`
                  <button
                    class="tab-button ${activeTab === tab ? 'active' : ''}"
                    @click=${() => this._setTagSubTab(tab)}
                  >
                    ${label}
                  </button>
                `;
              })}
            </div>
          `,
        })}
        ${renderPropertySection({
          title: activeTab === 'permatags' ? 'Permatags' : `Machine Tags: ${this._machineTagTypeLabel(activeTab)}`,
          body: activeTab === 'permatags'
            ? this._renderPermatagList(details.permatags || [])
            : this._renderMachineTagList(machineTags[activeTab] || [], activeTab),
        })}
      </div>
    `;
  }

  _renderPermatagList(permatags) {
    if (!permatags.length) {
      return html`<div class="empty-text">No permatags.</div>`;
    }
    const sorted = [...permatags].sort((a, b) => {
      if (a.signum !== b.signum) {
        return b.signum - a.signum;
      }
      return String(a.keyword || '').localeCompare(String(b.keyword || ''));
    });
    return html`
      <div class="tag-grid-table">
        <div class="tag-grid-row tag-grid-head tag-grid-row-permatag">
          <div>Keyword</div>
          <div>Category</div>
          <div>Sign</div>
          <div>Date</div>
        </div>
        ${sorted.map((tag) => {
          const isNegative = tag.signum !== 1;
          return html`
          <div class="tag-grid-row tag-grid-row-permatag ${isNegative ? 'tag-grid-row-negative' : ''}">
            <div>${tag.keyword || '--'}</div>
            <div class="tag-grid-cell-muted">${tag.category || 'Uncategorized'}</div>
            <div class="${tag.signum === 1 ? 'tag-sign-positive' : 'tag-sign-negative'}">${tag.signum === 1 ? 'positive' : 'negative'}</div>
            <div class="tag-grid-cell-muted">${this._formatDateTime(tag.created_at)}</div>
          </div>
        `;})}
      </div>
    `;
  }

  _renderMachineTagList(tags, tagType = '') {
    if (!tags.length) {
      return html`<div class="empty-text">No tags for this model.</div>`;
    }
    const sorted = [...tags].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    const categoryLabel = tagType ? this._machineTagTypeLabel(tagType) : 'Machine';
    return html`
      <div class="tag-grid-table">
        <div class="tag-grid-row tag-grid-head tag-grid-row-machine">
          <div>Keyword</div>
          <div>Category</div>
          <div>Date</div>
          <div>Conf</div>
        </div>
        ${sorted.map((tag) => html`
          <div class="tag-grid-row tag-grid-row-machine">
            <div>${tag.keyword || '--'}</div>
            <div class="tag-grid-cell-muted">${categoryLabel}</div>
            <div class="tag-grid-cell-muted">${this._formatDateTime(tag.created_at)}</div>
            <div class="tag-grid-cell-muted">${tag.confidence ?? '--'}</div>
          </div>
        `)}
      </div>
    `;
  }

  _machineTagTypeLabel(tagType = '') {
    const normalized = String(tagType || '').trim().toLowerCase();
    if (normalized === 'siglip' || normalized === 'zero_shot' || normalized === 'zero-shot') {
      return 'Zero-shot';
    }
    if (normalized === 'keyword_model' || normalized === 'trained') {
      return 'Trained';
    }
    return String(tagType || '').replace(/_/g, ' ') || 'Machine';
  }

  _renderMetadataTab() {
    const details = this.details;
    if (!details) return html`<div class="empty-text">No metadata.</div>`;
    const camera = [details.camera_make, details.camera_model].filter(Boolean).join(' ');
    const gps = (details.gps_latitude !== null && details.gps_longitude !== null)
      ? `${details.gps_latitude}, ${details.gps_longitude}`
      : 'Unknown';
    const width = Number(details.width);
    const height = Number(details.height);
    const dimensions = (Number.isFinite(width) && Number.isFinite(height))
      ? `${width} x ${height}`
      : 'Unknown';
    const fileSizeBytes = Number(details.file_size);
    const fileSize = (Number.isFinite(fileSizeBytes) && fileSizeBytes >= 0)
      ? `${this._formatVariantFileSize(fileSizeBytes)} (${fileSizeBytes.toLocaleString()} bytes)`
      : 'Unknown';
    const exifEntries = Object.entries(details.exif_data || {})
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => a.key.localeCompare(b.key));
    const exifRows = exifEntries.length
      ? exifEntries.map((entry) => ({ label: entry.key, value: String(entry.value) }))
      : [{ label: 'Status', value: 'No EXIF data.' }];

    return html`
      <div class="prop-panel">
        ${renderPropertySection({
          title: 'Core',
          rows: [
            { label: 'Filename', value: details.filename || 'Unknown' },
            { label: 'Asset ID', value: details.asset_id || 'Unknown' },
            { label: 'Source provider', value: this._formatSourceProvider(details.source_provider) },
            {
              label: 'Source path',
              value: this._getSourceHref(details)
                ? html`<a class="prop-link" href=${this._getSourceHref(details)} target="_blank" rel="noopener noreferrer">${this._getSourcePath(details) || this._getSourceHref(details)}</a>`
                : (this._getSourcePath(details) || 'Unknown'),
            },
          ],
        })}

        ${renderPropertySection({
          title: 'Timeline',
          rows: [
            { label: 'Photo taken', value: this._formatDateTime(details.capture_timestamp) },
            { label: 'Source modified', value: this._formatDateTime(details.modified_time) },
            { label: 'Ingested', value: this._formatDateTime(details.created_at) },
            { label: 'Last review', value: this._formatDateTime(details.reviewed_at) },
          ],
        })}

        ${renderPropertySection({
          title: 'File',
          rows: [
            { label: 'Media type', value: this._formatMediaType(details) },
            { label: 'Duration', value: this._formatMediaDuration(details) },
            { label: 'Dimensions', value: dimensions },
            { label: 'Format', value: details.format || 'Unknown' },
            { label: 'MIME type', value: details.mime_type || 'Unknown' },
            { label: 'File size', value: fileSize },
            { label: 'Rating', value: details.rating ?? 'Unrated' },
          ],
        })}

        ${renderPropertySection({
          title: 'Camera + EXIF',
          rows: [
            { label: 'Camera', value: camera || 'Unknown' },
            { label: 'Lens', value: details.lens_model || 'Unknown' },
            { label: 'ISO', value: details.iso || 'Unknown' },
            { label: 'Aperture', value: details.aperture ? `f/${details.aperture}` : 'Unknown' },
            { label: 'Shutter', value: details.shutter_speed || 'Unknown' },
            { label: 'Focal length', value: details.focal_length ? `${details.focal_length}mm` : 'Unknown' },
            { label: 'GPS', value: gps },
          ],
        })}

        <div class="prop-toolbar">
          <span>Re-download the file and refresh metadata.</span>
          <div class="flex items-center gap-2">
            <button
              class="px-2.5 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
              ?disabled=${this.metadataRefreshing}
              @click=${this._handleMetadataRefresh}
            >
              ${this.metadataRefreshing ? 'Refreshing...' : 'Reprocess image'}
            </button>
          </div>
        </div>

        ${renderPropertySection({
          title: 'EXIF Data',
          rows: exifRows,
          scroll: exifEntries.length > 0,
        })}
      </div>
    `;
  }

  _renderRatingControl({ showHeading = true } = {}) {
    if (!this.details) return html``;
    const canRate = Boolean(this.canCurate);
    return html`
      <div class="space-y-2">
        ${showHeading ? html`<div class="text-xs font-semibold text-gray-600 uppercase">Rating</div>` : html``}
        <div class="flex flex-wrap items-center gap-2">
          <div class="detail-rating-widget">
            ${this._ratingBurstActive ? html`
              <span class="detail-rating-burst" aria-hidden="true"></span>
            ` : html``}
            <button
              type="button"
              class="detail-rating-trash cursor-pointer mx-0.5 ${this.details.rating == 0 ? 'text-red-600' : `text-gray-600 ${canRate ? 'hover:text-gray-900' : ''}`}"
              title="0 stars"
              ?disabled=${this.ratingSaving || !canRate}
              @click=${() => (canRate ? this._handleRatingClick(0) : null)}
            >
              ${this.details.rating == 0 ? '❌' : '🗑'}
            </button>
            <span class="detail-rating-stars">
              ${[1, 2, 3].map((star) => html`
                <button
                  type="button"
                  class="cursor-pointer mx-0.5 ${this.details.rating && this.details.rating >= star ? 'text-yellow-500' : `text-gray-500 ${canRate ? 'hover:text-gray-900' : ''}`}"
                  title="${star} star${star > 1 ? 's' : ''}"
                  ?disabled=${this.ratingSaving || !canRate}
                  @click=${() => (canRate ? this._handleRatingClick(star) : null)}
                >
                  ${this.details.rating && this.details.rating >= star ? '★' : '☆'}
                </button>
              `)}
            </span>
          </div>
          ${this.ratingSaving ? html`<span class="text-xs text-gray-500">Saving...</span>` : ''}
          ${!canRate ? html`<span class="text-xs text-gray-500">Read only for your role.</span>` : ''}
        </div>
        ${this.ratingError ? html`<div class="text-xs text-red-600">${this.ratingError}</div>` : ''}
      </div>
    `;
  }

  _renderImageTab() {
    const ratingControl = this._renderRatingControl();
    if (this.fullImageLoading) {
      const provider = this._formatSourceProvider(this.details?.source_provider);
      return html`
        <div class="space-y-3">
          ${ratingControl}
          <div class="loading-indicator">
            <span class="loading-dot"></span>
            <span>Loading full-size image from ${provider}...</span>
          </div>
        </div>
      `;
    }
    if (this.fullImageError) {
      return html`
        <div class="space-y-3 text-sm text-gray-600">
          ${ratingControl}
          <div class="text-red-600">${this.fullImageError}</div>
          <button class="tag-add" @click=${() => this._loadFullImage()}>Retry</button>
        </div>
      `;
    }
    if (this.fullImageUrl) {
      const sourceHref = this._getSourceHref(this.details) || this.fullImageUrl;
      const provider = this._formatSourceProvider(this.details?.source_provider);
      return html`
        <div class="space-y-3 text-sm text-gray-600">
          ${ratingControl}
          <div>Full-size image loaded from ${provider}.</div>
          <a class="text-blue-600" href=${sourceHref} target="_blank" rel="noopener noreferrer">Open in new tab</a>
        </div>
      `;
    }
    return html`
      <div class="space-y-3 text-sm text-gray-600">
        ${ratingControl}
        <div class="empty-text">Select the Image tab to load the full-size file.</div>
      </div>
    `;
  }

  _renderTopTabs() {
    return html`
      <div class="editor-tab-strip">
        <button class="tab-button ${this.activeTab === 'edit' ? 'active' : ''}" @click=${() => this._setTab('edit')}>
          Edit
        </button>
        <button class="tab-button ${this.activeTab === 'metadata' ? 'active' : ''}" @click=${() => this._setTab('metadata')}>
          Metadata
        </button>
        <button class="tab-button ${this.activeTab === 'tags' ? 'active' : ''}" @click=${() => this._setTab('tags')}>
          Tags
        </button>
        <button class="tab-button ${this.activeTab === 'similar' ? 'active' : ''}" @click=${() => this._setTab('similar')}>
          Similar
        </button>
        <button class="tab-button ${this.activeTab === 'variants' ? 'active' : ''}" @click=${() => this._setTab('variants')}>
          Variants
        </button>
      </div>
    `;
  }

  _renderImageNavigation() {
    return html`
      <div class="image-navigation">
        <button
          class="nav-button"
          @click=${() => this._goToPreviousImage()}
          ?disabled=${this.currentImageIndex <= 0}
          title="Previous image"
        >
          ← Previous
        </button>
        <span style="display: flex; align-items: center; gap: 4px; font-size: 12px; color: #6b7280;">
          ${this.currentImageIndex >= 0 && this.imageSet?.length ? `${this.currentImageIndex + 1} / ${this.imageSet.length}` : ''}
        </span>
        <button
          class="nav-button"
          @click=${() => this._goToNextImage()}
          ?disabled=${this.currentImageIndex >= (this.imageSet?.length || 1) - 1}
          title="Next image"
        >
          Next →
        </button>
      </div>
    `;
  }

  _formatSimilarityScore(score) {
    const numericScore = Number(score);
    if (!Number.isFinite(numericScore)) return '--';
    const percent = Math.max(-100, Math.min(100, Math.round(numericScore * 100)));
    return `${percent}% match`;
  }

  _handleSimilarImageSelected(event, image) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!image?.id) return;
    const imageSet = Array.isArray(this.similarImages)
      ? [...this.similarImages]
      : [image];
    this.dispatchEvent(new CustomEvent('image-selected', {
      detail: { image, imageSet },
      bubbles: true,
      composed: true,
    }));
  }

  _handleOpenSimilarInSearch() {
    if (this.similarLoading) return;
    const images = Array.isArray(this.similarImages)
      ? this.similarImages.filter((image) => image?.id !== undefined && image?.id !== null)
      : [];
    if (!images.length) return;
    this.dispatchEvent(new CustomEvent('open-similar-in-search', {
      detail: {
        sourceImageId: this.details?.id ?? null,
        sourceAssetUuid: this.details?.asset_id || this.details?.asset_uuid || null,
        sourceImage: this.details ? { ...this.details } : null,
        images: images.map((image) => ({ ...image })),
      },
      bubbles: true,
      composed: true,
    }));
  }

  _handleOpenSimilarInCurate() {
    if (this.similarLoading) return;
    const images = Array.isArray(this.similarImages)
      ? this.similarImages.filter((image) => image?.id !== undefined && image?.id !== null)
      : [];
    if (!images.length) return;
    this.dispatchEvent(new CustomEvent('open-similar-in-curate', {
      detail: {
        sourceImageId: this.details?.id ?? null,
        sourceAssetUuid: this.details?.asset_id || this.details?.asset_uuid || null,
        sourceImage: this.details ? { ...this.details } : null,
        images: images.map((image) => ({ ...image })),
      },
      bubbles: true,
      composed: true,
    }));
  }

  _renderSimilarTab() {
    const hasError = !!this.similarError;
    const canOpenInSearch = !this.similarLoading && Array.isArray(this.similarImages) && this.similarImages.length > 0;
    const canOpenInCurate = this.canCurate && canOpenInSearch;
    const emptyMessage = this.similarLoading
      ? 'Finding similar images...'
      : hasError
        ? this.similarError
        : 'No similar images found.';
    return html`
      <div class="similar-fullscreen">
        <div class="similar-header">
          <span>Top visual matches for this image.</span>
          <div class="similar-header-actions">
            <button
              type="button"
              class="similar-open-search"
              @click=${this._handleOpenSimilarInSearch}
              ?disabled=${!canOpenInSearch}
            >
              Open in Search
            </button>
            ${this.canCurate ? html`
              <button
                type="button"
                class="similar-open-search"
                @click=${this._handleOpenSimilarInCurate}
                ?disabled=${!canOpenInCurate}
              >
                Open in Curate
              </button>
            ` : html``}
            <button
              type="button"
              class="similar-refresh"
              @click=${() => this._loadSimilarImages(true)}
              ?disabled=${this.similarLoading}
            >
              ${this.similarLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
        <div class="similar-grid-wrap">
          ${renderImageGrid({
            images: this.similarImages,
            selection: [],
            flashSelectionIds: new Set(),
            renderFunctions: {
              renderCurateRatingStatic,
              renderCuratePermatagSummary,
              formatCurateDate,
            },
            eventHandlers: {
              onImageClick: (event, image) => this._handleSimilarImageSelected(event, image),
              onDragStart: (event) => {
                event.preventDefault();
              },
            },
            options: {
              showPermatags: true,
              emptyMessage,
              renderItemFooter: (image) => html`
                <div class="similar-item-meta">
                  <span>#${image.id}</span>
                  <span>${this._formatSimilarityScore(image.similarity_score)}</span>
                </div>
                <button
                  type="button"
                  class="similar-open-button"
                  @click=${(event) => this._handleSimilarImageSelected(event, image)}
                >
                  Open
                </button>
              `,
            },
          })}
        </div>
      </div>
    `;
  }

  _renderVariantsTab() {
    const variants = this.assetVariants || [];
    const hasUploadLabel = String(this.variantUploadLabel || '').trim().length > 0;
    return html`
      <div class="variants-fullscreen">
        ${renderPropertySection({
          title: 'Add New Variant',
          body: html`
            <div class="variants-section">
              <div class="variants-header">
                <div class="text-xs text-gray-500">Upload a manually edited export for this image.</div>
                <button
                  type="button"
                  class="variants-action"
                  @click=${() => this._loadAssetVariants(true)}
                  ?disabled=${this.assetVariantsLoading}
                >
                  ${this.assetVariantsLoading ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
              ${this.canEditTags ? html`
                <div class="variants-upload">
                  <input
                    class="variants-input"
                    type="text"
                    .value=${this.variantUploadLabel}
                    placeholder="Variant label (e.g., ig-square)"
                    @input=${(event) => {
                      this.variantUploadLabel = event.target.value;
                    }}
                  />
                  <input
                    class="variants-input variant-upload-file"
                    type="file"
                    @change=${this._handleVariantFileChange}
                  />
                  <button
                    type="button"
                    class="variants-action primary"
                    ?disabled=${this.variantUploading || !hasUploadLabel}
                    @click=${this._handleVariantUpload}
                  >
                    ${this.variantUploading ? 'Uploading...' : 'Upload'}
                  </button>
                </div>
              ` : html``}
              ${this.assetVariantsError ? html`
                <div class="text-xs text-red-600">${this.assetVariantsError}</div>
              ` : html``}
            </div>
          `,
        })}

        ${renderPropertySection({
          title: 'Uploaded Variants',
          body: variants.length ? html`
            <div class="variants-list-scroll">
              <div class="variants-table">
                <div class="variants-table-header">
                  <div>Preview</div>
                  <div>Label</div>
                  <div>Filename</div>
                  <div>Metadata</div>
                  <div>Inspect</div>
                  <div>Actions</div>
                </div>
                ${variants.map((row) => {
                  const draft = this.variantDrafts[row.id] || { variant: row.variant || '', filename: row.filename || '' };
                  const saveBusy = !!this.variantRowBusy[`${row.id}:save`];
                  const deleteBusy = !!this.variantRowBusy[`${row.id}:delete`];
                  const downloadBusy = !!this.variantRowBusy[`${row.id}:download`];
                  const previewUrl = this._variantPreviewUrls[String(row.id)] || '';
                  const publicUrl = row.public_url || previewUrl || '';
                  const createdBy = row.created_by_name || '--';
                  const createdDate = this._formatVariantMetaDate(row.created_at);
                  const updatedDate = this._formatVariantMetaDate(row.updated_at);
                  const inspectState = this.variantInspectData[String(row.id)] || null;
                  const inspectBusy = !!this.variantInspectBusy[String(row.id)];
                  const fileSize = this._formatVariantFileSize(
                    inspectState?.file_size_bytes ?? row.file_size_bytes
                  );
                  const inspectedWidth = inspectState?.width;
                  const inspectedHeight = inspectState?.height;
                  const inspectDetails = inspectState
                    ? `${fileSize}${Number.isFinite(inspectedWidth) && Number.isFinite(inspectedHeight) ? ` · ${inspectedWidth} x ${inspectedHeight}` : ''}`
                    : '';
                  return html`
                    <div class="variants-row">
                      <div class="variants-cell variants-cell-preview">
                        <span class="variants-cell-key">Preview</span>
                        <div class="variant-preview-wrap">
                          <a
                            class="variant-preview-link"
                            href=${publicUrl || '#'}
                            target="_blank"
                            rel="noreferrer"
                            @click=${(event) => {
                              if (publicUrl) return;
                              event.preventDefault();
                            }}
                          >
                            <img
                              class="variant-preview"
                              style=${previewUrl ? '' : 'display:none;'}
                              src=${previewUrl || ''}
                              alt=${row.filename || 'variant preview'}
                              loading="lazy"
                              @error=${this._handleVariantPreviewError}
                            />
                            <div class="variant-preview-fallback" style=${previewUrl ? 'display:none;' : 'display:flex;'}>...</div>
                          </a>
                        </div>
                      </div>

                      <div class="variants-cell">
                        <span class="variants-cell-key">Label</span>
                        <input
                          class="variants-input variant-label-input"
                          .value=${draft.variant}
                          placeholder="Variant label"
                          @input=${(event) => this._updateVariantDraft(row.id, 'variant', event.target.value)}
                        />
                      </div>

                      <div class="variants-cell">
                        <span class="variants-cell-key">Filename</span>
                        <input
                          class="variants-input variants-filename-input"
                          .value=${draft.filename}
                          title=${draft.filename || ''}
                          placeholder="Filename"
                          @input=${(event) => this._updateVariantDraft(row.id, 'filename', event.target.value)}
                        />
                      </div>

                      <div class="variants-cell variants-cell-meta">
                        <span class="variants-cell-key">Metadata</span>
                        <div class="variants-meta-line">
                          <span class="variants-meta-label">created:</span>
                          <span>${createdDate}</span>
                        </div>
                        <div class="variants-meta-line">
                          <span class="variants-meta-label">updated:</span>
                          <span>${updatedDate}</span>
                        </div>
                        <div class="variants-meta-line">
                          <span class="variants-meta-label">created by:</span>
                          <span>${createdBy}</span>
                        </div>
                      </div>

                      <div class="variants-cell variants-cell-inspect">
                        <span class="variants-cell-key">Inspect</span>
                        <button
                          type="button"
                          class="variant-inspect-link"
                          ?disabled=${inspectBusy}
                          @click=${() => this._handleVariantInspect(row.id)}
                        >
                          ${inspectBusy ? 'Inspecting...' : inspectState ? 'Reinspect' : 'Inspect'}
                        </button>
                        ${inspectDetails ? html`<div class="variants-inspect-metrics">${inspectDetails}</div>` : html``}
                      </div>

                      <div class="variants-cell variants-cell-actions">
                        <span class="variants-cell-key">Actions</span>
                        <div class="variant-actions">
                          <button
                            type="button"
                            class="variants-action"
                            @click=${() => this._handleOpenVariant(row)}
                          >
                            Open
                          </button>
                          <button
                            type="button"
                            class="variants-action"
                            ?disabled=${downloadBusy}
                            @click=${() => this._handleDownloadVariant(row)}
                          >
                            ${downloadBusy ? 'Downloading...' : 'Download'}
                          </button>
                          ${this.canEditTags ? html`
                            <button
                              type="button"
                              class="variants-action primary"
                              ?disabled=${saveBusy}
                              @click=${() => this._handleVariantSave(row.id)}
                            >
                              ${saveBusy ? 'Saving...' : 'Save'}
                            </button>
                            <button
                              type="button"
                              class="variants-action danger"
                              ?disabled=${deleteBusy}
                              @click=${() => this._handleVariantDelete(row.id)}
                            >
                              ${deleteBusy ? 'Deleting...' : 'Delete'}
                            </button>
                          ` : html``}
                        </div>
                      </div>
                    </div>
                    ${publicUrl ? html`
                      <div class="variants-detail-row">
                        <span class="variants-detail-label">preview_url:</span>
                        <input
                          class="variant-preview-url-input"
                          type="text"
                          .value=${publicUrl}
                          readonly
                          @focus=${(event) => event.target.select()}
                          @click=${(event) => event.target.select()}
                        />
                      </div>
                    ` : html``}
                  `;
                })}
              </div>
            </div>
          ` : html`
            <div class="empty-text">${this.assetVariantsLoading ? 'Loading variants...' : 'No variants yet.'}</div>
          `,
        })}
      </div>
    `;
  }

  _renderContent() {
    if (this.loading) {
      return html`
        <div class="panel-body">
          <div class="image-wrap">
            <div class="skeleton-block skeleton-image"></div>
          </div>
          <div class="skeleton-stack">
            <div class="loading-indicator">
              <span class="loading-dot"></span>
              <span>Loading image data…</span>
            </div>
            <div class="skeleton-line skeleton-block" style="width: 120px;"></div>
            <div class="skeleton-line skeleton-block" style="width: 180px;"></div>
            <div class="skeleton-line skeleton-block sm" style="width: 90%;"></div>
            <div class="skeleton-line skeleton-block sm" style="width: 75%;"></div>
            <div class="skeleton-line skeleton-block sm" style="width: 60%;"></div>
          </div>
        </div>
      `;
    }
    if (this.error) {
      return html`<div class="empty-text">${this.error}</div>`;
    }
    if (!this.details) {
      return html`<div class="empty-text">Select an image.</div>`;
    }
    const imageSrc = this.fullImageUrl
      ? this.fullImageUrl
      : (this.details.thumbnail_url || `/api/v1/images/${this.details.id}/thumbnail`);
    const isVideoMedia = this._isVideoMedia(this.details);
    const videoDuration = isVideoMedia ? this._formatMediaDuration(this.details) : '';
    const showVideoStatus = isVideoMedia && (
      (this.videoPlaybackLoading && !this.videoPlaybackUrl)
      || !!this.videoPlaybackError
    );
    const showHighResButton = !isVideoMedia && !this.fullImageUrl && !this.fullImageLoading;
    const imageContainerClasses = `image-container ${this.isActualSize ? 'zoomed' : ''}`;
    const rightPaneContent = this.activeTab === 'metadata'
      ? this._renderMetadataTab()
      : this.activeTab === 'tags'
        ? this._renderTagsReadOnly()
        : this._renderEditTab();

    if (this.activeTab === 'variants') {
      return html`
        <div class="variants-layout">
          ${this._renderTopTabs()}
          ${this._renderVariantsTab()}
          ${this._renderImageNavigation()}
        </div>
      `;
    }
    if (this.activeTab === 'similar') {
      return html`
        <div class="variants-layout">
          ${this._renderTopTabs()}
          ${this._renderSimilarTab()}
          ${this._renderImageNavigation()}
        </div>
      `;
    }

    return html`
      ${this._renderTopTabs()}
      <div class="panel-body">
        <div class="image-wrap image-full">
          <div class="${imageContainerClasses}">
            ${isVideoMedia ? html`
              ${this.videoPlaybackUrl ? html`
                <video
                  class="image-video-player"
                  controls
                  preload="metadata"
                  ?autoplay=${false}
                  src="${this.videoPlaybackUrl}"
                  @error=${this._handleVideoPlaybackError}
                  @loadedmetadata=${this._handleVideoPlaybackLoaded}
                  @canplay=${this._handleVideoPlaybackLoaded}
                ></video>
              ` : html`
                <div class="video-loading-surface" aria-live="polite">
                  Loading video...
                </div>
              `}
            ` : html`
              <img src="${imageSrc}" alt="${this.details.filename}">
            `}
            ${isVideoMedia ? html`
              <div class="image-media-pill">
                <span>VIDEO</span>
                ${videoDuration ? html`<span class="duration">${videoDuration}</span>` : html``}
              </div>
              ${showVideoStatus ? html`
                <div class="video-playback-status" aria-live="polite">
                  ${this.videoPlaybackLoading
                    ? html`<span>Loading video…</span>`
                    : html`
                      <span>${this.videoPlaybackError || 'Playback unavailable.'}</span>
                      <button class="video-playback-retry" @click=${() => this._loadVideoPlayback({ force: true })}>
                        Retry
                      </button>
                    `}
                </div>
              ` : html``}
            ` : html``}
            ${showHighResButton ? html`
              <button class="high-res-button" @click=${this._loadFullImage}>High Res</button>
            ` : this.fullImageLoading ? html`
              <div class="high-res-loading" aria-live="polite">
                <span class="high-res-spinner" aria-hidden="true"></span>
                Loading high res…
              </div>
            ` : this.fullImageUrl ? html`
              <button class="high-res-button" @click=${() => this._openFullscreen()}>Fullscreen</button>
            ` : html``}
          </div>
        </div>
        <div class="panel-right">
          <div style="flex: 1; min-height: 0; overflow: auto;">
            ${rightPaneContent}
          </div>
        </div>
      </div>
      ${this._renderImageNavigation()}
    `;
  }

  render() {
    if (!this.image) {
      return html``;
    }
    if (this.embedded) {
      return html`
        <div class="panel embedded">
          <div class="panel-header">
            <div class="panel-title">${this.image.filename}</div>
          </div>
          ${this._renderContent()}
        </div>
      `;
    }

    const fullscreenImageSrc = this.fullImageUrl
      ? this.fullImageUrl
      : (
        this.details?.thumbnail_url
        || this.image?.thumbnail_url
        || (this.details?.id || this.image?.id ? `/api/v1/images/${this.details?.id || this.image?.id}/thumbnail` : '')
      );

    return html`
      <div class="modal ${this.open ? 'open' : ''}" @click=${this._close}>
        <div class="panel" @click=${(e) => e.stopPropagation()}>
          <div class="panel-header">
            <div class="panel-title">${this.image.filename}</div>
            <button class="panel-close" @click=${this._close}>&times;</button>
          </div>
          ${this._renderContent()}
        </div>
      </div>
      <div class="fullscreen-viewer ${this.fullscreenOpen ? 'open' : ''}" @click=${() => this._closeFullscreen()}>
        <div class="fullscreen-viewer-content ${this.fullscreenFitMode ? 'fit-mode' : ''}" @click=${(e) => e.stopPropagation()}>
          <img
            class="fullscreen-viewer-image ${this.fullscreenFitMode ? 'fit-mode' : ''}"
            src="${fullscreenImageSrc}"
            alt="${this.image.filename}"
            @click=${(e) => e.stopPropagation()}
            @load=${() => this.fullscreenFitMode && this.requestUpdate()}
            style="${this.fullscreenFitMode ? `transform: translate(-50%, -50%) scale(${this._calculateFitZoom() / 100});` : `transform: scale(${this.fullscreenZoom / 100}); transform-origin: top left;`}"
          >
        </div>
        <button class="fullscreen-close" @click=${() => this._closeFullscreen()}>×</button>
        <div class="fullscreen-controls" @click=${(e) => e.stopPropagation()}>
          <div class="fullscreen-zoom-buttons">
            <button class="fullscreen-zoom-button ${this.fullscreenFitMode ? 'active' : ''}" @click=${(e) => { e.stopPropagation(); this._setFullscreenZoom('fit'); }}>Fit</button>
            <button class="fullscreen-zoom-button ${this.fullscreenZoom === 50 && !this.fullscreenFitMode ? 'active' : ''}" @click=${(e) => { e.stopPropagation(); this._setFullscreenZoom(50); }}>50%</button>
            <button class="fullscreen-zoom-button ${this.fullscreenZoom === 75 && !this.fullscreenFitMode ? 'active' : ''}" @click=${(e) => { e.stopPropagation(); this._setFullscreenZoom(75); }}>75%</button>
            <button class="fullscreen-zoom-button ${this.fullscreenZoom === 100 && !this.fullscreenFitMode ? 'active' : ''}" @click=${(e) => { e.stopPropagation(); this._setFullscreenZoom(100); }}>100%</button>
          </div>
          <span style="color: rgba(255, 255, 255, 0.6);">•</span>
          <span style="font-size: 11px; color: rgba(255, 255, 255, 0.7); cursor: pointer;" @click=${(e) => { e.stopPropagation(); this._closeFullscreen(); }}>Scroll to pan • Click to close</span>
        </div>
      </div>
    `;
  }
}

customElements.define('image-editor', ImageEditor);
