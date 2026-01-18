"""Backfill EXIF-derived fields on image_metadata.

Revision ID: 202601171500
Revises: 202601171400
Create Date: 2026-01-17 15:00:00.000000
"""
from datetime import datetime

from alembic import op
from sqlalchemy.sql import text


# revision identifiers, used by Alembic.
revision = "202601171500"
down_revision = "202601171400"
branch_labels = None
depends_on = None


def _get_exif_value(exif, *keys):
    for key in keys:
        if key in exif and exif[key] not in (None, ""):
            return exif[key]
    return None


def _parse_exif_datetime(value):
    if isinstance(value, datetime):
        return value
    if value is None:
        return None
    if isinstance(value, str):
        text_value = value.strip()
        if not text_value:
            return None
        if text_value.endswith("Z"):
            text_value = f"{text_value[:-1]}+00:00"
        try:
            return datetime.fromisoformat(text_value)
        except ValueError:
            pass
        for fmt in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%d %H:%M:%S"):
            try:
                return datetime.strptime(text_value, fmt)
            except ValueError:
                continue
    return None


def _parse_exif_float(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, (list, tuple)) and value:
        return _parse_exif_float(value[0])
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _parse_exif_int(value):
    parsed = _parse_exif_float(value)
    if parsed is None:
        return None
    return int(parsed)


def _parse_exif_str(value):
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return str(value)


def upgrade():
    bind = op.get_bind()
    rows = bind.execute(text(
        """
        SELECT id,
               exif_data,
               capture_timestamp,
               gps_latitude,
               gps_longitude,
               iso,
               aperture,
               shutter_speed,
               focal_length
        FROM image_metadata
        WHERE exif_data IS NOT NULL
          AND (
            capture_timestamp IS NULL
            OR gps_latitude IS NULL
            OR gps_longitude IS NULL
            OR iso IS NULL
            OR aperture IS NULL
            OR shutter_speed IS NULL
            OR focal_length IS NULL
          )
        """
    ))

    for row in rows:
        data = row._mapping
        exif = data["exif_data"] or {}
        updates = {}

        if data["capture_timestamp"] is None:
            capture_timestamp = _parse_exif_datetime(
                _get_exif_value(exif, "DateTimeOriginal", "DateTime")
            )
            if capture_timestamp:
                updates["capture_timestamp"] = capture_timestamp

        if data["gps_latitude"] is None:
            gps_latitude = _parse_exif_float(_get_exif_value(exif, "GPSLatitude"))
            if gps_latitude is not None:
                updates["gps_latitude"] = gps_latitude

        if data["gps_longitude"] is None:
            gps_longitude = _parse_exif_float(_get_exif_value(exif, "GPSLongitude"))
            if gps_longitude is not None:
                updates["gps_longitude"] = gps_longitude

        if data["iso"] is None:
            iso = _parse_exif_int(_get_exif_value(exif, "ISOSpeedRatings", "ISOSpeed", "ISO"))
            if iso is not None:
                updates["iso"] = iso

        if data["aperture"] is None:
            aperture = _parse_exif_float(_get_exif_value(exif, "FNumber", "ApertureValue"))
            if aperture is not None:
                updates["aperture"] = aperture

        if data["shutter_speed"] is None:
            shutter_speed = _parse_exif_str(_get_exif_value(exif, "ExposureTime", "ShutterSpeedValue"))
            if shutter_speed:
                updates["shutter_speed"] = shutter_speed

        if data["focal_length"] is None:
            focal_length = _parse_exif_float(_get_exif_value(exif, "FocalLength"))
            if focal_length is not None:
                updates["focal_length"] = focal_length

        if updates:
            updates["id"] = data["id"]
            assignments = ", ".join(f"{key} = :{key}" for key in updates if key != "id")
            bind.execute(
                text(f"UPDATE image_metadata SET {assignments} WHERE id = :id"),
                updates
            )


def downgrade():
    pass
