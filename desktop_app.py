"""
Zoltag Desktop — entry point for the local desktop application.

Responsibilities:
  1. First-run setup: generate tenant UUID, pick photo folder, download SigLIP model
  2. Set environment so FastAPI starts in local mode (SQLite, no auth, no GCS)
  3. Start FastAPI + uvicorn in a daemon thread
  4. Open a PyWebView window pointed at the local server
  5. Expose a JS API bridge so the frontend can invoke native OS dialogs
"""

from __future__ import annotations

import json
import logging
import os
import signal
import socket
import sys
import time
import threading
import uuid
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# App data directory and config
# ---------------------------------------------------------------------------
APP_DATA_DIR = Path.home() / ".zoltag"
CONFIG_PATH = APP_DATA_DIR / "config.json"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("zoltag.desktop")


def _load_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            return json.loads(CONFIG_PATH.read_text())
        except Exception:
            pass
    return {}


def _save_config(cfg: dict) -> None:
    APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2, default=str))


# ---------------------------------------------------------------------------
# Environment setup (must happen BEFORE importing zoltag modules)
# ---------------------------------------------------------------------------

def _apply_env(cfg: dict) -> None:
    """Inject environment variables for local mode before settings are loaded."""
    data_dir = str(APP_DATA_DIR)
    db_path = APP_DATA_DIR / "zoltag.db"

    os.environ.setdefault("LOCAL_MODE", "true")
    os.environ.setdefault("DATABASE_URL", f"sqlite:///{db_path}")
    os.environ.setdefault("LOCAL_DATA_DIR", data_dir)
    os.environ.setdefault("LOCAL_TENANT_ID", cfg.get("tenant_id") or "")

    # Silence cloud deps that aren't available in desktop mode.
    os.environ.setdefault("GCP_PROJECT_ID", "local")
    os.environ.setdefault("STORAGE_BUCKET_NAME", "local")
    os.environ.setdefault("ENVIRONMENT", "dev")
    os.environ.setdefault("APP_URL", "http://localhost")


# ---------------------------------------------------------------------------
# Free port finder
# ---------------------------------------------------------------------------

def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_for_server(port: int, timeout: float = 30.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return
        except OSError:
            time.sleep(0.1)
    raise RuntimeError(f"FastAPI server did not start within {timeout}s on port {port}")


# ---------------------------------------------------------------------------
# FastAPI server thread
# ---------------------------------------------------------------------------

def _start_server(port: int) -> None:
    import uvicorn
    from zoltag.api import app  # noqa: import triggers settings load

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning", access_log=False)


# ---------------------------------------------------------------------------
# First-run setup
# ---------------------------------------------------------------------------

def _first_run_setup(window) -> dict:
    """
    Run the first-run wizard via the already-open setup window.
    Returns the completed config dict.
    """
    import webview

    # 1. Pick a photo library folder via native OS dialog.
    result = window.create_file_dialog(webview.FOLDER_DIALOG)
    sync_folders = [result[0]] if result else []

    # 2. Download SigLIP model with progress bar.
    _download_model(window)

    # Merge into existing config (tenant_id already generated in main()).
    cfg = _load_config()
    cfg.update({
        "app_version": "1.0.0",
        "model_downloaded": True,
        "model_version": "google/siglip-so400m-patch14-384",
        "sync_folders": sync_folders,
        "created_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
    })
    _save_config(cfg)
    return cfg


def _download_model(window) -> None:
    """Download SigLIP weights with progress reporting to the setup window."""
    try:
        from transformers import AutoProcessor, AutoModel
        from huggingface_hub import snapshot_download
    except ImportError:
        logger.warning("transformers not installed — skipping model download")
        return

    model_id = "google/siglip-so400m-patch14-384"
    logger.info("Downloading model: %s", model_id)

    def _progress_callback(current: int, total: int) -> None:
        if total and window:
            pct = int(current / total * 100)
            try:
                window.evaluate_js(
                    f"if (window.onModelProgress) window.onModelProgress({pct});"
                )
            except Exception:
                pass

    try:
        snapshot_download(
            repo_id=model_id,
            ignore_patterns=["*.msgpack", "flax_model*", "tf_model*", "rust_model*"],
        )
    except Exception as exc:
        logger.warning("Model download failed (will retry on next start): %s", exc)


# ---------------------------------------------------------------------------
# PyWebView JS API bridge
# ---------------------------------------------------------------------------

class DesktopApi:
    """Methods exposed to the frontend via window.pywebview.api.*"""

    def pick_folder(self) -> Optional[str]:
        """Open a native OS folder picker and return the selected path."""
        import webview

        windows = webview.windows
        if not windows:
            return None
        result = windows[0].create_file_dialog(webview.FOLDER_DIALOG)
        return result[0] if result else None

    def get_sync_folders(self) -> list:
        return _load_config().get("sync_folders") or []

    def add_sync_folder(self, folder: str) -> list:
        cfg = _load_config()
        folders = cfg.get("sync_folders") or []
        if folder and folder not in folders:
            folders.append(folder)
            cfg["sync_folders"] = folders
            _save_config(cfg)
        return folders

    def remove_sync_folder(self, folder: str) -> list:
        cfg = _load_config()
        folders = [f for f in (cfg.get("sync_folders") or []) if f != folder]
        cfg["sync_folders"] = folders
        _save_config(cfg)
        return folders


# ---------------------------------------------------------------------------
# Database initialisation (SQLite — create_all instead of Alembic)
# ---------------------------------------------------------------------------

def _init_database(tenant_id: str) -> None:
    """
    Create all tables from SQLAlchemy models and seed the local tenant row.

    We use create_all() instead of Alembic because many Alembic migrations
    contain PostgreSQL-specific DDL (pgvector, GIN indexes, USING clauses)
    that cannot run on SQLite. create_all() uses the model definitions which
    already have SQLite compatibility shims (JSONB→JSON, ARRAY→JSON, UUID→TEXT).
    """
    # Import triggers the metadata compiler shims.
    from zoltag.database import engine
    from zoltag.metadata import Base as MetadataBase
    from zoltag.auth.models import Base as AuthBase

    # Pull in config/sharing models (separate declarative base).
    # All submodules must be imported before create_all so their tables register.
    try:
        from zoltag.models.config import Base as ConfigBase  # noqa: registers tables
        import zoltag.models.sharing  # noqa: registers member_comments, member_ratings, etc.
        ConfigBase.metadata.create_all(engine)
    except Exception as exc:
        logger.warning("Config model tables: %s", exc)

    MetadataBase.metadata.create_all(engine)
    AuthBase.metadata.create_all(engine)
    logger.info("Database schema ready")

    _seed_tenant(tenant_id)


def _seed_tenant(tenant_id: str) -> None:
    """Insert the local tenant row if it doesn't exist yet."""
    import uuid as _uuid
    from zoltag.database import SessionLocal
    from zoltag.metadata import Tenant as TenantModel

    tenant_uuid = _uuid.UUID(tenant_id)
    db = SessionLocal()
    try:
        existing = db.query(TenantModel).filter(
            TenantModel.id == tenant_uuid
        ).first()
        if existing:
            logger.info("Local tenant already exists: %s", tenant_id)
            return

        tenant = TenantModel()
        tenant.id = tenant_uuid
        tenant.name = "Local Library"
        tenant.identifier = tenant_id  # Use UUID string as identifier (unique)
        tenant.key_prefix = tenant_id  # Mirrors default logic
        tenant.active = True
        if hasattr(tenant, 'settings'):
            tenant.settings = {}
        db.add(tenant)
        db.commit()
        logger.info("Seeded local tenant: %s", tenant_id)
    except Exception as exc:
        db.rollback()
        logger.warning("Tenant seed failed (may already exist): %s", exc)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def main() -> None:
    import webview

    cfg = _load_config()

    is_first_run = not cfg.get("tenant_id")
    if is_first_run:
        cfg["tenant_id"] = str(uuid.uuid4())
        _save_config(cfg)

    # Apply env vars before any zoltag import.
    _apply_env(cfg)

    # Initialise the database BEFORE starting the server (which starts the worker).
    # This ensures all tables exist when the worker first polls for jobs.
    _init_database(cfg["tenant_id"])

    port = _find_free_port()

    # Start FastAPI + worker in a background daemon thread.
    server_thread = threading.Thread(
        target=_start_server,
        args=(port,),
        name="zoltag-api",
        daemon=True,
    )
    server_thread.start()

    _wait_for_server(port)
    logger.info("Server ready on port %d", port)

    if is_first_run:
        # Show a slim setup window first.
        setup_window = webview.create_window(
            "Zoltag — Welcome",
            html=_SETUP_HTML,
            width=600,
            height=480,
            resizable=False,
        )

        def _on_setup_loaded():
            cfg_completed = _first_run_setup(setup_window)
            # Re-apply env with the new tenant ID.
            os.environ["LOCAL_TENANT_ID"] = cfg_completed.get("tenant_id") or ""
            setup_window.destroy()
            _open_main_window(port)

        setup_window.events.loaded += _on_setup_loaded
        webview.start(debug=False)
    else:
        _open_main_window(port)
        webview.start(debug=False)


def _open_main_window(port: int) -> None:
    import webview

    webview.create_window(
        "Zoltag",
        url=f"http://127.0.0.1:{port}",
        width=1400,
        height=900,
        js_api=DesktopApi(),
    )


# ---------------------------------------------------------------------------
# Minimal setup HTML (shown only on first run)
# ---------------------------------------------------------------------------

_SETUP_HTML = """
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Zoltag Setup</title>
  <style>
    body { font-family: -apple-system, sans-serif; padding: 40px; background: #f5f5f7; color: #1d1d1f; }
    h1   { font-size: 28px; margin-bottom: 8px; }
    p    { color: #6e6e73; margin-bottom: 24px; }
    .progress-bar { height: 8px; background: #e0e0e0; border-radius: 4px; overflow: hidden; }
    .progress-fill { height: 100%; background: #0071e3; width: 0%; transition: width 0.3s; }
    .status { margin-top: 12px; font-size: 13px; color: #6e6e73; }
  </style>
</head>
<body>
  <h1>Setting up Zoltag</h1>
  <p>Please wait — downloading AI model (one-time, ~1.7 GB)…</p>
  <div class="progress-bar"><div class="progress-fill" id="fill"></div></div>
  <div class="status" id="status">Preparing…</div>
  <script>
    window.onModelProgress = function(pct) {
      document.getElementById('fill').style.width = pct + '%';
      document.getElementById('status').textContent = pct + '% downloaded';
    };
  </script>
</body>
</html>
"""


if __name__ == "__main__":
    main()
