import type { Alert, AlertStatus } from '../entities/alert.js';
import type { Case, CaseAction, CaseStatus, Nis2ReportRef } from '../entities/case.js';
import type { PlaybookRun, PlaybookRunStatus } from '../entities/playbookRun.js';
import type { AuditAction, HashchainLedgerEntry } from '../entities/auditAction.js';
import type { RuleStats } from '../entities/sigmaRule.js';

export interface Page<T> {
  items: T[];
  nextCursor?: string;
  total: number;
}

export interface AlertQuery {
  status?: AlertStatus;
  severity?: string;
  tenantId?: string;
  ruleId?: string;
  q?: string;
  from?: string;
  to?: string;
  limit: number;
  cursor?: string;
}

export interface AlertRepository {
  list(query: AlertQuery): Promise<Page<Alert>>;
  getById(id: string, tenantId?: string): Promise<Alert | undefined>;
  upsert(alert: Alert): Promise<void>;
  setStatus(id: string, status: AlertStatus, assignee?: string): Promise<Alert>;
  linkCase(ids: string[], caseId: string): Promise<number>;
  assign(ids: string[], assignee: string): Promise<number>;
  findByFingerprint(fingerprint: string, since: string): Promise<Alert | undefined>;
  countByRuleSince(since: string): Promise<Map<string, number>>;
}

export interface CaseQuery {
  status?: CaseStatus;
  tenantId?: string;
  limit: number;
  cursor?: string;
}

export interface CaseRepository {
  list(query: CaseQuery): Promise<Page<Case>>;
  getById(id: string, tenantId?: string): Promise<Case | undefined>;
  create(c: Case): Promise<Case>;
  setStatus(id: string, status: CaseStatus): Promise<Case>;
  addAction(id: string, action: CaseAction): Promise<Case>;
  addAlerts(id: string, alertIds: string[]): Promise<Case>;
  addNis2Report(id: string, ref: Nis2ReportRef): Promise<Case>;
  markSignificant(id: string, at: string): Promise<Case>;
}

export interface PlaybookRunRepository {
  create(run: PlaybookRun): Promise<PlaybookRun>;
  getById(id: string): Promise<PlaybookRun | undefined>;
  list(filter: { status?: PlaybookRunStatus; limit: number }): Promise<PlaybookRun[]>;
  update(run: PlaybookRun): Promise<PlaybookRun>;
  lastHash(): Promise<string | undefined>;
}

export interface AuditRepository {
  append(action: Omit<AuditAction, 'hash' | 'prevHash'>): Promise<AuditAction>;
  list(filter: { actor?: string; from?: string; to?: string; limit: number }): Promise<AuditAction[]>;
  lastHash(): Promise<string | undefined>;
}

export interface HashchainRepository {
  append(entry: HashchainLedgerEntry): Promise<void>;
  latest(): Promise<HashchainLedgerEntry | undefined>;
  range(fromHour: string, toHour: string): Promise<HashchainLedgerEntry[]>;
}

export interface SavedQuery {
  id: string;
  name: string;
  owner: string;
  tenantId?: string;
  query: Record<string, unknown>;
  createdAt: string;
}

export interface SavedQueryRepository {
  create(q: SavedQuery): Promise<SavedQuery>;
  listByOwner(owner: string): Promise<SavedQuery[]>;
}

export interface RuleStateRepository {
  isEnabled(ruleId: string): Promise<boolean>;
  setEnabled(ruleId: string, enabled: boolean): Promise<void>;
  stats(ruleIds: string[]): Promise<RuleStats[]>;
}

/** Read-side port over the OpenSearch log store. */
export interface EventStore {
  search(params: {
    tenantId?: string;
    query: Record<string, unknown>;
    from?: string;
    to?: string;
    limit: number;
  }): Promise<Array<Record<string, unknown>>>;
  pivot(field: string, value: string, tenantId?: string, limit?: number): Promise<Array<Record<string, unknown>>>;
  eventsInHour(hourStartIso: string): Promise<Array<{ id: string; contentHash: string; bytes: number }>>;
  eventsByIds(ids: string[]): Promise<Array<Record<string, unknown>>>;
  eventsForSubject(pseudonym: string): Promise<Array<Record<string, unknown>>>;
  ingest(events: Array<Record<string, unknown>>): Promise<void>;
  searchWindow(since: string, until: string): Promise<Array<Record<string, unknown>>>;
}
