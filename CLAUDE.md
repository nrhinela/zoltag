# Overview
@README.md for project overview
@docs/DEPLOYMENT.md for deployment instructions.
@docs/refactoring_plan.md for the frontend refactoring plan, in case some legacy code is observed
- @src/photocat/static contains some legacy html files that were the source of the latest front-end conversion.
- Originally designed to accomodate multiple categorization models, currently only one is supported.

## Additional Instructions for Claude:

- In choosing architecture, keep filesizes modular and small, because lesser LLMS are using this codebase.
- The project is designed to be used with continue.dev. See .continue/rules for coding standards

## Token Efficiency

- Prefer targeted line-range reads over full file reads when possible
- Use Grep/Glob to locate code before reading entire files
- When exploring, start with the most specific search possible
- Avoid using the Explore agent for simple lookups - use direct file reads instead

## Key Entry Points

- Frontend: frontend/main.js → frontend/components/photocat-app.js
- Backend API: src/photocat/api.py
- Database models: src/photocat/models.py

## Component Architecture

### LitElement Components - Use Light DOM

**IMPORTANT**: When creating LitElement components, always use Light DOM (not Shadow DOM) to maintain access to Tailwind CSS classes.

**Pattern to follow**:
```javascript
export class MyComponent extends LitElement {
  // Disable Shadow DOM - render to Light DOM instead
  createRenderRoot() {
    return this;
  }

  // No static styles needed - use Tailwind classes directly

  render() {
    return html`
      <div class="grid grid-cols-5 gap-2">
        <!-- Tailwind classes work here! -->
      </div>
    `;
  }
}
```

**Why Light DOM**:
- ✅ Tailwind CSS classes work without rewriting as scoped styles
- ✅ No need to translate 200+ lines of CSS per component
- ✅ Styling matches parent document automatically
- ✅ Simpler code and faster development
- ✅ Still get component benefits: encapsulated logic, props, events, reusability

**When to use Shadow DOM**:
- Only for truly reusable widget libraries that need style isolation
- Not for internal application components

**Example**: See `frontend/components/curate-home-tab.js` for the pattern.

