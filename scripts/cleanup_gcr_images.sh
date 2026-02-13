#!/usr/bin/env bash
set -euo pipefail

# Deletes old Container Registry image digests, keeping those currently used
# by Cloud Run services. Defaults to dry-run; set RUN=1 to actually delete.

PROJECT_ID="${PROJECT_ID:-photocat-483622}"
REGION="${REGION:-us-central1}"
IMAGE="gcr.io/${PROJECT_ID}/zoltag"
RUN="${RUN:-0}"

services=(zoltag-api zoltag-worker)

echo "Project: ${PROJECT_ID}"
echo "Region: ${REGION}"
echo "Image: ${IMAGE}"
echo "Run delete: ${RUN}"
echo ""

keep_digests=$(
  for service in "${services[@]}"; do
    gcloud run services describe "${service}" \
      --region "${REGION}" \
      --format='value(spec.template.spec.containers[0].image)' \
      | sed 's/.*@//'
  done | sort -u
)

echo "Keeping digests:"
echo "${keep_digests}"
echo ""

gcloud container images list-tags "${IMAGE}" --format='get(digest)' | sort -u | while read -r digest; do
  if ! echo "${keep_digests}" | grep -q "${digest}"; then
    echo "DELETE: ${IMAGE}@${digest}"
    if [ "${RUN}" = "1" ]; then
      gcloud container images delete "${IMAGE}@${digest}" --force-delete-tags --quiet
    fi
  fi
done
