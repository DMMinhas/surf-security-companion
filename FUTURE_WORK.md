# Future Work & Known Caveats

Items flagged during the initial build that are intentionally deferred, need production
hardening, or are worth a maintainer's attention before go-live. This is distinct from
**Appendix A** of the build prompt (strategic v1/v2 enhancements like AI copilots, Temporal,
OpenFGA) — these are implementation-level notes about *this* codebase.

## 1. Verification not yet run in this environment

The following were written and wired into CI but require a Docker daemon / live services and
were **not** executed during the initial build:

- **Integration tests** (`backend/test/integration`, Testcontainers Postgres) — verify the
  repository SQL, the append-only audit hash-chain trigger, and tenant-filtered reads.
  Run: `npm run test:integration` (needs Docker).
- **Playwright e2e** (`e2e/acceptance.spec.ts`) — the full DoD flow (login → case → NIS2 →
  playbook dry-run → real mass action → four-eyes approval → tenant isolation).
  Run: `docker compose up -d && npm run seed && npm run test:e2e`.
- **`docker compose up`** end-to-end — first boot exercises Keycloak realm import, OpenSearch
  bootstrap, Sigma→Wazuh compile, MinIO Object-Lock bucket creation, and Grafana provisioning.

**Action:** run all three on a machine with Docker before the first stakeholder demo, and let
CI (`.github/workflows/ci.yml`) gate them on every PR thereafter.

## 2. TypeScript `exactOptionalPropertyTypes`

This flag is **off** (every other strict check, including `noUncheckedIndexedAccess`, is on).
It collides pervasively with Zod's `.optional()`, which yields `T | undefined` and cannot be
assigned to an `exactOptionalPropertyTypes` target without conditional spreads at every call
site.

**Trade-off:** turning it back on buys stricter optional-property semantics at the cost of
`...(x !== undefined ? { x } : {})` boilerplate throughout the route and service layers.
**Action:** revisit if the team wants the stricter guarantee; it is a mechanical (if noisy)
change, best done in one pass.

## 3. NIS2 `.docx` templates are minimal placeholders

The three templates in `backend/src/compliance/nis2Templates/*.docx` are valid OOXML with the
correct docxtemplater tags (verified rendering, including the `{#actions}` loop), but they carry
**no official NIS2 layout, branding, or legal boilerplate**.

**Action:** replace them with the authority-approved report layouts. The render pipeline,
WORM storage, hash receipt, and audit-ledger chaining are complete and do not need to change —
only the template documents.

## 4. MFA enrolment on first login

The Keycloak realm seeds demo users with `CONFIGURE_TOTP` as a required action, so the **first**
login for each user forces authenticator enrolment before reaching the portal. This satisfies
the MFA requirement but can surprise a first-time demo operator.

**Action:** pre-enrol OTP for demo accounts (and inject the secret into
`E2E_OTP_<USER>` for Playwright), or brief demo operators that the first login includes an
enrolment step. WebAuthn is the intended primary factor in production; OTP is the scriptable
fallback used by e2e.

## 5. Hash-chain signing key is a soft key (MVP)

`FileEd25519Signer` reads a hex private key from disk (`HASHCHAIN_SIGNING_KEY_PATH`). This is
acceptable for dev/MVP only.

**Action:** implement an HSM/PKCS#11 (or Vault Transit) `Signer` adapter and bind it in
`main.ts` for production, so the private key never leaves the HSM. Migration path is documented
in [`docs/SECRETS.md`](docs/SECRETS.md).

## 6. Correlation scheduler vs. Wazuh — shared roster, two evaluators

The portal's in-process `CorrelationScheduler` and the compiled Wazuh ruleset both derive from
the same Sigma source, but they are **separate evaluators**. The portal evaluator implements a
deliberate subset of the Sigma condition grammar (documented in
[`docs/RULE_AUTHORING.md`](docs/RULE_AUTHORING.md)).

**Action:** any rule using a construct beyond that subset must extend
`backend/src/correlation/evaluator.ts` **with fixtures**, and the two evaluators should be
periodically reconciled (a rule that fires in Wazuh but not the portal, or vice-versa, is a
detection gap). Consider a conformance test that diffs the two on the seed data.

## 7. Frontend bundle size

`vite build` emits a chunk-size advisory driven by **Mermaid** (~600 kB). It is already
lazy-chunked via `manualChunks`, so it does not block first paint of the SOC views.

**Action:** if first-load budget matters, dynamically `import()` `MermaidDiagram` so the Mermaid
chunk loads only when a case-flow diagram is actually rendered.

## 8. Rate limiting is per-instance

`@fastify/rate-limit` uses an in-memory store, so limits are per backend replica. With
`replicaCount.backend > 1` (Helm default is 2), effective limits are multiplied by the replica
count.

**Action:** for production, back the rate limiter with a shared Redis store so limits are
cluster-wide, especially on the login-adjacent and playbook endpoints.

## 9. Ingestion path is seed-driven in the MVP

`scripts/seed.ts` pushes representative events directly into OpenSearch so all 15 rules fire.
Real log shippers (Keycloak events, API-gateway access logs, MQTT broker, K8s audit, Hetzner
syslog) are expected to feed `surf-events-*` in the same ECS + `surf.*` shape; only the pgaudit
promtail collector is wired in compose.

**Action:** stand up the remaining source-specific shippers/decoders and confirm each maps to
the normalisation schema in [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md). The `surf.enrichment.*`
booleans (impossible-travel, cross-tenant, firmware-downgrade, change-window, ip-allowlist)
must be computed at ingest — the rules match them but do not compute them.
