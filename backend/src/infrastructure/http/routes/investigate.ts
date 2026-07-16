import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../deps.js';
import { ROLES } from '../../../domain/valueObjects/role.js';
import { tenantScopeGuard } from '../middleware/tenantScope.js';

export function registerInvestigateRoutes(app: FastifyInstance, deps: AppDeps): void {
  const anyRole = deps.authz.require(ROLES);
  const analysts = deps.authz.require(['SOC_ANALYST', 'DSO_OPERATOR', 'PLATFORM_ADMIN', 'AUDITOR']);
  const guard = tenantScopeGuard(deps.metrics);

  app.post(
    '/investigate/query',
    { preHandler: [analysts, guard], config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { tags: ['investigate'] } },
    async (req) => {
      const body = z
        .object({
          query: z.record(z.unknown()),
          from: z.string().datetime({ offset: true }).optional(),
          to: z.string().datetime({ offset: true }).optional(),
          limit: z.coerce.number().int().min(1).max(1000).default(100),
        })
        .strict()
        .parse(req.body);
      return { events: await deps.investigateService.query(req.caller!, body) };
    },
  );

  app.get('/investigate/pivot/:field/:value', { preHandler: [analysts, guard], schema: { tags: ['investigate'] } }, async (req) => {
    const params = z.object({ field: z.string().max(64), value: z.string().max(512) }).parse(req.params);
    return { events: await deps.investigateService.pivot(req.caller!, params.field, params.value) };
  });

  app.post('/investigate/saved-queries', { preHandler: [anyRole, guard], schema: { tags: ['investigate'] } }, async (req, reply) => {
    const body = z.object({ name: z.string().min(1).max(120), query: z.record(z.unknown()) }).strict().parse(req.body);
    const saved = await deps.investigateService.saveQuery(req.caller!, body.name, body.query);
    return reply.code(201).send(saved);
  });

  app.get('/investigate/saved-queries', { preHandler: [anyRole, guard], schema: { tags: ['investigate'] } }, async (req) => {
    return { items: await deps.investigateService.listSavedQueries(req.caller!) };
  });
}
