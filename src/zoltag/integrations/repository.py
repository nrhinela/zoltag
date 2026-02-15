"""Provider integration repository (v2-only, table-backed)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable
import uuid

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from zoltag.metadata import Tenant, TenantProviderIntegration

ALLOWED_PROVIDER_TYPES = ("dropbox", "gdrive")
DEFAULT_PROVIDER_LABELS = {
    "dropbox": "Default Dropbox",
    "gdrive": "Default Google Drive",
}

_UNSET = object()


def normalize_provider_type(value: str | None) -> str:
    provider = str(value or "").strip().lower()
    if provider in {"google-drive", "google_drive", "drive"}:
        provider = "gdrive"
    if provider in {"dbx"}:
        provider = "dropbox"
    if provider not in ALLOWED_PROVIDER_TYPES:
        raise ValueError("Invalid provider type")
    return provider


def normalize_sync_folders(raw_value: Any) -> list[str]:
    if raw_value is None:
        return []
    if not isinstance(raw_value, list):
        return []
    normalized: list[str] = []
    seen: set[str] = set()
    for item in raw_value:
        folder = str(item or "").strip()
        if not folder or folder in seen:
            continue
        seen.add(folder)
        normalized.append(folder)
    return normalized


@dataclass
class ProviderIntegrationRecord:
    """Resolved integration record from v2 table."""

    id: str | None
    tenant_id: str
    provider_type: str
    label: str
    is_active: bool
    is_default_sync_source: bool
    secret_scope: str
    config_json: dict[str, Any]
    source: str  # "new_table" | "synthetic"

    @property
    def dropbox_token_secret_name(self) -> str:
        return str(self.config_json.get("token_secret_name") or f"dropbox-token-{self.secret_scope}").strip()

    @property
    def dropbox_app_secret_name(self) -> str:
        return str(self.config_json.get("app_secret_name") or f"dropbox-app-secret-{self.secret_scope}").strip()

    @property
    def gdrive_client_secret_name(self) -> str:
        return str(self.config_json.get("client_secret_name") or f"gdrive-client-secret-{self.secret_scope}").strip()

    @property
    def gdrive_token_secret_name(self) -> str:
        return str(self.config_json.get("token_secret_name") or f"gdrive-token-{self.secret_scope}").strip()


class TenantIntegrationRepository:
    """CRUD repository for provider integration config."""

    def __init__(self, db: Session):
        self.db = db

    def _tenant_scope(self, tenant_row: Tenant) -> str:
        return str(getattr(tenant_row, "key_prefix", None) or tenant_row.id).strip()

    def _default_config(self, provider_type: str, secret_scope: str) -> dict[str, Any]:
        normalized = normalize_provider_type(provider_type)
        if normalized == "dropbox":
            return {
                "oauth_mode": "managed",
                "sync_folders": [],
                "token_secret_name": f"dropbox-token-{secret_scope}",
                "app_secret_name": f"dropbox-app-secret-{secret_scope}",
            }
        return {
            "sync_folders": [],
            "client_id": "",
            "client_secret_name": f"gdrive-client-secret-{secret_scope}",
            "token_secret_name": f"gdrive-token-{secret_scope}",
        }

    def _record_from_row(self, row: TenantProviderIntegration) -> ProviderIntegrationRecord:
        return ProviderIntegrationRecord(
            id=str(row.id),
            tenant_id=str(row.tenant_id),
            provider_type=str(row.provider_type),
            label=str(row.label),
            is_active=bool(row.is_active),
            is_default_sync_source=bool(row.is_default_sync_source),
            secret_scope=str(row.secret_scope),
            config_json=dict(row.config_json or {}),
            source="new_table",
        )

    def _synthetic_record(
        self,
        tenant_row: Tenant,
        provider_type: str,
        *,
        is_default_sync_source: bool,
    ) -> ProviderIntegrationRecord:
        normalized = normalize_provider_type(provider_type)
        scope = self._tenant_scope(tenant_row)
        return ProviderIntegrationRecord(
            id=None,
            tenant_id=str(tenant_row.id),
            provider_type=normalized,
            label=DEFAULT_PROVIDER_LABELS.get(normalized, normalized),
            is_active=True,
            is_default_sync_source=is_default_sync_source,
            secret_scope=scope,
            config_json=self._default_config(normalized, scope),
            source="synthetic",
        )

    def _list_rows(self, tenant_row: Tenant) -> list[TenantProviderIntegration]:
        return (
            self.db.query(TenantProviderIntegration)
            .filter(TenantProviderIntegration.tenant_id == tenant_row.id)
            .order_by(
                TenantProviderIntegration.provider_type.asc(),
                TenantProviderIntegration.is_default_sync_source.desc(),
                TenantProviderIntegration.created_at.asc(),
            )
            .all()
        )

    def list_provider_records(
        self,
        tenant_row: Tenant,
        *,
        include_inactive: bool = False,
        include_placeholders: bool = False,
    ) -> list[ProviderIntegrationRecord]:
        rows = self._list_rows(tenant_row)
        records = [self._record_from_row(row) for row in rows if include_inactive or row.is_active]

        if not include_placeholders:
            return records

        present_types = {record.provider_type for record in records}
        for provider_type in ALLOWED_PROVIDER_TYPES:
            if provider_type not in present_types:
                records.append(
                    self._synthetic_record(
                        tenant_row,
                        provider_type,
                        is_default_sync_source=False,
                    )
                )

        if records and not any(record.is_default_sync_source and record.is_active for record in records):
            first_active = next((record for record in records if record.is_active), None)
            if first_active:
                first_active.is_default_sync_source = True

        return records

    def resolve_default_sync_provider(
        self,
        tenant_row: Tenant,
        *,
        records: list[ProviderIntegrationRecord] | None = None,
    ) -> ProviderIntegrationRecord:
        resolved_records = records or self.list_provider_records(tenant_row)

        for record in resolved_records:
            if record.is_default_sync_source and record.is_active:
                return record

        for record in resolved_records:
            if record.is_active:
                return record

        return self._synthetic_record(tenant_row, "dropbox", is_default_sync_source=True)

    def get_primary_records_by_type(self, tenant_row: Tenant) -> dict[str, ProviderIntegrationRecord]:
        records = self.list_provider_records(tenant_row, include_placeholders=True)
        default_record = self.resolve_default_sync_provider(tenant_row, records=records)

        grouped: dict[str, list[ProviderIntegrationRecord]] = {provider: [] for provider in ALLOWED_PROVIDER_TYPES}
        for record in records:
            grouped.setdefault(record.provider_type, []).append(record)

        primary: dict[str, ProviderIntegrationRecord] = {}
        for provider_type in ALLOWED_PROVIDER_TYPES:
            provider_records = grouped.get(provider_type) or []
            provider_records.sort(
                key=lambda item: (
                    item.source != "new_table",
                    not item.is_active,
                    not item.is_default_sync_source,
                    item.label.lower(),
                )
            )
            if provider_records:
                primary[provider_type] = provider_records[0]
            else:
                primary[provider_type] = self._synthetic_record(tenant_row, provider_type, is_default_sync_source=False)

        for provider_type, record in primary.items():
            record.is_default_sync_source = provider_type == default_record.provider_type

        return primary

    def get_provider_record(
        self,
        tenant_row: Tenant,
        provider_type: str,
        *,
        provider_id: str | None = None,
    ) -> ProviderIntegrationRecord:
        normalized = normalize_provider_type(provider_type)
        rows_query = self.db.query(TenantProviderIntegration).filter(
            TenantProviderIntegration.tenant_id == tenant_row.id,
            TenantProviderIntegration.provider_type == normalized,
        )

        if provider_id:
            try:
                provider_uuid = uuid.UUID(str(provider_id))
            except Exception as exc:
                raise ValueError(f"Invalid provider_id: {exc}")
            row = rows_query.filter(TenantProviderIntegration.id == provider_uuid).first()
            if row:
                return self._record_from_row(row)
            raise ValueError("Provider not found")

        row = rows_query.order_by(
            TenantProviderIntegration.is_default_sync_source.desc(),
            TenantProviderIntegration.created_at.asc(),
        ).first()
        if row:
            return self._record_from_row(row)

        default_record = self.resolve_default_sync_provider(tenant_row)
        return self._synthetic_record(
            tenant_row,
            normalized,
            is_default_sync_source=(normalized == default_record.provider_type),
        )

    def get_provider_record_by_id(self, tenant_row: Tenant, provider_id: str) -> ProviderIntegrationRecord | None:
        try:
            provider_uuid = uuid.UUID(str(provider_id))
        except Exception:
            return None
        row = (
            self.db.query(TenantProviderIntegration)
            .filter(
                TenantProviderIntegration.id == provider_uuid,
                TenantProviderIntegration.tenant_id == tenant_row.id,
            )
            .first()
        )
        if not row:
            return None
        return self._record_from_row(row)

    def _ensure_provider_row(
        self,
        tenant_row: Tenant,
        provider_type: str,
        *,
        provider_id: str | None = None,
        label: str | None = None,
    ) -> TenantProviderIntegration:
        normalized = normalize_provider_type(provider_type)
        query = self.db.query(TenantProviderIntegration).filter(
            TenantProviderIntegration.tenant_id == tenant_row.id,
            TenantProviderIntegration.provider_type == normalized,
        )

        if provider_id:
            try:
                provider_uuid = uuid.UUID(str(provider_id))
            except Exception as exc:
                raise ValueError(f"Invalid provider_id: {exc}")
            row = query.filter(TenantProviderIntegration.id == provider_uuid).first()
            if not row:
                raise ValueError("Provider not found")
            return row

        row = query.order_by(
            TenantProviderIntegration.is_default_sync_source.desc(),
            TenantProviderIntegration.created_at.asc(),
        ).first()
        if row:
            return row

        scope = self._tenant_scope(tenant_row)
        default_exists = (
            self.db.query(TenantProviderIntegration.id)
            .filter(
                TenantProviderIntegration.tenant_id == tenant_row.id,
                TenantProviderIntegration.is_default_sync_source.is_(True),
            )
            .first()
            is not None
        )
        row = TenantProviderIntegration(
            tenant_id=tenant_row.id,
            provider_type=normalized,
            label=(str(label or "").strip() or DEFAULT_PROVIDER_LABELS.get(normalized, normalized)),
            is_active=True,
            is_default_sync_source=not default_exists,
            secret_scope=scope,
            config_json=self._default_config(normalized, scope),
        )
        self.db.add(row)
        self.db.flush()

        if row.is_default_sync_source:
            self._set_single_default(tenant_row.id, row.id)

        return row

    def _set_single_default(self, tenant_id: Any, provider_row_id: Any) -> None:
        (
            self.db.query(TenantProviderIntegration)
            .filter(TenantProviderIntegration.tenant_id == tenant_id)
            .filter(TenantProviderIntegration.id != provider_row_id)
            .update({"is_default_sync_source": False}, synchronize_session=False)
        )

    def update_provider(
        self,
        tenant_row: Tenant,
        provider_type: str,
        *,
        provider_id: str | None = None,
        label: str | None = None,
        is_active: bool | None = None,
        is_default_sync_source: bool | None = None,
        sync_folders: list[str] | object = _UNSET,
        oauth_mode: str | object = _UNSET,
        app_key: str | object = _UNSET,
        client_id: str | object = _UNSET,
        client_secret_name: str | object = _UNSET,
        token_secret_name: str | object = _UNSET,
        config_json_patch: dict[str, Any] | None = None,
    ) -> ProviderIntegrationRecord:
        row = self._ensure_provider_row(tenant_row, provider_type, provider_id=provider_id, label=label)

        if label is not None:
            clean_label = str(label or "").strip()
            if clean_label:
                row.label = clean_label

        if is_active is not None:
            row.is_active = bool(is_active)

        config_payload = dict(row.config_json or self._default_config(row.provider_type, row.secret_scope))

        if config_json_patch:
            for key, value in config_json_patch.items():
                config_payload[str(key)] = value

        if sync_folders is not _UNSET:
            config_payload["sync_folders"] = normalize_sync_folders(sync_folders)

        if oauth_mode is not _UNSET:
            mode = str(oauth_mode or "").strip().lower()
            if row.provider_type == "dropbox":
                if mode and mode != "managed":
                    raise ValueError("Only managed oauth_mode is supported for Dropbox")
                config_payload["oauth_mode"] = "managed"
            elif mode:
                config_payload["oauth_mode"] = mode
            else:
                config_payload.pop("oauth_mode", None)

        if app_key is not _UNSET:
            clean_value = str(app_key or "").strip()
            if clean_value:
                config_payload["app_key"] = clean_value
            else:
                config_payload.pop("app_key", None)

        if client_id is not _UNSET:
            clean_value = str(client_id or "").strip()
            if clean_value:
                config_payload["client_id"] = clean_value
            else:
                config_payload.pop("client_id", None)

        if client_secret_name is not _UNSET:
            clean_value = str(client_secret_name or "").strip()
            if clean_value:
                config_payload["client_secret_name"] = clean_value
            else:
                config_payload.pop("client_secret_name", None)

        if token_secret_name is not _UNSET:
            clean_value = str(token_secret_name or "").strip()
            if clean_value:
                config_payload["token_secret_name"] = clean_value
            else:
                config_payload.pop("token_secret_name", None)

        # Keep key secret names stable unless caller intentionally changes them.
        defaults = self._default_config(row.provider_type, row.secret_scope)
        for key, value in defaults.items():
            config_payload.setdefault(key, value)

        row.config_json = config_payload
        flag_modified(row, "config_json")

        if is_default_sync_source:
            row.is_default_sync_source = True
            self._set_single_default(tenant_row.id, row.id)

        self.db.flush()
        return self._record_from_row(row)

    def create_provider(
        self,
        tenant_row: Tenant,
        provider_type: str,
        *,
        label: str | None = None,
        is_active: bool = True,
        is_default_sync_source: bool = False,
        secret_scope: str | None = None,
        config_json: dict[str, Any] | None = None,
    ) -> ProviderIntegrationRecord:
        normalized = normalize_provider_type(provider_type)
        clean_scope = str(secret_scope or self._tenant_scope(tenant_row)).strip() or self._tenant_scope(tenant_row)
        clean_label = str(label or "").strip() or DEFAULT_PROVIDER_LABELS.get(normalized, normalized)

        has_default = (
            self.db.query(TenantProviderIntegration.id)
            .filter(
                TenantProviderIntegration.tenant_id == tenant_row.id,
                TenantProviderIntegration.is_default_sync_source.is_(True),
            )
            .first()
            is not None
        )

        merged_config = self._default_config(normalized, clean_scope)
        if config_json:
            for key, value in config_json.items():
                merged_config[str(key)] = value

        row = TenantProviderIntegration(
            tenant_id=tenant_row.id,
            provider_type=normalized,
            label=clean_label,
            is_active=bool(is_active),
            is_default_sync_source=bool(is_default_sync_source or not has_default),
            secret_scope=clean_scope,
            config_json=merged_config,
        )
        self.db.add(row)
        self.db.flush()

        if row.is_default_sync_source:
            self._set_single_default(tenant_row.id, row.id)

        self.db.flush()
        return self._record_from_row(row)

    def set_default_sync_provider(self, tenant_row: Tenant, provider_type: str) -> ProviderIntegrationRecord:
        row = self._ensure_provider_row(tenant_row, provider_type)
        row.is_default_sync_source = True
        self._set_single_default(tenant_row.id, row.id)
        self.db.flush()
        return self._record_from_row(row)

    def delete_provider(self, tenant_row: Tenant, provider_id: str) -> bool:
        record = self.get_provider_record_by_id(tenant_row, provider_id)
        if not record:
            return False

        row = (
            self.db.query(TenantProviderIntegration)
            .filter(
                TenantProviderIntegration.id == uuid.UUID(provider_id),
                TenantProviderIntegration.tenant_id == tenant_row.id,
            )
            .first()
        )
        if not row:
            return False

        self.db.delete(row)
        self.db.flush()

        remaining_default = (
            self.db.query(TenantProviderIntegration)
            .filter(
                TenantProviderIntegration.tenant_id == tenant_row.id,
                TenantProviderIntegration.is_default_sync_source.is_(True),
            )
            .first()
        )
        if not remaining_default:
            replacement = (
                self.db.query(TenantProviderIntegration)
                .filter(TenantProviderIntegration.tenant_id == tenant_row.id)
                .order_by(
                    TenantProviderIntegration.is_active.desc(),
                    TenantProviderIntegration.created_at.asc(),
                )
                .first()
            )
            if replacement:
                replacement.is_default_sync_source = True
                self._set_single_default(tenant_row.id, replacement.id)

        return True

    def backfill_tenant(self, tenant_row: Tenant) -> int:
        """Ensure minimal v2 provider rows exist for a tenant."""
        created = 0

        existing_by_type = {
            provider_type: (
                self.db.query(TenantProviderIntegration.id)
                .filter(
                    TenantProviderIntegration.tenant_id == tenant_row.id,
                    TenantProviderIntegration.provider_type == provider_type,
                )
                .first()
            )
            for provider_type in ALLOWED_PROVIDER_TYPES
        }

        if not existing_by_type["dropbox"]:
            self.create_provider(tenant_row, "dropbox", label=DEFAULT_PROVIDER_LABELS["dropbox"])
            created += 1

        if not existing_by_type["gdrive"]:
            self.create_provider(tenant_row, "gdrive", label=DEFAULT_PROVIDER_LABELS["gdrive"])
            created += 1

        has_default = (
            self.db.query(TenantProviderIntegration.id)
            .filter(
                TenantProviderIntegration.tenant_id == tenant_row.id,
                TenantProviderIntegration.is_default_sync_source.is_(True),
            )
            .first()
        )
        if not has_default:
            first = (
                self.db.query(TenantProviderIntegration)
                .filter(TenantProviderIntegration.tenant_id == tenant_row.id)
                .order_by(TenantProviderIntegration.created_at.asc())
                .first()
            )
            if first:
                first.is_default_sync_source = True
                self._set_single_default(tenant_row.id, first.id)

        self.db.flush()
        return created

    def build_runtime_context(self, tenant_row: Tenant) -> dict[str, Any]:
        records = self.list_provider_records(tenant_row, include_placeholders=True)
        default_record = self.resolve_default_sync_provider(tenant_row, records=records)
        primary = self.get_primary_records_by_type(tenant_row)

        dropbox_record = primary["dropbox"]
        gdrive_record = primary["gdrive"]

        return {
            "default_source_provider": default_record.provider_type,
            "dropbox": {
                "provider_id": dropbox_record.id,
                "label": dropbox_record.label,
                "source": dropbox_record.source,
                "secret_scope": dropbox_record.secret_scope,
                "oauth_mode": str(dropbox_record.config_json.get("oauth_mode") or "").strip().lower(),
                "sync_folders": normalize_sync_folders(dropbox_record.config_json.get("sync_folders")),
                "app_key": str(dropbox_record.config_json.get("app_key") or "").strip(),
                "token_secret_name": dropbox_record.dropbox_token_secret_name,
                "app_secret_name": dropbox_record.dropbox_app_secret_name,
            },
            "gdrive": {
                "provider_id": gdrive_record.id,
                "label": gdrive_record.label,
                "source": gdrive_record.source,
                "secret_scope": gdrive_record.secret_scope,
                "sync_folders": normalize_sync_folders(gdrive_record.config_json.get("sync_folders")),
                "client_id": str(gdrive_record.config_json.get("client_id") or "").strip(),
                "token_secret_name": gdrive_record.gdrive_token_secret_name,
                "client_secret_name": gdrive_record.gdrive_client_secret_name,
            },
            "resolution_source": "new_table" if any(record.source == "new_table" for record in records) else "synthetic",
        }


def backfill_tenant_provider_integrations(db: Session, tenant_rows: Iterable[Tenant]) -> dict[str, int]:
    repo = TenantIntegrationRepository(db)
    scanned = 0
    created = 0
    for tenant_row in tenant_rows:
        scanned += 1
        created += repo.backfill_tenant(tenant_row)
    return {
        "tenants_scanned": scanned,
        "provider_rows_created": created,
    }
