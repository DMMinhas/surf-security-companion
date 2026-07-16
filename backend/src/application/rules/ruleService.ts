import type { RuleStateRepository } from '../../domain/ports/repositories.js';
import type { SigmaRule, RuleStats } from '../../domain/entities/sigmaRule.js';
import type { CallerContext } from '../context.js';
import type { AuditService } from '../audit/auditService.js';
import { ForbiddenError, NotFoundError, StepUpRequiredError } from '../errors.js';
import type { RuleEvaluator } from '../../correlation/evaluator.js';

export interface RuleView extends SigmaRule {
  stats: RuleStats | undefined;
}

export class RuleService {
  constructor(
    private readonly loadedRules: () => SigmaRule[],
    private readonly state: RuleStateRepository,
    private readonly evaluator: RuleEvaluator,
    private readonly audit: AuditService,
    private readonly requireStepUp: boolean,
  ) {}

  async list(): Promise<RuleView[]> {
    const rules = this.loadedRules();
    const stats = await this.state.stats(rules.map((r) => r.id));
    const byId = new Map(stats.map((s) => [s.ruleId, s]));
    const views: RuleView[] = [];
    for (const rule of rules) {
      views.push({
        ...rule,
        enabled: await this.state.isEnabled(rule.id),
        stats: byId.get(rule.id),
      });
    }
    return views;
  }

  async getById(id: string): Promise<RuleView> {
    const rule = this.loadedRules().find((r) => r.id === id || r.fileId === id);
    if (!rule) throw new NotFoundError('Rule', id);
    const [stats] = await this.state.stats([rule.id]);
    return { ...rule, enabled: await this.state.isEnabled(rule.id), stats };
  }

  async setEnabled(caller: CallerContext, id: string, enabled: boolean): Promise<RuleView> {
    if (this.requireStepUp && !caller.mfaVerified) throw new StepUpRequiredError();
    if (!caller.roles.some((r) => r === 'SOC_ANALYST' || r === 'PLATFORM_ADMIN')) {
      throw new ForbiddenError('Only SOC_ANALYST or PLATFORM_ADMIN may toggle rules');
    }
    const rule = await this.getById(id);
    await this.state.setEnabled(rule.id, enabled);
    await this.audit.record(caller, {
      action: enabled ? 'rule.enable' : 'rule.disable',
      resourceType: 'rule',
      resourceId: rule.id,
      outcome: 'success',
      details: { fileId: rule.fileId, title: rule.title },
    });
    return { ...rule, enabled };
  }

  /** Dry-run a rule against caller-supplied sample events (fixture testing from the UI). */
  async test(
    id: string,
    events: Array<Record<string, unknown>>,
  ): Promise<{ matched: boolean; matchingEventIndexes: number[] }> {
    const rule = await this.getById(id);
    const result = this.evaluator.evaluate(rule, events);
    return { matched: result.matched, matchingEventIndexes: result.matchingIndexes };
  }
}
