"""Local filesystem storage provider for desktop / offline mode."""

from __future__ import annotations

import hashlib
import mimetypes
from datetime import datetime
from pathlib import Path
from typing import Optional, Sequence

from zoltag.storage.providers import (
    ProviderEntry,
    ProviderMediaMetadata,
    StorageProvider,
)

IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".tif",
    ".heic", ".heif", ".webp", ".raw", ".cr2", ".cr3", ".nef",
    ".arw", ".orf", ".raf", ".rw2", ".dng", ".sr2",
}


class LocalFilesystemProvider(StorageProvider):
    """
    Storage provider that indexes images directly from the local filesystem.

    Originals are never copied or moved — Zoltag reads them in place.
    Thumbnails are written to the app data directory.
    """

    provider_name = "local"

    def __init__(self, thumbnail_dir: Path):
        self._thumbnail_dir = thumbnail_dir
        self._thumbnail_dir.mkdir(parents=True, exist_ok=True)

    def list_image_entries(
        self, sync_folders: Optional[Sequence[str]] = None
    ) -> list[ProviderEntry]:
        """Walk configured sync folders and return one entry per image file."""
        entries: list[ProviderEntry] = []
        for folder in sync_folders or []:
            root = Path(folder)
            if not root.is_dir():
                continue
            for path in root.rglob("*"):
                if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS:
                    try:
                        entries.append(self._entry_from_path(path))
                    except OSError:
                        pass
        entries.sort(
            key=lambda e: e.modified_time or datetime.min, reverse=True
        )
        return entries

    def get_entry(self, source_key: str) -> ProviderEntry:
        return self._entry_from_path(Path(source_key))

    def get_media_metadata(self, source_key: str) -> ProviderMediaMetadata:
        # EXIF is read directly from file bytes by the existing exif module.
        return ProviderMediaMetadata(exif_overrides={}, provider_properties={})

    def download_file(self, source_key: str) -> bytes:
        return Path(source_key).read_bytes()

    def get_thumbnail(self, source_key: str, size: str = "w640h480") -> Optional[bytes]:
        thumbnail_path = self._thumbnail_path(source_key)
        if thumbnail_path.exists():
            return thumbnail_path.read_bytes()
        return None

    def write_thumbnail(self, source_key: str, data: bytes) -> None:
        """Persist a generated thumbnail to the local thumbnail cache."""
        self._thumbnail_path(source_key).write_bytes(data)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _entry_from_path(self, path: Path) -> ProviderEntry:
        resolved = path.resolve()
        stat = resolved.stat()
        return ProviderEntry(
            provider=self.provider_name,
            source_key=str(resolved),
            name=resolved.name,
            file_id=None,
            display_path=str(resolved),
            modified_time=datetime.fromtimestamp(stat.st_mtime),
            size=stat.st_size,
            content_hash=None,
            revision=str(int(stat.st_mtime)),
            mime_type=mimetypes.guess_type(resolved.name)[0],
        )

    def _thumbnail_path(self, source_key: str) -> Path:
        # Use a SHA-1 of the absolute path as the cache key.
        digest = hashlib.sha1(source_key.encode()).hexdigest()
        return self._thumbnail_dir / f"{digest}.jpg"
