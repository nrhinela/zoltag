"""Local desktop mode endpoints: scan trigger, config management, setup status."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from zoltag.dependencies import get_db, get_tenant
from zoltag.settings import settings
from zoltag.storage.local_provider import LocalFilesystemProvider
from zoltag.sync_pipeline import process_storage_entry
from zoltag.tenant import Tenant

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/local", tags=["local"])

# Module-level scan state (single scan at a time per process).
_scan_state: Dict[str, Any] = {
    "running": False,
    "total": 0,
    "processed": 0,
    "skipped": 0,
    "errors": 0,
    "started_at": None,
    "finished_at": None,
    "last_error": None,
}


def _config_path() -> Path:
    return Path(settings.local_data_dir) / "config.json"


def _load_config() -> Dict[str, Any]:
    path = _config_path()
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            pass
    return {}


def _save_config(cfg: Dict[str, Any]) -> None:
    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cfg, indent=2, default=str))


class _LocalThumbnailBucket:
    """Duck-typed GCS bucket substitute that writes thumbnails to local disk."""

    def __init__(self, thumbnail_dir: Path):
        self._dir = thumbnail_dir
        self._dir.mkdir(parents=True, exist_ok=True)

    def blob(self, key: str) -> "_LocalBlob":
        return _LocalBlob(self._dir / Path(key).name)


class _LocalBlob:
    def __init__(self, path: Path):
        self._path = path
        self.cache_control: str = ""

    def upload_from_string(self, data: bytes, content_type: str = "image/jpeg") -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_bytes(data)


def _do_scan(tenant: Tenant, db: Session) -> None:
    """Walk configured sync folders and ingest new/changed images."""
    global _scan_state
    _scan_state.update(
        running=True,
        total=0,
        processed=0,
        skipped=0,
        errors=0,
        started_at=datetime.utcnow().isoformat(),
        finished_at=None,
        last_error=None,
    )

    try:
        cfg = _load_config()
        sync_folders: List[str] = cfg.get("sync_folders") or []
        if not sync_folders:
            logger.warning("Local scan: no sync_folders configured")
            return

        thumbnail_dir = Path(settings.local_data_dir) / "thumbnails"
        provider = LocalFilesystemProvider(thumbnail_dir=thumbnail_dir)
        bucket = _LocalThumbnailBucket(thumbnail_dir)

        entries = provider.list_image_entries(sync_folders=sync_folders)
        _scan_state["total"] = len(entries)

        for entry in entries:
            try:
                result = process_storage_entry(
                    db=db,
                    tenant=tenant,
                    entry=entry,
                    provider=provider,
                    thumbnail_bucket=bucket,
                )
                if result.skipped:
                    _scan_state["skipped"] += 1
                else:
                    _scan_state["processed"] += 1
                db.commit()
            except Exception as exc:
                _scan_state["errors"] += 1
                _scan_state["last_error"] = str(exc)
                logger.warning("Local scan: failed to process %s: %s", entry.source_key, exc)
                try:
                    db.rollback()
                except Exception:
                    pass

    except Exception as exc:
        _scan_state["last_error"] = str(exc)
        logger.exception("Local scan failed")
    finally:
        _scan_state["running"] = False
        _scan_state["finished_at"] = datetime.utcnow().isoformat()


@router.post("/scan", response_model=dict)
async def trigger_scan(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    """Walk configured sync folders and ingest new or changed images."""
    if _scan_state["running"]:
        raise HTTPException(status_code=409, detail="Scan already in progress")

    # Run in a background thread to avoid blocking the event loop.
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, _do_scan, tenant, db)
    return {"status": "started"}


@router.get("/scan/status", response_model=dict)
async def scan_status():
    """Return current scan progress."""
    return dict(_scan_state)


@router.get("/config", response_model=dict)
async def get_local_config():
    """Return the local desktop configuration."""
    cfg = _load_config()
    return {
        "tenant_id": cfg.get("tenant_id"),
        "sync_folders": cfg.get("sync_folders") or [],
        "model_downloaded": cfg.get("model_downloaded", False),
        "model_version": cfg.get("model_version"),
        "app_version": cfg.get("app_version"),
    }


@router.post("/config/folders", response_model=dict)
async def set_sync_folders(body: Dict[str, Any]):
    """Update the configured sync folders."""
    folders = body.get("sync_folders")
    if not isinstance(folders, list):
        raise HTTPException(status_code=400, detail="sync_folders must be a list")
    validated = [str(f).strip() for f in folders if str(f).strip()]

    cfg = _load_config()
    cfg["sync_folders"] = validated
    _save_config(cfg)
    return {"sync_folders": validated}


@router.get("/setup-status")
async def setup_status():
    """
    SSE stream for first-run setup progress (model download).
    The frontend polls this during setup to update its progress bar.
    """
    cfg = _load_config()

    async def event_stream():
        data = json.dumps({
            "model_downloaded": cfg.get("model_downloaded", False),
            "model_version": cfg.get("model_version"),
        })
        yield f"data: {data}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
