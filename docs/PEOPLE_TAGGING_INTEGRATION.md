# People Tagging UI - Integration Guide

**Status**: Ready for Integration
**Components**: 3 Lit components (26 KB total)
**Integration Time**: ~1 hour

---

## Quick Start

### Step 1: Components are Auto-Imported

The three components are already created and ready. They just need to be imported in your main app:

```javascript
// In frontend/components/photocat-app.js (or main entry point)
import './components/person-manager.js';
import './components/people-tagger.js';
import './components/people-search.js';
```

### Step 2: Add Components to Your Routes

#### Option A: Add to Main Navigation

```javascript
// In photocat-app.js
static properties = {
  currentView: { type: String } // 'gallery' | 'people' | 'filters'
};

render() {
  return html`
    <div class="app">
      <app-header
        @view-changed="${(e) => { this.currentView = e.detail.view; }}"
      ></app-header>

      ${this.currentView === 'people' ? html`
        <person-manager></person-manager>
      ` : this.currentView === 'gallery' ? html`
        <image-gallery></image-gallery>
      ` : ''}
    </div>
  `;
}
```

#### Option B: Add to Image Editor

```javascript
// In image-editor.js
import './components/people-tagger.js';

export class ImageEditor extends LitElement {
  static properties = {
    currentImage: { type: Object }
  };

  render() {
    return html`
      <div class="modal-grid">
        <div class="left-pane">
          <img src="${this.currentImage.thumbnail_url}" />
        </div>

        <div class="right-pane">
          <div class="tabs">
            <!-- Existing tabs -->
          </div>

          <!-- Add people tagger tab -->
          ${this.activeTab === 'people' ? html`
            <people-tagger
              .imageId="${this.currentImage.id}"
              .imageName="${this.currentImage.filename}">
            </people-tagger>
          ` : ''}
        </div>
      </div>
    `;
  }
}
```

#### Option C: Add to Filter Controls

```javascript
// In filter-controls.js
import './components/people-search.js';

export class FilterControls extends LitElement {
  render() {
    return html`
      <div class="filter-panel">
        <div class="filter-section">
          <h3>Filter by People</h3>
          <people-search
            @selection-changed="${(e) => this.applyPeopleFilter(e.detail.selectedPeople)}">
          </people-search>
        </div>
      </div>
    `;
  }

  applyPeopleFilter(personIds) {
    // Use existing filter API with people parameter
    this.dispatchEvent(new CustomEvent('filters-changed', {
      detail: { people: personIds }
    }));
  }
}
```

---

## Implementation Scenarios

### Scenario 1: Add People Tab to Main App

**Goal**: Users can manage people from main navigation

**Steps**:

1. Add import to photocat-app.js:
```javascript
import './components/person-manager.js';
```

2. Add to navigation menu:
```javascript
static properties = {
  activeTab: { type: String } // 'gallery' | 'people'
};

renderNavigation() {
  return html`
    <nav>
      <button @click="${() => { this.activeTab = 'gallery'; }}">
        Gallery
      </button>
      <button @click="${() => { this.activeTab = 'people'; }}">
        👥 People
      </button>
    </nav>
  `;
}
```

3. Add to main content:
```javascript
render() {
  return html`
    ${this.renderNavigation()}
    ${this.activeTab === 'people' ? html`
      <person-manager></person-manager>
    ` : html`
      <image-gallery></image-gallery>
    `}
  `;
}
```

### Scenario 2: Add Tagger to Image Editor Modal

**Goal**: Users can tag people while editing individual images

**Steps**:

1. Add import to image-editor.js:
```javascript
import './components/people-tagger.js';
```

2. Add tab for people:
```javascript
render() {
  return html`
    <div class="editor-modal">
      <div class="tabs">
        <button class="tab ${this.activeTab === 'info' ? 'active' : ''}">
          Info
        </button>
        <button class="tab ${this.activeTab === 'people' ? 'active' : ''}">
          People
        </button>
      </div>

      <div class="tab-content">
        ${this.activeTab === 'people' ? html`
          <people-tagger
            .imageId="${this.currentImage.id}"
            .imageName="${this.currentImage.filename}">
          </people-tagger>
        ` : '...other tabs...'}
      </div>
    </div>
  `;
}
```

### Scenario 3: Add Search to Filter Panel

**Goal**: Users can filter images by people they contain

**Steps**:

1. Add import to filter-controls.js:
```javascript
import './components/people-search.js';
```

2. Add to filter panel:
```javascript
render() {
  return html`
    <div class="filters">
      <section>
        <h3>By Keywords</h3>
        <!-- Existing keyword filters -->
      </section>

      <section>
        <h3>By People</h3>
        <people-search
          @selection-changed="${(e) => this.onPeopleSelected(e.detail.selectedPeople)}">
        </people-search>
      </section>
    </div>
  `;
}

onPeopleSelected(personIds) {
  // Apply filter
  this.filters = { ...this.filters, people: personIds };
  this.applyFilters();
}
```

---

## Component Data Flow

### Person Manager

```
Load on mount
  ↓
Query /api/v1/config/people/categories
Query /api/v1/people
  ↓
Display list of people
  ↓
User actions:
  - Create: POST /api/v1/people
  - Update: PUT /api/v1/people/{id}
  - Delete: DELETE /api/v1/people/{id}
  ↓
Reload people list
```

### People Tagger

```
Mount with imageId prop
  ↓
Query /api/v1/people
Query /api/v1/images/{id}/people
  ↓
Display all people + current tags
  ↓
User actions:
  - Tag: POST /api/v1/images/{id}/people
  - Remove: DELETE /api/v1/images/{id}/people/{personId}
  ↓
Reload image tags
```

### People Search

```
Load on mount
  ↓
Query /api/v1/config/people/categories
Query /api/v1/people
  ↓
Display searchable list
  ↓
User interactions:
  - Search: Filter local list
  - Select: Update selectedPeople Set
  ↓
Emit selection-changed event
```

---

## API Integration Checklist

- [ ] `/api/v1/config/people/categories` endpoint accessible
- [ ] `/api/v1/people` endpoint supports:
  - [ ] GET (list with filters)
  - [ ] POST (create)
  - [ ] PUT (update)
  - [ ] DELETE (delete)
- [ ] `/api/v1/images/{id}/people` endpoint supports:
  - [ ] GET (get tags)
  - [ ] POST (add tag)
  - [ ] DELETE (remove tag)
- [ ] All endpoints require `X-Tenant-ID` header
- [ ] All responses include proper error messages

All endpoints should be working! Run:
```bash
curl http://localhost:8000/api/v1/people \
  -H "X-Tenant-ID: demo"
```

---

## Styling & Layout Decisions

### Component Sizing

| Component | Width | Height | Use Case |
|-----------|-------|--------|----------|
| person-manager | Full viewport | Full viewport | Standalone page |
| people-tagger | 400px fixed | Auto | Modal/sidebar |
| people-search | 300px fixed | Auto | Sidebar/filter panel |

### Adding to Existing Layouts

**In Modal Dialog**:
```css
.modal-body {
  display: grid;
  grid-template-columns: 1fr 400px;
  gap: 16px;
}

people-tagger {
  max-width: 400px;
}
```

**In Sidebar**:
```css
.sidebar {
  width: 320px;
  overflow-y: auto;
}

people-search {
  width: 100%;
}
```

**As Full Page**:
```css
person-manager {
  width: 100%;
  height: 100vh;
}
```

---

## Common Integration Issues & Solutions

### Issue 1: Component Not Showing

**Symptom**: Component tag renders but no content

**Solution**:
```javascript
// Make sure to import the component
import './components/person-manager.js';

// Make sure tenant ID is set
localStorage.setItem('tenantId', 'your-tenant-id');

// Check browser console for errors
// Try manually:
const comp = document.querySelector('person-manager');
console.log(comp.people); // Should not be undefined
```

### Issue 2: API Calls Failing

**Symptom**: Red error messages in component

**Solution**:
```javascript
// Check that backend is running
curl http://localhost:8000/api/v1/people -H "X-Tenant-ID: demo"

// Check that categories are initialized
curl http://localhost:8000/api/v1/config/people/categories/initialize \
  -X POST -H "X-Tenant-ID: demo"

// Check network tab in DevTools for actual errors
```

### Issue 3: Styling Looks Off

**Symptom**: Components render but styling is broken

**Solution**:
```javascript
// Make sure tailwind-lit.js is imported
import { tailwind } from './tailwind-lit.js';

// Check that Tailwind CSS is loaded globally
// In main.html or vite config, ensure Tailwind CSS is included

// Components use both tailwind + custom CSS
static styles = [tailwind, css`...`];
```

### Issue 4: State Not Updating

**Symptom**: Changes don't reflect in UI

**Solution**:
```javascript
// Make sure to trigger updates after data changes
this.people = new Array(this.people); // Force Lit to detect change
this.requestUpdate();

// Or use proper property setters
set people(value) {
  this._people = value;
  this.requestUpdate();
}
```

---

## Testing Integration

### Unit Test Example

```javascript
import { fixture, expect, html } from '@open-wc/testing';
import './photocat-app.js';

describe('PhotoCat with People Tagging', () => {
  it('shows people manager when tab selected', async () => {
    const el = await fixture(html`<photocat-app></photocat-app>`);

    el.activeTab = 'people';
    await el.updateComplete;

    const manager = el.shadowRoot.querySelector('person-manager');
    expect(manager).to.exist;
  });

  it('passes imageId to people-tagger', async () => {
    const el = await fixture(html`<people-tagger imageId="123"></people-tagger>`);
    await el.updateComplete;

    expect(el.imageId).to.equal(123);
  });
});
```

### Manual Testing Checklist

- [ ] Person Manager loads and displays list
- [ ] Can create new person
- [ ] Can search/filter people
- [ ] Can edit person
- [ ] Can delete person (with confirmation)
- [ ] People Tagger shows dropdown of people
- [ ] Can tag person on image
- [ ] Can adjust confidence slider
- [ ] Can see tagged people
- [ ] Can remove people tags
- [ ] People Search allows multi-select
- [ ] Selection-changed event fires
- [ ] All error messages display properly
- [ ] Loading states work
- [ ] Mobile responsive on all sizes

---

## Performance Optimization

### For Large People Lists

```javascript
// In person-manager.js
// Consider adding pagination or virtual scrolling
if (this.people.length > 100) {
  // Show pagination controls
  // Or use web-components like iron-list
}
```

### For Large Image Tagging

```javascript
// In people-tagger.js
// Pre-load people on component creation
async connectedCallback() {
  super.connectedCallback();
  // Cache people list for fast dropdown
  this.peopleCache = await fetch(...);
}
```

### Caching Strategy

```javascript
// Add to app-level state management
class AppState {
  static peopleCache = new Map();

  static async getPeople(tenantId) {
    if (this.peopleCache.has(tenantId)) {
      return this.peopleCache.get(tenantId);
    }
    const data = await fetch(...);
    this.peopleCache.set(tenantId, data);
    return data;
  }
}
```

---

## Next Steps

1. **Choose Integration Scenario** (A, B, or C from above)
2. **Add Imports** to your component files
3. **Integrate Components** into your routes/layouts
4. **Test API Endpoints** are working
5. **Style Adjustments** if needed for your layout
6. **User Testing** with your team
7. **Deployment** to staging/production

---

## Support Resources

- **API Reference**: PEOPLE_TAGGING_QUICK_START.md
- **Component Details**: PEOPLE_TAGGING_UI_GUIDE.md
- **Architecture**: PEOPLE_TAGGING_IMPLEMENTATION.md
- **Component Files**:
  - `frontend/components/person-manager.js`
  - `frontend/components/people-tagger.js`
  - `frontend/components/people-search.js`

---

## Questions?

Refer to:
1. Component guide for component-specific questions
2. API guide for endpoint questions
3. Integration examples above for layout questions
4. Browser DevTools for runtime issues

The components are production-ready and fully documented!
