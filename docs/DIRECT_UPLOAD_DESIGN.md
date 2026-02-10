# Direct Upload Design (No External Provider)

## Goal
Enable users to upload photos directly from the browser into PhotoCat without Dropbox/Drive, while storing:

- Original files (full resolution)
- Thumbnails
- Standard metadata (`Asset`, `ImageMetadata`)

The upload UX must support efficient multi-file uploads with progress and retries.

## Current System Fit
The design intentionally reuses existing components:

- Ingestion pipeline: `src/photocat/sync_pipeline.py`
- Storage key helpers: `src/photocat/tenant/__init__.py`
- Provider abstraction: `src/photocat/storage/providers.py`
- Existing upload UI surface: `frontend/components/upload-modal.js`
- Current analyze-only endpoint: `src/photocat/routers/images/tagging.py` (`POST /images/upload`)

## Core Design

### 1) Add a managed internal provider
Introduce a new storage provider identity:

- `source_provider = "managed"`
- `source_key = <GCS object key for original file>`

`managed` means "PhotoCat-owned object in tenant storage bucket."

### 2) Persist originals + thumbnails
For each uploaded file:

1. Upload original bytes to tenant storage bucket using canonical key:
   - `tenants/{tenant_id}/assets/{asset_uuid}/{original_filename}`
2. Create/update `Asset` row with:
   - `source_provider="managed"`
   - `source_key=<object key>`
   - `thumbnail_key=<generated thumbnail key>`
3. Run existing feature extraction/EXIF path and write `ImageMetadata`
4. Store thumbnail in thumbnail bucket using existing helper key pattern

### 3) Reuse provider abstraction for reads
Implement `ManagedStorageProvider` in `src/photocat/storage/providers.py` so existing full-image routes can fetch managed originals through the same provider mechanism used by Dropbox/Drive.

## Upload API Design

### Preferred (Phase 2, scalable): direct-to-GCS

1. `POST /api/v1/uploads/sessions`
   - Input: list of files (name, size, mime, optional checksum)
   - Output per file:
     - upload URL (signed resumable)
     - planned `asset_id`
     - planned `source_key`
     - session/file token

2. Browser uploads files directly to GCS in parallel (3-6 concurrency).

3. `POST /api/v1/uploads/sessions/{session_id}/complete`
   - Confirms uploaded objects
   - Enqueues ingest jobs
   - Returns accepted/failed items

4. `GET /api/v1/uploads/sessions/{session_id}`
   - Returns status per file (`uploading`, `queued`, `processing`, `done`, `failed`)

### Fast path (Phase 1, quick to ship): server multipart
Add `POST /api/v1/images/upload-and-ingest` (multipart) that writes originals + metadata synchronously/asynchronously. Keep response contract compatible with later session-based API.

## Frontend UX Design

## Entry point
Use the existing modal (`frontend/components/upload-modal.js`) and split actions:

- `Test Tagging` (current behavior)
- `Upload to Library` (new persistent flow)

## Upload UX requirements
- Multi-file select + drag/drop
- Per-file progress bar and aggregate progress
- Parallel uploads with bounded concurrency
- Retry failed files
- Cancel pending uploads
- Status chips per file: `queued`, `uploading`, `processing`, `done`, `failed`

## Data and Model Considerations

### Asset uniqueness and idempotency
- Use per-file idempotency token (session file token) during finalize.
- If finalize is retried, avoid duplicate `Asset`/`ImageMetadata`.

### Dedup strategy (recommended)
- Optional content hash compare (`tenant_id + hash`) before ingest completion.
- Configurable policy:
  - `keep_both`
  - `skip_duplicate`
  - `link_existing`

### Metadata timestamps
For uploaded files, preserve timestamp strategy already used in analytics/insights:

- `capture_timestamp` from EXIF when present
- fallback to file/object modified time
- fallback to row creation time

## Security and Isolation

- Tenant prefix enforcement on all object keys (server generated keys only).
- Validate mime type, extension, file size, and max file count.
- Use short-lived signed upload URLs.
- Authorize all session/finalize endpoints via tenant membership.
- Never accept client-provided arbitrary `source_key`.

## Processing Model

Use async ingestion (Cloud Tasks or worker queue) after upload completion:

1. Validate object exists and readable.
2. Download/process image bytes.
3. Generate thumbnail + metadata.
4. Persist DB rows.
5. Emit completion status.

This keeps API latency stable for large batches.

## Observability

Track:

- Upload session duration
- Per-file upload duration
- Queue wait time
- Ingest processing time
- Failure rates by reason (`validation`, `storage`, `processing`, `db`)

Expose minimal admin/debug endpoint or logs keyed by session ID.

## Rollout Plan

### Phase 1 (quick delivery)
- Add multipart persistent upload endpoint.
- Write originals to storage + thumbnails + DB rows.
- Basic multi-file UI with progress (XHR/fetch progress where available).

### Phase 2 (production-grade scale)
- Add upload sessions + signed resumable URLs.
- Direct browser-to-GCS upload.
- Async finalize + status polling.

### Phase 3 (optimization)
- Dedup policy
- Optional background embeddings/tagging triggers
- Bulk retry and partial-failure recovery tooling

## Open Questions

1. Maximum single file size and total batch size limits?
2. Required dedup behavior for professional workflows?
3. Should uploads be available to all tenant users or admin/editor only?
4. Should ingest block on tagging/embeddings or defer them?
