#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-photocat-483622}"
REGION="${REGION:-us-central1}"
API_SERVICE="${API_SERVICE:-zoltag-api}"
SENTINEL_SERVICE="${SENTINEL_SERVICE:-zoltag-sentinel}"
WORKER_LIGHT_JOB="${WORKER_LIGHT_JOB:-${WORKER_JOB:-zoltag-worker-light-job}}"
WORKER_ML_JOB="${WORKER_ML_JOB:-zoltag-worker-ml-job}"
SCHEDULER_JOB="${SCHEDULER_JOB:-zoltag-sentinel-tick}"
SENTINEL_TOKEN_SECRET_NAME="${SENTINEL_TOKEN_SECRET_NAME:-sentinel-auth-token}"
ENVIRONMENT="${ENVIRONMENT:-prod}"
STORAGE_BUCKET_NAME="${STORAGE_BUCKET_NAME:-${PROJECT_ID}-prod-shared}"
THUMBNAIL_BUCKET_NAME="${THUMBNAIL_BUCKET_NAME:-${STORAGE_BUCKET_NAME}}"
PERSON_REFERENCE_BUCKET_NAME="${PERSON_REFERENCE_BUCKET_NAME:-${PROJECT_ID}-prod-person-references}"
THUMBNAIL_CDN_BASE_URL="${THUMBNAIL_CDN_BASE_URL:-}"
THUMBNAIL_SIGNED_URLS="${THUMBNAIL_SIGNED_URLS:-true}"

SENTINEL_WORKER_LIGHT_MAX_PARALLEL="${SENTINEL_WORKER_LIGHT_MAX_PARALLEL:-${SENTINEL_WORKER_MAX_PARALLEL:-8}}"
SENTINEL_WORKER_LIGHT_MAX_DISPATCH_PER_TICK="${SENTINEL_WORKER_LIGHT_MAX_DISPATCH_PER_TICK:-${SENTINEL_WORKER_MAX_DISPATCH_PER_TICK:-4}}"
SENTINEL_WORKER_ML_MAX_PARALLEL="${SENTINEL_WORKER_ML_MAX_PARALLEL:-2}"
SENTINEL_WORKER_ML_MAX_DISPATCH_PER_TICK="${SENTINEL_WORKER_ML_MAX_DISPATCH_PER_TICK:-1}"
SENTINEL_CRON="${SENTINEL_CRON:-* * * * *}"

LIGHT_WORKER_CPU="${LIGHT_WORKER_CPU:-${WORKER_CPU:-1}}"
LIGHT_WORKER_MEMORY="${LIGHT_WORKER_MEMORY:-${WORKER_MEMORY:-2Gi}}"
LIGHT_WORKER_TIMEOUT="${LIGHT_WORKER_TIMEOUT:-${WORKER_TIMEOUT:-3600s}}"
LIGHT_WORKER_MAX_RETRIES="${LIGHT_WORKER_MAX_RETRIES:-${WORKER_MAX_RETRIES:-0}}"

ML_WORKER_CPU="${ML_WORKER_CPU:-2}"
ML_WORKER_MEMORY="${ML_WORKER_MEMORY:-8Gi}"
ML_WORKER_TIMEOUT="${ML_WORKER_TIMEOUT:-10800s}"
ML_WORKER_MAX_RETRIES="${ML_WORKER_MAX_RETRIES:-0}"

SENTINEL_CPU="${SENTINEL_CPU:-1}"
SENTINEL_MEMORY="${SENTINEL_MEMORY:-512Mi}"
SENTINEL_TIMEOUT="${SENTINEL_TIMEOUT:-60}"
SENTINEL_MAX_INSTANCES="${SENTINEL_MAX_INSTANCES:-1}"

LIGHT_IMAGE="${LIGHT_IMAGE:-${IMAGE_LIGHT:-${IMAGE:-}}}"
ML_IMAGE="${ML_IMAGE:-${IMAGE_ML:-}}"

resolve_images_from_api() {
  local api_image
  if api_image=$(gcloud run services describe "${API_SERVICE}" \
      --project "${PROJECT_ID}" \
      --region "${REGION}" \
      --platform managed \
      --format='value(spec.template.spec.containers[0].image)' 2>/dev/null); then
    if [[ -n "${api_image}" ]]; then
      if [[ -z "${LIGHT_IMAGE}" ]]; then
        LIGHT_IMAGE="${api_image}"
      fi
    fi
  fi

  if [[ -z "${LIGHT_IMAGE}" ]]; then
    LIGHT_IMAGE="gcr.io/${PROJECT_ID}/zoltag:latest"
  fi
  if [[ -z "${ML_IMAGE}" ]]; then
    ML_IMAGE="$(printf '%s' "${LIGHT_IMAGE}" | sed -E 's#/zoltag([:@])#/zoltag-ml\1#')"
  fi
  if [[ "${ML_IMAGE}" == "${LIGHT_IMAGE}" ]]; then
    ML_IMAGE="gcr.io/${PROJECT_ID}/zoltag-ml:latest"
  fi
}

secret_exists() {
  local secret_name="$1"
  gcloud secrets describe "${secret_name}" --project "${PROJECT_ID}" >/dev/null 2>&1
}

build_secret_map() {
  local require_all="$1"; shift
  local entries=("$@")
  local out=()
  local missing_required=()
  local entry env_name secret_name

  for entry in "${entries[@]}"; do
    env_name="${entry%%:*}"
    secret_name="${entry##*:}"
    if secret_exists "${secret_name}"; then
      out+=("${env_name}=${secret_name}:latest")
    else
      if [[ "${require_all}" == "true" ]]; then
        missing_required+=("${secret_name}")
      else
        echo "Warning: Optional secret '${secret_name}' not found; skipping ${env_name}" >&2
      fi
    fi
  done

  if [[ ${#missing_required[@]} -gt 0 ]]; then
    echo "Missing required secrets: ${missing_required[*]}" >&2
    exit 1
  fi

  local joined=""
  local i
  for i in "${!out[@]}"; do
    if [[ $i -gt 0 ]]; then
      joined+=","
    fi
    joined+="${out[$i]}"
  done
  printf '%s' "${joined}"
}

require_gcloud() {
  command -v gcloud >/dev/null 2>&1 || {
    echo "gcloud CLI is required" >&2
    exit 1
  }
}

ensure_secret_with_token() {
  local token
  if gcloud secrets describe "${SENTINEL_TOKEN_SECRET_NAME}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
    if [[ "${REGENERATE_SENTINEL_TOKEN:-false}" == "true" ]]; then
      token="$(openssl rand -hex 32)"
      printf '%s' "${token}" | gcloud secrets versions add "${SENTINEL_TOKEN_SECRET_NAME}" \
        --project "${PROJECT_ID}" \
        --data-file=- >/dev/null
    else
      token="$(gcloud secrets versions access latest --secret "${SENTINEL_TOKEN_SECRET_NAME}" --project "${PROJECT_ID}")"
    fi
  else
    token="$(openssl rand -hex 32)"
    gcloud secrets create "${SENTINEL_TOKEN_SECRET_NAME}" \
      --project "${PROJECT_ID}" \
      --replication-policy=automatic >/dev/null
    printf '%s' "${token}" | gcloud secrets versions add "${SENTINEL_TOKEN_SECRET_NAME}" \
      --project "${PROJECT_ID}" \
      --data-file=- >/dev/null
  fi
  SENTINEL_AUTH_TOKEN_VALUE="${token}"
}

deploy_worker_job() {
  local job_name="$1"
  local image="$2"
  local worker_profile="$3"
  local worker_cpu="$4"
  local worker_memory="$5"
  local worker_timeout="$6"
  local worker_max_retries="$7"
  local env_vars
  local secrets_map
  env_vars="GCP_PROJECT_ID=${PROJECT_ID},ENVIRONMENT=${ENVIRONMENT},WORKER_MODE=true,JOB_WORKER_ONCE=true,JOB_WORKER_ENABLE_MAINTENANCE_TICKS=false,JOB_WORKER_PROFILE=${worker_profile},TAGGING_MODEL_AUTO_DOWNLOAD=false,STORAGE_BUCKET_NAME=${STORAGE_BUCKET_NAME},THUMBNAIL_BUCKET_NAME=${THUMBNAIL_BUCKET_NAME},PERSON_REFERENCE_BUCKET_NAME=${PERSON_REFERENCE_BUCKET_NAME},THUMBNAIL_CDN_BASE_URL=${THUMBNAIL_CDN_BASE_URL},THUMBNAIL_SIGNED_URLS=${THUMBNAIL_SIGNED_URLS}"
  local required_secrets=(
    "DATABASE_URL:supabase-db-url"
    "SUPABASE_SERVICE_ROLE_KEY:supabase-service-role-key"
    "SUPABASE_URL:supabase-url"
  )
  local optional_secrets=(
    "ZOLTAG_GDRIVE_CONNECTOR_CLIENT_ID:zoltag-gdrive-connector-client-id"
    "ZOLTAG_GDRIVE_CONNECTOR_SECRET:zoltag-gdrive-connector-secret"
    "ZOLTAG_FLICKR_CONNECTOR_API_KEY:zoltag-flickr-connector-api-key"
    "ZOLTAG_FLICKR_CONNECTOR_API_SECRET:zoltag-flickr-connector-api-secret"
    "DROPBOX_APP_KEY:dropbox-app-key"
    "DROPBOX_APP_SECRET:dropbox-app-secret"
    "GEMINI_API_KEY:gemini-api-key"
  )
  local required_map optional_map
  required_map="$(build_secret_map true "${required_secrets[@]}")"
  optional_map="$(build_secret_map false "${optional_secrets[@]}")"
  secrets_map="${required_map}"
  if [[ -n "${optional_map}" ]]; then
    secrets_map="${secrets_map},${optional_map}"
  fi

  if gcloud run jobs describe "${job_name}" --project "${PROJECT_ID}" --region "${REGION}" >/dev/null 2>&1; then
    gcloud run jobs update "${job_name}" \
      --project "${PROJECT_ID}" \
      --region "${REGION}" \
      --image "${image}" \
      --memory "${worker_memory}" \
      --cpu "${worker_cpu}" \
      --task-timeout "${worker_timeout}" \
      --max-retries "${worker_max_retries}" \
      --set-env-vars "${env_vars}" \
      --set-secrets "${secrets_map}" \
      --command python \
      --args="-m,zoltag.worker"
  else
    gcloud run jobs create "${job_name}" \
      --project "${PROJECT_ID}" \
      --region "${REGION}" \
      --image "${image}" \
      --memory "${worker_memory}" \
      --cpu "${worker_cpu}" \
      --task-timeout "${worker_timeout}" \
      --max-retries "${worker_max_retries}" \
      --set-env-vars "${env_vars}" \
      --set-secrets "${secrets_map}" \
      --command python \
      --args="-m,zoltag.worker"
  fi
}

deploy_sentinel_service() {
  local env_vars
  local secrets_map
  env_vars="GCP_PROJECT_ID=${PROJECT_ID},ENVIRONMENT=prod,WORKER_MODE=false,SENTINEL_MODE=true,SENTINEL_DISPATCH_ENABLED=true,SENTINEL_WORKER_JOB_NAME=${WORKER_LIGHT_JOB},SENTINEL_WORKER_LIGHT_JOB_NAME=${WORKER_LIGHT_JOB},SENTINEL_WORKER_ML_JOB_NAME=${WORKER_ML_JOB},SENTINEL_WORKER_REGION=${REGION},SENTINEL_WORKER_PROJECT_ID=${PROJECT_ID},SENTINEL_WORKER_MAX_PARALLEL=${SENTINEL_WORKER_LIGHT_MAX_PARALLEL},SENTINEL_WORKER_MAX_DISPATCH_PER_TICK=${SENTINEL_WORKER_LIGHT_MAX_DISPATCH_PER_TICK},SENTINEL_WORKER_LIGHT_MAX_PARALLEL=${SENTINEL_WORKER_LIGHT_MAX_PARALLEL},SENTINEL_WORKER_LIGHT_MAX_DISPATCH_PER_TICK=${SENTINEL_WORKER_LIGHT_MAX_DISPATCH_PER_TICK},SENTINEL_WORKER_ML_MAX_PARALLEL=${SENTINEL_WORKER_ML_MAX_PARALLEL},SENTINEL_WORKER_ML_MAX_DISPATCH_PER_TICK=${SENTINEL_WORKER_ML_MAX_DISPATCH_PER_TICK}"
  secrets_map="$(build_secret_map true \
    "DATABASE_URL:supabase-db-url" \
    "SENTINEL_AUTH_TOKEN:${SENTINEL_TOKEN_SECRET_NAME}")"

  gcloud run deploy "${SENTINEL_SERVICE}" \
    --project "${PROJECT_ID}" \
    --image "${LIGHT_IMAGE}" \
    --region "${REGION}" \
    --platform managed \
    --allow-unauthenticated \
    --memory "${SENTINEL_MEMORY}" \
    --cpu "${SENTINEL_CPU}" \
    --timeout "${SENTINEL_TIMEOUT}" \
    --max-instances "${SENTINEL_MAX_INSTANCES}" \
    --min-instances 0 \
    --set-env-vars "${env_vars}" \
    --set-secrets "${secrets_map}" \
    --command uvicorn \
    --args "zoltag.api:app,--host,0.0.0.0,--port,8080,--workers,1"
}

upsert_scheduler_job() {
  local sentinel_url
  sentinel_url="$(gcloud run services describe "${SENTINEL_SERVICE}" \
    --project "${PROJECT_ID}" \
    --region "${REGION}" \
    --platform managed \
    --format='value(status.url)')"

  if [[ -z "${sentinel_url}" ]]; then
    echo "Could not resolve sentinel service URL" >&2
    exit 1
  fi

  local target_uri
  target_uri="${sentinel_url}/api/v1/internal/sentinel/tick"
  local headers
  headers="Content-Type=application/json,X-Sentinel-Token=${SENTINEL_AUTH_TOKEN_VALUE}"

  if gcloud scheduler jobs describe "${SCHEDULER_JOB}" --project "${PROJECT_ID}" --location "${REGION}" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "${SCHEDULER_JOB}" \
      --project "${PROJECT_ID}" \
      --location "${REGION}" \
      --schedule "${SENTINEL_CRON}" \
      --http-method POST \
      --uri "${target_uri}" \
      --update-headers "${headers}" \
      --message-body '{}'
  else
    gcloud scheduler jobs create http "${SCHEDULER_JOB}" \
      --project "${PROJECT_ID}" \
      --location "${REGION}" \
      --schedule "${SENTINEL_CRON}" \
      --http-method POST \
      --uri "${target_uri}" \
      --headers "${headers}" \
      --message-body '{}'
  fi

  gcloud scheduler jobs run "${SCHEDULER_JOB}" \
    --project "${PROJECT_ID}" \
    --location "${REGION}" >/dev/null || true
}

print_summary() {
  echo
  echo "Configured sentinel + burst workers:" 
  echo "  Project: ${PROJECT_ID}"
  echo "  Region: ${REGION}"
  echo "  Light image: ${LIGHT_IMAGE}"
  echo "  ML image: ${ML_IMAGE}"
  echo "  Worker light job: ${WORKER_LIGHT_JOB}"
  echo "  Worker ML job: ${WORKER_ML_JOB}"
  echo "  Sentinel service: ${SENTINEL_SERVICE}"
  echo "  Scheduler job: ${SCHEDULER_JOB}"
  echo
  echo "Quick checks:"
  echo "  gcloud run jobs describe ${WORKER_LIGHT_JOB} --project ${PROJECT_ID} --region ${REGION}"
  echo "  gcloud run jobs describe ${WORKER_ML_JOB} --project ${PROJECT_ID} --region ${REGION}"
  echo "  gcloud run services describe ${SENTINEL_SERVICE} --project ${PROJECT_ID} --region ${REGION} --format='value(status.url)'"
  echo "  gcloud scheduler jobs describe ${SCHEDULER_JOB} --project ${PROJECT_ID} --location ${REGION}"
}

main() {
  require_gcloud
  resolve_images_from_api
  ensure_secret_with_token
  deploy_worker_job "${WORKER_LIGHT_JOB}" "${LIGHT_IMAGE}" "light" "${LIGHT_WORKER_CPU}" "${LIGHT_WORKER_MEMORY}" "${LIGHT_WORKER_TIMEOUT}" "${LIGHT_WORKER_MAX_RETRIES}"
  deploy_worker_job "${WORKER_ML_JOB}" "${ML_IMAGE}" "ml" "${ML_WORKER_CPU}" "${ML_WORKER_MEMORY}" "${ML_WORKER_TIMEOUT}" "${ML_WORKER_MAX_RETRIES}"
  deploy_sentinel_service
  upsert_scheduler_job
  print_summary
}

main "$@"
