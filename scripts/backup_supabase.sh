#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${GCS_BUCKET:=zoltag-backups}"
: "${BACKUP_PREFIX:=zoltag}"
: "${PG_DUMP_FORMAT:=custom}"

export PGSSLMODE="${PGSSLMODE:-require}"

timestamp="$(date -u +"%Y%m%dT%H%M%SZ")"

if [[ "${PG_DUMP_FORMAT}" == "plain" ]]; then
  filename="${BACKUP_PREFIX}-${timestamp}.sql.gz"
  tmp_path="/tmp/${filename}"
  pg_dump --no-owner --no-privileges "${DATABASE_URL}" | gzip > "${tmp_path}"
else
  filename="${BACKUP_PREFIX}-${timestamp}.dump"
  tmp_path="/tmp/${filename}"
  pg_dump --format="${PG_DUMP_FORMAT}" --no-owner --no-privileges "${DATABASE_URL}" -f "${tmp_path}"
fi

gsutil cp "${tmp_path}" "gs://${GCS_BUCKET}/${filename}"
rm -f "${tmp_path}"
