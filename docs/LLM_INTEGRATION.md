# LLM Integration Guide

This document explains how PhotoCat ensures consistent architectural patterns across different LLM tools (Claude Code, Continue.dev, Cursor, Copilot, etc.).

## Documentation Ecosystem

PhotoCat maintains a **multi-layered documentation strategy** to support different LLM tools:

### Layer 1: Core Documentation (All LLMs)
- **[CLAUDE.md](../CLAUDE.md)**: Comprehensive architectural guidelines
  - Component patterns (Light DOM, State Controllers)
  - Image rendering standardization
  - File organization rules
  - Token efficiency tips

- **[README.md](../README.md)**: Project overview and setup
  - Architecture overview
  - Technology stack
  - Development workflow
  - Deployment instructions

### Layer 2: Detailed Guides (Reference Documentation)
- **[docs/MODULARIZATION_PLAN.md](./MODULARIZATION_PLAN.md)**: Complete refactoring strategy
  - Phase 1 (Frontend) - Complete
  - Phase 2 (Backend) - Planned
  - Milestone-based approach
  - Session notes and decisions

- **[docs/STATE_CONTROLLER_MIGRATION.md](./STATE_CONTROLLER_MIGRATION.md)**: State extraction guide
  - 5-phase migration process
  - Common patterns and troubleshooting
  - Anti-patterns to avoid
  - Success metrics

### Layer 3: Tool-Specific Integration

#### Continue.dev Rules (`.continue/rules/`)
Automatically applied rules for Continue.dev users:

1. **[lit-light-dom.md](../.continue/rules/lit-light-dom.md)**
   - Enforces Light DOM pattern for all Lit components
   - Applies to: `frontend/components/**/*.js`

2. **[state-controllers.md](../.continue/rules/state-controllers.md)**
   - State controller architecture patterns
   - Decision criteria (when to extract vs. keep)

3. **[image-rendering-pattern.md](../.continue/rules/image-rendering-pattern.md)**
   - Standardized image display with selection/drag/rating
   - Complete template pattern

4. **[file-size-modular.md](../.continue/rules/file-size-modular.md)**
   - Target file sizes for LLM compatibility
   - Modularization guidelines

5. **[token-efficiency.md](../.continue/rules/token-efficiency.md)**
   - Optimize LLM token usage
   - Search strategies and entry points

See [.continue/rules/README.md](../.continue/rules/README.md) for complete list.

#### Claude Code Integration
- Reads `CLAUDE.md` automatically (injected into system prompt)
- Comprehensive architectural context
- Updated with Phase 1 patterns (Milestone 5)

#### Other LLM Tools (Cursor, Copilot, etc.)
**Recommended approach:**
1. Reference `CLAUDE.md` as primary architectural guide
2. Check `.continue/rules/*.md` for specific patterns
3. Review `docs/MODULARIZATION_PLAN.md` for context

## How Documentation Flows

```
┌─────────────────────────────────────────────────────────────┐
│                    Architecture Decision                     │
│                  (e.g., State Controllers)                   │
└────────────────────────┬────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
    CLAUDE.md    Continue.dev Rule   Migration Guide
    (Pattern)      (Enforcement)      (How-To)
         │               │               │
         └───────────────┼───────────────┘
                         │
                         ▼
              All LLM Tools Apply Pattern
```

## Keeping Documentation Synchronized

When adding new architectural patterns:

### Step 1: Document in CLAUDE.md
```markdown
### New Pattern Name

**IMPORTANT**: Brief description

**When to use**: ...
**Pattern**: Code example
**Benefits**: ...
```

### Step 2: Create Continue.dev Rule
```markdown
---
globs: "relevant/path/**/*.ext"
description: Brief enforcement description
alwaysApply: true
---

# Pattern details with examples
```

### Step 3: Update Migration Guide (if applicable)
For complex patterns requiring multi-step extraction, create detailed guide in `docs/`.

### Step 4: Update This Document
Add new pattern to the ecosystem map above.

## Current Architecture Patterns

### ✅ Documented and Enforced

1. **Light DOM for Lit Components**
   - CLAUDE.md: Section "LitElement Components - Use Light DOM"
   - Continue rule: `lit-light-dom.md`
   - Why: Tailwind CSS compatibility

2. **State Controller Pattern**
   - CLAUDE.md: Section "State Controller Architecture"
   - Continue rule: `state-controllers.md`
   - Migration guide: `STATE_CONTROLLER_MIGRATION.md`
   - Why: Complex state management, testability

3. **Standardized Image Rendering**
   - CLAUDE.md: Section "Standardized Image Rendering Pattern"
   - Continue rule: `image-rendering-pattern.md`
   - Why: Consistent UX, prevents bugs, reusable code

4. **File Size and Modularity**
   - CLAUDE.md: "Keep filesizes modular and small"
   - Continue rule: `file-size-modular.md`
   - Plan: `MODULARIZATION_PLAN.md`
   - Why: LLM compatibility

5. **Token Efficiency**
   - CLAUDE.md: Section "Token Efficiency"
   - Continue rule: `token-efficiency.md`
   - Why: Optimize LLM context usage

### 🚧 Planned Patterns

Future patterns will follow the same documentation flow:
1. Establish pattern through implementation
2. Document in CLAUDE.md
3. Create Continue.dev rule
4. Add migration guide if complex
5. Update this ecosystem map

## Benefits of This Approach

### For Developers
- ✅ Clear architectural guidelines regardless of LLM tool used
- ✅ Automatic enforcement through Continue.dev rules
- ✅ Step-by-step migration guides for complex patterns
- ✅ Centralized source of truth (CLAUDE.md)

### For LLM Tools
- ✅ Consistent patterns across all interactions
- ✅ Token-efficient context loading
- ✅ Specific examples and anti-patterns
- ✅ File-scoped rule application (via globs)

### For Project Health
- ✅ Maintainable codebase (small, focused files)
- ✅ Testable architecture (isolated state controllers)
- ✅ Consistent UX (standardized patterns)
- ✅ Reduced technical debt (enforced best practices)

## Validation

To ensure documentation is synchronized:

### Manual Checks
1. New pattern in CLAUDE.md? → Create Continue rule
2. Complex extraction? → Create migration guide
3. Architecture change? → Update all layers

### Automated Checks (Future)
- Script to verify CLAUDE.md patterns have corresponding Continue rules
- CI check for documentation completeness
- Link validation between documents

## References

- **Primary**: [CLAUDE.md](../CLAUDE.md) - All architectural patterns
- **Continue.dev**: [.continue/rules/](../.continue/rules/) - Enforced rules
- **Migration**: [docs/STATE_CONTROLLER_MIGRATION.md](./STATE_CONTROLLER_MIGRATION.md)
- **Strategy**: [docs/MODULARIZATION_PLAN.md](./MODULARIZATION_PLAN.md)

---

**Document Version**: 1.0
**Last Updated**: 2026-02-09
**Maintainer**: Development Team
