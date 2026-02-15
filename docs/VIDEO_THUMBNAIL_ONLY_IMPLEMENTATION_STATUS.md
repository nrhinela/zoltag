# Video Thumbnail-Only Implementation Status

## Scope
Add video support without storing video binaries in Zoltag-managed storage.

What will be stored:
- Canonical asset metadata (including `media_type`, `mime_type`, `duration_ms`)
- Poster/thumbnail image for display in grids and detail views

What will **not** be stored:
- Original video file bytes (videos remain in external provider storage like Dropbox/Google Drive)

## Status Legend
- `Not Started`
- `In Progress`
- `Completed`
- `Blocked`

## Milestones

| Milestone | Description | Status | Notes |
| --- | --- | --- | --- |
| M0 | Plan + tracker created | Completed | This document created to track implementation progress |
| M1 | Schema/model: add explicit media typing (`media_type`) | Completed | ORM + migration shipped and migration executed |
| M2 | Ingest/sync: detect videos, capture metadata, generate poster thumbnail only | In Progress | Video branch added to shared sync pipeline; poster fallback and metadata capture implemented |
| M3 | Provider listing: include video candidates (Dropbox/GDrive) | Completed | Dropbox/GDrive listing and metadata paths include video support |
| M4 | API: expose `media_type` and filter (`media_type=all|image|video`) | Completed | `/images` accepts `media_type`, and list/detail payloads include media metadata |
| M5 | Frontend filters: add `Media Type` filter in shared filter chips/state | Completed | Shared chip + state wiring applied to Search + Curate flows |
| M6 | Frontend rendering: show video poster thumbnail + video badge/duration | Completed | Shared grid now renders video badge/duration and image detail modal is media-aware |
| M7 | Verification + rollout | In Progress | Added rollout runbook + verifier script + Make target; awaiting production smoke pass |

## Implementation Checklist

### Backend
- [x] Add `assets.media_type` (`image`/`video`) with migration and backfill
- [x] Add DB check constraint for allowed values
- [x] Add index on `(tenant_id, media_type)`
- [x] Add video metadata extraction path (duration/dimensions)
- [x] Add poster thumbnail generation path for videos
- [x] Ensure no write of video binaries to managed storage in provider sync paths
- [x] Extend image list/detail APIs to include `media_type` and `duration_ms`
- [x] Add `media_type` filter handling in list/query builder

### Frontend
- [x] Add `Media Type` filter option to shared filter controls
- [x] Persist `media_type` in shared filter state/request params
- [x] Render video cards using poster thumbnail (not inline autoplay in grid)
- [x] Add video badge and duration label on tiles
- [x] Update detail modal to display video-aware metadata

### Ops / Deployment
- [x] Add/confirm ffmpeg/ffprobe runtime support if needed for poster extraction
- [ ] Validate cloud build/deploy images after backend changes
- [ ] Run migration in target environments

## Acceptance Criteria
- `GET /api/v1/images?media_type=video` returns only video assets.
- Search/Curate supports `Media Type` filter with `All`, `Photos`, `Videos`.
- Video results render poster thumbnails and can be selected/dragged like photos.
- No new pipeline step persists original video binaries in managed storage.

## Progress Log
- 2026-02-15: Created thumbnail-only video support implementation tracker and phased milestone plan.
- 2026-02-15: Implemented M1 code changes: added `Asset.media_type` in ORM and created Alembic migration `202602151030_add_assets_media_type.py` (backfill + check constraint + index).
- 2026-02-15: Implemented core M2 backend path for provider sync: `VideoProcessor` added, video thumbnail generation + duration capture in `process_storage_entry`, and sync candidate filtering expanded to include supported video files.
- 2026-02-15: Implemented M4/M5: `/api/v1/images` now supports `media_type` filtering, list/detail payloads include media fields, and shared frontend filter chips/state now support `Media Type` across Search + Curate.
- 2026-02-15: Implemented M6: shared thumbnail grid now shows `VIDEO` + duration pill and video icon, and image detail modal now shows media type/duration while skipping high-res full-image fetches for video media.
- 2026-02-15: Implemented M7 tooling: added `scripts/verify_video_thumbnail_rollout.py`, `make verify-video-rollout`, and `docs/VIDEO_THUMBNAIL_ROLLOUT_RUNBOOK.md`; Docker runtime now installs `ffmpeg`.
