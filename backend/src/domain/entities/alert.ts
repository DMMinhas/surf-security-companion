import type { Severity } from '../valueObjects/severity.js';

export const ALERT_STATUSES = [
  'NEW',
  'ACKNOWLEDGED',
  'IN_PROGRESS',
  'RESOLVED',
  'FALSE_POSITIVE',
  'ESCALATED',
] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

/** Legal alert lifecycle transitions; anything else is rejected by the service layer. */
const TRANSITIONS: Record<AlertStatus, readonly AlertStatus[]> = {
  NEW: ['ACKNOWLEDGED', 'FALSE_POSITIVE', 'ESCALATED'],
  ACKNOWLEDGED: ['IN_PROGRESS', 'FALSE_POSITIVE', 'ESCALATED'],
  IN_PROGRESS: ['RESOLVED', 'FALSE_POSITIVE', 'ESCALATED'],
  RESOLVED: ['IN_PROGRESS'],
  FALSE_POSITIVE: ['NEW'],
  ESCALATED: ['IN_PROGRESS', 'RESOLVED'],
};

export function canTransitionAlert(from: AlertStatus, to: AlertStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface AlertArtifact {
  type: string;
  ref: string;
  hash?: string;
}

export interface AlertSource {
  system: string;
  host?: string;
  userId?: string;
  ip?: string;
}

export interface Alert {
  id: string;
  ts: string;
  severity: Severity;
  ruleId: string;
  ruleTitle: string;
  description: string;
  source: AlertSource;
  tenantId?: string;
  attack: { enterprise?: string[]; ics?: string[] };
  artifacts: AlertArtifact[];
  correlatedEventIds: string[];
  status: AlertStatus;
  assignee?: string;
  caseId?: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
}

/**
 * Deduplication fingerprint: same rule + same discriminating source fields
 * within the dedup window collapse into one alert with an incremented count.
 */
export function alertFingerprint(ruleId: string, source: AlertSource, tenantId?: string): string {
  return [ruleId, tenantId ?? '-', source.system, source.host ?? '-', source.userId ?? '-', source.ip ?? '-'].join('|');
}
