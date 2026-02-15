#!/usr/bin/env python3
"""Video thumbnail-only rollout verifier.

Checks:
- Database schema/data integrity for assets.media_type rollout
- Optional API smoke checks for media_type filtering and payload contracts
- Runtime tool availability for poster extraction (ffmpeg/ffprobe)

Usage:
  python3 scripts/verify_video_thumbnail_rollout.py
  python3 scripts/verify_video_thumbnail_rollout.py --skip-api
  python3 scripts/verify_video_thumbnail_rollout.py --api-base https://pc.nedeva.com/api/v1 --tenant-id <uuid> --bearer-token <token>
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class CheckResult:
    name: str
    ok: bool
    severity: str = "error"
    detail: str = ""
    extra: Dict[str, Any] = field(default_factory=dict)


def _fmt(value: Any) -> str:
    return json.dumps(value, indent=2, sort_keys=True, default=str)


def _database_engine(database_url: str) -> Any:
    from sqlalchemy import create_engine

    return create_engine(database_url, future=True)


def _run_db_checks(database_url: str) -> List[CheckResult]:
    from sqlalchemy import text

    results: List[CheckResult] = []
    engine = _database_engine(database_url)
    with engine.connect() as conn:
        has_media_type_column = bool(
            conn.execute(
                text(
                    """
                    SELECT EXISTS (
                      SELECT 1
                      FROM information_schema.columns
                      WHERE table_schema='public'
                        AND table_name='assets'
                        AND column_name='media_type'
                    )
                    """
                )
            ).scalar()
        )
        results.append(
            CheckResult(
                name="db.assets.media_type column exists",
                ok=has_media_type_column,
                detail="Column assets.media_type should exist after migration.",
            )
        )
        if not has_media_type_column:
            return results

        counts = conn.execute(
            text(
                """
                SELECT media_type, COUNT(*) AS count
                FROM assets
                GROUP BY media_type
                ORDER BY media_type
                """
            )
        ).mappings().all()
        counts_map = {str(row["media_type"]): int(row["count"] or 0) for row in counts}
        results.append(
            CheckResult(
                name="db.media_type distribution collected",
                ok=True,
                severity="info",
                detail="Current assets counts by media_type.",
                extra={"counts": counts_map},
            )
        )

        invalid_count = int(
            conn.execute(
                text(
                    """
                    SELECT COUNT(*) FROM assets
                    WHERE media_type IS NULL OR media_type NOT IN ('image', 'video')
                    """
                )
            ).scalar()
            or 0
        )
        results.append(
            CheckResult(
                name="db.media_type values valid",
                ok=invalid_count == 0,
                detail="All assets.media_type values must be image/video.",
                extra={"invalid_count": invalid_count},
            )
        )

        video_count = int(
            conn.execute(text("SELECT COUNT(*) FROM assets WHERE media_type='video'")).scalar() or 0
        )
        results.append(
            CheckResult(
                name="db.video assets discovered",
                ok=video_count >= 0,
                severity="info",
                detail="Video asset count for this environment.",
                extra={"video_count": video_count},
            )
        )

        video_missing_thumbnail_count = int(
            conn.execute(
                text(
                    """
                    SELECT COUNT(*) FROM assets
                    WHERE media_type='video'
                      AND COALESCE(TRIM(thumbnail_key), '') = ''
                    """
                )
            ).scalar()
            or 0
        )
        results.append(
            CheckResult(
                name="db.video assets have thumbnail_key",
                ok=video_missing_thumbnail_count == 0,
                detail="Video rows should have poster thumbnails.",
                extra={"missing_thumbnail_count": video_missing_thumbnail_count},
            )
        )

        video_missing_duration_count = int(
            conn.execute(
                text(
                    """
                    SELECT COUNT(*) FROM assets
                    WHERE media_type='video'
                      AND duration_ms IS NULL
                    """
                )
            ).scalar()
            or 0
        )
        results.append(
            CheckResult(
                name="db.video duration metadata completeness",
                ok=video_missing_duration_count == 0,
                severity="warn",
                detail="Duration is recommended but may be missing for some providers/files.",
                extra={"missing_duration_count": video_missing_duration_count},
            )
        )

        managed_video_count = int(
            conn.execute(
                text(
                    """
                    SELECT COUNT(*) FROM assets
                    WHERE media_type='video'
                      AND source_provider IN ('managed', 'local')
                    """
                )
            ).scalar()
            or 0
        )
        results.append(
            CheckResult(
                name="db.no managed/local source videos",
                ok=managed_video_count == 0,
                severity="warn",
                detail="Thumbnail-only policy expects source video bytes to remain provider-backed.",
                extra={"managed_or_local_video_count": managed_video_count},
            )
        )

    engine.dispose()
    return results


def _api_get(
    client: Any,
    path: str,
    tenant_id: Optional[str] = None,
    bearer_token: Optional[str] = None,
    params: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    headers: Dict[str, str] = {}
    if tenant_id:
        headers["X-Tenant-ID"] = tenant_id
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"
    response = client.get(path, params=params or {}, headers=headers)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise RuntimeError(f"Unexpected JSON payload for {path}: {type(payload)}")
    return payload


def _run_api_checks(
    api_base: str,
    tenant_id: Optional[str],
    bearer_token: Optional[str],
    limit: int = 25,
) -> List[CheckResult]:
    import httpx

    results: List[CheckResult] = []
    with httpx.Client(base_url=api_base.rstrip("/"), timeout=20.0) as client:
        videos_payload = _api_get(
            client,
            "/images",
            tenant_id=tenant_id,
            bearer_token=bearer_token,
            params={"media_type": "video", "limit": limit, "offset": 0},
        )
        videos = videos_payload.get("images") or []
        non_video_ids = [
            item.get("id")
            for item in videos
            if str(item.get("media_type", "")).strip().lower() != "video"
        ]
        results.append(
            CheckResult(
                name="api.media_type=video returns only videos",
                ok=len(non_video_ids) == 0,
                detail="All rows from media_type=video should have media_type=video.",
                extra={"non_video_ids": non_video_ids[:10], "returned": len(videos)},
            )
        )

        images_payload = _api_get(
            client,
            "/images",
            tenant_id=tenant_id,
            bearer_token=bearer_token,
            params={"media_type": "image", "limit": limit, "offset": 0},
        )
        images = images_payload.get("images") or []
        non_image_ids = [
            item.get("id")
            for item in images
            if str(item.get("media_type", "")).strip().lower() != "image"
        ]
        results.append(
            CheckResult(
                name="api.media_type=image returns only images",
                ok=len(non_image_ids) == 0,
                detail="All rows from media_type=image should have media_type=image.",
                extra={"non_image_ids": non_image_ids[:10], "returned": len(images)},
            )
        )

        first_video = videos[0] if videos else None
        if first_video and first_video.get("id") is not None:
            video_id = int(first_video["id"])
            details = _api_get(
                client,
                f"/images/{video_id}",
                tenant_id=tenant_id,
                bearer_token=bearer_token,
            )
            media_type = str(details.get("media_type", "")).strip().lower()
            results.append(
                CheckResult(
                    name="api.image details include media_type",
                    ok=media_type == "video",
                    detail="Image details for a video result should include media_type=video.",
                    extra={
                        "image_id": video_id,
                        "media_type": details.get("media_type"),
                        "duration_ms": details.get("duration_ms"),
                    },
                )
            )
        else:
            results.append(
                CheckResult(
                    name="api.video details smoke check skipped",
                    ok=True,
                    severity="info",
                    detail="No video rows returned by API to validate details payload.",
                )
            )

    return results


def _run_runtime_checks() -> List[CheckResult]:
    ffmpeg_path = shutil.which("ffmpeg")
    ffprobe_path = shutil.which("ffprobe")
    return [
        CheckResult(
            name="runtime.ffmpeg available",
            ok=bool(ffmpeg_path),
            severity="warn",
            detail="ffmpeg is recommended for extracting representative video poster frames.",
            extra={"path": ffmpeg_path},
        ),
        CheckResult(
            name="runtime.ffprobe available",
            ok=bool(ffprobe_path),
            severity="warn",
            detail="ffprobe is recommended for robust video metadata extraction.",
            extra={"path": ffprobe_path},
        ),
    ]


def _print_results(results: List[CheckResult]) -> int:
    failure = False
    print("\n=== Video Thumbnail Rollout Verification ===")
    for result in results:
        status = "PASS" if result.ok else ("WARN" if result.severity == "warn" else "FAIL")
        print(f"- [{status}] {result.name}")
        if result.detail:
            print(f"    {result.detail}")
        if result.extra:
            print(f"    extra: {_fmt(result.extra)}")
        if not result.ok and result.severity != "warn":
            failure = True
    print("=== End Verification ===\n")
    return 1 if failure else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify video thumbnail-only rollout health.")
    parser.add_argument(
        "--database-url",
        default=os.getenv("DATABASE_URL", "").strip(),
        help="Database URL. Defaults to DATABASE_URL env.",
    )
    parser.add_argument(
        "--api-base",
        default=os.getenv("VIDEO_VERIFY_API_BASE", "").strip(),
        help="Optional API base URL ending with /api/v1 (e.g., http://localhost:8000/api/v1).",
    )
    parser.add_argument(
        "--tenant-id",
        default=os.getenv("VIDEO_VERIFY_TENANT_ID", "").strip(),
        help="Optional tenant UUID for API checks (sent as X-Tenant-ID).",
    )
    parser.add_argument(
        "--bearer-token",
        default=os.getenv("VIDEO_VERIFY_BEARER_TOKEN", "").strip(),
        help="Optional Bearer token for authenticated API checks.",
    )
    parser.add_argument(
        "--skip-db",
        action="store_true",
        help="Skip DB checks.",
    )
    parser.add_argument(
        "--skip-api",
        action="store_true",
        help="Skip API checks.",
    )
    parser.add_argument(
        "--skip-runtime",
        action="store_true",
        help="Skip local runtime checks (ffmpeg/ffprobe).",
    )

    args = parser.parse_args()

    results: List[CheckResult] = []
    if not args.skip_db:
        if not args.database_url:
            results.append(
                CheckResult(
                    name="db.precondition DATABASE_URL present",
                    ok=False,
                    detail="DATABASE_URL is required for DB checks.",
                )
            )
        else:
            try:
                results.extend(_run_db_checks(args.database_url))
            except Exception as exc:  # noqa: BLE001
                results.append(
                    CheckResult(
                        name="db.check execution",
                        ok=False,
                        detail=f"DB checks failed: {exc}",
                    )
                )

    if not args.skip_runtime:
        results.extend(_run_runtime_checks())

    if not args.skip_api:
        if not args.api_base:
            results.append(
                CheckResult(
                    name="api.checks skipped",
                    ok=True,
                    severity="info",
                    detail="Set --api-base (or VIDEO_VERIFY_API_BASE) to run API smoke checks.",
                )
            )
        else:
            try:
                results.extend(
                    _run_api_checks(
                        api_base=args.api_base,
                        tenant_id=args.tenant_id or None,
                        bearer_token=args.bearer_token or None,
                    )
                )
            except Exception as exc:  # noqa: BLE001
                results.append(
                    CheckResult(
                        name="api.check execution",
                        ok=False,
                        detail=f"API checks failed: {exc}",
                    )
                )

    return _print_results(results)


if __name__ == "__main__":
    sys.exit(main())
