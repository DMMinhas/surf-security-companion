import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../deps.js';
import { NIS2_KIND_BY_ROUTE } from '../../../application/nis2/nis2Service.js';
import { tenantScopeGuard } from '../middleware/tenantScope.js';

export function registerReportRoutes(app: FastifyInstance, deps: AppDeps): void {
  const reporters = deps.authz.require(['SOC_ANALYST', 'DSO_OPERATOR', 'PLATFORM_ADMIN']);
  const auditors = deps.authz.require(['PLATFORM_ADMIN', 'AUDITOR']);
  const guard = tenantScopeGuard(deps.metrics);
  const strictLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  app.post(
    '/reports/nis2/:kind',
    {
      preHandler: [reporters, guard],
      config: strictLimit,
      schema: { tags: ['reports'], summary: 'Generate NIS2 report (early-warning 24h / incident 72h / final 1m)' },
    },
    async (req, reply) => {
      const { kind } = z.object({ kind: z.enum(['early-warning', 'incident', 'final']) }).parse(req.params);
      const { caseId } = z.object({ caseId: z.string().uuid() }).strict().parse(req.body);
      const mapped = NIS2_KIND_BY_ROUTE[kind];
      if (!mapped) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: `unknown kind ${kind}` });
      return deps.nis2Service.generate(req.caller!, caseId, mapped);
    },
  );

  app.post(
    '/reports/kritis-quarterly',
    { preHandler: [reporters, guard], config: strictLimit, schema: { tags: ['reports'] } },
    async (req) => {
      const { quarter } = z
        .object({ quarter: z.string().regex(/^\d{4}-Q[1-4]$/) })
        .strict()
        .parse(req.body);
      return deps.reportService.kritisQuarterly(req.caller!, quarter);
    },
  );

  app.post(
    '/reports/audit-export',
    { preHandler: [auditors, guard], config: strictLimit, schema: { tags: ['reports'] } },
    async (req) => {
      const range = z
        .object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) })
        .strict()
        .parse(req.body);
      return deps.reportService.auditExport(req.caller!, range);
    },
  );

  app.post(
    '/reports/gdpr/subject/:pseudonym',
    { preHandler: [auditors, guard], config: strictLimit, schema: { tags: ['reports'], summary: 'GDPR Art. 15 subject access export' } },
    async (req) => {
      const { pseudonym } = z.object({ pseudonym: z.string().max(128) }).parse(req.params);
      return deps.gdprService.subjectAccess(req.caller!, pseudonym);
    },
  );

  app.post(
    '/reports/gdpr/erase/:pseudonym',
    { preHandler: [auditors, guard], config: strictLimit, schema: { tags: ['reports'], summary: 'GDPR Art. 17 erasure flag (end-of-retention)' } },
    async (req) => {
      const { pseudonym } = z.object({ pseudonym: z.string().max(128) }).parse(req.params);
      return deps.gdprService.requestErasure(req.caller!, pseudonym);
    },
  );
}
