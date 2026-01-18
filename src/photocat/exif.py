"""EXIF parsing helpers."""

from datetime import datetime
from typing import Any, Optional


def get_exif_value(exif: dict, *keys: str) -> Any:
    """Return the first non-empty EXIF value for the given keys."""
    for key in keys:
        if key in exif and exif[key] not in (None, ""):
            return exif[key]
    return None


def parse_exif_datetime(value: Any) -> Optional[datetime]:
    """Parse EXIF datetime values (ISO or EXIF format)."""
    if isinstance(value, datetime):
        return value
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text.endswith("Z"):
            text = f"{text[:-1]}+00:00"
        try:
            return datetime.fromisoformat(text)
        except ValueError:
            pass
        for fmt in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%d %H:%M:%S"):
            try:
                return datetime.strptime(text, fmt)
            except ValueError:
                continue
    return None


def parse_exif_float(value: Any) -> Optional[float]:
    """Parse numeric EXIF values into float."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, (list, tuple)) and value:
        return parse_exif_float(value[0])
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def parse_exif_int(value: Any) -> Optional[int]:
    """Parse numeric EXIF values into int."""
    parsed = parse_exif_float(value)
    if parsed is None:
        return None
    return int(parsed)


def parse_exif_str(value: Any) -> Optional[str]:
    """Parse EXIF values into strings."""
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return str(value)
