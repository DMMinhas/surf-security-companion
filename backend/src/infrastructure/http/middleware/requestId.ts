import type { FastifyServerOptions } from 'fastify';

/**
 * Request-id strategy: trust an inbound x-request-id (nginx generates one at
 * the edge), otherwise mint a UUID. The same id flows through pino logs,
 * audit rows and OpenTelemetry spans.
 */
export function requestIdOptions(header: string): Pick<FastifyServerOptions, 'genReqId' | 'requestIdHeader'> {
  return {
    requestIdHeader: header,
    genReqId: (req) => {
      const inbound = req.headers[header];
      if (typeof inbound === 'string' && /^[\w.-]{8,128}$/.test(inbound)) return inbound;
      return crypto.randomUUID();
    },
  };
}
