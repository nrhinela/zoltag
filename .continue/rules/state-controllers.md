---
globs: "frontend/components/**/*.js"
description: Complex state management uses ReactiveController pattern. Know when to extract state controllers vs. use factory patterns.
alwaysApply: true
---

# State Controller Architecture

Complex state management in PhotoCat uses Lit's `ReactiveController` pattern to extract state logic from large components.

## When to Use State Controllers

Extract state controllers when:
- ✅ Complex state with 10+ related methods
- ✅ State shared across multiple tabs/views
- ✅ State requiring coordination between multiple subsystems
- ✅ State that benefits from isolation for testing

## When NOT to Use State Controllers

Don't extract when:
- ❌ Simple state already well-encapsulated in a component
- ❌ State managed by factory patterns (hotspot handlers, rating handlers)
- ❌ Minimal state (< 50 lines, < 5 methods)

## State Controller Pattern

```javascript
import { BaseStateController } from './base-state-controller.js';

export class MyStateController extends BaseStateController {
  constructor(host) {
    super(host);
  }

  // State manipulation
  updateFilter(value) {
    this.setHostProperty('myFilter', value);
    this.fetchData();
  }

  // Async operations
  async fetchData() {
    const data = await fetchWithAuth('/api/data', {
      tenantId: this.getHostProperty('tenant'),
    });
    this.setHostProperty('myData', data);
  }

  // REQUIRED: State management methods
  getDefaultState() {
    return { myFilter: null, myData: [], myLoading: false };
  }

  snapshotState() {
    return {
      myFilter: this.host.myFilter,
      myData: [...this.host.myData],
      myLoading: this.host.myLoading,
    };
  }

  restoreState(snapshot) {
    if (!snapshot) return;
    Object.entries(snapshot).forEach(([key, value]) => {
      this.host[key] = Array.isArray(value) ? [...value] : value;
    });
    this.requestUpdate();
  }
}
```

## Integration Pattern

```javascript
import { MyStateController } from './state/my-state-controller.js';

export class PhotocatApp extends LitElement {
  constructor() {
    super();
    this._myState = new MyStateController(this);
  }

  // Delegate to state controller (2-3 line wrapper)
  _updateFilter(value) {
    return this._myState.updateFilter(value);
  }
}
```

## File Organization

- `frontend/components/state/` - State controllers (complex state extraction)
- `frontend/components/shared/` - Shared utilities and factories

## Existing State Controllers

- `CurateHomeStateController` (522 lines) - Curate home/explore tab
- `CurateAuditStateController` (511 lines) - Curate audit tab
- `RatingModalStateController` (204 lines) - Shared rating modal

## Migration Guide

See `docs/STATE_CONTROLLER_MIGRATION.md` for complete extraction process.

## Anti-Patterns

❌ Don't extract simple toggles
❌ Don't create thin wrappers around existing factories
❌ Don't mix unrelated state in one controller
