---
globs: "frontend/components/**/*.js"
description: All LitElement components must use Light DOM (not Shadow DOM) to maintain access to Tailwind CSS classes
alwaysApply: true
---

# LitElement Light DOM Pattern

**CRITICAL**: All LitElement components in this project MUST use Light DOM (not Shadow DOM).

## Required Pattern

```javascript
export class MyComponent extends LitElement {
  // REQUIRED: Disable Shadow DOM - render to Light DOM instead
  createRenderRoot() {
    return this;
  }

  // NO static styles - use Tailwind classes directly in template

  render() {
    return html`
      <div class="grid grid-cols-5 gap-2">
        <!-- Tailwind classes work here! -->
      </div>
    `;
  }
}
```

## Why Light DOM

- ✅ Tailwind CSS classes work without rewriting as scoped styles
- ✅ No need to translate 200+ lines of CSS per component
- ✅ Styling matches parent document automatically
- ✅ Simpler code and faster development

## When Creating Components

1. Always add `createRenderRoot() { return this; }` method
2. Never add `static styles` property
3. Use Tailwind utility classes directly in templates
4. Reference: `frontend/components/curate-home-tab.js` for pattern

## Anti-Pattern (DO NOT USE)

```javascript
// ❌ WRONG - Don't use Shadow DOM
export class MyComponent extends LitElement {
  static styles = css`...`; // DON'T DO THIS

  render() {
    return html`...`;
  }
}
```
