import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../deps.js';

/** Liveness, readiness (checks all four backing stores), Prometheus metrics. */
export function registerHealthRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/health', { schema: { tags: ['platform'], summary: 'Liveness probe' } }, async () => ({
    status: 'ok',
    ts: new Date().toISOString(),
  }));

  app.get('/ready', { schema: { tags: ['platform'], summary: 'Readiness probe' } }, async (req, reply) => {
    const checks = await Promise.allSettled([
      deps.pgPool.query('SELECT 1'),
      deps.opensearch.cluster.health({}),
      deps.wazuh.managerStatus(),
      deps.minioReady(),
    ]);
    const [postgres, opensearch, wazuh, minio] = checks;
    const detail = {
      postgres: postgres?.status === 'fulfilled',
      opensearch: opensearch?.status === 'fulfilled',
      wazuh: wazuh?.status === 'fulfilled' && (wazuh.value as { alive: boolean }).alive,
      minio: minio?.status === 'fulfilled' && minio.value === true,
    };
    const ready = detail.postgres && detail.opensearch && detail.minio; // wazuh degraded ≠ not ready
    if (!ready) {
      req.log.warn(detail, 'readiness check failed');
      return reply.code(503).send({ status: 'degraded', detail });
    }
    return { status: 'ready', detail };
  });

  app.get('/metrics', { schema: { tags: ['platform'], summary: 'Prometheus metrics' } }, async (_req, reply) => {
    reply.header('content-type', 'text/plain; version=0.0.4');
    return deps.metrics.render();
  });
}
