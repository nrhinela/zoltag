# Tenant-Configurable Permissions (RBAC) Design

## Summary

Move from hardcoded role behavior (`user`, `editor`, `admin`) to tenant-configurable RBAC:

- roles are named per tenant,
- permissions are assigned to roles,
- users are assigned tenant roles,
- backend and frontend authorize by permission keys instead of role strings.

This enables decisions like "Can `User` rate items?" to be configured per tenant without code changes.

## Goals

- Keep existing behavior as default on rollout.
- Allow tenant admins (or super admins) to change what each role can do.
- Keep super admin capabilities unchanged.
- Avoid breaking existing endpoints and UI during migration.
- Support future expansion (custom roles, feature toggles, action-level controls).

## Non-Goals (Phase 1)

- ABAC/policy scripting (conditions like time, IP, object owner).
- Per-user exceptions beyond role assignment.
- Cross-tenant shared role templates in first release.

## Current State (Problem)

Authorization is mostly role-threshold based in code (`require_tenant_role_from_header("editor")`, etc). That means:

- capabilities are fixed in code,
- changing behavior requires deploys,
- UI gating can drift from backend checks,
- tenant admins cannot tune permissions for their users.

## Proposed Model

Use tenant-scoped RBAC with a global permission catalog.

### Core Concepts

- `permission`: global key describing one action (e.g., `image.rate`)
- `role`: tenant-scoped named grouping of permissions (e.g., `User`, `Editor`)
- `membership`: user belongs to a tenant and is assigned one role

### Permission Catalog (initial)

Suggested starter keys:

- `image.view`
- `image.rate`
- `image.tag`
- `image.note.edit`
- `image.variant.manage`
- `search.use`
- `curate.use`
- `list.view`
- `list.create`
- `list.edit.own`
- `list.edit.shared`
- `provider.view`
- `provider.manage`
- `tenant.users.view`
- `tenant.users.manage`
- `tenant.jobs.view`
- `tenant.jobs.enqueue`
- `tenant.jobs.manage`
- `tenant.settings.manage`

Notes:

- Keep names action-oriented and stable.
- Do not encode role names in permission keys.

## Data Model

### 1) `permission_catalog` (global)

```sql
create table permission_catalog (
  key varchar(100) primary key,
  description text not null,
  category varchar(50) not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### 2) `tenant_roles` (tenant-scoped roles)

```sql
create table tenant_roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  role_key varchar(50) not null,         -- stable key, e.g. user/editor/admin/custom_...
  label varchar(100) not null,           -- display label
  description text null,
  is_system boolean not null default false, -- true for seeded defaults
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, role_key)
);

create index ix_tenant_roles_tenant_active on tenant_roles (tenant_id, is_active);
```

### 3) `tenant_role_permissions` (role -> permission mapping)

```sql
create table tenant_role_permissions (
  role_id uuid not null references tenant_roles(id) on delete cascade,
  permission_key varchar(100) not null references permission_catalog(key),
  effect varchar(10) not null default 'allow', -- future-proof (allow/deny)
  created_at timestamptz not null default now(),
  primary key (role_id, permission_key)
);

create index ix_role_permissions_permission on tenant_role_permissions (permission_key);
```

### 4) Membership role assignment

Phase 1 path (lowest risk): add role FK to `user_tenants`.

```sql
alter table user_tenants add column tenant_role_id uuid null references tenant_roles(id);
create index ix_user_tenants_role on user_tenants (tenant_role_id);
```

Then backfill from legacy `user_tenants.role` string.

Later cleanup:

- Drop legacy `user_tenants.role` once fully migrated.

## Default Role Seeding

For each tenant, seed system roles:

- `user`
- `editor`
- `admin`

Seed permissions to mirror current behavior exactly.

Examples:

- `user`: view/search/lists read
- `editor`: `user` + rate/tag/notes/curate
- `admin`: `editor` + tenant users/providers/jobs/settings manage

## Authorization Changes

### New dependency

Add permission dependency:

- `require_tenant_permission_from_header("image.rate")`

Behavior:

- super admin bypass,
- resolve membership -> tenant_role -> permissions,
- return 403 when missing.

### Keep compatibility during migration

During rollout:

- permission check first,
- fallback to legacy role threshold only if role mapping absent.

After migration:

- remove fallback and legacy role threshold checks.

## API Changes

### New admin endpoints (tenant scope)

- `GET /api/v1/admin/permissions/catalog`
- `GET /api/v1/admin/roles`
- `POST /api/v1/admin/roles`
- `PATCH /api/v1/admin/roles/{role_id}`
- `DELETE /api/v1/admin/roles/{role_id}` (only non-system roles)
- `PUT /api/v1/admin/roles/{role_id}/permissions` (full replace)
- `PATCH /api/v1/admin/tenant-users/{supabase_uid}/role` (assign role id or role_key)

### Auth payload extension

Extend `GET /api/v1/auth/me` to include:

- active tenant role key/label,
- effective permission list for active tenant.

This drives frontend gating from authoritative backend data.

## Frontend Changes

### Gating

Replace hardcoded checks like `role === "editor"` with permission checks:

- `hasPermission("image.rate")`
- `hasPermission("tenant.users.manage")`

### New UI in Admin

Add "Roles & Permissions" section in tenant admin:

- list roles,
- edit role label/description,
- toggle permission checkboxes,
- assign role on user edit modal.

### UX examples

- If admin removes `image.rate` from `User`, ratings become read-only immediately for users with that role.
- If admin grants `curate.use` to `User`, Curate tab appears for that role.

## Migration Plan

### Phase 1: Schema + seed + backfill

1. Add new RBAC tables and `user_tenants.tenant_role_id`.
2. Seed `permission_catalog`.
3. For each tenant, seed `user/editor/admin` roles and default permission mappings.
4. Backfill each `user_tenants` row to `tenant_role_id` based on current `user_tenants.role`.

### Phase 2: Read path + auth payload

1. Add role/permission resolver service.
2. Extend `/auth/me` with effective permissions.
3. Add admin read endpoints for roles/permissions.

### Phase 3: Dual authorization

1. Start migrating endpoints to permission dependencies.
2. Keep legacy role fallback for endpoints not migrated.

### Phase 4: UI migration

1. Switch frontend gating to permission keys.
2. Release roles editor UI.

### Phase 5: Cleanup

1. Remove legacy role-based gate paths.
2. Drop `user_tenants.role` string column after validation window.

## Rollback Strategy

Safe rollback at any stage:

- keep legacy `user_tenants.role`,
- keep role-based dependencies functional,
- disable new permission checks behind feature flag.

No destructive rollback needed until final cleanup phase.

## Operational Notes

- Cache effective permissions per `(tenant_id, supabase_uid)` with short TTL.
- Invalidate cache on role assignment or role permission updates.
- Add audit logs for:
  - role created/updated/deleted,
  - permission changes on roles,
  - user role assignment changes.

## Recommended Feature Flags

- `RBAC_PERMISSIONS_ENABLED` (backend check path)
- `RBAC_UI_ENABLED` (admin role editor UI)
- `RBAC_AUTH_ME_PERMISSIONS` (payload extension)

## Test Plan (minimum)

- Unit:
  - permission resolver
  - role/permission assignment validation
- API:
  - endpoint authorization by permission
  - role update reflects immediately in access behavior
- UI:
  - controls hide/disable correctly for each permission set
  - role editor save and reload behavior
- Migration:
  - backfill maps existing users correctly
  - no access regression for existing tenants

## Implementation Order Recommendation

1. Backend schema + seed + resolver.
2. Permission-gate one narrow capability first (`image.rate`) as pilot.
3. Extend to users/providers/jobs/settings.
4. Release role editor UI.
5. Remove legacy role checks after a validation window.

