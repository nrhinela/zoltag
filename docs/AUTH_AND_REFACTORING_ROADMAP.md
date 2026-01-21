# Authentication & Refactoring Coordination Plan

**Status**: Recommended integration strategy for sequential implementation

---

## Executive Summary

The **refactoring and authentication initiatives are compatible and mutually beneficial**. Recommended approach:

1. **Phase 1** (Foundation - 3-4 days): Utilities extraction, no auth needed
2. **Auth Foundation Sprint** (2-3 days): NEW - Set up auth models, dependencies, migrations
3. **Phase 2** (Backend refactoring - 5-7 days): Now aware of auth architecture
4. **Phase 3** (Frontend refactoring - 4-6 days): Include auth UI components
5. **Phase 4** (Polish - 2-3 days): Tests, docs, benchmarking

**Total timeline**: 16-23 days (vs 14-20 without auth foundation)

---

## Why These Don't Conflict

### Current State
- **Authentication**: X-Tenant-ID header (tenant lookup only, no user auth)
- **Refactoring**: Monolithic components, code duplication, N+1 queries

### Design Property: They're Orthogonal
- Refactoring restructures **code organization** (utilities, functions, components)
- Authentication adds **access control layer** (user + tenant membership)
- These are **independent concerns** → can add auth on top of refactored code

**Analogy**: Refactoring is like restructuring a house (moving walls). Authentication is like installing locks. Neither prevents the other.

---

## Phase-by-Phase Impact Analysis

### Phase 1: Foundation (3-4 days) - NO AUTH CHANGES
✅ **Zero impact from planned authentication**

Work items:
- Extract db_utils.py (database utilities)
- Split api.js (frontend services)
- Extract filters.js (UI helpers)
- Extract exif_helpers.py (EXIF utilities)

These are library code—completely independent of auth.

### Auth Foundation Sprint (2-3 days) - NEW AFTER PHASE 1
🆕 **Insert here instead of jumping to Phase 2**

Why insert here:
- Phase 1 utilities are complete, safe to deploy
- Phase 2 will refactor endpoints → better to know auth architecture first
- Gives time to test auth models before Phase 2 changes

Work items:
```
1. Create src/photocat/auth/ directory structure:
   ├── __init__.py
   ├── config.py (Firebase Admin SDK init)
   ├── dependencies.py (get_current_user, require_role)
   ├── models.py (UserProfile, UserTenant, Invitation - SQLAlchemy)
   └── schemas.py (Pydantic models for requests/responses)

2. Create Alembic migration:
   - user_profiles table
   - user_tenants table
   - invitations table

3. Update dependencies.py (existing):
   - Keep get_tenant() for backward compat
   - Add get_current_user() for new auth
   - Update get_db() if needed

4. Create routers/auth.py:
   - POST /auth/register (create user_profile)
   - POST /auth/login (verify Firebase token)
   - GET /auth/me (return current user + tenants)
   - POST /auth/accept-invitation

5. Don't change existing endpoints yet
   - They still use get_tenant()
   - Phase 2 will gradually migrate them
```

**Key property**: Auth foundation is isolated. Existing code still works unchanged.

### Phase 2: Backend Refactoring (5-7 days) - AWARE OF AUTH
✅ **Improved by knowing auth architecture in advance**

Refactoring items (unchanged):
- CLI decomposition (2 days)
- Query optimization (2 days)
- list_images refactor (1.5 days)

**Auth awareness benefit**:
When refactoring endpoints, can optionally add auth:
```python
# Before (current - will still work):
@router.get("/images")
async def list_images(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),  # From header
    ...
):
    # X-Tenant-ID header required

# After (refactored - can add auth):
@router.get("/images")
async def list_images(
    db: Session = Depends(get_db),
    user: UserProfile = Depends(get_current_user),  # From token
    tenant: Tenant = Depends(get_tenant_for_user),  # From user membership
    ...
):
    # Firebase token required + membership check
```

**Important**: Refactoring itself doesn't require auth. Auth is optional addition during Phase 2.

### Phase 3: Frontend Refactoring (4-6 days) - INCLUDES AUTH UI
✅ **Natural place to add auth components**

Refactoring items:
- Decompose photocat-app.js into containers (3-4 days)
- Extract filter helpers (0.5 days)
- Consolidate image editor (1 day)

**Auth additions** (already in plan):
- Create LoginPage component (~150 lines)
- Create TenantSelector component (~200 lines)
- Update api.js to include Authorization header
- Create firebase.js service
- Create auth.js service

These slots naturally into Phase 3 alongside component decomposition.

### Phase 4: Polish (2-3 days) - AUTH TESTS INCLUDED
✅ **Extended testing to include auth scenarios**

Testing work:
- Query builder tests (2 days - existing plan)
- Component tests (1 day)
- **New**: Auth endpoint tests (0.5 day)
- **New**: Auth + refactored endpoint tests (0.5 day)

---

## Timeline Comparison

### Option A: Refactoring THEN Auth (Sequential)
```
Week 1:
  Phase 1: Foundation (3-4 days)
  Auth Foundation (2-3 days) ← NEW

Week 2:
  Phase 2: Backend refactor (5-7 days)

Week 3:
  Phase 3: Frontend refactor (4-6 days)

Week 4:
  Phase 4: Polish (2-3 days)

Total: 4-5 weeks, all coordinated
Result: Refactored codebase + auth system ready to deploy together
```

### Option B: Refactoring THEN Auth (Deferred)
```
Week 1-2:
  Phase 1-4: Complete refactoring

Week 3-5:
  Auth Foundation + integration
  Risk: Must retrofit auth into already-refactored code
  Problem: May need to modify refactored endpoints again
```

### Option C: Auth THEN Refactoring
```
Week 1-2:
  Auth Foundation + core endpoints
  Problem: Build auth before cleaning up code duplication
  Problem: X-Tenant-ID approach still in place during refactoring
```

**Recommendation**: **Option A** (Refactoring → Auth Foundation → Phase 2-4)

---

## File Impact Summary

### Phase 1 (No auth changes)
- NEW: src/photocat/config/db_utils.py
- NEW: frontend/services/images.js, lists.js, keywords.js, etc.
- NEW: frontend/services/filters.js
- NEW: src/photocat/utils/exif_helpers.py
- MODIFY: api.js (split, not changed functionally)

### Auth Foundation Sprint
- NEW: src/photocat/auth/__init__.py
- NEW: src/photocat/auth/config.py
- NEW: src/photocat/auth/dependencies.py
- NEW: src/photocat/auth/models.py
- NEW: src/photocat/auth/schemas.py
- NEW: src/photocat/routers/auth.py
- NEW: Alembic migration for auth tables
- NO CHANGES to existing endpoints or models

### Phase 2 (Can optionally add auth)
- MODIFY: src/photocat/cli.py → src/photocat/cli/
- MODIFY: src/photocat/routers/filtering.py
- MODIFY: src/photocat/routers/images/core.py
- NEW: src/photocat/routers/images/query_builder.py
- OPTIONAL: Add auth to endpoints as you refactor them

### Phase 3 (Includes auth UI)
- NEW: frontend/components/containers/HomeContainer.js
- NEW: frontend/components/containers/CurateContainer.js
- NEW: frontend/components/containers/MlContainer.js
- NEW: frontend/components/containers/AdminContainer.js
- NEW: frontend/services/firebase.js
- NEW: frontend/services/auth.js
- NEW: frontend/components/login-page.js
- NEW: frontend/components/tenant-selector.js
- MODIFY: frontend/components/photocat-app.js (decompose)
- MODIFY: frontend/services/api.js (add auth headers)

### Phase 4 (Testing)
- NEW: tests/test_query_builder.py (refactor tests)
- NEW: tests/test_auth.py (auth tests)
- NEW: tests/test_containers.py (component tests)

---

## Dependency Graph

```
Phase 1 (Foundation)
    ↓
Auth Foundation Sprint
    ↓
Phase 2 (Backend) ← Can add auth to endpoints here
    ↓
Phase 3 (Frontend) ← Add auth UI here
    ↓
Phase 4 (Polish) ← Auth + refactor tests
```

**Key property**: Each phase depends on previous, but not tightly coupled.

---

## Migration Strategy for Existing Endpoints

### Before Refactoring (Today)
```python
@router.get("/images")
async def list_images(
    tenant: Tenant = Depends(get_tenant),  # From X-Tenant-ID header
    db: Session = Depends(get_db),
):
    # Only tenant isolation, no user authentication
```

### After Auth Foundation Sprint (Ready)
```python
@router.get("/images")
async def list_images(
    tenant: Tenant = Depends(get_tenant),  # Still works for backward compat
    db: Session = Depends(get_db),
):
    # X-Tenant-ID still works
```

### During Phase 2 Refactoring (Optional)
```python
@router.get("/images")
async def list_images(
    user: UserProfile = Depends(get_current_user),  # NEW: From Firebase token
    tenant: Tenant = Depends(get_tenant_for_user),  # NEW: From user membership
    db: Session = Depends(get_db),
):
    # Check user has access to tenant
    # Firebase token required, X-Tenant-ID optional for backward compat
```

### Result: Zero Breaking Changes
- Old clients using X-Tenant-ID continue to work
- New clients can use Firebase tokens
- Gradual migration path for existing users

---

## Recommendations

### 1. **Do Refactoring + Auth Together** (Recommended)
- Insert Auth Foundation Sprint after Phase 1
- Total 16-23 days instead of separate 14-20 day + 5-10 day effort
- Coordinated codebase makes future work easier

### 2. **Collect Baseline Metrics** (Before Phase 1)
- Current query count for list_images
- Current response time
- Current memory usage
- Will validate 3-4x performance improvement

### 3. **Define X-Tenant-ID Deprecation** (Before Auth Foundation)
- Keep working for backward compat: yes
- Set sunset date: 3 months after auth launch?
- Plan client migration: gradual or all-at-once?

### 4. **Clarify Auth Rollout** (Before Phase 3)
- Phase-in auth UI gradually? (Separate login flow vs inline?)
- Require auth on all endpoints, or optional? (Recommend required from day 1)
- Admin approval before user can access? (Yes, recommended)

---

## Risk Assessment

| Phase | Risk | Mitigation |
|-------|------|-----------|
| 1: Foundation | Low | Utilities are additive, don't change code paths |
| Auth Sprint | Low-Medium | Isolated new code, doesn't touch existing endpoints |
| 2: Backend | Medium | Query changes tested with equivalence tests |
| 3: Frontend | Medium-High | Incremental component extraction, E2E tests |
| 4: Polish | Low | Tests validate everything works |

**Overall**: Medium risk, well-mitigated with tests and incremental rollout.

---

## Questions Before Starting

1. **Timeline**: Sequential over 4-5 weeks, or split across longer period?
2. **Auth UI**: Separate login page, or integrate into main app?
3. **User approval**: Automatic or manual admin approval for registrations?
4. **X-Tenant-ID**: Deprecate immediately after auth, or keep indefinitely?
5. **CLI commands**: Will CLI need auth (service account), or stay unauthenticated?

---

## Conclusion

**Authentication and refactoring are not only compatible, they're complementary.**

- Refactoring **creates space** for auth to be cleanly integrated
- Auth foundation **stabilizes** during refactoring work
- Together they deliver a **modern, scalable foundation** for PhotoCat

Recommended approach: **Sequential implementation with Auth Foundation Sprint inserted after Phase 1**.
