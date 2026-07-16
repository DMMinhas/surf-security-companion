import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../deps.js';
import { CASE_STATUSES } from '../../../domain/entities/case.js';
import { ROLES } from '../../../domain/valueObjects/role.js';
import { tenantScopeGuard } from '../middleware/tenantScope.js';

const createSchema = z
  .object({
    title: z.string().min(3).max(200),
    description: z.string().max(10_000).default(''),
    severity: z.enum(['critical', 'high', 'medium', 'low']),
    tenantId: z.string().max(64).optional(),
    alertIds: z.array(z.string().uuid()).max(500).optional(),
    significantIncident: z.boolean().default(false),
  })
  .strict();

export function registerCaseRoutes(app: FastifyInstance, deps: AppDeps): void {
  const anyRole = deps.authz.require(ROLES);
  const writers = deps.authz.require(['SOC_ANALYST', 'DSO_OPERATOR', 'PLATFORM_ADMIN']);
  const guard = tenantScopeGuard(deps.metrics);
  const mutationLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } };

  app.get('/cases', { preHandler: [anyRole, guard], schema: { tags: ['cases'] } }, async (req) => {
    const query = z
      .object({
        status: z.enum(CASE_STATUSES).optional(),
        tenant: z.string().max(64).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        cursor: z.string().max(32).optional(),
      })
      .strict()
      .parse(req.query);
    return deps.caseService.list(req.caller!, {
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.tenant !== undefined ? { tenantId: query.tenant } : {}),
      limit: query.limit,
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    });
  });

  app.post('/cases', { preHandler: [writers, guard], config: mutationLimit, schema: { tags: ['cases'] } }, async (req, reply) => {
    const body = createSchema.parse(req.body);
    const created = await deps.caseService.create(req.caller!, body);
    return reply.code(201).send(created);
  });

  app.get('/cases/:id', { preHandler: [anyRole, guard], schema: { tags: ['cases'] } }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return deps.caseService.getById(req.caller!, id);
  });

  app.post('/cases/:id/status', { preHandler: [writers, guard], config: mutationLimit, schema: { tags: ['cases'] } }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { status } = z.object({ status: z.enum(CASE_STATUSES) }).strict().parse(req.body);
    return deps.caseService.setStatus(req.caller!, id, status);
  });

  app.post('/cases/:id/actions', { preHandler: [writers, guard], config: mutationLimit, schema: { tags: ['cases'] } }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        action: z.string().min(1).max(500),
        outcome: z.string().min(1).max(500),
        notes: z.string().max(5000).optional(),
      })
      .strict()
      .parse(req.body);
    return deps.caseService.addAction(req.caller!, id, body);
  });

  app.post('/cases/:id/alerts', { preHandler: [writers, guard], config: mutationLimit, schema: { tags: ['cases'] } }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { alertIds } = z.object({ alertIds: z.array(z.string().uuid()).min(1).max(500) }).strict().parse(req.body);
    return deps.caseService.addAlerts(req.caller!, id, alertIds);
  });

  app.post(
    '/cases/:id/classify-significant',
    { preHandler: [writers, guard], config: mutationLimit, schema: { tags: ['cases'], summary: 'Start the NIS2 24h clock' } },
    async (req) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      return deps.caseService.markSignificant(req.caller!, id);
    },
  );
}
