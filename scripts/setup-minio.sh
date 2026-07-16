#!/bin/sh
# setup-minio sidecar: creates the WORM buckets with Object Lock (Compliance
# mode) and a default retention. Idempotent — safe to re-run on every boot.
set -eu

echo "waiting for MinIO at ${MINIO_ENDPOINT}..."
mc alias set local "${MINIO_ENDPOINT}" "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}"

for bucket in "${MINIO_BUCKET_AUDIT}" "${MINIO_BUCKET_HASHCHAIN}"; do
  if mc ls "local/${bucket}" >/dev/null 2>&1; then
    echo "bucket ${bucket} exists"
  else
    # --with-lock is required at creation time; Object Lock cannot be enabled later
    mc mb --with-lock "local/${bucket}"
    echo "created ${bucket} with Object Lock"
  fi
  mc retention set --default COMPLIANCE "${MINIO_OBJECT_LOCK_YEARS}y" "local/${bucket}"
  echo "set COMPLIANCE retention ${MINIO_OBJECT_LOCK_YEARS}y on ${bucket}"
done

# readiness marker used by the backend /ready probe
printf 'ok' | mc pipe "local/${MINIO_BUCKET_AUDIT}/.keep" || true
echo "minio setup complete"
