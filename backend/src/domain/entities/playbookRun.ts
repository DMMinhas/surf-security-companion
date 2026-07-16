export const PLAYBOOKS = ['REVOKE_TOKEN', 'QUARANTINE_EMS'] as const;
export type PlaybookName = (typeof PLAYBOOKS)[number];

export const PLAYBOOK_RUN_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'EXECUTED',
  'FAILED',
] as const;
export type PlaybookRunStatus = (typeof PLAYBOOK_RUN_STATUSES)[number];

export interface PlaybookRun {
  id: string;
  ts: string;
  playbook: PlaybookName;
  actor: string;
  approver?: string;
  dryRun: boolean;
  target: Record<string, unknown>;
  reason: string;
  caseId?: string;
  status: PlaybookRunStatus;
  result?: unknown;
  /** SHA-256 over the canonical run record, chained to the previous run's hash. */
  hash: string;
  prevHash?: string;
  tenantId?: string;
  targetCount: number;
}

/** Four-eyes: mass actions park in REQUESTED until a *different* PLATFORM_ADMIN approves. */
export function requiresFourEyes(targetCount: number, threshold: number): boolean {
  return targetCount > threshold;
}

export function canApprove(run: PlaybookRun, approver: string): boolean {
  return run.status === 'REQUESTED' && approver !== run.actor;
}
