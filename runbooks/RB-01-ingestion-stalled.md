# RB-01 — Ingestion stalled

**Symptoms.** `surf_ingestion_lag_seconds` climbing past 120 s; Alerts page shows no new alerts;
Grafana "ingestion lag" panel red.

**Impact.** Detection is blind. NIS2 detection-latency SLO (N-02, ≤30 s P95) breached. Treat as
a potential availability incident.

**Diagnosis.**
1. `docker compose ps` — is `wazuh-manager` / `opensearch` healthy?
2. `docker compose logs --tail=100 opensearch` — look for `blocked by: [FORBIDDEN/12/index read-only]`
   (disk watermark) → go to [RB-04](RB-04-storage-full.md).
3. `curl -sk -u admin:$OPENSEARCH_PASSWORD https://localhost:9200/_cat/indices/surf-events-*?v`
   — is today's index growing?
4. Backend `/ready` — does OpenSearch check pass?

**Remediation.**
- If OpenSearch is red/yellow → [RB-02](RB-02-opensearch-red.md).
- If a shipper is down, restart it: `docker compose restart pgaudit-collector` (or the upstream
  log source). Confirm events resume with the `_cat/indices` count.
- If the correlation scheduler is wedged, restart the backend: `docker compose restart backend`
  and watch for `correlation scheduler started` in logs.

**Escalation.** If lag stays > 5 min after restarts, page the platform on-call (PagerDuty
`surf-soc`). Capture `docker compose logs` for the incident record.

**Post-incident.** File the root cause; if disk-driven, review retention (N-07/N-08).
