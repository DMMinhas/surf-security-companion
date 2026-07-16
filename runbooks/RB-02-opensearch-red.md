# RB-02 — OpenSearch cluster red

**Symptoms.** `/ready` fails on OpenSearch; Dashboards unreachable; cluster health `red`.

**Impact.** Alerts, search and hash-chain rollups all depend on OpenSearch. High severity.

**Diagnosis.**
```bash
curl -sk -u admin:$OPENSEARCH_PASSWORD https://localhost:9200/_cluster/health?pretty
curl -sk -u admin:$OPENSEARCH_PASSWORD https://localhost:9200/_cat/shards?v | grep -v STARTED
docker compose logs --tail=200 opensearch
```
Common causes: unassigned primary shards, JVM heap OOM, disk watermark, `vm.max_map_count` too low.

**Remediation.**
- **Heap/OOM:** raise `OPENSEARCH_JAVA_OPTS` heap in compose (or reduce on laptops via the
  override), `docker compose up -d opensearch`.
- **max_map_count:** `sudo sysctl -w vm.max_map_count=262144` (persist in `/etc/sysctl.conf`).
- **Disk watermark:** free space → [RB-04](RB-04-storage-full.md), then clear the read-only block:
  ```bash
  curl -sk -u admin:$OPENSEARCH_PASSWORD -XPUT https://localhost:9200/_all/_settings \
    -H 'Content-Type: application/json' -d '{"index.blocks.read_only_allow_delete":null}'
  ```
- **Unassigned shards:** allow re-allocation:
  ```bash
  curl -sk -u admin:$OPENSEARCH_PASSWORD -XPOST https://localhost:9200/_cluster/reroute?retry_failed=true
  ```

**Escalation.** If a primary shard is lost with no replica (single-node dev), restore from the
last MinIO snapshot / re-seed for demo. In prod, page platform on-call; RTO target ≤ 4 h (N-05).

**Post-incident.** Verify the hash chain over the affected window ([RB-05](RB-05-hash-chain-failure.md))
— a red cluster during a rollup hour needs a re-verification.
