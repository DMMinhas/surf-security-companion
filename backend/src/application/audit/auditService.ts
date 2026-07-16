import type { AuditRepository } from '../../domain/ports/repositories.js';
import type { AuditAction } from '../../domain/entities/auditAction.js';
import type { CallerContext } from '../context.js';
import type { Logger } from 'pino';

export interface AuditEvent {
  action: string;
  resourceType: string;
  resourceId: string;
  outcome: 'success' | 'failure' | 'denied';
  details?: Record<string, unknown>;
}

/**
 * Single funnel for audit evidence: one Postgres append (hash-chained by the
 * repository), one structured log line. Services call this for every mutation.
 */
export class AuditService {
  constructor(
    private readonly repo: AuditRepository,
    private readonly log: Logger,
  ) {}

  async record(caller: CallerContext, event: AuditEvent): Promise<AuditAction> {
    const entry = await this.repo.append({
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      actor: caller.username,
      roles: caller.roles,
      ...(caller.tenantId !== undefined ? { tenantId: caller.tenantId } : {}),
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      outcome: event.outcome,
      requestId: caller.requestId,
      ...(event.details !== undefined ? { details: event.details } : {}),
    });
    this.log.info(
      {
        audit: true,
        user: caller.username,
        roles: caller.roles,
        tenant: caller.tenantId,
        action: event.action,
        resource: `${event.resourceType}/${event.resourceId}`,
        outcome: event.outcome,
        requestId: caller.requestId,
        auditHash: entry.hash,
      },
      'audit action recorded',
    );
    return entry;
  }
}
