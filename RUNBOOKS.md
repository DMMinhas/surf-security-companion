# Runbooks Index

Operational scenarios for the SURF Security Companion SOC. Each runbook follows the same
structure: **Symptoms → Impact → Diagnosis → Remediation → Escalation → Post-incident**.
Written to be executable at 3am by a single on-call operator.

| ID | Scenario | Trigger |
|----|----------|---------|
| [RB-01](runbooks/RB-01-ingestion-stalled.md) | Ingestion stalled | `surf_ingestion_lag_seconds` alert / empty Alerts page |
| [RB-02](runbooks/RB-02-opensearch-red.md) | OpenSearch cluster red | `/ready` fails on OpenSearch / Grafana panel red |
| [RB-03](runbooks/RB-03-rule-flooding.md) | Correlation rule flooding | > 100 alerts/15 min from one rule |
| [RB-04](runbooks/RB-04-storage-full.md) | Storage full (hot or WORM) | disk-usage alert ≥ 85 % |
| [RB-05](runbooks/RB-05-hash-chain-failure.md) | Hash-chain rollup failure | `surf_hashchain_rollup_success` = 0 / verify tool mismatch |
| [RB-06](runbooks/RB-06-nis2-24h-clock-started.md) | NIS2 24-hour clock started | case marked *significant incident* |
| [RB-07](runbooks/RB-07-tenant-isolation-alert.md) | Tenant isolation alert | R-04 cross-tenant rule fires |
| [RB-08](runbooks/RB-08-playbook-approval-pending.md) | Playbook approval pending | PagerDuty page: four-eyes approval required |

**Conventions**

- Every command block assumes you are in the repo root of the deployed compose stack
  (or the equivalent kubectl context for Helm deployments).
- `⏱` marks steps that are on the NIS2 statutory clock.
- Escalation contacts live in the on-call rota (PagerDuty service `surf-soc`), never in git.
