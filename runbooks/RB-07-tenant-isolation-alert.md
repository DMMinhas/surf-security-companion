# RB-07 — Tenant isolation alert

**Trigger.** R-04 (cross-tenant query) fires, or `surf_tenant_scope_denials_total` increments,
indicating a query whose tenant context did not match the data it touched.

**Impact.** Potential cross-tenant data exposure between VNBs — a confidentiality breach with
GDPR and contractual weight. Treat any confirmed leak as a reportable event.

**Diagnosis.**
1. Open the R-04 alert; pivot on `user.name` and `surf.tenant.id` in Investigate.
2. Determine whether this was:
   - a **blocked attempt** (the tenant-scope guard denied it — `surf_tenant_scope_denials_total`
     rose but no data was returned) — contained, but investigate intent; or
   - an **application bug** (`surf.enrichment.cross_tenant_mismatch=true` on a query that
     actually returned rows) — potential exposure.
3. Cross-check the audit trail: `GET /admin/audit?actor=<user>` for what the actor accessed.

**Remediation.**
- **Blocked attempt:** confirm no data left the boundary; if the actor is a service account,
  rotate its credentials and review its role mapping (possible R-12 correlation).
- **Application bug:** open a P1 engineering incident; the repository-level `WHERE tenant_id`
  filter is the last line of defence — if it was bypassed, freeze the affected endpoint.

**Escalation.** A confirmed cross-tenant data read is a data breach: engage the DPO, assess
GDPR Art. 33 notification, and consider NIS2 significant-incident classification
([RB-06](RB-06-nis2-24h-clock-started.md)).

**Post-incident.** Add a regression test proving the isolation holds (mirror the Playwright
tenant-isolation test), and review the middleware + repository filters.
