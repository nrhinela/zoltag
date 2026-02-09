# State Controller Migration Guide

This guide documents the process for extracting state controllers from large components in PhotoCat.

## Overview

State controllers use Lit's `ReactiveController` pattern to extract complex state management logic from monolithic components while preserving behavior through delegation.

## When to Extract

### Extract State Controllers When:
- ✅ State has 10+ related methods
- ✅ State is shared across multiple tabs/views
- ✅ State requires coordination between multiple subsystems
- ✅ Testing would benefit from isolated state logic
- ✅ State management obscures component's core responsibilities

### Don't Extract When:
- ❌ State is already well-encapsulated (< 50 lines, < 5 methods)
- ❌ Factory patterns provide sufficient abstraction
- ❌ State is tightly coupled to render logic
- ❌ Extraction would create thin wrappers with no value

## Step-by-Step Migration Process

### Phase 1: Preparation

#### 1. Identify State Boundaries
```javascript
// Example: Curate Home State
// - Filter state (sort, permatagFilter, sessionFilter, etc.)
// - Sorting configuration
// - Image management (fetch, remove, selection)
// - State snapshot/restore
```

#### 2. Document Golden Workflows
Before extraction, document and test critical user workflows:
```markdown
1. User selects permatag filter → images load
2. User changes sort order → images re-sort
3. User drags images to hotspot → images tagged and removed
4. User rates images → rating applied, images removed
```

#### 3. Create State Controller File
```bash
touch frontend/components/state/my-feature-state.js
```

### Phase 2: Extract State Logic

#### 1. Create Base Structure
```javascript
import { BaseStateController } from './base-state-controller.js';
import { fetchWithAuth } from '../../services/api.js';

/**
 * My Feature State Controller
 *
 * Brief description of what state this manages.
 *
 * @extends BaseStateController
 */
export class MyFeatureStateController extends BaseStateController {
  constructor(host) {
    super(host);
  }

  // Methods will go here
}
```

#### 2. Move State Methods (Copy First!)
**IMPORTANT**: Copy methods first, test, then remove from original component.

```javascript
// Example method extraction
handleFilterChange(value) {
  this.setHostProperty('myFilter', value);
  this.fetchData();
}

async fetchData() {
  const tenant = this.getHostProperty('tenant');
  const filter = this.getHostProperty('myFilter');

  try {
    const data = await fetchWithAuth('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter }),
      tenantId: tenant,
    });

    this.setHostProperty('myData', data);
  } catch (err) {
    console.error('Failed to fetch data:', err);
  }
}
```

#### 3. Add State Management Methods
```javascript
/**
 * Get default state for initialization.
 * @returns {Object} Default state object
 */
getDefaultState() {
  return {
    myFilter: null,
    myData: [],
    myLoading: false,
  };
}

/**
 * Snapshot current state.
 * @returns {Object} Current state snapshot
 */
snapshotState() {
  const host = this.host;
  return {
    myFilter: host.myFilter,
    myData: Array.isArray(host.myData) ? [...host.myData] : [],
    myLoading: host.myLoading,
  };
}

/**
 * Restore state from snapshot.
 * @param {Object} snapshot - State snapshot to restore
 */
restoreState(snapshot) {
  if (!snapshot) return;

  Object.entries(snapshot).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      this.host[key] = [...value];
    } else if (value && typeof value === 'object') {
      this.host[key] = { ...value };
    } else {
      this.host[key] = value;
    }
  });

  this.requestUpdate();
}
```

### Phase 3: Wire into Host Component

#### 1. Import State Controller
```javascript
import { MyFeatureStateController } from './state/my-feature-state.js';
```

#### 2. Instantiate in Constructor
```javascript
constructor() {
  super();
  this._myFeatureState = new MyFeatureStateController(this);
}
```

#### 3. Create Delegation Methods
**Pattern**: Keep 2-3 line wrappers for each public method
```javascript
// Filter management
_handleMyFilterChange(value) {
  return this._myFeatureState.handleFilterChange(value);
}

// Data fetching
async _fetchMyData() {
  return await this._myFeatureState.fetchData();
}

// State management
_snapshotMyState() {
  return this._myFeatureState.snapshotState();
}

_restoreMyState(snapshot) {
  return this._myFeatureState.restoreState(snapshot);
}
```

#### 4. Update Template Bindings (if needed)
```javascript
// Before
@click=${this._handleFilterChange}

// After (usually no change needed due to delegation)
@click=${this._handleMyFilterChange}
```

### Phase 4: Testing & Validation

#### 1. Test All Golden Workflows
Run through each documented workflow and verify:
- ✅ State updates correctly
- ✅ UI reflects state changes
- ✅ No console errors
- ✅ Behavior identical to before extraction

#### 2. Test Edge Cases
- Empty state initialization
- Rapid state changes
- Error handling
- State restoration after tab switching

#### 3. Verify No Regressions
```bash
# Run any automated tests
npm test

# Manual testing checklist:
# - All UI interactions work
# - No console errors
# - State persists correctly
# - Performance unchanged
```

### Phase 5: Cleanup

#### 1. Remove Original Methods
Once delegation is verified working, remove the original method implementations (keep delegation wrappers).

#### 2. Update Documentation
```javascript
/**
 * Handle filter change.
 * Delegates to MyFeatureStateController.
 * @param {string} value - Filter value
 */
_handleMyFilterChange(value) {
  return this._myFeatureState.handleFilterChange(value);
}
```

#### 3. Commit Changes
```bash
git add frontend/components/state/my-feature-state.js
git add frontend/components/photocat-app.js
git commit -m "Extract MyFeatureStateController

- Created MyFeatureStateController (XXX lines)
- Delegated YY methods from photocat-app.js
- All golden workflows validated
- No behavior changes"
```

## Common Patterns

### Pattern: Delegating to Other Controllers
State controllers can delegate to each other:
```javascript
// In RatingModalStateController
async applyExploreRating(imageIds, rating) {
  // Apply rating via API
  await Promise.all(imageIds.map(id =>
    fetchWithAuth(`/images/${id}/rating`, { /* ... */ })
  ));

  // Delegate image removal to home state
  this.host._removeCurateImagesByIds(imageIds);
}
```

### Pattern: Coordinating with Shared Components
State controllers can interact with shared components:
```javascript
async fetchData() {
  const filterPanel = this.getHostProperty('myFilterPanel');
  if (!filterPanel) return;

  this.startLoading();
  try {
    return await filterPanel.fetchData();
  } finally {
    this.finishLoading();
  }
}
```

### Pattern: Loading State Management
Use reference counting for concurrent operations:
```javascript
startLoading() {
  const currentCount = this.host._myLoadCount || 0;
  this.host._myLoadCount = currentCount + 1;
  this.setHostProperty('myLoading', true);
}

finishLoading() {
  const currentCount = this.host._myLoadCount || 1;
  this.host._myLoadCount = Math.max(0, currentCount - 1);
  this.setHostProperty('myLoading', this.host._myLoadCount > 0);
}
```

## Troubleshooting

### Issue: `this.host` is undefined
**Cause**: Controller not properly instantiated in host component.
**Fix**: Ensure controller is created in host's constructor:
```javascript
this._myState = new MyStateController(this);
```

### Issue: State updates don't trigger re-render
**Cause**: Not using `setHostProperty` or `requestUpdate`.
**Fix**: Always use helper methods:
```javascript
// ❌ Wrong
this.host.myProp = value;

// ✅ Correct
this.setHostProperty('myProp', value);
```

### Issue: Delegation creates circular calls
**Cause**: State controller calling host method that delegates back to controller.
**Fix**: State controllers should implement logic directly, not call host methods:
```javascript
// ❌ Wrong
async applyRating(ids, rating) {
  return this.host._applyRating(ids, rating); // Circular!
}

// ✅ Correct
async applyRating(ids, rating) {
  await fetchWithAuth(`/rating`, { /* ... */ }); // Direct implementation
  this.host._removeImages(ids); // Delegate to different subsystem
}
```

### Issue: Lost state after extraction
**Cause**: Forgot to implement `snapshotState` / `restoreState`.
**Fix**: Always implement state management methods and use them in host:
```javascript
// In host component
_handleTabChange(newTab) {
  this._savedState = this._myState.snapshotState();
  // ... switch tabs ...
  this._myState.restoreState(this._savedState);
}
```

## Anti-Patterns to Avoid

### ❌ Over-extraction
Don't extract simple state that's well-contained:
```javascript
// ❌ Don't create a controller for this
class SimpleToggleStateController extends BaseStateController {
  toggle() {
    this.setHostProperty('enabled', !this.getHostProperty('enabled'));
  }
}

// ✅ Just keep it in the component
_handleToggle() {
  this.enabled = !this.enabled;
}
```

### ❌ Thin Wrappers
Don't create controllers that just wrap existing abstractions:
```javascript
// ❌ Don't do this if hotspot handlers already exist
class HotspotStateController extends BaseStateController {
  handleDrop(event, id) {
    return this.host._hotspotHandlers.handleDrop(event, id);
  }
}

// ✅ Use the existing factory pattern
this._hotspotHandlers = createHotspotHandlers(this, config);
```

### ❌ Mixing Concerns
Don't put unrelated state in the same controller:
```javascript
// ❌ Don't mix audit and explore state
class CurateStateController extends BaseStateController {
  handleAuditFilter() { /* ... */ }
  handleExploreSort() { /* ... */ }
}

// ✅ Separate by concern
class CurateAuditStateController { /* ... */ }
class CurateExploreStateController { /* ... */ }
```

## Success Metrics

A successful state controller extraction should achieve:

1. **Behavioral Preservation**: Zero regressions in golden workflows
2. **Code Organization**: Related methods grouped logically
3. **Testability**: State logic can be tested independently
4. **Maintainability**: Clear ownership boundaries
5. **Appropriate Delegation**: 2-3 line wrappers in host component

## Example: Phase 1 Extractions

### CurateHomeStateController (522 lines)
- **Extracted**: Filter state, sorting, image management
- **Methods**: 20 methods
- **Result**: Curate home tab state isolated and testable

### CurateAuditStateController (511 lines)
- **Extracted**: Mode management, hotspot config, rating handling
- **Methods**: 27 methods
- **Result**: Audit tab complexity reduced

### RatingModalStateController (204 lines)
- **Extracted**: Modal visibility, rating application
- **Methods**: 12 methods
- **Result**: Shared rating logic unified

**Total Impact**: 1,237 lines extracted, 59 methods organized, photocat-app.js reduced from 4,602 to 4,425 lines.

## References

- [Lit ReactiveController Documentation](https://lit.dev/docs/composition/controllers/)
- [MODULARIZATION_PLAN.md](./MODULARIZATION_PLAN.md) - Full Phase 1 details
- `frontend/components/state/base-state-controller.js` - Base class implementation
