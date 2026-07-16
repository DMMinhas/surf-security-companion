# Playbook Authoring (SOAR safe-mode)

The MVP ships two playbooks — **Revoke API Token** and **Quarantine EMS** — implemented as
hand-coded state machines in `src/application/playbooks/playbookService.ts`. Workflow
orchestration (Temporal/Camunda) is deliberately deferred (Appendix A) until the roster
exceeds ~10 playbooks.

## Non-negotiable safety guards

Any new playbook MUST preserve all five:

1. **Dry-run default ON** — real execution requires an explicit `dryRun: false`.
2. **Step-up MFA** — `assertStepUp(caller)` throws `StepUpRequiredError` unless the token
   carries an MFA-level `acr` (config `PLAYBOOK_REQUIRE_STEPUP`).
3. **Four-eyes for mass actions** — if `targetCount > PLAYBOOK_MASS_ACTION_THRESHOLD`, a real
   run parks in `REQUESTED`, PagerDuty pages on-call, and a *different* `PLATFORM_ADMIN` must
   approve. `canApprove` enforces `approver !== actor`.
4. **Full audit trail** — every transition writes an `audit_actions` row and updates the
   hash-chained `playbook_runs` record.
5. **Reversibility** — actions must be undoable or capture enough state for manual reversal
   (`Quarantine EMS` has `reset`; `Revoke Token` records `priorState`).

## Adding a playbook

1. Add the name to `PLAYBOOKS` in `domain/entities/playbookRun.ts`.
2. Add a connector port in `domain/ports/connectors.ts` and an adapter in
   `infrastructure/integrations`.
3. Add a `createRun` + `execute<Name>` pair in `PlaybookService`, reusing the guard helpers.
4. Add a route in `infrastructure/http/routes/playbooks.ts` (operators only; strict rate limit).
5. Add unit tests mirroring `test/unit/playbookService.test.ts` (step-up, dry-run,
   four-eyes, reversibility, hash-chaining) and extend the Playwright acceptance flow.

## State machine

```
REQUESTED ──approve(2nd admin)──▶ APPROVED ──execute──▶ EXECUTED
    │                                                     ▲
    └──reject──▶ REJECTED                   (dry-run / below-threshold
                                             skip REQUESTED, go straight
                                             to APPROVED→EXECUTED)
                                            execute failure ──▶ FAILED
```
