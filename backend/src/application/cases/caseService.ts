import type { Case, CaseAction, CaseStatus } from '../../domain/entities/case.js';
import { canTransitionCase } from '../../domain/entities/case.js';
import type { CaseQuery, CaseRepository, AlertRepository, Page } from '../../domain/ports/repositories.js';
import type { CallerContext } from '../context.js';
import { ForbiddenError, InvalidTransitionError, NotFoundError, ValidationError } from '../errors.js';
import type { AuditService } from '../audit/auditService.js';
import { READ_ONLY_ROLES, isCrossTenant } from '../../domain/valueObjects/role.js';
import type { Severity } from '../../domain/valueObjects/severity.js';

export interface CreateCaseInput {
  title: string;
  description: string;
  severity: Exclude<Severity, 'info'>;
  tenantId?: string;
  alertIds?: string[];
  significantIncident?: boolean;
}

export class CaseService {
  constructor(
    private readonly cases: CaseRepository,
    private readonly alerts: AlertRepository,
    private readonly audit: AuditService,
  ) {}

  private assertWritable(caller: CallerContext): void {
    if (caller.roles.every((r) => READ_ONLY_ROLES.includes(r))) {
      throw new ForbiddenError('Read-only role may not mutate cases');
    }
  }

  async list(caller: CallerContext, query: CaseQuery): Promise<Page<Case>> {
    const scoped = isCrossTenant(caller.roles) ? query : { ...query, tenantId: caller.tenantId };
    return this.cases.list(scoped);
  }

  async getById(caller: CallerContext, id: string): Promise<Case> {
    const tenantId = isCrossTenant(caller.roles) ? undefined : caller.tenantId;
    const found = await this.cases.getById(id, tenantId);
    if (!found) throw new NotFoundError('Case', id);
    return found;
  }

  async create(caller: CallerContext, input: CreateCaseInput): Promise<Case> {
    this.assertWritable(caller);
    const now = new Date().toISOString();
    const tenantId = isCrossTenant(caller.roles) ? input.tenantId : caller.tenantId;

    const attackTechniques = new Set<string>();
    for (const alertId of input.alertIds ?? []) {
      const alert = await this.alerts.getById(alertId, tenantId);
      if (!alert) throw new ValidationError(`alert ${alertId} not found or not in scope`);
      for (const t of alert.attack.enterprise ?? []) attackTechniques.add(t);
      for (const t of alert.attack.ics ?? []) attackTechniques.add(t);
    }

    const created = await this.cases.create({
      id: crypto.randomUUID(),
      createdAt: now,
      createdBy: caller.username,
      title: input.title,
      description: input.description,
      severity: input.severity,
      ...(tenantId !== undefined ? { tenantId } : {}),
      alerts: input.alertIds ?? [],
      attackTechniques: [...attackTechniques],
      actions: [
        { ts: now, actor: caller.username, action: 'case.created', outcome: 'success' },
      ],
      status: 'OPEN',
      nis2ReportsGenerated: [],
      ...(input.significantIncident ? { significantIncidentAt: now } : {}),
    });

    if (input.alertIds?.length) {
      await this.alerts.linkCase(input.alertIds, created.id);
    }
    await this.audit.record(caller, {
      action: 'case.create',
      resourceType: 'case',
      resourceId: created.id,
      outcome: 'success',
      details: { title: input.title, severity: input.severity, significant: !!input.significantIncident },
    });
    return created;
  }

  async setStatus(caller: CallerContext, id: string, status: CaseStatus): Promise<Case> {
    this.assertWritable(caller);
    const existing = await this.getById(caller, id);
    if (!canTransitionCase(existing.status, status)) {
      throw new InvalidTransitionError('case', existing.status, status);
    }
    const updated = await this.cases.setStatus(id, status);
    await this.audit.record(caller, {
      action: 'case.status.change',
      resourceType: 'case',
      resourceId: id,
      outcome: 'success',
      details: { from: existing.status, to: status },
    });
    return updated;
  }

  async addAction(caller: CallerContext, id: string, input: Omit<CaseAction, 'ts' | 'actor'>): Promise<Case> {
    this.assertWritable(caller);
    await this.getById(caller, id);
    const updated = await this.cases.addAction(id, {
      ts: new Date().toISOString(),
      actor: caller.username,
      ...input,
    });
    await this.audit.record(caller, {
      action: 'case.action.add',
      resourceType: 'case',
      resourceId: id,
      outcome: 'success',
      details: { action: input.action },
    });
    return updated;
  }

  async addAlerts(caller: CallerContext, id: string, alertIds: string[]): Promise<Case> {
    this.assertWritable(caller);
    if (alertIds.length === 0) throw new ValidationError('alertIds must not be empty');
    await this.getById(caller, id);
    const tenantId = isCrossTenant(caller.roles) ? undefined : caller.tenantId;
    for (const alertId of alertIds) {
      const alert = await this.alerts.getById(alertId, tenantId);
      if (!alert) throw new ValidationError(`alert ${alertId} not found or not in scope`);
    }
    await this.alerts.linkCase(alertIds, id);
    const updated = await this.cases.addAlerts(id, alertIds);
    await this.audit.record(caller, {
      action: 'case.alerts.link',
      resourceType: 'case',
      resourceId: id,
      outcome: 'success',
      details: { alertIds },
    });
    return updated;
  }

  /** Classify as NIS2 significant incident — starts the statutory 24h clock (RB-06). */
  async markSignificant(caller: CallerContext, id: string): Promise<Case> {
    this.assertWritable(caller);
    const existing = await this.getById(caller, id);
    if (existing.significantIncidentAt) return existing;
    const updated = await this.cases.markSignificant(id, new Date().toISOString());
    await this.audit.record(caller, {
      action: 'case.nis2.classified-significant',
      resourceType: 'case',
      resourceId: id,
      outcome: 'success',
    });
    return updated;
  }
}
