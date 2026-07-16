# RB-04 — Storage full (hot or WORM)

**Symptoms.** Disk-usage alert ≥ 85 %; OpenSearch read-only blocks; MinIO writes failing;
hash-chain rollups failing.

**Impact.** Ingestion stalls, rollups fail, WORM writes rejected. Compliance + availability risk.

**Diagnosis.**
```bash
df -h                       # host volumes
docker system df            # docker-managed volumes
curl -sk -u admin:$OPENSEARCH_PASSWORD https://localhost:9200/_cat/allocation?v
```
Distinguish **hot** (OpenSearch data volume) from **WORM** (MinIO volume).

**Remediation — hot (OpenSearch).**
- Delete indices older than the 90-day hot window (N-07) — but only after confirming they are
  archived to WORM/cold:
  ```bash
  curl -sk -u admin:$OPENSEARCH_PASSWORD -XDELETE https://localhost:9200/surf-events-2026.04.*
  ```
- Clear the read-only block after freeing space (see RB-02).

**Remediation — WORM (MinIO).**
- WORM objects under Object-Lock retention **cannot be deleted** before expiry — that is by
  design (compliance). Add capacity (expand the volume / add a disk) instead. Never attempt to
  bypass Object-Lock.

**Escalation.** WORM exhaustion is a capacity-planning failure — page platform on-call and
raise a capacity ticket; do not delete audit evidence.

**Post-incident.** Review retention settings (`MINIO_OBJECT_LOCK_YEARS`, hot-window ILM) and
forecast growth against N-08 (≥12 months cold).
