# Secrets Management — `.env` → Vault migration path

## MVP (dev): `.env`

Development loads secrets from `.env` via `dotenv`. Secrets are masked in logs two ways:
Pino path redaction (`*.password`, `authorization`, …) **and** value scrubbing of every
configured secret string. **Never commit a filled-in `.env`** (`.gitignore` blocks it).

The hash-chain signing key is a soft Ed25519 key at `HASHCHAIN_SIGNING_KEY_PATH`
(`scripts/gen-dev-certs.sh` generates one for dev).

## Production: HashiCorp Vault + External Secrets Operator

### Topology

```
Vault (AppRole auth)  ──▶  External Secrets Operator (K8s)  ──▶  Kubernetes Secret  ──▶  Pod env
       ▲                                                                                    │
       └── HSM / PKCS#11 backs the hash-chain signing key (never leaves the HSM)  ◀─────────┘
```

### Migration steps

1. **Enable KV v2** at `secret/surf-companion`.
2. **Write secrets** under per-role paths (see policies below).
3. **Enable AppRole** auth; issue a role per workload (`backend`, `sigma-compiler`).
4. Install **External Secrets Operator**; create an `ExternalSecret` per Kubernetes Secret,
   referencing the Vault path. The Helm chart's `secret-external.yaml` is the template.
5. Replace the soft signing key with an **HSM/PKCS#11** provider: implement a `Signer` adapter
   backed by the HSM and bind it in `main.ts` instead of `FileEd25519Signer`. The private key
   never leaves the HSM; the backend calls `sign`/`verify` over PKCS#11.
6. Remove `.env` from the deployment; the Pod receives secrets only via mounted Secret.

### Vault policies (per role)

```hcl
# policy: surf-backend
path "secret/data/surf-companion/backend/*" { capabilities = ["read"] }
path "secret/data/surf-companion/shared/opensearch" { capabilities = ["read"] }
path "secret/data/surf-companion/shared/postgres"   { capabilities = ["read"] }
path "secret/data/surf-companion/shared/minio"      { capabilities = ["read"] }
path "transit/sign/surf-hashchain"   { capabilities = ["update"] }   # if using Vault Transit instead of HSM
path "transit/verify/surf-hashchain" { capabilities = ["update"] }
```

```hcl
# policy: surf-sigma-compiler   (read-only, no signing)
path "secret/data/surf-companion/shared/opensearch" { capabilities = ["read"] }
```

```hcl
# policy: surf-auditor   (break-glass verification tooling)
path "secret/data/surf-companion/shared/*" { capabilities = ["read"] }
path "transit/verify/surf-hashchain" { capabilities = ["update"] }
```

### Rotation

- DB / OpenSearch / MinIO credentials: rotate via Vault dynamic secrets or scheduled rotation;
  ESO refreshes the Kubernetes Secret and the Deployment rolls.
- Signing key: rotate at the HSM; publish the new public key to auditors and record the
  rotation in `audit_actions`. Old roots remain verifiable against the archived public key.

### What must never be in `.env` or Vault-as-plaintext in prod

The signing **private** key (HSM only) and any customer PII (the SOC holds only pseudonyms).
