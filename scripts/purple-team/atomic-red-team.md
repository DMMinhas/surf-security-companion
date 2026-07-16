# Atomic Red Team scenarios — Week 11 purple-team exercise

> These are **manual exercise artefacts**, not automated tests. Run them in the staging
> environment during the week-11 validation exercise (see `runbooks/` for the incident-side
> playbooks each scenario should trigger). Map each atomic to the SURF rule it validates.

## Prerequisites

- Staging stack up (`docker compose up`), seeded, analyst logged in.
- [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) checked out on a jump host
  that can reach the Keycloak, API gateway and MQTT broker endpoints.
- A ticket in the change calendar so the SOC knows this is an exercise (avoids a real NIS2 clock).

## Scenarios

| # | Technique | Atomic | Validates rule | Expected detection |
|---|-----------|--------|----------------|--------------------|
| 1 | T1110 Brute Force | T1110.001 (password guessing loop against Keycloak) | R-01 | ≥10 `LOGIN_ERROR` → alert within 60 s |
| 2 | T1621 MFA Request Generation | custom: spam OTP prompts then approve | R-03 | critical alert, MFA-fatigue |
| 3 | T1078.004 Cloud Accounts | replay a token signed with a rotated key | R-05 | JWT signature failure spike |
| 4 | T1098.003 Additional Cloud Roles | grant `PLATFORM_ADMIN` via Keycloak admin API | R-12 | privileged-grant alert |
| 5 | T1136.003 Create Cloud Account | create a service account at 02:00 | R-13 | off-window service account |
| 6 | T1609 Container Administration Command | `kubectl exec` into a `environment=production` pod | R-14 | exec-into-prod alert |
| 7 | T1078 Valid Accounts | psql from an off-allowlist IP | R-15 | DB access off-allowlist |

## ICS-flavoured scenarios (SURF-specific, no upstream atomic)

| # | ATT&CK ICS | Action | Validates rule |
|---|-----------|--------|----------------|
| 8 | T0836 Modify Parameter | publish an unsigned `schedule/*` MQTT command | R-07 |
| 9 | T0813 Denial of Control | issue >50 curtailments to one feeder in 10 min | R-08 |
| 10 | T0836 | submit a setpoint outside the safety envelope | R-09 |
| 11 | T0857 Firmware | report a downgraded EMS firmware version | R-10 |

## Exercise scoring

For each scenario record: **detected? (y/n)**, **time-to-alert**, **alert accuracy**,
**analyst action**, **would this have paged?**. Feed misses back into rule tuning and file
follow-up issues. Target: 100 % detection on the 15-rule roster, ≤30 s P95 time-to-alert (N-02).
