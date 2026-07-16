# RB-05 — Hash-chain rollup failure

**Symptoms.** `surf_hashchain_rollups_total{outcome="failure"}` increments; Settings →
"Hash-chain integrity" shows failures; `npm run verify:hashchain` reports a mismatch.

**Impact.** Tamper-evidence for the log store is in question. **This is a compliance-critical
event** (NIS2 Art. 21(2)(h), KRITIS evidence). Preserve state; do not "fix" by regenerating.

**Diagnosis.**
```bash
npm run verify:hashchain -- --from <hourISO> --to <hourISO>
```
The tool reports one of:
- **root mismatch** — recomputed Merkle root ≠ ledger root → events changed/were deleted after
  signing, **or** the rollup ran while OpenSearch was mid-recovery ([RB-02](RB-02-opensearch-red.md)).
- **invalid signature** — signing key mismatch or ledger tampering.
- **broken chain linkage** — a rollup is missing (scheduler was down that hour).
- **WORM copy missing / disagrees** — MinIO write failed or the ledger was altered.

**Remediation.**
1. **Do not delete or rewrite** any ledger row or WORM object (both are append-only/locked).
2. If the cause is a benign gap (backend was down for an hour), that hour has no rollup — record
   the gap in the incident log; future hours still chain correctly from the last good root.
3. If it is a root mismatch caused by an OpenSearch recovery window, re-run verification after
   the cluster is green; a persistent mismatch is a genuine integrity finding.
4. If the signing key was rotated, verify against the **archived public key** for old hours.

**Escalation.** A confirmed mismatch that is **not** explained by a gap or recovery window is a
suspected tampering event: page the CISO/on-call, freeze the affected indices, and open a formal
incident. Consider whether a NIS2 significant-incident classification applies
([RB-06](RB-06-nis2-24h-clock-started.md)).

**Post-incident.** Snapshot the ledger + WORM objects as evidence. Review why the rollup failed
(scheduler health, MinIO availability) and add alerting if missing.
