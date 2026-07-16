import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../deps.js';
import { ALERT_STATUSES } from '../../../domain/entities/alert.js';
import { SEVERITIES } from '../../../domain/valueObjects/severity.js';
import { ROLES } from '../../../domain/valueObjects/role.js';
import { tenantScopeGuard } from '../middleware/tenantScope.js';

const listQuerySchema = z
  .object({
    status: z.enum(ALERT_STATUSES).optional(),
    severity: z.enum(SEVERITIES).optional(),
    tenant: z.string().max(64).optional(),
    ruleId: z.string().max(64).optional(),
    q: z.string().max(256).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().max(32).optional(),
  })
  .strict();

const statusBodySchema = z
  .object({
    status: z.enum(ALERT_STATUSES),
    assignee: z.string().max(128).optional(),
  })
  .strict();

const bulkBodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('ack'), ids: z.array(z.string().uuid()).min(1).max(500) }).strict(),
  z
    .object({
      action: z.literal('assign'),
      ids: z.array(z.string().uuid()).min(1).max(500),
      assignee: z.string().min(1).max(128),
    })
    .strict(),
  z
    .object({
      action: z.literal('link-case'),
      ids: z.array(z.string().uuid()).min(1).max(500),
      caseId: z.string().uuid(),
    })
    .strict(),
]);

export function registerAlertRoutes(app: FastifyInstance, deps: AppDeps): void {
  const anyRole = deps.authz.require(ROLES);
  const writers = deps.authz.require(['SOC_ANALYST', 'DSO_OPERATOR', 'PLATFORM_ADMIN']);
  const guard = tenantScopeGuard(deps.metrics);

  app.get('/alerts', { preHandler: [anyRole, guard], schema: { tags: ['alerts'] } }, async (req) => {
    const query = listQuerySchema.parse(req.query);
    return deps.alertService.list(req.caller!, {
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.severity !== undefined ? { severity: query.severity } : {}),
      ...(query.tenant !== undefined ? { tenantId: query.tenant } : {}),
      ...(query.ruleId !== undefined ? { ruleId: query.ruleId } : {}),
      ...(query.q !== undefined ? { q: query.q } : {}),
      ...(query.from !== undefined ? { from: query.from } : {}),
      ...(query.to !== undefined ? { to: query.to } : {}),
      limit: query.limit,
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    });
  });

  app.get('/alerts/:id', { preHandler: [anyRole, guard], schema: { tags: ['alerts'] } }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return deps.alertService.getById(req.caller!, id);
  });

  app.post(
    '/alerts/:id/status',
    { preHandler: [writers, guard], config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { tags: ['alerts'] } },
    async (req) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const body = statusBodySchema.parse(req.body);
      return deps.alertService.setStatus(req.caller!, id, body.status, body.assignee);
    },
  );

  app.post(
    '/alerts/bulk',
    { preHandler: [writers, guard], config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['alerts'] } },
    async (req) => {
      const body = bulkBodySchema.parse(req.body);
      return deps.alertService.bulk(req.caller!, body);
    },
  );

  app.get('/alerts/:id/correlated', { preHandler: [anyRole, guard], schema: { tags: ['alerts'] } }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return { events: await deps.alertService.correlatedEvents(req.caller!, id) };
  });
}
