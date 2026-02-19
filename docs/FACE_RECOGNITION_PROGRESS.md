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
- [x] Phase 1 complete (schema + People reference APIs)
- [ ] Phase 2 in progress (jobs + matching backend)

## Commit log
| Date (UTC) | Commit | Summary |
|---|---|---|
| 2026-02-19 | `29b732f` | Create face recognition progress/checklist document |
| 2026-02-19 | `5beb195` | Update progress log baseline entry |
| 2026-02-19 | `4dd9a42` | Add person reference images schema + migration |
| 2026-02-19 | `31f10f9` | Add tenant-scoped People reference CRUD endpoints and tests |

## Phase checklist

### Phase 0: Planning
- [x] Confirm product scope and non-goals
- [x] Lock v1 decisions (references, threshold policy, job mode, UI location)
- [x] Finalize design doc baseline

### Phase 1: Schema + backend APIs
- [x] Add migration for `person_reference_images`
- [x] Add ORM model for `person_reference_images`
- [x] Add tenant-scoped indexes/constraints
- [x] Add People endpoints:
  - [x] `GET /api/v1/people/{person_id}/references`
  - [x] `POST /api/v1/people/{person_id}/references`
  - [x] `DELETE /api/v1/people/{person_id}/references/{reference_id}`
- [x] Add validation: allowed source types (`upload`, `asset`)
- [x] Add delete cascade behavior when person is deleted
- [x] Add tests for People reference CRUD and tenant isolation

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
