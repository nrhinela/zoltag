import { LitElement, html } from 'lit';

const HERO_IMAGE = new URL('../assets/chaos-to-organized.png', import.meta.url).href;

const SLIDES = [
  {
    eyebrow: 'Zoltag',
    title: 'Organize your media. Fast.',
    subtitle:
      'AI-assisted tagging and search for photo and video libraries, built for teams.',
    bullets: [
      'Works with your existing provider setup',
      'Designed for high-volume curation workflows',
      'Built-in tenant controls and admin tooling',
    ],
    cta: 'Get started',
    visual: 'hero',
  },
  {
    eyebrow: 'How It Works · Step 1',
    title: 'Connect Dropbox. Define your categories.',
    subtitle:
      'Start by connecting storage and setting the keyword structure your team actually uses.',
    bullets: [
      'Connect Dropbox once for the tenant',
      'Pick sync folders and provider defaults',
      'Define categories and reusable tag vocabulary',
    ],
    visual: 'setup',
  },
  {
    eyebrow: 'How It Works · Step 2',
    title: 'Tag at scale with hotspots.',
    subtitle:
      'Bulk-tag large result sets with drag-and-drop hotspots so your team can move fast.',
    bullets: [
      'Multi-select images and drop onto hotspot actions',
      'Apply tags and ratings in batches',
      'Keep momentum with persistent hotspot history',
    ],
    visual: 'hotspots',
  },
  {
    eyebrow: 'How It Works · Step 3',
    title: 'Use AI for suggestions.',
    subtitle:
      'Machine suggestions accelerate review while humans stay in control of final tags.',
    bullets: [
      'AI proposes likely labels',
      'Editors verify and correct quickly',
      'Higher quality metadata over time',
    ],
    visual: 'ai',
  },
  {
    eyebrow: 'How It Works · Step 4',
    title: 'Search and find the perfect content.',
    subtitle:
      'Filter by media type, tags, ratings, time, and more to locate the right asset in seconds.',
    bullets: [
      'Powerful filters and keyword search',
      'Natural-language style discovery paths',
      'Build curated lists for downstream use',
    ],
    visual: 'search',
  },
  {
    eyebrow: 'Outcomes',
    title: 'Search less. Create more.',
    subtitle:
      'Zoltag turns scattered media into reusable content operations for your whole team.',
    bullets: [
      'Faster discovery and delivery',
      'Consistent metadata quality',
      'Higher reuse of existing assets',
    ],
    cta: 'Book a demo',
    visual: 'outcomes',
  },
];

export class HomeStoryTab extends LitElement {
  static properties = {
    currentSlide: { type: Number },
  };

  constructor() {
    super();
    this.currentSlide = 0;
  }

  createRenderRoot() {
    return this;
  }

  _goNext() {
    this.currentSlide = (this.currentSlide + 1) % SLIDES.length;
  }

  _goPrev() {
    this.currentSlide = (this.currentSlide - 1 + SLIDES.length) % SLIDES.length;
  }

  _goToSlide(index) {
    const numeric = Number(index);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric >= SLIDES.length) return;
    this.currentSlide = numeric;
  }

  _renderVisual(type) {
    if (type === 'hero') {
      return html`
        <div class="relative w-full h-full rounded-2xl overflow-hidden border border-blue-100 bg-blue-50">
          <img
            src=${HERO_IMAGE}
            alt="Illustration showing media organization from chaos to structure"
            class="w-full h-full object-cover"
            loading="lazy"
          >
          <div class="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/70 to-transparent">
            <div class="text-white text-sm font-semibold">From library chaos to structured content.</div>
          </div>
        </div>
      `;
    }

    if (type === 'setup') {
      return html`
        <div class="w-full h-full rounded-2xl border border-slate-200 bg-slate-50 p-5 flex items-center justify-center">
          <svg class="w-full max-w-[360px]" viewBox="0 0 380 260" role="img" aria-label="Setup flow diagram">
            <rect x="36" y="20" width="308" height="56" rx="14" fill="#ffffff" stroke="#cbd5e1"></rect>
            <text x="190" y="54" text-anchor="middle" font-size="15" fill="#0f172a" font-weight="600">Connect Dropbox</text>
            <rect x="36" y="102" width="308" height="56" rx="14" fill="#ffffff" stroke="#cbd5e1"></rect>
            <text x="190" y="136" text-anchor="middle" font-size="15" fill="#0f172a" font-weight="600">Choose Sync Folders</text>
            <rect x="36" y="184" width="308" height="56" rx="14" fill="#ffffff" stroke="#93c5fd"></rect>
            <text x="190" y="218" text-anchor="middle" font-size="15" fill="#1e3a8a" font-weight="700">Define Categories + Keywords</text>
            <line x1="190" y1="76" x2="190" y2="102" stroke="#64748b" stroke-width="2.4"></line>
            <line x1="190" y1="158" x2="190" y2="184" stroke="#64748b" stroke-width="2.4"></line>
          </svg>
        </div>
      `;
    }

    if (type === 'hotspots') {
      return html`
        <div class="w-full h-full rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <div class="grid grid-cols-3 gap-3">
            ${[1, 2, 3, 4, 5, 6].map((i) => html`
              <div class="aspect-square rounded-xl bg-white border border-slate-200 shadow-sm relative">
                <div class="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/55 to-transparent text-white text-[10px] font-semibold">
                  IMG ${i}
                </div>
              </div>
            `)}
          </div>
          <div class="mt-4 grid grid-cols-3 gap-2">
            <div class="rounded-lg bg-blue-600 text-white text-xs font-semibold px-3 py-2 text-center">Tag: Performer</div>
            <div class="rounded-lg bg-slate-800 text-white text-xs font-semibold px-3 py-2 text-center">Tag: Aerial</div>
            <div class="rounded-lg bg-emerald-600 text-white text-xs font-semibold px-3 py-2 text-center">Rating: 3★</div>
          </div>
        </div>
      `;
    }

    if (type === 'ai') {
      return html`
        <div class="w-full h-full rounded-2xl border border-blue-100 bg-blue-50 p-5 flex items-center justify-center">
          <svg class="w-full max-w-[360px]" viewBox="0 0 360 260" role="img" aria-label="AI suggestion cycle diagram">
            <defs>
              <marker id="zoltagCycleArrow" markerWidth="9" markerHeight="9" refX="4.5" refY="4.5" orient="auto">
                <path d="M0,0 L0,9 L9,4.5 z" fill="#2563eb"></path>
              </marker>
            </defs>
            <circle cx="180" cy="130" r="98" fill="#ffffff" stroke="#93c5fd" stroke-width="3"></circle>
            <path d="M180 32 A98 98 0 0 1 278 130" fill="none" stroke="#2563eb" stroke-width="3" marker-end="url(#zoltagCycleArrow)"></path>
            <path d="M278 130 A98 98 0 0 1 180 228" fill="none" stroke="#2563eb" stroke-width="3" marker-end="url(#zoltagCycleArrow)"></path>
            <path d="M180 228 A98 98 0 0 1 82 130" fill="none" stroke="#2563eb" stroke-width="3" marker-end="url(#zoltagCycleArrow)"></path>
            <path d="M82 130 A98 98 0 0 1 180 32" fill="none" stroke="#2563eb" stroke-width="3" marker-end="url(#zoltagCycleArrow)"></path>
            <text x="180" y="98" text-anchor="middle" font-size="15" font-weight="700" fill="#0f172a">AI Suggests</text>
            <text x="180" y="120" text-anchor="middle" font-size="13" fill="#334155">Likely tags + confidence</text>
            <text x="180" y="154" text-anchor="middle" font-size="15" font-weight="700" fill="#0f172a">Humans Confirm</text>
            <text x="180" y="176" text-anchor="middle" font-size="13" fill="#334155">Fast, controlled review</text>
          </svg>
        </div>
      `;
    }

    if (type === 'search') {
      return html`
        <div class="w-full h-full rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-3">
          <div class="rounded-xl bg-white border border-slate-200 p-3 flex items-center justify-between gap-2">
            <span class="text-sm text-slate-500">Search by keyword, category, person, or date…</span>
            <span class="px-2 py-1 rounded-md bg-blue-600 text-white text-xs font-semibold">Search</span>
          </div>
          <div class="flex flex-wrap gap-2">
            ${['Media: Video', 'Rating: 2+ stars', 'Category: Aerial', 'Date: This month'].map((chip) => html`
              <span class="px-2.5 py-1 rounded-full bg-white border border-slate-300 text-xs text-slate-700">${chip}</span>
            `)}
          </div>
          <div class="grid grid-cols-4 gap-2 pt-1">
            ${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => html`
              <div class="h-14 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-[11px] text-slate-400">#${n}</div>
            `)}
          </div>
        </div>
      `;
    }

    return html`
      <div class="w-full h-full rounded-2xl border border-emerald-100 bg-emerald-50 p-5">
        <div class="grid grid-cols-1 gap-3">
          ${[
            'Find the right asset quickly',
            'Standardize metadata quality',
            'Ship curated content faster',
          ].map((item) => html`
            <div class="rounded-xl bg-white border border-emerald-100 p-3 flex items-center gap-3">
              <span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <span class="text-sm text-slate-700">${item}</span>
            </div>
          `)}
        </div>
      </div>
    `;
  }

  render() {
    const slide = SLIDES[this.currentSlide];
    return html`
      <div class="w-full max-w-6xl mx-auto px-6">
        <section class="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div class="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] min-h-[560px]">
            <div class="p-7 sm:p-9 flex flex-col">
              <div class="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">${slide.eyebrow}</div>
              <h1 class="text-3xl sm:text-4xl font-semibold text-slate-900 mt-3 leading-tight">${slide.title}</h1>
              <p class="text-base text-slate-600 mt-4 max-w-2xl">${slide.subtitle}</p>

              <ul class="mt-6 space-y-3">
                ${slide.bullets.map((bullet) => html`
                  <li class="flex gap-3 text-slate-700">
                    <span class="mt-1.5 w-2.5 h-2.5 rounded-full bg-blue-600 flex-shrink-0"></span>
                    <span class="text-sm sm:text-base">${bullet}</span>
                  </li>
                `)}
              </ul>

              <div class="mt-auto pt-8 flex flex-wrap items-center gap-3">
                ${slide.cta ? html`
                  <a
                    href="/signup"
                    class="inline-flex items-center px-4 py-2 rounded-full bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
                  >${slide.cta}</a>
                ` : html``}
                <a
                  href="/login"
                  class="inline-flex items-center px-4 py-2 rounded-full border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50"
                >Log in</a>
              </div>
            </div>

            <div class="bg-gradient-to-br from-slate-50 to-blue-50 p-6 sm:p-8">
              <div class="h-full min-h-[280px]">${this._renderVisual(slide.visual)}</div>
            </div>
          </div>
        </section>

        <section class="mt-5 bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm">
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50"
              @click=${this._goPrev}
            >Previous</button>

            <div class="mx-1 flex items-center gap-2 flex-1 justify-center">
              ${SLIDES.map((item, idx) => {
                const active = idx === this.currentSlide;
                return html`
                  <button
                    type="button"
                    class="h-2.5 rounded-full transition-all ${active ? 'w-9 bg-blue-600' : 'w-2.5 bg-slate-300 hover:bg-slate-400'}"
                    aria-label=${`Go to slide ${idx + 1}: ${item.title}`}
                    @click=${() => this._goToSlide(idx)}
                  ></button>
                `;
              })}
            </div>

            <div class="text-xs text-slate-500 font-medium tabular-nums">
              ${this.currentSlide + 1} / ${SLIDES.length}
            </div>

            <button
              type="button"
              class="ml-3 px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50"
              @click=${this._goNext}
            >Next</button>
          </div>
        </section>
      </div>
    `;
  }
}

customElements.define('home-story-tab', HomeStoryTab);
