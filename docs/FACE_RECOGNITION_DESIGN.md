# Face Recognition Design (People + Tag Audit)

## Summary
This design adds a third AI path for people tagging: **Face Recognition**.

Your core idea is sound:
- Store multiple reference photos per People record.
- Run face detection + matching as background jobs.
- Surface high-confidence, untagged candidates in Tag Audit for fast review.

The strongest implementation path is to reuse existing structures:
- `people` + `keywords.person_id` link (already in place)
- `detected_faces` table (already in place)
- `machine_tags` scoring + Tag Audit (`order_by=ml_score`) flow (already in place)

## Locked Decisions
- Reference photos in v1: **both** upload and existing-library asset selection.
- Minimum references before Face Recognition suggestions are enabled: **3**.
- Confidence threshold policy: **single global threshold** shared across all tenants.
- Suggestion scope: **Tag Audit only**, no auto-tagging in v1.
- Recompute trigger: **scheduled jobs only** (no immediate per-change recompute).
- Model strategy: **Option 3**:
  - Ship with existing `face_recognition` path first.
  - Keep a pluggable interface so backend can be upgraded to InsightFace/ArcFace later.
- On person delete: remove associated reference images.
- Reference management UI location: **People screen**.

## Goals
- Improve people-tagging speed with ML-assisted suggestions.
- Keep humans in control (no silent auto-tagging by default).
- Reuse current Zoltag audit UX and ranking paths.
- Keep strict tenant isolation.

## Non-goals (v1)
- Full identity verification / legal identity guarantees.
- Cross-tenant face matching.
- Auto-tagging without human review.

## Product Flow (v1)
1. User opens a keyword linked to a Person record.
2. In Tag Audit -> Find Missing Tags, user selects model **Face Recognition**.
3. System returns images with high face-match confidence where positive permatag is still missing.
4. User approves/rejects via existing hotspots.

## Current State (Already in Repo)
- `Person` model exists (`people` table) with tenant scope.
- People keywords are linked via `keywords.person_id` and `tag_type='person'`.
- `DetectedFace` model exists (`detected_faces`) with bbox + `face_encoding`.
- Tag Audit already supports model-based ranking via `machine_tags.tag_type`.

This gives us most of the backbone already.

## Data Model Changes

### 1) New table: `person_reference_images`
Purpose: store training/reference images per person.

Suggested columns:
- `id uuid pk`
- `tenant_id uuid not null`
- `person_id int not null -> people.id`
- `source_type text check ('upload','asset')`
- `source_asset_id uuid null` (if selected from existing library)
- `storage_key text null` (if uploaded reference photo)
- `is_active bool default true`
- `face_count int default 0`
- `quality_score float null`
- `created_by uuid null`
- `created_at`, `updated_at`

Indexes:
- `(tenant_id, person_id, is_active)`
- `(tenant_id, source_asset_id)` where not null

### 2) Extend `detected_faces`
Keep current columns; add:
- `embedding_model text null`
- `embedding_version text null`
- `quality_score float null`
- `embedding_hash text null` (dedupe aid)

Optional later:
- `embedding_vec vector(128|512)` if we want pgvector-based ANN for faces.

### 3) Reuse `machine_tags`
Write face-match suggestions as:
- `machine_tags.tag_type = 'face_recognition'`
- `machine_tags.keyword_id = <person keyword id>`
- `machine_tags.confidence = match score`

This lets Tag Audit work with minimal new query paths.

## ML / Model Strategy

### Recommendation
Use a pluggable interface with two staged providers:

1. **V1 baseline**: existing `face_recognition`/dlib path (already present in repo).
- Fastest to ship.
- Good enough for controlled datasets.

2. **V2 upgrade**: InsightFace/ArcFace embedding backend.
- Better robustness (pose/lighting).
- Better quality ceiling.

Chosen plan: **ship V1 now with a provider abstraction**, then swap/extend provider later without changing Tag Audit semantics.

### Matching Approach (v1)
- Detect all faces per image.
- Compute embeddings.
- Build per-person reference centroid and/or top-k prototypes.
- Score each detected face against person prototypes.
- Keep highest score per image for that person.

Confidence policy:
- `score >= suggest_threshold`: write machine tag suggestion.
- `score < suggest_threshold`: no suggestion.

## Jobs / Pipeline

### New/updated jobs
1. `recompute-face-detections`
- Input: tenant (optionally asset subset).
- Output: `detected_faces` rows with embeddings.

2. `recompute-face-recognition-tags`
- Input: tenant (optionally person_id / keyword_id subset).
- Output: `machine_tags` rows (`tag_type='face_recognition'`).

### Triggers
- Scheduled runs only in v1:
  - periodic face detection for eligible assets
  - periodic face-recognition scoring for people with enough references
  - periodic repair/backfill consistency

### Safety limits
- Per-job batch caps.
- Per-person max candidate writes per run.
- Idempotent upsert behavior for `machine_tags`.

## API / Backend Changes

### People reference management
Add endpoints:
- `GET /api/v1/people/{person_id}/references`
- `POST /api/v1/people/{person_id}/references` (upload or link existing asset)
- `DELETE /api/v1/people/{person_id}/references/{reference_id}`

### Tag Audit model support
- Add `face-recognition` as valid model in UI and backend.
- For `list_images` with `order_by=ml_score` + `ml_tag_type=face-recognition`:
  - existing `machine_tags` scoring path can be reused.

### Guardrails
- If selected keyword has no `person_id`: reject `face-recognition` mode with clear message.
- If person has no active references: return empty with friendly prompt to add references.

## Frontend / UX Changes

### People / Keyword admin
- Add “Reference Photos” section on the **People screen**.
- Show count of active references + last refresh status.
- Allow using existing library assets as references (preferred) and uploads.

### Tag Audit
- New model button: **Face Recognition** (shown only when keyword has person link).
- Existing “Find Missing Tags” UX remains unchanged.
- Optional tooltip: “Uses person reference photos to find likely untagged matches.”

## Performance Plan

### Expected heavy spots
- Face detection/embedding generation.
- Matching against many person references.

### Controls
- Cache person prototypes during a job run.
- Incremental recompute by changed assets/references.
- Batch writes for machine tags.
- Reuse existing job queue and tenant throttling.

## Quality & Evaluation

### Offline eval set
- For each tenant/person: curated positive + hard-negative examples.
- Track precision@k for suggestions shown in Tag Audit.

### Runtime metrics
- Detection job duration.
- Recognition job duration.
- Suggestions generated per person.
- Acceptance rate (approved vs rejected in audit).

Rollout gates:
- Start with “suggest only”.
- Require minimum precision target before enabling broadly.

## Security / Privacy
- Tenant isolation on every query and write.
- Reference images inherit tenant retention/deletion rules.
- Person deletion must remove:
  - `person_reference_images`
  - derived face-recognition machine tags for that person keyword
  - optionally face detection linkages if needed by policy

## Rollout Plan

### Phase 0: Spike (1-2 weeks)
- Validate baseline model on real tenant samples.
- Decide default thresholds.

### Phase 1: Schema + APIs
- Add `person_reference_images`.
- Add reference management UI endpoints.

### Phase 2: Jobs
- Implement detection + recognition jobs.
- Write suggestions into `machine_tags(tag_type='face_recognition')`.
- Use scheduled execution only in v1.

### Phase 3: Tag Audit Integration
- Add model option + eligibility checks.
- Ship to selected tenants.

### Phase 4: Calibration
- Use acceptance/rejection feedback to tune thresholds.

## Open Questions
- Do we need manual “primary reference face” selection for crowded images?
- Should we support auto-accept for very high confidence later? (recommended: no in v1)

## Opinion / Recommendation
Your proposed flow is the right direction and fits Zoltag’s current architecture well.
The key to shipping fast is: **reuse `machine_tags` + Tag Audit ranking**, and treat face recognition as another ML tag type rather than a parallel system.

## Implementation Checklist (Execution-Oriented)
1. Migration: create `person_reference_images` table + indexes.
2. API: add CRUD endpoints under People for reference images (upload + asset-link mode).
3. Storage: add reference image storage pathing and delete-on-person-delete hooks.
4. Jobs: add scheduled `recompute-face-detections` and `recompute-face-recognition-tags`.
5. Matching: introduce provider abstraction (`face_recognition` now, pluggable upgrade path).
6. Scoring: write/refresh `machine_tags` with `tag_type='face_recognition'`.
7. Tag Audit backend: accept `ml_tag_type=face-recognition` in `ml_score` path.
8. Tag Audit UI: add `Face Recognition` model option (person-linked keywords only).
9. Guardrails: enforce min references (3) and threshold eligibility before suggesting.
10. Metrics: log suggestion counts, acceptance rate, and job runtimes for threshold tuning.
