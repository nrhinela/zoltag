import { LitElement, html } from 'lit';
import { tailwind } from './tailwind-lit.js';
import './home-story-tab.js';

export class PublicStoryPage extends LitElement {
  static styles = [tailwind];

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div class="min-h-screen bg-gray-50">
        <header class="bg-gray-50">
          <div class="w-full max-w-6xl mx-auto px-6 pt-4">
            <div class="flex items-center gap-4 px-6 py-4 bg-white border border-gray-200 rounded-2xl">
              <div class="flex items-center gap-3 text-lg font-semibold text-gray-900">
                <svg class="h-9 w-9" viewBox="0 0 48 48" role="img" aria-label="PhotoCat logo">
                  <defs>
                    <linearGradient id="photocatLogo" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stop-color="#2563eb"></stop>
                      <stop offset="100%" stop-color="#1d4ed8"></stop>
                    </linearGradient>
                  </defs>
                  <rect x="4" y="8" width="40" height="36" rx="10" fill="url(#photocatLogo)"></rect>
                  <path d="M14 10 L22 4 L24 10" fill="#1d4ed8"></path>
                  <path d="M34 10 L26 4 L24 10" fill="#1d4ed8"></path>
                  <circle cx="18" cy="26" r="3" fill="#ffffff"></circle>
                  <circle cx="30" cy="26" r="3" fill="#ffffff"></circle>
                  <path d="M18 32 C21 35 27 35 30 32" stroke="#ffffff" stroke-width="2" fill="none" stroke-linecap="round"></path>
                </svg>
                <span>PhotoCat</span>
              </div>
              <div class="ml-auto flex items-center gap-3 text-sm">
                <a href="/login" class="text-gray-600 hover:text-gray-900">Log in</a>
                <a href="/signup" class="px-3 py-1.5 rounded-full bg-blue-600 text-white hover:bg-blue-700">Register</a>
              </div>
            </div>
          </div>
        </header>
        <main class="py-6">
          <home-story-tab class="block"></home-story-tab>
        </main>
      </div>
    `;
  }
}

customElements.define('public-story-page', PublicStoryPage);
