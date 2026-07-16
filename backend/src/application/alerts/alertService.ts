import type { Alert, AlertStatus } from '../../domain/entities/alert.js';
import { canTransitionAlert } from '../../domain/entities/alert.js';
import type { AlertQuery, AlertRepository, EventStore, Page } from '../../domain/ports/repositories.js';
import type { CallerContext } from '../context.js';
import { ForbiddenError, InvalidTransitionError, NotFoundError, ValidationError } from '../errors.js';
import type { AuditService } from '../audit/auditService.js';
import { READ_ONLY_ROLES, isCrossTenant } from '../../domain/valueObjects/role.js';

export type BulkAction =
  | { action: 'ack'; ids: string[] }
  | { action: 'assign'; ids: string[]; assignee: string }
  | { action: 'link-case'; ids: string[]; caseId: string };

export class AlertService {
  constructor(
    private readonly alerts: AlertRepository,
    private readonly events: EventStore,
    private readonly audit: AuditService,
  ) {}

  /** Tenant scoping: non-cross-tenant callers can only ever see their own tenant. */
  private scope(caller: CallerContext, query: AlertQuery): AlertQuery {
    if (isCrossTenant(caller.roles)) return query;
    return { ...query, tenantId: caller.tenantId };
  }

  private assertWritable(caller: CallerContext): void {
    if (caller.roles.every((r) => READ_ONLY_ROLES.includes(r))) {
      throw new ForbiddenError('Read-only role may not mutate alerts');
    }
  }

  async list(caller: CallerContext, query: AlertQuery): Promise<Page<Alert>> {
    return this.alerts.list(this.scope(caller, query));
  }

  async getById(caller: CallerContext, id: string): Promise<Alert> {
    const tenantId = isCrossTenant(caller.roles) ? undefined : caller.tenantId;
    const alert = await this.alerts.getById(id, tenantId);
    if (!alert) throw new NotFoundError('Alert', id);
    return alert;
  }

  async setStatus(caller: CallerContext, id: string, status: AlertStatus, assignee?: string): Promise<Alert> {
    this.assertWritable(caller);
    const alert = await this.getById(caller, id);
    if (!canTransitionAlert(alert.status, status)) {
      throw new InvalidTransitionError('alert', alert.status, status);
    }
    const updated = await this.alerts.setStatus(id, status, assignee);
    await this.audit.record(caller, {
      action: 'alert.status.change',
      resourceType: 'alert',
      resourceId: id,
      outcome: 'success',
      details: { from: alert.status, to: status, assignee },
    });
    return updated;
  }

  async bulk(caller: CallerContext, request: BulkAction): Promise<{ affected: number }> {
    this.assertWritable(caller);
    if (request.ids.length === 0) throw new ValidationError('ids must not be empty');
    if (request.ids.length > 500) throw new ValidationError('bulk actions are capped at 500 alerts');

    // Verify visibility of every target before mutating anything (no partial cross-tenant writes).
    await Promise.all(request.ids.map((id) => this.getById(caller, id)));

    let affected = 0;
    switch (request.action) {
      case 'ack':
        for (const id of request.ids) {
          const alert = await this.alerts.getById(id);
          if (alert && canTransitionAlert(alert.status, 'ACKNOWLEDGED')) {
            await this.alerts.setStatus(id, 'ACKNOWLEDGED');
            affected += 1;
          }
        }
        break;
      case 'assign':
        affected = await this.alerts.assign(request.ids, request.assignee);
        break;
      case 'link-case':
        affected = await this.alerts.linkCase(request.ids, request.caseId);
        break;
    }
    await this.audit.record(caller, {
      action: `alert.bulk.${request.action}`,
      resourceType: 'alert',
      resourceId: request.ids.join(','),
      outcome: 'success',
      details: { count: request.ids.length, affected },
    });
    return { affected };
  }

  /** Raw events that contributed to an alert, for the investigation drawer. */
  async correlatedEvents(caller: CallerContext, id: string): Promise<Array<Record<string, unknown>>> {
    const alert = await this.getById(caller, id);
    if (alert.correlatedEventIds.length === 0) return [];
    return this.events.eventsByIds(alert.correlatedEventIds);
  }
}
