import { LitElement, html, css } from 'lit';
import {
  getImageDetails,
  getKeywords,
  addPermatag,
  getFullImage,
  setRating,
  refreshImageMetadata,
  propagateDropboxTags,
  listAssetVariants,
  uploadAssetVariant,
  updateAssetVariant,
  deleteAssetVariant,
  getAssetVariantContent,
  inspectAssetVariant,
} from '../services/api.js';
import { tailwind } from './tailwind-lit.js';
import { propertyGridStyles, renderPropertyRows, renderPropertySection } from './shared/widgets/property-grid.js';
import './shared/widgets/keyword-dropdown.js';

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
    .image-wrap.image-full img {
      width: 100%;
      height: 100%;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
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
    this._fullImageAbortController = null;
    this._fullImageLoadTimer = null;
    this._fullImageLoadDelayMs = 0;
    this._fullImageRapidDelayMs = 120;
    this._fullImageRapidThresholdMs = 200;
    this._fullImageLastNavTs = 0;
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
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('permatags-changed', this._handlePermatagEvent);
  }

  disconnectedCallback() {
    window.removeEventListener('permatags-changed', this._handlePermatagEvent);
    this._revokeVariantPreviewUrls();
    this._resetFullImage();
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
      this._resetFullImage();
      this._resetVariantEditor();
      this.fetchDetails();
      this.fetchKeywords();
    }
    if (changedProperties.has('details')) {
      this._syncTagSubTab();
      this._scheduleFullImageLoad();
      if (this.activeTab === 'variants') {
        this._loadAssetVariants();
      }
    }
    if (changedProperties.has('open') && !this.open && !this.embedded) {
      this._resetFullImage();
    }
  }

  async fetchDetails() {
    if (!this.image || !this.tenant) return;
    this.loading = true;
    this.error = '';
    try {
      this.details = await getImageDetails(this.tenant, this.image.id);
    } catch (error) {
      this.error = 'Failed to load image details.';
      console.error('ImageEditor: fetchDetails failed', error);
    } finally {
      this.loading = false;
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
    } catch (error) {
      console.error('ImageEditor: fetchKeywords failed', error);
      this.keywordsByCategory = {};
    }
  }

  _close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  _setTab(tab) {
    this.activeTab = tab;
    if (tab === 'image') {
      this._loadFullImage();
    } else if (tab === 'variants') {
      this._loadAssetVariants();
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
    if (!this.canEditTags || !this.details?.id || !this.tenant || !this._variantUploadFile) return;
    this.variantUploading = true;
    this.assetVariantsError = '';
    try {
      await uploadAssetVariant(this.tenant, this.details.id, {
        file: this._variantUploadFile,
        variant: this.variantUploadLabel,
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
    if (!this.details || !this.tenant || this.ratingSaving) return;
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

  _scheduleFullImageLoad() {
    if (!this.details || !this.tenant) return;
    if (!this.open && !this.embedded) return;
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

  async _handleAddTag() {
    if (!this.details) return;
    const keyword = this.tagInput.trim();
    if (!keyword) return;
    const keywordMap = this._keywordIndex();
    const category = this.tagCategory || keywordMap[keyword] || 'Uncategorized';
    try {
      await addPermatag(this.tenant, this.details.id, keyword, category, 1);
      const existing = Array.isArray(this.details.permatags) ? this.details.permatags : [];
      const nextPermatags = [
        ...existing,
        { keyword, category, signum: 1 },
      ];
      this.details = { ...this.details, permatags: nextPermatags };
      this.tagInput = '';
      this.tagCategory = '';
      this._suppressPermatagRefresh = true;
      this.dispatchEvent(new CustomEvent('permatags-changed', {
        detail: { imageId: this.details.id, source: 'image-editor' },
        bubbles: true,
        composed: true,
      }));
    } catch (error) {
      this.error = 'Failed to add tag.';
      console.error('ImageEditor: add tag failed', error);
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

  _buildDropboxHref(path) {
    if (!path) return '';
    const encodedPath = path.split('/').map((part) => encodeURIComponent(part)).join('/');
    return `https://www.dropbox.com/home${encodedPath}`;
  }

  _renderEditTab() {
    const permatags = (this.details?.permatags || []).filter((tag) => tag.signum === 1);
    const categories = Object.keys(this.keywordsByCategory || {}).sort((a, b) => a.localeCompare(b));
    const keywordMap = this._keywordIndex();
    const selectedCategory = this.tagCategory || (this.tagInput ? keywordMap[this.tagInput] : '') || 'Uncategorized';
    const selectedValue = this.tagInput
      ? `${encodeURIComponent(selectedCategory)}::${encodeURIComponent(this.tagInput)}`
      : '';
    const dropboxPath = this.details?.dropbox_path || '';
    const dropboxHref = this._buildDropboxHref(dropboxPath);
    const flatKeywords = categories.flatMap((category) => (
      (this.keywordsByCategory?.[category] || [])
        .filter((entry) => entry.keyword)
        .map((entry) => ({
          keyword: entry.keyword,
          category,
          count: entry.count || 0,
        }))
    ));
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
              label: 'Dropbox',
              value: dropboxHref
                ? html`<a class="prop-link" href=${dropboxHref} target="dropbox" rel="noopener noreferrer">${dropboxPath}</a>`
                : 'Unknown',
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

        ${this.canEditTags ? renderPropertySection({
          title: 'Tag Actions',
          body: html`
            <div class="edit-action-row">
              <span>Write tags to Dropbox</span>
              <button
                class="text-xs text-blue-600 hover:text-blue-700"
                ?disabled=${this.tagsPropagating}
                @click=${this._handlePropagateDropboxTags}
                title="Write GMM tags to Dropbox for this image"
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
            { label: 'Dropbox ID', value: details.dropbox_id || 'Unknown' },
            {
              label: 'Dropbox path',
              value: details.dropbox_path
                ? html`<a class="prop-link" href=${this._buildDropboxHref(details.dropbox_path)} target="dropbox" rel="noopener noreferrer">${details.dropbox_path}</a>`
                : 'Unknown',
            },
          ],
        })}

        ${renderPropertySection({
          title: 'Timeline',
          rows: [
            { label: 'Photo taken', value: this._formatDateTime(details.capture_timestamp) },
            { label: 'Dropbox modified', value: this._formatDateTime(details.modified_time) },
            { label: 'Ingested', value: this._formatDateTime(details.created_at) },
            { label: 'Last review', value: this._formatDateTime(details.reviewed_at) },
          ],
        })}

        ${renderPropertySection({
          title: 'File',
          rows: [
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
              class="detail-rating-trash cursor-pointer mx-0.5 ${this.details.rating == 0 ? 'text-red-600' : 'text-gray-600 hover:text-gray-900'}"
              title="0 stars"
              ?disabled=${this.ratingSaving}
              @click=${() => this._handleRatingClick(0)}
            >
              ${this.details.rating == 0 ? '❌' : '🗑'}
            </button>
            <span class="detail-rating-stars">
              ${[1, 2, 3].map((star) => html`
                <button
                  type="button"
                  class="cursor-pointer mx-0.5 ${this.details.rating && this.details.rating >= star ? 'text-yellow-500' : 'text-gray-500 hover:text-gray-900'}"
                  title="${star} star${star > 1 ? 's' : ''}"
                  ?disabled=${this.ratingSaving}
                  @click=${() => this._handleRatingClick(star)}
                >
                  ${this.details.rating && this.details.rating >= star ? '★' : '☆'}
                </button>
              `)}
            </span>
          </div>
          ${this.ratingSaving ? html`<span class="text-xs text-gray-500">Saving...</span>` : ''}
        </div>
        ${this.ratingError ? html`<div class="text-xs text-red-600">${this.ratingError}</div>` : ''}
      </div>
    `;
  }

  _renderImageTab() {
    const ratingControl = this._renderRatingControl();
    if (this.fullImageLoading) {
      return html`
        <div class="space-y-3">
          ${ratingControl}
          <div class="loading-indicator">
            <span class="loading-dot"></span>
            <span>Loading full-size image from Dropbox...</span>
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
      const dropboxPath = this.details?.dropbox_path;
      const dropboxHref = dropboxPath
        ? `https://www.dropbox.com/home${encodeURIComponent(dropboxPath)}`
        : this.fullImageUrl;
      return html`
        <div class="space-y-3 text-sm text-gray-600">
          ${ratingControl}
          <div>Full-size image loaded from Dropbox.</div>
          <a class="text-blue-600" href=${dropboxHref} target="dropbox" rel="noopener noreferrer">Open in new tab</a>
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

  _renderVariantsTab() {
    const variants = this.assetVariants || [];
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
                    ?disabled=${this.variantUploading || !this._variantUploadFile}
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
    const showHighResButton = !this.fullImageUrl && !this.fullImageLoading;
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

    return html`
      ${this._renderTopTabs()}
      <div class="panel-body">
        <div class="image-wrap image-full">
          <div class="${imageContainerClasses}">
            <img src="${imageSrc}" alt="${this.details.filename}">
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
          <div class="mt-3" style="flex: 1; min-height: 0; overflow: auto;">
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
