import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';

class TabContainer extends LitElement {
  static styles = [tailwind, css`
    :host {
      display: block;
    }
  `];

  static properties = {
    activeTab: { type: String, attribute: 'active-tab' },
  };

  constructor() {
    super();
    this.activeTab = 'search'; // Default active tab
  }

  render() {
    return html`
      <div class="p-4">
        ${this.activeTab === 'search' ? html`<slot name="search"></slot>` : ''}
        ${this.activeTab === 'lists' ? html`<slot name="lists"></slot>` : ''}
        <!-- Future tabs will go here -->
      </div>
    `;
  }
}

customElements.define('tab-container', TabContainer);
