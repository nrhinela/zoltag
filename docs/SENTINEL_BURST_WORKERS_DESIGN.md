# Sentinel + Burst Worker Design

## Objective
Run queue maintenance + scheduling in a tiny always-ready control plane (`sentinel`), and run heavy work in short-lived workers that spin up only when there is queued work.

## Components
- `zoltag-api` (existing): tenant/admin API + UI backend.
- `zoltag-sentinel` (new service mode): runs a secure tick endpoint to:
  - reclaim stale leases
  - reconcile workflow runs
  - fire due schedule triggers
  - dispatch one-shot worker executions
- `zoltag-worker-job` (Cloud Run Job): high-resource container that executes one queue claim and exits.

## New Backend Pieces
- Sentinel runtime: `src/zoltag/sentinel.py`
  - `run_sentinel_tick()` returns queue snapshot + dispatch decision + status.
- Internal endpoint: `POST /api/v1/internal/sentinel/tick`
  - router: `src/zoltag/routers/sentinel.py`
  - auth: `X-Sentinel-Token` (or `Authorization: Bearer <token>`)
- Worker toggle:
  - `JOB_WORKER_ENABLE_MAINTENANCE_TICKS=false` disables reclaim/reconcile/schedule maintenance inside one-shot workers so sentinel owns those responsibilities.

## Dispatch Algorithm
Given queue state:
- `queued_ready = count(jobs where status='queued' and scheduled_for <= now)`
- `running = count(jobs where status='running')`

Calculate:
- `desired_parallel = min(queued_ready, SENTINEL_WORKER_MAX_PARALLEL)`
- `requested_dispatch = max(0, desired_parallel - running)`
- `dispatch_count = min(requested_dispatch, SENTINEL_WORKER_MAX_DISPATCH_PER_TICK)`

If `dispatch_count > 0`, sentinel calls Cloud Run Jobs API:
- `POST https://run.googleapis.com/v2/projects/{project}/locations/{region}/jobs/{job}:run`
- request body:
  - `{"overrides": {"taskCount": dispatch_count}}`

Each task runs the worker container, claims one job, completes, exits.

## Required Env Vars
### Sentinel service
- `SENTINEL_MODE=true`
- `SENTINEL_AUTH_TOKEN=<shared secret>`
- `SENTINEL_DISPATCH_ENABLED=true`
- `SENTINEL_WORKER_JOB_NAME=zoltag-worker-job`
- Optional tuning:
  - `SENTINEL_WORKER_PROJECT_ID`
  - `SENTINEL_WORKER_REGION`
  - `SENTINEL_WORKER_MAX_PARALLEL` (default 8)
  - `SENTINEL_WORKER_MAX_DISPATCH_PER_TICK` (default 4)
  - `SENTINEL_DISPATCH_REQUEST_TIMEOUT_SECONDS` (default 20)
  - `SENTINEL_ENABLE_LEASE_RECLAIM` (default true)
  - `SENTINEL_ENABLE_WORKFLOW_RECONCILE` (default true)
  - `SENTINEL_ENABLE_SCHEDULE_TICK` (default true)

### Worker job container
- `WORKER_MODE=true`
- `JOB_WORKER_ONCE=true`
- `JOB_WORKER_ENABLE_MAINTENANCE_TICKS=false`

## Scheduling
Use Cloud Scheduler to call sentinel every minute:
- URL: `https://<sentinel-host>/api/v1/internal/sentinel/tick`
- Method: `POST`
- Header: `X-Sentinel-Token: <token>`
- Body: `{}`

Optional: API enqueue endpoints can also call sentinel tick asynchronously for lower latency.

## IAM
Sentinel service account needs permission to run Cloud Run jobs:
- `roles/run.developer` (or equivalent custom role including `run.jobs.run`)

## Failure Modes
- Dispatch API failure: tick returns error details; next scheduled tick retries.
- Worker crash: existing lease timeout reclaim re-queues jobs.
- Duplicate dispatch: bounded by queue/running snapshot + per-tick caps; safe due to queue claim locking.

## Rollout
1. Deploy code with sentinel endpoint and worker toggles.
2. Configure infra with one command:
   - `make configure-sentinel-workers`
   - (Equivalent script: `./scripts/configure_sentinel_workers.sh`)
3. Create/update `zoltag-worker-job` Cloud Run Job using same image and one-shot env vars.
4. Deploy `zoltag-sentinel` service (small CPU/memory, min instances 0).
5. Add/update Cloud Scheduler tick job.
6. Disable embedded worker thread in API (`SENTINEL_MODE=true` on API, or keep `WORKER_MODE=false`).
7. Observe queue depth, running jobs, dispatch rate; tune parallel/dispatch caps.
