# Permissions RBAC Implementation Status

## Scope
Implement tenant-configurable RBAC from `/Users/ned.rhinelander/Developer/zoltag/docs/PERMISSIONS_RBAC_DESIGN.md`:

- tenant-scoped roles,
- role-to-permission mappings,
- permission-based backend authorization,
- permission-driven frontend gating and admin management UI.

## Status Legend
- `Not Started`
- `In Progress`
- `Completed`
- `Blocked`

## Milestones

| Milestone | Description | Status | Notes |
| --- | --- | --- | --- |
| M0 | Plan + tracker created | Completed | Design doc approved; this tracker is the source of truth |
| M1 | Schema migration: RBAC tables + membership role FK | Completed | Applied via Alembic (`202602171900`) |
| M2 | Seed + backfill | Completed | Applied via Alembic (`202602171930`) |
| M3 | Permission resolver service + feature flags | Completed | Resolver + cache + flags added; invalidation hooks wired on membership mutations |
| M4 | Auth payload extension (`/auth/me`) | Completed | `role_key`, `role_label`, and `permissions` now included per tenant membership when flag enabled |
| M5 | Backend authorization migration | Completed | Router-level tenant role dependencies replaced with permission checks (`image.*`, `provider.*`, `tenant.users.*`, `tenant.jobs.*`, `tenant.settings.manage`) |
| M6 | Frontend permission gating migration | Completed | Core shell/header/library/list gates now use shared permission helper with role fallback |
| M7 | Tenant admin Roles & Permissions UI | Completed | Tenant users screen supports role list/create/edit/delete + permission mapping, with scroll-safe permissions UI and explicit disabled tab guardrails |
| M8 | Legacy role cleanup | In Progress | Removed permission fallback checks; remaining legacy role fields/paths still present |

## Workstreams & Checklist

### Database / Migration
- [x] Create Alembic migration for RBAC tables
- [x] Add indexes/constraints from design
- [x] Add `tenant_role_id` FK on `user_tenants`
- [x] Seed global permission catalog
- [x] Seed system roles (`user`, `editor`, `admin`) per tenant
- [x] Backfill all existing memberships
- [x] Add rollback-safe downgrade path

### Backend Authorization
- [x] Add permission resolver service
- [x] Add `require_tenant_permission_from_header(...)`
- [x] Add resolver caching + invalidation hooks
- [x] Add feature flags: `RBAC_PERMISSIONS_ENABLED`, `RBAC_AUTH_ME_PERMISSIONS`
- [x] Migrate pilot endpoint (`image.rate`)
- [x] Migrate remaining admin/image/list capabilities

### API / Contracts
- [x] Extend `/api/v1/auth/me` with effective permissions
- [x] Add roles/permissions admin endpoints
- [x] Add membership role assignment by `role_id`/`role_key`
- [x] Preserve compatibility responses during dual-mode phase

### Frontend
- [x] Add permission state model and helpers
- [x] Switch UI gates from role-string checks to permission checks
- [x] Add tenant admin Roles & Permissions screens
- [x] Update tenant user edit flow to role assignment model
- [x] Add UX guardrails (disable with explanation, not silent hide where needed)

### Testing / Verification
- [ ] Unit tests for resolver + dependency checks
- [ ] API tests for permission-gated endpoints
- [ ] UI tests for gating behavior
- [ ] Migration/backfill validation in local + staging
- [ ] Regression check: current behavior unchanged before custom edits

## Implementation Order
1. M1 Schema migration
2. M2 Seed/backfill
3. M3 Resolver + flags
4. M4 `/auth/me` permissions
5. M5 Pilot permission gate (`image.rate`)
6. M6 Frontend gating
7. M7 Roles UI
8. M8 Cleanup

## Risks / Watchlist
- Role/permission drift during dual-mode authorization.
- Missing frontend gates where backend gate changed.
- Cache invalidation lag after role changes.
- Tenant data edge cases during backfill.

## Update Protocol
I will update this file at each meaningful step by:
- changing milestone status,
- checking completed checklist items,
- appending a dated progress log entry.

## Progress Log
- 2026-02-17: Created RBAC implementation tracker; no code changes for RBAC yet.
- 2026-02-17: Implemented M1 migration `/Users/ned.rhinelander/Developer/zoltag/alembic/versions/202602171900_add_rbac_permissions_tables.py`.
- 2026-02-17: Implemented M2 migration `/Users/ned.rhinelander/Developer/zoltag/alembic/versions/202602171930_seed_rbac_defaults_and_backfill.py`.
- 2026-02-17: Applied RBAC migrations successfully to local DB (`alembic current` => `202602171930 (head)`).
- 2026-02-17: Implemented M3 in code: RBAC feature flags in `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/settings.py`; permission resolver/cache + `require_tenant_permission_from_header(...)` in `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/auth/dependencies.py`; cache invalidation hooks in `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/routers/admin_users.py`.
- 2026-02-17: Started M5 backend auth migration with pilot endpoint `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/routers/images/rating.py` now gated by `image.rate`.
- 2026-02-17: Completed M4 auth payload extension: `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/routers/auth.py` now emits per-tenant `role_key`, `role_label`, and `permissions` fields in `/auth/me` when `RBAC_AUTH_ME_PERMISSIONS=true`.
- 2026-02-17: Expanded M5 permission-gated endpoints: `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/routers/images/notes.py` (`image.note.edit`), `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/routers/images/asset_variants.py` (`image.variant.manage`), and `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/routers/images/permatags.py` (`image.tag`).
- 2026-02-17: Added RBAC admin APIs in `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/routers/admin_roles.py`: `GET /admin/permissions/catalog`, `GET/POST/PATCH/DELETE /admin/roles`, `PUT /admin/roles/{role_id}/permissions`.
- 2026-02-17: Upgraded tenant-user role assignment endpoint in `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/routers/admin_users.py` to accept `role_id`/`role_key` while keeping legacy `role` compatibility.
- 2026-02-17: Switched tenant-user and invitation authorization checks in `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/routers/admin_users.py` to permission-aware validation (`tenant.users.view`/`tenant.users.manage`) with legacy fallback via resolver.
- 2026-02-17: Membership creation/update flows now hydrate `user_tenants.tenant_role_id` in `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/routers/admin_users.py` and `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/routers/auth.py`.
- 2026-02-17: Started M6 frontend migration: permission-aware gate helpers added in `/Users/ned.rhinelander/Developer/zoltag/frontend/components/state/app-shell-state.js` and `/Users/ned.rhinelander/Developer/zoltag/frontend/components/app-header.js`; library tab gate derivation now permission-aware in `/Users/ned.rhinelander/Developer/zoltag/frontend/components/render/aux-tab-content.js` with legacy-role fallback.
- 2026-02-17: Added frontend API wrappers for RBAC management endpoints in `/Users/ned.rhinelander/Developer/zoltag/frontend/services/api.js`.
- 2026-02-17: Completed backend migration to permission dependencies for remaining legacy role-gated routers: `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/routers/jobs.py`, `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/routers/admin_keywords.py`, `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/routers/images/tagging.py`, and `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/routers/images/core.py`.
- 2026-02-17: Tenant users frontend now assigns memberships using `role_key` payload and surfaces tenant role labels from RBAC role metadata in `/Users/ned.rhinelander/Developer/zoltag/frontend/components/tenant-users-admin.js`.
- 2026-02-17: Validation pass succeeded with Python compile checks and frontend production build (`npm run build`).
- 2026-02-17: Extended tenant Roles UI to include inactive role loading + custom role deletion flow in `/Users/ned.rhinelander/Developer/zoltag/frontend/components/tenant-users-admin.js`.
- 2026-02-17: List visibility "admin" resolution now uses effective RBAC permission `tenant.settings.manage` (with role fallback via resolver) in `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/list_visibility.py`, and corresponding frontend tab gating updated in `/Users/ned.rhinelander/Developer/zoltag/frontend/components/list-editor.js`.
- 2026-02-17: Centralized frontend tenant permission logic via `/Users/ned.rhinelander/Developer/zoltag/frontend/components/shared/tenant-permissions.js` and migrated `/Users/ned.rhinelander/Developer/zoltag/frontend/components/app-header.js`, `/Users/ned.rhinelander/Developer/zoltag/frontend/components/state/app-shell-state.js`, `/Users/ned.rhinelander/Developer/zoltag/frontend/components/render/aux-tab-content.js`, and `/Users/ned.rhinelander/Developer/zoltag/frontend/components/list-editor.js` to shared helpers; validated with `npm run build`.
- 2026-02-17: Completed M7 UX polish: role-permission modal in `/Users/ned.rhinelander/Developer/zoltag/frontend/components/tenant-users-admin.js` is now scroll-safe for long permission catalogs, and library subtab gating in `/Users/ned.rhinelander/Developer/zoltag/frontend/components/render/aux-tab-content.js` now uses disabled tabs + explanatory hint instead of silent hiding; supporting styles added in `/Users/ned.rhinelander/Developer/zoltag/frontend/components/styles/zoltag-app-styles.js`.
- 2026-02-17: Started M8 cleanup by removing backend fallback authorization paths in `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/auth/dependencies.py` (permission checks now always use tenant role-permission mappings) and always emitting permission payloads in `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/routers/auth.py`; frontend fallback-to-role behavior removed in `/Users/ned.rhinelander/Developer/zoltag/frontend/components/shared/tenant-permissions.js`.
- 2026-02-17: Continued M8 cleanup by removing unused role-based dependency factories (`require_tenant_role`, `require_tenant_role_from_header`) from `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/auth/dependencies.py` and retiring obsolete RBAC feature-flag settings fields in `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/settings.py`; verified with Python compile + frontend build.
- 2026-02-17: Migrated remaining role-string admin gating in `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/routers/admin_tenants.py` to permission-based checks (`tenant.settings.manage`) for both tenant-list filtering and tenant admin authorization.
- 2026-02-17: Continued M8 cleanup in `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/routers/admin_users.py`: tenant-user role updates now require RBAC identifiers (`role_key`/`role_id`) for tenant-admin edits, membership role metadata is resolved from `tenant_role` relationship, role-id assignment now validates active tenant role mappings, and legacy role writes are normalized only as compatibility mirror fields; verified with Python compile + frontend build.
- 2026-02-17: Continued M8 cleanup in `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/routers/admin_users.py` for super-admin flows: approved-user tenant memberships now resolve displayed role metadata from RBAC role mapping, and super-admin membership updates now accept RBAC role selectors (`role_key`/`role_id`) while still accepting legacy `role` as input alias for compatibility.
- 2026-02-17: Removed the last backend permission fallback to legacy role strings in `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/auth/dependencies.py` (effective permissions now require `tenant_role_id` mappings), and updated `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/routers/auth.py` to derive membership `role` display from RBAC `role_key` instead of persisting-role fallback.
