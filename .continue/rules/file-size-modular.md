---
globs: "**/*.{js,py}"
description: Keep filesizes modular and small for LLM compatibility
alwaysApply: true
---

# File Size and Modularity Guidelines

**Core Principle**: Keep filesizes modular and small because lesser LLMs are using this codebase.

## Target File Sizes

- **Components**: 400-800 lines maximum
- **State Controllers**: 500-600 lines maximum
- **Routers/Endpoints**: 400-600 lines maximum
- **Utilities**: 200-400 lines maximum

## When Files Exceed Limits

If a file exceeds these limits, consider:

1. **State Controller Extraction** (Frontend)
   - Extract complex state to `components/state/` controllers
   - Use ReactiveController pattern
   - See `docs/STATE_CONTROLLER_MIGRATION.md`

2. **Router Extraction** (Backend)
   - Split endpoints by feature domain
   - Extract to separate router files
   - Keep shared utilities in `_shared.py`

3. **Component Splitting** (Frontend)
   - Extract tab-specific logic to separate components
   - Use composition over monolithic components
   - Maintain single responsibility principle

## Current Modularization Status

### Frontend
- ✅ `photocat-app.js`: 4,425 lines (down from 4,602)
  - State extracted to 3 controllers (1,237 lines)
  - Target: Further reduction through component extraction

### Backend
- ⚠️ `src/photocat/routers/images/core.py`: 1,893 lines
  - Target: Split into 6 feature routers (~300 lines each)
  - See Phase 2 in `docs/MODULARIZATION_PLAN.md`

## Benefits of Small Files

- ✅ LLMs can process entire files in context
- ✅ Easier to understand and maintain
- ✅ Reduced merge conflicts
- ✅ Better testability
- ✅ Clear separation of concerns

## Anti-Patterns

❌ Don't create files just to hit a number (extraction must have value)
❌ Don't split well-factored code unnecessarily
❌ Don't extract if it creates thin wrappers with no benefit

## References

- `docs/MODULARIZATION_PLAN.md` - Complete refactoring strategy
- `CLAUDE.md` - Architecture guidelines
