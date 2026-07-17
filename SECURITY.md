# Security Policy — SURF Security Companion

## Coordinated Disclosure (per RFC 9116)

We welcome reports of security vulnerabilities in the SURF Security Companion.

- **Contact:** security@surf-project.example (PGP key at `/.well-known/security.txt` on deployed instances)
- **Preferred languages:** en, de
- **Scope:** this repository and container images published from it. The upstream SURF
  platform (Flex API, EMS firmware, digital twin) has its own disclosure process.

### How to report

1. Email a description, reproduction steps, affected version/commit, and impact assessment.
2. You will receive an acknowledgement within **2 business days**.
3. We aim to triage within **7 days** and remediate High/Critical issues within **30 days**.
4. Please do not open public issues for security reports and do not test against
   production KRITIS deployments.

### Safe harbour

Good-faith research within scope — no data exfiltration beyond proof-of-concept, no
availability impact, no access to real prosumer data — will not be pursued legally.

## Supported versions

Only the latest minor release receives security fixes (MVP phase; semantic-release
changelog in GitHub Releases).

## Hardening baseline

- TLS 1.3 only, HSTS preload, nonce-based CSP, `frame-ancestors 'none'`.
- Non-root distroless containers, read-only root FS, dropped capabilities.
- Images cosign-signed (Sigstore keyless, Rekor transparency log); verify before deploy.
- CI gates: Trivy, CodeQL, Gitleaks — fail on High/Critical or exposed secrets.
- SBOM (CycloneDX) published per build.

## Threat model

A STRIDE threat model — trust boundaries, assets, threat register, priority kill-chains, and the
assumptions the controls rest on — is maintained at [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).
It is the artefact an independent penetration test / KRITIS review validates, and it must be
re-run on any change to the action path, auth model, tenant isolation, or the crypto pipeline.
