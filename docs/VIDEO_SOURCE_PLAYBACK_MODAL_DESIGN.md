# Video Source Playback in Image Modal - Design

## Summary

Add basic in-modal video playback for assets with `media_type=video` while preserving the current architecture rule: Zoltag does not persist source video bytes, only metadata + thumbnail/poster.

The modal should play directly from provider-backed source data (Dropbox, Google Drive, managed storage) through tenant-authenticated API orchestration.

## Current State (2026-02-15)

- The image detail modal (`/Users/ned.rhinelander/Developer/zoltag/frontend/components/image-editor.js`) is video-aware for metadata and thumbnail display.
- Videos currently do **not** attempt full-resolution load in modal.
- `GET /api/v1/images/{image_id}/full` (`/Users/ned.rhinelander/Developer/zoltag/src/zoltag/routers/images/file_serving.py`) fetches full file bytes and returns them as a single streamed response. It is image-focused and does not implement HTTP Range semantics for video scrubbing.
- Provider abstraction (`/Users/ned.rhinelander/Developer/zoltag/src/zoltag/storage/providers.py`) supports list/get/download/thumbnail but has no explicit browser playback URL contract.

## Goals

- Play source video in the existing image detail modal with a basic player (`play/pause/seek/volume/fullscreen`).
- Keep tenant isolation and auth checks identical to current image endpoints.
- Keep thumbnail-only storage policy for videos (no persisted source video bytes in Zoltag storage).
- Support both Search and Curate flows automatically via shared modal behavior.

## Non-Goals

- No transcoding pipeline or bitrate ladder generation.
- No persisted watch progress.
- No subtitles/captions management.
- No provider-side write operations.

## Recommended Architecture

Use a **two-mode playback resolver**:

1. `direct_url` mode (preferred where safe):
   - Backend issues short-lived provider URL usable by browser `<video src>`.
2. `proxy_stream` mode (fallback/required for providers that cannot expose browser-safe temporary URLs):
   - Backend serves a tenant-authenticated streaming endpoint with Range passthrough.

This avoids blocking rollout on provider inconsistencies while keeping a single frontend contract.

## API Design

### 1) Resolve Playback Endpoint

`GET /api/v1/images/{image_id}/playback`

Response shape:

```json
{
  "image_id": 12345,
  "asset_id": "uuid",
  "media_type": "video",
  "provider": "dropbox",
  "mode": "direct_url",
  "playback_url": "https://...",
  "expires_at": "2026-02-15T18:00:00Z",
  "mime_type": "video/mp4"
}
```

For proxy mode:

```json
{
  "mode": "proxy_stream",
  "playback_url": "/api/v1/images/12345/playback/stream",
  "expires_at": null
}
```

Validation behavior:
- `404` if image missing/inaccessible.
- `409` if asset/source readiness invalid.
- `400` if media is not video.
- `502/500` for provider token/link failures.

### 2) Proxy Stream Endpoint

`GET /api/v1/images/{image_id}/playback/stream`

Requirements:
- Accept and forward `Range` for seek support.
- Return `206 Partial Content` when ranged.
- Return `Accept-Ranges: bytes`.
- Forward/derive `Content-Type`, `Content-Length`, `Content-Range`.
- Use chunked streaming (do not buffer full file in memory).

## Provider Contract Changes

Extend `StorageProvider` with optional playback helpers:

- `get_playback_url(source_key: str, expires_seconds: int = 300) -> Optional[str]`
- `open_stream(source_key: str, range_header: Optional[str] = None) -> ProviderStreamResult` (for proxy mode)

`ProviderStreamResult` should include:
- iterable/async iterator for bytes
- status code
- content headers (`Content-Type`, `Content-Length`, `Content-Range`, `Accept-Ranges`)

Provider notes:
- Dropbox:
  - Prefer temporary link API for `direct_url`.
  - Fallback proxy if temporary link unavailable.
- Google Drive:
  - Likely needs proxy mode due auth/header constraints for browser playback.
- Managed/local (GCS):
  - Prefer short-lived signed URL (`direct_url`).

## Frontend Design

In `image-editor`:

- For video media, replace large `<img>` region with `<video controls preload="metadata">`.
- On modal open (or when image changes to video):
  - Call `/images/{id}/playback`.
  - Bind returned `playback_url` to `<video src>`.
- Keep existing metadata panel behavior (media type, duration, source fields).
- Keep existing drag/select/history behavior unchanged (grid semantics not affected).

UX states:
- Loading playback source.
- Video playback failed (show retry button).
- Expired link (re-resolve playback endpoint and retry).

## Security and Compliance

- Preserve tenant scoping through existing `get_tenant` and `tenant_column_filter` checks before issuing playback info.
- Never expose long-lived provider tokens to browser.
- Use short TTL URLs where direct mode is used.
- Send `Cache-Control: no-store` on resolver/proxy responses.
- Log provider failures without sensitive secrets.

## Rollout Plan

### Phase 1: Backend + Modal MVP
- Add `/playback` resolver endpoint.
- Implement direct URL mode for Dropbox + managed/local.
- Implement proxy mode for Google Drive.
- Modal renders `<video>` for video media.

### Phase 2: Robust Streaming
- Harden proxy range handling and retry behavior.
- Add provider-specific telemetry (`provider`, `mode`, latency, failure reason).
- Add link-refresh logic on playback errors.

### Phase 3: Operational Hardening
- Add smoke checks to rollout verifier for video playback endpoint.
- Validate behavior in Cloud Run under realistic file sizes/durations.

## Testing Strategy

Backend tests:
- Resolver returns correct mode per provider and non-video rejection.
- Proxy endpoint range requests (`bytes=0-`, `bytes=1000-2000`, invalid ranges).
- Tenant isolation and unauthorized access rejection.

Frontend tests:
- Video modal requests playback URL once per selected video.
- Retry path after simulated expired URL.
- Non-video modal remains unchanged.

Manual smoke:
- Seek within long video.
- Switch quickly across multiple video assets.
- Verify no full video persistence in managed storage.

## Risks and Mitigations

- Risk: Provider URL semantics vary.
  - Mitigation: dual-mode resolver with proxy fallback.
- Risk: Large video buffering could exhaust memory.
  - Mitigation: enforce stream passthrough; avoid `download_file()` for proxy path.
- Risk: URL expiration during playback.
  - Mitigation: short retry flow that re-resolves playback URL.

## Open Questions

- Do we require playback for every provider in Phase 1, or ship with provider-gated availability badges?
- Should playback URLs be single-use or short TTL multi-use?
- Do we want analytics for play/seek/error events at launch or post-launch?
