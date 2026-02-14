"""Helpers for tenant scoping with UUID primary keys and human identifiers."""

from __future__ import annotations

from typing import Any, Optional, Union
from uuid import UUID

from sqlalchemy import String, cast, false, or_

from photocat.tenant import Tenant


def parse_tenant_id(raw_value: Union[str, UUID, None]) -> Optional[UUID]:
    """Parse tenant ID UUID from raw text/UUID input."""
    if isinstance(raw_value, UUID):
        return raw_value
    raw_value = (raw_value or "").strip()
    if not raw_value:
        return None
    try:
        return UUID(raw_value)
    except (ValueError, TypeError, AttributeError):
        return None


def tenant_reference_filter(model: Any, tenant_ref: Union[str, UUID, None]):
    """Build a tenant reference filter supporting UUID id and string identifier."""
    raw_value = str(tenant_ref or "").strip()
    parsed_uuid = parse_tenant_id(tenant_ref)

    clauses = []
    id_column = getattr(model, "id", None)
    identifier_column = getattr(model, "identifier", None)

    if id_column is not None:
        if parsed_uuid is not None:
            clauses.append(id_column == parsed_uuid)
        elif identifier_column is None:
            # Non-UUID text refs can only match string IDs when no identifier column exists.
            clauses.append(cast(id_column, String) == raw_value)
    if identifier_column is not None:
        clauses.append(identifier_column == raw_value)

    if not clauses:
        raise AttributeError(f"{model} has none of id/identifier")
    if len(clauses) == 1:
        return clauses[0]
    return or_(*clauses)


def tenant_id_value(tenant: Tenant) -> Optional[UUID]:
    """Parse tenant ID from tenant context."""
    return parse_tenant_id(tenant.id)


def tenant_column_filter_for_values(
    model: Any,
    tenant_id: str,
    tenant_ref: Union[str, UUID, None] = None,
    include_legacy_fallback: bool = True,
):
    """Build a tenant_id filter from scalar tenant references."""
    _ = include_legacy_fallback
    tenant_id_column = getattr(model, "tenant_id", None)

    if tenant_id_column is None:
        raise AttributeError(f"{model} has no tenant_id column")

    parsed_tenant_id = parse_tenant_id(tenant_id) or parse_tenant_id(tenant_ref)
    if parsed_tenant_id is not None:
        return tenant_id_column == parsed_tenant_id

    # Avoid invalid UUID casts against UUID columns for bad tenant references.
    raw_tenant_id = str(tenant_id or "").strip()
    if not raw_tenant_id:
        return false()
    return cast(tenant_id_column, String) == raw_tenant_id


def tenant_column_filter(model: Any, tenant: Tenant, include_legacy_fallback: bool = True):
    """Build a SQLAlchemy tenant filter for a Tenant object."""
    return tenant_column_filter_for_values(
        model=model,
        tenant_id=tenant.id,
        tenant_ref=None,
        include_legacy_fallback=include_legacy_fallback,
    )


def assign_tenant_scope(record: Any, tenant: Tenant) -> Any:
    """Assign tenant_id on a new/updated ORM record when available."""
    parsed_tenant_id = tenant_id_value(tenant)
    if hasattr(record, "tenant_id"):
        setattr(record, "tenant_id", parsed_tenant_id or tenant.id)
    return record
