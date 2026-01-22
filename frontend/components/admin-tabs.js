import { LitElement, html, css } from 'lit';

/**
 * Admin Tabs Component
 * Reusable tab navigation for admin pages
 */
export class AdminTabs extends LitElement {
  static properties = {
    tabs: { type: Array },
    activeTab: { type: String }
  };

  static styles = css`
    :host {
      display: block;
    }

    .tabs {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
      border-bottom: 2px solid #ddd;
    }

    .tab {
      padding: 12px 24px;
      background: white;
      border: 1px solid #ddd;
      border-bottom: none;
      border-radius: 8px 8px 0 0;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      color: #666;
      transition: all 0.2s;
    }

    .tab:hover {
      background: #f8f9fa;
      color: #333;
    }

    .tab.active {
      background: white;
      color: #007bff;
      border-color: #007bff;
      position: relative;
      bottom: -2px;
    }
  `;

  constructor() {
    super();
    this.tabs = [];
    this.activeTab = null;
  }

  handleTabClick(tabId) {
    this.activeTab = tabId;
    this.dispatchEvent(
      new CustomEvent('tab-changed', {
        detail: { tabId },
        bubbles: true,
        composed: true
      })
    );
  }

  render() {
    return html`
      <div class="tabs">
        ${this.tabs.map(
          tab =>
            html`<div
              class="tab ${this.activeTab === tab.id ? 'active' : ''}"
              @click="${() => this.handleTabClick(tab.id)}"
            >
              ${tab.label}
            </div>`
        )}
      </div>
    `;
  }
}

customElements.define('admin-tabs', AdminTabs);
