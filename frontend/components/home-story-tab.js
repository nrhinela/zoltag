import { LitElement, html } from 'lit';

const HERO_IMAGE = new URL('../assets/chaos-to-organized.png', import.meta.url).href;

const SLIDES = [
  {
    eyebrow: 'For Creative Teams',
    title: 'Organize your media',
    subtitle:
      'Zoltag turns scattered photos and videos into a library you can use.',
    bullets: [
      'Find the perfect photo or video in seconds',
      'Easily search across all your photo and video storage systems',
      'Find, share and collaborate seamlessly',
    ],
    cta: 'Get started',
    visual: 'hero',
  },
  {
    eyebrow: 'Sync',
    title: 'Easy Integration',
    subtitle:
      'One-click integration to your storage providers.',
    bullets: [
      'Sync Dropbox, Drive, YouTube, Photos, and Flickr',
      'Fine grained access controls keep your photos secure',
      'Identify duplicates, calculate total storage requirements',
    ],
    visual: 'setup',
  },
  {
    eyebrow: 'Curation',
    title: 'Addictive Organization',
    subtitle:
      'Intuitive drag-and-drop workflows and smart AI suggestion let you move quickly while staying in control.',
    bullets: [
      'Define and refine the keywords and categories that meet your needs',
      'Advanced search across all your photo and video storage systems',
      'Find, share and collaborate seamlessly',
    ],
    visual: 'curation',
  },
  {
    eyebrow: 'Find',
    title: 'Find the perfect photo or video',
    subtitle:
      'Search by what you know and surface usable results in seconds.',
    bullets: [
      'Create and share proofing lists with clients and users',
      'Download originals or thumbnails',
      'Save modifications back to the library for reuse',
    ],
    visual: 'search',
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
        <div class="relative w-full h-full rounded-2xl overflow-hidden border border-blue-100 bg-slate-100">
          <img
            src=${HERO_IMAGE}
            alt="Illustration showing media organization from chaos to structure"
            class="w-full h-full object-contain"
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
          <svg class="w-full max-w-[460px]" viewBox="0 0 460 260" role="img" aria-label="Providers to Zoltag to search output flow">
            <defs>
              <marker id="syncFlowArrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
                <path d="M0,0 L0,8 L8,4 z" fill="#64748b"></path>
              </marker>
            </defs>

            <rect x="10" y="14" width="136" height="232" rx="14" fill="#ffffff" stroke="#cbd5e1"></rect>
            <text x="78" y="34" text-anchor="middle" font-size="12" fill="#0f172a" font-weight="700">Providers</text>

            <rect x="22" y="46" width="112" height="26" rx="13" fill="#eef2ff" stroke="#c7d2fe"></rect>
            <g transform="translate(26 51)" fill="#0061ff">
              <polygon points="0,4 4,1 8,4 4,7"></polygon>
              <polygon points="9,4 13,1 17,4 13,7"></polygon>
              <polygon points="0,10 4,7 8,10 4,13"></polygon>
              <polygon points="9,10 13,7 17,10 13,13"></polygon>
            </g>
            <text x="49" y="63" font-size="11" fill="#0f172a" font-weight="600">Dropbox</text>

            <rect x="22" y="80" width="112" height="26" rx="13" fill="#ecfeff" stroke="#bae6fd"></rect>
            <g transform="translate(26 85)">
              <polygon points="8,0 16,14 11.5,14 4.5,2.5" fill="#34a853"></polygon>
              <polygon points="8,0 11.5,6 8.8,10.5 4.5,2.5" fill="#4285f4"></polygon>
              <polygon points="2.2,10.5 8.8,10.5 11.5,14 4.5,14" fill="#fbbc05"></polygon>
            </g>
            <text x="49" y="97" font-size="11" fill="#0f172a" font-weight="600">Drive</text>

            <rect x="22" y="114" width="112" height="26" rx="13" fill="#fff7ed" stroke="#fed7aa"></rect>
            <g transform="translate(26 119)">
              <rect x="0" y="1" width="18" height="12" rx="4" fill="#ef4444"></rect>
              <polygon points="7,4 7,10 12,7" fill="#ffffff"></polygon>
            </g>
            <text x="49" y="131" font-size="11" fill="#0f172a" font-weight="600">YouTube</text>

            <rect x="22" y="148" width="112" height="26" rx="13" fill="#f0fdf4" stroke="#bbf7d0"></rect>
            <g transform="translate(35 161)">
              <circle cx="0" cy="-5" r="3.2" fill="#4285f4"></circle>
              <circle cx="5" cy="0" r="3.2" fill="#ef4444"></circle>
              <circle cx="0" cy="5" r="3.2" fill="#fbbc05"></circle>
              <circle cx="-5" cy="0" r="3.2" fill="#22c55e"></circle>
              <circle cx="0" cy="0" r="1.3" fill="#ffffff"></circle>
            </g>
            <text x="49" y="165" font-size="11" fill="#0f172a" font-weight="600">Photos</text>

            <rect x="22" y="182" width="112" height="26" rx="13" fill="#fdf4ff" stroke="#f5d0fe"></rect>
            <circle cx="32" cy="195" r="3.6" fill="#2563eb"></circle>
            <circle cx="38" cy="195" r="3.6" fill="#ec4899"></circle>
            <text x="49" y="199" font-size="11" fill="#0f172a" font-weight="600">Flickr</text>

            <rect x="176" y="96" width="108" height="68" rx="14" fill="#eff6ff" stroke="#93c5fd"></rect>
            <text x="230" y="126" text-anchor="middle" font-size="16" fill="#1e3a8a" font-weight="700">Zoltag</text>
            <text x="230" y="145" text-anchor="middle" font-size="10.5" fill="#1d4ed8">Normalize + index</text>

            <line x1="148" y1="130" x2="176" y2="130" stroke="#64748b" stroke-width="2.4" marker-end="url(#syncFlowArrow)"></line>

            <rect x="314" y="42" width="136" height="176" rx="14" fill="#ffffff" stroke="#cbd5e1"></rect>
            <text x="382" y="62" text-anchor="middle" font-size="12" fill="#0f172a" font-weight="700">Search Output</text>
            <rect x="326" y="72" width="112" height="20" rx="8" fill="#f8fafc" stroke="#e2e8f0"></rect>
            <text x="334" y="86" font-size="10" fill="#64748b">aerial silk video...</text>
            <rect x="326" y="102" width="54" height="16" rx="8" fill="#eef2ff" stroke="#c7d2fe"></rect>
            <text x="333" y="113" font-size="9.5" fill="#3730a3">Video</text>
            <rect x="384" y="102" width="54" height="16" rx="8" fill="#ecfeff" stroke="#bae6fd"></rect>
            <text x="391" y="113" font-size="9.5" fill="#155e75">2+ stars</text>
            <rect x="326" y="126" width="112" height="80" rx="10" fill="#f8fafc" stroke="#e2e8f0"></rect>
            <rect x="334" y="134" width="46" height="30" rx="6" fill="#e2e8f0"></rect>
            <rect x="386" y="134" width="46" height="30" rx="6" fill="#dbeafe"></rect>
            <rect x="334" y="170" width="98" height="8" rx="4" fill="#e2e8f0"></rect>
            <rect x="334" y="184" width="76" height="8" rx="4" fill="#e2e8f0"></rect>

            <line x1="284" y1="130" x2="314" y2="130" stroke="#64748b" stroke-width="2.4" marker-end="url(#syncFlowArrow)"></line>
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

    if (type === 'curation') {
      return html`
        <div class="w-full h-full rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 h-full">
            <div class="rounded-xl border border-slate-200 bg-white p-3">
              <div class="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Human Curation</div>
              <div class="grid grid-cols-2 gap-2 mt-2">
                ${[1, 2, 3, 4].map((i) => html`
                  <div class="aspect-square rounded-lg border border-slate-200 bg-slate-100 relative overflow-hidden">
                    <div class="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/55 to-transparent text-white text-[9px] font-semibold">
                      IMG ${i}
                    </div>
                  </div>
                `)}
              </div>
              <div class="mt-2 flex flex-wrap gap-1.5">
                <span class="rounded-md bg-blue-600 text-white text-[10px] font-semibold px-2 py-1">Tag: Performer</span>
                <span class="rounded-md bg-slate-800 text-white text-[10px] font-semibold px-2 py-1">Tag: Aerial</span>
                <span class="rounded-md bg-emerald-600 text-white text-[10px] font-semibold px-2 py-1">Rating: 3*</span>
              </div>
            </div>

            <div class="rounded-xl border border-blue-200 bg-blue-50 p-3">
              <div class="text-xs font-semibold uppercase tracking-[0.06em] text-blue-700">AI Suggestions</div>
              <div class="mt-2 space-y-2">
                ${[
                  ['silks', '96%'],
                  ['stage-performance', '92%'],
                  ['crowd', '88%'],
                ].map(([tag, score]) => html`
                  <div class="rounded-lg border border-blue-200 bg-white px-2.5 py-2 flex items-center justify-between gap-2">
                    <span class="text-xs text-slate-700 font-medium">${tag}</span>
                    <span class="text-[11px] text-blue-700 font-semibold">${score}</span>
                  </div>
                `)}
              </div>
              <div class="mt-3 rounded-lg border border-blue-200 bg-white px-2.5 py-2 flex items-center justify-between text-xs">
                <span class="text-slate-700">Human confirms final tags</span>
                <span class="text-emerald-700 font-semibold">Approved</span>
              </div>
            </div>
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
                  href="/app"
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
