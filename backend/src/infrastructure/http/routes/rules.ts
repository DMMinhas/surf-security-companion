import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../deps.js';
import { ROLES } from '../../../domain/valueObjects/role.js';
import { tenantScopeGuard } from '../middleware/tenantScope.js';

export function registerRuleRoutes(app: FastifyInstance, deps: AppDeps): void {
  const anyRole = deps.authz.require(ROLES);
  const engineers = deps.authz.require(['SOC_ANALYST', 'PLATFORM_ADMIN']);
  const guard = tenantScopeGuard(deps.metrics);
  const strictLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  app.get('/rules', { preHandler: [anyRole, guard], schema: { tags: ['rules'] } }, async () => {
    return { items: await deps.ruleService.list() };
  });

  app.get('/rules/:id', { preHandler: [anyRole, guard], schema: { tags: ['rules'] } }, async (req) => {
    const { id } = z.object({ id: z.string().max(64) }).parse(req.params);
    return deps.ruleService.getById(id);
  });

  app.post(
    '/rules/:id/enable',
    { preHandler: [engineers, guard], config: strictLimit, schema: { tags: ['rules'], summary: 'Enable rule (step-up MFA required)' } },
    async (req) => {
      const { id } = z.object({ id: z.string().max(64) }).parse(req.params);
      return deps.ruleService.setEnabled(req.caller!, id, true);
    },
  );

  app.post(
    '/rules/:id/disable',
    { preHandler: [engineers, guard], config: strictLimit, schema: { tags: ['rules'], summary: 'Disable rule (step-up MFA required)' } },
    async (req) => {
      const { id } = z.object({ id: z.string().max(64) }).parse(req.params);
      return deps.ruleService.setEnabled(req.caller!, id, false);
    },
  );

  app.post(
    '/rules/:id/test',
    { preHandler: [engineers, guard], config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { tags: ['rules'], summary: 'Dry-run a rule against sample events' } },
    async (req) => {
      const { id } = z.object({ id: z.string().max(64) }).parse(req.params);
      const { events } = z
        .object({ events: z.array(z.record(z.unknown())).min(1).max(1000) })
        .strict()
        .parse(req.body);
      return deps.ruleService.test(id, events);
    },
  );
}
