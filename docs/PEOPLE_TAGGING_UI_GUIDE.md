# People Tagging UI Components - Developer Guide

**Status**: ✅ Complete
**Created**: 2026-01-23
**Framework**: Lit Web Components
**Styling**: Tailwind CSS

---

## Overview

Three Lit components provide a complete UX for people tagging:

1. **`person-manager`** - Manage all people (CRUD interface)
2. **`people-tagger`** - Tag people on specific images
3. **`people-search`** - Search/filter people for bulk operations

---

## Component 1: Person Manager

**File**: `frontend/components/person-manager.js`
**Purpose**: Full CRUD interface for managing all people

### Features

- ✅ List all people in card grid view
- ✅ Search people by name or Instagram URL
- ✅ Filter by person category
- ✅ Create new person with form
- ✅ Edit person details
- ✅ Delete person (with confirmation)
- ✅ View tag statistics per person

### Usage

```html
<person-manager></person-manager>
```

### Properties

```javascript
// Read-only (managed internally)
view: 'list' | 'editor'
people: Array<Person>
categories: Array<PersonCategory>
selectedPersonId: Number | null
loading: Boolean
error: String
formData: { name, instagram_url, person_category }
searchQuery: String
filterCategory: String
```

### Layout Modes

#### List View
- Grid of person cards
- Each card shows:
  - Person name
  - Category (photo_author, people_in_scene, etc.)
  - Number of tagged images
  - Instagram link (if provided)
  - Creation date
  - Edit/Delete buttons

#### Editor View
- Form to create or edit person
- Fields:
  - Name (required)
  - Instagram URL (optional)
  - Category (dropdown from loaded categories)
- Save/Cancel buttons

### Styling

- Responsive grid layout (auto-fill 300px cards)
- Purple gradient headers on person cards
- Hover effects on cards
- Form validation errors shown in red
- Success/loading states properly indicated

### Example Integration

```javascript
// In photocat-app.js or similar
import './components/person-manager.js';

// Add to template
html`
  <section>
    <person-manager></person-manager>
  </section>
`
```

---

## Component 2: People Tagger

**File**: `frontend/components/people-tagger.js`
**Purpose**: Tag people on a specific image

### Features

- ✅ Select person from dropdown
- ✅ Adjust confidence score with slider
- ✅ Add tag to image
- ✅ Display all tags on image
- ✅ Remove person tags
- ✅ Confidence indicators (color-coded)
- ✅ Duplicate tag handling (updates existing)

### Usage

```html
<people-tagger
  imageId="123"
  imageName="Photo of team at conference.jpg">
</people-tagger>
```

### Properties

```javascript
imageId: Number (required)
imageName: String (optional)

// Read-only (managed internally)
people: Array<Person>
peopleTags: Array<PersonTag>
loading: Boolean
error: String
selectedPerson: Person | null
confidence: Number (0-1.0)
```

### Confidence Scoring

- **1.0 (100%)**: Manual tag, certain
- **0.8-0.99**: High confidence, confident
- **0.5-0.79**: Medium confidence, somewhat uncertain
- **0.1-0.49**: Low confidence (for ML detection)

**Visual Indicators**:
- 🟢 Green dot: High confidence (≥0.8)
- 🟡 Yellow dot: Medium confidence (0.5-0.79)
- 🔴 Red dot: Low confidence (<0.5)

### Layout

1. **Header Section**
   - Title: "👥 Tag People"
   - Subtitle: Image name or ID

2. **Input Section**
   - Person dropdown (filtered by category)
   - Confidence slider (0-100%)
   - "Add Person Tag" button

3. **Tags Section**
   - List of tagged people
   - Each tag shows:
     - Confidence indicator (colored dot)
     - Person name
     - Person category
     - Confidence percentage
     - Remove button

### Example Integration

```javascript
// In image-editor.js
import './components/people-tagger.js';

// Add to modal or right pane
html`
  <people-tagger
    .imageId="${this.currentImage.id}"
    .imageName="${this.currentImage.filename}">
  </people-tagger>
`
```

---

## Component 3: People Search

**File**: `frontend/components/people-search.js`
**Purpose**: Search/filter people for bulk operations or selection

### Features

- ✅ Search people by name
- ✅ Filter by category
- ✅ Multi-select people with checkboxes
- ✅ View tag count per person
- ✅ Selection state indicator
- ✅ Emit selection events

### Usage

```html
<people-search></people-search>
```

### Properties

```javascript
// Read-only (managed internally)
categories: Array<PersonCategory>
people: Array<Person>
selectedPeople: Set<Number>
loading: Boolean
error: String
searchQuery: String
selectedCategory: String
```

### Events

```javascript
// Listen for selection changes
peopleSearch.addEventListener('selection-changed', (e) => {
  console.log('Selected people:', e.detail.selectedPeople);
  // selectedPeople is Array<personId>
});
```

### Layout

1. **Title**: "Search People"

2. **Controls**
   - Search input (filter by name)
   - Category filter dropdown

3. **People List**
   - Scrollable list
   - Each item shows:
     - Checkbox
     - Person name
     - Category
     - Tag count
   - Click to select/deselect
   - Selected items highlighted in blue

4. **Selection Summary**
   - Shows count of selected people
   - Appears when any people selected

### Example Integration

```javascript
// In filter-controls.js or similar
import './components/people-search.js';

// Template
html`
  <div class="filter-panel">
    <people-search id="peopleSearch"></people-search>
  </div>
`

// Controller
firstUpdated() {
  const search = this.shadowRoot.querySelector('people-search');
  search.addEventListener('selection-changed', (e) => {
    this.applyPeopleFilter(e.detail.selectedPeople);
  });
}
```

---

## Integration Examples

### Example 1: Add Person Manager to Main App

```javascript
// In photocat-app.js
import './components/person-manager.js';

export class PhotocatApp extends LitElement {
  static properties = {
    currentTab: { type: String }
  };

  render() {
    return html`
      <div class="app">
        <app-header></app-header>

        ${this.currentTab === 'people' ? html`
          <person-manager></person-manager>
        ` : html`
          <!-- Other tabs -->
        `}
      </div>
    `;
  }
}
```

### Example 2: Add Tagger to Image Editor

```javascript
// In image-editor.js
import './components/people-tagger.js';

export class ImageEditor extends LitElement {
  render() {
    return html`
      <div class="editor">
        <div class="left-pane">
          <img src="${this.imageUrl}" />
        </div>

        <div class="right-pane">
          <people-tagger
            .imageId="${this.currentImage.id}"
            .imageName="${this.currentImage.filename}">
          </people-tagger>

          <!-- Other sections -->
        </div>
      </div>
    `;
  }
}
```

### Example 3: Add Search to Filter Panel

```javascript
// In filter-controls.js
import './components/people-search.js';

export class FilterControls extends LitElement {
  filterByPeople(personIds) {
    // Use existing filter API
    this.applyFilters({
      people: personIds,
      operator: 'OR'
    });
  }

  render() {
    return html`
      <div class="filters">
        <people-search
          @selection-changed="${(e) => this.filterByPeople(e.detail.selectedPeople)}">
        </people-search>
      </div>
    `;
  }
}
```

---

## Styling & Theming

All components use:
- **Tailwind CSS**: Via `tailwind-lit.js` helper
- **Color Scheme**: Blue primary (#3b82f6), Gray accents
- **Typography**: 13px base font, 12px in lists
- **Spacing**: 8px/12px/16px consistent gaps
- **Borders**: 1px solid #e5e7eb (light gray)
- **Shadows**: Subtle for cards on hover

### Custom CSS Variables (Optional)

```css
/* Can be extended with CSS variables */
:root {
  --primary-color: #3b82f6;
  --danger-color: #dc2626;
  --success-color: #10b981;
  --warning-color: #f59e0b;
}
```

---

## API Integration

All components use the people tagging API:

### Endpoints Used

**Person Manager**:
- `GET /api/v1/config/people/categories` - Load categories
- `GET /api/v1/people` - List people (with filters)
- `POST /api/v1/people` - Create person
- `DELETE /api/v1/people/{id}` - Delete person

**People Tagger**:
- `GET /api/v1/people` - Load all people
- `GET /api/v1/images/{id}/people` - Get image's people tags
- `POST /api/v1/images/{id}/people` - Tag person on image
- `DELETE /api/v1/images/{id}/people/{person_id}` - Remove tag

**People Search**:
- `GET /api/v1/config/people/categories` - Load categories
- `GET /api/v1/people` - List people (with search/filter)

### Tenant Handling

All requests include tenant ID from localStorage:

```javascript
const tenantId = localStorage.getItem('tenantId') || 'default';
headers: { 'X-Tenant-ID': tenantId }
```

---

## Error Handling

All components display errors in a red alert box:

```javascript
<div class="error-message">${this.error}</div>
```

Common errors:

| Error | Cause | User sees |
|-------|-------|-----------|
| Failed to load data | API unavailable | Red alert |
| Failed to create person | Name already exists | Red alert with detail |
| Failed to tag person | Image/person not found | Red alert |
| Network timeout | Connection issue | Red alert |

---

## Performance Considerations

### Pagination

- Person Manager: Loads 500 people max
- Tagger: Loads all people (optimized for typical usage)
- Search: Loads 500 people max

For larger datasets, consider:
- Client-side pagination
- Virtual scrolling for lists
- Lazy loading on scroll

### Caching

Currently, no caching implemented. Add with:

```javascript
// Simple in-memory cache
const peopleCache = new Map();

async loadPeople() {
  if (peopleCache.has(this.tenantId)) {
    this.people = peopleCache.get(this.tenantId);
    return;
  }

  const data = await fetch(...);
  peopleCache.set(this.tenantId, data);
  this.people = data;
}
```

---

## Testing

### Unit Test Template

```javascript
import { fixture, expect, html } from '@open-wc/testing';
import './person-manager.js';

describe('person-manager', () => {
  it('loads people on connect', async () => {
    const el = await fixture(html`<person-manager></person-manager>`);
    await el.updateComplete;

    expect(el.people).to.not.be.empty;
  });

  it('filters people by search', async () => {
    const el = await fixture(html`<person-manager></person-manager>`);
    el.searchQuery = 'Alice';
    await el.updateComplete;

    const filtered = el.getFilteredPeople();
    expect(filtered.every(p => p.name.includes('Alice'))).to.be.true;
  });
});
```

### Manual Testing

```bash
# 1. Start dev server
make dev

# 2. Open browser and navigate to components
http://localhost:5173/

# 3. Test each component:
# - Create person in Person Manager
# - Tag person on image in Editor
# - Search people in Filter Panel
```

---

## Accessibility

Components are designed with:
- ✅ Semantic HTML (buttons, labels, inputs)
- ✅ Keyboard navigation (Tab, Enter, arrows)
- ✅ Color contrast (WCAG AA compliant)
- ✅ Form labels and descriptions
- ✅ Error messages clearly visible
- ✅ Loading states announced

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Focus next element | Tab |
| Focus previous element | Shift+Tab |
| Select option | Enter/Space |
| Toggle checkbox | Space |
| Delete with confirm | Enter (on delete button) |

---

## Future Enhancements

### Phase 6.1: Bulk Tagging
- `bulk-tagger` component
- Tag multiple people on multiple images
- Batch operations

### Phase 6.2: Analytics
- `people-analytics` component
- Show tag trends
- Most/least tagged people
- Person statistics dashboard

### Phase 6.3: Face Detection
- Show detected faces with confidence
- Auto-suggest person matches
- Manual confirmation workflow

### Phase 6.4: Import/Export
- Bulk import people from CSV
- Export people data
- Backup/restore functionality

---

## Component Dependencies

```
person-manager.js
  └── tailwind-lit.js
  └── Lit (core)

people-tagger.js
  └── tailwind-lit.js
  └── Lit (core)

people-search.js
  └── tailwind-lit.js
  └── Lit (core)
```

All components are self-contained and can be imported independently.

---

## File Sizes (Estimated)

| File | Size | Minified |
|------|------|----------|
| person-manager.js | 12 KB | 4 KB |
| people-tagger.js | 8 KB | 3 KB |
| people-search.js | 6 KB | 2 KB |
| **Total** | **26 KB** | **9 KB** |

---

## Summary

The three people tagging components provide:

1. **Full CRUD Management** via `person-manager`
2. **Image-Level Tagging** via `people-tagger`
3. **Search & Filtering** via `people-search`

All components:
- ✅ Use modern Lit patterns
- ✅ Follow existing PhotoCat styles
- ✅ Integrate with people API
- ✅ Handle errors gracefully
- ✅ Support tenant isolation
- ✅ Are fully responsive
- ✅ Include accessibility features

Ready for integration into the main PhotoCat application!
