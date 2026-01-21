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
    this.activeTab = 'home'; // Default active tab
  }

  render() {
    return html`
      <div class="p-4">
        ${this.activeTab === 'home' ? html`<slot name="home"></slot>` : ''}
        ${this.activeTab === 'curate' ? html`<slot name="curate"></slot>` : ''}
        ${this.activeTab === 'search' ? html`<slot name="search"></slot>` : ''}
        ${this.activeTab === 'lists' ? html`<slot name="lists"></slot>` : ''}
        ${this.activeTab === 'tagging' ? html`<slot name="tagging"></slot>` : ''}
        ${this.activeTab === 'ml-training' ? html`<slot name="ml-training"></slot>` : ''}
        ${this.activeTab === 'queue' ? html`<slot name="queue"></slot>` : ''}
      </div>
    `;
  }
}

customElements.define('tab-container', TabContainer);
