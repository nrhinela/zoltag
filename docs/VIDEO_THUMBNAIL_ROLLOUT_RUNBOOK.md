# Video Thumbnail Rollout Runbook

This runbook is for validating and rolling out video support where Zoltag stores only metadata + poster thumbnails, not source video bytes.

## Scope

- Backend DB/API: `assets.media_type`, `duration_ms`, `media_type` filtering.
- Frontend: media filter + video tile badges + duration.
- Sync pipeline: video candidate detection + poster generation.

## Quick Command

Run the standard verifier (loads `.env` if present):

```bash
make verify-video-rollout
```

The verifier script is:

```bash
python3 scripts/verify_video_thumbnail_rollout.py
```

## Verifier API Mode (optional, recommended)

Enable API smoke checks by setting:

```bash
export VIDEO_VERIFY_API_BASE="http://localhost:8000/api/v1"
export VIDEO_VERIFY_TENANT_ID="<tenant-uuid>"
export VIDEO_VERIFY_BEARER_TOKEN="<jwt>"
make verify-video-rollout
```

You can also pass flags directly:

```bash
python3 scripts/verify_video_thumbnail_rollout.py \
  --api-base "https://pc.nedeva.com/api/v1" \
  --tenant-id "<tenant-uuid>" \
  --bearer-token "<jwt>"
```

## Deployment Sequence

1. Confirm migration state:

```bash
make db-migrate-prod
```

2. Run pre-deploy verification:

```bash
make verify-video-rollout
```

3. Deploy:

```bash
make deploy-all
```

4. Run post-deploy verification against production API:

```bash
VIDEO_VERIFY_API_BASE="https://pc.nedeva.com/api/v1" \
VIDEO_VERIFY_TENANT_ID="<tenant-uuid>" \
VIDEO_VERIFY_BEARER_TOKEN="<jwt>" \
make verify-video-rollout
```

## Expected Pass Conditions

- DB:
  - `assets.media_type` column exists.
  - No invalid `media_type` values.
  - Video assets have `thumbnail_key`.
- API:
  - `GET /images?media_type=video` returns only `media_type=video`.
  - `GET /images?media_type=image` returns only `media_type=image`.
  - Video details payload includes `media_type` and `duration_ms` field.
- Frontend:
  - Search/Curate `Media Type` filter works for `All`, `Photos`, `Videos`.
  - Video tiles show `VIDEO` badge and duration.
  - Video detail modal shows media type/duration and does not attempt high-res photo fetch.

## Runtime Requirement

- `ffmpeg` + `ffprobe` should be available in runtime images for best video poster extraction.
- If unavailable, pipeline falls back to placeholder thumbnail behavior.

## Rollback

If issues occur:

1. Roll Cloud Run to previous stable revision.
2. Keep DB schema as-is (`media_type` column is additive and safe).
3. Re-run verifier to confirm system returns to stable behavior.

## Troubleshooting

- API auth failures in verifier:
  - Provide `VIDEO_VERIFY_BEARER_TOKEN` and `VIDEO_VERIFY_TENANT_ID`.
- No videos returned:
  - Verify tenant has synced video-backed assets.
- Missing duration warnings:
  - Some providers/files may omit duration metadata; warning is informational unless business-critical.
