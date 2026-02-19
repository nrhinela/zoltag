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
- [x] Phase 2 complete (jobs + matching backend)
- [x] Phase 3 complete (Tag Audit integration)
- [x] Phase 4 complete (People reference-photo UX)

## Commit log
| Date (UTC) | Commit | Summary |
|---|---|---|
| 2026-02-19 | `29b732f` | Create face recognition progress/checklist document |
| 2026-02-19 | `5beb195` | Update progress log baseline entry |
| 2026-02-19 | `4dd9a42` | Add person reference images schema + migration |
| 2026-02-19 | `31f10f9` | Add tenant-scoped People reference CRUD endpoints and tests |
| 2026-02-19 | `518056f` | Record migration/test verification for completed Phase 1 |
| 2026-02-19 | `07838c1` | Append prior progress-log entry for Phase 1 bookkeeping |
| 2026-02-19 | `6feee40` | Add face detection/recognition services, provider abstraction, and CLI jobs |
| 2026-02-19 | `a54237d` | Add scheduled job definition migration for face recompute commands |
| 2026-02-19 | `1d83604` | Add tests for idempotent face suggestions and scoped recompute |
| 2026-02-20 | `ee8077c` | Add Tag Audit Face Recognition model integration, empty states, tag-type normalization, and tests |
| 2026-02-20 | `TBD` | Add People screen reference-photo upload/select/remove UX and API wiring |

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
- [x] Add scheduled job definition: `recompute-face-detections`
- [x] Add scheduled job definition: `recompute-face-recognition-tags`
- [x] Add face provider abstraction interface
- [x] Implement v1 provider with existing `face_recognition` path
- [x] Write face-recognition suggestions into `machine_tags` (`tag_type='face_recognition'`)
- [x] Enforce minimum references (`>= 3`) before suggestion generation
- [x] Add tests for idempotent writes and scoped recompute

### Phase 3: Tag Audit integration
- [x] Add new model option in Tag Audit: `Face Recognition`
- [x] Only show model when selected keyword is linked to a person
- [x] Wire request param (`ml_tag_type=face-recognition`) in filters
- [x] Return helpful empty states:
  - [x] no linked person
  - [x] fewer than 3 references
  - [x] no high-confidence matches
- [ ] Add frontend tests/coverage for model selection and visibility

### Phase 4: People screen UX
- [x] Add “Reference Photos” section on People screen
- [x] Support upload reference flow
- [x] Support select-existing-asset reference flow
- [x] Show active reference count and latest refresh status
- [x] Add remove/deactivate reference action

### Phase 5: Metrics + hardening
- [ ] Add activity/audit events for reference changes and job completions
- [ ] Add runtime metrics for job duration + suggestion counts
- [ ] Add acceptance-rate metric (approved vs rejected suggestions)
- [ ] Tune global threshold with early-tenant feedback

## Notes / blockers
- Frontend unit/integration harness for `curate-audit-tab` model-option visibility is still pending.

## Verification run
- `pytest tests/test_people_api.py` (pass)
- `pytest tests/test_face_recognition_service.py` (pass)
- `alembic upgrade head` (pass; applied `202602192230`)
- `.venv/bin/pytest -q tests/test_machine_tag_types.py tests/test_config_manager_keywords.py tests/test_face_recognition_audit_mode.py` (pass)
- `.venv/bin/pytest -q tests/test_face_recognition_service.py tests/test_people_api.py` (pass)
