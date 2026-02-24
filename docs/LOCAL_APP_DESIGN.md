# Zoltag Local Desktop App — Design Document

**Date**: 2026-02-24
**Status**: Decisions finalized — ready for implementation
**Scope**: Phase 1 — Local-only desktop application (no cloud backend required after model download)

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Component Changes](#component-changes)
4. [Database](#database)
5. [Storage](#storage)
6. [ML Models](#ml-models)
7. [Authentication](#authentication)
8. [Worker / Background Jobs](#worker--background-jobs)
9. [Packaging Strategy](#packaging-strategy)
10. [Configuration and Environment](#configuration-and-environment)
11. [First-Run Experience](#first-run-experience)
12. [Migration Path: Local to Web](#migration-path-local-to-web)
13. [Repo Structure](#repo-structure)
14. [Delta: What Changes from the Web App](#delta-what-changes-from-the-web-app)
15. [Resolved Decisions](#resolved-decisions)

---

## Overview

Zoltag is currently a cloud-hosted web application. This document describes the design for a local desktop version that runs entirely on the user's machine with no cloud dependencies after initial model download.

The local version targets photographers who want private, offline photo organization with the same ML-powered tagging, search, and curation capabilities as the web version.

**Goals**:
- Run fully offline after one-time model download
- No Supabase, GCS, or GCP dependencies
- Originals stay in place on disk — Zoltag only indexes them (never copies or moves files)
- Single user, single machine, single library
- No authentication or login — open immediately on launch
- Reuse as much existing Python/FastAPI/Lit code as possible
- Distribute as a native `.app` bundle (macOS first)
- Target audience: non-technical end users

**Non-goals (Phase 1)**:
- Multi-user or networked access
- Real-time cloud sync or automatic cloud migration
- Automatic file watching — user triggers scans manually
- Windows support (deferred to Phase 2)
- Gemini / natural language search (requires internet; deferred)
- Face recognition (deferred)

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  PyWebView Window                        │
│                                                          │
│   ┌──────────────────────────────────────────────────┐  │
│   │          Lit + Vite Frontend (unchanged)         │  │
│   │          served from FastAPI on localhost        │  │
│   └──────────────────────────┬───────────────────────┘  │
│                               │ HTTP / fetch             │
│   ┌───────────────────────────▼───────────────────────┐  │
│   │         FastAPI Backend (localhost:PORT)           │  │
│   │                                                   │  │
│   │   ┌─────────────┐   ┌──────────────────────────┐ │  │
│   │   │  SQLite DB  │   │  LocalFilesystemProvider │ │  │
│   │   │  (SQLAlch.) │   │  (StorageProvider ABC)   │ │  │
│   │   └─────────────┘   └──────────────────────────┘ │  │
│   │                                                   │  │
│   │   ┌─────────────────────────────────────────────┐ │  │
│   │   │  In-process Worker Thread (background jobs) │ │  │
│   │   └─────────────────────────────────────────────┘ │  │
│   └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Key Decisions

| Concern | Web App | Local App |
|---------|---------|-----------|
| Window | Browser | PyWebView (native OS window, no Chromium) |
| Backend | FastAPI on Cloud Run | FastAPI subprocess on random local port |
| Frontend | Vite build served by FastAPI | Unchanged — same Lit components |
| Database | PostgreSQL (Supabase) | SQLite (same SQLAlchemy models) |
| Storage | Google Cloud Storage | `LocalFilesystemProvider` on disk |
| Auth | Supabase JWT | No auth — single-user local session |
| Worker | Separate Cloud Run process | Background thread in-process |
| ML models | Same HuggingFace models | Same — already run locally |
| Tenant | Multi-tenant UUID from DB | Hardcoded UUID generated at first run |

### PyWebView

PyWebView wraps a native OS webview (WKWebView on macOS, WebView2 on Windows) rather than bundling Chromium. This keeps the binary much smaller than Electron and feels native.

```python
# desktop_app.py (new file)
import threading
import webview
import uvicorn
from zoltag.api import app

def _start_server(port: int) -> None:
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")

def main():
    port = _find_free_port()
    thread = threading.Thread(target=_start_server, args=(port,), daemon=True)
    thread.start()
    _wait_for_server(port)
    webview.create_window("Zoltag", f"http://127.0.0.1:{port}", width=1400, height=900)
    webview.start()
```

The FastAPI process starts as a daemon thread. PyWebView blocks the main thread and owns the window lifecycle. When the window closes, the daemon thread exits with it.

---

## Component Changes

### New File: `desktop_app.py`

Entry point for the desktop application. Responsibilities:
- Pick a random free port
- Start FastAPI + uvicorn in a daemon thread
- Wait for the server to accept connections (health-check loop)
- Open the PyWebView window pointed at `http://127.0.0.1:{port}`
- Handle first-run setup before the window opens (tenant UUID, model download)

### New File: `src/zoltag/storage/local_provider.py`

Implements `StorageProvider` for local filesystem paths. See [Storage](#storage) section.

### Modified: `src/zoltag/settings.py`

Add a `local_mode` boolean flag and a `local_data_dir` path:

```python
# New settings fields
local_mode: bool = False
local_data_dir: str = str(Path.home() / ".zoltag")
local_tenant_id: Optional[str] = None  # UUID written at first run
```

When `local_mode=True`:
- `database_url` defaults to `sqlite:///{local_data_dir}/zoltag.db`
- GCS / Secret Manager / Supabase settings are ignored
- Worker runs in-process

### Modified: `src/zoltag/database.py`

Already handles SQLite correctly — `get_engine_kwargs()` already skips `pool_size` and `max_overflow` for non-PostgreSQL URLs, and skips `connect_args` for non-PostgreSQL dialects. No changes needed beyond ensuring `local_mode` sets the right URL.

### Modified: `src/zoltag/auth/dependencies.py`

In local mode, bypass the Supabase JWT check and return a synthetic local user:

```python
# Pseudocode — local mode auth stub
if settings.local_mode:
    return LocalUser(id=settings.local_tenant_id, tenant_id=settings.local_tenant_id)
```

### Modified: `src/zoltag/routers/jobs.py`

The worker heartbeat upsert uses `pg_insert(...).on_conflict_do_update()`. This is the same pattern already handled in `upsert_asset_text_document` in `text_index.py`. The jobs router needs the same dialect branch:

```python
if db.bind and db.bind.dialect.name == "postgresql":
    stmt = pg_insert(JobWorker).values(**values).on_conflict_do_update(...)
    db.execute(stmt)
else:
    # SQLite: manual upsert
    row = db.query(JobWorker).filter_by(worker_id=worker_id).first()
    if row is None:
        db.add(JobWorker(**values))
    else:
        # update fields in place
        ...
```

---

## Database

### Dialect

SQLite replaces PostgreSQL. The SQLAlchemy models require minimal changes because `metadata/__init__.py` already has compiler shims:

```python
# Already present in metadata/__init__.py
@compiles(JSONB, "sqlite")
def compile_jsonb_for_sqlite(element, compiler, **kw):
    return compiler.visit_JSON(element, **kw)

@compiles(ARRAY, "sqlite")
def compile_array_for_sqlite(element, compiler, **kw):
    return compiler.visit_JSON(element, **kw)
```

`JSONB` columns become SQLite JSON (backed by JSON1, built-in since SQLite 3.38). `ARRAY(Float)` columns (used for embeddings and color histograms) become JSON arrays stored as text. Reading them back requires deserializing from JSON — this is handled in the similarity search replacement (see [ML Models](#ml-models)).

### UUID Primary Keys

PostgreSQL `UUID(as_uuid=True)` stores native 128-bit UUIDs. SQLite has no UUID type; SQLAlchemy maps it to `CHAR(32)`. The existing compiler shim in `metadata/__init__.py` already handles this at the ORM level for `JSONB` and `ARRAY`. `UUID` columns need the same treatment or switching to `String(36)` for local mode.

Preferred approach: add a compiler shim for `UUID` in the same block:

```python
from sqlalchemy.dialects.postgresql import UUID

@compiles(UUID, "sqlite")
def compile_uuid_for_sqlite(element, compiler, **kw):
    return "TEXT"
```

Tenant IDs and asset IDs are generated as Python `uuid.uuid4()` strings, which serialize fine to SQLite TEXT.

### Embeddings (pgvector replacement)

The web app stores embeddings in `ARRAY(Float)` columns (already compiled to JSON for SQLite). There is no pgvector ANN index in SQLite.

**Replacement**: numpy brute-force cosine similarity at query time.

```python
import numpy as np

def cosine_similarity_search(query_embedding: list[float], candidates: list[tuple[str, list[float]]], top_k: int = 20) -> list[str]:
    """
    candidates: list of (asset_id, embedding) tuples
    Returns: asset_ids ordered by descending similarity
    """
    q = np.array(query_embedding)
    q = q / np.linalg.norm(q)
    scores = []
    for asset_id, emb in candidates:
        v = np.array(emb)
        norm = np.linalg.norm(v)
        if norm == 0:
            continue
        scores.append((asset_id, float(np.dot(q, v / norm))))
    scores.sort(key=lambda x: x[1], reverse=True)
    return [asset_id for asset_id, _ in scores[:top_k]]
```

At 100,000 images with 768-dimensional embeddings (SigLIP), loading all embeddings from SQLite and computing cosine similarity takes roughly 200–400ms on a modern laptop CPU. This is acceptable for a desktop app with an async loading indicator.

If performance becomes a concern before scaling to web, [usearch](https://github.com/unum-cloud/usearch) or [faiss](https://github.com/facebookresearch/faiss) can be added as an optional index layer without changing the storage schema.

### Alembic Migrations

Alembic migration scripts that use PostgreSQL-specific DDL (`CREATE INDEX USING GIN`, `CREATE EXTENSION vector`, etc.) need SQLite-compatible versions.

Approach: use `op.get_bind().dialect.name` inside migrations to branch DDL:

```python
def upgrade():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    # SQLite: no extension needed
```

For local mode, consider shipping a pre-created SQLite schema file and skipping Alembic for first-run, then using Alembic only for schema upgrades after the app is installed.

### Database Location

```
~/.zoltag/
    zoltag.db          # SQLite database
    thumbnails/        # Generated thumbnails
    config.json        # First-run config (tenant UUID, model download state)
```

---

## Storage

### LocalFilesystemProvider

Add `src/zoltag/storage/local_provider.py` implementing the existing `StorageProvider` ABC from `src/zoltag/storage/providers.py`.

```python
class LocalFilesystemProvider(StorageProvider):
    """
    Storage provider that reads images from the local filesystem.

    Originals are never copied — Zoltag reads them in place.
    Thumbnails are written to the app data directory.
    """

    provider_name = "local"

    def __init__(self, thumbnail_dir: Path):
        self._thumbnail_dir = thumbnail_dir
        self._thumbnail_dir.mkdir(parents=True, exist_ok=True)

    def list_image_entries(self, sync_folders=None) -> list[ProviderEntry]:
        """Walk configured sync folders on local disk."""
        entries = []
        for folder in (sync_folders or []):
            for path in Path(folder).rglob("*"):
                if path.suffix.lower() in IMAGE_EXTENSIONS:
                    entries.append(self._entry_from_path(path))
        return entries

    def get_entry(self, source_key: str) -> ProviderEntry:
        return self._entry_from_path(Path(source_key))

    def get_media_metadata(self, source_key: str) -> ProviderMediaMetadata:
        # EXIF is read directly from file bytes by the existing exif module
        return ProviderMediaMetadata(exif_overrides={}, provider_properties={})

    def download_file(self, source_key: str) -> bytes:
        return Path(source_key).read_bytes()

    def get_thumbnail(self, source_key: str, size: str = "w640h480") -> Optional[bytes]:
        thumbnail_path = self._thumbnail_path(source_key)
        if thumbnail_path.exists():
            return thumbnail_path.read_bytes()
        return None

    def _entry_from_path(self, path: Path) -> ProviderEntry:
        stat = path.stat()
        return ProviderEntry(
            provider=self.provider_name,
            source_key=str(path.resolve()),
            name=path.name,
            file_id=None,
            display_path=str(path),
            modified_time=datetime.fromtimestamp(stat.st_mtime),
            size=stat.st_size,
            content_hash=None,
            revision=None,
            mime_type=mimetypes.guess_type(path.name)[0],
        )

    def _thumbnail_path(self, source_key: str) -> Path:
        # Use a hash of the source path as the thumbnail filename
        name = hashlib.sha1(source_key.encode()).hexdigest() + ".jpg"
        return self._thumbnail_dir / name
```

### Thumbnail Storage

Thumbnails are written by the existing `ImageProcessor` thumbnail generation code. In local mode, thumbnails go to `~/.zoltag/thumbnails/` instead of GCS. The `LocalFilesystemProvider.get_thumbnail()` serves them from disk; the API endpoint for thumbnails calls the provider.

The existing thumbnail CDN URL logic in `settings.py` (`thumbnail_cdn_base_url`) is unused in local mode — thumbnails are served directly from FastAPI.

### Source Key Format

For local files, `source_key` is the absolute POSIX path to the original file:

```
/Users/alice/Pictures/2025/vacation/IMG_0042.HEIC
```

This is stored in the `Asset.source_key` column. The `Asset.source_provider` column is set to `"local"`.

Originals are never moved or copied. If the user moves a file, the `source_key` becomes stale and a re-scan is needed (same behavior as Dropbox when a file is moved). A future enhancement could use file system events (`watchdog`) to detect moves.

---

## ML Models

No changes to the ML pipeline. The `SigLIPTagger` in `src/zoltag/tagging.py` already:

- Downloads the model from HuggingFace on first use (~1.7 GB, cached in `~/.cache/huggingface/`)
- Falls back to `local_files_only=True` when network access fails for subsequent loads
- Runs on CPU if no CUDA device is present

The worker handles embedding generation as background jobs (see [Worker](#worker--background-jobs)). On a modern laptop CPU, embedding generation runs at roughly 2–5 images/second depending on resolution. A library of 10,000 images takes 30–90 minutes for initial processing.

### Model Download UX

The first-run setup screen (shown before the main window opens) handles the model download with a progress bar. PyWebView supports injecting JavaScript to update UI, or a simple progress window can be shown using `tkinter` or PyWebView's built-in `evaluate_js`.

Model download state is tracked in `~/.zoltag/config.json`:

```json
{
  "tenant_id": "550e8400-e29b-41d4-a716-446655440000",
  "model_downloaded": true,
  "model_version": "google/siglip-so400m-patch14-384",
  "app_version": "1.0.0"
}
```

---

## Authentication

In local mode, there is no login screen and no Supabase dependency.

### Approach

- On first run, generate a UUID and store it as both the tenant ID and the local user ID in `~/.zoltag/config.json`
- The FastAPI auth dependency (`src/zoltag/auth/dependencies.py`) checks `settings.local_mode` and returns a synthetic user object instead of validating a JWT
- All API routes that require a tenant ID receive the hardcoded local tenant UUID

The `X-Tenant-ID` header used throughout the multi-tenant web app is set automatically by the frontend in local mode (the tenant UUID is embedded in the app config served from `/api/v1/config` or similar).

### What to Remove / Stub

- Supabase JWT validation: guarded behind `if not settings.local_mode`
- OAuth state management (`oauth_state.py`): not needed
- Dropbox/GDrive OAuth flows: not needed for local file indexing (users pick folders directly)
- Email sending (`email.py`): stub or disable

---

## Worker / Background Jobs

The web app runs a dedicated worker process (`src/zoltag/worker.py`) that polls the job queue in PostgreSQL and dispatches jobs to CLI subprocesses.

In local mode, the worker runs as a background thread inside the same FastAPI process.

### In-Process Worker

```python
# In desktop_app.py, after server starts:
from zoltag.worker import start_worker_thread

worker_thread = start_worker_thread()  # returns daemon Thread
```

`worker.py` already has `_worker_thread` and `_worker_stop_event` module-level variables and a thread-based design — the `start_worker_thread()` function is a thin wrapper that sets these and starts the polling loop.

### Job Dispatching

The web worker dispatches jobs by spawning CLI subprocesses (`build_queue_command_argv` in `cli/introspection.py`). In local mode, this still works — subprocesses can be spawned against the local SQLite database using the same CLI commands.

Alternatively, for simplicity in Phase 1, job handlers can be called directly in the worker thread instead of via subprocess. The subprocess approach has better isolation; the direct-call approach is simpler to debug.

**Recommendation**: Keep subprocess dispatch for Phase 1 to avoid divergence from the web worker's behavior.

### Concurrency

SQLite has limited write concurrency. Set `max_workers=1` in local mode to avoid write contention. Background job throughput is not a bottleneck for a single-user desktop application.

---

## Packaging Strategy

**Decision**: Go straight to native installer — skip the Docker Desktop intermediate step. Target macOS `.app` first; Windows deferred to Phase 2.

### Phase 1: Native macOS `.app` via Briefcase

Use [Briefcase](https://briefcase.readthedocs.io/) from the BeeWare project to produce:
- `.app` bundle + `.dmg` installer on macOS (Phase 1)
- `.exe` installer on Windows (Phase 2 — deferred)

```toml
# pyproject.toml additions for Briefcase
[tool.briefcase]
project_name = "Zoltag"
bundle = "com.zoltag"
version = "1.0.0"
description = "Local photo organization with AI tagging"

[tool.briefcase.app.zoltag]
formal_name = "Zoltag"
sources = ["src/zoltag", "desktop_app.py"]
requires = [
    "pywebview",
    "uvicorn",
    "fastapi",
    "sqlalchemy",
    "torch",
    "transformers",
    "pillow",
    "numpy",
    # ... other deps
]

[tool.briefcase.app.zoltag.macOS]
requires = ["std-nslog"]
```

Build commands:
```bash
briefcase create macOS
briefcase build macOS
briefcase package macOS  # produces .dmg
```

### PyInstaller (Alternative)

PyInstaller produces a self-contained binary but results in very large outputs (~1.5–2 GB) when torch is included. It is harder to configure than Briefcase and has more edge cases with dynamic imports (common in transformers). Not recommended unless Briefcase proves insufficient.

### Model Weights

Model weights (~1.7 GB) are **not** bundled in the installer. They are downloaded on first run from HuggingFace with a progress indicator. HuggingFace caches models in `~/.cache/huggingface/hub/` by default — this cache persists across app updates.

---

## Configuration and Environment

### Environment Variables for Local Mode

```bash
LOCAL_MODE=true
DATABASE_URL=sqlite:////Users/alice/.zoltag/zoltag.db
LOCAL_DATA_DIR=/Users/alice/.zoltag
LOCAL_TENANT_ID=550e8400-e29b-41d4-a716-446655440000

# Not required in local mode (can be empty):
GCP_PROJECT_ID=
STORAGE_BUCKET_NAME=
SUPABASE_URL=
SUPABASE_ANON_KEY=
```

In the desktop app, these are set programmatically in `desktop_app.py` before importing `settings`:

```python
import os
config = load_local_config()  # reads ~/.zoltag/config.json
os.environ["LOCAL_MODE"] = "true"
os.environ["DATABASE_URL"] = f"sqlite:///{config['data_dir']}/zoltag.db"
os.environ["LOCAL_TENANT_ID"] = config["tenant_id"]
```

### `~/.zoltag/config.json` Schema

```json
{
  "tenant_id": "<uuid4>",
  "app_version": "1.0.0",
  "model_downloaded": false,
  "model_version": "google/siglip-so400m-patch14-384",
  "sync_folders": [
    "/Users/alice/Pictures"
  ],
  "created_at": "2026-02-24T00:00:00Z"
}
```

---

## First-Run Experience

On the first launch, before the main window opens:

1. Check for `~/.zoltag/config.json`
2. If missing — first run:
   a. Generate a tenant UUID
   b. Show a native setup window (PyWebView, full-screen):
      - Welcome screen: brief one-sentence description
      - **Folder picker**: `webview.windows[0].create_file_dialog(webview.FOLDER_DIALOG)` — opens the OS native folder picker dialog. No browser `<input type="file">`.
      - **Model download**: download SigLIP (~1.7 GB) from HuggingFace with a visible progress bar. The app is not usable until this completes; the progress bar must show clearly that it is a one-time step.
   c. Write `~/.zoltag/config.json` with tenant UUID, selected folder(s), and `model_downloaded: true`
   d. Run Alembic migrations against the new SQLite database
3. Start FastAPI and open the main window

### Folder Picker (Post-Setup)

After first run, the user can add or change library folders from the settings panel. The settings panel calls a PyWebView JS bridge method that invokes `webview.windows[0].create_file_dialog(webview.FOLDER_DIALOG)` and returns the selected path back to the frontend via a promise. This gives a native OS folder dialog on every platform without any browser file input hacks.

```python
# Exposed to frontend via PyWebView's JS API bridge
class DesktopApi:
    def pick_folder(self):
        result = webview.windows[0].create_file_dialog(webview.FOLDER_DIALOG)
        return result[0] if result else None
```

```javascript
// Called from Lit component settings panel
const folder = await window.pywebview.api.pick_folder();
if (folder) this._addSyncFolder(folder);
```

### Manual Scan Trigger

There is no automatic file watcher. After adding a folder or at any time, the user clicks **"Scan Now"** in the UI. This:

1. Calls a FastAPI endpoint (`POST /api/v1/local/scan`)
2. Walks the configured folder(s) with `LocalFilesystemProvider.list_image_entries()`
3. Queues ingest jobs for any new or modified files
4. Returns immediately; progress is visible in the existing Jobs admin panel or a dedicated scan status widget

This keeps the app simple and avoids background CPU/battery usage when the user is not actively organizing photos.

### Model Download Progress

Model download progress is tracked via HuggingFace's `tqdm`-compatible progress callback and streamed to the setup UI via a Server-Sent Events endpoint (`GET /api/v1/local/setup-status`). The setup window polls this endpoint and updates the progress bar in real time.

---

## Migration Path: Local to Web

The local and web apps share the same SQLAlchemy schema, which makes migration straightforward.

### Export Flow

```
Local SQLite → pg_dump equivalent → PostgreSQL (Supabase)
Thumbnails in ~/.zoltag/thumbnails/ → re-upload to GCS
source_key (absolute path) → re-mapped to Dropbox/GDrive path or uploaded as managed asset
```

### Key Properties That Enable Migration

- `Asset.source_key`: already provider-agnostic; local paths can be remapped
- `Asset.source_provider = "local"`: distinguishes local assets in a migrated tenant
- Tenant UUID from `config.json` becomes one tenant row in the hosted PostgreSQL database
- All tags, ratings, keywords, and embeddings migrate with the schema — no reprocessing needed

### "Migrate to Cloud" Feature (Future)

A future menu item could:
1. Prompt the user for Supabase credentials
2. Export the SQLite database to SQL
3. Import into PostgreSQL
4. Upload thumbnails to GCS
5. Switch `config.json` to point at the cloud backend

This is not in scope for Phase 1 but the schema is designed to support it without modifications.

---

## Repo Structure

**Decision: Monorepo.** Desktop-specific files live alongside existing code in the same repository. No fork, no subtree.

### Monorepo Layout

Add desktop-specific files alongside existing code in the same repository:

```
zoltag/
├── src/zoltag/
│   ├── storage/
│   │   ├── providers.py          # existing — add LocalFilesystemProvider here or...
│   │   └── local_provider.py     # ...extract to new file
│   ├── auth/
│   │   └── dependencies.py       # modified — local mode bypass
│   ├── metadata/
│   │   └── __init__.py           # existing — JSONB/ARRAY shims already present
│   └── settings.py               # modified — local_mode, local_data_dir
├── desktop_app.py                 # new — entry point
├── Dockerfile.desktop             # new — Docker Desktop packaging
├── pyproject.toml                 # modified — desktop extras, Briefcase config
└── docs/
    └── LOCAL_APP_DESIGN.md       # this document
```

**Pros**: Single source of truth, shared tests, simpler dependency management.
**Cons**: `pyproject.toml` grows; desktop-only deps (PyWebView, Briefcase) are present in the server install. Mitigated by making them optional extras (`pip install -e ".[desktop]"`).

---

## Delta: What Changes from the Web App

The following is a concise list of all files that need to change or be created.

| File | Change Type | Description |
|------|-------------|-------------|
| `desktop_app.py` | New | PyWebView entry point, server startup, first-run setup |
| `src/zoltag/storage/local_provider.py` | New | `LocalFilesystemProvider` implementing `StorageProvider` ABC |
| `src/zoltag/settings.py` | Modified | Add `local_mode`, `local_data_dir`, `local_tenant_id` fields |
| `src/zoltag/auth/dependencies.py` | Modified | Bypass JWT validation when `local_mode=True` |
| `src/zoltag/routers/jobs.py` | Modified | SQLite-compatible upsert for `JobWorker` heartbeat |
| `src/zoltag/metadata/__init__.py` | Modified | Add `@compiles(UUID, "sqlite")` shim |
| `src/zoltag/routers/nl_search.py` | Modified | Replace pgvector ANN query with numpy brute-force |
| `alembic/versions/*.py` | Modified | Add SQLite dialect branches for PostgreSQL-specific DDL |
| `pyproject.toml` | Modified | Add `[desktop]` extras group, Briefcase config |
| `Dockerfile.desktop` | New | Docker Desktop packaging for Phase 1 |
| `src/zoltag/worker.py` | Modified | Expose `start_worker_thread()` for in-process use |

**Files that require no changes**:
- `src/zoltag/tagging.py` — already runs locally with `local_files_only` fallback
- `src/zoltag/database.py` — already handles SQLite pool configuration
- `src/zoltag/text_index.py` — already has PostgreSQL/SQLite dialect branch in `upsert_asset_text_document`
- `src/zoltag/storage/providers.py` — `StorageProvider` ABC needs no changes
- `frontend/` — all Lit components are unchanged

---

## Resolved Decisions

| Question | Decision |
|----------|----------|
| Repo structure | **Monorepo** — desktop files added alongside existing code |
| Originals handling | **Index in place** — files are never copied or moved |
| Folder picker UX | **Native OS dialog** via `webview.create_file_dialog(FOLDER_DIALOG)`, not browser file input |
| File watching / re-scan | **Manual only** — user clicks "Scan Now"; no background watcher |
| Library scope | **Single library** per installation |
| Authentication | **None** — no login, no JWT, synthetic local user auto-injected |
| Gemini / NL search | **Disabled in Phase 1** — requires internet; deferred |
| Face recognition | **Deferred** — not in Phase 1 |
| Packaging target | **macOS `.app` first** via Briefcase; Windows deferred to Phase 2 |
| Installer approach | **Small installer + first-run model download** — model weights not bundled |
| Target audience | **Non-technical end users** — UX must be self-explanatory |

## Deferred / Open

These items are intentionally out of scope for Phase 1 and need decisions before Phase 2:

- **Windows support**: PyWebView supports Windows via WebView2 (ships with Windows 11; available as a standalone installer for Windows 10). Defer packaging and testing to Phase 2.
- **App updates**: Sparkle (macOS), Briefcase's built-in update mechanism, or manual re-download. Decide before first consumer release.
- **SQLite write contention**: One worker thread + multiple FastAPI threads sharing SQLite with WAL mode is expected to be fine for a single-user desktop app. Monitor under real-world usage before adding complexity.
- **Embedding storage size**: 500–600 MB for 100,000 SigLIP embeddings stored as JSON in SQLite is acceptable for Phase 1. If it becomes a problem, move to a numpy `.npy` sidecar file or a flat binary index.
- **Color histogram embeddings**: Include in Phase 1 (generated by existing image processor). No additional work needed.
- **Gemini / NL search**: Evaluate local LLM option (e.g., Ollama) for Phase 2 once the core app is stable.
