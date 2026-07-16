# RB-06 — NIS2 24-hour clock started ⏱

**Trigger.** A case is classified a **significant incident** (via the case detail action or
`POST /cases/:id/classify-significant`). This starts the statutory NIS2 Art. 23 reporting clock.

**Impact.** Legal obligation. Deadlines run from the classification timestamp
(`significantIncidentAt`):

| Report | Deadline | Endpoint / button |
|--------|----------|-------------------|
| ⏱ Early warning | **24 h** | NIS2 panel → *Early Warning (24 h)* |
| ⏱ Incident notification | **72 h** | NIS2 panel → *Incident Notification (72 h)* |
| ⏱ Final report | **1 month** | NIS2 panel → *Final Report (1 month)* |

**Actions.**
1. Confirm the classification is correct (significant = major operational impact / affects other
   VNBs / safety). If misclassified, that is itself a governance decision — do not silently revert.
2. Assign an incident lead. The case action log is the running incident record.
3. **Within 24 h:** generate the early warning from the NIS2 panel (step-up MFA). The `.docx`
   lands in MinIO WORM with a hash receipt chained into the audit ledger.
4. Keep the case action log current — it feeds the 72-h and 1-month templates.
5. Track the countdowns shown in the NIS2 panel; the panel marks a deadline **OVERDUE** in red.

**Escalation.** The early-warning deadline is hard. If generation fails, this is a P1 — page
platform on-call immediately; a missed statutory deadline is worse than any tooling outage.

**Post-incident.** After the final report, verify all three reports exist with valid hashes
(they are listed in the NIS2 panel) and close the case through the lifecycle.
