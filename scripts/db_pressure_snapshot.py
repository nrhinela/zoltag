#!/usr/bin/env python3
"""Capture a DB pressure snapshot and optionally clean stale worker heartbeats.

Examples:
  .venv/bin/python scripts/db_pressure_snapshot.py
  .venv/bin/python scripts/db_pressure_snapshot.py --cleanup-stale-workers
  .venv/bin/python scripts/db_pressure_snapshot.py --cleanup-stale-workers --stale-hours 12
"""

from __future__ import annotations

import argparse
from typing import Any

from sqlalchemy import create_engine, text

from zoltag.database import get_engine_kwargs
from zoltag.settings import settings


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cleanup-stale-workers",
        action="store_true",
        help="Delete stale rows from job_workers after printing the snapshot.",
    )
    parser.add_argument(
        "--stale-hours",
        type=int,
        default=24,
        help="Heartbeat age threshold (hours) used for stale-worker cleanup/reporting.",
    )
    parser.add_argument(
        "--top-sql-limit",
        type=int,
        default=10,
        help="How many pg_stat_statements rows to display.",
    )
    parser.add_argument(
        "--session-limit",
        type=int,
        default=20,
        help="How many pg_stat_activity rows to display.",
    )
    parser.add_argument(
        "--worker-limit",
        type=int,
        default=30,
        help="How many job_workers rows to display.",
    )
    return parser.parse_args()


def _print_section(title: str) -> None:
    print()
    print(title)
    print("-" * len(title))


def _format_value(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def _print_rows(rows: list[dict[str, Any]]) -> None:
    if not rows:
        print("(no rows)")
        return
    columns = list(rows[0].keys())
    widths = {col: len(col) for col in columns}
    for row in rows:
        for col in columns:
            widths[col] = max(widths[col], len(_format_value(row.get(col))))

    header = " | ".join(col.ljust(widths[col]) for col in columns)
    divider = "-+-".join("-" * widths[col] for col in columns)
    print(header)
    print(divider)
    for row in rows:
        print(" | ".join(_format_value(row.get(col)).ljust(widths[col]) for col in columns))


def _query_rows(conn, sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    result = conn.execute(text(sql), params or {})
    return [dict(row) for row in result.mappings().all()]


def main() -> int:
    args = parse_args()
    stale_hours = max(1, int(args.stale_hours or 24))
    top_sql_limit = max(1, int(args.top_sql_limit or 10))
    session_limit = max(1, int(args.session_limit or 20))
    worker_limit = max(1, int(args.worker_limit or 30))

    engine = create_engine(settings.database_url, **get_engine_kwargs())
    try:
        with engine.connect() as conn:
            _print_section("Connection Summary")
            rows = _query_rows(
                conn,
                """
                SELECT
                  current_database() AS db,
                  now() AS now_utc,
                  count(*) AS total_sessions,
                  sum((state = 'active')::int) AS active_sessions,
                  sum((state = 'idle')::int) AS idle_sessions,
                  sum((state = 'idle in transaction')::int) AS idle_in_tx_sessions,
                  sum((cardinality(pg_blocking_pids(pid)) > 0)::int) AS blocked_sessions
                FROM pg_stat_activity
                WHERE datname = current_database()
                """,
            )
            _print_rows(rows)

            _print_section("Queue Summary")
            rows = _query_rows(
                conn,
                """
                SELECT
                  sum((status = 'queued')::int) AS queued,
                  sum((status = 'running')::int) AS running,
                  sum((status = 'succeeded')::int) AS succeeded,
                  sum((status = 'failed')::int) AS failed,
                  sum((status = 'canceled')::int) AS canceled,
                  sum((status = 'dead_letter')::int) AS dead_letter
                FROM jobs
                """,
            )
            _print_rows(rows)

            _print_section("Running/Queued Jobs (Oldest First)")
            rows = _query_rows(
                conn,
                """
                SELECT
                  id::text AS job_id,
                  status,
                  priority,
                  queued_at,
                  started_at,
                  lease_expires_at,
                  claimed_by_worker
                FROM jobs
                WHERE status IN ('running', 'queued')
                ORDER BY
                  CASE WHEN status = 'running' THEN 0 ELSE 1 END,
                  queued_at ASC
                LIMIT 30
                """,
            )
            _print_rows(rows)

            _print_section("Workers (Most Recent Heartbeats)")
            rows = _query_rows(
                conn,
                """
                SELECT
                  worker_id,
                  hostname,
                  running_count,
                  now() - last_seen_at AS heartbeat_age,
                  metadata
                FROM job_workers
                ORDER BY last_seen_at DESC
                LIMIT :limit
                """,
                {"limit": worker_limit},
            )
            _print_rows(rows)

            _print_section(f"Stale Workers (>{stale_hours}h)")
            rows = _query_rows(
                conn,
                """
                SELECT
                  count(*) AS stale_workers
                FROM job_workers
                WHERE last_seen_at < now() - (:hours || ' hours')::interval
                """,
                {"hours": stale_hours},
            )
            _print_rows(rows)

            _print_section("Active Sessions")
            rows = _query_rows(
                conn,
                """
                SELECT
                  pid,
                  usename,
                  application_name,
                  state,
                  wait_event_type,
                  wait_event,
                  now() - xact_start AS xact_age,
                  now() - query_start AS query_age,
                  pg_blocking_pids(pid) AS blocking_pids,
                  left(query, 180) AS query
                FROM pg_stat_activity
                WHERE datname = current_database()
                ORDER BY xact_start NULLS LAST, query_start NULLS LAST
                LIMIT :limit
                """,
                {"limit": session_limit},
            )
            _print_rows(rows)

            _print_section("Table Stats")
            rows = _query_rows(
                conn,
                """
                SELECT
                  relname,
                  seq_scan,
                  idx_scan,
                  n_live_tup,
                  n_dead_tup
                FROM pg_stat_user_tables
                WHERE relname IN ('jobs', 'job_attempts', 'assets', 'image_metadata')
                ORDER BY relname
                """,
            )
            _print_rows(rows)

            _print_section("Jobs Indexes")
            rows = _query_rows(
                conn,
                """
                SELECT
                  indexname,
                  indexdef
                FROM pg_indexes
                WHERE tablename = 'jobs'
                ORDER BY indexname
                """,
            )
            _print_rows(rows)

            _print_section("Top SQL (pg_stat_statements)")
            has_pgss = _query_rows(
                conn,
                "SELECT count(*) AS c FROM pg_extension WHERE extname = 'pg_stat_statements'",
            )
            if has_pgss and int(has_pgss[0]["c"] or 0) > 0:
                rows = _query_rows(
                    conn,
                    """
                    SELECT
                      calls,
                      round(total_exec_time::numeric, 1) AS total_ms,
                      round(mean_exec_time::numeric, 3) AS mean_ms,
                      rows,
                      left(query, 180) AS query
                    FROM pg_stat_statements
                    ORDER BY total_exec_time DESC
                    LIMIT :limit
                    """,
                    {"limit": top_sql_limit},
                )
                _print_rows(rows)
            else:
                print("pg_stat_statements is not installed.")

        if args.cleanup_stale_workers:
            with engine.begin() as conn:
                deleted = conn.execute(
                    text(
                        """
                        DELETE FROM job_workers
                        WHERE last_seen_at < now() - (:hours || ' hours')::interval
                        """
                    ),
                    {"hours": stale_hours},
                )
                _print_section("Cleanup")
                print(f"Deleted stale job_workers rows: {int(deleted.rowcount or 0)}")

        return 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
