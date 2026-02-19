# Face Recognition Progress Checklist

Branch: `face-recog`  
Design doc: `docs/FACE_RECOGNITION_DESIGN.md`  
Last updated: 2026-02-19

## Working agreement
- Keep this file updated as work progresses.
- Make meaningful local commits by phase/task.
- Record each implementation commit in the log below.

## Current status
- [x] Design reviewed and locked decisions captured
- [x] Progress/checklist tracker created
- [ ] Phase 1 in progress (schema + People reference APIs)

## Commit log
| Date (UTC) | Commit | Summary |
|---|---|---|
| 2026-02-19 | _(pending)_ | Create face recognition progress/checklist document |

## Phase checklist

### Phase 0: Planning
- [x] Confirm product scope and non-goals
- [x] Lock v1 decisions (references, threshold policy, job mode, UI location)
- [x] Finalize design doc baseline

### Phase 1: Schema + backend APIs
- [ ] Add migration for `person_reference_images`
- [ ] Add ORM model for `person_reference_images`
- [ ] Add tenant-scoped indexes/constraints
- [ ] Add People endpoints:
  - [ ] `GET /api/v1/people/{person_id}/references`
  - [ ] `POST /api/v1/people/{person_id}/references`
  - [ ] `DELETE /api/v1/people/{person_id}/references/{reference_id}`
- [ ] Add validation: allowed source types (`upload`, `asset`)
- [ ] Add delete cascade behavior when person is deleted
- [ ] Add tests for People reference CRUD and tenant isolation

### Phase 2: Jobs + matching backend
- [ ] Add scheduled job definition: `recompute-face-detections`
- [ ] Add scheduled job definition: `recompute-face-recognition-tags`
- [ ] Add face provider abstraction interface
- [ ] Implement v1 provider with existing `face_recognition` path
- [ ] Write face-recognition suggestions into `machine_tags` (`tag_type='face_recognition'`)
- [ ] Enforce minimum references (`>= 3`) before suggestion generation
- [ ] Add tests for idempotent writes and scoped recompute

### Phase 3: Tag Audit integration
- [ ] Add new model option in Tag Audit: `Face Recognition`
- [ ] Only show model when selected keyword is linked to a person
- [ ] Wire request param (`ml_tag_type=face-recognition`) in filters
- [ ] Return helpful empty states:
  - [ ] no linked person
  - [ ] fewer than 3 references
  - [ ] no high-confidence matches
- [ ] Add frontend tests/coverage for model selection and visibility

### Phase 4: People screen UX
- [ ] Add “Reference Photos” section on People screen
- [ ] Support upload reference flow
- [ ] Support select-existing-asset reference flow
- [ ] Show active reference count and latest refresh status
- [ ] Add remove/deactivate reference action

### Phase 5: Metrics + hardening
- [ ] Add activity/audit events for reference changes and job completions
- [ ] Add runtime metrics for job duration + suggestion counts
- [ ] Add acceptance-rate metric (approved vs rejected suggestions)
- [ ] Tune global threshold with early-tenant feedback

## Notes / blockers
- None currently.
