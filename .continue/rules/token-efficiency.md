---
description: Token efficiency guidelines for LLM interactions
alwaysApply: true
---

# Token Efficiency Guidelines

Optimize token usage when working with this codebase.

## Reading Files

**Prefer targeted reads over full file reads:**

```javascript
// ✅ GOOD - Read specific line range
Read({ file_path: "file.js", offset: 100, limit: 50 })

// ❌ BAD - Read entire large file when you only need a section
Read({ file_path: "photocat-app.js" }) // 4,425 lines!
```

## Searching Code

**Use Grep/Glob before reading:**

```javascript
// ✅ GOOD - Find location first, then read
Grep({ pattern: "handleFilterChange", output_mode: "files_with_matches" })
// Then read specific file

// ❌ BAD - Read multiple files hoping to find it
Read({ file_path: "file1.js" })
Read({ file_path: "file2.js" })
Read({ file_path: "file3.js" })
```

## Exploration Strategy

**Start specific, expand if needed:**

1. First: Use Grep/Glob for specific searches
2. Then: Read targeted line ranges
3. Only if needed: Use Explore agent for broader research

```javascript
// ✅ GOOD - Specific search
Grep({ pattern: "class.*StateController", glob: "components/state/*.js" })

// ❌ BAD - Vague exploration when you know what you're looking for
Task({ subagent_type: "Explore", prompt: "find state stuff" })
```

## Key Entry Points

Know these to avoid searching:

- **Frontend**: `frontend/main.js` → `frontend/components/photocat-app.js`
- **Backend API**: `src/photocat/api.py`
- **Database models**: `src/photocat/models.py`
- **State controllers**: `frontend/components/state/`
- **Shared utilities**: `frontend/components/shared/`

## File Organization Awareness

Know where to look:

- Components: `frontend/components/*.js`
- State: `frontend/components/state/*.js`
- Shared: `frontend/components/shared/`
- Backend routers: `src/photocat/routers/`
- Models: `src/photocat/models.py`
- Config: `src/photocat/settings.py`

## Anti-Patterns

❌ Reading photocat-app.js without line ranges
❌ Using Explore agent for simple lookups
❌ Reading multiple files without searching first
❌ Not using Grep's `output_mode: "files_with_matches"`

## Best Practices

✅ Use Grep to locate, then Read specific lines
✅ Know the codebase structure (avoid blind searching)
✅ Use line offsets/limits for large files
✅ Batch related searches in parallel
