# RB-08 — Playbook approval pending (four-eyes)

**Trigger.** PagerDuty page: a mass SOAR action is in `REQUESTED` state awaiting a second
`PLATFORM_ADMIN` approval (target count exceeded `PLAYBOOK_MASS_ACTION_THRESHOLD`).

**Impact.** A containment action is **paused** by design until a second admin approves. If the
action is genuinely needed (e.g. quarantining many compromised EMS), delay increases exposure;
if it is a mistake, four-eyes just prevented a mass misfire. Decide deliberately.

**Diagnosis.**
1. Open Playbooks → Recent runs; find the `REQUESTED` run.
2. Read `actor`, `reason`, `targetCount`, and the target list. Cross-reference the linked case.
3. Confirm the requester is who they claim (out-of-band if anything looks off — a mass action is
   exactly what an attacker with a stolen admin token would attempt).

**Remediation.**
- **Legitimate:** as a *different* `PLATFORM_ADMIN` (not the requester), step-up MFA and click
  **Approve**. The run executes and every step is hash-chained into `audit_actions`.
- **Not legitimate / unsure:** click **Reject** with a reason. Investigate the requester's
  session (possible R-12 privilege grant or compromised token → consider revoke-token playbook).

**Guardrails you cannot override.** You cannot approve your own request (`approver !== actor`).
Dry-run runs never enter this state. These are intentional.

**Escalation.** If the requester's account may be compromised, treat as an incident: revoke
their sessions, open a case, and page the CISO.

**Post-incident.** Record the decision in the case action log. Recurringly-large legitimate
actions may warrant revisiting the mass-action threshold with the platform team.
