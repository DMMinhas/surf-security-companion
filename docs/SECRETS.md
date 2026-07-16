# Secrets Management — `.env` → Vault migration path

## MVP (dev): `.env`

Development loads secrets from `.env` via `dotenv`. Secrets are masked in logs two ways:
Pino path redaction (`*.password`, `authorization`, …) **and** value scrubbing of every
configured secret string. **Never commit a filled-in `.env`** (`.gitignore` blocks it).

The hash-chain signer is selectable via `HASHCHAIN_SIGNER` (default `file`). In dev it is a
soft Ed25519 key at `HASHCHAIN_SIGNING_KEY_PATH` (`scripts/gen-dev-certs.sh` generates one).
For production, set `HASHCHAIN_SIGNER=vault` to keep the private key inside HashiCorp Vault —
see [Vault Transit signer](#vault-transit-signer-implemented) below.

## Production: HashiCorp Vault + External Secrets Operator

### Topology

```
Vault (AppRole auth)  ──▶  External Secrets Operator (K8s)  ──▶  Kubernetes Secret  ──▶  Pod env
       ▲                                                                                    │
       └── Vault Transit (implemented) or HSM/PKCS#11 signs the hash chain
           — the private key never leaves Vault/the HSM  ◀───────────────────────────────────┘
```

### Migration steps

1. **Enable KV v2** at `secret/surf-companion`.
2. **Write secrets** under per-role paths (see policies below).
3. **Enable AppRole** auth; issue a role per workload (`backend`, `sigma-compiler`).
4. Install **External Secrets Operator**; create an `ExternalSecret` per Kubernetes Secret,
   referencing the Vault path. The Helm chart's `secret-external.yaml` is the template.
5. Replace the soft signing key: set `HASHCHAIN_SIGNER=vault` to use the shipped
   [Vault Transit signer](#vault-transit-signer-implemented) — no code change needed. (An
   **HSM/PKCS#11** `Signer` adapter remains a valid alternative if a hardware module is
   mandated; it would bind in `main.ts` the same way.)
6. Remove `.env` from the deployment; the Pod receives secrets only via mounted Secret.

### Vault Transit signer (implemented)

`VaultTransitSigner` (`backend/src/infrastructure/integrations/vaultTransitSigner.ts`) generates
and holds the Ed25519 key inside Vault's Transit engine; the backend only ever asks Vault to
**sign**. Chain **verification is a local public-key operation** — the public key is fetched
from Vault once and cached, then signatures are checked with `@noble/ed25519`. So auditors can
verify tamper-evidence with the published public key alone, needing neither Vault availability
nor the signing token. The ledger `sig` (raw Ed25519 hex) is unchanged, so rollups written under
the soft key stay verifiable after cut-over (as long as that key's public half is archived).

**Config (env):**

| Var | Required | Default | Meaning |
| --- | --- | --- | --- |
| `HASHCHAIN_SIGNER` | — | `file` | Set to `vault` to use Transit. |
| `VAULT_ADDR` | yes (vault) | — | e.g. `https://vault:8200`. |
| `VAULT_TOKEN` | yes (vault) | — | Token with `update` on `transit/sign/<key>`, `read` on `transit/keys/<key>`. |
| `VAULT_TRANSIT_KEY` | — | `surf-hashchain` | Transit key name. |
| `VAULT_NAMESPACE` | — | — | Vault Enterprise namespace. |

Config validation (`config.ts`) rejects `HASHCHAIN_SIGNER=vault` without `VAULT_ADDR` +
`VAULT_TOKEN`, and `file` without `HASHCHAIN_SIGNING_KEY_PATH`.

**One-time operator setup:**

```sh
vault secrets enable transit                                   # if not already enabled
vault write -f transit/keys/surf-hashchain type=ed25519        # key is generated in Vault
vault read  transit/keys/surf-hashchain                        # publish public_key to auditors
```

### Vault policies (per role)

```hcl
# policy: surf-backend
path "secret/data/surf-companion/backend/*" { capabilities = ["read"] }
path "secret/data/surf-companion/shared/opensearch" { capabilities = ["read"] }
path "secret/data/surf-companion/shared/postgres"   { capabilities = ["read"] }
path "secret/data/surf-companion/shared/minio"      { capabilities = ["read"] }
# With HASHCHAIN_SIGNER=vault. The adapter signs via transit, then verifies LOCALLY with the
# public key it reads from transit/keys — so it needs read on the key, not Vault-side verify.
path "transit/sign/surf-hashchain" { capabilities = ["update"] }
path "transit/keys/surf-hashchain" { capabilities = ["read"] }
```

```hcl
# policy: surf-sigma-compiler   (read-only, no signing)
path "secret/data/surf-companion/shared/opensearch" { capabilities = ["read"] }
```

```hcl
# policy: surf-auditor   (break-glass verification tooling)
# Chain verification is fully local: fetch the public key once (or use the published one), then
# verify Ed25519 offline. No sign/verify capability on Vault is required.
path "secret/data/surf-companion/shared/*" { capabilities = ["read"] }
path "transit/keys/surf-hashchain" { capabilities = ["read"] }
```

### Rotation

- DB / OpenSearch / MinIO credentials: rotate via Vault dynamic secrets or scheduled rotation;
  ESO refreshes the Kubernetes Secret and the Deployment rolls.
- Signing key: with Vault Transit, `vault write -f transit/keys/surf-hashchain/rotate` (or at the
  HSM); the adapter caches the public key per process, so restart the backend after a rotation to
  pick up the new version. Publish the new public key to auditors and record the rotation in
  `audit_actions`. Old roots remain verifiable against the archived public key.

### What must never be in `.env` or Vault-as-plaintext in prod

The signing **private** key (inside Vault Transit or an HSM only — never on disk in prod) and any
customer PII (the SOC holds only pseudonyms).
