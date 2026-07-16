# Caldera adversary emulation — Week 11

> [MITRE Caldera](https://github.com/mitre/caldera) adversary profiles for chained emulation.
> Manual artefacts for the purple-team exercise; not wired into CI.

## Setup

1. Stand up a Caldera server on the staging jump host.
2. Deploy the Sandcat agent on a non-production SURF app host that is in-scope for the exercise.
3. Import the two profiles below as adversary definitions.

## Profile A — "Credential access → persistence" (Enterprise)

Chains abilities that should light up R-01, R-03, R-05, R-12, R-13 in sequence:

1. Password-spray Keycloak (T1110) → **R-01**
2. MFA prompt-bombing until approval (T1621) → **R-03**
3. Replay stale/forged JWT at the gateway (T1078.004) → **R-05**
4. Grant self `PLATFORM_ADMIN` (T1098.003) → **R-12**
5. Create an off-hours service account for persistence (T1136.003) → **R-13**

**Success criterion:** a single Caldera operation produces 5 correlated alerts that an analyst
can group into one case; the case's ATT&CK technique list matches the profile.

## Profile B — "Grid manipulation" (ICS)

Chains SURF-specific ICS abilities (custom Caldera abilities calling the MQTT/engine test hooks):

1. Degrade the signing service (T1565) → **R-06**
2. Publish unsigned curtailment commands (T0836) → **R-07**
3. Mass-curtail a feeder (T0813) → **R-08**
4. Push a setpoint past the safety envelope (T0836) → **R-09**

**Success criterion:** the mass-curtailment alert (R-08, critical) pages on-call; the analyst
opens a case, classifies it as a NIS2 significant incident, and generates a 24-h early warning
inside the exercise window — validating the end-to-end DoD flow.

## Reporting

Export the Caldera operation report and attach it to the exercise case as evidence. Record
detection coverage per ability and file tuning issues for any ability that did not alert.
