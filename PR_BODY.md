## Summary

Production-hardening and product-depth work on top of the initial build, plus the fixes from a
high-effort code review of this branch.

### Features
- **Ingest/eval-time enrichment engine** — computes `surf.enrichment.*` (impossible-travel,
  cross-tenant, firmware-downgrade, change-window, ip-allowlist) so R-02/04/10/13/15 fire on real
  telemetry. Runs at the correlation read boundary (see review #1 below).
- **Rule-conformance gate** — compiles every Sigma rule with the real `convert-sigma` and asserts
  the portal and Wazuh evaluators agree per rule (all 15 conformant).
- **Vault Transit hash-chain signer** (P1 #4) — Ed25519 key stays in Vault; verification is
  public-key-local (auditor-independent). Selected via `HASHCHAIN_SIGNER=vault`.
- **STRIDE threat model** (P1 #7) — `docs/THREAT_MODEL.md`: trust boundaries, threat register,
  kill-chains, assumptions.
- **Versioned detection content pack** (P2 #8) — manifest + content hash, ATT&CK coverage map, and
  ATT&CK Navigator layers generated from rule tags; `npm run pack:build` / `pack:check` (CI-gated).

### Code-review fixes (8 of 10 findings)
| # | Fix |
|---|-----|
| #1 | Enrichment relocated from a dead write-decorator to the correlation read boundary — it never ran on live telemetry before |
| #2 | `verify-hashchain.ts` now verifies in Vault mode (published-key / all-versions / soft-key) instead of always reading the private-key file |
| #3 | Composite Wazuh rule ids moved to a non-colliding band + duplicate-id guard (was a hard ceiling at 53 rules) |
| #4 | `VaultTransitSigner.verify()` tries all key versions, so historical rollups survive a key rotation; + request timeout |
| #5 | Missed hourly rollups are caught up (self-healing) and `verify()` detects ledger gaps |
| #6 | Content-pack hash now covers what selections match (values), not just field names |
| #7 | A connection with no client IP is no longer flagged off-allowlist (R-15 false positive) |
| #8 | PCRE2 metacharacters in match values are escaped (over-match / invalid-ruleset on the negate path) |

**Still open (tracked, low-urgency):** #9 conformance-simulator fidelity (test-only); #10
`DEMO_REFERENCE_CONFIG` hardcoded (documented; needs a reference-data-source decision).

## Verification
- `npm run typecheck -w backend` — clean
- `npm run test -w backend` — **132/132** (unit + rules)
- `npm run pack:check` — green
- Not yet run in this environment (need Docker/live services): Testcontainers integration, Playwright e2e.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
