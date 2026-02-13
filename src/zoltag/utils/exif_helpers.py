"""EXIF data extraction utilities.

Consolidates EXIF extraction logic from multiple sources with graceful
fallback for missing libraries and timezone normalization.
"""

import logging
from typing import Optional, Dict, Any
from datetime import datetime
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)


def extract_all_exif(image_path: str) -> Dict[str, Any]:
    """
    Extract EXIF from image file with graceful fallback.

    Tries PIL first (always available), then piexif (optional dependency).
    Returns normalized dict with timezone-aware datetime.

    Args:
        image_path: Path to image file

    Returns:
        dict: EXIF data with normalized fields
    """
    exif_data = {}

    # Try PIL first (always available)
    try:
        from PIL import Image
        try:
            img = Image.open(image_path)
            exif_dict = img._getexif() if hasattr(img, '_getexif') else {}
            if exif_dict:
                exif_data.update(normalize_pil_exif(exif_dict))
        except Exception as e:
            logger.debug(f"PIL EXIF extraction failed: {e}")
    except ImportError:
        logger.debug("PIL not available for EXIF extraction")

    # Try piexif for deeper data (optional dependency)
    try:
        import piexif
        try:
            exif_dict = piexif.load(image_path)
            if exif_dict:
                exif_data.update(normalize_piexif_exif(exif_dict))
        except Exception as e:
            logger.debug(f"piexif extraction failed: {e}")
    except ImportError:
        logger.debug("piexif not available (optional dependency)")

    # Normalize timezone-aware timestamps
    if 'datetime' in exif_data:
        exif_data['datetime'] = parse_exif_datetime(exif_data['datetime'])

    return exif_data


def normalize_pil_exif(exif_dict: Dict) -> Dict[str, Any]:
    """
    Normalize PIL EXIF data.

    Args:
        exif_dict: PIL EXIF dictionary

    Returns:
        dict: Normalized EXIF data
    """
    normalized = {}

    # Common EXIF tags (PIL uses numeric keys)
    # 306 = DateTime, 274 = Orientation, etc.
    tag_map = {
        306: 'datetime',
        274: 'orientation',
        305: 'software',
        271: 'make',
        272: 'model',
    }

    if isinstance(exif_dict, dict):
        for tag_id, field_name in tag_map.items():
            if tag_id in exif_dict:
                normalized[field_name] = exif_dict[tag_id]

    return normalized


def normalize_piexif_exif(exif_dict: Dict) -> Dict[str, Any]:
    """
    Normalize piexif EXIF data.

    Args:
        exif_dict: piexif EXIF dictionary

    Returns:
        dict: Normalized EXIF data
    """
    normalized = {}

    try:
        if "0th" in exif_dict:
            # 0th IFD contains main EXIF data
            ifd_0th = exif_dict["0th"]

            # DateTime tag = 306
            if 306 in ifd_0th:
                dt_bytes = ifd_0th[306]
                if isinstance(dt_bytes, bytes):
                    normalized['datetime'] = dt_bytes.decode('utf-8')
                else:
                    normalized['datetime'] = str(dt_bytes)

            # Other common tags
            if 271 in ifd_0th:  # Make
                make = ifd_0th[271]
                normalized['make'] = make.decode('utf-8') if isinstance(make, bytes) else str(make)

            if 272 in ifd_0th:  # Model
                model = ifd_0th[272]
                normalized['model'] = model.decode('utf-8') if isinstance(model, bytes) else str(model)

            if 274 in ifd_0th:  # Orientation
                normalized['orientation'] = ifd_0th[274][0] if isinstance(ifd_0th[274], tuple) else ifd_0th[274]
    except Exception as e:
        logger.debug(f"Error normalizing piexif data: {e}")

    return normalized


def parse_exif_datetime(dt_string: str) -> Optional[datetime]:
    """
    Convert EXIF datetime string to timezone-aware Python datetime.

    EXIF format: "YYYY:MM:DD HH:MM:SS" (no timezone info)
    Since EXIF has no timezone, we use UTC as default.

    Args:
        dt_string: EXIF datetime string

    Returns:
        Timezone-aware datetime in UTC, or None if parsing fails
    """
    if not dt_string or not isinstance(dt_string, str):
        return None

    try:
        # Parse EXIF format: YYYY:MM:DD HH:MM:SS
        dt = datetime.strptime(dt_string.strip(), "%Y:%m:%d %H:%M:%S")
        # Use UTC as default since EXIF has no timezone
        return dt.replace(tzinfo=ZoneInfo('UTC'))
    except ValueError as e:
        logger.warning(f"Failed to parse EXIF datetime '{dt_string}': {e}")
        return None
    except Exception as e:
        logger.warning(f"Unexpected error parsing EXIF datetime: {e}")
        return None


def get_exif_datetime(image_path: str) -> Optional[datetime]:
    """
    Get timezone-aware datetime from image EXIF.

    Convenience function that extracts and returns only the datetime field.

    Args:
        image_path: Path to image file

    Returns:
        Timezone-aware datetime in UTC, or None if not found/parseable
    """
    exif_data = extract_all_exif(image_path)
    return exif_data.get('datetime')


def get_exif_orientation(image_path: str) -> Optional[int]:
    """
    Get image orientation from EXIF.

    Values:
        1: Normal
        2: Flipped horizontally
        3: Rotated 180°
        4: Flipped vertically
        5: Rotated 90° counter-clockwise and flipped
        6: Rotated 90° clockwise
        7: Rotated 90° clockwise and flipped
        8: Rotated 90° counter-clockwise

    Args:
        image_path: Path to image file

    Returns:
        Orientation value (1-8), or None if not found
    """
    exif_data = extract_all_exif(image_path)
    return exif_data.get('orientation')
