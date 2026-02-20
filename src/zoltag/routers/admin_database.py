"""Admin database monitor endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from zoltag.auth.dependencies import require_super_admin
from zoltag.auth.models import UserProfile
from zoltag.database import get_db

router = APIRouter(prefix="/api/v1/admin/database", tags=["admin"])


def _row_dict(row) -> dict[str, Any]:
    if row is None:
        return {}
    if hasattr(row, "_mapping"):
        return dict(row._mapping)
    return dict(row)


@router.get("/monitor")
async def get_database_monitor(
    db: Session = Depends(get_db),
    _current_user: UserProfile = Depends(require_super_admin),
):
    """Return lightweight database connection/process counters for admin monitoring."""
    max_connections = db.execute(text("show max_connections")).scalar()

    conn_row = db.execute(
        text(
            """
            select
              count(*)::int as total,
              count(*) filter (where state = 'active')::int as active,
              count(*) filter (where state = 'idle')::int as idle,
              count(*) filter (where state = 'idle in transaction')::int as idle_in_transaction
            from pg_stat_activity;
            """
        )
    ).first()

    process_rows = db.execute(
        text(
            """
            select
              coalesce(nullif(backend_type, ''), 'unknown') as backend_type,
              count(*)::int as count
            from pg_stat_activity
            group by backend_type
            order by count(*) desc, backend_type asc;
            """
        )
    ).fetchall()

    wait_rows = db.execute(
        text(
            """
            select
              coalesce(wait_event_type, 'none') as wait_event_type,
              coalesce(wait_event, 'none') as wait_event,
              coalesce(state, 'none') as state,
              count(*)::int as count
            from pg_stat_activity
            group by wait_event_type, wait_event, state
            order by count(*) desc
            limit 20;
            """
        )
    ).fetchall()

    db_row = db.execute(
        text(
            """
            select
              datname,
              numbackends::int as num_backends,
              xact_commit::bigint as xact_commit,
              xact_rollback::bigint as xact_rollback,
              blks_read::bigint as blks_read,
              blks_hit::bigint as blks_hit,
              tup_returned::bigint as tup_returned,
              tup_fetched::bigint as tup_fetched,
              tup_inserted::bigint as tup_inserted,
              tup_updated::bigint as tup_updated,
              tup_deleted::bigint as tup_deleted,
              temp_files::bigint as temp_files,
              deadlocks::bigint as deadlocks,
              stats_reset
            from pg_stat_database
            where datname = current_database();
            """
        )
    ).first()
    db_stats = _row_dict(db_row)

    calls_total = None
    try:
        calls_total = db.execute(
            text(
                """
                select sum(calls)::bigint
                from pg_stat_statements
                where dbid = (select oid from pg_database where datname = current_database());
                """
            )
        ).scalar()
    except Exception:
        # Extension may be unavailable; return null.
        calls_total = None

    transaction_total = int(db_stats.get("xact_commit", 0) or 0) + int(db_stats.get("xact_rollback", 0) or 0)

    return {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "max_connections": int(max_connections or 0),
        "connections": _row_dict(conn_row),
        "processes": [_row_dict(row) for row in process_rows],
        "wait_events": [_row_dict(row) for row in wait_rows],
        "counters": {
            **db_stats,
            "transactions_total": transaction_total,
            "calls_total": int(calls_total) if calls_total is not None else None,
        },
    }

