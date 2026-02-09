# Continue.dev Rules for PhotoCat

This directory contains coding standards and architectural guidelines that Continue.dev (and other LLM-based tools) will automatically apply when working with this codebase.

## Active Rules

### 1. **eslint-rules.md**
- Enforces ESLint configuration from `.eslintrc.json`
- Applies to: All JavaScript files
- Key standards: 2-space indent, camelCase, const over let

### 2. **lit-light-dom.md**
- All LitElement components MUST use Light DOM (not Shadow DOM)
- Applies to: `frontend/components/**/*.js`
- Why: Maintains access to Tailwind CSS classes without CSS translation

### 3. **state-controllers.md**
- Complex state management uses ReactiveController pattern
- Applies to: `frontend/components/**/*.js`
- When to use: 10+ methods, shared state, coordination needs
- When NOT to use: Simple state, factory patterns, < 50 lines

### 4. **image-rendering-pattern.md**
- Standardized image rendering with selection/drag/rating support
- Applies to: All components displaying images
- Reference: `frontend/components/search-tab.js`
- Required: `createSelectionHandlers`, proper event bindings

### 5. **file-size-modular.md**
- Keep files small for LLM compatibility
- Target sizes: Components 400-800 lines, State 500-600 lines
- Current status: Frontend modularized, Backend Phase 2 pending

### 6. **token-efficiency.md**
- Optimize LLM token usage when working with codebase
- Prefer: Grep → targeted reads over full file reads
- Know entry points and file organization

## How Continue.dev Uses These Rules

1. **Automatic Application**: Rules with `alwaysApply: true` are injected into every LLM context
2. **Glob Filtering**: Rules with `globs` only apply to matching files
3. **Consistent Standards**: Ensures all LLM interactions follow project architecture

## For Other LLM Tools

These rules document the core architectural patterns of PhotoCat. Other LLM tools (Cursor, Copilot, etc.) can reference these files to maintain consistency:

- **Architecture**: State controllers, Light DOM, image rendering
- **File Organization**: Where to find components, state, shared utilities
- **Best Practices**: Token efficiency, modular file sizes, standardized patterns

## References

- **CLAUDE.md**: Complete component architecture documentation
- **docs/MODULARIZATION_PLAN.md**: Full refactoring strategy
- **docs/STATE_CONTROLLER_MIGRATION.md**: State extraction guide
- **README.md**: Project overview and setup

## Maintaining These Rules

When adding new architectural patterns:

1. Document in `CLAUDE.md` first
2. Create Continue.dev rule in this directory
3. Include code examples and anti-patterns
4. Update this README

This ensures both Claude Code and Continue.dev benefit from architectural decisions.
