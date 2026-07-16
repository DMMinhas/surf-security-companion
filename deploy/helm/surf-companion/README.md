# surf-companion Helm chart (skeleton)

Deploys the **application tier** (backend + frontend) of the SURF Security Companion to
Kubernetes. This is a **starting point for the ops team**, not a fully production-tuned chart.

## Scope

In scope: backend/frontend Deployments + Services, Ingress (TLS 1.3, HSTS), ConfigMap,
ExternalSecret (Vault via ESO), NetworkPolicy, ServiceMonitor (Prometheus Operator),
PodSecurity "restricted" namespace labels, optional HPA.

**Out of scope (bring your own / separate charts):** OpenSearch, Wazuh, Keycloak, PostgreSQL,
MinIO, the OpenTelemetry collector and the Grafana stack. Point the backend `env`/secrets at
those managed services.

## Usage

```bash
helm lint deploy/helm/surf-companion
helm template surf-companion deploy/helm/surf-companion            # render
helm install surf-companion deploy/helm/surf-companion -n surf-soc --create-namespace \
  -f deploy/helm/surf-companion/values-prod.yaml
```

## Security posture

- Pods run non-root (uid 1001), read-only root FS, all capabilities dropped, seccomp
  `RuntimeDefault` — compatible with the PodSecurity **restricted** standard.
- Secrets are never in `values.yaml`; they come from Vault via the External Secrets Operator
  (`secret-external.yaml`). See [`../../../docs/SECRETS.md`](../../../docs/SECRETS.md).
- Images are expected to be **cosign-signed**; enforce with an admission controller
  (e.g. Sigstore Policy Controller / Kyverno `verifyImages`) so unsigned images are refused.

## Advisory tooling (referenced, not bundled)

Run these against the target cluster as part of hardening review:

- **kube-bench** — CIS Kubernetes benchmark of the nodes/control plane.
- **kube-hunter** — active/passive posture assessment.

Neither is embedded in the chart; they are cluster-level audits the platform team runs.

## Values

See [`values.yaml`](values.yaml) (documented inline) and
[`values-prod.yaml.example`](values-prod.yaml.example) for a production overlay.
