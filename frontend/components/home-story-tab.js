import { LitElement, html } from 'lit';

const HERO_IMAGE = new URL('../assets/chaos-to-organized.png', import.meta.url).href;

const SLIDES = [
  {
    eyebrow: 'Media Organizer',
    title: 'Organize your photos and vidoes',
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
    eyebrow: 'Integrate',
    title: 'Easy Integration',
    subtitle:
      'One-click integration to your storage providers.',
    bullets: [
      'Secure connections to common providers: Dropbox, Google Drive, YouTube, Google Photos, and Flickr',
      'Retain full control over what folders are indexed.',
      'Originals remain in place, only thumbnails are stored in Zotag.',
      'Presents one searchable view across all your sources',
    ],
    visual: 'setup',
  },
  {
    eyebrow: 'Curate',
    title: 'Addictive Organization',
    subtitle:
      'Intuitive drag-and-drop workflows and smart AI suggestions.',
    bullets: [
      'Easily define and refine the tags and categories that work for you',
      'Apply tags to photos through easy drag and drop interfaces',
      'AI powered recommendations that learn from your choices',
    ],
    visual: 'curation',
  },
  {
    eyebrow: 'Share',
    title: 'Find, Share and Collaborate',
    subtitle:
      'Search by what you know and surface usable results in seconds.',
    bullets: [
      'Securely share collections with coworkers, family members or friends',
      'Enable presentations and zip file downloads',
      'Videos and high res images fully playable and viewable.',
      'Get feedback through ratings and comments',
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
            <div class="text-white text-sm font-semibold">From chaos to organization</div>
          </div>
        </div>
      `;
    }

    if (type === 'setup') {
      return html`
        <div class="w-full h-full rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-4 flex items-center justify-center">
          <svg class="w-full h-full" viewBox="0 0 520 480" role="img" aria-label="Cloud providers flow into faceted search results">
            <defs>
              <marker id="syncFlowArrow" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto">
                <path d="M0,0 L0,10 L10,5 z" fill="#64748b"></path>
              </marker>
            </defs>

            <rect x="24" y="14" width="472" height="124" rx="18" fill="#ffffff" stroke="#cbd5e1"></rect>
            <text x="260" y="44" text-anchor="middle" font-size="15" fill="#0f172a" font-weight="700">Cloud Providers</text>

            <rect x="36" y="72" width="84" height="36" rx="18" fill="#eef2ff" stroke="#c7d2fe"></rect>
            <circle cx="52" cy="90" r="6.5" fill="#0061ff"></circle>
            <text x="70" y="96" font-size="12.5" fill="#0f172a" font-weight="600">Dropbox</text>

            <rect x="130" y="72" width="76" height="36" rx="18" fill="#ecfeff" stroke="#bae6fd"></rect>
            <circle cx="146" cy="90" r="6.5" fill="#34a853"></circle>
            <text x="164" y="96" font-size="12.5" fill="#0f172a" font-weight="600">Drive</text>

            <rect x="216" y="72" width="94" height="36" rx="18" fill="#fff7ed" stroke="#fed7aa"></rect>
            <circle cx="232" cy="90" r="6.5" fill="#ef4444"></circle>
            <text x="250" y="96" font-size="12.5" fill="#0f172a" font-weight="600">YouTube</text>

            <rect x="320" y="72" width="84" height="36" rx="18" fill="#f0fdf4" stroke="#bbf7d0"></rect>
            <circle cx="336" cy="90" r="6.5" fill="#22c55e"></circle>
            <text x="354" y="96" font-size="12.5" fill="#0f172a" font-weight="600">Photos</text>

            <rect x="414" y="72" width="72" height="36" rx="18" fill="#fdf4ff" stroke="#f5d0fe"></rect>
            <circle cx="430" cy="90" r="6.5" fill="#ec4899"></circle>
            <text x="448" y="96" font-size="12.5" fill="#0f172a" font-weight="600">Flickr</text>

            <line x1="260" y1="138" x2="260" y2="180" stroke="#64748b" stroke-width="3" marker-end="url(#syncFlowArrow)"></line>
            <text x="278" y="169" font-size="12.5" fill="#1d4ed8">Unified index</text>

            <rect x="36" y="186" width="448" height="278" rx="18" fill="#ffffff" stroke="#cbd5e1"></rect>
            <text x="260" y="216" text-anchor="middle" font-size="16" fill="#0f172a" font-weight="700">Search Across All Providers</text>

            <text x="54" y="250" font-size="14" fill="#334155" font-weight="700">Filters:</text>
            <rect x="102" y="234" width="96" height="30" rx="15" fill="#f8fafc" stroke="#cbd5e1"></rect>
            <text x="114" y="253" font-size="11.5" fill="#475569">+ Add filter</text>
            <rect x="206" y="234" width="164" height="30" rx="15" fill="#eff6ff" stroke="#bfdbfe"></rect>
            <text x="219" y="253" font-size="11.5" fill="#1d4ed8">Keywords: aerial-lyra</text>
            <rect x="376" y="234" width="100" height="30" rx="15" fill="#eff6ff" stroke="#93c5fd"></rect>
            <text x="388" y="253" font-size="11.5" fill="#1d4ed8">Media: Videos</text>

            <line x1="54" y1="270" x2="468" y2="270" stroke="#e2e8f0"></line>

            <text x="54" y="299" font-size="14" fill="#334155" font-weight="700">Sort:</text>
            <rect x="95" y="282" width="62" height="26" rx="9" fill="#f8fafc" stroke="#cbd5e1"></rect>
            <text x="109" y="299" font-size="12" fill="#64748b">Rating</text>
            <rect x="162" y="282" width="118" height="26" rx="9" fill="#0f172a"></rect>
            <text x="179" y="299" font-size="12" fill="#ffffff">Photo Date</text>
            <rect x="286" y="282" width="136" height="26" rx="9" fill="#f8fafc" stroke="#cbd5e1"></rect>
            <text x="304" y="299" font-size="12" fill="#64748b">Process Date</text>
            <rect x="430" y="282" width="22" height="26" rx="6" fill="#eff6ff" stroke="#93c5fd"></rect>
            <rect x="436" y="290" width="4" height="4" rx="1" fill="#2563eb"></rect>
            <rect x="443" y="290" width="4" height="4" rx="1" fill="#2563eb"></rect>
            <rect x="436" y="297" width="4" height="4" rx="1" fill="#2563eb"></rect>
            <rect x="443" y="297" width="4" height="4" rx="1" fill="#2563eb"></rect>

            <text x="54" y="322" font-size="12.5" fill="#64748b" font-weight="700">4 ITEMS</text>

            <rect x="54" y="330" width="100" height="100" rx="11" fill="#c7d2fe"></rect>
            <rect x="62" y="338" width="55" height="16" rx="8" fill="#0f172a"></rect>
            <text x="69" y="349" font-size="8.2" fill="#e2e8f0">VIDEO 0:22</text>
            <circle cx="104" cy="380" r="16" fill="#0f172a" opacity="0.55"></circle>
            <polygon points="101,372 101,388 113,380" fill="#ffffff"></polygon>
            <rect x="54" y="409" width="100" height="21" rx="8" fill="#0f172a" opacity="0.7"></rect>
            <text x="62" y="423" font-size="8.8" fill="#f1f5f9">Tags: aerial-lyra</text>

            <rect x="160" y="330" width="100" height="100" rx="11" fill="#bae6fd"></rect>
            <rect x="168" y="338" width="55" height="16" rx="8" fill="#0f172a"></rect>
            <text x="175" y="349" font-size="8.2" fill="#e2e8f0">VIDEO 0:02</text>
            <circle cx="210" cy="380" r="16" fill="#0f172a" opacity="0.55"></circle>
            <polygon points="207,372 207,388 219,380" fill="#ffffff"></polygon>
            <rect x="160" y="409" width="100" height="21" rx="8" fill="#0f172a" opacity="0.7"></rect>
            <text x="168" y="423" font-size="8.8" fill="#f1f5f9">Tags: aerial-lyra</text>

            <rect x="266" y="330" width="100" height="100" rx="11" fill="#fecaca"></rect>
            <rect x="274" y="338" width="55" height="16" rx="8" fill="#0f172a"></rect>
            <text x="281" y="349" font-size="8.2" fill="#e2e8f0">VIDEO 0:02</text>
            <circle cx="316" cy="380" r="16" fill="#0f172a" opacity="0.55"></circle>
            <polygon points="313,372 313,388 325,380" fill="#ffffff"></polygon>
            <rect x="266" y="409" width="100" height="21" rx="8" fill="#0f172a" opacity="0.7"></rect>
            <text x="274" y="423" font-size="8.8" fill="#f1f5f9">Tags: aerial-lyra</text>

            <rect x="372" y="330" width="100" height="100" rx="11" fill="#bbf7d0"></rect>
            <rect x="380" y="338" width="55" height="16" rx="8" fill="#0f172a"></rect>
            <text x="387" y="349" font-size="8.2" fill="#e2e8f0">VIDEO 0:24</text>
            <circle cx="422" cy="380" r="16" fill="#0f172a" opacity="0.55"></circle>
            <polygon points="419,372 419,388 431,380" fill="#ffffff"></polygon>
            <rect x="372" y="409" width="100" height="21" rx="8" fill="#0f172a" opacity="0.7"></rect>
            <text x="380" y="423" font-size="8.8" fill="#f1f5f9">Tags: aerial-lyra</text>

            <text x="248" y="448" font-size="12" fill="#64748b">Results per page:</text>
            <rect x="342" y="435" width="44" height="20" rx="7" fill="#f8fafc" stroke="#cbd5e1"></rect>
            <text x="357" y="449" font-size="11" fill="#475569">100</text>
            <text x="394" y="448" font-size="12" fill="#64748b">1-4 of 4</text>
            <rect x="451" y="435" width="24" height="20" rx="6" fill="#ffffff" stroke="#93c5fd"></rect>
            <text x="460" y="449" font-size="11" fill="#2563eb">&lt;</text>
            <rect x="479" y="435" width="24" height="20" rx="6" fill="#ffffff" stroke="#93c5fd"></rect>
            <text x="488" y="449" font-size="11" fill="#2563eb">&gt;</text>
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
                ${this.currentSlide === 0 ? html`
                  <button
                    type="button"
                    class="inline-flex items-center px-4 py-2 rounded-full bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
                    @click=${this._goNext}
                  >Learn More</button>
                ` : html``}
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
