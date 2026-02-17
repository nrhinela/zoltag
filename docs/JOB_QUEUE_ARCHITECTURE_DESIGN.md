# Job Queue Architecture (Multi-Machine, Tenant-Aware)

## Goals
- Run CLI commands asynchronously as durable jobs.
- Support event-triggered jobs (for example, provider folder changes).
- Support scheduled jobs (cron-style, tenant-specific timezone).
- Allow multiple workers on multiple machines to process jobs safely.
- Expose per-tenant queue state and history in the web UI.

## Non-goals (v1)
- Arbitrary shell execution from users.
- Exactly-once execution for every failure mode.
- Cross-region queue replication.

## High-level Architecture
- **Postgres-backed queue (source of truth)**.
- **API control plane** (create/retry/cancel/list jobs; manage triggers/schedules).
- **Scheduler service** (reads schedule rules, enqueues due jobs).
- **Worker service(s)** (poll/claim/run/report job attempts).
- **Event publisher** inside app flows (provider config updates, manual actions).
- **UI pages** for tenant queue + super-admin global operations.

## Why Postgres-first
- Already required by Zoltag.
- Durable queue semantics with transactional claim (`FOR UPDATE SKIP LOCKED`).
- Easy tenant-scoped visibility and auditing.
- No new infrastructure required to ship v1.

## Command Execution Model
- Use an allowlisted **command key**, not raw shell input.
- Map key + validated payload to exact CLI argv:
- `sync-dropbox` -> `zoltag sync-dropbox --tenant-id <uuid>`
- `recompute-trained-tags` -> `zoltag recompute-trained-tags --tenant-id <uuid>`
- `recompute-zeroshot-tags` -> `zoltag recompute-zeroshot-tags --tenant-id <uuid>`
- `train-keyword-models` -> `zoltag train-keyword-models --tenant-id <uuid>`
- Payload is validated against JSON schema attached to the command definition.
- Worker executes subprocess with timeout and captures structured attempt logs.

## Data Model (DDL)
```sql
-- 1) Allowed CLI commands and constraints
create table if not exists job_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,                        -- e.g. "sync-dropbox"
  description text not null default '',
  arg_schema jsonb not null default '{}'::jsonb,  -- JSON Schema
  timeout_seconds integer not null default 3600,
  max_attempts integer not null default 3,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_job_definitions_active on job_definitions(is_active);

-- 2) Trigger rules (event or schedule) per tenant
create table if not exists job_triggers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  label text not null,                              -- human-readable
  is_enabled boolean not null default true,
  trigger_type text not null check (trigger_type in ('event','schedule')),
  event_name text,                                  -- required when trigger_type='event'
  cron_expr text,                                   -- required when trigger_type='schedule'
  timezone text,                                    -- required when trigger_type='schedule'
  definition_id uuid not null references job_definitions(id) on delete restrict,
  payload_template jsonb not null default '{}'::jsonb, -- templated payload from event/schedule context
  dedupe_window_seconds integer not null default 300,
  created_by uuid references user_profiles(supabase_uid) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (trigger_type = 'event' and event_name is not null and cron_expr is null)
    or
    (trigger_type = 'schedule' and cron_expr is not null and timezone is not null and event_name is null)
  )
);

create index if not exists idx_job_triggers_tenant_enabled on job_triggers(tenant_id, is_enabled);
create index if not exists idx_job_triggers_event on job_triggers(event_name) where trigger_type='event';

-- 3) Queue table
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  definition_id uuid not null references job_definitions(id) on delete restrict,
  source text not null check (source in ('manual','event','schedule','system')),
  source_ref text,                                  -- event id, trigger id, request id
  status text not null check (
    status in ('queued','running','succeeded','failed','canceled','dead_letter')
  ) default 'queued',
  priority integer not null default 100,            -- lower means higher priority
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text,                                  -- optional idempotency key
  correlation_id text,                              -- trace request/event grouping
  scheduled_for timestamptz not null default now(), -- when eligible to run
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  lease_expires_at timestamptz,
  claimed_by_worker text,
  last_error text,
  created_by uuid references user_profiles(supabase_uid) on delete set null
);

create index if not exists idx_jobs_queue_scan
  on jobs(status, scheduled_for, priority, queued_at)
  where status='queued';

create index if not exists idx_jobs_tenant_status_time
  on jobs(tenant_id, status, queued_at desc);

create index if not exists idx_jobs_worker_lease
  on jobs(claimed_by_worker, lease_expires_at)
  where status='running';

-- Optional dedupe protection for active jobs (same dedupe key cannot be queued/running twice per tenant)
create unique index if not exists uq_jobs_active_dedupe
  on jobs(tenant_id, dedupe_key)
  where dedupe_key is not null and status in ('queued','running');

-- 4) Attempt-level logs and outcomes
create table if not exists job_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  attempt_no integer not null,
  worker_id text not null,
  pid integer,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  exit_code integer,
  status text not null check (status in ('running','succeeded','failed','timeout','canceled')),
  stdout_tail text,
  stderr_tail text,
  error_text text
);

create unique index if not exists uq_job_attempts_job_attempt on job_attempts(job_id, attempt_no);
create index if not exists idx_job_attempts_job_started on job_attempts(job_id, started_at desc);

-- 5) Worker heartbeat/state
create table if not exists job_workers (
  worker_id text primary key,                      -- stable id (hostname:pid:boot-uuid)
  hostname text not null,
  version text not null default '',
  queues text[] not null default array[]::text[], -- future: queue partitions
  last_seen_at timestamptz not null default now(),
  running_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb
);
```

## Claiming / Leasing Query (multi-worker safe)
```sql
with candidate as (
  select id
  from jobs
  where status = 'queued'
    and scheduled_for <= now()
  order by priority asc, queued_at asc
  limit :batch_size
  for update skip locked
)
update jobs j
set status = 'running',
    started_at = coalesce(j.started_at, now()),
    lease_expires_at = now() + (:lease_seconds || ' seconds')::interval,
    claimed_by_worker = :worker_id,
    attempt_count = j.attempt_count + 1
from candidate c
where j.id = c.id
returning j.*;
```

## Retry / Dead-letter Policy
- On non-zero exit or timeout:
  - if `attempt_count < max_attempts`: set `status='queued'`, bump `scheduled_for` with exponential backoff.
  - else: set `status='dead_letter'`, persist `last_error`.
- On worker crash:
  - watchdog marks stale `running` jobs (expired lease) back to `queued` with jittered delay.

## Event Model
- Event emitter should publish canonical app events such as:
  - `provider.folder.updated`
  - `provider.connection.changed`
  - `list.created`
  - `images.ingest.completed`
- Event handling flow:
  1. Persist event context in app transaction (or outbox table if needed later).
  2. Resolve matching `job_triggers` for tenant and event name.
  3. Render payload template with event context.
  4. Insert `jobs` rows (`source='event'`).

## Scheduler Model
- Scheduler process runs every minute.
- Takes a global advisory lock so only one scheduler instance enqueues:
  - `select pg_try_advisory_lock(<constant_key>)`.
- For each enabled schedule trigger:
  - compute next due run in tenant timezone,
  - enqueue job if due and not deduped in window.

## API Contract (v1)

### Job Definitions (super-admin)
- `GET /api/v1/admin/jobs/definitions`
- `POST /api/v1/admin/jobs/definitions`
- `PATCH /api/v1/admin/jobs/definitions/{definition_id}`

Example create payload:
```json
{
  "key": "sync-dropbox",
  "description": "Sync provider updates for tenant",
  "arg_schema": {
    "type": "object",
    "properties": {
      "provider_id": { "type": "string", "format": "uuid" },
      "path_prefix": { "type": "string" }
    },
    "required": ["provider_id"],
    "additionalProperties": false
  },
  "timeout_seconds": 3600,
  "max_attempts": 3
}
```

### Triggers (tenant admin)
- `GET /api/v1/jobs/triggers`
- `POST /api/v1/jobs/triggers`
- `PATCH /api/v1/jobs/triggers/{trigger_id}`
- `DELETE /api/v1/jobs/triggers/{trigger_id}` (soft-delete optional)

Event trigger payload:
```json
{
  "label": "Resync on folder change",
  "trigger_type": "event",
  "event_name": "provider.folder.updated",
  "definition_key": "sync-dropbox",
  "payload_template": {
    "provider_id": "{{event.provider_id}}",
    "path_prefix": "{{event.folder_path}}"
  },
  "dedupe_window_seconds": 120
}
```

Schedule trigger payload:
```json
{
  "label": "Nightly provider sync",
  "trigger_type": "schedule",
  "cron_expr": "0 2 * * *",
  "timezone": "America/New_York",
  "definition_key": "sync-dropbox",
  "payload_template": {
    "path_prefix": "/"
  }
}
```

### Jobs (tenant admin)
- `POST /api/v1/jobs`
  - manual enqueue
- `GET /api/v1/jobs`
  - filters: `status`, `source`, `limit`, `offset`, `created_after`, `created_before`
- `GET /api/v1/jobs/{job_id}`
- `POST /api/v1/jobs/{job_id}/cancel`
- `POST /api/v1/jobs/{job_id}/retry`
- `GET /api/v1/jobs/summary`
  - counts by status, oldest queued age, running count
- `GET /api/v1/jobs/{job_id}/attempts`

Manual enqueue payload:
```json
{
  "definition_key": "recompute-trained-tags",
  "payload": { "model": "siglip" },
  "priority": 100,
  "scheduled_for": "2026-02-16T10:30:00Z",
  "dedupe_key": "tenant:bcg:training:daily"
}
```

Response:
```json
{
  "id": "6f46a1d8-6e2b-4ecf-8b46-9ec2e6a37f09",
  "tenant_id": "1efe049f-ae71-4226-97be-236b4df4a93a",
  "status": "queued",
  "definition_key": "recompute-trained-tags",
  "queued_at": "2026-02-16T10:30:01Z"
}
```

### Worker-facing endpoints (optional if workers use DB directly)
- `POST /api/v1/worker/jobs/claim`
- `POST /api/v1/worker/jobs/{job_id}/heartbeat`
- `POST /api/v1/worker/jobs/{job_id}/complete`
- `POST /api/v1/worker/jobs/{job_id}/fail`

Recommended for v1: workers claim/update directly in DB for lower overhead, while API remains control/visibility plane.

## Web UI (tenant queue visibility)
- New Admin page/tab: **Jobs**
  - Queue summary cards: queued/running/failed/dead-letter.
  - Table: job id, command, source, status, attempts, queued/start/finish, worker.
  - Row actions: cancel, retry, view attempts/log tails.
  - Trigger management subtab (event and scheduled triggers).
- Super-admin view:
  - cross-tenant queue metrics
  - worker heartbeat list and stale worker warnings

## Security / Safety
- RBAC:
  - tenant admins can view/manage only their tenant jobs/triggers.
  - super admin can manage definitions and global queue.
- Never execute unallowlisted command keys.
- Validate payload against command JSON schema before enqueue.
- Redact secrets from payload and attempt logs.

## Observability
- Metrics:
  - queue depth by tenant/status
  - enqueue rate, success rate, failure rate
  - median/p95 queue latency and run duration
  - retry/dead-letter rates
- Structured logs with `job_id`, `tenant_id`, `definition_key`, `attempt_no`, `worker_id`.

## Rollout Plan
1. **Schema + read APIs**: create tables and read-only queue endpoints.
2. **Manual enqueue + worker**: run one worker, validate lifecycle.
3. **UI queue visibility**: tenant Jobs tab (read + retry/cancel).
4. **Event triggers**: wire provider folder update event to enqueue.
5. **Scheduler**: enable cron triggers with advisory-lock leader.
6. **Scale workers**: run multiple consumers and tune fairness/backoff.

## Future Extensions
- Per-command concurrency limits.
- Per-tenant max in-flight jobs.
- DAG/chained jobs.
- Outbox pattern for exactly-once event enqueue semantics.
- Optional migration from DB queue to Cloud Tasks/PubSub later while keeping API contract stable.
