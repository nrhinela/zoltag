#!/usr/bin/env python3
"""Ensure tenant_provider_integrations rows exist for all tenants."""

from __future__ import annotations

import argparse

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from zoltag.database import get_engine_kwargs
from zoltag.integrations import backfill_tenant_provider_integrations
from zoltag.metadata import Tenant
from zoltag.settings import settings
from zoltag.tenant_scope import tenant_reference_filter


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--tenant",
        default="",
        help="Optional tenant reference (UUID or identifier). If omitted, backfills all tenants.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run without committing changes.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    engine = create_engine(settings.database_url, **get_engine_kwargs())
    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        query = db.query(Tenant)
        tenant_ref = str(args.tenant or "").strip()
        if tenant_ref:
            query = query.filter(tenant_reference_filter(Tenant, tenant_ref))

        tenant_rows = query.order_by(Tenant.created_at.asc()).all()
        if not tenant_rows:
            print("No tenants found for backfill.")
            return 1

        summary = backfill_tenant_provider_integrations(db, tenant_rows)
        if args.dry_run:
            db.rollback()
            print(
                f"DRY RUN complete. scanned={summary['tenants_scanned']} created={summary['provider_rows_created']}"
            )
        else:
            db.commit()
            print(f"Backfill complete. scanned={summary['tenants_scanned']} created={summary['provider_rows_created']}")
        return 0
    finally:
        db.close()
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
