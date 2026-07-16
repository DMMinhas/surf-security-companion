import type { FastifyReply, FastifyRequest } from 'fastify';
import { isCrossTenant } from '../../../domain/valueObjects/role.js';
import type { Metrics } from '../../telemetry/prom.js';

/**
 * Defence-in-depth on top of the repository-level tenant filters: if a
 * tenant-scoped caller passes an explicit `tenant`/`tenantId` query or body
 * parameter for a DIFFERENT tenant, reject and count the attempt. The
 * repositories additionally always AND `tenant_id = $claim` for scoped roles,
 * so even a bypass of this check cannot leak rows.
 */
export function tenantScopeGuard(metrics: Metrics) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const caller = req.caller;
    if (!caller || isCrossTenant(caller.roles)) return;

    const requested = extractRequestedTenant(req);
    if (requested !== undefined && requested !== caller.tenantId) {
      metrics.tenantScopeDenials.inc();
      req.log.warn(
        { user: caller.username, tenant: caller.tenantId, requested },
        'cross-tenant access attempt denied',
      );
      await reply.code(403).send({
        code: 'TENANT_SCOPE_VIOLATION',
        message: 'Access outside your tenant is not permitted',
      });
    }
  };
}

function extractRequestedTenant(req: FastifyRequest): string | undefined {
  const query = req.query as Record<string, unknown> | undefined;
  const body = req.body as Record<string, unknown> | undefined;
  const fromQuery = query?.['tenant'] ?? query?.['tenantId'];
  const fromBody = body?.['tenantId'];
  const value = fromQuery ?? fromBody;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
