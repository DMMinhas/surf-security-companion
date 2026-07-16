import type { Severity } from '../valueObjects/severity.js';

export const CASE_STATUSES = ['OPEN', 'CONTAINED', 'ERADICATED', 'RECOVERED', 'CLOSED'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** Case lifecycle mirrors the NIST IR phases; regression is allowed one step back. */
const TRANSITIONS: Record<CaseStatus, readonly CaseStatus[]> = {
  OPEN: ['CONTAINED', 'CLOSED'],
  CONTAINED: ['ERADICATED', 'OPEN'],
  ERADICATED: ['RECOVERED', 'CONTAINED'],
  RECOVERED: ['CLOSED', 'ERADICATED'],
  CLOSED: ['OPEN'],
};

export function canTransitionCase(from: CaseStatus, to: CaseStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export type Nis2ReportKind = '24h' | '72h' | '1m';

export interface CaseAction {
  ts: string;
  actor: string;
  action: string;
  outcome: string;
  notes?: string;
}

export interface Nis2ReportRef {
  kind: Nis2ReportKind;
  ts: string;
  url: string;
  hash: string;
}

export interface Case {
  id: string;
  createdAt: string;
  createdBy: string;
  title: string;
  description: string;
  severity: Exclude<Severity, 'info'>;
  tenantId?: string;
  alerts: string[];
  attackTechniques: string[];
  actions: CaseAction[];
  status: CaseStatus;
  nis2ReportsGenerated: Nis2ReportRef[];
  /** Set when the case is classified a NIS2 "significant incident" — starts the 24h clock. */
  significantIncidentAt?: string;
}

/** NIS2 Art. 23 deadlines relative to significant-incident classification. */
export function nis2Deadline(classifiedAt: string, kind: Nis2ReportKind): Date {
  const base = new Date(classifiedAt).getTime();
  switch (kind) {
    case '24h':
      return new Date(base + 24 * 3600_000);
    case '72h':
      return new Date(base + 72 * 3600_000);
    case '1m': {
      const d = new Date(base);
      d.setUTCMonth(d.getUTCMonth() + 1);
      return d;
    }
  }
}
