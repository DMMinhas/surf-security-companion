# RB-03 — Correlation rule flooding

**Symptoms.** One rule emits > 100 alerts / 15 min; `surf_rule_fired_total` spikes for a single
`rule_id`; analysts overwhelmed.

**Impact.** Alert fatigue; real signal buried. Not an outage but a detection-quality incident.

**Diagnosis.**
1. Identify the rule from the Grafana "rule firings" panel or:
   `GET /api/rules` → sort by firing rate.
2. Open the rule (`/rules`) and its recent alerts (`/alerts?ruleId=…`). Is it a true incident
   (e.g. real mass curtailment R-08) or a noisy/broken rule?
3. Check the rule's `falsepositives` list and whether an expected suppression (test topic,
   change window, emergency flag) is missing.

**Remediation.**
- **True incident:** create a case, classify severity, follow the incident path (and
  [RB-06](RB-06-nis2-24h-clock-started.md) if significant). Do **not** disable the rule.
- **Noisy rule:** tune the fixture + condition (see `docs/RULE_AUTHORING.md`), or temporarily
  disable via `/rules/:id/disable` (step-up MFA; audit-logged). Dedup already collapses by
  `(ruleId, fingerprint, 15m)` — flooding past that means many distinct fingerprints.

**Escalation.** If disabling a rule, notify the detection owner (`owner` field) and file a
tuning issue. A disabled KRITIS-relevant rule is a compliance gap — time-box it.

**Post-incident.** Add/adjust a negative fixture so the noise pattern is covered by the CI gate.
