import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../deps.js';
import { PLAYBOOK_RUN_STATUSES } from '../../../domain/entities/playbookRun.js';
import { tenantScopeGuard } from '../middleware/tenantScope.js';

export function registerPlaybookRoutes(app: FastifyInstance, deps: AppDeps): void {
  // SOAR is deliberately restricted: only analysts and platform admins.
  const operators = deps.authz.require(['SOC_ANALYST', 'PLATFORM_ADMIN']);
  const admins = deps.authz.require(['PLATFORM_ADMIN']);
  const guard = tenantScopeGuard(deps.metrics);
  const strictLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  const countMetric = (playbook: string, status: string): void => {
    deps.metrics.playbookRuns.inc({ playbook, status });
  };

  app.post(
    '/playbooks/revoke-token',
    { preHandler: [operators, guard], config: strictLimit, schema: { tags: ['playbooks'], summary: 'Revoke API tokens (safe-mode)' } },
    async (req, reply) => {
      const body = z
        .object({
          tokenIds: z.array(z.string().min(1).max(256)).min(1).max(1000),
          reason: z.string().min(3).max(1000),
          caseId: z.string().uuid().optional(),
          dryRun: z.boolean().optional(),
        })
        .strict()
        .parse(req.body);
      const run = await deps.playbookService.revokeToken(req.caller!, body);
      countMetric(run.playbook, run.status);
      return reply.code(run.status === 'REQUESTED' ? 202 : 200).send(run);
    },
  );

  app.post(
    '/playbooks/quarantine-ems',
    { preHandler: [operators, guard], config: strictLimit, schema: { tags: ['playbooks'], summary: 'Quarantine / un-quarantine EMS devices (safe-mode, reversible)' } },
    async (req, reply) => {
      const body = z
        .object({
          emsIds: z.array(z.string().min(1).max(128)).min(1).max(1000),
          reason: z.string().min(3).max(1000),
          caseId: z.string().uuid().optional(),
          dryRun: z.boolean().optional(),
          reset: z.boolean().optional(),
        })
        .strict()
        .parse(req.body);
      const run = await deps.playbookService.quarantineEms(req.caller!, body);
      countMetric(run.playbook, run.status);
      return reply.code(run.status === 'REQUESTED' ? 202 : 200).send(run);
    },
  );

  app.get('/playbooks/runs', { preHandler: [operators, guard], schema: { tags: ['playbooks'] } }, async (req) => {
    const query = z
      .object({
        status: z.enum(PLAYBOOK_RUN_STATUSES).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .strict()
      .parse(req.query);
    return {
      items: await deps.playbookService.list({
        ...(query.status !== undefined ? { status: query.status } : {}),
        limit: query.limit,
      }),
    };
  });

  app.post(
    '/playbooks/:runId/approve',
    { preHandler: [admins, guard], config: strictLimit, schema: { tags: ['playbooks'], summary: 'Four-eyes approval (second PLATFORM_ADMIN)' } },
    async (req) => {
      const { runId } = z.object({ runId: z.string().uuid() }).parse(req.params);
      const run = await deps.playbookService.approve(req.caller!, runId);
      countMetric(run.playbook, run.status);
      return run;
    },
  );

  app.post(
    '/playbooks/:runId/reject',
    { preHandler: [admins, guard], config: strictLimit, schema: { tags: ['playbooks'] } },
    async (req) => {
      const { runId } = z.object({ runId: z.string().uuid() }).parse(req.params);
      const { reason } = z.object({ reason: z.string().min(3).max(1000) }).strict().parse(req.body);
      const run = await deps.playbookService.reject(req.caller!, runId, reason);
      countMetric(run.playbook, run.status);
      return run;
    },
  );
}
