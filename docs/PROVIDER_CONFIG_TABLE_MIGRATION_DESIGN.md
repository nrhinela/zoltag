# Provider Config Table Migration Design

## Goal

Move provider configuration out of `tenants.settings` into a first-class table that:

- supports multiple providers of the same type per tenant,
- includes a human label per provider,
- preserves backward compatibility during rollout,
- keeps a flexible JSON field for provider-specific and future fields.

`tenants.settings` remains during migration as a compatibility layer.

## Current State (Problem)

Provider config is split across:

- `tenants.settings` keys like:
  - `sync_source_provider`
  - `dropbox_sync_folders`
  - `gdrive_sync_folders`
  - `dropbox_oauth_mode`
  - `gdrive_client_id`
  - `gdrive_client_secret`
  - `gdrive_token_secret`
- `tenants.dropbox_app_key`
- Secret Manager naming conventions (`dropbox-token-{scope}`, etc.)

This makes multi-provider support hard and creates drift risk between code paths.

## Proposed Data Model

New table: `tenant_provider_integrations`

```sql
create table tenant_provider_integrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  provider_type varchar(32) not null, -- dropbox, gdrive, future providers
  label varchar(128) not null,         -- human label, e.g. "Main Dropbox"
  is_active boolean not null default true,
  is_default_sync_source boolean not null default false,
  secret_scope varchar(255) not null,  -- scope for secret naming
  config_json jsonb not null default '{}'::jsonb, -- provider-specific config
  legacy_mirror_json jsonb not null default '{}'::jsonb, -- optional compatibility mirror
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index uq_tpi_tenant_type_label
  on tenant_provider_integrations (tenant_id, provider_type, lower(label));

create unique index uq_tpi_tenant_default_sync_source
  on tenant_provider_integrations (tenant_id)
  where is_default_sync_source = true;

create index ix_tpi_tenant_type on tenant_provider_integrations (tenant_id, provider_type);
```

## Config JSON Shape (Initial)

Suggested `config_json` examples:

- Dropbox
  - `oauth_mode`: `"managed"`
  - `sync_folders`: `["/Archive - Photo/Events"]`
  - `app_key`: `"..."` (optional metadata for display/audit)
  - `token_secret_name`: `"dropbox-token-..."`
  - `app_secret_name`: `"dropbox-app-secret-..."`

- Google Drive
  - `sync_folders`: `["folder-id-1"]`
  - `client_id`: `"..."` (or keep external and only store ref)
  - `client_secret_name`: `"gdrive-client-secret-..."`
  - `token_secret_name`: `"gdrive-token-..."`

`legacy_mirror_json` is optional but useful to store old key mappings while dual-writing.

## Secret Scope Strategy

To avoid breaking existing tenants:

- Backfilled primary provider row uses existing tenant scope (`tenants.key_prefix`, fallback `tenants.id`).
- New additional provider rows use per-provider scope (recommended: provider row `id`).

This keeps existing secrets valid while allowing multiple providers of same type.

## Read/Write Compatibility Strategy

Introduce one resolver service (single source of truth), e.g.:

- `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/integrations/repository.py`

Rules:

1. Read path:
- Prefer `tenant_provider_integrations`.
- If missing, fall back to legacy `tenants.settings` + existing columns.

2. Write path (during migration):
- Write to `tenant_provider_integrations`.
- Also mirror key fields into `tenants.settings` for old code paths.

3. Default sync source:
- New: `is_default_sync_source = true` row.
- Legacy mirror: keep `tenants.settings.sync_source_provider` synchronized.

## Key Mapping

From legacy to new:

- `tenants.settings.sync_source_provider`
  -> row with `is_default_sync_source = true` and matching `provider_type`
- `tenants.settings.dropbox_sync_folders`
  -> Dropbox row `config_json.sync_folders`
- `tenants.settings.gdrive_sync_folders`
  -> GDrive row `config_json.sync_folders`
- `tenants.settings.dropbox_oauth_mode`
  -> Dropbox row `config_json.oauth_mode`
- `tenants.settings.gdrive_client_id`
  -> GDrive row `config_json.client_id`
- `tenants.settings.gdrive_client_secret`
  -> GDrive row `config_json.client_secret_name`
- `tenants.settings.gdrive_token_secret`
  -> GDrive row `config_json.token_secret_name`
- `tenants.dropbox_app_key`
  -> Dropbox row `config_json.app_key` (and optionally keep column in sync until cleanup)

## Rollout Plan (No-Break)

### Phase 1: Schema + Repository

- Add Alembic migration for `tenant_provider_integrations`.
- Add repository/resolver API.
- No behavior change yet.

### Phase 2: Backfill

- One-time backfill script:
  - Create one Dropbox row per tenant (label: `"Default Dropbox"`).
  - Create one GDrive row per tenant if any GDrive config exists.
  - Set `is_default_sync_source` from legacy `sync_source_provider`.
  - Populate `secret_scope` from `tenants.key_prefix` fallback `tenants.id`.
- Idempotent and safe to re-run.

### Phase 3: Dual Read + Dual Write

- Update these paths to read from repository first, fallback legacy:
  - `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/routers/admin_integrations.py`
  - `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/routers/sync.py`
  - `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/storage/providers.py`
  - `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/routers/dropbox.py`
  - `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/routers/gdrive.py`
  - CLI sync paths in `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/cli.py` and `/Users/ned.rhinelander/Developer/zoltag/src/zoltag/cli/commands/sync.py`
- Update admin writes to write both new table and legacy fields.

### Phase 4: Switch Primary to New Table

- Feature flag: `INTEGRATIONS_V2_PRIMARY=true`.
- Keep legacy mirrors and fallback for at least one release.

### Phase 5: Legacy Cleanup

- Remove fallback reads.
- Stop dual-write.
- Drop legacy provider keys from `tenants.settings` in a later migration.
- Optionally deprecate `tenants.dropbox_app_key` if fully represented in `config_json`.

## API Evolution

Keep current endpoints working, but internally route through repository.

Add V2 generic endpoints:

- `GET /api/v1/admin/integrations/providers`
- `POST /api/v1/admin/integrations/providers`
- `PATCH /api/v1/admin/integrations/providers/{provider_id}`
- `DELETE /api/v1/admin/integrations/providers/{provider_id}`
- `POST /api/v1/admin/integrations/providers/{provider_id}/connect`
- `DELETE /api/v1/admin/integrations/providers/{provider_id}/connection`

Legacy endpoints remain as adapters to default provider of each type.

## UI/CLI Compatibility

UI:

- Keep existing Providers UI behavior for default rows.
- Add label selector once multiple rows exist.

CLI:

- Keep existing default behavior.
- Add optional flags:
  - `--provider-id <uuid>`
  - `--provider-label "<label>"`
- If omitted, resolve default sync provider row.

## Observability and Safety

Add metrics/logs:

- provider resolution source: `new_table` vs `legacy_fallback`
- dual-write success/failure counts
- OAuth connect/disconnect success by provider row id
- mismatch detector job comparing legacy keys vs table values

## Rollback Plan

If issues occur:

- Flip feature flag to legacy-primary reads.
- Keep writes to legacy fields.
- New table data remains for later retry.
- No destructive rollback needed.

## Recommended Immediate Next Step

Implement Phase 1 and Phase 2 first, with feature flag off by default, then run backfill in staging and verify status/connect/sync flows before enabling V2 reads.
