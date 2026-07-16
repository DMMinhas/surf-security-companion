# Architecture

## Overview

The SURF Security Companion is a bespoke SOC portal over a Wazuh + OpenSearch SIEM core.
It follows **Clean Architecture**: dependencies point inward, business logic never imports
framework or IO code.

```
┌────────────────────────────────────────────────────────────────┐
│  nginx (TLS 1.3, HSTS, nonce-CSP)                               │
│   ├── /            → frontend (React 19 SPA, served by `serve`) │
│   ├── /api/        → backend (Fastify 5)                        │
│   └── /realms/     → Keycloak 26 (OIDC + PKCE + WebAuthn/OTP)   │
└────────────────────────────────────────────────────────────────┘
        │                         │
        ▼                         ▼
  ┌───────────┐          ┌──────────────────────────────────────┐
  │ Keycloak  │          │ backend (Clean Architecture)         │
  └───────────┘          │  interface  → infrastructure/http    │
        ▲                │  application→ services / use cases   │
        │ JWKS           │  domain     → entities, ports (pure) │
        │                │  infrastructure → adapters:          │
        │                │     postgres · opensearch · minio    │
        │                │     keycloak · ems · flex · wazuh    │
        │                │     pagerduty · slack · otel/prom    │
        │                └──────────────────────────────────────┘
        │                   │        │        │         │
        ▼                   ▼        ▼        ▼         ▼
   correlation        Postgres 17  OpenSearch  MinIO   Wazuh
   scheduler (60s)    (portal      (events +   (WORM)   manager
                       state)       alerts)
```

## Layers (backend)

| Layer | Directory | May import | Contents |
|-------|-----------|-----------|----------|
| Domain | `src/domain` | nothing | entities, value objects, port interfaces |
| Application | `src/application` | domain | services / use cases, typed errors |
| Correlation | `src/correlation` | domain | Sigma loader, evaluator, scheduler |
| Infrastructure | `src/infrastructure` | domain, application | Fastify, repositories, connectors, telemetry |
| Composition root | `src/main.ts` | everything | wires adapters into services |

The **domain never imports infrastructure**. Services depend only on port interfaces
(`domain/ports`), so repositories and connectors are swappable and unit-testable with fakes.

## Request lifecycle

1. nginx terminates TLS, mints/propagates `x-request-id`, applies CSP + rate limits.
2. `authz` middleware verifies the JWT (jose/JWKS: iss, aud, exp, nbf), checks the role
   allow-list, and builds `req.caller` (with `tenantId` for scoped roles).
3. `tenantScope` guard rejects explicit cross-tenant parameters (defence-in-depth on top of
   repository-level `WHERE tenant_id = $claim`).
4. Route handler validates the body with Zod (`strict`), calls an application service.
5. Service enforces business rules, performs IO through ports, writes an `audit_actions`
   row (hash-chained) and a Pino log line, emits an OpenTelemetry span.

## Detection pipeline

- Sigma rules in `/rules` are the **source of truth**. `scripts/convert-sigma.ts` compiles
  them to Wazuh XML at deploy time (sigma-compiler container).
- The in-process `CorrelationScheduler` also evaluates the same rules every 60 s over a
  rolling 5-minute OpenSearch window, deduplicating by `(ruleId, fingerprint, 15m)` — this
  is what populates the portal's alert store and the `surf_rule_fired_total` metric.
- Both paths share one rule roster so detection logic never diverges.

## Cryptographic integrity

- **Hourly Merkle rollups**: `MerkleChainService` computes a Merkle root over
  `(event_id, content_hash)` for the previous hour, signs it (Ed25519), and writes it to
  both Postgres `hashchain_ledger` and MinIO WORM. Each root chains to the previous.
- **Append-only audit**: `audit_actions` rows are SHA-256 hash-chained and protected by a
  Postgres trigger forbidding UPDATE/DELETE.
- **Independent export roots**: KRITIS/audit bundles compute their own Merkle root over the
  bundle contents so an auditor can verify an export in isolation.

## Why these choices (MVP posture)

Maximalist on compliance evidence, crypto integrity, tenant isolation, detection breadth and
observability; conservative on AI, workflow orchestration and platform sophistication. See
Appendix A of the build prompt and `README` for the deferred-enhancements rationale.
