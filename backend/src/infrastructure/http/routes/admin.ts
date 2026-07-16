import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../deps.js';
import { tenantScopeGuard } from '../middleware/tenantScope.js';

export function registerAdminRoutes(app: FastifyInstance, deps: AppDeps): void {
  const admins = deps.authz.require(['PLATFORM_ADMIN']);
  const auditors = deps.authz.require(['PLATFORM_ADMIN', 'AUDITOR']);
  const guard = tenantScopeGuard(deps.metrics);

  app.get(
    '/admin/hashchain/verify',
    { preHandler: [auditors, guard], schema: { tags: ['admin'], summary: 'Recompute and verify the Merkle hash chain' } },
    async (req) => {
      const query = z
        .object({
          from: z.string().datetime({ offset: true }),
          to: z.string().datetime({ offset: true }),
        })
        .strict()
        .parse(req.query);
      return deps.merkleChain.verify(query.from, query.to);
    },
  );

  app.get('/admin/audit', { preHandler: [auditors, guard], schema: { tags: ['admin'] } }, async (req) => {
    const query = z
      .object({
        actor: z.string().max(128).optional(),
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
        limit: z.coerce.number().int().min(1).max(1000).default(100),
      })
      .strict()
      .parse(req.query);
    return {
      items: await deps.auditRepo.list({
        ...(query.actor !== undefined ? { actor: query.actor } : {}),
        ...(query.from !== undefined ? { from: query.from } : {}),
        ...(query.to !== undefined ? { to: query.to } : {}),
        limit: query.limit,
      }),
    };
  });

  app.post(
    '/admin/tenants',
    { preHandler: [admins, guard], config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { tags: ['admin'] } },
    async (req, reply) => {
      const body = z
        .object({
          id: z.string().regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/).max(64),
          name: z.string().min(1).max(200),
        })
        .strict()
        .parse(req.body);
      await deps.pgPool.query('INSERT INTO tenants (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [
        body.id,
        body.name,
      ]);
      return reply.code(201).send(body);
    },
  );
}
