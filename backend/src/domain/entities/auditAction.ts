/**
 * Append-only audit record. Every mutating API action, playbook step and
 * report generation produces exactly one row; rows are hash-chained
 * (sha256 over canonical JSON + prevHash) so tampering is detectable even
 * before the hourly Merkle rollup lands in WORM storage.
 */
export interface AuditAction {
  id: string;
  ts: string;
  actor: string;
  roles: string[];
  tenantId?: string;
  action: string; // e.g. "alert.status.change", "playbook.execute", "report.nis2.24h"
  resourceType: string;
  resourceId: string;
  outcome: 'success' | 'failure' | 'denied';
  requestId: string;
  details?: Record<string, unknown>;
  hash: string;
  prevHash?: string;
}

export interface HashchainLedgerEntry {
  hour: string; // ISO hour bucket, e.g. "2026-07-14T09:00:00Z"
  root: string; // hex Merkle root
  sig: string; // hex Ed25519 signature over `${hour}:${root}:${prevRoot ?? ''}`
  indexCount: number;
  byteCount: number;
  prevHour?: string;
  prevRoot?: string;
  createdAt: string;
}
