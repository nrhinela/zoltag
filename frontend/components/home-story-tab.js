import { LitElement, html } from 'lit';

const HERO_IMAGE = new URL('../assets/chaos-to-organized.png', import.meta.url).href;

export class HomeStoryTab extends LitElement {
  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div class="w-full max-w-6xl mx-auto px-6 space-y-10">
        <section class="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
            <div>
              <h1 class="text-3xl sm:text-4xl font-semibold text-gray-900 mt-2">
                Make the most of your photo library.
              </h1>
              <p class="text-base text-gray-600 mt-3 max-w-2xl">
                We'll help you wrestle your unorganized photo library into submission. Bulk tagging tools work seamlessly
                with machine learning models to rapidly categorize your files. Once organized, you can easily retrieve
                images by keyword, filter, or natural language.
              </p>
            </div>
            <figure class="w-full flex justify-center lg:justify-end">
              <img
                src=${HERO_IMAGE}
                alt="Illustration showing a chaotic workspace becoming organized"
                class="w-full max-w-[360px] rounded-2xl border border-gray-200 shadow-sm"
                loading="lazy"
              >
            </figure>
          </div>
        </section>

        <section class="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
            <div class="border border-gray-100 rounded-xl p-4 bg-gray-50 h-full flex items-center justify-center relative">
              <div class="absolute top-3 left-4 text-xs font-semibold uppercase tracking-widest text-gray-500">Setup</div>
              <svg class="w-full max-w-[240px]" viewBox="0 0 240 200" role="img" aria-label="Setup diagram">
                <rect x="34" y="24" width="172" height="44" rx="12" fill="#ffffff" stroke="#cbd5f5"></rect>
                <text x="120" y="52" text-anchor="middle" font-size="13" fill="#1f2937" font-weight="600">Authorize users</text>
                <rect x="34" y="78" width="172" height="44" rx="12" fill="#ffffff" stroke="#cbd5f5"></rect>
                <text x="120" y="106" text-anchor="middle" font-size="13" fill="#1f2937" font-weight="600">Connect Dropbox</text>
                <rect x="34" y="132" width="172" height="44" rx="12" fill="#ffffff" stroke="#cbd5f5"></rect>
                <text x="120" y="160" text-anchor="middle" font-size="13" fill="#1f2937" font-weight="600">Define keywords</text>
                <line x1="120" y1="68" x2="120" y2="78" stroke="#94a3b8" stroke-width="2"></line>
                <line x1="120" y1="122" x2="120" y2="132" stroke="#94a3b8" stroke-width="2"></line>
              </svg>
            </div>

            <div class="border border-blue-100 rounded-xl p-4 bg-blue-50 h-full flex items-center justify-center relative">
              <div class="absolute top-3 left-4 text-xs font-semibold uppercase tracking-widest text-gray-500">Curate</div>
              <svg class="w-full max-w-[260px]" viewBox="0 0 260 260" role="img" aria-label="Human and ML virtuous cycle">
                <defs>
                  <marker id="cycleArrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
                    <path d="M0,0 L0,8 L8,4 z" fill="#2563eb"></path>
                  </marker>
                </defs>
                <circle cx="130" cy="130" r="92" fill="#ffffff" stroke="#93c5fd" stroke-width="3"></circle>
                <path d="M130 38 A92 92 0 0 1 222 130" fill="none" stroke="#2563eb" stroke-width="3" marker-end="url(#cycleArrow)"></path>
                <path d="M222 130 A92 92 0 0 1 130 222" fill="none" stroke="#2563eb" stroke-width="3" marker-end="url(#cycleArrow)"></path>
                <path d="M130 222 A92 92 0 0 1 38 130" fill="none" stroke="#2563eb" stroke-width="3" marker-end="url(#cycleArrow)"></path>
                <path d="M38 130 A92 92 0 0 1 130 38" fill="none" stroke="#2563eb" stroke-width="3" marker-end="url(#cycleArrow)"></path>
                <text x="130" y="112" text-anchor="middle" font-size="13" font-weight="600" fill="#1f2937">Human tags</text>
                <text x="130" y="132" text-anchor="middle" font-size="12" fill="#475569">bulk tagging tools</text>
                <text x="130" y="168" text-anchor="middle" font-size="13" font-weight="600" fill="#1f2937">ML suggestions</text>
                <text x="130" y="188" text-anchor="middle" font-size="12" fill="#475569">improve over time</text>
              </svg>
            </div>

            <div class="border border-gray-100 rounded-xl p-4 bg-gray-50 h-full flex items-center justify-center relative">
              <div class="absolute top-3 left-4 text-xs font-semibold uppercase tracking-widest text-gray-500">Search</div>
              <svg class="w-full max-w-[240px]" viewBox="0 0 240 200" role="img" aria-label="Search diagram">
                <rect x="34" y="24" width="172" height="44" rx="12" fill="#ffffff" stroke="#cbd5f5"></rect>
                <text x="120" y="52" text-anchor="middle" font-size="13" fill="#1f2937" font-weight="600">Search + filter</text>
                <rect x="34" y="78" width="172" height="44" rx="12" fill="#ffffff" stroke="#cbd5f5"></rect>
                <text x="120" y="106" text-anchor="middle" font-size="13" fill="#1f2937" font-weight="600">Build lists</text>
                <rect x="34" y="132" width="172" height="44" rx="12" fill="#ffffff" stroke="#cbd5f5"></rect>
                <text x="120" y="160" text-anchor="middle" font-size="13" fill="#1f2937" font-weight="600">Sync to Dropbox</text>
                <line x1="120" y1="68" x2="120" y2="78" stroke="#94a3b8" stroke-width="2"></line>
                <line x1="120" y1="122" x2="120" y2="132" stroke="#94a3b8" stroke-width="2"></line>
              </svg>
            </div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6 items-stretch">
            <div class="border border-gray-100 rounded-xl p-4 bg-gray-50 h-full">
              <ul class="mt-3 space-y-2 text-sm text-gray-600">
                <li class="flex gap-2"><span class="text-blue-600">●</span>Connect Dropbox and import your files automatically.</li>
                <li class="flex gap-2"><span class="text-blue-600">●</span>Authorize users.</li>
                <li class="flex gap-2"><span class="text-blue-600">●</span>Define keywords and categories.</li>
              </ul>
            </div>

            <div class="border border-blue-100 rounded-xl p-4 bg-blue-50 h-full">
              <ul class="mt-3 space-y-2 text-sm text-gray-600">
                <li class="flex gap-2"><span class="text-blue-600">●</span>ML models start suggesting tags immediately.</li>
                <li class="flex gap-2"><span class="text-blue-600">●</span>Use bulk taggers to verify quickly and at scale.</li>
                <li class="flex gap-2"><span class="text-blue-600">●</span>Verified tags make the models smarter over time.</li>
                <li class="flex gap-2"><span class="text-blue-600">●</span>Define the keywords, categories, and ratings that matter to you.</li>
              </ul>
            </div>

            <div class="border border-gray-100 rounded-xl p-4 bg-gray-50 h-full">
              <ul class="mt-3 space-y-2 text-sm text-gray-600">
                <li class="flex gap-2"><span class="text-blue-600">●</span>Search curated content easily with natural language or filters.</li>
                <li class="flex gap-2"><span class="text-blue-600">●</span>Create unlimited lists, then download or share.</li>
                <li class="flex gap-2"><span class="text-blue-600">●</span>Visualize topic density to spot gaps and opportunities.</li>
                <li class="flex gap-2"><span class="text-blue-600">●</span>Write tags back to Dropbox.</li>
              </ul>
            </div>
          </div>
        </section>

      </div>
    `;
  }
}

customElements.define('home-story-tab', HomeStoryTab);
